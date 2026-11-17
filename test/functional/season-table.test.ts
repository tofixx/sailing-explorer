// Funktionale Tests: Jahresansicht der Fahrten und Regatten im Profil (F-665 … F-669, Konzept 43) – echter Worker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { rowsOfSeason, seasonSummaries, seasonTableMode, type SeasonRow } from '../../src/domain/season-table';
import { filterEntries, logbookTotals, type LogbookEntry } from '../../src/domain/logbook-year';

const DAY = 86_400_000;
let h: Harness;
let s: ReturnType<typeof social>;
const shared = { from: '', to: '' };

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
  const owner = await s.person();
  const mk = async (name: string, lat: number, lon: number) =>
    ((await (await s.send('POST', '/api/harbors', owner.cookie, { name: s.uniq(name), lat, lon })).json()) as { harbor: { id: string } }).harbor.id;
  shared.from = await mk('Jahreshafen', 52.39, 13.06);
  shared.to = await mk('Jahresziel', 52.38, 12.94);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

async function entry(p: Person, o: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await s.send('POST', '/api/shares/manual', p.cookie, {
    startedAt: Date.now() - 2 * DAY, fromHarbor: { harborId: shared.from }, toHarbor: { harborId: shared.to }, distNm: 8, visibility: 'public', ...o,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string } }).share;
}
interface Table { mode: string; self: boolean; rows: Array<{ title: string | null; regatta: { name: string } | null; own: boolean }> }
const table = (handle: string, p?: Person) => s.send('GET', `/api/profiles/${handle}/seasons`, p?.cookie);

describe('F-665 Jahresansicht: Regeln', () => {
  it('[F-665] Summen stimmen mit „Mein Fahrtenbuch“ überein (Anzahl und Seemeilen je Saison)', () => {
    const e = (t: number, nm: number) => ({ id: String(t), own: true, path: null, title: null, startedAt: t, endedAt: null, timed: false, source: 'manual', distNm: nm,
      distSource: 'stated', from: null, to: null, role: null, roleConfirmed: false, boat: null, boatClass: null, logState: 'confirmed', log: {} }) as unknown as LogbookEntry;
    const entries = [e(Date.UTC(2026, 4, 1), 7.3), e(Date.UTC(2026, 7, 1), 2.2)];
    const rows: SeasonRow[] = entries.map((x) => ({ path: null, title: null, startedAt: x.startedAt, distNm: x.distNm, recorded: false, role: null, boat: null, own: true, regatta: null }));
    const t = logbookTotals(filterEntries(entries, ['confirmed', 'suggested'], 2026));
    expect(seasonSummaries(rows)[0]).toMatchObject({ voyages: t.count, nm: Math.round(t.nm * 10) / 10 });
  });

  it('[F-665] Summen je Saison (ab November die nächste), beste Platzierung, Fahrten einer Saison', () => {
    const row = (t: number, nm: number, recorded: boolean, place?: number): SeasonRow => ({
      path: null, title: 'x', startedAt: t, distNm: nm, recorded, role: null, boat: null, own: true, regatta: place ? { name: 'R', place } : null,
    });
    const rows = [row(Date.UTC(2026, 5, 1), 10, true, 4), row(Date.UTC(2026, 6, 1), 5.55, false, 2), row(Date.UTC(2026, 10, 2), 3, true)];
    expect(seasonSummaries(rows)).toEqual([
      { season: 2027, voyages: 1, nm: 3, recordedNm: 3, regattas: 0, bestPlace: null },
      { season: 2026, voyages: 2, nm: 15.6, recordedNm: 10, regattas: 2, bestPlace: 2 },
    ]);
    expect(rowsOfSeason(rows, 2026).map((r) => r.distNm)).toEqual([5.55, 10]);
    expect(seasonTableMode('irgendwas')).toBe('private');
  });
});

describe('F-666 / F-667 Eigene Ansicht und Freigabe', () => {
  it('[F-666] eigene Ansicht mit allen Fahrten (auch privaten); andere 404, bis freigegeben; dann nur öffentliche', async () => {
    const me = await s.person({ profile: 'public', supporter: true });
    await entry(me, { title: 'Öffentlich', log: { regatta: { name: 'Havelpokal', place: 3 } } });
    await entry(me, { title: 'Privat', visibility: 'private' });
    const handle = me.handle!;
    const mine = (await (await table(handle, me)).json()) as Table;
    expect(mine).toMatchObject({ mode: 'private', self: true });
    expect(mine.rows.map((r) => r.title).sort()).toEqual(['Privat', 'Öffentlich']);

    const other = await s.person();
    expect((await table(handle, other)).status).toBe(404);
    expect((await table(handle)).status).toBe(404);

    expect((await s.send('PUT', '/api/me/season-table', me.cookie, { mode: 'alle' })).status).toBe(400);
    expect((await s.send('PUT', '/api/me/season-table', me.cookie, { mode: 'public' })).status).toBe(200);
    const shown = (await (await table(handle)).json()) as Table;
    expect(shown.self).toBe(false);
    expect(shown.rows.map((r) => r.title)).toEqual(['Öffentlich']);
    expect(shown.rows[0].regatta?.name).toBe('Havelpokal');
    expect(((await (await s.send('GET', `/api/profiles/${handle}`, undefined)).json()) as { profile: { seasonTable: string } }).profile.seasonTable).toBe('public');

    // Vorschau der eigenen Seite: die Sicht der anderen; Fremde dürfen das nicht anfragen
    const asOthers = (await (await s.send('GET', `/api/profiles/${handle}/seasons?as=andere`, me.cookie)).json()) as Table;
    expect(asOthers.self).toBe(false);
    expect(asOthers.rows.map((r) => r.title)).toEqual(['Öffentlich']);
    expect((await s.send('GET', `/api/profiles/${handle}/seasons?as=andere`, other.cookie)).status).toBe(400);

    // zurück auf „nur ich“
    expect((await s.send('PUT', '/api/me/season-table', me.cookie, { mode: 'private' })).status).toBe(200);
    expect((await table(handle)).status).toBe(404);
  });

  it('[F-667] privates Profil: freigegebene Ansicht bleibt für andere 404; ohne Profil kein Schalter', async () => {
    const shy = await s.person({ profile: 'private' });
    expect((await s.send('PUT', '/api/me/season-table', shy.cookie, { mode: 'public' })).status).toBe(200);
    expect((await table(shy.handle!)).status).toBe(404);
    const none = await s.person();
    expect((await s.send('PUT', '/api/me/season-table', none.cookie, { mode: 'public' })).status).toBe(404);
  });
});

describe('F-668 Crew und Boote in der Ansicht', () => {
  it('[F-668] öffentliche Crew-Törns erscheinen als Crew mit Regatta; private Boote ohne Namen', async () => {
    const skipper = await s.person({ supporter: true });
    const crew = await s.person({ profile: 'public' });
    const hidden = await s.boat(skipper, { name: 'Geheime Jolle', visibility: 'private' });
    const sh = await entry(skipper, { title: 'Pokal', boatId: hidden.id, log: { regatta: { name: 'Pokalregatta', place: 1 } } });
    const inv = await s.send('POST', `/api/shares/${sh.id}/invites`, skipper.cookie, {});
    const { link } = (await inv.json()) as { link: string };
    expect((await s.send('POST', '/api/invites/accept', crew.cookie, { token: /#token=([A-Za-z0-9_-]+)$/.exec(link)![1] })).status).toBe(200);
    await s.send('PUT', '/api/me/season-table', crew.cookie, { mode: 'public' });
    const body = await (await table(crew.handle!)).text();
    expect(body).toContain('Pokalregatta');
    expect(body).not.toContain('Geheime Jolle');
    expect((JSON.parse(body) as Table).rows[0].own).toBe(false);
  });
});

describe('F-669 Löschen', () => {
  it('[F-669] gelöschte und ausgeschlossene Einträge fehlen; Konto löschen nimmt den Schalter mit dem Profil', async () => {
    const me = await s.person({ profile: 'public' });
    await entry(me, { title: 'Bleibt' });
    const b = await entry(me, { title: 'Weg' });
    const c = await entry(me, { title: 'Ausgeschlossen' });
    expect((await s.send('DELETE', `/api/shares/${b.id}`, me.cookie)).status).toBe(204);
    expect((await s.send('PATCH', `/api/shares/${c.id}`, me.cookie, { logState: 'excluded' })).status).toBe(200);
    await s.send('PUT', '/api/me/season-table', me.cookie, { mode: 'public' });
    expect(((await (await table(me.handle!)).json()) as Table).rows.map((r) => r.title)).toEqual(['Bleibt']);
    expect(((await (await table(me.handle!, me)).json()) as Table).rows.map((r) => r.title)).toEqual(['Bleibt']);
    expect((await s.send('DELETE', '/api/account', me.cookie)).status).toBe(200);
    expect(await (await s.db()).prepare('SELECT 1 AS x FROM profiles WHERE user_id = ?').bind(me.user.id).first()).toBeNull();
  });
});
