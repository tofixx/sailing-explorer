// Neuigkeiten lesen (Konzept 11.3, 12.4, F-160, F-176 … F-178): Kandidaten aus activity_target (bzw. activity für den
// öffentlichen Stream), danach wird jede Aktivität gegen den aktuellen Stand geprüft – die Log-Zeilen sind nur ein
// Index, nie die Quelle. Reaktionen (Konzept 12.5) werden je Seite in einer Abfrage dazugelesen.
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { HttpError, json } from './http';
import { loadGroup, loadGroupBySlug, visibleGroup } from './groups';
import { harborVisible, loadHarbor, loadHarborBySlug, HARBOR_NOT_FOUND } from './harbors';
import { homeShape, homeStmt, type HomeRow } from './home';
import { isAdmin } from './moderation';
import { shapeItem, type ActivityRow, type Viewer } from './stream-shape';
import {
  STREAM_PAGE, STREAM_SCAN, canManageGroup, decodeCursor, encodeCursor, reactionSubjectOf,
  type StreamCursor, type StreamItem,
} from '../src/domain/groups';
import { emptyReactions, summarizeReactions, type ReactionKind } from '../src/domain/reactions';

const ROWS_SQL = `SELECT a.id, a.kind, a.actor_id, a.subject_kind, a.subject_id, a.group_id, a.data, a.created_at,
    ap.handle AS actor_handle, ap.display_name AS actor_name, (ap.visibility = 'public' AND ap.hidden_at IS NULL) AS actor_public,
    (au.suspended_at IS NOT NULL) AS actor_suspended, (au.id IS NOT NULL) AS actor_exists,
    s.id AS s_id, s.title AS s_title, s.dist_nm AS s_dist, s.started_at AS s_started, s.has_image AS s_image, s.visibility AS s_vis, s.hidden_at AS s_hidden,
    b.id AS b_id, b.name AS b_name, b.visibility AS b_vis, b.hidden_at AS b_hidden,
    g.id AS g_id, g.slug AS g_slug, g.name AS g_name, g.kind AS g_kind, g.visibility AS g_vis, g.hidden_at AS g_hidden, gm.role AS g_role,
    p.id AS p_id, p.body AS p_body, p.link AS p_link, p.hidden_at AS p_hidden, p.author_id AS p_author,
    h.slug AS h_slug, h.name AS h_name, h.hidden_at AS h_hidden
  FROM activity a
  LEFT JOIN users au ON au.id = a.actor_id
  LEFT JOIN profiles ap ON ap.user_id = a.actor_id
  LEFT JOIN shares s ON a.subject_kind = 'share' AND s.id = a.subject_id
  LEFT JOIN boats b ON b.id = CASE WHEN a.subject_kind = 'boat' THEN a.subject_id ELSE s.boat_id END
  LEFT JOIN groups g ON g.id = COALESCE(a.group_id, CASE WHEN a.subject_kind = 'group' THEN a.subject_id END)
  LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?1
  LEFT JOIN posts p ON a.subject_kind = 'post' AND p.id = a.subject_id
  LEFT JOIN harbors h ON a.kind = 'harbor' AND h.id = json_extract(a.data, '$.harbor')
  WHERE a.id IN (SELECT value FROM json_each(?2))`;

interface Candidate {
  id: string;
  at: number;
}

export interface StreamPageOut {
  items: StreamItem[];
  cursor: string | null;
}

// ---------------------------------------------------------------- Reaktionen je Seite

/**
 * Zähler je Art (ohne gesperrte Konten) und – mit Betrachter – die eigene Reaktion für alle Einträge einer Seite.
 * Schlüsselliste als JSON, CROSS JOIN erzwingt die Liste als äußere Schleife (Index-Zugriff je Gegenstand).
 */
const REACTIONS_SQL = `SELECT r.subject_kind AS sk, r.subject_id AS sid, r.kind, COUNT(*) AS n, MAX(r.user_id = ?2) AS mine
  FROM json_each(?1) AS k CROSS JOIN reactions r ON r.subject_kind = json_extract(k.value, '$[0]') AND r.subject_id = json_extract(k.value, '$[1]')
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id AND u.suspended_at IS NOT NULL)
  GROUP BY r.subject_kind, r.subject_id, r.kind`;

const MINE_SQL = `SELECT r.subject_kind AS sk, r.subject_id AS sid, r.kind
  FROM json_each(?1) AS k CROSS JOIN reactions r ON r.subject_kind = json_extract(k.value, '$[0]') AND r.subject_id = json_extract(k.value, '$[1]')
  WHERE r.user_id = ?2`;

async function attachReactions(env: Env, items: StreamItem[], viewerId: string | null): Promise<void> {
  if (!items.length) return;
  const subjects = items.map((i) => reactionSubjectOf(i));
  const keys = [...new Map(subjects.map((s) => [`${s.subject}:${s.id}`, [s.subject, s.id]])).values()];
  const { results } = await env.DB.prepare(REACTIONS_SQL).bind(JSON.stringify(keys), viewerId ?? '').all<{ sk: string; sid: string; kind: string; n: number; mine: number }>();
  const by = new Map<string, typeof results>();
  for (const r of results) by.set(`${r.sk}:${r.sid}`, [...(by.get(`${r.sk}:${r.sid}`) ?? []), r]);
  items.forEach((item, i) => {
    const s = subjects[i];
    const rows = by.get(`${s.subject}:${s.id}`);
    item.reactions = { subject: s.subject, id: s.id, ...(rows ? summarizeReactions(rows) : emptyReactions()) };
  });
}

/** Für gecachte (für alle gleiche) Seiten: die eigene Reaktion nachträglich eintragen. */
async function addMine(env: Env, page: StreamPageOut, viewerId: string | null): Promise<StreamPageOut> {
  if (!viewerId || !page.items.length) return page;
  const keys = page.items.filter((i) => i.reactions).map((i) => [i.reactions!.subject, i.reactions!.id]);
  if (!keys.length) return page;
  const { results } = await env.DB.prepare(MINE_SQL).bind(JSON.stringify(keys), viewerId).all<{ sk: string; sid: string; kind: ReactionKind }>();
  const mine = new Map(results.map((r) => [`${r.sk}:${r.sid}`, r.kind]));
  return {
    ...page,
    items: page.items.map((i) => (i.reactions ? { ...i, reactions: { ...i.reactions, mine: mine.get(`${i.reactions.subject}:${i.reactions.id}`) ?? null } } : i)),
  };
}

// ---------------------------------------------------------------- Prüfen beim Lesen

/**
 * Prüft Kandidaten (neueste zuerst) und liefert höchstens eine Seite sichtbarer Einträge. Der Cursor zeigt auf den
 * letzten zurückgegebenen bzw. – wenn trotz voller Kandidatenliste weniger sichtbar waren – auf den letzten geprüften.
 * `keep`: zusätzlicher Filter (z. B. Hafen-Stream: nur Törns öffentlicher Boote).
 */
async function resolve(env: Env, viewer: Viewer, candidates: Candidate[], scanned: number, keep: (i: StreamItem) => boolean = () => true): Promise<StreamPageOut> {
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
    if (item && keep(item)) items.push(item);
    if (items.length >= STREAM_PAGE) break;
  }
  await attachReactions(env, items, viewer.id);
  const more = items.length >= STREAM_PAGE || candidates.length >= scanned;
  return { items, cursor: more && last ? encodeCursor({ at: last.at, id: last.id }) : null };
}

/** Eine einzelne Aktivität, wie sie der Betrachter jetzt sehen dürfte – oder null (für Reaktionen, F-179). */
export async function visibleActivity(env: Env, viewerId: string | null, id: string): Promise<StreamItem | null> {
  const row = await env.DB.prepare(ROWS_SQL).bind(viewerId ?? '', JSON.stringify([id])).first<ActivityRow>();
  if (!row) return null;
  let thumbs: string[] = [];
  if (row.kind === 'photos' && row.s_id) {
    const { results } = await env.DB.prepare(`SELECT id FROM photos WHERE share_id = ? AND visibility = 'public' AND hidden_at IS NULL LIMIT 4`).bind(row.s_id).all<{ id: string }>();
    thumbs = results.map((p) => p.id);
  }
  return shapeItem(row, { id: viewerId }, thumbs);
}

const cursorOf = (request: Request): StreamCursor => {
  const raw = new URL(request.url).searchParams.get('cursor');
  const c = decodeCursor(raw);
  if (raw && !c) throw new HttpError(400, 'invalid_cursor', 'Ungültiger Cursor.');
  return c ?? { at: Number.MAX_SAFE_INTEGER, id: '~' };
};

// ---------------------------------------------------------------- Persönlicher Stream (Konzept 12.4)

/** Höchstens so viele Ziele (Folgen 1000 + Gruppen + Teammitglieder 500 + Rest). */
export const STREAM_TARGETS_MAX = 1600;

/**
 * Ziele sammeln: ein Batch einfacher, indizierter Abfragen (D1 lehnt zusammengesetzte SELECTs mit mehr als etwa fünf
 * UNION-Gliedern ab – hier hat keine Abfrage mehr als zwei).
 */
const TARGET_SQL = {
  groups: `SELECT 'group' AS k, group_id AS id FROM group_members WHERE user_id = ?1`,
  boats: `SELECT 'boat' AS k, id FROM boats WHERE owner_id = ?1 UNION SELECT 'boat', boat_id FROM boat_admins WHERE user_id = ?1`,
  follows: `SELECT target_kind AS k, target_id AS id FROM follows WHERE user_id = ?1 LIMIT 1000`,
  clubTeams: `SELECT 'group' AS k, g.id FROM users u
      JOIN group_members hm ON hm.group_id = u.home_club_id AND hm.user_id = u.id
      JOIN groups g ON g.parent_id = u.home_club_id AND g.hidden_at IS NULL
    WHERE u.id = ?1 LIMIT 100`,
  teamMates: `SELECT DISTINCT 'user' AS k, m2.user_id AS id FROM group_members m1
      JOIN groups g ON g.id = m1.group_id AND g.kind = 'team'
      JOIN group_members m2 ON m2.group_id = g.id
    WHERE m1.user_id = ?1 LIMIT 500`,
} as const;

/**
 * Die eine Stream-Abfrage: Schlüsselliste (JSON) als äußere Schleife (CROSS JOIN), je Schlüssel ein Bereich im Index
 * activity_target(target_kind, target_id, created_at), gruppiert nach Aktivität, neueste zuerst, ab dem Cursor.
 */
export const PERSONAL_SQL = `SELECT t.activity_id AS id, MAX(t.created_at) AS at
  FROM json_each(?1) AS k CROSS JOIN activity_target t
    ON t.target_kind = json_extract(k.value, '$[0]') AND t.target_id = json_extract(k.value, '$[1]')
  WHERE t.created_at < ?2 OR (t.created_at = ?2 AND t.activity_id < ?3)
  GROUP BY t.activity_id
  ORDER BY at DESC, id DESC
  LIMIT ?4`;

/** Ziele des persönlichen Streams als [Art, ID]-Paare (eindeutig, höchstens STREAM_TARGETS_MAX) und die Heimat. */
export async function personalTargets(env: Env, userId: string): Promise<{ keys: Array<[string, string]>; home: HomeRow | null; groups: number }> {
  const [groups, boats, follows, clubTeams, teamMates, home] = await env.DB.batch([
    env.DB.prepare(TARGET_SQL.groups).bind(userId),
    env.DB.prepare(TARGET_SQL.boats).bind(userId),
    env.DB.prepare(TARGET_SQL.follows).bind(userId),
    env.DB.prepare(TARGET_SQL.clubTeams).bind(userId),
    env.DB.prepare(TARGET_SQL.teamMates).bind(userId),
    homeStmt(env, userId),
  ]);
  const homeRow = (home.results[0] as HomeRow | undefined) ?? null;
  const keys = new Map<string, [string, string]>();
  const add = (k: string, id: string | null | undefined) => {
    if (id && keys.size < STREAM_TARGETS_MAX) keys.set(`${k}\u0000${id}`, [k, id]);
  };
  add('user', userId);
  if (homeRow?.harbor_id) add('harbor', homeRow.harbor_id);
  for (const res of [groups, clubTeams, boats, follows, teamMates]) for (const r of res.results as Array<{ k: string; id: string }>) add(r.k, r.id);
  return { keys: [...keys.values()], home: homeRow, groups: groups.results.length };
}

/** GET /api/stream?cursor= – persönliche Neuigkeiten (angemeldet, nie gecacht). */
export async function personalStream(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const c = cursorOf(request);
  const { keys, home, groups } = await personalTargets(env, user.id);
  const { results } = await env.DB.prepare(PERSONAL_SQL).bind(JSON.stringify(keys), c.at, c.id, STREAM_SCAN).all<Candidate>();
  const page = await resolve(env, { id: user.id }, results, STREAM_SCAN);
  const { club, harbor } = homeShape(home);
  return json({ ...page, hasGroups: groups > 0, home: { club, harbor } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// ---------------------------------------------------------------- Streams einzelner Ziele (Gruppe, Hafen)

async function targetCandidates(env: Env, kind: 'group' | 'harbor', id: string, c: StreamCursor): Promise<Candidate[]> {
  const { results } = await env.DB.prepare(
    `SELECT activity_id AS id, created_at AS at FROM activity_target
     WHERE target_kind = ?1 AND target_id = ?2 AND (created_at < ?3 OR (created_at = ?3 AND activity_id < ?4))
     ORDER BY created_at DESC, activity_id DESC LIMIT ?5`,
  )
    .bind(kind, id, c.at, c.id, STREAM_SCAN)
    .all<Candidate>();
  return results;
}

/** Einträge einer Gruppe (Ziel `group`) – auch für RSS (worker/feed.ts). */
export async function groupItems(env: Env, groupId: string, viewer: Viewer, c: StreamCursor) {
  return resolve(env, viewer, await targetCandidates(env, 'group', groupId, c), STREAM_SCAN);
}

/** Hafen-Stream: Törns und Fotos nur mit (jetzt) öffentlichem Boot – sonst verriete er den Hafen eines privaten Boots. */
const harborKeep = (i: StreamItem) => (i.kind === 'voyage' || i.kind === 'photos' ? !!i.voyage?.boat : true);

export async function harborItems(env: Env, harborId: string, viewer: Viewer, c: StreamCursor) {
  return resolve(env, viewer, await targetCandidates(env, 'harbor', harborId, c), STREAM_SCAN, harborKeep);
}

const PUBLIC_TTL = 60;

const defaultCache = (): Cache | undefined => (typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined);

/**
 * Für alle gleiche Seite aus dem Cache (60 s) bzw. berechnet und abgelegt; die eigene Reaktion kommt danach dazu.
 * Der Schlüssel enthält nur feste Teile und den Cursor bzw. Filter – nie etwas Persönliches.
 */
async function cachedPage<T extends StreamPageOut>(request: Request, env: Env, cacheKey: string, compute: () => Promise<T>, viewerId: string | null): Promise<Response> {
  const url = new URL(request.url);
  const key = new Request(`${url.origin}/__cache/${cacheKey}`);
  const cache = defaultCache();
  const hit = await cache?.match(key).catch(() => undefined);
  // Mit Betrachter enthält die Antwort die eigene Reaktion – dann nie in fremde Caches.
  const headers = { 'Cache-Control': viewerId ? 'private, no-store' : `public, max-age=${PUBLIC_TTL}` };
  if (hit) return json(await addMine(env, (await hit.json()) as T, viewerId), { headers: { ...headers, 'X-Stream-Cache': 'hit' } });
  const page = await compute();
  await cache
    ?.put(key, new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${PUBLIC_TTL}` } }))
    .catch(() => undefined);
  return json(await addMine(env, page, viewerId), { headers: { ...headers, 'X-Stream-Cache': 'miss' } });
}

const cursorParam = (request: Request) => encodeURIComponent(new URL(request.url).searchParams.get('cursor') ?? '');

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
  // Ohne Betrachter berechnet: gleich für alle, keine Löschen-Rechte im Cache.
  return cachedPage(request, env, `groups/${group.id}/stream?cursor=${cursorParam(request)}`, () => groupItems(env, group.id, { id: null }, c), user?.id ?? null);
}

/** GET /api/harbors/:id/stream?cursor= – Neuigkeiten des Hafens (Häfen sind öffentlich: immer gecacht). */
export async function harborStream(request: Request, env: Env, id: string): Promise<Response> {
  const user = await currentUser(request, env);
  const h = await loadHarbor(env, id);
  if (!harborVisible(h, isAdmin(env, user?.id))) throw HARBOR_NOT_FOUND();
  const c = cursorOf(request);
  return cachedPage(request, env, `harbors/${h.id}/stream?cursor=${cursorParam(request)}`, () => harborItems(env, h.id, { id: null }, c), user?.id ?? null);
}

// ---------------------------------------------------------------- Öffentlicher Community-Stream (F-178)

/** Filter-Chips: Häfen mit den meisten öffentlichen Booten, öffentliche Vereine mit den meisten Mitgliedern. */
async function publicFilters(env: Env) {
  const [harbors, clubs] = await env.DB.batch([
    env.DB.prepare(
      `SELECT h.slug, h.name, COUNT(b.id) AS boats FROM harbors h
         JOIN boats b ON b.harbor_id = h.id AND b.visibility = 'public' AND b.hidden_at IS NULL
       WHERE h.hidden_at IS NULL GROUP BY h.id ORDER BY boats DESC, h.name LIMIT 8`,
    ),
    env.DB.prepare(
      `SELECT g.slug, g.name, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members FROM groups g
       WHERE g.kind = 'club' AND g.visibility = 'public' AND g.hidden_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.owner_id AND u.suspended_at IS NOT NULL)
       ORDER BY members DESC, g.name LIMIT 8`,
    ),
  ]);
  return {
    harbors: (harbors.results as Array<{ slug: string; name: string; boats: number }>).map((h) => ({ slug: h.slug, name: h.name, boats: h.boats })),
    clubs: (clubs.results as Array<{ slug: string; name: string; members: number }>).map((g) => ({ slug: g.slug, name: g.name, members: g.members })),
  };
}

/** Neueste Aktivitäten der ganzen Plattform (Index activity_recent). */
async function recentCandidates(env: Env, c: StreamCursor): Promise<Candidate[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at AS at FROM activity WHERE created_at < ?1 OR (created_at = ?1 AND id < ?2) ORDER BY created_at DESC, id DESC LIMIT ?3`,
  )
    .bind(c.at, c.id, STREAM_SCAN)
    .all<Candidate>();
  return results;
}

/**
 * GET /api/stream/public?cursor=&harbor=<slug>&club=<slug> – für alle, ohne Betrachter geprüft (nur Öffentliches),
 * 60 s gecacht. Unbekannter oder ausgeblendeter Hafen bzw. nicht öffentlicher Verein: 404.
 */
export async function publicStream(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const user = await currentUser(request, env);
  const c = cursorOf(request);
  const first = !url.searchParams.get('cursor');
  const harborSlug = url.searchParams.get('harbor');
  const clubSlug = url.searchParams.get('club');
  let compute: () => Promise<StreamPageOut>;
  let filterKey = '';
  if (harborSlug) {
    const h = await loadHarborBySlug(env, harborSlug);
    if (!harborVisible(h)) throw HARBOR_NOT_FOUND();
    filterKey = `harbor=${h.id}`;
    compute = () => harborItems(env, h.id, { id: null }, c);
  } else if (clubSlug) {
    const g = await loadGroupBySlug(env, clubSlug);
    if (!g || g.kind !== 'club' || g.visibility !== 'public' || g.hidden_at) throw new HttpError(404, 'not_found', 'Diesen Verein gibt es nicht oder er ist nicht öffentlich.');
    filterKey = `club=${g.id}`;
    compute = () => groupItems(env, g.id, { id: null }, c);
  } else {
    compute = async () => resolve(env, { id: null }, await recentCandidates(env, c), STREAM_SCAN);
  }
  const withFilters = first ? async () => ({ ...(await compute()), filters: await publicFilters(env) }) : compute;
  return cachedPage(request, env, `stream/public?${filterKey}&cursor=${cursorParam(request)}`, withFilters, user?.id ?? null);
}
