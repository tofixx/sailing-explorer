// Funktionale Tests: Regatten und Klassenvereinigungen (F-645 … F-654, Konzept 42) gegen den echten Worker (Miniflare).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { parseLog } from '../../src/domain/logbook';
import { groupRegattas, placeText, regattaCsv, resultDetails, type ClubRegattaRow } from '../../src/domain/regatta';
import { hasRegattaOverview } from '../../src/domain/groups';
import { inviteWhat } from '../../src/domain/invite-text';
import { seasonOf } from '../../src/domain/support';
import { regattaSeasons } from '../../src/domain/regatta';

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
  shared.from = await mk('Regattahafen', 52.39, 13.06);
  shared.to = await mk('Zielhafen', 52.38, 12.94);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const recent = (d = 2) => Date.now() - d * DAY;
interface Share { id: string }
async function regatta(p: Person, regatta: Record<string, unknown>, o: Record<string, unknown> = {}): Promise<Share> {
  const res = await s.send('POST', '/api/shares/manual', p.cookie, {
    startedAt: recent(), fromHarbor: { harborId: shared.from }, toHarbor: { harborId: shared.to }, distNm: 8, visibility: 'public', log: { regatta }, ...o,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: Share }).share;
}
interface Overview { season: number; regattas: Array<{ name: string; results: Array<{ person: { name: string }; regatta: { place?: number } }> }> }
// Saison der Testeinträge ausdrücklich (ab November zählen sie schon zur nächsten, vorgewählt ist die laufende)
const overview = async (p: Person | undefined, groupId: string) => s.send('GET', `/api/groups/${groupId}/regattas?saison=${seasonOf(recent())}`, p?.cookie);

describe('F-645 Klassenvereinigung', () => {
  it('[F-645] Gruppe der Art „Klassenvereinigung“ braucht eine Bootsklasse; ohne Hafen möglich; Einladungstext', async () => {
    const owner = await s.person({ profile: 'public' });
    const bad = await s.send('POST', '/api/groups', owner.cookie, { kind: 'class', name: 'Pirat-KV', slug: s.uniq('pirat') });
    expect(bad.status).toBe(400);
    expect(await s.errorOf(bad)).toBe('invalid_boat_class');
    const g = await s.group(owner, { kind: 'class', name: 'Deutsche Piratenklassenvereinigung', boatClass: 'pirat' });
    expect(g).toMatchObject({ kind: 'class' });
    expect(((await (await s.send('GET', `/api/groups/${g.id}`, owner.cookie)).json()) as { group: { boatClass: string } }).group.boatClass).toBe('pirat');
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { boatClass: 'unbekannt' })).status).toBe(400);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { boatClass: 'optimist' })).status).toBe(200);
    expect(hasRegattaOverview('class') && hasRegattaOverview('club') && !hasRegattaOverview('team')).toBe(true);
    expect(inviteWhat({ kind: 'group', groupKind: 'class', target: 'Pirat-KV' })).toBe('in die Klassenvereinigung „Pirat-KV“ ein');
  });
});

describe('F-646 Regatta-Angaben', () => {
  it('[F-646] Veranstalter, Wettfahrten, Punkte und Klasse werden geprüft und gespeichert', async () => {
    const ok = parseLog({ regatta: { name: 'Havelpokal', place: '3', starters: '20', organizer: ' PYC ', races: '6', points: '17,5'.replace(',', '.'), boatClass: 'pirat' } });
    expect('log' in ok && ok.log.regatta).toEqual({ name: 'Havelpokal', place: 3, starters: 20, organizer: 'PYC', races: 6, points: 17.5, boatClass: 'pirat' });
    expect(parseLog({ regatta: { name: 'X', boatClass: 'kanu' } })).toEqual({ error: 'Regatta: unbekannte Bootsklasse.' });
    expect(parseLog({ regatta: { name: 'X', races: 0 } })).toEqual({ error: 'Regatta: Wettfahrten 1 bis 999.' });
    expect(placeText({ place: 3, starters: 20 })).toBe('Platz 3 von 20');
    expect(resultDetails({ name: 'X', races: 1, points: 2.5, boatClass: 'pirat' })).toBe('1 Wettfahrt · 2,5 Pkt. · Pirat');
    const p = await s.person();
    const sh = await regatta(p, { name: 'Havelpokal', place: 2, starters: 9, races: 4, points: 8, organizer: 'PYC', boatClass: 'pirat' });
    const row = await (await s.db()).prepare('SELECT log FROM shares WHERE id = ?').bind(sh.id).first<{ log: string }>();
    expect(JSON.parse(row!.log).regatta).toMatchObject({ races: 4, points: 8, organizer: 'PYC', boatClass: 'pirat' });
  });
});

describe('F-647 / F-648 Meine Regatten', () => {
  it('[F-647] Crew sieht die Regatta der Eigentümer:in im eigenen Fahrtenbuch; [F-648] CSV je Saison', async () => {
    const owner = await s.person();
    const crew = await s.person();
    const sh = await regatta(owner, { name: 'Pfingstregatta', place: 5, starters: 12 });
    const inv = await s.send('POST', `/api/shares/${sh.id}/invites`, owner.cookie, {});
    const { link } = (await inv.json()) as { link: string };
    expect((await s.send('POST', '/api/invites/accept', crew.cookie, { token: /#token=([A-Za-z0-9_-]+)$/.exec(link)![1] })).status).toBe(200);
    const mine = (await (await s.send('GET', '/api/me/logbook', crew.cookie)).json()) as { entries: Array<{ id: string; log: { regatta?: { name: string } } }> };
    expect(mine.entries.find((e) => e.id === sh.id)?.log.regatta?.name).toBe('Pfingstregatta');

    const csv = await (await s.send('GET', '/api/me/regattas.csv?saison=alle', owner.cookie)).text();
    expect(csv.split('\r\n')[0]).toContain('Datum;Regatta;Veranstalter;Klasse');
    expect(csv).toContain('Pfingstregatta');
    expect(csv).toContain(';5;12;');
    expect((await s.send('GET', '/api/me/regattas.csv', undefined)).status).toBe(401);
  });

  it('[F-648] CSV schützt vor Formeln und nennt abgeschnittene Listen', () => {
    const csv = regattaCsv([{ startedAt: Date.UTC(2026, 5, 1), log: { regatta: { name: '=HYPERLINK("x")' } }, role: null, roleConfirmed: false, boat: null, boatClass: null } as never], true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('ältere fehlen');
  });
});

describe('F-649 / F-650 Regatta-Übersicht im Verein', () => {
  it('[F-650] Mitglieder sehen gezeigte öffentliche Regatten der Mitglieder, gebündelt je Regatta und nach Platz; Fremde 404', async () => {
    const owner = await s.person({ profile: 'public' });
    const club = await s.group(owner);
    const anna = await s.person({ profile: 'public' });
    const ben = await s.person();
    await s.join(owner, club, anna);
    await s.join(owner, club, ben);
    await regatta(anna, { name: 'Havelpokal', place: 4, starters: 20 }, { groupIds: [club.id] });
    await regatta(ben, { name: 'havelpokal ', place: 1, starters: 20 }, { groupIds: [club.id] });
    // nicht im Verein gezeigt, privat bzw. ohne Regatta: nicht dabei
    await regatta(anna, { name: 'Nur für mich', place: 1 }, { groupIds: [] });
    const ov = (await (await overview(anna, club.id)).json()) as Overview;
    expect(ov.regattas).toHaveLength(1);
    expect(ov.regattas[0].results.map((r) => r.regatta.place)).toEqual([1, 4]);
    expect(ov.regattas[0].results[1].person.name).toContain('Name');
    const stranger = await s.person();
    expect((await overview(stranger, club.id)).status).toBe(404);
    expect((await overview(undefined, club.id)).status).toBe(401);
  });

  it('[F-650] Datenschutz: private Boote ohne Namen, private Profile mit Spaßnamen der Gruppe, nicht öffentliche Einträge fehlen', async () => {
    const owner = await s.person({ profile: 'public' });
    const club = await s.group(owner);
    const shy = await s.person({ supporter: true });
    await (await s.db()).prepare(`INSERT INTO profiles (user_id, handle, display_name, bio, visibility, created_at, updated_at) VALUES (?, ?, 'Geheim', '', 'private', 0, 0)`)
      .bind(shy.user.id, s.uniq('geheim')).run();
    await s.join(owner, club, shy);
    const hidden = await s.boat(shy, { name: 'Verstecktes Boot', visibility: 'private' });
    await regatta(shy, { name: 'Stadtpokal', place: 2 }, { groupIds: [club.id], boatId: hidden.id });
    await regatta(shy, { name: 'Geheimregatta', place: 1 }, { groupIds: [club.id], visibility: 'unlisted' });
    const member = await s.person();
    await s.join(owner, club, member);
    const body = await (await overview(member, club.id)).text();
    expect(body).not.toContain('Verstecktes Boot');
    expect(body).not.toContain('Geheim"');
    expect(body).not.toContain('Geheimregatta');
    expect(body).toContain('Stadtpokal');
    // Eigner:in sieht Anzeigenamen (wie in der Mitgliederliste)
    expect(await (await overview(owner, club.id)).text()).toContain('"Geheim"');
  });

  it('[F-650] Teams haben keine Übersicht; Klassenvereinigung schon', async () => {
    const owner = await s.person();
    const team = await s.group(owner, { kind: 'team', name: 'Regattacrew' });
    expect((await overview(owner, team.id)).status).toBe(404);
    const owner2 = await s.person();
    const kv = await s.group(owner2, { kind: 'class', name: 'Optimist-KV', boatClass: 'optimist' });
    await regatta(owner2, { name: 'Opti-Cup', place: 2, starters: 30 }, { groupIds: [kv.id] });
    expect(((await (await overview(owner2, kv.id)).json()) as Overview).regattas.map((r) => r.name)).toEqual(['Opti-Cup']);
  });

  it('[F-651] Austritt, Löschen des Eintrags und „nicht mehr zeigen“ nehmen das Ergebnis aus der Übersicht', async () => {
    const owner = await s.person();
    const club = await s.group(owner);
    const a = await s.person();
    const b = await s.person();
    await s.join(owner, club, a);
    await s.join(owner, club, b);
    const sa = await regatta(a, { name: 'Herbstpreis', place: 1 }, { groupIds: [club.id] });
    const sb = await regatta(b, { name: 'Herbstpreis', place: 2 }, { groupIds: [club.id] });
    const sc = await regatta(owner, { name: 'Herbstpreis', place: 3 }, { groupIds: [club.id] });
    const count = async () => ((await (await overview(owner, club.id)).json()) as Overview).regattas[0]?.results.length ?? 0;
    expect(await count()).toBe(3);
    expect((await s.send('DELETE', `/api/groups/${club.id}/members/me`, a.cookie)).status).toBeLessThan(300);
    expect(await count()).toBe(2);
    expect((await s.send('DELETE', `/api/shares/${sb.id}`, b.cookie)).status).toBe(204);
    expect(await count()).toBe(1);
    expect((await s.send('PATCH', `/api/shares/${sc.id}`, owner.cookie, { groupIds: [] })).status).toBe(200);
    expect(await count()).toBe(0);
    void sa;
  });

  it('[F-650] Saisonwahl: ab November auch die begonnene nächste Saison', () => {
    expect(regattaSeasons(Date.UTC(2026, 10, 16))).toEqual([2027, 2026, 2025, 2024, 2023, 2022]);
    expect(regattaSeasons(Date.UTC(2026, 5, 1))).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it('[F-650] Bündeln: gleicher Name in derselben Woche ist eine Regatta, eine Woche später eine neue', () => {
    const row = (name: string, t: number, place?: number): ClubRegattaRow => ({ path: null, startedAt: t, regatta: { name, place }, person: { name: 'X', handle: null }, role: null, boat: null, boatClass: null });
    const t0 = Date.UTC(2026, 5, 1);
    const g = groupRegattas([row('Pokal', t0, 3), row('pokal', t0 + DAY, 1), row('Pokal', t0 + 10 * DAY)]);
    expect(g.map((x) => x.results.length)).toEqual([1, 2]);
    expect(g[1].results.map((r) => r.regatta.place)).toEqual([1, 3]);
  });
});
