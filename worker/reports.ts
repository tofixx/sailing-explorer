// Melden (DSA, Konzept 4.4, F-114) und Moderation durch Admins (ADMIN_USER_IDS).
// Gemeldet wird nur, was der Meldende sehen darf (sonst 404); 3 Meldungen verschiedener Konten oder eine
// „Ich bin abgebildet“-Meldung blenden das Ziel bis zur Prüfung aus (hidden_at).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { randomId } from './crypto';
import { removeCoverOf } from './covers';
import { removeBoat } from './boats';
import { removeComment } from './comments';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { canView, requestKey } from './access';
import { roleFor } from './boats';
import { visibleComment } from './comments';
import { assertActive, isAdmin } from './moderation';
import { removeShare, visibleShare } from './shares';
import { removePhotoById, visiblePhoto } from './photos';
import { canViewGroup, loadGroup, removeGroup, roleIn } from './groups';
import { removePost } from './posts';
import { harborVisible, loadHarbor, removeHarbor } from './harbors';
import { canManageGroup } from '../src/domain/groups';
import { BOAT_ID_RE, LIMITS, SHARE_ID_RE, cleanText, normalizeHandle, parseReportKind, parseReportReason } from './validate';
import { REPORT_NOTE_MAX, REPORT_REASONS, type ReportKind } from '../src/domain/comment-text';
import { sharePath, type Visibility } from '../src/domain/visibility';
import { funnyName } from '../src/domain/names';

const DAY = 86_400_000;

export const REPORT_LIMITS = {
  /** verschiedene Konten, ab denen ein Ziel bis zur Prüfung ausgeblendet wird */
  autoHideReporters: 3,
  /** Meldungen pro Konto in 24 h */
  perUserPerDay: 20,
  /** Einträge in der Admin-Liste */
  adminList: 50,
} as const;

/** Tabelle und ID-Spalte je Art – feste Werte, nie aus der Anfrage zusammengesetzt. */
const TABLE: Record<ReportKind, { table: string; idCol: string }> = {
  share: { table: 'shares', idCol: 'id' },
  comment: { table: 'comments', idCol: 'id' },
  photo: { table: 'photos', idCol: 'id' },
  profile: { table: 'profiles', idCol: 'user_id' },
  boat: { table: 'boats', idCol: 'id' },
  group: { table: 'groups', idCol: 'id' },
  post: { table: 'posts', idCol: 'id' },
  harbor: { table: 'harbors', idCol: 'id' },
};

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Das gibt es nicht (mehr) oder du kannst es nicht sehen.');

interface Target {
  kind: ReportKind;
  /** gespeicherte Ziel-ID: shares.id, comments.id, photos.id, profiles.user_id, boats.id */
  id: string;
  /** Konto, dem der Inhalt gehört */
  ownerId: string;
}

/** Ziel, das der Anfragende sehen darf (gleiche Prüfungen wie beim Ansehen, inkl. Schlüssel) – sonst 404. */
async function resolveTarget(request: Request, env: Env, kind: ReportKind, rawId: unknown): Promise<Target> {
  if (typeof rawId !== 'string') throw NOT_FOUND();
  if (kind === 'share') {
    if (!SHARE_ID_RE.test(rawId)) throw NOT_FOUND();
    const { row } = await visibleShare(request, env, rawId);
    return { kind, id: row.id, ownerId: row.user_id };
  }
  if (kind === 'comment') {
    const { comment } = await visibleComment(request, env, rawId);
    return { kind, id: comment.id, ownerId: comment.user_id };
  }
  if (kind === 'photo') {
    // Gleiche Prüfung wie beim Ansehen: Törn sichtbar (+Schlüssel), Foto „wie der Törn“, nicht ausgeblendet.
    const { row } = await visiblePhoto(request, env, rawId);
    return { kind, id: row.id, ownerId: row.owner_id };
  }
  const key = requestKey(request);
  const user = await currentUser(request, env);
  const admin = isAdmin(env, user?.id);
  if (kind === 'group' || kind === 'post') {
    // Gruppe bzw. Beitrag: sichtbar wie die Gruppe (Konzept 11.1); Verwalter melden ihre eigene Gruppe nicht.
    const post =
      kind === 'post' && SHARE_ID_RE.test(rawId)
        ? await env.DB.prepare('SELECT id, author_id, group_id, hidden_at FROM posts WHERE id = ?').bind(rawId).first<{ id: string; author_id: string; group_id: string | null; hidden_at: number | null }>()
        : null;
    const g = kind === 'group' ? await loadGroup(env, rawId) : post?.group_id ? await loadGroup(env, post.group_id) : null;
    const role = g ? await roleIn(env, user?.id, g.id) : null;
    if (!g || !canViewGroup(g, role, key, admin) || (post?.hidden_at && post.author_id !== user?.id && !canManageGroup(role) && !admin) || (kind === 'post' && !post)) {
      await countKeyFailure(env, request, key);
      throw NOT_FOUND();
    }
    if (post) return { kind, id: post.id, ownerId: post.author_id };
    return { kind, id: g.id, ownerId: canManageGroup(role) ? (user?.id ?? g.owner_id) : g.owner_id };
  }
  if (kind === 'harbor') {
    // Häfen sind öffentlich; ausgeblendete nur für die Moderation (Konzept 12.2). Anleger:in = „Eigentümer“.
    const h = await loadHarbor(env, rawId);
    if (!harborVisible(h, admin)) throw NOT_FOUND();
    return { kind, id: h.id, ownerId: h.created_by ?? '' };
  }
  if (kind === 'profile') {
    const handle = normalizeHandle(rawId);
    const p = handle
      ? await env.DB.prepare('SELECT user_id, visibility, share_key, hidden_at FROM profiles WHERE handle = ?')
          .bind(handle)
          .first<{ user_id: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>()
      : null;
    if (!p || !canView({ visibility: p.visibility, shareKey: p.share_key, hiddenAt: p.hidden_at }, { manager: user?.id === p.user_id, key, admin })) {
      await countKeyFailure(env, request, key);
      throw NOT_FOUND();
    }
    return { kind, id: p.user_id, ownerId: p.user_id };
  }
  const b = BOAT_ID_RE.test(rawId)
    ? await env.DB.prepare('SELECT id, owner_id, visibility, share_key, hidden_at FROM boats WHERE id = ?')
        .bind(rawId)
        .first<{ id: string; owner_id: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>()
    : null;
  const role = b && user ? await roleFor(env, user.id, b.id) : null;
  if (!b || !canView({ visibility: b.visibility, shareKey: b.share_key, hiddenAt: b.hidden_at }, { manager: !!role, key, admin })) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  // Admins eines Boots melden „ihr“ Boot nicht – sie können es bearbeiten.
  return { kind, id: b.id, ownerId: role ? (user?.id ?? b.owner_id) : b.owner_id };
}

const hideTarget = (env: Env, kind: ReportKind, id: string, now: number) =>
  env.DB.prepare(`UPDATE ${TABLE[kind].table} SET hidden_at = COALESCE(hidden_at, ?) WHERE ${TABLE[kind].idCol} = ?`).bind(now, id);

/**
 * POST /api/reports – `{ kind, id, reason, note }`; angemeldet und nicht gesperrt. `id` ist bei Profilen der
 * Profilname, sonst die ID; für „Nur mit Link“ gehört der Schlüssel als X-Share-Key dazu. Doppelte Meldungen
 * desselben Kontos zählen einmal (`already: true`).
 */
export async function createReport(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const body = await readJson<{ kind?: unknown; id?: unknown; reason?: unknown; note?: unknown }>(request);
  const kind = parseReportKind(body.kind);
  if (!kind) throw new HttpError(400, 'invalid_report', 'Das lässt sich nicht melden.');
  const reason = parseReportReason(body.reason);
  if (!reason) throw new HttpError(400, 'invalid_reason', 'Bitte einen Grund wählen.');
  const note = cleanText(body.note, REPORT_NOTE_MAX);
  const target = await resolveTarget(request, env, kind, body.id);
  if (target.ownerId === user.id) throw new HttpError(400, 'own_object', 'Eigene Inhalte kannst du bearbeiten oder löschen statt sie zu melden.');

  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?').bind(user.id, now - DAY).first<{ n: number }>();
  if ((recent?.n ?? 0) >= REPORT_LIMITS.perUserPerDay) throw new HttpError(429, 'report_quota', 'Du hast heute schon sehr viele Meldungen geschickt – bitte morgen weiter.');

  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO reports (id, target_kind, target_id, reporter_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(randomId(), kind, target.id, user.id, reason, note, now)
    .run();
  const already = !res.meta.changes;
  if (!already) {
    // „Ich bin abgebildet“ sofort, sonst ab 3 verschiedenen Konten mit offener Meldung – bis zur Prüfung.
    const open = await env.DB.prepare(
      'SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL',
    )
      .bind(kind, target.id)
      .first<{ n: number }>();
    if (reason === 'depicted' || (open?.n ?? 0) >= REPORT_LIMITS.autoHideReporters) await hideTarget(env, kind, target.id, now).run();
  }
  return json({ ok: true, already }, { status: already ? 200 : 201 });
}

/** GET /api/reports/info – öffentliche Angaben für den Melden-Dialog (Kontaktadresse für Meldungen ohne Konto). */
export async function reportInfo(_request: Request, env: Env): Promise<Response> {
  const contact = (env.REPORT_CONTACT ?? '').trim().slice(0, LIMITS.emailLength) || null;
  return json({ contact, reasons: REPORT_REASONS }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

// ---------------------------------------------------------------- Admin

/** Admin oder 404 – Nicht-Admins erfahren nicht, dass es die Route gibt (fail closed bei leerem ADMIN_USER_IDS). */
async function requireAdmin(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (!isAdmin(env, user.id)) throw new HttpError(404, 'not_found');
  return user;
}

interface Group {
  target_kind: ReportKind;
  target_id: string;
  id: string;
  n: number;
  reporters: number;
  first_at: number;
  last_at: number;
  reasons: string;
}

/** Vorschau eines gemeldeten Ziels für die Admin-Liste; null = gibt es nicht mehr. */
async function preview(env: Env, kind: ReportKind, id: string) {
  const owner = async (userId: string) => {
    const u = await env.DB.prepare('SELECT u.suspended_at, p.display_name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?')
      .bind(userId)
      .first<{ suspended_at: number | null; display_name: string | null }>();
    return { id: userId, displayName: u?.display_name || funnyName(userId), suspended: !!u?.suspended_at };
  };
  if (kind === 'share') {
    const s = await env.DB.prepare('SELECT id, user_id, title, summary, visibility, share_key, hidden_at FROM shares WHERE id = ?')
      .bind(id)
      .first<{ id: string; user_id: string; title: string; summary: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>();
    return s && { title: s.title, text: s.summary, path: sharePath('s', s.id, s.visibility, s.share_key), visibility: s.visibility, hiddenAt: s.hidden_at, owner: await owner(s.user_id) };
  }
  if (kind === 'comment') {
    const c = await env.DB.prepare(
      'SELECT c.id, c.user_id, c.body, c.hidden_at, s.id AS share_id, s.title, s.visibility, s.share_key FROM comments c JOIN shares s ON s.id = c.share_id WHERE c.id = ?',
    )
      .bind(id)
      .first<{ id: string; user_id: string; body: string; hidden_at: number | null; share_id: string; title: string; visibility: Visibility; share_key: string | null }>();
    return c && { title: `Kommentar zu „${c.title}“`, text: c.body, path: sharePath('s', c.share_id, c.visibility, c.share_key), visibility: c.visibility, hiddenAt: c.hidden_at, owner: await owner(c.user_id) };
  }
  if (kind === 'photo') {
    const f = await env.DB.prepare(
      'SELECT p.id, p.user_id, p.caption, p.hidden_at, s.id AS share_id, s.title, s.visibility, s.share_key FROM photos p JOIN shares s ON s.id = p.share_id WHERE p.id = ?',
    )
      .bind(id)
      .first<{ id: string; user_id: string; caption: string; hidden_at: number | null; share_id: string; title: string; visibility: Visibility; share_key: string | null }>();
    // imagePath: Vorschaubild für Admins (sie sehen auch ausgeblendete Fotos)
    return (
      f && {
        title: `Foto zu „${f.title}“`,
        text: f.caption,
        path: sharePath('s', f.share_id, f.visibility, f.share_key),
        imagePath: `/api/photos/${f.id}?s=t`,
        visibility: f.visibility,
        hiddenAt: f.hidden_at,
        owner: await owner(f.user_id),
      }
    );
  }
  if (kind === 'profile') {
    const p = await env.DB.prepare('SELECT user_id, handle, display_name, bio, visibility, share_key, hidden_at FROM profiles WHERE user_id = ?')
      .bind(id)
      .first<{ user_id: string; handle: string; display_name: string; bio: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>();
    return p && { title: `Profil ${p.display_name} (/u/${p.handle})`, text: p.bio, path: sharePath('u', p.handle, p.visibility, p.share_key), visibility: p.visibility, hiddenAt: p.hidden_at, owner: await owner(p.user_id) };
  }
  if (kind === 'group') {
    const g = await env.DB.prepare('SELECT id, owner_id, slug, name, description, visibility, share_key, hidden_at FROM groups WHERE id = ?')
      .bind(id)
      .first<{ id: string; owner_id: string; slug: string; name: string; description: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>();
    return g && { title: `Gruppe ${g.name} (/g/${g.slug})`, text: g.description, path: sharePath('g', g.slug, g.visibility, g.share_key), visibility: g.visibility, hiddenAt: g.hidden_at, owner: await owner(g.owner_id) };
  }
  if (kind === 'post') {
    const p = await env.DB.prepare(
      'SELECT p.id, p.author_id, p.body, p.hidden_at, g.slug, g.name, g.visibility, g.share_key FROM posts p JOIN groups g ON g.id = p.group_id WHERE p.id = ?',
    )
      .bind(id)
      .first<{ id: string; author_id: string; body: string; hidden_at: number | null; slug: string; name: string; visibility: Visibility; share_key: string | null }>();
    return p && { title: `Beitrag in „${p.name}“`, text: p.body, path: sharePath('g', p.slug, p.visibility, p.share_key), visibility: p.visibility, hiddenAt: p.hidden_at, owner: await owner(p.author_id) };
  }
  if (kind === 'harbor') {
    const h = await env.DB.prepare('SELECT id, slug, name, created_by, hidden_at FROM harbors WHERE id = ?')
      .bind(id)
      .first<{ id: string; slug: string; name: string; created_by: string | null; hidden_at: number | null }>();
    return h && { title: `Hafen ${h.name} (/h/${h.slug})`, text: '', path: `/h/${h.slug}`, visibility: 'public' as Visibility, hiddenAt: h.hidden_at, owner: await owner(h.created_by ?? '') };
  }
  const b = await env.DB.prepare('SELECT id, owner_id, name, description, visibility, share_key, hidden_at FROM boats WHERE id = ?')
    .bind(id)
    .first<{ id: string; owner_id: string; name: string; description: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>();
  return b && { title: `Boot ${b.name}`, text: b.description, path: sharePath('b', b.id, b.visibility, b.share_key), visibility: b.visibility, hiddenAt: b.hidden_at, owner: await owner(b.owner_id) };
}

/**
 * GET /api/admin/reports – offene Meldungen, je Ziel zusammengefasst: Gründe mit Anzahl, Anmerkungen (ohne
 * Meldende), Vorschau, Link (bei „Nur mit Link“ mit Schlüssel) und Eigentümer (für „Konto sperren“).
 */
export async function listReports(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const { results: groups } = await env.DB.prepare(
    `SELECT target_kind, target_id, MIN(id) AS id, COUNT(*) AS n, COUNT(DISTINCT reporter_id) AS reporters,
       MIN(created_at) AS first_at, MAX(created_at) AS last_at, GROUP_CONCAT(reason) AS reasons
     FROM reports WHERE resolved_at IS NULL GROUP BY target_kind, target_id ORDER BY first_at LIMIT ?`,
  )
    .bind(REPORT_LIMITS.adminList)
    .all<Group>();
  const out = [];
  for (const g of groups) {
    const kind = parseReportKind(g.target_kind);
    if (!kind) continue;
    const { results: notes } = await env.DB.prepare(
      `SELECT reason, note, created_at FROM reports WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL AND note <> '' ORDER BY created_at LIMIT 20`,
    )
      .bind(kind, g.target_id)
      .all<{ reason: string; note: string; created_at: number }>();
    const reasons: Record<string, number> = {};
    for (const r of (g.reasons ?? '').split(',').filter(Boolean)) reasons[r] = (reasons[r] ?? 0) + 1;
    out.push({
      id: g.id,
      kind,
      targetId: g.target_id,
      count: g.n,
      reporters: g.reporters,
      firstAt: g.first_at,
      lastAt: g.last_at,
      reasons,
      notes: notes.map((n) => ({ reason: n.reason, note: n.note, createdAt: n.created_at })),
      target: await preview(env, kind, g.target_id),
    });
  }
  return json({ reports: out });
}

/** Löscht ein gemeldetes Ziel (wie die jeweiligen Lösch-Wege der Eigentümer). */
async function deleteTarget(env: Env, kind: ReportKind, id: string): Promise<void> {
  if (kind === 'share') return removeShare(env, id);
  if (kind === 'comment') return removeComment(env, id);
  if (kind === 'photo') return removePhotoById(env, id);
  if (kind === 'group') return removeGroup(env, id);
  if (kind === 'post') return removePost(env, id);
  if (kind === 'harbor') return removeHarbor(env, id);
  if (kind === 'profile') {
    // Nur das Profil samt Titelbild: Konto, Törns und Boote bleiben (der Autor erscheint dann ohne Namen). Das Bild
    // geht sofort – sonst käme es mit einem neu angelegten Profil zurück.
    await removeCoverOf(env, 'u', id);
    await env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(id).run();
    return;
  }
  return removeBoat(env, id);
}

/**
 * POST /api/admin/reports/:id – `{ action: 'keep' | 'hide' | 'delete' }` entscheidet über alle offenen Meldungen
 * zum selben Ziel. keep: wieder einblenden; hide: ausgeblendet lassen; delete: Ziel löschen (die Meldungen fallen
 * mit). Entschiedene Meldungen behalten weder Meldende noch Anmerkung.
 */
export async function decideReport(request: Request, env: Env, reportId: string): Promise<Response> {
  await requireAdmin(request, env);
  const { action } = await readJson<{ action?: unknown }>(request);
  if (action !== 'keep' && action !== 'hide' && action !== 'delete') throw new HttpError(400, 'invalid_action', 'Unbekannte Entscheidung.');
  const r = SHARE_ID_RE.test(reportId)
    ? await env.DB.prepare('SELECT target_kind, target_id FROM reports WHERE id = ?').bind(reportId).first<{ target_kind: string; target_id: string }>()
    : null;
  const kind = parseReportKind(r?.target_kind);
  if (!r || !kind) throw new HttpError(404, 'not_found', 'Diese Meldung gibt es nicht (mehr).');
  const now = Date.now();
  const { table, idCol } = TABLE[kind];
  const resolve = env.DB.prepare(
    `UPDATE reports SET resolved_at = ?, resolution = ?, reporter_id = NULL, note = '' WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL`,
  ).bind(now, action === 'keep' ? 'kept' : action === 'hide' ? 'hidden' : 'deleted', kind, r.target_id);
  if (action === 'delete') {
    await resolve.run();
    await deleteTarget(env, kind, r.target_id);
    // Meldungen zu einem gelöschten Ziel braucht es nicht mehr.
    await env.DB.prepare('DELETE FROM reports WHERE target_kind = ? AND target_id = ?').bind(kind, r.target_id).run();
  } else {
    await env.DB.batch([
      action === 'keep'
        ? env.DB.prepare(`UPDATE ${table} SET hidden_at = NULL WHERE ${idCol} = ?`).bind(r.target_id)
        : hideTarget(env, kind, r.target_id, now),
      resolve,
    ]);
  }
  return json({ ok: true });
}

/**
 * POST /api/admin/users/:id/suspend – `{ suspended: boolean }`. Gesperrte Konten können nichts mehr hochladen,
 * kommentieren, melden oder einladen; ihre Inhalte verschwinden aus /entdecken. Ansehen, Löschen und Abmelden geht
 * weiter. Admins können sich nicht selbst und keine anderen Admins sperren.
 */
export async function suspendUser(request: Request, env: Env, userId: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { suspended } = await readJson<{ suspended?: unknown }>(request);
  if (typeof suspended !== 'boolean') throw new HttpError(400, 'invalid_body', 'suspended: true oder false.');
  if (userId === admin.id || isAdmin(env, userId)) throw new HttpError(400, 'cannot_suspend_admin', 'Admin-Konten lassen sich nicht sperren.');
  const res = await env.DB.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(suspended ? Date.now() : null, userId).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Dieses Konto gibt es nicht (mehr).');
  return json({ suspended });
}
