// Revier-Wärmekarte (Konzept 37): Raster je Törn schreiben (F-581), zusammengefasste Karte lesen (F-582), Löschwege
// (F-583). Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts. Die Antwort ist
// je Worker 15 min gecacht: deshalb liest dieser Test die Karte genau einmal, nachdem alles angelegt ist.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, loginSupporter, startWorker, type Harness } from './worker-harness';
import { HEAT, cellOf, type HeatData } from '../../src/domain/heat';

let h: Harness;
let n = 0;
const mail = () => `heat${++n}-${Date.now()}@example.org`;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const put = (id: string, cookie: string | undefined, body: unknown) =>
  h.fetch(`/api/shares/${id}/heat`, { method: 'PUT', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function share(cookie: string, visibility = 'public'): Promise<string> {
  const res = await createShare(h, cookie, { visibility, headers: { 'X-Share-Distance': '5' } });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string } }).share.id;
}

const [I, J] = cellOf(52.4, 13.0);
/** Raster mit `k` Zellen nach Norden ab Potsdam, verschoben um `dj` Spalten */
const cells = (k: number, dj = 0) => Array.from({ length: k }, (_, x) => [I + x, J + dj]).flat();

async function heatFile(id: string): Promise<unknown> {
  const obj = await (await h.r2()).get(`heat/${id}.json`);
  return obj ? JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) : null;
}

describe('F-581 Raster schreiben (PUT /api/shares/:id/heat)', () => {
  it('[F-581] nur der Eigentümer, nur gültige Raster, nur GPX-Törns; ersetzt das vorige', async () => {
    const a = await loginSupporter(h, mail());
    const b = await login(h, mail());
    const id = await share(a.cookie);
    expect((await put(id, undefined, { cells: cells(3) })).status).toBe(401);
    expect((await put(id, b.cookie, { cells: cells(3) })).status).toBe(404);
    expect((await put(id, a.cookie, { cells: [1, 2, 3] })).status).toBe(400);
    expect((await put(id, a.cookie, { cells: cells(HEAT.maxCells + 1) })).status).toBe(400);
    expect(await heatFile(id)).toBeNull();
    expect((await put(id, a.cookie, { cells: cells(3) })).status).toBe(204);
    expect((await put(id, a.cookie, { cells: cells(2) })).status).toBe(204);
    expect(await heatFile(id)).toEqual({ cells: cells(2) });

    const manual = await share(a.cookie);
    await (await h.db()).prepare("UPDATE shares SET source = 'manual' WHERE id = ?").bind(manual).run();
    expect((await put(manual, a.cookie, { cells: cells(3) })).status).toBe(409);

    const suspended = await share(b.cookie);
    await (await h.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), b.user.id).run();
    expect((await put(suspended, b.cookie, { cells: cells(3) })).status).toBe(403);
  });
});

describe('F-583 Löschwege des Rasters', () => {
  it('[F-583] verschwindet mit dem Törn und mit dem Konto', async () => {
    const a = await loginSupporter(h, mail());
    const one = await share(a.cookie);
    const two = await share(a.cookie);
    for (const id of [one, two]) expect((await put(id, a.cookie, { cells: cells(2) })).status).toBe(204);
    expect((await h.fetch(`/api/shares/${one}`, { method: 'DELETE', cookie: a.cookie })).status).toBe(204);
    expect(await heatFile(one)).toBeNull();
    expect(await heatFile(two)).not.toBeNull();
    expect((await h.fetch('/api/account', { method: 'DELETE', cookie: a.cookie })).status).toBe(200);
    expect(await heatFile(two)).toBeNull();
  });
});

describe('F-582 Wärmekarte (GET /api/discover/heat)', () => {
  it('[F-582] nur öffentliche GPX-Törns „Sichtbar bis: überall“, ohne Namen und Zeiten; für Gast und Mitglied gleich und öffentlich gecacht', async () => {
    const a = await loginSupporter(h, mail());
    await h.fetch('/api/me/profile', { method: 'PUT', cookie: a.cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: `heat${n}x`, displayName: 'Geheimname', visibility: 'public' }) });
    const db = await h.db();
    // gezeigt: zwei öffentliche Törns, die sich in zwei Zellen überlappen
    const shown1 = await share(a.cookie);
    const shown2 = await share(a.cookie);
    // nicht gezeigt: nur mit Link, privat, ausgeblendet, „Sichtbar bis“ enger, Konto gesperrt, Fahrtenbuch ohne GPX
    const link = await share(a.cookie, 'unlisted');
    const priv = await share(a.cookie, 'private');
    const hidden = await share(a.cookie);
    const here = await share(a.cookie);
    const manual = await share(a.cookie);
    const b = await loginSupporter(h, mail());
    const banned = await share(b.cookie);
    // eigene Spalten, damit Törns der anderen Tests (auch öffentlich) nicht mitzählen
    const base = 1000;
    const away = 50; // eigene Spalte je ausgeschlossenem Törn
    let k = 0;
    for (const id of [shown1, link, priv, hidden, here, manual, banned]) {
      expect((await put(id, id === banned ? b.cookie : a.cookie, { cells: id === shown1 ? cells(4, base) : cells(2, base + away + ++k) })).status).toBe(204);
    }
    expect((await put(shown2, a.cookie, { cells: cells(2, base) })).status).toBe(204);
    await db.prepare('UPDATE shares SET hidden_at = ? WHERE id = ?').bind(Date.now(), hidden).run();
    await db.prepare("UPDATE posts SET reach = 'here' WHERE id = ?").bind(here).run();
    await db.prepare("UPDATE shares SET source = 'manual' WHERE id = ?").bind(manual).run();
    await db.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), b.user.id).run();
    // kaputte Datei eines öffentlichen Törns: fällt weg, die Karte bleibt
    const broken = await share(a.cookie);
    await (await h.r2() as unknown as { put(k: string, v: string): Promise<unknown> }).put(`heat/${broken}.json`, '{kaputt');

    // erst ein Mitglied (mit Cookie), dann ein Gast: dieselbe Antwort, kein Betrachter-Bezug
    const member = await h.fetch('/api/discover/heat', { cookie: a.cookie });
    expect(member.status).toBe(200);
    expect(member.headers.get('Cache-Control')).toBe(`public, max-age=${HEAT.ttl}`);
    const text = await member.text();
    const guest = await h.fetch('/api/discover/heat');
    expect(await guest.text()).toBe(text);

    const data = JSON.parse(text) as HeatData;
    const ids = data.voyages.map((v) => v[0]);
    expect(ids).toEqual(expect.arrayContaining([shown1, shown2]));
    for (const id of [link, priv, hidden, here, manual, banned, broken]) expect(ids).not.toContain(id);
    // überlappende Zellen zählen zwei Törns, meiste zuerst; ausgeschlossene Spalten fehlen
    const mine = Array.from({ length: data.cells.length / 3 }, (_, x) => data.cells.slice(3 * x, 3 * x + 3)).filter(([, j]) => j >= J + base);
    expect(mine).toEqual([[I, J + base, 2], [I + 1, J + base, 2], [I + 2, J + base, 1], [I + 3, J + base, 1]]);
    expect(data.cells.slice(0, 3)).toEqual([I, J + base, 2]);
    expect(text).not.toContain('Geheimname');
    expect(text).not.toMatch(/handle|title|time|started|user/i);

    // gecacht: ein neuer Törn erscheint erst nach Ablauf
    const later = await share(a.cookie);
    expect((await put(later, a.cookie, { cells: cells(2, base + 7) })).status).toBe(204);
    expect(await (await h.fetch('/api/discover/heat')).text()).toBe(text);
  });
});
