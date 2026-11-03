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
  harbors: Array<{ slug: string; boats: number }>;
  groups: Array<{ slug: string }>;
  boatClass: string | null;
}
async function discover(klasse: string, cookie?: string): Promise<{ body: Found; res: Response }> {
  const res = await h.fetch(`/api/discover?limit=24${klasse ? `&klasse=${encodeURIComponent(klasse)}` : ''}`, { cookie });
  expect(res.status).toBe(200);
  return { body: (await res.clone().json()) as Found, res };
}

describe('F-536 Bootsklasse beim Speichern', () => {
  it('[F-536] neues Boot: gewählte Klasse gilt, ohne Wahl aus dem Typ abgeleitet, Unbekanntes 400', async () => {
    const a = await s.person({ profile: 'public', supporter: true });
    const derived = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'A', boatType: 'Bavaria 34' }));
    expect(derived).toMatchObject({ boatType: 'Bavaria 34', boatClass: 'fahrtenyacht' });
    const chosen = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'B', boatType: 'Folkeboot', boatClass: 'drachen' }));
    expect(chosen.boatClass).toBe('drachen');
    const none = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'C', boatType: 'Folkeboot', boatClass: '' }));
    expect(none.boatClass).toBe('');
    const bad = await s.send('POST', '/api/boats', a.cookie, { name: 'D', boatType: 'Folke', boatClass: 'gibtsnicht' });
    expect(bad.status).toBe(400);
    expect(await s.errorOf(bad)).toBe('invalid_boat_class');
    // gelesen wie gespeichert
    expect(((await (await s.send('GET', `/api/boats/${chosen.id}`, undefined)).json()) as { boat: BoatOut }).boat.boatClass).toBe('drachen');
  });

  it('[F-536] Ändern: gespeichert wird die Wahl; ein neuer Typ ändert eine vorhandene Klasse nicht, füllt nur eine leere', async () => {
    const a = await s.person({ profile: 'public' });
    const b = await boatOf(await s.send('POST', '/api/boats', a.cookie, { name: 'Möwe', boatType: 'Optimist' }));
    expect(b.boatClass).toBe('optimist');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { name: 'Möwe II' }))).boatClass).toBe('optimist');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { boatType: '20er Jollenkreuzer' }))).boatClass).toBe('optimist');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { boatClass: 'sonstige' }))).boatClass).toBe('sonstige');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { boatClass: '' }))).boatClass).toBe('');
    expect((await boatOf(await s.send('PATCH', `/api/boats/${b.id}`, a.cookie, { boatType: 'Drachen' }))).boatClass).toBe('drachen');
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
    const opti = await s.boat(c, { name: 'Opti C', boatType: 'Optimist', harborId: harbor.id });
    // Hafen nur mit Booten einer anderen Klasse
    const optiHarbor = ((await (await s.send('POST', '/api/harbors', c.cookie, { name: s.uniq('Optihafen'), lat: -45, lon: -170 })).json()) as { harbor: { slug: string; id: string } }).harbor;
    await s.boat(c, { name: 'Opti D', boatType: 'Optimist', harborId: optiHarbor.id });
    // gesperrtes Konto mit Folkeboot in eigenem Hafen und in einem offenen Verein (Eigner:in des Vereins nicht gesperrt)
    const d = await s.person({ profile: 'public', supporter: true });
    const dHarbor = ((await (await s.send('POST', '/api/harbors', d.cookie, { name: s.uniq('Sperrhafen'), lat: -45, lon: -170 })).json()) as { harbor: { slug: string; id: string } }).harbor;
    const dBoat = await s.boat(d, { name: 'Folke gesperrt', boatType: 'Folkeboot', harborId: dHarbor.id });
    const dClub = await s.group(a, { name: 'Verein mit gesperrtem Boot', membersVisible: 'public' });
    await s.join(a, dClub, d);
    expect((await s.send('POST', `/api/groups/${dClub.id}/boats`, d.cookie, { boatId: dBoat.id })).status).toBeLessThan(300);
    await (await s.db()).prepare('UPDATE users SET suspended_at = 1 WHERE id = ?').bind(d.user.id).run();
    const v1 = await s.share(a, { title: 'Mit Folkeboot', boatId: folke.id });
    const v2 = await s.share(b, { title: 'Mit privatem Folkeboot', boatId: privat.id });
    const v3 = await s.share(c, { title: 'Mit Opti', boatId: opti.id });
    const v4 = await s.share(a, { title: 'Ohne Boot' });
    // Vereine: öffentliche Bootsliste bzw. nur für Mitglieder
    const open = await s.group(a, { name: 'Offen', membersVisible: 'public' });
    const closed = await s.group(a, { name: 'Geschlossen', membersVisible: 'members' });
    for (const g of [open, closed]) expect((await s.send('POST', `/api/groups/${g.id}/boats`, a.cookie, { boatId: folke.id })).status).toBeLessThan(300);
    ids = { folke: folke.id, hidden: hidden.id, privat: privat.id, opti: opti.id, v1: v1.id, v2: v2.id, v3: v3.id, v4: v4.id };
    slugs = { harbor: harbor.slug, open: open.slug, closed: closed.slug, optiHarbor: optiHarbor.slug, dHarbor: dHarbor.slug, dClub: dClub.slug };
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
    // Hafen nur mit anderen Klassen bzw. nur mit dem Boot eines gesperrten Kontos: nicht dabei
    expect(body.harbors.map((x) => x.slug)).not.toContain(slugs.optiHarbor);
    expect(body.harbors.map((x) => x.slug)).not.toContain(slugs.dHarbor);
    expect(body.groups.map((x) => x.slug)).not.toContain(slugs.dClub);
    const groups = body.groups.map((x) => x.slug);
    expect(groups).toContain(slugs.open);
    // Bootsliste nur für Mitglieder: der Filter verrät sie nicht
    expect(groups).not.toContain(slugs.closed);
  });

  it('[F-537] Hafen zählt unter dem Filter nur Boote dieser Klassen', async () => {
    const count = async (k: string) => (await discover(k)).body.harbors.find((x) => x.slug === slugs.harbor)?.boats;
    expect(await count('folkeboot')).toBe(1);
    expect(await count('jollen')).toBe(1);
    expect(await count('')).toBe(2);
  });

  it('[F-537] Gruppe „alle Jollen“ fasst die Jollenklassen zusammen; unbekannter Wert filtert nicht', async () => {
    const jollen = (await discover('jollen')).body;
    expect(jollen.boatClass).toBe('jollen');
    expect(jollen.boats.map((x) => x.id)).toContain(ids.opti);
    expect(jollen.boats.map((x) => x.id)).not.toContain(ids.folke);
    expect(jollen.voyages.map((x) => x.id)).toEqual(expect.arrayContaining([ids.v3]));
    const unknown = (await discover('quatsch')).body;
    expect(unknown.boatClass).toBeNull();
    // „Sonstige“ ist nur eine Wahl am Boot, kein Filter
    expect((await discover('sonstige')).body.boatClass).toBeNull();
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
