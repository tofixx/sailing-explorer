// Admin-Bereich (Konzept 18, F-230 … F-242): Übersicht über alle Objekte, Details, Sperren, Umbenennen, Eigner neu
// zuweisen, endgültig löschen, Protokoll. Jede Route prüft requireAdmin (404 für alle anderen); jede Aktion und jeder
// Einblick landet im Admin-Protokoll. Zusammenführen steht in worker/admin-merge.ts.
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { LOCKED, adminLogStmt, isAdmin, ownsLockedSql, requireAdmin } from './moderation';
import { loadLock, lockTarget, releaseViaLockStmts, removeTarget, targetExists, unlockTarget } from './locks';
import { LIMITS, SHARE_ID_RE, cleanText, normalizeHandle } from './validate';
import { HARBOR_LIMITS, harborKey } from '../src/domain/harbors';
import { normalizeSlug } from '../src/domain/groups';
import { funnyName } from '../src/domain/names';
import { extendSupport } from '../src/domain/support';
import { randomId } from './crypto';
import { sharePath, type Visibility } from '../src/domain/visibility';
import {
  ADMIN_LIMITS, LOCK_KIND, isAdminKind, parseAdminFilter, parsePage,
  type AdminFilter, type AdminKind, type LockKind,
} from '../src/domain/admin';

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Das gibt es nicht (mehr).');

/** Gemeinsame Zeile der Übersicht – jede Art liefert diese Spalten (SQL je Art in SPEC). */
interface Row {
  id: string;
  name: string;
  sub: string | null;
  visibility: Visibility | null;
  share_key: string | null;
  created_at: number;
  hidden_at: number | null;
  suspended_at: number | null;
  owner_id: string | null;
  owner_handle: string | null;
  owner_name: string | null;
  slug: string | null;
  lock_until: number | null;
  lock_reason: string | null;
  lock_via: string | null;
  lock_at: number | null;
  n1: number;
  n2: number;
}

interface Spec {
  /** SELECT … FROM … (mit Alias `x` für das Objekt und `l` für die Sperre) */
  from: string;
  /** Suchbedingung, ?1 = exakter Begriff, ?2 = LIKE-Muster */
  search: string;
  filters: Partial<Record<AdminFilter, string>>;
  /** Namen der Zahlen n1, n2 */
  counts: [string, string];
  /** Pfad der öffentlichen Seite */
  path: (r: Row) => string;
}

const lockJoin = (kind: LockKind) => `LEFT JOIN locks l ON l.target_kind = '${kind}' AND l.target_id = x.id`;
const LOCK_COLS = 'l.until AS lock_until, l.reason AS lock_reason, l.via_user AS lock_via, l.locked_at AS lock_at';
const OWNER_COLS = (col: string) => `${col} AS owner_id, op.handle AS owner_handle, op.display_name AS owner_name`;
const OWNER_JOIN = (col: string) => `LEFT JOIN profiles op ON op.user_id = ${col}`;
const OWNER_LOCKED = (col: string) => `EXISTS (SELECT 1 FROM users ou WHERE ou.id = ${col} AND ou.locked_at IS NOT NULL)`;

const SPEC: Record<AdminKind, Spec> = {
  users: {
    from: `SELECT x.id, COALESCE(p.display_name, '') AS name, x.email AS sub, p.visibility, p.share_key, x.created_at, p.hidden_at,
        x.suspended_at, NULL AS owner_id, NULL AS owner_handle, NULL AS owner_name, p.handle AS slug, ${LOCK_COLS},
        (SELECT COUNT(*) FROM shares WHERE user_id = x.id) AS n1, (SELECT COUNT(*) FROM boats WHERE owner_id = x.id) AS n2
      FROM users x LEFT JOIN profiles p ON p.user_id = x.id ${lockJoin('user')}`,
    search: `x.id = ?1 OR x.email LIKE ?2 ESCAPE '\\' OR p.handle LIKE ?2 ESCAPE '\\' OR p.display_name LIKE ?2 ESCAPE '\\'`,
    filters: {
      locked: 'x.locked_at IS NOT NULL',
      hidden: 'p.hidden_at IS NOT NULL AND x.locked_at IS NULL',
      suspended: 'x.suspended_at IS NOT NULL AND x.locked_at IS NULL',
      private: "p.visibility <> 'public'",
    },
    counts: ['Törns', 'Boote'],
    path: (r) => (r.slug ? sharePath('u', r.slug, r.visibility ?? 'public', r.share_key) : ''),
  },
  boats: {
    from: `SELECT x.id, x.name, x.home_port AS sub, x.visibility, x.share_key, x.created_at, x.hidden_at, NULL AS suspended_at,
        ${OWNER_COLS('x.owner_id')}, NULL AS slug, ${LOCK_COLS},
        (SELECT COUNT(*) FROM shares WHERE boat_id = x.id) AS n1, (SELECT COUNT(*) FROM boat_admins WHERE boat_id = x.id) AS n2
      FROM boats x ${OWNER_JOIN('x.owner_id')} ${lockJoin('boat')}`,
    search: `x.id = ?1 OR x.owner_id = ?1 OR x.name LIKE ?2 ESCAPE '\\' OR op.handle LIKE ?2 ESCAPE '\\'`,
    filters: {
      locked: 'x.locked_at IS NOT NULL',
      hidden: 'x.hidden_at IS NOT NULL AND x.locked_at IS NULL',
      private: "x.visibility <> 'public'",
      ownerless: OWNER_LOCKED('x.owner_id'),
    },
    counts: ['Törns', 'Boots-Admins'],
    path: (r) => sharePath('b', r.id, r.visibility ?? 'public', r.share_key),
  },
  groups: {
    from: `SELECT x.id, x.name, x.kind AS sub, x.visibility, x.share_key, x.created_at, x.hidden_at, NULL AS suspended_at,
        ${OWNER_COLS('x.owner_id')}, x.slug, ${LOCK_COLS},
        (SELECT COUNT(*) FROM group_members WHERE group_id = x.id) AS n1, (SELECT COUNT(*) FROM group_boats WHERE group_id = x.id) AS n2
      FROM groups x ${OWNER_JOIN('x.owner_id')} ${lockJoin('group')}`,
    search: `x.id = ?1 OR x.owner_id = ?1 OR x.name LIKE ?2 ESCAPE '\\' OR x.slug LIKE ?2 ESCAPE '\\'`,
    filters: {
      locked: 'x.locked_at IS NOT NULL',
      hidden: 'x.hidden_at IS NOT NULL AND x.locked_at IS NULL',
      private: "x.visibility <> 'public'",
      ownerless: `(NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = x.id AND m.user_id = x.owner_id AND m.role = 'owner') OR ${OWNER_LOCKED('x.owner_id')})`,
    },
    counts: ['Mitglieder', 'Boote'],
    path: (r) => sharePath('g', r.slug ?? '', r.visibility ?? 'public', r.share_key),
  },
  harbors: {
    from: `SELECT x.id, x.name, '' AS sub, 'public' AS visibility, NULL AS share_key, x.created_at, x.hidden_at, NULL AS suspended_at,
        ${OWNER_COLS('x.created_by')}, x.slug, ${LOCK_COLS},
        (SELECT COUNT(*) FROM boats WHERE harbor_id = x.id) AS n1, (SELECT COUNT(*) FROM groups WHERE harbor_id = x.id) AS n2
      FROM harbors x ${OWNER_JOIN('x.created_by')} ${lockJoin('harbor')}`,
    search: `x.id = ?1 OR x.name LIKE ?2 ESCAPE '\\' OR x.slug LIKE ?2 ESCAPE '\\'`,
    filters: {
      locked: 'l.target_id IS NOT NULL',
      hidden: 'x.hidden_at IS NOT NULL AND l.target_id IS NULL',
      ownerless: 'NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.created_by)',
    },
    counts: ['Boote', 'Gruppen'],
    path: (r) => `/h/${r.slug}`,
  },
  shares: {
    from: `SELECT x.id, x.title AS name, ROUND(x.dist_nm, 1) || ' sm' AS sub, x.visibility, x.share_key, x.created_at, x.hidden_at,
        NULL AS suspended_at, ${OWNER_COLS('x.user_id')}, NULL AS slug, ${LOCK_COLS},
        (SELECT COUNT(*) FROM photos WHERE share_id = x.id) AS n1, (SELECT COUNT(*) FROM comments WHERE share_id = x.id) AS n2
      FROM shares x ${OWNER_JOIN('x.user_id')} ${lockJoin('share')}`,
    search: `x.id = ?1 OR x.user_id = ?1 OR x.title LIKE ?2 ESCAPE '\\' OR op.handle LIKE ?2 ESCAPE '\\'`,
    filters: {
      locked: 'x.locked_at IS NOT NULL',
      hidden: 'x.hidden_at IS NOT NULL AND x.locked_at IS NULL',
      private: "x.visibility <> 'public'",
    },
    counts: ['Fotos', 'Kommentare'],
    path: (r) => sharePath('s', r.id, r.visibility ?? 'public', r.share_key),
  },
};

function itemShape(kind: AdminKind, r: Row) {
  return {
    id: r.id,
    name: r.name || (kind === 'users' ? funnyName(r.id) : ''),
    /** Konten: Mail-Adresse (nur Admins), Boote: Hafen, Gruppen: Art, Törns: Strecke */
    sub: r.sub ?? '',
    visibility: r.visibility,
    createdAt: r.created_at,
    path: SPEC[kind].path(r) || null,
    handle: kind === 'users' ? r.slug : null,
    owner: r.owner_id ? { id: r.owner_id, handle: r.owner_handle, displayName: r.owner_name || funnyName(r.owner_id) } : null,
    lock: r.lock_until ? { until: r.lock_until, reason: r.lock_reason ?? '', since: r.lock_at, viaUser: r.lock_via } : null,
    hidden: !!r.hidden_at,
    suspended: !!r.suspended_at,
    counts: { [SPEC[kind].counts[0]]: r.n1, [SPEC[kind].counts[1]]: r.n2 },
  };
}

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function parseKind(raw: string): AdminKind {
  if (!isAdminKind(raw)) throw new HttpError(400, 'invalid_kind', 'Unbekannte Art.');
  return raw;
}

/** GET /api/admin/list/:art?q=&filter=&page= – alle Objekte einer Art, auch nicht öffentliche (F-231). */
export async function adminList(request: Request, env: Env, rawKind: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const kind = parseKind(rawKind);
  const params = new URL(request.url).searchParams;
  const filter = parseAdminFilter(kind, params.get('filter'));
  if (!filter) throw new HttpError(400, 'invalid_filter', 'Unbekannter Filter.');
  const q = cleanText(params.get('q') ?? '', ADMIN_LIMITS.queryMax);
  const page = parsePage(params.get('page'));
  const spec = SPEC[kind];
  const where = [q ? `(${spec.search})` : '1', filter === 'all' ? '1' : spec.filters[filter]!].join(' AND ');
  const { results } = await env.DB.prepare(`${spec.from} WHERE ${where} ORDER BY x.created_at DESC, x.id LIMIT ?3 OFFSET ?4`)
    .bind(q, likePattern(q), ADMIN_LIMITS.page + 1, (page - 1) * ADMIN_LIMITS.page)
    .all<Row>();
  // Suchbegriffe ins Protokoll – Mail-Adressen nicht (Konzept 18.10)
  const searched = q && (q.includes('@') ? 'Suche nach Mail-Adresse' : `Suche „${q}“`);
  await adminLogStmt(env, admin.id, 'list', LOCK_KIND[kind], null, [filter !== 'all' && `Filter ${filter}`, searched, page > 1 && `Seite ${page}`].filter(Boolean).join(', ')).run();
  return json({
    items: results.slice(0, ADMIN_LIMITS.page).map((r) => itemShape(kind, r)),
    page,
    more: results.length > ADMIN_LIMITS.page,
  });
}

async function loadRow(env: Env, kind: AdminKind, id: string): Promise<Row | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  return env.DB.prepare(`${SPEC[kind].from} WHERE x.id = ?`).bind(id).first<Row>();
}

/** Weitere Angaben für die Detailansicht – nur Zahlen und Zeiten, keine Inhalte. */
async function extra(env: Env, kind: AdminKind, id: string): Promise<Record<string, number | string | null>> {
  const q = (sql: string) => env.DB.prepare(sql).bind(id).first<Record<string, number | string | null>>();
  if (kind === 'users') {
    return (await q(
      `SELECT last_login AS lastLogin, (SELECT COUNT(*) FROM sessions WHERE user_id = ?1) AS sessions,
         (SELECT COUNT(*) FROM passkeys WHERE user_id = ?1) AS passkeys, (SELECT COUNT(*) FROM group_members WHERE user_id = ?1) AS groups,
         (SELECT COUNT(*) FROM comments WHERE user_id = ?1) AS comments, (SELECT COUNT(*) FROM photos WHERE user_id = ?1) AS photos,
         (SELECT MAX(valid_until) FROM supports WHERE user_id = ?1) AS supporterUntil
       FROM users WHERE id = ?1`,
    )) ?? {};
  }
  if (kind === 'shares') {
    return (await q(`SELECT started_at AS startedAt, size_bytes + image_bytes AS bytes, (SELECT name FROM boats WHERE id = shares.boat_id) AS boat FROM shares WHERE id = ?1`)) ?? {};
  }
  if (kind === 'harbors') {
    return (await q(`SELECT lat, lon, (SELECT COUNT(*) FROM users WHERE home_harbor_id = ?1) AS homeOf, (SELECT name FROM groups WHERE id = harbors.club_id) AS club,
      (SELECT COUNT(*) FROM harbor_redirects WHERE harbor_id = ?1) AS redirects FROM harbors WHERE id = ?1`)) ?? {};
  }
  return {};
}

/** GET /api/admin/:art/:id – Details mit Sperre und den letzten Protokolleinträgen zum Ziel (F-232). */
export async function adminDetail(request: Request, env: Env, rawKind: string, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const kind = parseKind(rawKind);
  const row = await loadRow(env, kind, id);
  if (!row) throw NOT_FOUND();
  const lk = LOCK_KIND[kind];
  await adminLogStmt(env, admin.id, 'view', lk, id).run();
  const { results: log } = await env.DB.prepare(
    `SELECT id, admin_id, action, detail, created_at FROM admin_log WHERE target_kind = ? AND target_id = ? AND action NOT IN ('list', 'view') ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(lk, id)
    .all<{ id: string; admin_id: string | null; action: string; detail: string; created_at: number }>();
  return json({
    item: itemShape(kind, row),
    extra: await extra(env, kind, id),
    isAdmin: kind === 'users' && isAdmin(env, id),
    log: log.map((e) => ({ id: e.id, adminId: e.admin_id, action: e.action, detail: e.detail, createdAt: e.created_at })),
  });
}

/** Ziel einer Admin-Aktion: Art und ID prüfen, 404 wenn unbekannt. */
async function target(env: Env, rawKind: string, id: string): Promise<{ kind: AdminKind; lk: LockKind }> {
  const kind = parseKind(rawKind);
  const lk = LOCK_KIND[kind];
  if (!SHARE_ID_RE.test(id) || !(await targetExists(env, lk, id))) throw NOT_FOUND();
  return { kind, lk };
}

/** PUT /api/admin/:art/:id/lock { reason } – sperren bzw. verlängern (F-233, F-234). */
export async function adminLock(request: Request, env: Env, rawKind: string, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { lk } = await target(env, rawKind, id);
  const { reason: raw } = await readJson<{ reason?: unknown }>(request);
  const reason = cleanText(raw, ADMIN_LIMITS.reasonMax);
  if (!reason) throw new HttpError(400, 'reason_required', 'Bitte eine Begründung angeben (sie steht im Protokoll).');
  if (lk === 'user' && isAdmin(env, id)) throw new HttpError(400, 'cannot_lock_admin', 'Admin-Konten lassen sich nicht sperren.');
  const action = await lockTarget(env, admin.id, lk, id, reason);
  return json({ action, lock: await loadLock(env, lk, id) });
}

/** DELETE /api/admin/:art/:id/lock – entsperren (F-233). */
export async function adminUnlock(request: Request, env: Env, rawKind: string, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { lk } = await target(env, rawKind, id);
  await unlockTarget(env, admin.id, lk, id);
  return json({ ok: true });
}

async function assertUnlocked(env: Env, lk: LockKind, id: string): Promise<void> {
  if (await loadLock(env, lk, id)) throw LOCKED();
}

/** PATCH /api/admin/:art/:id – umbenennen (F-236). */
export async function adminRename(request: Request, env: Env, rawKind: string, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { kind, lk } = await target(env, rawKind, id);
  await assertUnlocked(env, lk, id);
  const input = await readJson<{ name?: unknown; displayName?: unknown; handle?: unknown; slug?: unknown }>(request);
  const now = Date.now();
  const log = (detail: string) => adminLogStmt(env, admin.id, 'rename', lk, id, detail, now);
  if (kind === 'users') {
    const p = await env.DB.prepare('SELECT handle, display_name FROM profiles WHERE user_id = ?').bind(id).first<{ handle: string; display_name: string }>();
    if (!p) throw new HttpError(409, 'no_profile', 'Dieses Konto hat kein Profil.');
    const handle = input.handle === undefined ? p.handle : normalizeHandle(input.handle);
    if (!handle) throw new HttpError(400, 'invalid_handle', 'Profilname: 3–30 Zeichen, nur a–z, 0–9 und Bindestrich.');
    const name = input.displayName === undefined ? p.display_name : cleanText(input.displayName, LIMITS.nameLength);
    if (!name) throw new HttpError(400, 'invalid_name', 'Bitte einen Anzeigenamen angeben.');
    const taken = await env.DB.prepare('SELECT user_id FROM profiles WHERE handle = ? AND user_id <> ?').bind(handle, id).first();
    if (taken) throw new HttpError(409, 'handle_taken', 'Dieser Profilname ist schon vergeben.');
    await env.DB.batch([
      env.DB.prepare('UPDATE profiles SET handle = ?, display_name = ?, updated_at = ? WHERE user_id = ?').bind(handle, name, now, id),
      log(`${p.display_name} (/u/${p.handle}) → ${name} (/u/${handle})`),
    ]);
  } else if (kind === 'boats' || kind === 'groups') {
    const table = kind === 'boats' ? 'boats' : 'groups';
    const cur = await env.DB.prepare(`SELECT name${kind === 'groups' ? ', slug' : ''} FROM ${table} WHERE id = ?`).bind(id).first<{ name: string; slug?: string }>();
    const name = input.name === undefined ? cur!.name : cleanText(input.name, LIMITS.nameLength);
    if (!name) throw new HttpError(400, 'invalid_name', 'Bitte einen Namen angeben.');
    let slug = cur!.slug;
    if (kind === 'groups' && input.slug !== undefined) {
      slug = normalizeSlug(input.slug) ?? undefined;
      if (!slug) throw new HttpError(400, 'invalid_slug', 'Adresse: 3–30 Zeichen, nur a–z, 0–9 und Bindestrich.');
      if (await env.DB.prepare('SELECT 1 AS x FROM groups WHERE slug = ? AND id <> ?').bind(slug, id).first()) throw new HttpError(409, 'slug_taken', 'Diese Adresse ist schon vergeben.');
    }
    await env.DB.batch([
      kind === 'groups'
        ? env.DB.prepare('UPDATE groups SET name = ?, slug = ?, updated_at = ? WHERE id = ?').bind(name, slug, now, id)
        : env.DB.prepare('UPDATE boats SET name = ?, updated_at = ? WHERE id = ?').bind(name, now, id),
      log(kind === 'groups' ? `${cur!.name} (/g/${cur!.slug}) → ${name} (/g/${slug})` : `${cur!.name} → ${name}`),
    ]);
  } else if (kind === 'harbors') {
    const cur = await env.DB.prepare('SELECT name FROM harbors WHERE id = ?').bind(id).first<{ name: string }>();
    const name = cleanText(input.name, HARBOR_LIMITS.nameMax);
    const key = harborKey(name);
    if (!key) throw new HttpError(400, 'invalid_name', 'Bitte einen Hafennamen angeben.');
    if (await env.DB.prepare('SELECT 1 AS x FROM harbors WHERE name_key = ? AND id <> ?').bind(key, id).first()) {
      throw new HttpError(409, 'harbor_exists', 'Einen Hafen mit diesem Namen gibt es schon – Dubletten bitte zusammenführen.');
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE harbors SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').bind(name, key, now, id),
      // Anzeige-Kopien wie beim normalen Bearbeiten (worker/harbors.ts)
      env.DB.prepare('UPDATE boats SET home_port = ? WHERE harbor_id = ?').bind(name, id),
      env.DB.prepare('UPDATE groups SET home_port = ? WHERE harbor_id = ?').bind(name, id),
      log(`${cur!.name} → ${name}`),
    ]);
  } else {
    throw new HttpError(400, 'not_supported', 'Törns benennt nur, wer sie geteilt hat.');
  }
  return json({ item: itemShape(kind, (await loadRow(env, kind, id))!) });
}

/** Konto, das Eigner werden kann: vorhanden und nicht gesperrt. */
async function activeUser(env: Env, userId: unknown): Promise<string> {
  const ok = typeof userId === 'string' && SHARE_ID_RE.test(userId)
    ? await env.DB.prepare('SELECT id FROM users WHERE id = ? AND locked_at IS NULL').bind(userId).first<{ id: string }>()
    : null;
  if (!ok) throw new HttpError(400, 'invalid_user', 'Dieses Konto gibt es nicht oder es ist gesperrt.');
  return ok.id;
}

/**
 * POST /api/admin/:art/:id/owner { userId } – Eigner neu zuweisen (F-237): Boote (altes Konto bleibt Boots-Admin),
 * Gruppen (neues Konto wird Eigner-Mitglied, das alte Admin), Häfen (Anleger:in). Törns nicht (Konzept 18.6).
 */
export async function adminOwner(request: Request, env: Env, rawKind: string, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { kind, lk } = await target(env, rawKind, id);
  if (kind !== 'boats' && kind !== 'groups' && kind !== 'harbors') {
    throw new HttpError(400, 'not_supported', 'Törns und Konten haben keinen übertragbaren Eigner.');
  }
  // Ein nur mit dem gesperrten Eigner-Konto mitgesperrtes Boot darf an ein anderes Konto gehen (dann ohne Sperre)
  const lock = await loadLock(env, lk, id);
  const viaOwner = kind === 'boats' && !!lock?.via_user;
  if (lock && !viaOwner) throw LOCKED();
  const { userId } = await readJson<{ userId?: unknown }>(request);
  const to = await activeUser(env, userId);
  const now = Date.now();
  const col = kind === 'harbors' ? 'created_by' : 'owner_id';
  const before = (await env.DB.prepare(`SELECT ${col} AS o FROM ${kind} WHERE id = ?`).bind(id).first<{ o: string | null }>())?.o ?? null;
  if (before === to) throw new HttpError(400, 'same_owner', 'Das Konto ist schon Eigner.');
  const log = adminLogStmt(env, admin.id, 'owner', lk, id, `${before ?? '–'} → ${to}`, now);
  if (kind === 'boats') {
    await env.DB.batch([
      env.DB.prepare('UPDATE boats SET owner_id = ?, updated_at = ? WHERE id = ?').bind(to, now, id),
      env.DB.prepare('DELETE FROM boat_admins WHERE boat_id = ? AND user_id = ?').bind(id, to),
      env.DB.prepare('INSERT OR IGNORE INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(id, before, now),
      ...(viaOwner ? releaseViaLockStmts(env, 'boat', id) : []),
      log,
    ]);
  } else if (kind === 'groups') {
    await env.DB.batch([
      env.DB.prepare(`UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?`).bind(id, before),
      env.DB.prepare(
        `INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)
         ON CONFLICT(group_id, user_id) DO UPDATE SET role = 'owner'`,
      ).bind(id, to, now),
      env.DB.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').bind(id, to),
      env.DB.prepare('UPDATE groups SET owner_id = ?, updated_at = ? WHERE id = ?').bind(to, now, id),
      log,
    ]);
  } else {
    await env.DB.batch([env.DB.prepare('UPDATE harbors SET created_by = ?, updated_at = ? WHERE id = ?').bind(to, now, id), log]);
  }
  return json({ item: itemShape(kind, (await loadRow(env, kind, id))!) });
}

/** DELETE /api/admin/:art/:id { confirm } – endgültig löschen über den Löschpfad des Objekts, auch gesperrt (F-241). */
export async function adminDelete(request: Request, env: Env, rawKind: string, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { kind, lk } = await target(env, rawKind, id);
  const { confirm } = await readJson<{ confirm?: unknown }>(request);
  if (confirm !== id) throw new HttpError(400, 'confirm_required', 'Zur Bestätigung bitte die ID eingeben.');
  if (lk === 'user' && isAdmin(env, id)) throw new HttpError(400, 'cannot_delete_admin', 'Admin-Konten lassen sich hier nicht löschen.');
  // Beweissicherung (Konzept 18.9): einzeln gesperrte Objekte des Kontos erst einzeln entscheiden
  if (lk === 'user' && (await env.DB.prepare(`SELECT 1 AS x WHERE ${ownsLockedSql('?1', true)}`).bind(id).first())) {
    throw new HttpError(409, 'locked_content', 'Das Konto besitzt einzeln gesperrte Törns, Boote oder Gruppen – diese zuerst entsperren oder löschen.');
  }
  const row = await loadRow(env, kind, id);
  // erst protokollieren: scheitert das Löschen halb, ist der Versuch trotzdem belegt
  await adminLogStmt(env, admin.id, 'delete', lk, id, row?.name ?? '').run();
  await removeTarget(env, lk, id);
  return new Response(null, { status: 204 });
}

/**
 * POST /api/admin/users/:id/support { seasons, note } – Unterstützer-Gutschein (Konzept 18.9a): 1 – 3 Saisons wie eine
 * Zahlung (an eine laufende Unterstützung angehängt), als Zeile in `supports` mit provider 'admin' und Betrag 0.
 */
export async function adminGrantSupport(request: Request, env: Env, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  await target(env, 'users', id);
  const body = await readJson<{ seasons?: unknown; note?: unknown }>(request);
  const seasons = body.seasons;
  if (typeof seasons !== 'number' || !Number.isInteger(seasons) || seasons < 1 || seasons > ADMIN_LIMITS.grantSeasonsMax) {
    throw new HttpError(400, 'invalid_seasons', `Bitte 1 bis ${ADMIN_LIMITS.grantSeasonsMax} Saisons wählen.`);
  }
  const note = cleanText(body.note, ADMIN_LIMITS.reasonMax);
  const now = Date.now();
  let until = (await env.DB.prepare('SELECT MAX(valid_until) AS u FROM supports WHERE user_id = ?').bind(id).first<{ u: number | null }>())?.u ?? null;
  for (let i = 0; i < seasons; i++) until = extendSupport(until, now);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until) VALUES (?, ?, 'admin', ?, 0, '', ?, ?)`,
    ).bind(randomId(), id, `admin:${randomId()}`, now, until),
    adminLogStmt(env, admin.id, 'grant_support', 'user', id, `${seasons} Saison(s) bis ${new Date(until!).toISOString().slice(0, 10)}${note ? ` – ${note}` : ''}`, now),
  ]);
  return json({ supporterUntil: until });
}

/** DELETE /api/admin/users/:id/support – alle Gutscheine des Kontos entziehen; bezahlte Unterstützung bleibt. */
export async function adminRevokeSupport(request: Request, env: Env, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  await target(env, 'users', id);
  if (!(await env.DB.prepare(`SELECT 1 AS x FROM supports WHERE user_id = ? AND provider = 'admin'`).bind(id).first())) {
    throw new HttpError(404, 'no_grant', 'Dieses Konto hat keinen Gutschein.');
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM supports WHERE user_id = ? AND provider = 'admin'`).bind(id),
    adminLogStmt(env, admin.id, 'revoke_support', 'user', id),
  ]);
  const u = await env.DB.prepare('SELECT MAX(valid_until) AS u FROM supports WHERE user_id = ?').bind(id).first<{ u: number | null }>();
  return json({ supporterUntil: u?.u ?? null });
}

/** GET /api/admin/log?q=&page= – Protokoll, neueste zuerst; q = Ziel-ID, Admin-ID oder Aktion (F-242). */
export async function adminLogList(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const params = new URL(request.url).searchParams;
  const q = cleanText(params.get('q') ?? '', ADMIN_LIMITS.queryMax);
  const page = parsePage(params.get('page'));
  const { results } = await env.DB.prepare(
    `SELECT id, admin_id, action, target_kind, target_id, detail, created_at FROM admin_log
     WHERE ?1 = '' OR target_id = ?1 OR admin_id = ?1 OR action = ?1
     ORDER BY created_at DESC, id LIMIT ?2 OFFSET ?3`,
  )
    .bind(q, ADMIN_LIMITS.page + 1, (page - 1) * ADMIN_LIMITS.page)
    .all<{ id: string; admin_id: string | null; action: string; target_kind: string | null; target_id: string | null; detail: string; created_at: number }>();
  return json({
    entries: results.slice(0, ADMIN_LIMITS.page).map((e) => ({
      id: e.id, adminId: e.admin_id, action: e.action, targetKind: e.target_kind, targetId: e.target_id, detail: e.detail, createdAt: e.created_at,
    })),
    page,
    more: results.length > ADMIN_LIMITS.page,
  });
}

