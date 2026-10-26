// Atom-Feed als Text (Konzept 11.4, F-162) – rein, ohne Worker-APIs, damit das Escaping unit-testbar ist.
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

