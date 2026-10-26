// Neuigkeiten lesen (Konzept 11.3, F-160): eine indizierte Abfrage über activity_target, danach wird jede
// Aktivität gegen den aktuellen Stand geprüft – die Log-Zeilen sind nur ein Index, nie die Quelle.
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json } from './http';
import { loadGroup, visibleGroup } from './groups';
import { STREAM_PAGE, STREAM_SCAN, canManageGroup, decodeCursor, encodeCursor, isActivityKind, type GroupKind, type GroupRole, type StreamCursor, type StreamItem } from '../src/domain/groups';

/** Eine Aktivität samt allem, was die Prüfung braucht (ein Batch, LEFT JOINs). */
export interface ActivityRow {
  id: string;
  kind: string;
  actor_id: string | null;
  subject_kind: string;
  subject_id: string;
  group_id: string | null;
  data: string;
  created_at: number;
  actor_handle: string | null;
  actor_name: string | null;
  actor_public: number | null;
  actor_suspended: number | null;
  actor_exists: number | null;
  s_id: string | null;
  s_title: string | null;
  s_dist: number | null;
  s_started: number | null;
  s_image: number | null;
  s_vis: string | null;
  s_hidden: number | null;
  b_id: string | null;
  b_name: string | null;
  b_vis: string | null;
  b_hidden: number | null;
  g_id: string | null;
  g_slug: string | null;
  g_name: string | null;
  g_kind: string | null;
  g_vis: string | null;
  g_hidden: number | null;
  g_role: string | null;
  p_id: string | null;
  p_body: string | null;
  p_link: string | null;
  p_hidden: number | null;
  p_author: string | null;
}

const ROWS_SQL = `SELECT a.id, a.kind, a.actor_id, a.subject_kind, a.subject_id, a.group_id, a.data, a.created_at,
    ap.handle AS actor_handle, ap.display_name AS actor_name, (ap.visibility = 'public' AND ap.hidden_at IS NULL) AS actor_public,
    (au.suspended_at IS NOT NULL) AS actor_suspended, (au.id IS NOT NULL) AS actor_exists,
    s.id AS s_id, s.title AS s_title, s.dist_nm AS s_dist, s.started_at AS s_started, s.has_image AS s_image, s.visibility AS s_vis, s.hidden_at AS s_hidden,
    b.id AS b_id, b.name AS b_name, b.visibility AS b_vis, b.hidden_at AS b_hidden,
    g.id AS g_id, g.slug AS g_slug, g.name AS g_name, g.kind AS g_kind, g.visibility AS g_vis, g.hidden_at AS g_hidden, gm.role AS g_role,
    p.id AS p_id, p.body AS p_body, p.link AS p_link, p.hidden_at AS p_hidden, p.author_id AS p_author
  FROM activity a
  LEFT JOIN users au ON au.id = a.actor_id
  LEFT JOIN profiles ap ON ap.user_id = a.actor_id
  LEFT JOIN shares s ON a.subject_kind = 'share' AND s.id = a.subject_id
  LEFT JOIN boats b ON b.id = CASE WHEN a.subject_kind = 'boat' THEN a.subject_id ELSE s.boat_id END
  LEFT JOIN groups g ON g.id = COALESCE(a.group_id, CASE WHEN a.subject_kind = 'group' THEN a.subject_id END)
  LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?1
  LEFT JOIN posts p ON a.subject_kind = 'post' AND p.id = a.subject_id
  WHERE a.id IN (SELECT value FROM json_each(?2))`;

export interface Viewer {
  id: string | null;
}

const publicBoat = (r: ActivityRow) => (r.b_id && r.b_vis === 'public' && !r.b_hidden ? { id: r.b_id, name: r.b_name ?? '' } : null);

/** Gruppe für den Betrachter sichtbar? Öffentlich oder Mitglied; ausgeblendet nur für Eigner/Admins. */
function groupVisible(r: ActivityRow): boolean {
  if (!r.g_id) return false;
  const role = (r.g_role as GroupRole | null) ?? null;
  if (r.g_hidden && !canManageGroup(role)) return false;
  return r.g_vis === 'public' || role !== null;
}

/**
 * Prüft eine Aktivität gegen den aktuellen Stand und formt den Eintrag – oder null (Konzept 11.3, Tabelle „Erscheint nur,
 * wenn …“). Rein, damit unit-testbar. `thumbs`: öffentliche Fotos des Törns (für `photos`).
 */
export function shapeItem(r: ActivityRow, viewer: Viewer, thumbs: string[] = []): StreamItem | null {
  if (!isActivityKind(r.kind)) return null;
  // Inhalte gesperrter oder gelöschter Konten verschwinden (Konzept 4.4).
  if (r.actor_id && (!r.actor_exists || r.actor_suspended)) return null;
  const actor = r.actor_id && r.actor_public && r.actor_handle ? { handle: r.actor_handle, displayName: r.actor_name ?? '' } : null;
  const group = r.g_id && groupVisible(r) ? { slug: r.g_slug ?? '', name: r.g_name ?? '', kind: (r.g_kind as GroupKind) ?? 'club' } : null;
  const base = { id: r.id, kind: r.kind, createdAt: r.created_at, actor, group: null as StreamItem['group'] };
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(r.data) as Record<string, unknown>;
  } catch {
    data = {};
  }

  switch (r.kind) {
    case 'voyage':
    case 'photos': {
      // Nur jetzt öffentliche, nicht ausgeblendete Törns – privat geschaltet, ausgeblendet oder gelöscht: weg.
      if (!r.s_id || r.s_vis !== 'public' || r.s_hidden) return null;
      if (r.kind === 'photos' && !thumbs.length) return null;
      const voyage = { id: r.s_id, title: r.s_title ?? '', distNm: r.s_dist ?? 0, startedAt: r.s_started, hasImage: !!r.s_image, boat: publicBoat(r) };
      if (r.kind === 'voyage') return { ...base, voyage };
      const count = Math.max(1, Math.floor(Number(data.count) || 1));
      return { ...base, voyage, photos: { count, thumbs: thumbs.slice(0, 4) } };
    }
    case 'member':
      if (!group) return null;
      return { ...base, group };
    case 'boat': {
      const boat = publicBoat(r);
      if (!group || !boat) return null;
      return { ...base, group, boat };
    }
    case 'post': {
      if (!group || !r.p_id || r.p_hidden) return null;
      const role = (r.g_role as GroupRole | null) ?? null;
      const canDelete = !!viewer.id && (viewer.id === r.p_author || canManageGroup(role));
      return { ...base, group, post: { id: r.p_id, body: r.p_body ?? '', link: r.p_link, canDelete } };
    }
    case 'milestone': {
      const nm = Number(data.nm) || 0;
      const year = Number(data.year) || 0;
      if (r.subject_kind === 'user') {
        if (!actor) return null; // nur mit öffentlichem Profil
        return { ...base, milestone: { nm, year, subject: 'user', name: actor.displayName, path: `/u/${actor.handle}` } };
      }
      if (r.subject_kind === 'boat') {
        const boat = publicBoat(r);
        if (!boat) return null;
        return { ...base, actor: null, boat, milestone: { nm, year, subject: 'boat', name: boat.name, path: `/b/${boat.id}` } };
      }
      if (!group) return null;
      return { ...base, actor: null, group, milestone: { nm, year, subject: 'group', name: group.name, path: `/g/${group.slug}` } };
    }
  }
  return null;
}

interface Candidate {
  id: string;
  at: number;
}

/**
 * Prüft Kandidaten (neueste zuerst) und liefert höchstens eine Seite sichtbarer Einträge. Der Cursor zeigt auf den
 * letzten zurückgegebenen bzw. – wenn trotz voller Kandidatenliste weniger sichtbar waren – auf den letzten geprüften.
 */
async function resolve(env: Env, viewer: Viewer, candidates: Candidate[], scanned: number): Promise<{ items: StreamItem[]; cursor: string | null }> {
  if (!candidates.length) return { items: [], cursor: null };
  const ids = candidates.map((c) => c.id);
  const { results: rows } = await env.DB.prepare(ROWS_SQL).bind(viewer.id ?? '', JSON.stringify(ids)).all<ActivityRow>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Vorschaubilder für Foto-Bündel: öffentliche, nicht ausgeblendete Fotos öffentlicher Törns
  const photoShares = [...new Set(rows.filter((r) => r.kind === 'photos' && r.s_id).map((r) => r.s_id!))];
  const thumbs = new Map<string, string[]>();
  if (photoShares.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, share_id FROM photos WHERE share_id IN (SELECT value FROM json_each(?)) AND visibility = 'public' AND hidden_at IS NULL ORDER BY created_at DESC`,
    )
      .bind(JSON.stringify(photoShares))
      .all<{ id: string; share_id: string }>();
    for (const p of results) thumbs.set(p.share_id, [...(thumbs.get(p.share_id) ?? []), p.id]);
  }
  const items: StreamItem[] = [];
  let last: Candidate | null = null;
  for (const c of candidates) {
    const r = byId.get(c.id);
    last = c;
    const item = r ? shapeItem(r, viewer, thumbs.get(r.s_id ?? '') ?? []) : null;
    if (item) items.push(item);
    if (items.length >= STREAM_PAGE) break;
  }
  const more = items.length >= STREAM_PAGE || candidates.length >= scanned;
  return { items, cursor: more && last ? encodeCursor({ at: last.at, id: last.id }) : null };
}

const cursorOf = (request: Request): StreamCursor => {
  const raw = new URL(request.url).searchParams.get('cursor');
  const c = decodeCursor(raw);
  if (raw && !c) throw new HttpError(400, 'invalid_cursor', 'Ungültiger Cursor.');
  return c ?? { at: Number.MAX_SAFE_INTEGER, id: '~' };
};

/**
 * Persönliche Neuigkeiten: Ziele = meine Gruppen, meine Boote (Eigner/Admin), Gefolgte und ich selbst.
 * Die Ziele sind wenige; je Ziel liest der Index (target_kind, target_id, created_at) ab dem Cursor.
 */
const PERSONAL_SQL = `WITH mine(kind, id) AS (
    SELECT 'group', group_id FROM group_members WHERE user_id = ?1
    UNION SELECT 'boat', id FROM boats WHERE owner_id = ?1
    UNION SELECT 'boat', boat_id FROM boat_admins WHERE user_id = ?1
    UNION SELECT target_kind, target_id FROM follows WHERE user_id = ?1
    UNION SELECT 'user', ?1
  )
  SELECT t.activity_id AS id, t.created_at AS at
  FROM mine JOIN activity_target t ON t.target_kind = mine.kind AND t.target_id = mine.id
  WHERE t.created_at < ?2 OR (t.created_at = ?2 AND t.activity_id < ?3)
  GROUP BY t.activity_id
  ORDER BY at DESC, id DESC
  LIMIT ?4`;

/** GET /api/stream?cursor= – persönliche Neuigkeiten (angemeldet, nie gecacht). */
export async function personalStream(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const c = cursorOf(request);
  const { results } = await env.DB.prepare(PERSONAL_SQL).bind(user.id, c.at, c.id, STREAM_SCAN).all<Candidate>();
  const page = await resolve(env, { id: user.id }, results, STREAM_SCAN);
  const groups = (await env.DB.prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?').bind(user.id).first<{ n: number }>())?.n ?? 0;
  return json({ ...page, hasGroups: groups > 0 }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Einträge einer Gruppe (Ziel `group`) – auch für RSS (worker/feed.ts). */
export async function groupItems(env: Env, groupId: string, viewer: Viewer, c: StreamCursor) {
  const { results } = await env.DB.prepare(
    `SELECT activity_id AS id, created_at AS at FROM activity_target
     WHERE target_kind = 'group' AND target_id = ?1 AND (created_at < ?2 OR (created_at = ?2 AND activity_id < ?3))
     ORDER BY created_at DESC, activity_id DESC LIMIT ?4`,
  )
    .bind(groupId, c.at, c.id, STREAM_SCAN)
    .all<Candidate>();
  return resolve(env, viewer, results, STREAM_SCAN);
}

const PUBLIC_TTL = 60;

const defaultCache = (): Cache | undefined => (typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined);

/**
 * GET /api/groups/:id/stream?cursor= – Neuigkeiten der Gruppe. Öffentliche Gruppen sind für alle (außer Eigner/Admins,
 * die Löschen-Knöpfe sehen) gleich und werden 60 s gecacht; die Sichtbarkeit der Gruppe wird vorher geprüft.
 */
export async function groupStream(request: Request, env: Env, id: string): Promise<Response> {
  const { group, role, user } = await visibleGroup(request, env, await loadGroup(env, id));
  const c = cursorOf(request);
  const shared = group.visibility === 'public' && !group.hidden_at && !canManageGroup(role);
  if (!shared) {
    const page = await groupItems(env, group.id, { id: user?.id ?? null }, c);
    return json(page, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const url = new URL(request.url);
  const key = new Request(`${url.origin}/__cache/groups/${group.id}/stream?cursor=${encodeURIComponent(url.searchParams.get('cursor') ?? '')}`);
  const cache = defaultCache();
  const hit = await cache?.match(key).catch(() => undefined);
  const headers = { 'Cache-Control': `public, max-age=${PUBLIC_TTL}` };
  if (hit) return json(await hit.json(), { headers: { ...headers, 'X-Stream-Cache': 'hit' } });
  // Ohne Betrachter berechnet: gleich für alle, keine Löschen-Rechte im Cache.
  const page = await groupItems(env, group.id, { id: null }, c);
  await cache
    ?.put(key, new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${PUBLIC_TTL}` } }))
    .catch(() => undefined);
  return json(page, { headers: { ...headers, 'X-Stream-Cache': 'miss' } });
}
