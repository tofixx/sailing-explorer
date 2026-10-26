// Atom-Feed öffentlicher Gruppen (Konzept 11.4, F-162): /g/<slug>/feed.xml. Nur öffentliche, nicht ausgeblendete
// Gruppen; alle Texte (Nutzertext!) werden XML-escaped. Gecacht wie öffentliche Streams.
import type { Env } from './env';
import { HttpError } from './http';
import { groupItems } from './stream';
import { loadGroupBySlug } from './groups';
import { atomFeed } from './feed-xml';

const TTL = 600;

/** GET /g/<slug>/feed.xml */
export async function groupFeed(request: Request, env: Env, slug: string): Promise<Response> {
  const g = await loadGroupBySlug(env, slug);
  if (!g || g.visibility !== 'public' || g.hidden_at) throw new HttpError(404, 'not_found', 'Diesen Feed gibt es nicht.');
  const origin = new URL(request.url).origin;
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const key = new Request(`${origin}/__cache/groups/${g.id}/feed`);
  const hit = await cache?.match(key).catch(() => undefined);
  const body = hit
    ? await hit.text()
    : atomFeed(origin, { slug: g.slug, name: g.name, description: g.description, updated: g.updated_at }, (await groupItems(env, g.id, { id: null }, { at: Number.MAX_SAFE_INTEGER, id: '~' })).items);
  if (!hit) await cache?.put(key, new Response(body, { headers: { 'Cache-Control': `max-age=${TTL}` } })).catch(() => undefined);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${TTL}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
