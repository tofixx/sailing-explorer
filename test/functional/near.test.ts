// Funktionale Tests: Umgebung im Community-Stream (F-340 … F-343) – Umkreis um Standort oder Heimathafen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker({ APP_ORIGIN: 'https://segeln.example' });
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

type Page = StreamOut & { near?: { places: number; center: { slug: string; name: string } | null } };
const voyageIds = (o: Page) => o.items.filter((i) => i.voyage).map((i) => i.voyage!.id);
const postIds = (o: Page) => o.items.filter((i) => i.post).map((i) => i.post!.id);

/** Hafen mit Position – weit weg von allen anderen Tests (Golf von Guinea), damit nur eigene Daten im Umkreis liegen. */
async function harborAt(p: Person, name: string, lat: number | null, lon: number | null) {
  const res = await s.send('POST', '/api/harbors', p.cookie, { name: `${name} ${s.uniq('h')}` });
  const { harbor } = (await res.json()) as { harbor: { id: string; slug: string; name: string } };
  if (lat !== null) expect((await s.send('PATCH', `/api/harbors/${harbor.id}`, p.cookie, { lat, lon })).status).toBe(200);
  return harbor;
}
const near = async (query: string) => {
  const res = await h.fetch(`/api/stream/near?${query}`);
  return { res, body: res.status === 200 ? ((await res.json()) as Page) : null };
};

describe('F-340 Umgebung', () => {
  it('[F-340] Törns aus Häfen im Umkreis und Beiträge von Gruppen mit Heimathafen dort – fernere und private nicht', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const close = await harborAt(owner, 'Nahhafen', 1.0, 1.0);
    const far = await harborAt(owner, 'Fernhafen', 1.0, 1.8); // ≈ 90 km östlich
    const vClose = await s.share(owner, { boatId: (await s.boat(owner, { harborId: close.id })).id });
    const vFar = await s.share(owner, { boatId: (await s.boat(owner, { harborId: far.id })).id });
    const vPrivBoat = await s.share(owner, { boatId: (await s.boat(owner, { harborId: close.id, visibility: 'private' })).id });
    const club = await s.group(owner, { name: 'Nahverein', harborId: close.id });
    const closed = await s.group(owner, { name: 'Geschlossen nah', harborId: close.id, visibility: 'private' });
    const pPub = await s.send('POST', `/api/groups/${club.id}/posts`, owner.cookie, { body: 'Hallo aus der Nähe' });
    const pPriv = await s.send('POST', `/api/groups/${closed.id}/posts`, owner.cookie, { body: 'Intern' });
    const pubId = ((await pPub.json()) as { post: { id: string } }).post.id;
    const privId = ((await pPriv.json()) as { post: { id: string } }).post.id;

    // Standort knapp neben dem Nahhafen, 25 km (Standard)
    const { res, body } = await near('lat=1.02&lon=1.03');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(voyageIds(body!)).toContain(vClose.id);
    expect(voyageIds(body!)).not.toContain(vFar.id);
    expect(voyageIds(body!)).not.toContain(vPrivBoat.id);
    expect(postIds(body!)).toContain(pubId);
    expect(postIds(body!)).not.toContain(privId);
    expect(JSON.stringify(body)).not.toContain('Intern');
    expect(body!.near).toEqual({ places: 2, center: null }); // Nahhafen + Nahverein
    // 100 km: auch der Fernhafen
    expect(voyageIds((await near('lat=1.02&lon=1.03&r=100')).body!)).toContain(vFar.id);
  });

  it('[F-341] Mittelpunkt Heimathafen: braucht eine Position (sonst 422), nennt den Hafen; Umkreis nur 10/25/50/100', async () => {
    const owner = await s.person({ profile: 'public' });
    const withPos = await harborAt(owner, 'Mittelhafen', 2.0, 2.0);
    const noPos = await harborAt(owner, 'Ohnehafen', null, null);
    const ok = await near(`harbor=${withPos.slug}`);
    expect(ok.res.status).toBe(200);
    expect(ok.body!.near?.center).toEqual({ slug: withPos.slug, name: withPos.name });
    expect((await near(`harbor=${noPos.slug}`)).res.status).toBe(422);
    expect((await near('harbor=gibt-es-nicht')).res.status).toBe(404);
    expect((await near('lat=2&lon=2&r=30')).res.status).toBe(400);
    expect((await near('lat=95&lon=2')).res.status).toBe(400);
    expect((await near('')).res.status).toBe(400);
  });

  it('[F-342] Standort wird gerundet: feinere Koordinaten ergeben dieselbe gecachte Seite', async () => {
    const a = await near('lat=3.04123&lon=3.01987');
    const b = await near('lat=3.0&lon=3.0');
    expect(a.res.status).toBe(200);
    expect(b.res.headers.get('X-Stream-Cache')).toBe('hit');
  });
});

describe('F-344 Entdecken in der Nähe', () => {
  it('[F-344] nur Boote, Häfen und Vereine im Umkreis, nächste zuerst, Häfen mit Entfernung; Törns nur über öffentliche Boote', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const a = await harborAt(owner, 'Erster', 4.0, 4.0);
    const b = await harborAt(owner, 'Zweiter', 4.0, 4.1); // ≈ 11 km
    const far = await harborAt(owner, 'Ferner', 4.0, 5.0); // ≈ 111 km
    const boatB = await s.boat(owner, { harborId: b.id, name: 'Bootb' });
    const boatA = await s.boat(owner, { harborId: a.id, name: 'Boota' });
    const boatFar = await s.boat(owner, { harborId: far.id, name: 'Bootfern' });
    const priv = await s.boat(owner, { harborId: a.id, name: 'Privatboot', visibility: 'private' });
    const vPriv = await s.share(owner, { boatId: priv.id });
    const vA = await s.share(owner, { boatId: boatA.id });
    const club = await s.group(owner, { name: 'Erster Verein', harborId: a.id });
    const res = await h.fetch('/api/discover?limit=24&lat=4.0&lon=4.0&r=25');
    expect(res.status).toBe(200);
    const d = (await res.json()) as { near: boolean; boats: Array<{ id: string }>; harbors: Array<{ slug: string; km?: number }>; groups: Array<{ slug: string }>; voyages: Array<{ id: string }> };
    expect(d.near).toBe(true);
    expect(d.boats.map((x) => x.id)).toEqual([boatA.id, boatB.id]);
    expect(d.boats.map((x) => x.id)).not.toContain(boatFar.id);
    expect(d.harbors.map((x) => x.slug)).toEqual([a.slug, b.slug]);
    expect(d.harbors[1].km).toBe(11);
    expect(d.groups.map((g) => g.slug)).toEqual([club.slug]);
    expect(d.voyages.map((v) => v.id)).toContain(vA.id);
    expect(d.voyages.map((v) => v.id)).not.toContain(vPriv.id);
    // ohne Mittelpunkt bzw. Hafen ohne Position: wie bisher alles
    const all = (await (await h.fetch('/api/discover?limit=24')).json()) as { near: boolean };
    expect(all.near).toBe(false);
    const noPos = await harborAt(owner, 'Ohnepos', null, null);
    expect(((await (await h.fetch(`/api/discover?limit=24&harbor=${noPos.slug}`)).json()) as { near: boolean }).near).toBe(false);
  });
});
