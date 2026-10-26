// Atom-Feed öffentlicher Gruppen (Konzept 11.4, F-162): /g/<slug>/feed.xml. Nur öffentliche, nicht ausgeblendete
// Gruppen; alle Texte (Nutzertext!) werden XML-escaped. Gecacht wie öffentliche Streams.
import type { Env } from './env';
import { HttpError } from './http';
import { groupItems } from './stream';
import { loadGroupBySlug } from './groups';
import { streamHeadline, streamPath, type StreamItem } from '../src/domain/groups';

/** XML-Escaping für Text und Attribute; entfernt in XML 1.0 verbotene Steuerzeichen. */
export function xmlEscape(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const iso = (ms: number) => new Date(ms).toISOString();

function entry(origin: string, i: StreamItem): string {
  const link = `${origin}${streamPath(i)}`;
  const title = streamHeadline(i);
  const body = i.post ? i.post.body + (i.post.link ? `\n\n${i.post.link}` : '') : title;
  return `<entry>
<id>${xmlEscape(`${origin}/activity/${i.id}`)}</id>
<title>${xmlEscape(title)}</title>
<link rel="alternate" href="${xmlEscape(link)}"/>
<updated>${iso(i.createdAt)}</updated>
${i.actor ? `<author><name>${xmlEscape(i.actor.displayName)}</name></author>` : ''}
<content type="text">${xmlEscape(body)}</content>
</entry>`;
}

/** Atom 1.0 aus Gruppenkopf und Einträgen – rein, damit das Escaping unit-testbar ist. */
export function atomFeed(origin: string, g: { slug: string; name: string; description: string; updated: number }, items: StreamItem[]): string {
  const self = `${origin}/g/${g.slug}/feed.xml`;
  const updated = items.length ? Math.max(...items.map((i) => i.createdAt)) : g.updated;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>${xmlEscape(`${origin}/g/${g.slug}`)}</id>
<title>${xmlEscape(`${g.name} · Sail Explorer`)}</title>
${g.description ? `<subtitle>${xmlEscape(g.description)}</subtitle>` : ''}
<link rel="self" href="${xmlEscape(self)}"/>
<link rel="alternate" href="${xmlEscape(`${origin}/g/${g.slug}`)}"/>
<updated>${iso(updated)}</updated>
<author><name>${xmlEscape(g.name)}</name></author>
${items.map((i) => entry(origin, i)).join('\n')}
</feed>
`;
}

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
