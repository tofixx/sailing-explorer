// Funktionale Tests: Bootsklasse (Konzept 34) – Klasse beim Speichern (F-536) und Filter auf /entdecken (F-537).
// Echter Worker in workerd (Miniflare) mit lokaler D1 – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social } from './social-helpers';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface BoatOut { id: string; boatType: string; boatClass: string }
const boatOf = async (res: Response) => {
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return ((await res.json()) as { boat: BoatOut }).boat;
};

interface Found {
  voyages: Array<{ id: string }>;
  boats: Array<{ id: string; boatClass: string }>;
  people: Array<{ handle: string }>;
  harbors: Array<{ slug: string }>;
  groups: Array<{ slug: string }>;
  boatClass: string | null;
}
async function discover(klasse: string, cookie?: string): Promise<{ body: Found; res: Response }> {
  const res = await h.fetch(`/api/discover?limit=24${klasse ? `&klasse=${encodeURIComponent(klasse)}` : ''}`, { cookie });
  expect(res.status).toBe(200);
  return { body: (await res.clone().json()) as Found, res };
}

describe('F-536 Bootsklasse beim Speichern', () => {
  it('[F-536] ohne Wahl aus dem Typ abgeleitet, gewählte Klasse gilt, Unbekanntes zählt wie keine Wahl', async () => {
    const a = await s.person({ profile: 'public', supporter: true });
    const derived = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'A', boatType: 'Bavaria 34' }));
    expect(derived).toMatchObject({ boatType: 'Bavaria 34', boatClass: 'fahrtenyacht' });
    const chosen = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'B', boatType: 'Eigenbau', boatClass: 'drachen' }));
    expect(chosen.boatClass).toBe('drachen');
    const unknown = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'C', boatType: 'Folke', boatClass: 'gibtsnicht' }));
    expect(unknown.boatClass).toBe('folkeboot');
    const none = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'D' }));
    expect(none.boatClass).toBe('');
    // gelesen wie gespeichert
    expect(((await (await s.send('GET', `/api/boats/${chosen.id}`, undefined)).json()) as { boat: BoatOut }).boat.boatClass).toBe('drachen');
  });

  it('[F-536] Ändern: neuer Typ leitet neu ab, andere Felder lassen die Klasse stehen, Wahl überschreibt', async () => {
    const a = await s.person({ profile: 'public' });
    const b = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'Möwe', boatType: 'Optimist' }));
    expect(b.boatClass).toBe('optimist');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { name: 'Möwe II' }))).boatClass).toBe('optimist');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { boatType: '20er Jollenkreuzer', boatClass: '' }))).boatClass).toBe('jollenkreuzer');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { boatClass: 'sonstige' }))).boatClass).toBe('sonstige');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { boatClass: '' }))).boatClass).toBe('jollenkreuzer');
  });
});

describe('F-537 Entdecken nach Bootsklasse', () => {
  let a: Awaited<ReturnType<typeof s.person>>;
  let c: Awaited<ReturnType<typeof s.person>>;
  let ids: Record<string, string>;
  let slugs: Record<string, string>;

  beforeAll(async () => {
    a = await s.person({ profile: 'public', supporter: true });
    const b = await s.person({ profile: 'public', supporter: true });
    c = await s.person({ profile: 'public' });
    const harbor = ((await (await s.send('POST', '/api/harbors', a.cookie, { name: s.uniq('Folkehafen'), lat: -45, lon: -170 })).json()) as { harbor: { id: string; slug: string } }).harbor;
    const folke = await s.boat(a, { name: 'Folke A', boatType: 'Nordisches Folkeboot', harborId: harbor.id });
    const hidden = await s.boat(a, { name: 'Folke ausgeblendet', boatType: 'Folkeboot' });
    await (await s.db()).prepare('UPDATE boats SET hidden_at = 1 WHERE id = ?').bind(hidden.id).run();
    const privat = await s.boat(b, { name: 'Folke privat', boatType: 'Folkeboot', visibility: 'private' });
    const opti = await s.boat(c, { name: 'Opti C', boatType: 'Optimist' });
    const v1 = await s.share(a, { title: 'Mit Folkeboot', boatId: folke.id });
    const v2 = await s.share(b, { title: 'Mit privatem Folkeboot', boatId: privat.id });
    const v3 = await s.share(c, { title: 'Mit Opti', boatId: opti.id });
    const v4 = await s.share(a, { title: 'Ohne Boot' });
    // Vereine: öffentliche Bootsliste bzw. nur für Mitglieder
    const open = await s.group(a, { name: 'Offen', membersVisible: 'public' });
    const closed = await s.group(a, { name: 'Geschlossen', membersVisible: 'members' });
    for (const g of [open, closed]) expect((await s.send('POST', `/api/groups/${g.id}/boats`, a.cookie, { boatId: folke.id })).status).toBeLessThan(300);
    ids = { folke: folke.id, hidden: hidden.id, privat: privat.id, opti: opti.id, v1: v1.id, v2: v2.id, v3: v3.id, v4: v4.id };
    slugs = { harbor: harbor.slug, open: open.slug, closed: closed.slug };
  }, 60_000);

  it('[F-537] Klasse: nur Boote, Törns, Segler, Häfen und Vereine an einem öffentlichen Boot dieser Klasse', async () => {
    const { body } = await discover('folkeboot');
    expect(body.boatClass).toBe('folkeboot');
    const boats = body.boats.map((x) => x.id);
    expect(boats).toContain(ids.folke);
    for (const x of [ids.hidden, ids.privat, ids.opti]) expect(boats).not.toContain(x);
    expect(body.boats.every((x) => x.boatClass === 'folkeboot')).toBe(true);
    const voyages = body.voyages.map((x) => x.id);
    expect(voyages).toContain(ids.v1);
    for (const x of [ids.v2, ids.v3, ids.v4]) expect(voyages).not.toContain(x);
    const people = body.people.map((x) => x.handle);
    expect(people).toContain(a.handle);
    expect(people).not.toContain(c.handle);
    expect(body.harbors.map((x) => x.slug)).toContain(slugs.harbor);
    const groups = body.groups.map((x) => x.slug);
    expect(groups).toContain(slugs.open);
    // Bootsliste nur für Mitglieder: der Filter verrät sie nicht
    expect(groups).not.toContain(slugs.closed);
  });

  it('[F-537] Gruppe „alle Jollen“ fasst die Jollenklassen zusammen; unbekannter Wert filtert nicht', async () => {
    const jollen = (await discover('jollen')).body;
    expect(jollen.boatClass).toBe('jollen');
    expect(jollen.boats.map((x) => x.id)).toContain(ids.opti);
    expect(jollen.boats.map((x) => x.id)).not.toContain(ids.folke);
    expect(jollen.voyages.map((x) => x.id)).toEqual(expect.arrayContaining([ids.v3]));
    const unknown = (await discover('quatsch')).body;
    expect(unknown.boatClass).toBeNull();
    expect(unknown.voyages.map((x) => x.id)).toEqual(expect.arrayContaining([ids.v1, ids.v3, ids.v4]));
  });

  it('[F-537] Antwort für alle gleich und kurz öffentlich gecacht – Gast sieht nichts mehr, auch nach Abruf eines Mitglieds', async () => {
    const member = await discover('folkeboot', a.cookie);
    expect(member.res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(member.body.groups.map((x) => x.slug)).not.toContain(slugs.closed);
    const guest = await discover('folkeboot');
    expect(guest.body).toEqual(member.body);
  });

  it('[F-537] mit Suche und Umgebung kombinierbar (Platzhalter ?1 … ?4)', async () => {
    const res = await h.fetch(`/api/discover?limit=24&klasse=folkeboot&q=${encodeURIComponent('Folke A')}&harbor=${slugs.harbor}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Found;
    expect(body.boats.map((x) => x.id)).toEqual([ids.folke]);
  });
});
