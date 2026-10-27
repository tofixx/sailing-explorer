// Funktionale Tests: Titelbilder, Galerien und Heimathafen von Vereinen/Teams (Konzept 13, F-190 … F-198).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { COVER_BYTES } from '../../src/domain/limits';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

// ---------------------------------------------------------------- Bilder (nur Kopfdaten, der Worker dekodiert nichts)

const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
const chunk = (id: string, data: number[]) => [...[...id].map((c) => c.charCodeAt(0)), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
function webp(w: number, hh: number, extra: number[][] = []): Uint8Array<ArrayBuffer> {
  const vp8 = chunk('VP8 ', [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, hh & 0xff, (hh >> 8) & 0x3f, ...new Array<number>(20).fill(0)]);
  const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...extra.flat(), ...vp8];
  return new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
}
function jpeg(w: number, hh: number, segments: number[][] = []): Uint8Array<ArrayBuffer> {
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, hh >> 8, hh & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), ...sof, ...sos, ...new Array<number>(32).fill(0x11), 0xff, 0xd9]);
}
const APP1 = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

const putCover = (kind: string, id: string, cookie: string | undefined, body: Uint8Array<ArrayBuffer> = webp(1500, 500)) =>
  h.fetch(`/api/covers/${kind}/${id}`, { method: 'PUT', cookie, headers: { 'Content-Type': 'application/octet-stream' }, body });

async function counter(): Promise<number> {
  return (await (await h.db()).prepare(`SELECT value FROM counters WHERE name = 'storage_bytes'`).first<{ value: number }>())?.value ?? 0;
}

/** Foto an einem Törn hochladen (Unterstützer); Metadaten wie in photos.test.ts. */
async function photo(owner: Person, shareId: string, o: { visibility?: string; caption?: string } = {}): Promise<string> {
  const full = jpeg(1600, 1200);
  const thumb = jpeg(400, 300);
  const body = new Uint8Array(full.length + thumb.length);
  body.set(thumb);
  body.set(full, thumb.length);
  const res = await h.fetch(`/api/shares/${shareId}/photos`, {
    method: 'POST',
    cookie: owner.cookie,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Photo-Thumb-Length': String(thumb.length),
      'X-Photo-Meta': encodeURIComponent(JSON.stringify({ caption: o.caption ?? 'Ankerbucht', takenAt: null, lat: null, lon: null, placement: 'none', visibility: o.visibility ?? 'public' })),
    },
    body,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { photo: { id: string } }).photo.id;
}

// ---------------------------------------------------------------- Titelbilder

describe('Titelbilder (Konzept 13.2)', () => {
  it('F-190: Profil – eigenes Titelbild hochladen, anzeigen, ersetzen und entfernen; Zähler folgt', async () => {
    const me = await s.person({ profile: 'public' });
    const before = await counter();
    const up = await putCover('u', me.handle!, me.cookie);
    expect(up.status, await up.clone().text()).toBe(201);
    const { cover } = (await up.json()) as { cover: string };
    expect(cover).toMatch(new RegExp(`^/api/covers/u/${me.handle}/[A-Za-z0-9]+$`));
    expect(await counter()).toBe(before + webp(1500, 500).length);

    const page = (await (await s.send('GET', `/api/profiles/${me.handle}`, undefined)).json()) as { cover: string | null };
    expect(page.cover).toBe(cover);
    const img = await h.fetch(cover);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/webp');
    expect(img.headers.get('Cache-Control')).toBe('public, max-age=86400');

    // Ersetzen: neue Adresse, alte liefert 404, alte Datei ist weg
    const again = (await (await putCover('u', me.handle!, me.cookie, jpeg(1200, 400))).json()) as { cover: string };
    expect(again.cover).not.toBe(cover);
    expect((await h.fetch(cover)).status).toBe(404);
    expect((await h.fetch(again.cover)).headers.get('Content-Type')).toBe('image/jpeg');
    const keys = (await (await h.r2()).list({ prefix: `covers/u/${me.user.id}/` })).objects;
    expect(keys).toHaveLength(1);
    expect(await counter()).toBe(before + jpeg(1200, 400).length);

    expect((await s.send('DELETE', `/api/covers/u/${me.handle}`, me.cookie)).status).toBe(204);
    const after = (await (await s.send('GET', `/api/profiles/${me.handle}`, undefined)).json()) as { cover: string | null };
    expect(after.cover).toBeNull();
    expect((await (await h.r2()).list({ prefix: `covers/u/${me.user.id}/` })).objects).toHaveLength(0);
    expect(await counter()).toBe(before);
  });

  it('F-191: nur Verwalter ändern; Metadaten, falsches Format und Übergröße werden abgelehnt', async () => {
    const me = await s.person({ profile: 'public' });
    const other = await s.person({ profile: 'public' });
    expect((await putCover('u', me.handle!, other.cookie)).status).toBe(404);
    expect((await putCover('u', me.handle!, undefined)).status).toBe(401);
    expect((await s.send('DELETE', `/api/covers/u/${me.handle}`, other.cookie)).status).toBe(404);

    const exif = await putCover('u', me.handle!, me.cookie, jpeg(1500, 500, [APP1]));
    expect(exif.status).toBe(400);
    expect(await s.errorOf(exif)).toBe('image_metadata');
    const big = await putCover('u', me.handle!, me.cookie, webp(1600, 500));
    expect(big.status).toBe(400);
    expect(await s.errorOf(big)).toBe('too_large');
    const png = await putCover('u', me.handle!, me.cookie, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    expect(await s.errorOf(png)).toBe('invalid_image');
    // als Stream ohne Content-Length – sonst bricht der Worker sofort ab und die Verbindung setzt beim Senden zurück
    const big2 = new Uint8Array(COVER_BYTES + 1);
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (at >= big2.length) return c.close();
        c.enqueue(big2.slice(at, at + 64 * 1024));
        at += 64 * 1024;
      },
    });
    const huge = await h.fetch(`/api/covers/u/${me.handle}`, { method: 'PUT', cookie: me.cookie, headers: { 'Content-Type': 'application/octet-stream' }, body, duplex: 'half' } as unknown as RequestInit & { cookie?: string });
    expect(huge.status).toBe(413);
  });

  it('F-192: Boot – Eigner ja, Fremde nein; privates Boot: Bild nur für Verwalter', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const other = await s.person({ profile: 'public' });
    const b = await s.boat(owner, { visibility: 'private' });
    expect((await putCover('b', b.id, other.cookie)).status).toBe(404);
    const { cover } = (await (await putCover('b', b.id, owner.cookie)).json()) as { cover: string };
    expect((await h.fetch(cover, { cookie: owner.cookie })).status).toBe(200);
    expect((await h.fetch(cover, { cookie: owner.cookie })).headers.get('Cache-Control')).toBe('private, no-cache');
    expect((await h.fetch(cover, { cookie: other.cookie })).status).toBe(404);
    expect((await h.fetch(cover)).status).toBe(404);
  });

  it('F-192: Boot „Nur mit Link“ – die Seite liefert die Adresse mit Schlüssel', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const b = await s.boat(owner, { visibility: 'unlisted' });
    await putCover('b', b.id, owner.cookie);
    const mine = (await (await s.send('GET', `/api/boats/${b.id}`, owner.cookie)).json()) as { boat: { shareKey: string } };
    const key = mine.boat.shareKey;
    const page = (await (await s.send('GET', `/api/boats/${b.id}`, undefined, undefined, { 'X-Share-Key': key })).json()) as { cover: string };
    expect(page.cover).toContain(`?k=${key}`);
    expect((await h.fetch(page.cover)).status).toBe(200);
    expect((await h.fetch(page.cover.replace(/\?k=.*$/, ''))).status).toBe(404);
  });

  it('F-193: Verein – Eigner und Admins ja, einfache Mitglieder nein', async () => {
    const owner = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    await s.join(owner, g, member);
    expect((await putCover('g', g.id, member.cookie)).status).toBe(404);
    expect((await putCover('g', g.id, owner.cookie)).status).toBe(201);
    const page = (await (await s.send('GET', `/api/groups/slug/${g.slug}`, undefined)).json()) as { cover: string | null };
    expect(page.cover).toMatch(new RegExp(`^/api/covers/g/${g.id}/`));
  });

  it('F-194: Titelbilder gelöschter Objekte räumt der Cron weg', async () => {
    const owner = await s.person({ profile: 'public' });
    const b = await s.boat(owner);
    await putCover('b', b.id, owner.cookie);
    const before = await counter();
    expect((await s.send('DELETE', `/api/boats/${b.id}`, owner.cookie)).status).toBe(204);
    expect((await (await h.r2()).list({ prefix: `covers/b/${b.id}/` })).objects).toHaveLength(1);
    await h.scheduled();
    expect((await (await h.r2()).list({ prefix: `covers/b/${b.id}/` })).objects).toHaveLength(0);
    expect(await (await h.db()).prepare(`SELECT 1 AS x FROM covers WHERE object_id = ?`).bind(b.id).first()).toBeNull();
    // Der Cron rechnet den Zähler ohnehin neu – das Titelbild zählt nicht mehr mit.
    expect(await counter()).toBeLessThanOrEqual(before - webp(1500, 500).length);
  });
});

// ---------------------------------------------------------------- Galerien

describe('Galerien an Person, Boot und Verein (Konzept 13.1)', () => {
  it('F-195: öffentliche Fotos erscheinen bei Person, Crew, Boot und Verein – private und nicht öffentliche nie', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const crew = await s.person({ profile: 'public' });
    const b = await s.boat(owner);
    const g = await s.group(owner);
    expect((await s.send('POST', `/api/groups/${g.id}/boats`, owner.cookie, { boatId: b.id })).status).toBe(201);

    const pub = await s.share(owner, { boatId: b.id, title: 'Ostsee-Törn' });
    const shown = await photo(owner, pub.id, { caption: 'Sonnenuntergang' });
    const hidden = await photo(owner, pub.id, { visibility: 'private' });
    const unlisted = await s.share(owner, { boatId: b.id, visibility: 'unlisted' });
    const viaKey = await photo(owner, unlisted.id);
    await (await h.db()).prepare('INSERT INTO share_crew (share_id, user_id, created_at) VALUES (?, ?, ?)').bind(pub.id, crew.user.id, Date.now()).run();

    type Page = { photos: Array<{ id: string; shareId: string; shareTitle: string; caption: string }> };
    const ids = (p: Page) => p.photos.map((x) => x.id);
    const profile = (await (await s.send('GET', `/api/profiles/${owner.handle}`, undefined)).json()) as Page;
    const crewPage = (await (await s.send('GET', `/api/profiles/${crew.handle}`, undefined)).json()) as Page;
    const boat = (await (await s.send('GET', `/api/boats/${b.id}`, undefined)).json()) as Page;
    const group = (await (await s.send('GET', `/api/groups/slug/${g.slug}`, undefined)).json()) as Page;
    for (const p of [profile, crewPage, boat, group]) {
      expect(ids(p)).toEqual([shown]);
      expect(ids(p)).not.toContain(hidden);
      expect(ids(p)).not.toContain(viaKey);
    }
    expect(profile.photos[0]).toMatchObject({ shareId: pub.id, shareTitle: 'Ostsee-Törn', caption: 'Sonnenuntergang' });

    // Törn wird nicht öffentlich → Foto verschwindet überall
    expect((await s.send('PATCH', `/api/shares/${pub.id}`, owner.cookie, { visibility: 'unlisted' })).status).toBe(200);
    const later = (await (await s.send('GET', `/api/boats/${b.id}`, undefined)).json()) as Page;
    expect(later.photos).toEqual([]);
  });
});

// ---------------------------------------------------------------- Heimathafen von Vereinen und Teams

describe('Heimathafen für Vereine und Teams (Konzept 13.3)', () => {
  it('F-196: Freitext findet den vorhandenen Hafen unabhängig von Groß-/Kleinschreibung; Hafenseite listet die Gruppe', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const name = s.uniq('Potsdam Hafen');
    await s.boat(owner, { homePort: name });
    const g = await s.group(owner, { homePort: name.toUpperCase() });
    const page = (await (await s.send('GET', `/api/groups/slug/${g.slug}`, undefined)).json()) as { group: { homePort: string; harbor: { id: string; slug: string; name: string } | null } };
    expect(page.group.harbor?.name).toBe(name);
    expect(page.group.homePort).toBe(name);
    const harbors = (await (await s.send('GET', `/api/harbors?q=${encodeURIComponent(name)}`, undefined)).json()) as { harbors: Array<{ id: string }> };
    expect(harbors.harbors).toHaveLength(1);
    expect(harbors.harbors[0].id).toBe(page.group.harbor!.id);

    const hp = (await (await s.send('GET', `/api/harbors/slug/${page.group.harbor!.slug}`, undefined)).json()) as { groups: Array<{ slug: string }> };
    expect(hp.groups.map((x) => x.slug)).toContain(g.slug);

    // Auswahl per ID und Entfernen
    const team = await s.group(owner, { kind: 'team', harborId: page.group.harbor!.id });
    expect((team as unknown as { harbor: { id: string } }).harbor.id).toBe(page.group.harbor!.id);
    const cleared = await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { harborId: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { group: { harbor: unknown; homePort: string } }).group).toMatchObject({ harbor: null, homePort: '' });
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { harborId: 'GibtEsNichtAAAAAAA' })).status).toBe(400);
  });
});

describe('Eigner frei wählbar (Konzept 13.5)', () => {
  it('F-198: Boots-Admins setzen den Eigner als freien Text; Fremde nicht; leer zeigt wieder das Konto', async () => {
    const owner = await s.person({ profile: 'public' });
    const admin = await s.person({ profile: 'public' });
    const other = await s.person({ profile: 'public' });
    const b = await s.boat(owner);
    await (await h.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(b.id, admin.user.id, Date.now()).run();

    const set = await s.send('PATCH', `/api/boats/${b.id}`, admin.cookie, { ownerLabel: '  Segelclub Möwe e. V.  ' });
    expect(set.status, await set.clone().text()).toBe(200);
    type Page = { boat: { ownerLabel: string; owner: { handle: string } | null } };
    const page = (await (await s.send('GET', `/api/boats/${b.id}`, undefined)).json()) as Page;
    expect(page.boat.ownerLabel).toBe('Segelclub Möwe e. V.');
    expect(page.boat.owner?.handle).toBe(owner.handle);

    expect((await s.send('PATCH', `/api/boats/${b.id}`, other.cookie, { ownerLabel: 'Ich' })).status).toBe(404);
    expect((await s.send('PATCH', `/api/boats/${b.id}`, owner.cookie, { ownerLabel: '' })).status).toBe(200);
    const after = (await (await s.send('GET', `/api/boats/${b.id}`, undefined)).json()) as Page;
    expect(after.boat.ownerLabel).toBe('');
  });
});
