// Auffindbarkeit ohne App-Store (F-544 … F-546): /robots.txt und /sitemap.xml. Die Sitemap nennt nur, was ein Gast ohne
// Schlüssel sieht und was auch in Entdecken steht – gebaut aus den Sichtbarkeits-Bausteinen (visible-sql.ts) und
// `LISTED` aus discover.ts, damit sie nie mehr zeigt als die Seiten selbst (fail closed). Sie hängt nicht vom Betrachter
// ab (kein Cookie, keine Rolle) und ist deshalb öffentlich cachebar.
import type { Env } from './env';
import { LISTED } from './discover';
import { IN_LOGBOOK_SQL } from './logbook-sql';
import { xmlEscape } from './feed-xml';
import { liveSql, notSuspendedSql, publicSql } from './visible-sql';
import { indexableHost } from './canonical';

const TTL = 3600;
/** Höchstens so viele Einträge je Art – zusammen deutlich unter der Grenze von 50 000 URLs je Sitemap. */
export const SITEMAP_PER_KIND = 5000;

/** GET /robots.txt – Hauptdomain: alles erlaubt plus Sitemap; sonst (Vorschau, lokal) alles gesperrt. */
export function robotsTxt(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const body = indexableHost(url, env) ? `User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': `public, max-age=${TTL}` } });
}

/**
 * Pfade der Sitemap, je Art nach Sichtbarkeit wie auf der Seite bzw. in Entdecken (`discover.ts`):
 * - Vereine/Teams: öffentlich, nicht ausgeblendet oder gesperrt, Eigner nicht gesperrt
 * - Häfen: nicht ausgeblendet (die Sperre blendet aus), mit öffentlichem Boot oder öffentlicher Gruppe – wie `HARBORS`
 * - Törns: `LISTED` (öffentlich, „Sichtbar bis: überall“, Konto nicht gesperrt) – wie `VOYAGES` und die Törnseite (index)
 * - Boote: wie `BOATS` (öffentlich, öffentliches Eigner-Profil, Konto nicht gesperrt), zusätzlich nicht einzeln gesperrt
 * - Profile: wie `PEOPLE` (öffentlich, Konto nicht gesperrt, mit gelistetem Törn im Fahrtenbuch oder öffentlichem Boot)
 * Was sich ändert (Sichtbarkeit, Ausblenden, Sperre), verschwindet spätestens mit dem Cache nach einer Stunde; die Seite
 * selbst ist ab sofort nicht mehr sichtbar bzw. `noindex` (F-544).
 */
export async function sitemapPaths(env: Env): Promise<string[]> {
  const q = (sql: string) => env.DB.prepare(sql).bind(SITEMAP_PER_KIND).all<{ p: string }>().then((r) => r.results.map((x) => x.p));
  const [groups, harbors, voyages, boats, people] = await Promise.all([
    q(`SELECT '/g/' || g.slug AS p FROM groups g
       WHERE ${publicSql('g')} AND ${liveSql('g')} AND ${notSuspendedSql('g.owner_id')}
       ORDER BY g.updated_at DESC LIMIT ?1`),
    q(`SELECT '/h/' || h.slug AS p FROM harbors h
       WHERE h.hidden_at IS NULL
         AND (EXISTS (SELECT 1 FROM boats b WHERE b.harbor_id = h.id AND ${publicSql('b')} AND ${notSuspendedSql('b.owner_id')})
           OR EXISTS (SELECT 1 FROM groups g WHERE g.harbor_id = h.id AND ${publicSql('g')} AND ${notSuspendedSql('g.owner_id')}))
       ORDER BY h.updated_at DESC LIMIT ?1`),
    q(`SELECT '/s/' || s.id AS p FROM shares s WHERE ${LISTED} ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT ?1`),
    q(`SELECT '/b/' || b.id AS p FROM boats b JOIN profiles p ON p.user_id = b.owner_id AND ${publicSql('p')}
       WHERE ${publicSql('b')} AND ${liveSql('b')} AND ${notSuspendedSql('b.owner_id')}
       ORDER BY b.created_at DESC LIMIT ?1`),
    q(`SELECT '/u/' || lower(p.handle) AS p FROM profiles p
       WHERE ${publicSql('p')} AND ${notSuspendedSql('p.user_id')}
         AND (EXISTS (SELECT 1 FROM shares s WHERE s.user_id = p.user_id AND ${LISTED} AND ${IN_LOGBOOK_SQL})
           OR EXISTS (SELECT 1 FROM boats b WHERE b.owner_id = p.user_id AND ${publicSql('b')}))
       ORDER BY p.created_at DESC LIMIT ?1`),
  ]);
  return ['/', '/entdecken', ...groups, ...harbors, ...voyages, ...boats, ...people];
}

export function sitemapXml(origin: string, paths: string[]): string {
  const urls = paths.map((p) => `<url><loc>${xmlEscape(origin + p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** GET /sitemap.xml – nur auf der Hauptdomain (sonst 404, F-545); eine Stunde im Edge-Cache, unabhängig vom Betrachter. */
export async function sitemap(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!indexableHost(url, env)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const key = new Request(`${url.origin}/__cache/sitemap`);
  const hit = await cache?.match(key).catch(() => undefined);
  const body = hit ? await hit.text() : sitemapXml(url.origin, await sitemapPaths(env));
  if (!hit) await cache?.put(key, new Response(body, { headers: { 'Cache-Control': `max-age=${TTL}` } })).catch(() => undefined);
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': `public, max-age=${TTL}`, 'X-Content-Type-Options': 'nosniff' },
  });
}
