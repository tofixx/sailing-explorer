// Folgen und „Leute, die du kennen könntest“ (Konzept 11.2, 11.6, F-158, F-164).
// Folgen geht nur bei öffentlichen, nicht ausgeblendeten Zielen und öffnet nichts: Neuigkeiten prüfen beim Lesen.
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json } from './http';
import { assertActive } from './moderation';
import { BOAT_ID_RE, SHARE_ID_RE, normalizeHandle } from './validate';
import { GROUP_LIMITS } from '../src/domain/limits';
import { isFollowKind, suggestionReasonText, type FollowKind, type SuggestionReason } from '../src/domain/groups';

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Das gibt es nicht (mehr) oder es ist nicht öffentlich.');

/** Zahl der Follower, ob der Betrachter folgt und (bei Profilen) wie vielen die Person folgt. */
export async function followStats(env: Env, kind: FollowKind, id: string, viewerId: string | null) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM follows WHERE target_kind = ?1 AND target_id = ?2) AS followers,
       (SELECT COUNT(*) FROM follows WHERE user_id = ?2) AS following,
       EXISTS (SELECT 1 FROM follows WHERE user_id = ?3 AND target_kind = ?1 AND target_id = ?2) AS mine`,
  )
    .bind(kind, id, viewerId ?? '')
    .first<{ followers: number; following: number; mine: number }>();
  return {
    followers: row?.followers ?? 0,
    ...(kind === 'user' ? { following: row?.following ?? 0 } : {}),
    isFollowing: !!row?.mine,
  };
}

/**
 * Ziel-ID zu Art und Kennung (Profil: Profilname, Boot und Gruppe: ID). `mustBePublic`: nur öffentliche, nicht
 * ausgeblendete Ziele – sonst null (wie „gibt es nicht“). Zum Entfolgen genügt, dass es die Zeile gibt.
 */
async function resolveTarget(env: Env, kind: FollowKind, raw: string, mustBePublic: boolean): Promise<{ id: string; ownerId: string | null } | null> {
  const pub = (alias: string) => (mustBePublic ? ` AND ${alias}.visibility = 'public' AND ${alias}.hidden_at IS NULL` : '');
  if (kind === 'user') {
    const handle = normalizeHandle(raw);
    if (!handle) return null;
    const p = await env.DB.prepare(`SELECT p.user_id FROM profiles p WHERE p.handle = ?${pub('p')}`).bind(handle).first<{ user_id: string }>();
    return p ? { id: p.user_id, ownerId: p.user_id } : null;
  }
  if (kind === 'boat') {
    if (!BOAT_ID_RE.test(raw)) return null;
    const b = await env.DB.prepare(`SELECT b.id, b.owner_id FROM boats b WHERE b.id = ?${pub('b')}`).bind(raw).first<{ id: string; owner_id: string }>();
    return b ? { id: b.id, ownerId: b.owner_id } : null;
  }
  if (!SHARE_ID_RE.test(raw)) return null;
  if (kind === 'harbor') {
    // Häfen sind immer öffentlich – nur ausgeblendete nicht (Konzept 12.2)
    const h = await env.DB.prepare(`SELECT id FROM harbors WHERE id = ?${mustBePublic ? ' AND hidden_at IS NULL' : ''}`).bind(raw).first<{ id: string }>();
    return h ? { id: h.id, ownerId: null } : null;
  }
  const g = await env.DB.prepare(`SELECT g.id FROM groups g WHERE g.id = ?${pub('g')}`).bind(raw).first<{ id: string }>();
  return g ? { id: g.id, ownerId: null } : null;
}

function parseKind(raw: string): FollowKind {
  if (!isFollowKind(raw)) throw NOT_FOUND();
  return raw;
}

/** PUT /api/follows/:kind/:id – folgen (ohne Zustimmung, nur Öffentliches, höchstens 1000 pro Konto). */
export async function follow(request: Request, env: Env, rawKind: string, raw: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const kind = parseKind(rawKind);
  const t = await resolveTarget(env, kind, raw, true);
  if (!t) throw NOT_FOUND();
  if (kind === 'user' && t.id === user.id) throw new HttpError(400, 'own_object', 'Dir selbst kannst du nicht folgen.');
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?').bind(user.id).first<{ n: number }>())?.n ?? 0;
  const exists = await env.DB.prepare('SELECT 1 AS x FROM follows WHERE user_id = ? AND target_kind = ? AND target_id = ?').bind(user.id, kind, t.id).first();
  if (!exists && n >= GROUP_LIMITS.follows) throw new HttpError(409, 'quota', `Du folgst schon ${GROUP_LIMITS.follows} Profilen, Booten, Gruppen und Häfen – entfolge zuerst anderen.`);
  await env.DB.prepare('INSERT OR IGNORE INTO follows (user_id, target_kind, target_id, created_at) VALUES (?, ?, ?, ?)').bind(user.id, kind, t.id, Date.now()).run();
  return json(await followStats(env, kind, t.id, user.id));
}

/** DELETE /api/follows/:kind/:id – entfolgen (geht immer, auch wenn das Ziel nicht mehr öffentlich ist). */
export async function unfollow(request: Request, env: Env, rawKind: string, raw: string): Promise<Response> {
  const user = await requireUser(request, env);
  const kind = parseKind(rawKind);
  const t = await resolveTarget(env, kind, raw, false);
  if (t) await env.DB.prepare('DELETE FROM follows WHERE user_id = ? AND target_kind = ? AND target_id = ?').bind(user.id, kind, t.id).run();
  return json(t ? await followStats(env, kind, t.id, user.id) : { followers: 0, isFollowing: false });
}

// ---------------------------------------------------------------- Vorschläge

/**
 * Kandidaten je Grund – einfache, indizierte Abfragen in einem Batch (D1 erlaubt nur wenige UNION-Glieder), gezählt
 * und sortiert im Worker. Boote zählen nur, wenn sie öffentlich sind (sonst verriete der Vorschlag Eigner oder Hafen).
 */
const CANDIDATES: Array<[SuggestionReason, string]> = [
  ['group', `SELECT DISTINCT m2.user_id, NULL AS port FROM group_members m1 JOIN group_members m2 ON m2.group_id = m1.group_id WHERE m1.user_id = ?1 LIMIT 200`],
  [
    'crew',
    `SELECT c.user_id, NULL AS port FROM share_crew c WHERE c.share_id IN (SELECT id FROM shares WHERE user_id = ?1 UNION SELECT share_id FROM share_crew WHERE user_id = ?1)
     UNION SELECT s.user_id, NULL FROM shares s WHERE s.id IN (SELECT share_id FROM share_crew WHERE user_id = ?1) LIMIT 200`,
  ],
  [
    'boat',
    `SELECT DISTINCT b.owner_id AS user_id, NULL AS port FROM group_members m JOIN group_boats gb ON gb.group_id = m.group_id
       JOIN boats b ON b.id = gb.boat_id AND b.visibility = 'public' AND b.hidden_at IS NULL WHERE m.user_id = ?1
     UNION SELECT a.user_id, NULL FROM group_members m JOIN group_boats gb ON gb.group_id = m.group_id
       JOIN boats b ON b.id = gb.boat_id AND b.visibility = 'public' AND b.hidden_at IS NULL JOIN boat_admins a ON a.boat_id = b.id WHERE m.user_id = ?1 LIMIT 200`,
  ],
  [
    'port',
    // Gleicher Hafen (Konzept 12.2) statt gleichem Freitext
    `SELECT DISTINCT b2.owner_id AS user_id, h.name AS port FROM boats b1
       JOIN boats b2 ON b2.harbor_id = b1.harbor_id AND b2.owner_id <> b1.owner_id AND b2.visibility = 'public' AND b2.hidden_at IS NULL
       JOIN harbors h ON h.id = b1.harbor_id AND h.hidden_at IS NULL
     WHERE b1.owner_id = ?1 AND b1.harbor_id IS NOT NULL LIMIT 200`,
  ],
];

/** Rangfolge der Gründe bei Gleichstand bzw. für die Anzeige: gemeinsam gesegelt vor Verein vor Boot vor Hafen. */
const PRIORITY: Record<SuggestionReason, number> = { crew: 0, group: 1, boat: 2, port: 3 };

/** Vorschläge berechnen – nur öffentliche Profile nicht gesperrter Konten, ohne mich und ohne Gefolgte (Konzept 11.6). */
export async function suggestionsFor(env: Env, userId: string) {
  const batch = await env.DB.batch(CANDIDATES.map(([, sql]) => env.DB.prepare(sql).bind(userId)));
  const score = new Map<string, { n: number; reason: SuggestionReason; port: string | null }>();
  batch.forEach((res, i) => {
    const reason = CANDIDATES[i][0];
    for (const r of res.results as Array<{ user_id: string; port: string | null }>) {
      if (r.user_id === userId) continue;
      const cur = score.get(r.user_id);
      if (!cur) score.set(r.user_id, { n: 1, reason, port: r.port });
      else {
        cur.n++;
        if (PRIORITY[reason] < PRIORITY[cur.reason]) Object.assign(cur, { reason, port: r.port });
      }
    }
  });
  if (!score.size) return [];
  const { results } = await env.DB.prepare(
    `SELECT p.user_id, p.handle, p.display_name FROM profiles p JOIN users u ON u.id = p.user_id AND u.suspended_at IS NULL
     WHERE p.user_id IN (SELECT value FROM json_each(?2)) AND p.visibility = 'public' AND p.hidden_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.user_id = ?1 AND f.target_kind = 'user' AND f.target_id = p.user_id)`,
  )
    .bind(userId, JSON.stringify([...score.keys()]))
    .all<{ user_id: string; handle: string; display_name: string }>();
  return results
    .map((r) => ({ r, s: score.get(r.user_id)! }))
    .sort((a, b) => b.s.n - a.s.n || PRIORITY[a.s.reason] - PRIORITY[b.s.reason] || a.r.handle.localeCompare(b.r.handle))
    .slice(0, 6)
    .map(({ r, s: c }) => ({ handle: r.handle, displayName: r.display_name, reason: c.reason, reasonText: suggestionReasonText(c.reason, c.port) }));
}

/** GET /api/me/suggestions – höchstens 6, 5 min pro Konto gecacht (Cache API, Schlüssel nur serverseitig). */
export async function getSuggestions(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const headers = { 'Cache-Control': 'private, max-age=300' };
  const cacheKey = new Request(new URL(`/__cache/suggestions/${user.id}`, request.url).toString());
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return json(await hit.json(), { headers });
  const people = await suggestionsFor(env, user.id);
  await cache?.put(cacheKey, new Response(JSON.stringify({ people }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } })).catch(() => undefined);
  return json({ people }, { headers });
}
