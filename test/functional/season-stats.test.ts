// Saison-Zahlen der Community für den Gäste-Slider (F-431): GET /api/discover/stats zählt nur, was auch /entdecken zeigt,
// und ist für alle gleich gecacht. Echter Worker in workerd (Miniflare), eigene Datenbank – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, loginSupporter, startWorker, type Harness } from './worker-harness';
import { SEASON_STATS_MIN, seasonStatsShown } from '../../src/domain/season-stats';

let h: Harness;
let n = 0;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string, body: unknown) =>
  h.fetch(path, { method, cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function share(cookie: string, o: { visibility?: 'public' | 'unlisted'; boatId?: string; distNm: number }): Promise<string> {
  const headers: Record<string, string> = { 'X-Share-Distance': String(o.distNm) };
  if (o.boatId) headers['X-Share-Boat'] = o.boatId;
  const res = await createShare(h, cookie, { visibility: o.visibility ?? 'public', headers });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string } }).share.id;
}

describe('F-431 Saison-Zahlen (GET /api/discover/stats)', () => {
  it('[F-431] zählt öffentliche, nicht ausgeblendete Törns „Sichtbar bis: überall“ dieser Saison, ihre Seemeilen und Boote', async () => {
    const a = await loginSupporter(h, `stats${++n}@example.org`);
    const boat = await send('POST', '/api/boats', a.cookie, { name: 'Möwe', visibility: 'public' });
    expect(boat.status).toBe(201);
    const boatId = ((await boat.json()) as { boat: { id: string } }).boat.id;
    // gezählt: zwei öffentliche Törns, einer mit Boot
    await share(a.cookie, { distNm: 12, boatId });
    await share(a.cookie, { distNm: 8 });
    // nicht gezählt: nur mit Link, ausgeblendet, nur hier sichtbar, letzte Saison, Konto gesperrt
    await share(a.cookie, { distNm: 100, visibility: 'unlisted' });
    const hidden = await share(a.cookie, { distNm: 100 });
    const here = await share(a.cookie, { distNm: 100 });
    const old = await share(a.cookie, { distNm: 100 });
    const db = await h.db();
    await db.prepare('UPDATE shares SET hidden_at = ? WHERE id = ?').bind(Date.now(), hidden).run();
    await db.prepare("UPDATE posts SET reach = 'here' WHERE id = ?").bind(here).run();
    const lastYear = Date.UTC(new Date().getUTCFullYear() - 1, 6, 1);
    await db.prepare('UPDATE shares SET started_at = ?, created_at = ? WHERE id = ?').bind(lastYear, lastYear, old).run();
    const b = await loginSupporter(h, `stats${++n}@example.org`);
    await share(b.cookie, { distNm: 100 });
    await db.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), b.user.id).run();

    const res = await h.fetch('/api/discover/stats');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(await res.json()).toEqual({ season: new Date().getUTCFullYear(), voyages: 2, nm: 20, boats: 1 });
  });

  it('[F-431] kleine Zahlen zeigt die Folie nicht', () => {
    expect(seasonStatsShown({ season: 2026, voyages: 2, nm: 20, boats: 1 })).toBe(false);
    expect(seasonStatsShown({ season: 2026, ...SEASON_STATS_MIN, nm: 300 })).toBe(true);
    expect(seasonStatsShown(null)).toBe(false);
  });
});
