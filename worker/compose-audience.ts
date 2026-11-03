// Publikums-Hinweis vor dem Posten (Konzept 28, 21.7.1, F-465): wem ein Beitrag im persönlichen Stream erscheint, je
// Stufe der Ausbreitungskette (`ReachChain` aus worker/post-chain.ts). Gezählt wird, was die Ziele des persönlichen
// Streams (TARGET_SQL in worker/stream-sql.ts) daraus machen: Mitgliedschaften und Folgen ohne „Stumm“, Teamkollegen,
// Heimathafen. Nur Zahlen, auf 10 gerundet – keine Namen.
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json } from './http';
import { writableChannel, type WritableChannel } from './post-chain';
import { isChannelKind } from '../src/domain/posts';
import { roundAudience, type Audience } from '../src/domain/large-groups';

/** Ein Teil des Publikums: Gruppen (Mitglieder), Folgen-Ziele [Art, ID], Häfen (Heimathafen bzw. Boot dort). */
interface Parts {
  groups: string[];
  follows: Array<[string, string]>;
  harbors: string[];
}

/** Verschiedene Konten aus allen Teilen – vier einfache Glieder (D1 lehnt mehr als etwa fünf UNION-Glieder ab). */
const AUDIENCE_SQL = `SELECT COUNT(DISTINCT uid) AS n FROM (
    SELECT m.user_id AS uid FROM json_each(?1) j JOIN group_members m ON m.group_id = j.value WHERE m.notify_level IS NOT 'muted'
    UNION ALL SELECT f.user_id FROM json_each(?2) j JOIN follows f ON f.target_kind = json_extract(j.value, '$[0]') AND f.target_id = json_extract(j.value, '$[1]')
      WHERE f.notify_level IS NOT 'muted'
    UNION ALL SELECT u.id FROM json_each(?3) j JOIN users u ON u.home_harbor_id = j.value
    UNION ALL SELECT b.owner_id FROM json_each(?3) j JOIN boats b ON b.harbor_id = j.value)`;

const merge = (a: Parts, b: Partial<Parts>): Parts => ({
  groups: [...a.groups, ...(b.groups ?? [])],
  follows: [...a.follows, ...(b.follows ?? [])],
  harbors: [...a.harbors, ...(b.harbors ?? [])],
});

/** Heimatverlauf: Gruppe (Mitglieder, Follower), Hafen, Boot (Follower), Profil (Follower und Teamkollegen). */
async function homeParts(env: Env, ch: WritableChannel): Promise<Parts> {
  const none: Parts = { groups: [], follows: [], harbors: [] };
  switch (ch.kind) {
    case 'group':
      return merge(none, { groups: [ch.id], follows: [['group', ch.id]] });
    case 'harbor':
      return merge(none, { harbors: [ch.id], follows: [['harbor', ch.id]] });
    case 'boat':
      return merge(none, { follows: [['boat', ch.id]] });
    case 'user': {
      const { results } = await env.DB.prepare(
        `SELECT m.group_id AS id FROM group_members m JOIN groups g ON g.id = m.group_id AND g.kind = 'team' WHERE m.user_id = ? LIMIT 100`,
      )
        .bind(ch.id)
        .all<{ id: string }>();
      return merge(none, { groups: results.map((r) => r.id), follows: [['user', ch.id]] });
    }
  }
}

/** Publikum je Stufe der Kette (kumuliert) und – in Gruppen – „Nur Mitglieder“; ein Batch. */
export async function audienceOfChannel(env: Env, ch: WritableChannel): Promise<Audience> {
  const levels: Array<[keyof Audience, Parts]> = [];
  let parts = await homeParts(env, ch);
  levels.push(['here', parts]);
  if (ch.chain.open && ch.chain.club) levels.push(['club', (parts = merge(parts, { groups: [ch.chain.club.id], follows: [['group', ch.chain.club.id]] }))]);
  if (ch.chain.open && ch.chain.harbor) levels.push(['harbor', (parts = merge(parts, { harbors: [ch.chain.harbor.id], follows: [['harbor', ch.chain.harbor.id]] }))]);
  if (ch.kind === 'group') levels.push(['members', { groups: [ch.id], follows: [], harbors: [] }]);
  const res = await env.DB.batch(
    levels.map(([, p]) => env.DB.prepare(AUDIENCE_SQL).bind(JSON.stringify(p.groups), JSON.stringify(p.follows), JSON.stringify(p.harbors))),
  );
  return Object.fromEntries(levels.map(([k], i) => [k, roundAudience((res[i].results[0] as { n: number }).n)]));
}

const AUDIENCE_TTL = 300;

/**
 * GET /api/me/compose/audience?ctx=<art>:<id> (Profil: `user`) – Publikum je Stufe für den Hinweis vor dem Posten
 * (F-465). Nur für Verläufe, in die das Konto schreiben darf (sonst 404, verrät keine Zahlen geschlossener Gruppen).
 * Die Zahlen sind für alle Schreibenden gleich und liegen 5 min im Worker-Cache (Schlüssel nur Art und ID).
 */
export async function getComposeAudience(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const url = new URL(request.url);
  const m = /^(user|group|harbor|boat)(?::([A-Za-z0-9]{12,32}))?$/.exec(url.searchParams.get('ctx') ?? '');
  const ch = m && isChannelKind(m[1]) ? await writableChannel(env, user.id, m[1], m[1] === 'user' ? user.id : (m[2] ?? '')) : null;
  if (!ch) throw new HttpError(404, 'not_found', 'In diesen Verlauf kannst du nicht schreiben.');
  const headers = { 'Cache-Control': 'private, no-store' };
  const key = new Request(`${url.origin}/__cache/compose-audience/${ch.kind}/${ch.id}`);
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return json(await hit.json(), { headers });
  const body = { audience: await audienceOfChannel(env, ch) };
  await cache?.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${AUDIENCE_TTL}` } })).catch(() => undefined);
  return json(body, { headers });
}
