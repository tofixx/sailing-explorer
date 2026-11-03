// Vereine und Teams (Konzept 11.1, F-150 … F-157): anlegen, Rollen, Sichtbarkeit, Beitrittsanfragen, Boote,
// Gruppenseite. Einladungen laufen über worker/invites.ts, Beiträge über worker/posts.ts, Neuigkeiten über stream.ts.
import type { Env } from './env';
import { postLogKey } from './post-sql';
import { IN_LOGBOOK_SQL, RECORDED_NM_SQL } from './logbook-sql';
import { currentUser, requireUser, type User } from './auth';
import { roleFor } from './boats';
import { randomId } from './crypto';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { canView, nextShareKey, requestKey } from './access';
import { assertActive, isAdmin, logLockedView } from './moderation';
import { checkVisibilityChoice, isSupporter, supportConfigured, visibilityRequiresSupport } from './supporter';
import { groupActivityCleanup, memberShareTargetsCleanup, recordBoat, recordMember } from './activity';
import { addFollow, followStats } from './follows';
import { clearHomeClub } from './home';
import { loadCover, pageCover, removeCoverOf } from './covers';
import { galleryPhotos } from './gallery';
import { harborFromBoatInput, harborRef } from './harbors';
import { BOAT_ID_RE, LIMITS, SHARE_ID_RE, cleanText, parseVisibility } from './validate';
import { GROUP_LIMITS, groupLimitMessage, groupVerdict } from '../src/domain/limits';
import { canChooseVisibility, DEFAULT_VISIBILITY, sharePath, type Visibility } from '../src/domain/visibility';
import {
  DEFAULT_MEMBERS_VISIBLE, canApprove, canManageGroup, canRemoveMember, canSeeMembers, effectiveJoinMode, isApprovers, isGroupKind, isGroupRole, isJoinMode,
  isMembersVisible, normalizeSlug, seasonStart, type Approvers, type GroupKind, type GroupRole, type JoinMode, type MembersVisible,
} from '../src/domain/groups';
import { funnyName, memberAlias } from '../src/domain/names';
import { effectivePostBy, isPostBy } from '../src/domain/posts';
import { isNotifyLevel, parseDefaultLevel } from '../src/domain/notifications';
import { coverRef } from '../src/domain/cover';
import { notifyRequest } from './notifications';
import { claimTargetCleanup, displacedSql } from './claim-cleanup';
import { notSuspendedSql, publicSql } from './visible-sql';

const DAY = 86_400_000;

export interface GroupRow {
  id: string;
  kind: GroupKind;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string;
  /** Anzeige-Kopie des Hafennamens (Konzept 13.3) */
  home_port: string;
  /** Hafen der Gruppe (0014) */
  harbor_id?: string | null;
  /** aus dem JOIN mit harbors (nur nicht ausgeblendete) */
  harbor_slug?: string | null;
  harbor_name?: string | null;
  visibility: Visibility;
  share_key: string | null;
  join_mode: JoinMode;
  /** wer Anfragen bestätigt (0015) */
  approve_by: Approvers;
  /** wer Beiträge schreibt (0029, B3): admins | members, NULL = Standard je Art */
  post_by?: string | null;
  /** wer die Mitgliederliste sieht (0032, F-440): members | public */
  members_visible?: string | null;
  /** Tageszusammenfassung (0035, F-469): 1 an (Standard), 0 vom Eigner abgeschaltet */
  day_summary?: number | null;
  owner_id: string;
  hidden_at: number | null;
  /** gesperrt (0023, Konzept 18.2): niemand hat dann eine Rolle */
  locked_at?: number | null;
  /** verifizierte Vertretung (0026, Konzept 20), nur Vereine */
  verified_at?: number | null;
  created_at: number;
  updated_at: number;
}

export const GROUP_NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Gruppe gibt es nicht oder sie ist geschlossen.');
const FORBIDDEN = (msg = 'Das dürfen nur Eigentümer und Admins der Gruppe.') => new HttpError(403, 'forbidden', msg);

export const GROUP_ID_RE = SHARE_ID_RE;

/** Gruppe samt Hafen (ausgeblendete Häfen zählen wie keiner). */
const GROUP_SELECT = 'SELECT g.*, h.slug AS harbor_slug, h.name AS harbor_name FROM groups g LEFT JOIN harbors h ON h.id = g.harbor_id AND h.hidden_at IS NULL';

export async function loadGroup(env: Env, id: string): Promise<GroupRow | null> {
  if (!GROUP_ID_RE.test(id)) return null;
  return env.DB.prepare(`${GROUP_SELECT} WHERE g.id = ?`).bind(id).first<GroupRow>();
}

export async function loadGroupBySlug(env: Env, raw: string): Promise<GroupRow | null> {
  const slug = typeof raw === 'string' && /^[a-z0-9-]{3,30}$/i.test(raw) ? raw.toLowerCase() : null;
  return slug ? env.DB.prepare(`${GROUP_SELECT} WHERE g.slug = ?`).bind(slug).first<GroupRow>() : null;
}

/** Rolle des Kontos in der Gruppe (auch bei unbekannter oder gesperrter Gruppe null, Konzept 18.2). */
export async function roleIn(env: Env, userId: string | null | undefined, groupId: string): Promise<GroupRole | null> {
  if (!userId) return null;
  const row = await env.DB.prepare(
    'SELECT m.role FROM group_members m JOIN groups g ON g.id = m.group_id AND g.locked_at IS NULL WHERE m.group_id = ? AND m.user_id = ?',
  )
    .bind(groupId, userId)
    .first<{ role: string }>();
  return row && isGroupRole(row.role) ? row.role : null;
}

/**
 * Darf der Betrachter die Gruppe sehen? Ausgeblendet: nur Eigner/Admins und Moderation. Sonst wie Abschnitt 1:
 * öffentlich alle, „Nur mit Link“ mit Schlüssel, geschlossen nur Mitglieder (Mitglieder sehen jede Stufe).
 */
export function canViewGroup(g: Pick<GroupRow, 'visibility' | 'share_key' | 'hidden_at' | 'locked_at'>, role: GroupRole | null, key: string | null, admin = false): boolean {
  if (g.locked_at) return admin;
  if (g.hidden_at && !canManageGroup(role) && !admin) return false;
  return canView({ visibility: g.visibility, shareKey: g.share_key, hiddenAt: null }, { manager: role !== null, key });
}

/** Lädt eine Gruppe, die die Anfrage sehen darf – sonst dieselbe 404 wie bei unbekannten (Fehlversuch mit Schlüssel zählt). */
export async function visibleGroup(request: Request, env: Env, g: GroupRow | null) {
  const user = await currentUser(request, env);
  const key = requestKey(request);
  const role = g ? await roleIn(env, user?.id, g.id) : null;
  if (!g || !canViewGroup(g, role, key, isAdmin(env, user?.id))) {
    await countKeyFailure(env, request, key);
    throw GROUP_NOT_FOUND();
  }
  if (g.locked_at && user) await logLockedView(env, request, user.id, 'group', g.id);
  return { group: g, role, user };
}

/** Gruppe, in der das Konto eine Rolle hat (sonst 404 bzw. 403 bei sichtbarer Gruppe ohne ausreichende Rolle). */
async function memberGroup(request: Request, env: Env, id: string, need: 'member' | 'manager' | 'owner') {
  const user = await requireUser(request, env);
  const g = await loadGroup(env, id);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  if (!g || !role) {
    // Sichtbare Gruppe ohne Mitgliedschaft: 403 statt 404 (die Gruppe ist ja bekannt).
    if (g && canViewGroup(g, null, requestKey(request))) throw FORBIDDEN('Das geht nur als Mitglied der Gruppe.');
    throw GROUP_NOT_FOUND();
  }
  if (g.hidden_at && !canManageGroup(role)) throw GROUP_NOT_FOUND();
  if (need === 'manager' && !canManageGroup(role)) throw FORBIDDEN();
  if (need === 'owner' && role !== 'owner') throw FORBIDDEN('Das darf nur der Eigentümer der Gruppe.');
  return { user, group: g, role };
}

export function groupShape(g: GroupRow, role: GroupRole | null) {
  const manager = canManageGroup(role);
  return {
    id: g.id,
    kind: g.kind,
    slug: g.slug,
    name: g.name,
    description: g.description,
    homePort: g.home_port,
    harbor: g.harbor_id && g.harbor_slug ? harborRef({ id: g.harbor_id, slug: g.harbor_slug, name: g.harbor_name ?? '' }) : null,
    visibility: g.visibility,
    joinMode: g.join_mode,
    approveBy: g.approve_by,
    // wer Beiträge schreibt (F-421): gespeichert oder Standard je Art
    postBy: effectivePostBy(g.kind, g.post_by),
    // wer die Mitgliederliste sieht (F-440) – unbekannt zählt wie „nur Mitglieder“
    membersVisible: (isMembersVisible(g.members_visible) ? g.members_visible : DEFAULT_MEMBERS_VISIBLE) as MembersVisible,
    // Tageszusammenfassung großer Verläufe (F-469) – ohne Spalte (Altbestand) an
    daySummary: g.day_summary !== 0,
    // Schlüssel und Link nur für Eigner und Admins (Konzept 2.4).
    shareKey: manager ? g.share_key : null,
    link: manager ? sharePath('g', g.slug, g.visibility, g.share_key) : null,
    role,
    hiddenAt: manager ? g.hidden_at : null,
    // Abzeichen „Verifiziert“ (Konzept 20.4, F-366) – nur Vereine
    verified: g.kind === 'club' && !!g.verified_at,
    createdAt: g.created_at,
  };
}

const short = (g: Pick<GroupRow, 'slug' | 'name' | 'kind'>) => ({ slug: g.slug, name: g.name, kind: g.kind });

// ---------------------------------------------------------------- Eingaben

interface GroupInput {
  kind?: unknown;
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  homePort?: unknown;
  /** Lage eines neuen Hafens zu `homePort` (F-353) */
  homePortPos?: unknown;
  /** Hafen (Konzept 13.3): ID, null = keiner; hat Vorrang vor homePort (Freitext, alte Clients) */
  harborId?: unknown;
  visibility?: unknown;
  joinMode?: unknown;
  /** wer Anfragen bestätigt – nur der Eigner */
  approveBy?: unknown;
  /** wer Beiträge schreibt (F-421) – nur der Eigner */
  postBy?: unknown;
  /** wer die Mitgliederliste sieht (F-440) – nur der Eigner */
  membersVisible?: unknown;
  /** Tageszusammenfassung an/aus (F-469) – nur der Eigner */
  daySummary?: unknown;
  parentId?: unknown;
  rotateKey?: unknown;
}

function applyInput(g: GroupRow, input: GroupInput): Visibility | null {
  if (input.name !== undefined) {
    const name = cleanText(input.name, LIMITS.nameLength);
    if (!name) throw new HttpError(400, 'invalid_name', 'Bitte einen Namen angeben.');
    g.name = name;
  }
  if (input.slug !== undefined) {
    const slug = normalizeSlug(input.slug);
    if (!slug) throw new HttpError(400, 'invalid_slug', 'Adresse: 3–30 Zeichen, nur a–z, 0–9 und Bindestrich.');
    g.slug = slug;
  }
  if (input.description !== undefined) g.description = cleanText(input.description, 1000);
  if (input.approveBy !== undefined) {
    if (!isApprovers(input.approveBy)) throw new HttpError(400, 'invalid_approvers', 'Unbekannte Regel, wer Anfragen bestätigt.');
    g.approve_by = input.approveBy;
  }
  if (input.postBy !== undefined) {
    if (!isPostBy(input.postBy)) throw new HttpError(400, 'invalid_post_by', 'Unbekannte Regel, wer Beiträge schreibt.');
    g.post_by = input.postBy;
  }
  if (input.membersVisible !== undefined) {
    if (!isMembersVisible(input.membersVisible)) throw new HttpError(400, 'invalid_members_visible', 'Unbekannte Regel, wer die Mitgliederliste sieht.');
    g.members_visible = input.membersVisible;
  }
  if (input.daySummary !== undefined) {
    if (typeof input.daySummary !== 'boolean') throw new HttpError(400, 'invalid_day_summary', 'Tageszusammenfassung: an oder aus.');
    g.day_summary = input.daySummary ? 1 : 0;
  }
  if (input.joinMode !== undefined) {
    if (!isJoinMode(input.joinMode)) throw new HttpError(400, 'invalid_join_mode', 'Unbekannte Beitrittsregel.');
    g.join_mode = input.joinMode;
  }
  if (input.visibility === undefined) return null;
  const v = parseVisibility(input.visibility);
  if (!v) throw new HttpError(400, 'invalid_visibility', 'Unbekannte Sichtbarkeit.');
  return v;
}

async function slugTaken(env: Env, slug: string, exceptId: string | null): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM groups WHERE slug = ?').bind(slug).first<{ id: string }>();
  return !!row && row.id !== exceptId;
}

const SLUG_TAKEN = () => new HttpError(409, 'slug_taken', 'Diese Adresse ist schon vergeben.');

// ---------------------------------------------------------------- Anlegen, ändern, löschen

/** POST /api/groups – Verein oder Team anlegen; der Anlegende wird Eigner (Konzept 11.1, 11.8). */
export async function createGroup(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const input = await readJson<GroupInput>(request);
  if (!isGroupKind(input.kind)) throw new HttpError(400, 'invalid_kind', 'Bitte „Verein“ oder „Team“ wählen.');
  const now = Date.now();
  const g: GroupRow = {
    id: randomId(), kind: input.kind, parent_id: null, slug: '', name: '', description: '', home_port: '', visibility: DEFAULT_VISIBILITY,
    share_key: null, join_mode: 'request', approve_by: 'admins', members_visible: DEFAULT_MEMBERS_VISIBLE, owner_id: user.id, hidden_at: null, created_at: now, updated_at: now,
  };
  const requested = applyInput(g, { name: '', ...input, slug: input.slug ?? '' }) ?? DEFAULT_VISIBILITY;

  // Kontingent und Sichtbarkeit (E1): kostenlos 1 öffentliche Gruppe, Unterstützer 10 auch nicht öffentliche.
  const owned = (await env.DB.prepare('SELECT COUNT(*) AS n FROM groups WHERE owner_id = ?').bind(user.id).first<{ n: number }>())?.n ?? 0;
  const supporter = await isSupporter(env, user.id);
  const v = groupVerdict(supporter, owned);
  if (v !== 'ok') throw new HttpError(v === 'quota' ? 409 : 402, v, groupLimitMessage(v, supportConfigured(env)));
  if (!canChooseVisibility(requested, supporter)) throw visibilityRequiresSupport(env);
  g.visibility = requested;
  g.share_key = nextShareKey(null, requested, null, false);

  // Team in einem Verein: nur wer dort Eigner oder Admin ist; Teams haben keine Untergruppen.
  if (input.parentId !== undefined && input.parentId !== null && input.parentId !== '') {
    const parent = typeof input.parentId === 'string' ? await loadGroup(env, input.parentId) : null;
    if (g.kind !== 'team' || !parent || parent.kind !== 'club' || !canManageGroup(await roleIn(env, user.id, parent.id))) {
      throw new HttpError(400, 'invalid_parent', 'Teams lassen sich nur einem Verein zuordnen, den du verwaltest.');
    }
    g.parent_id = parent.id;
  }
  await applyHarbor(env, user, g, input);
  // Ein Verein hat seinen Ort über den Heimathafen (F-354) – ohne ihn erschiene er nirgends in „Umgebung“
  if (g.kind === 'club' && !g.harbor_id) throw new HttpError(400, 'harbor_required', 'Ein Verein braucht einen Heimathafen – wähle ihn aus oder lege ihn mit seiner Lage an.');
  if (await slugTaken(env, g.slug, null)) throw SLUG_TAKEN();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO groups (id, kind, parent_id, slug, name, description, home_port, harbor_id, visibility, share_key, join_mode, approve_by, post_by, members_visible, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(g.id, g.kind, g.parent_id, g.slug, g.name, g.description, g.home_port, g.harbor_id ?? null, g.visibility, g.share_key, g.join_mode, g.approve_by, g.post_by ?? null, g.members_visible, g.owner_id, now, now),
      env.DB.prepare(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(g.id, user.id, now),
    ]);
  } catch (err) {
    // gleichzeitig vergebene Adresse (eindeutiger Index)
    if (String(err).includes('UNIQUE')) throw SLUG_TAKEN();
    throw err;
  }
  return json({ group: groupShape(g, 'owner') }, { status: 201 });
}

/**
 * PATCH /api/groups/:id – Eigner und Admins: Name, Adresse, Beschreibung, Heimathafen, Link erneuern; Sichtbarkeit,
 * Beitrittsstufe und wer Anfragen bestätigt nur der Eigner (E1 gilt für sein Konto, eine gesetzte Stufe darf bleiben).
 */
export async function updateGroup(request: Request, env: Env, id: string): Promise<Response> {
  const { user, group: g, role } = await memberGroup(request, env, id, 'manager');
  const input = await readJson<GroupInput>(request);
  const previous = g.visibility;
  const before = { approveBy: g.approve_by, joinMode: g.join_mode, postBy: effectivePostBy(g.kind, g.post_by), membersVisible: g.members_visible, daySummary: g.day_summary };
  const next = applyInput(g, input);
  if ((g.approve_by !== before.approveBy || g.join_mode !== before.joinMode || effectivePostBy(g.kind, g.post_by) !== before.postBy || g.members_visible !== before.membersVisible || g.day_summary !== before.daySummary) && role !== 'owner') {
    throw FORBIDDEN('Beitritt, wer Anfragen bestätigt, wer Beiträge schreibt, wer die Mitglieder sieht und die Tageszusammenfassung legt der Eigentümer fest.');
  }
  await applyHarbor(env, user, g, input);
  // Bestehende Vereine ohne Hafen dürfen weiter bearbeitet werden – nur ausdrücklich entfernen geht nicht (F-354)
  if (g.kind === 'club' && !g.harbor_id && (input.harborId === null || input.harborId === '')) throw new HttpError(400, 'harbor_required', 'Ein Verein braucht einen Heimathafen.');
  if (next && next !== previous) {
    if (role !== 'owner') throw FORBIDDEN('Die Sichtbarkeit ändert nur der Eigentümer.');
    await checkVisibilityChoice(env, g.owner_id, next, previous);
    g.visibility = next;
  }
  g.share_key = nextShareKey(previous, g.visibility, g.share_key, input.rotateKey === true);
  if (await slugTaken(env, g.slug, g.id)) throw SLUG_TAKEN();
  g.updated_at = Date.now();
  await env.DB.prepare(
    'UPDATE groups SET slug = ?, name = ?, description = ?, home_port = ?, harbor_id = ?, visibility = ?, share_key = ?, join_mode = ?, approve_by = ?, post_by = ?, members_visible = ?, day_summary = ?, updated_at = ? WHERE id = ?',
  )
    .bind(g.slug, g.name, g.description, g.home_port, g.harbor_id ?? null, g.visibility, g.share_key, g.join_mode, g.approve_by, g.post_by ?? null, g.members_visible ?? DEFAULT_MEMBERS_VISIBLE, g.day_summary === 0 ? 0 : 1, g.updated_at, g.id)
    .run();
  return json({ group: groupShape(g, role) });
}

/** Hafen aus der Eingabe übernehmen (Autovervollständigung; Freitext findet einen Hafen oder legt ihn an). */
async function applyHarbor(env: Env, user: Pick<User, 'id'>, g: GroupRow, input: GroupInput): Promise<void> {
  const h = await harborFromBoatInput(env, user, input);
  if (h === undefined) return;
  g.harbor_id = h?.id ?? null;
  g.home_port = h?.name ?? '';
  g.harbor_slug = h?.slug ?? null;
  g.harbor_name = h?.name ?? null;
}

/** Löscht eine Gruppe samt Mitgliedern, Anfragen, Zuordnungen, Beiträgen, Einladungen, Folgen, Aktivitäten, Meldungen. */
export async function removeGroup(env: Env, id: string): Promise<void> {
  await removeCoverOf(env, 'g', id);
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM reports WHERE (target_kind = 'group' AND target_id = ?1)
         OR (target_kind = 'post' AND target_id IN (SELECT id FROM posts WHERE group_id = ?1))`,
    ).bind(id),
    ...groupActivityCleanup(env, id),
    // Anträge auf Verifizierung (Konzept 20.8)
    ...claimTargetCleanup(env, 'group', id),
    env.DB.prepare('DELETE FROM invites WHERE group_id = ?').bind(id),
    // Teams eines gelöschten Vereins bleiben eigenständig.
    env.DB.prepare('UPDATE groups SET parent_id = NULL WHERE parent_id = ?').bind(id),
    env.DB.prepare('DELETE FROM posts WHERE group_id = ?').bind(id),
    env.DB.prepare('DELETE FROM group_boats WHERE group_id = ?').bind(id),
    env.DB.prepare('DELETE FROM share_groups WHERE group_id = ?').bind(id),
    env.DB.prepare('DELETE FROM group_requests WHERE group_id = ?').bind(id),
    env.DB.prepare('DELETE FROM group_members WHERE group_id = ?').bind(id),
    env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id),
  ]);
}

/** DELETE /api/groups/:id – nur der Eigner. */
export async function deleteGroup(request: Request, env: Env, id: string): Promise<Response> {
  const { group } = await memberGroup(request, env, id, 'owner');
  // Offener Antrag auf Verifizierung (Konzept 20.5): niemand löscht den Verein vor der Entscheidung – neutral formuliert
  if (await env.DB.prepare(`SELECT 1 AS x FROM claims WHERE target_kind = 'group' AND target_id = ? AND status = 'open'`).bind(group.id).first()) {
    throw new HttpError(409, 'claim_pending', 'Das Löschen ist gerade nicht möglich – bitte wende dich an die Moderation.');
  }
  await removeGroup(env, group.id);
  return new Response(null, { status: 204 });
}

/**
 * Konto löschen (Konzept 11.9, 13.4): eigene Gruppen gehen an den dienstältesten Admin, ohne Admin an das
 * dienstälteste Mitglied – eine Gruppe bleibt, solange sie Mitglieder hat. Nur Gruppen ohne weitere Mitglieder fallen.
 * Verifizierte Vereine (Konzept 20.5) verlieren das Abzeichen, und Verdrängte werden bei der Nachfolge übersprungen.
 * Liefert die Anweisungen für Mitgliedschaften, Anfragen und Beiträge des Kontos (für den Batch in purgeUser).
 */
export async function purgeUserGroups(env: Env, userId: string): Promise<D1PreparedStatement[]> {
  await env.DB.batch([
    env.DB.prepare('UPDATE groups SET verified_at = NULL WHERE owner_id = ? AND verified_at IS NOT NULL').bind(userId),
    env.DB.prepare(
      `UPDATE group_members SET role = 'owner' WHERE rowid IN (
         SELECT (SELECT m.rowid FROM group_members m WHERE m.group_id = g.id AND m.user_id <> ?1
                   AND NOT ${displacedSql('group', 'g.id', 'm.user_id')}
                 ORDER BY m.role = 'admin' DESC, m.created_at, m.user_id LIMIT 1)
         FROM groups g WHERE g.owner_id = ?1)`,
    ).bind(userId),
    env.DB.prepare(
      `UPDATE groups SET owner_id = (SELECT m.user_id FROM group_members m WHERE m.group_id = groups.id AND m.role = 'owner' AND m.user_id <> ?1 LIMIT 1),
         updated_at = ?2
       WHERE owner_id = ?1 AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = groups.id AND m.role = 'owner' AND m.user_id <> ?1)`,
    ).bind(userId, Date.now()),
  ]);
  const { results } = await env.DB.prepare('SELECT id FROM groups WHERE owner_id = ?').bind(userId).all<{ id: string }>();
  for (const g of results) await removeGroup(env, g.id);
  return [
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'post' AND target_id IN (SELECT id FROM posts WHERE author_id = ?)`).bind(userId),
    env.DB.prepare('DELETE FROM posts WHERE author_id = ?').bind(userId),
    // Tageszähler des Profil-Verlaufs (F-420) – Gruppen-Zähler tragen keine Konto-ID
    env.DB.prepare('DELETE FROM post_log WHERE group_id = ?').bind(postLogKey({ kind: 'user', id: userId })),
    env.DB.prepare('DELETE FROM group_requests WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM group_members WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM share_groups WHERE share_id IN (SELECT id FROM shares WHERE user_id = ?)').bind(userId),
    env.DB.prepare('UPDATE group_boats SET added_by = NULL WHERE added_by = ?').bind(userId),
    env.DB.prepare('DELETE FROM group_boats WHERE boat_id IN (SELECT id FROM boats WHERE owner_id = ?)').bind(userId),
  ];
}

// ---------------------------------------------------------------- Lesen

/** GET /api/groups – eigene Gruppen (mit Rolle) und offene eigene Anfragen. */
export async function listMyGroups(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT g.*, m.role AS my_role, m.notify_level AS my_level, (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) AS members
     FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ? AND g.locked_at IS NULL ORDER BY g.name`,
  )
    .bind(user.id)
    .all<GroupRow & { my_role: GroupRole; my_level: string | null; members: number }>();
  const { results: requests } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.name, g.kind, r.created_at FROM group_requests r JOIN groups g ON g.id = r.group_id WHERE r.user_id = ? ORDER BY r.created_at DESC`,
  )
    .bind(user.id)
    .all<{ id: string; slug: string; name: string; kind: GroupKind; created_at: number }>();
  const prefs = await env.DB.prepare('SELECT notify_prefs FROM users WHERE id = ?').bind(user.id).first<{ notify_prefs: string | null }>();
  const fallback = parseDefaultLevel(prefs?.notify_prefs);
  return json({
    groups: results.map((g) => ({
      ...groupShape(g, g.my_role), members: g.members, muted: g.my_level === 'muted',
      // Stufe der Benachrichtigungen (F-449), ohne eigene Wahl die Voreinstellung
      notifyLevel: isNotifyLevel(g.my_level) ? g.my_level : fallback,
    })),
    requests: requests.map((r) => ({ id: r.id, ...short(r), createdAt: r.created_at })),
  });
}

const PUBLIC_SHARE = publicSql('s');
/** Törns der Gruppe = die in ihr ausgewählten (share_groups, F-376) – nicht mehr alle der Mitglieder und Boote. */
const GROUP_SHARES = `s.id IN (SELECT share_id FROM share_groups WHERE group_id = ?1)`;

/** Kennzahlen: Mitglieder, öffentliche Boote, öffentliche in der Gruppe ausgewählte Törns, Saison (Kalenderjahr). */
async function groupStats(env: Env, groupId: string, now = Date.now()) {
  const yearStart = seasonStart(now);
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM group_members WHERE group_id = ?1) AS members,
       (SELECT COUNT(*) FROM group_boats gb JOIN boats b ON b.id = gb.boat_id WHERE gb.group_id = ?1 AND ${publicSql('b')}) AS boats,
       COUNT(s.id) AS voyages, COALESCE(SUM(s.dist_nm), 0) AS dist, ${RECORDED_NM_SQL} AS rec,
       COALESCE(SUM(CASE WHEN COALESCE(s.started_at, s.created_at) >= ?2 THEN s.dist_nm END), 0) AS season
     FROM shares s WHERE ${PUBLIC_SHARE} AND ${GROUP_SHARES} AND ${IN_LOGBOOK_SQL}`,
  )
    .bind(groupId, yearStart)
    .first<{ members: number; boats: number; voyages: number; dist: number; rec: number; season: number }>();
  return { members: row?.members ?? 0, boats: row?.boats ?? 0, voyages: row?.voyages ?? 0, distNm: row?.dist ?? 0, recordedNm: row?.rec ?? 0, seasonNm: row?.season ?? 0 };
}

interface MemberRow {
  user_id: string;
  role: GroupRole;
  created_at: number;
  handle: string | null;
  display_name: string | null;
  public_profile: number | null;
}

/** GET /api/groups/slug/:slug bzw. /api/groups/:id – Gruppenseite (Konzept 11.1, F-156). */
export async function getGroup(request: Request, env: Env, idOrSlug: string, bySlug: boolean): Promise<Response> {
  const g = bySlug ? await loadGroupBySlug(env, idOrSlug) : await loadGroup(env, idOrSlug);
  const { group, role, user } = await visibleGroup(request, env, g);
  const manager = canManageGroup(role);

  const { results: members } = await env.DB.prepare(
    `SELECT m.user_id, m.role, m.created_at, p.handle, p.display_name, ${publicSql('p')} AS public_profile
     FROM group_members m LEFT JOIN profiles p ON p.user_id = m.user_id
     WHERE m.group_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at`,
  )
    .bind(group.id)
    .all<MemberRow>();
  // Mitgliederliste (F-440, F-441): Eigner und Admins sehen alle Anzeigenamen (zum Verwalten), nie E-Mails. Sonst nur
  // Mitglieder bzw. alle bei öffentlicher Liste – dann Name mit öffentlichem Profil, sonst der Spaßname dieser Gruppe.
  // Gäste und Nicht-Mitglieder ohne öffentliche Liste sehen nur die Zahl (stats.members).
  const seeMembers = manager || canSeeMembers(group.members_visible, role);
  const memberList = (seeMembers ? members : []).map((m) => {
    const named = manager || (!!m.public_profile && !!m.handle);
    return {
      id: manager ? m.user_id : null,
      handle: m.public_profile ? m.handle : null,
      displayName: manager ? m.display_name || funnyName(m.user_id) : named ? (m.display_name ?? '') : memberAlias(m.user_id, group.id),
      ...(named ? {} : { alias: true }),
      role: m.role,
      isSelf: m.user_id === user?.id,
    };
  });

  // Boote (F-442): öffentliche, soweit der Betrachter die Mitglieder sehen darf (ein Boot verrät seinen Eigner); eigene
  // (verwaltete) immer für ihre Verwalter, damit sie sie entfernen können.
  const { results: boats } = await env.DB.prepare(
    `SELECT b.id, b.name, b.boat_type, b.length_m, b.home_port, b.visibility, b.hidden_at,
       (b.owner_id = ?2 OR EXISTS (SELECT 1 FROM boat_admins a WHERE a.boat_id = b.id AND a.user_id = ?2)) AS mine
     FROM group_boats gb JOIN boats b ON b.id = gb.boat_id WHERE gb.group_id = ?1 ORDER BY b.name`,
  )
    .bind(group.id, user?.id ?? '')
    .all<{ id: string; name: string; boat_type: string; length_m: number | null; home_port: string; visibility: Visibility; hidden_at: number | null; mine: number }>();
  const boatList = boats
    .filter((b) => b.mine || (seeMembers && b.visibility === 'public' && !b.hidden_at))
    .map((b) => ({ id: b.id, name: b.name, boatType: b.boat_type, lengthM: b.length_m, homePort: b.home_port, mine: !!b.mine, canRemove: !!b.mine || manager, public: b.visibility === 'public' && !b.hidden_at }));

  // Verein bzw. Teams – nur sichtbare
  const parentRow = group.parent_id ? await loadGroup(env, group.parent_id) : null;
  const parentRole = parentRow ? await roleIn(env, user?.id, parentRow.id) : null;
  const parent = parentRow && canViewGroup(parentRow, parentRole, null) ? short(parentRow) : null;
  const { results: teams } = await env.DB.prepare(
    `SELECT g.slug, g.name, g.kind FROM groups g WHERE g.parent_id = ?1 AND g.hidden_at IS NULL
       AND (g.visibility = 'public' OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?2)) ORDER BY g.name`,
  )
    .bind(group.id, user?.id ?? '')
    .all<{ slug: string; name: string; kind: GroupKind }>();

  const requested = !!user && !role && !!(await env.DB.prepare('SELECT 1 AS x FROM group_requests WHERE group_id = ? AND user_id = ?').bind(group.id, user.id).first());
  const social = await followStats(env, 'group', group.id, user?.id ?? null);
  const muted = !!role && social.notifyLevel === 'muted';
  const approver = canApprove(role, group.approve_by);
  const mode = effectiveJoinMode(group);
  return json({
    group: groupShape(group, role),
    parent,
    teams,
    stats: await groupStats(env, group.id),
    members: memberList,
    /** Liste verborgen (F-441): nur die Anzahl in `stats.members` */
    membersHidden: !seeMembers,
    boats: boatList,
    social,
    // Titelbild und neueste öffentliche Fotos aus den in der Gruppe gezeigten Törns (Konzept 13, 11.12)
    ...pageCover('g', group.id, await loadCover(env, 'g', group.id), group.visibility === 'public' ? null : requestKey(request)),
    // Fotos stammen aus Törns der Mitglieder: nur, wer die Mitglieder sehen darf (F-442, Konzept 24.7)
    photos: seeMembers ? await galleryPhotos(env, 'group', group.id) : [],
    // Ort für die Karte im Hintergrund (F-351): Position des Heimathafens, sonst null
    place: group.harbor_id
      ? ((await env.DB.prepare('SELECT lat, lon FROM harbors WHERE id = ? AND hidden_at IS NULL AND lat IS NOT NULL AND lon IS NOT NULL').bind(group.harbor_id).first<{ lat: number; lon: number }>()) ?? null)
      : null,
    membership: {
      role,
      requested,
      /** Neuigkeiten stumm geschaltet (F-346) */
      muted,
      canRequest: !!user && !role && mode === 'request' && !requested,
      /** offen (nur öffentliche Gruppen): direkt beitreten (Konzept 14.1) */
      canJoin: !!user && !role && mode === 'open',
      /** einladen dürfen alle Mitglieder; ohne Recht zu bestätigen wird die Annahme zur Anfrage */
      canInvite: !!role,
      /** darf Anfragen bestätigen (Eigner-Einstellung approveBy) */
      canApprove: approver,
    },
    ...(approver ? { requests: await openRequests(env, group.id) } : {}),
    ...(manager ? { invites: await openInvites(env, group.id) } : {}),
  });
}

/** Offene Beitrittsanfragen mit Anzeigenamen – für alle, die bestätigen dürfen. */
async function openRequests(env: Env, groupId: string) {
  const { results: requests } = await env.DB.prepare(
    `SELECT r.user_id, r.message, r.created_at, p.handle, p.display_name, ${publicSql('p')} AS public_profile
     FROM group_requests r LEFT JOIN profiles p ON p.user_id = r.user_id WHERE r.group_id = ? ORDER BY r.created_at`,
  )
    .bind(groupId)
    .all<{ user_id: string; message: string; created_at: number; handle: string | null; display_name: string | null; public_profile: number | null }>();
  return requests.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name || funnyName(r.user_id),
    handle: r.public_profile ? r.handle : null,
    message: r.message,
    createdAt: r.created_at,
  }));
}

/** Offene Einladungen (ohne Token) – für Eigner und Admins. */
async function openInvites(env: Env, groupId: string) {
  const { results: invites } = await env.DB.prepare(
    'SELECT id, email, max_uses, uses, created_at, expires_at FROM invites WHERE group_id = ? AND expires_at > ? AND uses < max_uses ORDER BY created_at',
  )
    .bind(groupId, Date.now())
    .all<{ id: string; email: string | null; max_uses: number; uses: number; created_at: number; expires_at: number }>();
  return invites.map((i) => ({ id: i.id, email: i.email, usesLeft: i.max_uses - i.uses, createdAt: i.created_at, expiresAt: i.expires_at }));
}

// ---------------------------------------------------------------- Mitglieder

const memberCount = async (env: Env, groupId: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').bind(groupId).first<{ n: number }>())?.n ?? 0;

export const GROUP_FULL = () => new HttpError(409, 'quota', `Eine Gruppe hat höchstens ${GROUP_LIMITS.members} Mitglieder.`);

/** Trägt ein Mitglied ein (Einladung oder Anfrage), erledigt eine offene Anfrage und protokolliert den Beitritt. */
export async function addMember(env: Env, groupId: string, userId: string): Promise<boolean> {
  if ((await memberCount(env, groupId)) >= GROUP_LIMITS.members) throw GROUP_FULL();
  const now = Date.now();
  // Aus Folgen wird Mitgliedschaft (F-446): die gewählte Stufe geht mit, die follows-Zeile fällt weg
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role, created_at, notify_level)
       VALUES (?1, ?2, 'member', ?3, (SELECT notify_level FROM follows WHERE user_id = ?2 AND target_kind = 'group' AND target_id = ?1))`,
    ).bind(groupId, userId, now),
    env.DB.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').bind(groupId, userId),
    ...followToMemberStmts(env, groupId, userId),
  ]);
  if (!ins.meta.changes) return false;
  await recordMember(env, groupId, userId, now);
  return true;
}

/** Folgen und Mitgliedschaft schließen sich aus (F-446): wer Mitglied ist, folgt der Gruppe nicht (mehr). */
export const followToMemberStmts = (env: Env, groupId: string, userId: string): D1PreparedStatement[] => [
  env.DB.prepare(`DELETE FROM follows WHERE user_id = ? AND target_kind = 'group' AND target_id = ? AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = follows.target_id AND m.user_id = follows.user_id)`).bind(userId, groupId),
];

/** PATCH /api/groups/:id/members/:userId – nur der Eigner ernennt Admins bzw. setzt sie ab. */
export async function setMemberRole(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const { group } = await memberGroup(request, env, id, 'owner');
  const { role } = await readJson<{ role?: unknown }>(request);
  if (role !== 'admin' && role !== 'member') throw new HttpError(400, 'invalid_role', 'Rolle: Admin oder Mitglied.');
  const res = await env.DB.prepare(`UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ? AND role <> 'owner'`).bind(role, group.id, who).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Diese Person ist kein Mitglied (oder der Eigentümer).');
  return json({ role });
}

/**
 * Eigner wechseln (F-347, auch Admin-Bereich F-236): neuer Eigner (Mitgliedschaft angelegt bzw. hochgestuft), der
 * bisherige bleibt Admin, eine offene Anfrage des neuen entfällt. Ohne Antrag endet dabei eine Verifizierung
 * (Konzept 20.6) – der angenommene Antrag (worker/claims.ts) setzt sie danach neu.
 */
export const transferGroupStmts = (env: Env, groupId: string, from: string | null, to: string, now: number) => [
  // ohne bisherigen Eigner (Admin-Bereich: verwaiste Gruppe) bleibt nur das Einsetzen
  ...(from ? [env.DB.prepare(`UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?`).bind(groupId, from)] : []),
  env.DB.prepare(
    // aus Folgen wird Mitgliedschaft (F-446): die Stufe geht mit wie bei addMember
    `INSERT INTO group_members (group_id, user_id, role, created_at, notify_level)
     VALUES (?1, ?2, 'owner', ?3, (SELECT notify_level FROM follows WHERE user_id = ?2 AND target_kind = 'group' AND target_id = ?1))
     ON CONFLICT(group_id, user_id) DO UPDATE SET role = 'owner'`,
  ).bind(groupId, to, now),
  env.DB.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').bind(groupId, to),
  ...followToMemberStmts(env, groupId, to),
  env.DB.prepare('UPDATE groups SET owner_id = ?, updated_at = ?, verified_at = NULL WHERE id = ?').bind(to, now, groupId),
];

/**
 * POST /api/groups/:id/owner `{ userId }` – der Eigner übergibt die Gruppe an einen Admin (F-347); danach ist er
 * selbst Admin und kann austreten. Nur an Admins – das Vertrauen ist schon ausgesprochen.
 */
export async function transferGroup(request: Request, env: Env, id: string): Promise<Response> {
  const { user, group } = await memberGroup(request, env, id, 'owner');
  const { userId } = await readJson<{ userId?: unknown }>(request);
  if (typeof userId !== 'string' || userId === user.id) throw new HttpError(400, 'invalid_user', 'Wähle einen Admin der Gruppe.');
  if ((await roleIn(env, userId, group.id)) !== 'admin') throw new HttpError(400, 'not_admin', 'Übergeben geht nur an einen Admin der Gruppe.');
  // Sperre gegen Rückübernahme (Konzept 20.5, F-367)
  if (await env.DB.prepare(`SELECT 1 AS x WHERE ${displacedSql('group', '?1', '?2')}`).bind(group.id, userId).first()) {
    throw new HttpError(409, 'claim_blocked', 'Dieser Person wurde die Verwaltung nach einer Prüfung entzogen – Übergabe nicht möglich.');
  }
  const target = await env.DB.prepare('SELECT suspended_at, locked_at FROM users WHERE id = ?').bind(userId).first<{ suspended_at: number | null; locked_at: number | null }>();
  if (!target || target.suspended_at || target.locked_at) throw new HttpError(400, 'invalid_user', 'Dieses Konto kann die Gruppe nicht übernehmen.');
  await env.DB.batch(transferGroupStmts(env, group.id, user.id, userId, Date.now()));
  return json({ owner: userId });
}

/**
 * PUT /api/groups/:id/mute `{ muted }` – eigene Mitgliedschaft stumm schalten bzw. wieder laut (F-346): Kurzform der
 * Stufe (F-449) – stumm = `muted`, laut = zurück zur Voreinstellung.
 */
export async function muteGroup(request: Request, env: Env, id: string): Promise<Response> {
  const { user, group } = await memberGroup(request, env, id, 'member');
  const { muted } = await readJson<{ muted?: unknown }>(request);
  if (typeof muted !== 'boolean') throw new HttpError(400, 'invalid_mute', 'muted: true oder false.');
  await env.DB.prepare('UPDATE group_members SET notify_level = ? WHERE group_id = ? AND user_id = ?').bind(muted ? 'muted' : null, group.id, user.id).run();
  return json({ muted });
}

/** DELETE /api/groups/:id/members/:userId – austreten (`me`) bzw. entfernen nach Rolle (Konzept 11.1). */
export async function removeMember(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const { user, group, role } = await memberGroup(request, env, id, 'member');
  const target = who === 'me' ? user.id : who;
  const targetRole = target === user.id ? role : await roleIn(env, target, group.id);
  if (!targetRole) throw new HttpError(404, 'not_found', 'Diese Person ist kein Mitglied.');
  if (target === user.id && role === 'owner') throw new HttpError(400, 'owner_cannot_leave', 'Übergib die Gruppe zuerst an einen Admin – oder lösche sie.');
  if (!canRemoveMember(role, targetRole, target === user.id)) throw FORBIDDEN('Admins entfernt nur der Eigentümer.');
  await env.DB.batch(leaveGroupStmts(env, group.id, target));
  // Austritt mit „Weiter folgen?“ – Ja (`?follow=1`): Folgen mit „Nur Direktes“ (F-446), nur bei öffentlichen Gruppen
  // Antwort `{ followed }`: false bei der Folgen-Grenze (GROUP_LIMITS.follows) – die Oberfläche meldet das
  if (target === user.id && new URL(request.url).searchParams.get('follow') === '1' && group.visibility === 'public' && !group.hidden_at) {
    return json({ followed: await addFollow(env, user.id, 'group', group.id) });
  }
  return new Response(null, { status: 204 });
}

/** Mitgliedschaft beenden (Austritt, Entfernen, Verdrängung nach Konzept 20.3). */
export const leaveGroupStmts = (env: Env, groupId: string, userId: string): D1PreparedStatement[] => [
  env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId),
  // „Mein Verein“ fällt mit (F-170), ebenso die Beitritts-Neuigkeit (sonst stünde sie bis zu 12 Monate im Stream)
  clearHomeClub(env, userId, groupId),
  env.DB.prepare('DELETE FROM activity WHERE bucket = ?').bind(`member:${groupId}:${userId}`),
  // Törns in Gruppen (F-377): nur Mitglieder zeigen Törns in der Gruppe – ihre Törns verlassen sie mit ihnen.
  env.DB.prepare('DELETE FROM share_groups WHERE group_id = ? AND share_id IN (SELECT id FROM shares WHERE user_id = ?)').bind(groupId, userId),
  ...memberShareTargetsCleanup(env, userId),
];

// ---------------------------------------------------------------- Beitrittsanfragen

/** POST /api/groups/:id/requests – sichtbare Gruppen: offen → Mitglied, auf Anfrage → Anfrage, nur Einladung → 403. */
export async function requestJoin(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const { group, role } = await visibleGroup(request, env, await loadGroup(env, id));
  if (role) throw new HttpError(409, 'already_member', 'Du bist schon Mitglied.');
  const mode = effectiveJoinMode(group);
  if (mode === 'invite') throw new HttpError(403, 'invite_only', 'Dieser Gruppe trittst du nur auf Einladung bei.');
  // Offen (Konzept 14.1): sofort Mitglied – effectiveJoinMode lässt das nur bei öffentlichen Gruppen zu.
  if (mode === 'open') {
    await addMember(env, group.id, user.id);
    return json({ joined: true, requested: false }, { status: 201 });
  }
  const body = await readJson<{ message?: unknown }>(request).catch(() => ({ message: '' }));
  const added = await insertRequest(env, group.id, user.id, cleanText(body.message, 300));
  return json({ requested: true, already: !added }, { status: added ? 201 : 200 });
}

/**
 * Beitrittsanfrage stellen – mit den Grenzen pro Konto und Tag und pro Gruppe (auch für angenommene Einladungen).
 * Liefert false, wenn schon eine Anfrage bestand.
 */
export async function insertRequest(env: Env, groupId: string, userId: string, message: string): Promise<boolean> {
  const now = Date.now();
  if (await env.DB.prepare('SELECT 1 AS x FROM group_requests WHERE group_id = ? AND user_id = ?').bind(groupId, userId).first()) return false;
  const mine = (await env.DB.prepare('SELECT COUNT(*) AS n FROM group_requests WHERE user_id = ? AND created_at > ?').bind(userId, now - DAY).first<{ n: number }>())?.n ?? 0;
  if (mine >= GROUP_LIMITS.requestsPerDay) throw new HttpError(429, 'request_quota', 'Du hast heute schon viele Anfragen gestellt – morgen geht es weiter.');
  const open = (await env.DB.prepare('SELECT COUNT(*) AS n FROM group_requests WHERE group_id = ?').bind(groupId).first<{ n: number }>())?.n ?? 0;
  if (open >= GROUP_LIMITS.openRequests) throw new HttpError(409, 'quota', 'Diese Gruppe hat gerade zu viele offene Anfragen. Bitte später erneut versuchen.');
  const res = await env.DB.prepare('INSERT OR IGNORE INTO group_requests (group_id, user_id, message, created_at) VALUES (?, ?, ?, ?)').bind(groupId, userId, message, now).run();
  if (res.meta.changes) await notifyRequest(env, groupId, userId);
  return !!res.meta.changes;
}

/** DELETE /api/groups/:id/requests/me – eigene Anfrage zurückziehen. */
export async function withdrawRequest(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const res = GROUP_ID_RE.test(id) ? await env.DB.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').bind(id, user.id).run() : null;
  if (!res?.meta.changes) throw new HttpError(404, 'not_found', 'Keine offene Anfrage.');
  return new Response(null, { status: 204 });
}

/** POST /api/groups/:id/requests/:userId – `{ approve }`: wer laut approveBy bestätigen darf, nimmt an oder lehnt ab. */
export async function decideRequest(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const { group, role } = await memberGroup(request, env, id, 'member');
  if (!canApprove(role, group.approve_by)) throw FORBIDDEN('Anfragen bestätigen in dieser Gruppe andere.');
  const { approve } = await readJson<{ approve?: unknown }>(request);
  if (typeof approve !== 'boolean') throw new HttpError(400, 'invalid_body', 'approve: true oder false.');
  const req = await env.DB.prepare('SELECT user_id FROM group_requests WHERE group_id = ? AND user_id = ?').bind(group.id, who).first<{ user_id: string }>();
  if (!req) throw new HttpError(404, 'not_found', 'Diese Anfrage gibt es nicht (mehr).');
  if (approve) await addMember(env, group.id, req.user_id);
  else await env.DB.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').bind(group.id, who).run();
  return json({ approved: approve });
}

// ---------------------------------------------------------------- Boote

/** POST /api/groups/:id/boats – `{ boatId }`: Mitglieder ordnen Boote zu, die sie verwalten (F-155). */
export async function addGroupBoat(request: Request, env: Env, id: string): Promise<Response> {
  const { user, group } = await memberGroup(request, env, id, 'member');
  const { boatId } = await readJson<{ boatId?: unknown }>(request);
  if (typeof boatId !== 'string' || !BOAT_ID_RE.test(boatId) || !(await roleFor(env, user.id, boatId))) {
    throw new HttpError(400, 'invalid_boat', 'Dieses Boot kannst du nicht zuordnen.');
  }
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM group_boats WHERE group_id = ?').bind(group.id).first<{ n: number }>())?.n ?? 0;
  if (n >= GROUP_LIMITS.boats) throw new HttpError(409, 'quota', `Eine Gruppe hat höchstens ${GROUP_LIMITS.boats} Boote.`);
  const now = Date.now();
  const res = await env.DB.prepare('INSERT OR IGNORE INTO group_boats (group_id, boat_id, added_by, created_at) VALUES (?, ?, ?, ?)').bind(group.id, boatId, user.id, now).run();
  if (res.meta.changes) await recordBoat(env, group.id, boatId, user.id, now);
  return json({ added: !!res.meta.changes }, { status: res.meta.changes ? 201 : 200 });
}

/** DELETE /api/groups/:id/boats/:boatId – Verwalter des Boots oder Eigner/Admins der Gruppe. */
export async function removeGroupBoat(request: Request, env: Env, id: string, boatId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const g = await loadGroup(env, id);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  const boatRole = BOAT_ID_RE.test(boatId) ? await roleFor(env, user.id, boatId) : null;
  if (!g || (!canManageGroup(role) && !boatRole)) throw GROUP_NOT_FOUND();
  const [res] = await env.DB.batch([
    env.DB.prepare('DELETE FROM group_boats WHERE group_id = ? AND boat_id = ?').bind(g.id, boatId),
    env.DB.prepare('DELETE FROM activity WHERE bucket = ?').bind(`boat:${g.id}:${boatId}`),
  ]);
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Dieses Boot ist nicht in der Gruppe.');
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- Liste für /entdecken

/**
 * Öffentliche Vereine und Teams (nicht ausgeblendet, Eigner nicht gesperrt), neueste zuerst. `search`: zusätzliche
 * Bedingung mit Platzhalter ?2 (Suche auf /entdecken, F-331). `near`: Hafen-IDs (JSON, nächste zuerst) – nur Gruppen
 * mit Heimathafen dort, nach Nähe sortiert (F-344).
 */
export async function publicGroups(env: Env, limit: number, search?: { where: string; like: string }, near?: string | null) {
  const stmt = env.DB.prepare(
    `SELECT g.id, g.slug, g.name, g.kind, g.home_port, g.description, g.join_mode, g.created_at, g.verified_at, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
       c.ver AS cover_ver, c.focus_y AS cover_y
     FROM groups g LEFT JOIN covers c ON c.kind = 'g' AND c.object_id = g.id
     WHERE ${publicSql('g')}
       AND ${notSuspendedSql('g.owner_id')} ${search?.where ?? ''}
       ${near ? `AND g.harbor_id IN (SELECT value FROM json_each(?3))` : ''}
     ORDER BY ${near ? `${nearRank('g.harbor_id')}, ` : ''}g.created_at DESC, g.id LIMIT ?1`,
  );
  const { results } = await (near ? stmt.bind(limit, search?.like ?? '', near) : search ? stmt.bind(limit, search.like) : stmt.bind(limit))
    .all<{ id: string; slug: string; name: string; kind: GroupKind; home_port: string; description: string; join_mode: JoinMode; created_at: number; verified_at: number | null; members: number; cover_ver: string | null; cover_y: number | null }>();
  return results.map((g) => ({
    id: g.id, slug: g.slug, name: g.name, kind: g.kind, homePort: g.home_port, description: g.description, joinMode: g.join_mode, createdAt: g.created_at, members: g.members, verified: g.kind === 'club' && !!g.verified_at,
    cover: coverRef('g', g.id, g.cover_ver, g.cover_y),
  }));
}

/** Rang eines Hafens in der Nähe-Liste ?3 (JSON-Array, nächste zuerst) – für ORDER BY. */
export const nearRank = (col: string) => `(SELECT CAST(key AS INTEGER) FROM json_each(?3) WHERE value = ${col})`;

export type { User };
