// Verifizierte Vertretung von Vereinen und Häfen (Konzept 20, F-360 ff.): Antrag „Ich vertrete diesen Verein/Hafen“,
// Zurückziehen, Prüfung durch die Moderation (annehmen mit Übertragung, ablehnen), Verifizierung entziehen und das
// nächtliche Ablaufen offener Anträge. SQL-Bausteine fürs Aufräumen liegen in claim-cleanup.ts.
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { requireUser } from './auth';
import { randomId } from './crypto';
import { adminIds, adminLogStmt, isLockedTarget, requireActiveUser, requireAdmin } from './moderation';
import { leaveGroupStmts, loadGroup, roleIn } from './groups';
import { harborVisible, loadHarbor } from './harbors';
import { claimResultMail, claimTransferMail, sendMail } from './mail';
import { notifyClaim, notifyClaimResult, notifyClaimTransfer } from './notifications';
import { displacedSql, unverifyStmt } from './claim-cleanup';
import { SHARE_ID_RE } from './validate';
import {
  CLAIM_FIELD_ERROR, CLAIM_KIND_LABEL, CLAIM_LIMITS, isClaimKind, isPreviousAction, parseClaimInput, parseDecisionNote, transferConsequence,
  type ClaimKind, type ClaimStatus, type MyClaim, type PreviousAction,
} from '../src/domain/claims';
import { funnyName } from '../src/domain/names';

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Verein bzw. Hafen gibt es nicht (mehr).');

interface Target {
  kind: ClaimKind;
  id: string;
  name: string;
  slug: string;
  /** heutige Eigner:in bzw. Anleger:in (kann bei Häfen fehlen oder ein gelöschtes Konto sein) */
  holder: string | null;
  verified: boolean;
}

/**
 * Ziel eines Antrags: ein Verein (Gruppe der Art `club`), den das Konto sehen darf (öffentlich oder Mitglied), bzw. ein
 * Hafen – jeweils nicht ausgeblendet und nicht gesperrt. Alles andere wie „gibt es nicht“ (F-361). Beim Entscheiden
 * (`userId` null) zählt die Sichtbarkeit nicht – sonst könnte der Eigner die Annahme durch „geschlossen“ blockieren.
 */
async function loadTarget(env: Env, kind: unknown, id: unknown, userId: string | null): Promise<Target> {
  if (!isClaimKind(kind) || typeof id !== 'string' || !SHARE_ID_RE.test(id)) throw NOT_FOUND();
  if (kind === 'group') {
    const g = await loadGroup(env, id);
    if (!g || g.kind !== 'club' || g.hidden_at || g.locked_at) throw NOT_FOUND();
    if (userId && g.visibility !== 'public' && !(await roleIn(env, userId, g.id))) throw NOT_FOUND();
    return { kind, id: g.id, name: g.name, slug: g.slug, holder: g.owner_id, verified: !!g.verified_at };
  }
  const h = await loadHarbor(env, id);
  if (!harborVisible(h) || (await isLockedTarget(env, 'harbor', h.id))) throw NOT_FOUND();
  return { kind, id: h.id, name: h.name, slug: h.slug, holder: h.created_by, verified: !!h.verified_at };
}

const targetPath = (t: Pick<Target, 'kind' | 'slug'>) => (t.kind === 'harbor' ? `/h/${t.slug}` : `/g/${t.slug}`);

async function isDisplaced(env: Env, t: Target, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare(`SELECT 1 AS x WHERE ${displacedSql(t.kind, '?1', '?2')}`).bind(t.id, userId).first());
}

interface ClaimRow {
  id: string;
  target_kind: ClaimKind;
  target_id: string;
  /** NULL, wenn das Konto gelöscht ist (angenommene Anträge bleiben als Sperre, 20.8) */
  user_id: string | null;
  role_text: string;
  reason: string;
  contact: string;
  evidence_url: string;
  status: ClaimStatus;
  decided_by: string | null;
  decided_at: number | null;
  decision_note: string;
  previous_user_id: string | null;
  previous_action: string | null;
  created_at: number;
}

const myClaimShape = (c: ClaimRow): MyClaim => ({
  id: c.id,
  status: c.status,
  createdAt: c.created_at,
  decidedAt: c.decided_at,
  note: c.status === 'rejected' ? c.decision_note : '',
});

/** Stand für die Vereins- bzw. Hafenseite: verifiziert, eigener letzter Antrag, ob ein Antrag geht. */
async function claimState(env: Env, t: Target, userId: string) {
  const mine = await env.DB.prepare('SELECT * FROM claims WHERE target_kind = ? AND target_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(t.kind, t.id, userId)
    .first<ClaimRow>();
  const blocked = await isDisplaced(env, t, userId);
  const representing = t.verified && t.holder === userId;
  return {
    verified: t.verified,
    representing,
    blocked,
    claim: mine ? myClaimShape(mine) : null,
    // nach einer Ablehnung erst nach der Wartefrist (Konzept 20.7)
    canClaim: !blocked && !representing && mine?.status !== 'open'
      && !(mine?.status === 'rejected' && (mine.decided_at ?? 0) > Date.now() - CLAIM_LIMITS.retryMs),
  };
}

/** GET /api/claims/:kind/:id – Stand für die angemeldete Person (F-362). */
export async function getClaimState(request: Request, env: Env, kind: string, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const t = await loadTarget(env, kind, id, user.id);
  return json(await claimState(env, t, user.id), { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * POST /api/claims { kind, id, role, reason, contact, evidenceUrl } – Antrag stellen (F-360) mit den Grenzen aus
 * Konzept 20.7 (F-361). Danach erfahren es die Admins in der Glocke, die heutige Eigner:in nicht (20.9 Frage 2).
 */
export async function createClaim(request: Request, env: Env): Promise<Response> {
  const user = await requireActiveUser(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const t = await loadTarget(env, body.kind, body.id, user.id);
  const input = parseClaimInput(body);
  if ('error' in input) throw new HttpError(400, `invalid_${input.error}`, CLAIM_FIELD_ERROR[input.error]);
  if (await isDisplaced(env, t, user.id)) {
    throw new HttpError(409, 'claim_blocked', 'Die Verwaltung wurde dir nach einer Prüfung entzogen – bei Fragen wende dich an die Moderation.');
  }
  if (t.verified && t.holder === user.id) throw new HttpError(409, 'already_verified', 'Du vertrittst ihn schon verifiziert.');
  const L = CLAIM_LIMITS;
  const now = Date.now();
  const c = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM claims WHERE user_id = ?1 AND target_kind = ?2 AND target_id = ?3 AND status = 'open') AS mine_open,
       (SELECT COUNT(*) FROM claims WHERE user_id = ?1 AND status = 'open') AS user_open,
       (SELECT COUNT(*) FROM claims WHERE user_id = ?1 AND created_at > ?4) AS user_recent,
       (SELECT COUNT(*) FROM claims WHERE user_id = ?1 AND target_kind = ?2 AND target_id = ?3 AND status = 'rejected' AND decided_at > ?5) AS rejected,
       (SELECT COUNT(*) FROM claims WHERE target_kind = ?2 AND target_id = ?3 AND status = 'open') AS target_open`,
  )
    .bind(user.id, t.kind, t.id, now - L.windowMs, now - L.retryMs)
    .first<{ mine_open: number; user_open: number; user_recent: number; rejected: number; target_open: number }>();
  if (c?.mine_open) throw new HttpError(409, 'claim_open', 'Dein Antrag ist schon in Prüfung.');
  if (c?.rejected) throw new HttpError(429, 'claim_retry', 'Nach einer Ablehnung geht ein neuer Antrag frühestens nach 30 Tagen.');
  if ((c?.user_open ?? 0) >= L.openPerUser) throw new HttpError(429, 'claim_limit', `Höchstens ${L.openPerUser} offene Anträge gleichzeitig.`);
  if ((c?.user_recent ?? 0) >= L.perWindow) throw new HttpError(429, 'claim_limit', `Höchstens ${L.perWindow} Anträge in 30 Tagen.`);
  if ((c?.target_open ?? 0) >= L.openPerTarget) throw new HttpError(429, 'claim_busy', 'Hierzu liegen schon viele Anträge vor – bitte wende dich direkt an die Moderation.');
  const id = randomId();
  try {
    await env.DB.prepare(
      `INSERT INTO claims (id, target_kind, target_id, user_id, role_text, reason, contact, evidence_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
      .bind(id, t.kind, t.id, user.id, input.role, input.reason, input.contact, input.evidenceUrl, now)
      .run();
  } catch (err) {
    // Doppelklick: der Teil-Index „ein offener Antrag je Konto und Objekt“ (0026) schlägt an
    if (String(err).includes('UNIQUE')) throw new HttpError(409, 'claim_open', 'Dein Antrag ist schon in Prüfung.');
    throw err;
  }
  await notifyClaim(env, id, user.id, [...adminIds(env)]);
  return json(await claimState(env, t, user.id), { status: 201 });
}

/**
 * DELETE /api/claims/:id – eigenen offenen Antrag zurückziehen (F-362): Angaben sofort geleert, das Gerüst zählt bis
 * zum Ablauf der Wartefrist weiter zur Grenze (Konzept 20.8).
 */
export async function withdrawClaim(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const now = Date.now();
  const res = await env.DB.prepare(
    `UPDATE claims SET status = 'withdrawn', decided_at = ?1, role_text = '', reason = '', contact = '', evidence_url = ''
     WHERE id = ?2 AND user_id = ?3 AND status = 'open'`,
  )
    .bind(now, id, user.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Diesen offenen Antrag gibt es nicht (mehr).');
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- Moderation

const PAGE = 50;

/** Ein Antrag in der Admin-Ansicht (F-363) – mit Kontaktdaten, nur für Admins. */
export interface AdminClaim {
  id: string;
  kind: ClaimKind;
  target: { id: string; name: string; path: string | null; verified: boolean };
  holder: { id: string; displayName: string; handle: string | null; since: number } | null;
  /** null: Konto gelöscht (angenommener Antrag bleibt als Sperre gegen Rückübernahme) */
  applicant: { id: string; displayName: string; handle: string | null; since: number | null } | null;
  role: string;
  reason: string;
  contact: string;
  evidenceUrl: string;
  status: ClaimStatus;
  createdAt: number;
  decidedAt: number | null;
  note: string;
  previousAction: string | null;
  otherOpen: number;
}

/** GET /api/admin/claims?status=open|decided&page= – offene älteste zuerst, entschiedene neueste zuerst (F-363). */
export async function adminClaims(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const url = new URL(request.url);
  const decided = url.searchParams.get('status') === 'decided';
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page')) || 1));
  const { results } = await env.DB.prepare(
    `SELECT c.*, COALESCE(g.name, h.name) AS t_name, COALESCE(g.slug, h.slug) AS t_slug, COALESCE(g.verified_at, h.verified_at) AS t_verified,
       hu.id AS h_id, hu.created_at AS h_since, hp.display_name AS h_name, hp.handle AS h_handle,
       au.created_at AS a_since, ap.display_name AS a_name, ap.handle AS a_handle,
       (SELECT COUNT(*) FROM claims o WHERE o.target_kind = c.target_kind AND o.target_id = c.target_id AND o.status = 'open' AND o.id <> c.id) AS other_open
     FROM claims c
     LEFT JOIN groups g ON c.target_kind = 'group' AND g.id = c.target_id
     LEFT JOIN harbors h ON c.target_kind = 'harbor' AND h.id = c.target_id
     LEFT JOIN users hu ON hu.id = COALESCE(g.owner_id, h.created_by)
     LEFT JOIN profiles hp ON hp.user_id = hu.id
     LEFT JOIN users au ON au.id = c.user_id
     LEFT JOIN profiles ap ON ap.user_id = c.user_id
     WHERE ${decided ? `c.status <> 'open'` : `c.status = 'open'`}
     ORDER BY ${decided ? 'c.decided_at DESC' : 'c.created_at ASC'} LIMIT ?1 OFFSET ?2`,
  )
    .bind(PAGE + 1, (page - 1) * PAGE)
    .all<ClaimRow & {
      t_name: string | null; t_slug: string | null; t_verified: number | null; h_id: string | null; h_since: number | null; h_name: string | null;
      h_handle: string | null; a_since: number | null; a_name: string | null; a_handle: string | null; other_open: number;
    }>();
  // Einblick in Kontaktdaten steht im Protokoll wie jede Admin-Liste (Konzept 18.5)
  await adminLogStmt(env, admin.id, 'list', 'claims', null, decided ? 'decided' : 'open').run();
  const claims: AdminClaim[] = results.slice(0, PAGE).map((r) => ({
    id: r.id,
    kind: r.target_kind,
    target: {
      id: r.target_id,
      name: r.t_name ?? '',
      path: r.t_slug ? targetPath({ kind: r.target_kind, slug: r.t_slug }) : null,
      verified: !!r.t_verified,
    },
    holder: r.h_id ? { id: r.h_id, displayName: r.h_name || funnyName(r.h_id), handle: r.h_handle, since: r.h_since ?? 0 } : null,
    applicant: r.user_id ? { id: r.user_id, displayName: r.a_name || funnyName(r.user_id), handle: r.a_handle, since: r.a_since } : null,
    role: r.role_text,
    reason: r.reason,
    contact: r.contact,
    evidenceUrl: r.evidence_url,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    note: r.decision_note,
    previousAction: r.previous_action,
    otherOpen: r.other_open,
  }));
  return json({ claims, page, more: results.length > PAGE });
}

const rejectStmt = (env: Env, where: string, adminId: string, note: string, now: number, ...args: unknown[]) =>
  env.DB.prepare(
    `UPDATE claims SET status = 'rejected', decided_by = ?1, decided_at = ?2, decision_note = ?3,
       role_text = '', reason = '', contact = '', evidence_url = '' WHERE status = 'open' AND ${where}`,
  ).bind(adminId, now, note, ...args);

/** Übertragung an die Antragsteller:in (F-364) – Verein wie 18.6, mit Wahl für die bisherige Eigner:in. */
function transferStmts(env: Env, t: Target, to: string, before: string | null, previous: PreviousAction, now: number): D1PreparedStatement[] {
  if (t.kind === 'harbor') {
    return [env.DB.prepare('UPDATE harbors SET created_by = ?, verified_at = ?, updated_at = ? WHERE id = ?').bind(to, now, now, t.id)];
  }
  if (before === to) return [env.DB.prepare('UPDATE groups SET verified_at = ? WHERE id = ?').bind(now, t.id)];
  const prev = !before
    ? []
    : previous === 'remove'
      ? leaveGroupStmts(env, t.id, before)
      : [env.DB.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').bind(previous, t.id, before)];
  return [
    ...prev,
    env.DB.prepare(
      `INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)
       ON CONFLICT(group_id, user_id) DO UPDATE SET role = 'owner'`,
    ).bind(t.id, to, now),
    env.DB.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').bind(t.id, to),
    env.DB.prepare('UPDATE groups SET owner_id = ?, verified_at = ?, updated_at = ? WHERE id = ?').bind(to, now, now, t.id),
  ];
}

/** Fehlertext der Zusicherung in `decideClaim` (NOT-NULL-Verletzung an `claims.status`). */
const CLAIM_RACE = 'NOT NULL constraint failed: claims.status';

/**
 * POST /api/admin/claims/:id { decision: 'accept'|'reject', note, previous } – Entscheidung (F-364, F-365). Annehmen
 * überträgt in einem Batch, verifiziert und lehnt weitere offene Anträge zum Objekt ab; Ablehnen verlangt eine
 * Begründung. Danach Glocke und Mail an die Beteiligten (F-368).
 *
 * Gleichzeitige Entscheidungen (zwei Admins, zwei Tabs): Der Batch nimmt den Antrag nur an, wenn er noch offen ist und
 * Eigner bzw. Anleger:in noch dieselbe ist wie gelesen; eine Zusicherung direkt danach setzt sonst `status` auf NULL –
 * die NOT-NULL-Verletzung rollt den ganzen Batch zurück (D1-Batches sind Transaktionen) → 409.
 */
export async function decideClaim(request: Request, env: Env, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const claim = SHARE_ID_RE.test(id) ? await env.DB.prepare('SELECT * FROM claims WHERE id = ?').bind(id).first<ClaimRow>() : null;
  if (!claim) throw new HttpError(404, 'not_found', 'Diesen Antrag gibt es nicht (mehr).');
  const DECIDED = () => new HttpError(409, 'claim_decided', 'Über diesen Antrag ist inzwischen entschieden oder der Eigner hat gewechselt – bitte neu laden.');
  if (claim.status !== 'open' || !claim.user_id) throw DECIDED();
  const body = await readJson<{ decision?: unknown; note?: unknown; previous?: unknown }>(request);
  const now = Date.now();
  if (body.decision === 'reject') {
    const note = parseDecisionNote(body.note);
    if (!note) throw new HttpError(400, 'invalid_note', `Begründung: ${CLAIM_LIMITS.noteMin}–${CLAIM_LIMITS.noteMax} Zeichen (geht an die Antragsteller:in).`);
    const [res] = await env.DB.batch([rejectStmt(env, 'id = ?4', admin.id, note, now, claim.id)]);
    if (!res.meta.changes) throw DECIDED();
    await adminLogStmt(env, admin.id, 'claim_reject', claim.target_kind, claim.target_id, note, now).run();
    await announceResult(env, claim.id);
    return json({ status: 'rejected' });
  }
  if (body.decision !== 'accept') throw new HttpError(400, 'invalid_decision', 'Bitte annehmen oder ablehnen.');
  const previous: unknown = body.previous ?? 'admin';
  if (!isPreviousAction(previous)) throw new HttpError(400, 'invalid_previous', 'Unbekannte Wahl für die bisherige Eigner:in.');
  // Ziel prüfen (ausgeblendet, gesperrt, kein Verein mehr → 409) – Sichtbarkeit zählt hier nicht
  let t: Target;
  try {
    t = await loadTarget(env, claim.target_kind, claim.target_id, null);
  } catch {
    throw new HttpError(409, 'target_unavailable', 'Das Objekt ist ausgeblendet, gesperrt oder kein Verein mehr – erst klären.');
  }
  const userId = claim.user_id;
  const applicant = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND locked_at IS NULL AND suspended_at IS NULL').bind(userId).first();
  if (!applicant) throw new HttpError(409, 'applicant_inactive', 'Das Konto der Antragsteller:in ist gesperrt oder suspendiert.');
  const holderExists = t.holder ? await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(t.holder).first() : null;
  const before = holderExists ? t.holder : null;
  const displaced = before && before !== userId ? before : null;
  const action = displaced ? (t.kind === 'harbor' ? 'none' : previous) : null;
  const holderSql = t.kind === 'group' ? 'SELECT owner_id FROM groups WHERE id = ?8' : 'SELECT created_by FROM harbors WHERE id = ?8';
  const { results: others } = await env.DB.prepare(`SELECT id FROM claims WHERE target_kind = ? AND target_id = ? AND status = 'open' AND id <> ?`)
    .bind(t.kind, t.id, claim.id)
    .all<{ id: string }>();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE claims SET status = 'accepted', decided_by = ?1, decided_at = ?2, decision_note = ?3, previous_user_id = ?4, previous_action = ?5
         WHERE id = ?6 AND status = 'open' AND (${holderSql}) IS ?7`,
      ).bind(admin.id, now, parseDecisionNote(body.note) ?? '', displaced, action, claim.id, t.holder, t.id),
      // Zusicherung: nur weiter, wenn genau diese Entscheidung gegriffen hat (sonst Rollback, siehe oben)
      env.DB.prepare(`UPDATE claims SET status = NULL WHERE id = ?1 AND NOT (status = 'accepted' AND decided_at IS ?2 AND decided_by IS ?3)`).bind(claim.id, now, admin.id),
      ...transferStmts(env, t, userId, before, previous, now),
      rejectStmt(env, 'target_kind = ?4 AND target_id = ?5 AND id <> ?6', admin.id, 'Ein anderer Antrag wurde angenommen.', now, t.kind, t.id, claim.id),
      adminLogStmt(env, admin.id, 'claim_accept', t.kind, t.id, `${before ?? '–'} → ${userId}${action ? ` (${action})` : ''}`, now),
    ]);
  } catch (err) {
    if (String(err).includes(CLAIM_RACE)) throw DECIDED();
    throw err;
  }
  await announceResult(env, claim.id);
  for (const o of others) await announceResult(env, o.id);
  if (displaced) await announceTransfer(env, claim.id);
  return json({ status: 'accepted' });
}

/** Ziel-Name und Pfad eines Antrags für Mails (auch wenn das Ziel inzwischen ausgeblendet ist: nur an Beteiligte). */
async function claimMailContext(env: Env, claimId: string) {
  return env.DB.prepare(
    `SELECT c.target_kind, c.status, c.decision_note, c.previous_action, u.email AS a_email, pu.email AS p_email,
       COALESCE(g.name, h.name) AS name, COALESCE(g.slug, h.slug) AS slug
     FROM claims c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users pu ON pu.id = c.previous_user_id
     LEFT JOIN groups g ON c.target_kind = 'group' AND g.id = c.target_id
     LEFT JOIN harbors h ON c.target_kind = 'harbor' AND h.id = c.target_id WHERE c.id = ?`,
  )
    .bind(claimId)
    .first<{ target_kind: ClaimKind; status: ClaimStatus; decision_note: string; previous_action: string | null; a_email: string | null; p_email: string | null; name: string | null; slug: string | null }>();
}

/** Mail-Fehler halten die Entscheidung nicht auf (wie F-296). */
async function trySend(env: Env, what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`claim mail ${what} failed`, err);
  }
}

async function announceResult(env: Env, claimId: string): Promise<void> {
  await notifyClaimResult(env, claimId);
  const m = await claimMailContext(env, claimId);
  if (!m?.a_email || !m.name || !m.slug || m.status === 'open' || m.status === 'withdrawn') return;
  const origin = (env.APP_ORIGIN || '').replace(/\/+$/, '');
  const status = m.status;
  await trySend(env, 'result', () =>
    sendMail(env, claimResultMail(env, m.a_email!, {
      status, kind: CLAIM_KIND_LABEL[m.target_kind] as 'Verein' | 'Hafen', name: m.name!, note: m.decision_note,
      url: `${origin}${targetPath({ kind: m.target_kind, slug: m.slug! })}`, contact: env.REPORT_CONTACT,
    })),
  );
}

async function announceTransfer(env: Env, claimId: string): Promise<void> {
  await notifyClaimTransfer(env, claimId);
  const m = await claimMailContext(env, claimId);
  if (!m?.p_email || !m.name) return;
  await trySend(env, 'transfer', () =>
    sendMail(env, claimTransferMail(env, m.p_email!, {
      kind: CLAIM_KIND_LABEL[m.target_kind] as 'Verein' | 'Hafen', name: m.name!, consequence: transferConsequence(m.target_kind, m.previous_action), contact: env.REPORT_CONTACT,
    })),
  );
}

/**
 * DELETE /api/admin/:art/:id/verification { reason } – Verifizierung entziehen (F-369): Abzeichen weg, Rechte bleiben,
 * angenommene Anträge (und damit die Sperre gegen Verdrängte) werden gelöscht.
 */
export async function adminUnverify(request: Request, env: Env, art: string, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const kind: ClaimKind | null = art === 'groups' ? 'group' : art === 'harbors' ? 'harbor' : null;
  if (!kind || !SHARE_ID_RE.test(id)) throw new HttpError(404, 'not_found');
  const { reason } = await readJson<{ reason?: unknown }>(request);
  const note = parseDecisionNote(reason);
  if (!note) throw new HttpError(400, 'invalid_reason', `Begründung: ${CLAIM_LIMITS.noteMin}–${CLAIM_LIMITS.noteMax} Zeichen (steht im Protokoll).`);
  const row = await env.DB.prepare(`SELECT verified_at FROM ${kind === 'group' ? 'groups' : 'harbors'} WHERE id = ?`).bind(id).first<{ verified_at: number | null }>();
  if (!row) throw new HttpError(404, 'not_found');
  if (!row.verified_at) throw new HttpError(409, 'not_verified', 'Das ist nicht verifiziert.');
  await env.DB.batch([
    unverifyStmt(env, kind, id),
    env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'claim' AND subject_id IN (SELECT id FROM claims WHERE target_kind = ?1 AND target_id = ?2 AND status = 'accepted')`).bind(kind, id),
    env.DB.prepare(`DELETE FROM claims WHERE target_kind = ? AND target_id = ? AND status = 'accepted'`).bind(kind, id),
    adminLogStmt(env, admin.id, 'unverify', kind, id, note),
  ]);
  return new Response(null, { status: 204 });
}

/**
 * Nächtlich (Konzept 20.8): offene Anträge älter als 180 Tage laufen ab – Angaben geleert, Hinweis an die
 * Antragsteller:in in Glocke und Mail. Höchstens 25 je Lauf (Mail-Budget).
 */
export async function expireClaims(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT id FROM claims WHERE status = 'open' AND created_at < ? ORDER BY created_at LIMIT 25`)
    .bind(now - CLAIM_LIMITS.openMaxMs)
    .all<{ id: string }>();
  for (const c of results) {
    await env.DB.prepare(
      `UPDATE claims SET status = 'expired', decided_at = ?1, role_text = '', reason = '', contact = '', evidence_url = '' WHERE id = ?2 AND status = 'open'`,
    )
      .bind(now, c.id)
      .run();
    await announceResult(env, c.id);
  }
  return results.length;
}
