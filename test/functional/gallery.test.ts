// Funktionale Tests: Galerie-Beiträge (Konzept 31, Phase 7) – Anlegen und Hochladen (F-491), Sichtbarkeit und Cache
// (F-492), Kontingent (F-493), Löschwege mit R2 und Speicherzähler (F-494), Link-Vorschau (F-495).
// Bilder sind kleine, von Hand gebaute JPEG-Köpfe wie in photos.test.ts – der Worker liest nur Kopfdaten.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { GALLERY_LIMITS, monthStart } from '../../src/domain/limits';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminGalleryAAAAA1';
let h: Harness;
let s: ReturnType<typeof social>;
let admin: { cookie: string };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'gallery-admin@example.org', Date.now() - 10 * DAY).run();
  admin = await login(h, 'gallery-admin@example.org');
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const run = async (sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).run();
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};

/** Minimales JPEG: SOI, SOF0 (Größe), SOS, Füllbytes, EOI. */
function jpeg(w: number, hgt: number, pad = 32): Uint8Array<ArrayBuffer> {
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, hgt >> 8, hgt & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  return new Uint8Array([0xff, 0xd8, ...sof, ...sos, ...new Array<number>(pad).fill(0x11), 0xff, 0xd9]);
}

function upload(postId: string, cookie: string | undefined, meta: Record<string, unknown> = { caption: 'Sommerfest' }) {
  const thumb = jpeg(400, 300);
  const full = jpeg(1600, 1200, 64);
  const body = new Uint8Array(thumb.length + full.length);
  body.set(thumb);
  body.set(full, thumb.length);
  return h.fetch(`/api/posts/${postId}/photos`, {
    method: 'POST',
    cookie,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Photo-Thumb-Length': String(thumb.length), 'X-Photo-Meta': encodeURIComponent(JSON.stringify(meta)) },
    body,
  });
}
const uploaded = async (postId: string, p: Person) => (await ok<{ photo: { id: string } }>(await upload(postId, p.cookie), 201)).photo;

/** Galerie-Beitrag über den Plus-Knopf. */
async function gallery(p: Person, channel: { kind: string; id?: string }, body: Record<string, unknown> = {}, status = 201) {
  const res = await s.send('POST', '/api/posts', p.cookie, { channel: { id: '', ...channel }, kind: 'gallery', ...body });
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 201 ? ((await res.json()) as { post: { id: string; path: string; kind: string } }).post : null;
}

const counter = async () => (await one<{ value: number }>(`SELECT value FROM counters WHERE name = 'storage_bytes'`))!.value;
const photoRows = async (postId: string) => (await (await s.db()).prepare('SELECT id, bytes FROM photos WHERE post_id = ?').bind(postId).all<{ id: string; bytes: number }>()).results;
const r2Keys = async (postId: string) => (await (await h.r2()).list({ prefix: `photos/${postId}/` })).objects.map((o) => o.key);
const card = async (postId: string, cookie?: string) => s.send('GET', `/api/posts/${postId}`, cookie);
interface Card {
  item: { post: { id: string; body: string; canDelete: boolean; gallery?: { photos: Array<{ id: string; width: number; height: number }>; own?: boolean } } };
}

/** Prüft, dass ein Beitrag samt Fotos, Dateien und Bytes weg ist. */
async function expectGone(postId: string, before: number, bytes: number) {
  expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', postId)).toBeNull();
  expect(await photoRows(postId)).toEqual([]);
  expect(await r2Keys(postId)).toEqual([]);
  expect(await counter()).toBe(before - bytes);
}
const sumBytes = async (postId: string) => (await photoRows(postId)).reduce((a, r) => a + r.bytes, 0);

// ---------------------------------------------------------------- Anlegen

describe('F-491 Galerie-Beitrag anlegen: Beitrag, dann Fotos', () => {
  it('[F-491] ohne Text, zwei Fotos, Karte mit Fotos; leere Galerie erscheint nirgends; R2-Schlüssel unter dem Beitrag', async () => {
    const me = await s.person({ profile: 'public' });
    const post = (await gallery(me, { kind: 'user' }, { visibility: 'public', reach: 'all' }))!;
    expect(post.kind).toBe('gallery');
    // noch ohne Foto: auch für die Autor:in keine Karte
    expect((await card(post.id, me.cookie)).status).toBe(404);
    const a = await uploaded(post.id, me);
    const b = await uploaded(post.id, me);
    const c = await ok<Card>(await card(post.id));
    expect(c.item.post.gallery!.photos.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(c.item.post.gallery!.photos[0]).toMatchObject({ width: 1600, height: 1200 });
    // „eigen“ nur für die Autor:in (einzelne Fotos löschen statt melden)
    expect(c.item.post.gallery!.own).toBeUndefined();
    expect((await ok<Card>(await card(post.id, me.cookie))).item.post.gallery!.own).toBe(true);
    expect((await r2Keys(post.id)).sort()).toEqual([`photos/${post.id}/${a.id}.jpg`, `photos/${post.id}/${a.id}_t.jpg`, `photos/${post.id}/${b.id}.jpg`, `photos/${post.id}/${b.id}_t.jpg`].sort());
    expect(await one('SELECT share_id, placement, lat, visibility FROM photos WHERE id = ?', a.id)).toEqual({ share_id: null, placement: 'none', lat: null, visibility: 'public' });
    // „Mein Verlauf“ und Profil verlinken die Karte (hasKindCard); im Profil führt /p/<id> zur einzelnen Karte
    const mine = await ok<{ items: Array<{ id: string; kind: string; path?: string }> }>(await s.send('GET', '/api/me/posts?area=all', me.cookie));
    expect(mine.items.find((i) => i.id === post.id)).toMatchObject({ kind: 'gallery', path: `/p/${post.id}`, photos: 2 });
    // Reihenfolge nach Upload-Zeit, nicht nach ID oder Abfrage (K4)
    await run('UPDATE photos SET created_at = created_at + 60000 WHERE id = ?', a.id);
    expect((await ok<Card>(await card(post.id))).item.post.gallery!.photos.map((p) => p.id)).toEqual([b.id, a.id]);
    await run('UPDATE photos SET created_at = created_at - 60000 WHERE id = ?', a.id);
    expect((await ok<{ link: { inStream: boolean } }>(await card(post.id))).link.inStream).toBe(false);
    // Profil für Besucher: dieselben Fotos; eine leere Galerie fehlt dort
    const empty = (await gallery(me, { kind: 'user' }, { visibility: 'public', body: 'leer' }))!;
    // „Mein Verlauf“: ohne sichtbares Foto die Anzahl 0 – die Oberfläche zeigt dann keinen Link zur Karte (K3)
    const mine2 = await ok<{ items: Array<{ id: string; photos?: number }> }>(await s.send('GET', '/api/me/posts?area=all', me.cookie));
    expect(mine2.items.find((i) => i.id === empty.id)?.photos).toBe(0);
    const prof = await ok<{ posts: Array<{ id: string; kind?: string }> }>(await s.send('GET', `/api/profiles/${me.handle}`, undefined));
    expect(prof.posts.find((p) => p.id === post.id)?.kind).toBe('gallery');
    expect(prof.posts.some((p) => p.id === empty.id)).toBe(false);
  });

  it('[F-491] Text-Beiträge brauchen weiter Text, unbekannte Art → 400; nur die Autor:in lädt hoch, nur in Galerien', async () => {
    const me = await s.person();
    const other = await s.person();
    expect(await s.errorOf(await s.send('POST', '/api/posts', me.cookie, { channel: { kind: 'user', id: '' }, body: '' }))).toBe('empty');
    expect(await s.errorOf(await s.send('POST', '/api/posts', me.cookie, { channel: { kind: 'user', id: '' }, kind: 'event', body: 'x' }))).toBe('invalid_kind');
    const post = (await gallery(me, { kind: 'user' }))!;
    expect((await upload(post.id, other.cookie)).status).toBe(404);
    expect((await upload(post.id, undefined)).status).toBe(401);
    const text = await ok<{ post: { id: string } }>(await s.send('POST', '/api/posts', me.cookie, { channel: { kind: 'user', id: '' }, body: 'Nur Text' }), 201);
    expect((await upload(text.post.id, me.cookie)).status).toBe(404);
  });

  it('[F-491] „Neuer Beitrag“ benachrichtigt erst mit dem ersten Foto', async () => {
    const owner = await s.person({ profile: 'public' });
    const member = await s.person();
    const club = await s.group(owner);
    await s.join(owner, club, member);
    await s.send('PUT', `/api/notify/group/${club.id}`, member.cookie, { level: 'all' });
    const post = (await gallery(owner, { kind: 'group', id: club.id }, { visibility: 'members' }))!;
    const notes = async () => (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'post' AND subject_id = ?`, member.user.id, post.id))!.n;
    expect(await notes()).toBe(0);
    const first = await uploaded(post.id, owner);
    expect(await notes()).toBe(1);
    await uploaded(post.id, owner);
    expect(await notes()).toBe(1);
    // alles gelöscht und neu hochgeladen (per API): keine zweite Benachrichtigung (S1) – auch nicht, wenn die erste gelesen
    // bzw. entfernt wurde
    for (const id of [first.id, ...(await photoRows(post.id)).map((r) => r.id).filter((x) => x !== first.id)]) {
      expect((await s.send('DELETE', `/api/photos/${id}`, owner.cookie)).status).toBe(204);
    }
    await run(`DELETE FROM notifications WHERE kind = 'post' AND subject_id = ?`, post.id);
    await Promise.all([uploaded(post.id, owner), uploaded(post.id, owner)]);
    expect(await notes()).toBe(0);
  });
});

// ---------------------------------------------------------------- Sichtbarkeit und Cache

describe('F-492 Fotos so sichtbar wie der Beitrag, öffentlicher Cache nur für Gäste-Sichtbares', () => {
  it('[F-492] „Nur Mitglieder“: Mitglied sieht Karte und Bild (privat, nie gecacht), Gast nie – auch nicht nach einem Abruf des Mitglieds', async () => {
    const owner = await s.person({ profile: 'public' });
    const member = await s.person();
    const club = await s.group(owner);
    await s.join(owner, club, member);
    const post = (await gallery(owner, { kind: 'group', id: club.id }, { visibility: 'members' }))!;
    const ph = await uploaded(post.id, owner);
    const img = await s.send('GET', `/api/photos/${ph.id}?s=t`, member.cookie);
    expect(img.status).toBe(200);
    expect(img.headers.get('Cache-Control')).toBe('private, no-cache');
    expect((await ok<Card>(await card(post.id, member.cookie))).item.post.gallery!.photos).toHaveLength(1);
    // Gruppen-Stream des Mitglieds zeigt sie, der (gecachte) Gast-Stream nicht
    const st = await ok<{ items: Array<{ post?: { id: string; gallery?: unknown } }> }>(await s.send('GET', `/api/groups/${club.id}/stream`, member.cookie));
    expect(st.items.find((i) => i.post?.id === post.id)?.post?.gallery).toBeTruthy();
    expect((await s.send('GET', `/api/photos/${ph.id}?s=t`, undefined)).status).toBe(404);
    expect((await s.send('GET', `/api/photos/${ph.id}?s=f`, undefined)).status).toBe(404);
    expect((await card(post.id)).status).toBe(404);
    const guest = await ok<{ items: Array<{ post?: { id: string } }> }>(await s.send('GET', `/api/groups/${club.id}/stream`, undefined));
    expect(guest.items.some((i) => i.post?.id === post.id)).toBe(false);
  });

  it('[F-492] öffentlich: Gast lädt das Bild 5 min cachebar; „Nur mit Link“: nur mit ?k=, privat; ausgeblendete Fotos fallen weg', async () => {
    const me = await s.person({ profile: 'public', supporter: true });
    const pub = (await gallery(me, { kind: 'user' }, { visibility: 'public' }))!;
    const p1 = await uploaded(pub.id, me);
    const img = await s.send('GET', `/api/photos/${p1.id}?s=f`, undefined);
    expect(img.status).toBe(200);
    expect(img.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(img.headers.get('Content-Type')).toBe('image/jpeg');

    const unl = (await gallery(me, { kind: 'user' }, { visibility: 'unlisted' }))!;
    const p2 = await uploaded(unl.id, me);
    const key = /\/p\/[^/]+\/([^/]+)$/.exec(unl.path)![1];
    expect((await s.send('GET', `/api/photos/${p2.id}?s=t`, undefined)).status).toBe(404);
    const withKey = await s.send('GET', `/api/photos/${p2.id}?s=t&k=${key}`, undefined);
    expect(withKey.status).toBe(200);
    expect(withKey.headers.get('Cache-Control')).toBe('private, no-cache');
    const single = await ok<Card>(await s.send('GET', `/api/posts/${unl.id}`, undefined, undefined, { 'X-Share-Key': key }));
    expect(single.item.post.gallery!.photos).toHaveLength(1);

    // Foto ausgeblendet (Meldung): nicht mehr in der Karte; war es das einzige, verschwindet die Karte
    await run('UPDATE photos SET hidden_at = ? WHERE id = ?', Date.now(), p1.id);
    expect((await card(pub.id)).status).toBe(404);
    expect((await s.send('GET', `/api/photos/${p1.id}?s=t`, undefined)).status).toBe(404);
    expect((await s.send('GET', `/api/photos/${p1.id}?s=t`, me.cookie)).status).toBe(200);
  });

  it('[F-492] nur die Bildunterschrift ist änderbar; Melden eines Galerie-Fotos führt zur Karte', async () => {
    const me = await s.person({ profile: 'public' });
    const other = await s.person();
    const post = (await gallery(me, { kind: 'user' }, { visibility: 'public' }))!;
    const ph = await uploaded(post.id, me);
    expect(await s.errorOf(await s.send('PATCH', `/api/photos/${ph.id}`, me.cookie, { visibility: 'private' }))).toBe('caption_only');
    expect((await s.send('PATCH', `/api/photos/${ph.id}`, me.cookie, { caption: 'Grillen' })).status).toBe(200);
    expect((await s.send('POST', '/api/reports', other.cookie, { kind: 'photo', id: ph.id, reason: 'spam' })).status).toBe(201);
    const list = await ok<{ reports: Array<{ target: { path: string; title: string } }> }>(await s.send('GET', '/api/admin/reports', admin.cookie));
    expect(list.reports.map((r) => r.target)).toContainEqual(expect.objectContaining({ path: `/p/${post.id}`, title: 'Foto in einem Beitrag' }));
  });
});

// ---------------------------------------------------------------- Kontingent

describe('F-493 Kontingent: 10/200 Fotos je Monat, 30 je Beitrag, kostenlos 25 MB', () => {
  it('[F-493] kostenlos: nach 10 Fotos im Monat 402 (auch kein neuer Galerie-Beitrag); Löschen gibt nicht frei; Formular nennt den Stand', async () => {
    const me = await s.person();
    const post = (await gallery(me, { kind: 'user' }))!;
    const first = await uploaded(post.id, me);
    // neun weitere als Zähler-Zeilen (gleiche Wirkung wie neun Uploads)
    for (let i = 0; i < GALLERY_LIMITS.perMonth.free - 1; i++) await run('INSERT INTO photo_log (user_id, created_at) VALUES (?, ?)', me.user.id, Date.now());
    const c = await ok<{ gallery: { used: number; max: number; perPost: number } }>(await s.send('GET', '/api/me/compose', me.cookie));
    expect(c.gallery).toEqual({ used: 10, max: 10, perPost: 30 });
    expect(await s.errorOf(await upload(post.id, me.cookie))).toBe('supporter_required');
    expect((await s.send('DELETE', `/api/photos/${first.id}`, me.cookie)).status).toBe(204);
    expect(await s.errorOf(await upload(post.id, me.cookie))).toBe('supporter_required');
    expect(await s.errorOf(await s.send('POST', '/api/posts', me.cookie, { channel: { kind: 'user', id: '' }, kind: 'gallery' }))).toBe('supporter_required');
    // Zeilen aus dem Vormonat zählen nicht
    await run('UPDATE photo_log SET created_at = ? WHERE user_id = ?', monthStart(Date.now()) - 1, me.user.id);
    expect((await upload(post.id, me.cookie)).status).toBe(201);
    // keine Datei ohne Zeile
    expect((await r2Keys(post.id)).length).toBe(2 * (await photoRows(post.id)).length);
  });

  it('[F-493] Unterstützer: 200 je Monat (dann 409), höchstens 30 je Beitrag', async () => {
    const me = await s.person({ supporter: true });
    const post = (await gallery(me, { kind: 'user' }))!;
    for (let i = 0; i < GALLERY_LIMITS.perPost; i++) {
      await run(`INSERT INTO photos (id, post_id, user_id, width, height, bytes, created_at) VALUES (?, ?, ?, 10, 10, 1, ?)`, `GalFill${post.id.slice(0, 6)}${String(i).padStart(4, '0')}`, post.id, me.user.id, Date.now());
    }
    expect(await s.errorOf(await upload(post.id, me.cookie))).toBe('post_full');
    const other = (await gallery(me, { kind: 'user' }))!;
    for (let i = 0; i < GALLERY_LIMITS.perMonth.supporter; i++) await run('INSERT INTO photo_log (user_id, created_at) VALUES (?, ?)', me.user.id, Date.now());
    expect(await s.errorOf(await upload(other.id, me.cookie))).toBe('quota');
  });

  it('[F-493] kostenlos höchstens 25 MB Galerie-Fotos (402), Unterstützer nicht', async () => {
    const me = await s.person();
    const post = (await gallery(me, { kind: 'user' }))!;
    await run(`INSERT INTO photos (id, post_id, user_id, width, height, bytes, created_at) VALUES (?, ?, ?, 10, 10, ?, ?)`, `GalBig${post.id.slice(0, 10)}`, post.id, me.user.id, GALLERY_LIMITS.freeBytes, Date.now());
    const res = await upload(post.id, me.cookie);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { message: string }).message).toMatch(/25 MB/);
  });

  it('[F-493] Speicherzähler zählt jedes Galerie-Foto', async () => {
    const me = await s.person();
    const post = (await gallery(me, { kind: 'user' }))!;
    const before = await counter();
    await uploaded(post.id, me);
    expect(await counter()).toBe(before + (await sumBytes(post.id)));
  });
});

// ---------------------------------------------------------------- Löschwege

describe('F-494 Löschwege: Zeilen, R2-Dateien und Speicherzähler auf jedem Weg', () => {
  it('[F-494] einzeln: Beitrag löschen (Autor:in)', async () => {
    const me = await s.person();
    const post = (await gallery(me, { kind: 'user' }))!;
    await uploaded(post.id, me);
    await uploaded(post.id, me);
    const before = await counter();
    const bytes = await sumBytes(post.id);
    expect((await s.send('DELETE', `/api/posts/${post.id}`, me.cookie)).status).toBe(204);
    await expectGone(post.id, before, bytes);
  });

  it('[F-494] einzelnes Foto: Eigentümer:in bzw. Moderation (Meldung → löschen)', async () => {
    const me = await s.person({ profile: 'public' });
    const other = await s.person();
    const post = (await gallery(me, { kind: 'user' }, { visibility: 'public' }))!;
    const a = await uploaded(post.id, me);
    const b = await uploaded(post.id, me);
    const before = await counter();
    const bytesA = (await one<{ bytes: number }>('SELECT bytes FROM photos WHERE id = ?', a.id))!.bytes;
    expect((await s.send('DELETE', `/api/photos/${a.id}`, me.cookie)).status).toBe(204);
    expect(await counter()).toBe(before - bytesA);
    expect((await r2Keys(post.id)).some((k) => k.includes(a.id))).toBe(false);
    expect((await s.send('POST', '/api/reports', other.cookie, { kind: 'photo', id: b.id, reason: 'spam' })).status).toBe(201);
    const rep = (await one<{ id: string }>(`SELECT id FROM reports WHERE target_kind = 'photo' AND target_id = ?`, b.id))!;
    expect((await s.send('POST', `/api/admin/reports/${rep.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect(await photoRows(post.id)).toEqual([]);
    expect(await r2Keys(post.id)).toEqual([]);
  });

  it('[F-494] Moderation: Beitrag gemeldet und gelöscht', async () => {
    const me = await s.person({ profile: 'public' });
    const other = await s.person();
    const post = (await gallery(me, { kind: 'user' }, { visibility: 'public' }))!;
    await uploaded(post.id, me);
    const before = await counter();
    const bytes = await sumBytes(post.id);
    expect((await s.send('POST', '/api/reports', other.cookie, { kind: 'post', id: post.id, reason: 'spam' })).status).toBe(201);
    const rep = (await one<{ id: string }>(`SELECT id FROM reports WHERE target_kind = 'post' AND target_id = ?`, post.id))!;
    expect((await s.send('POST', `/api/admin/reports/${rep.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    await expectGone(post.id, before, bytes);
  });

  it('[F-494] Gruppe gelöscht: Galerie-Beiträge der Mitglieder samt Dateien', async () => {
    const owner = await s.person();
    const member = await s.person();
    const club = await s.group(owner);
    await s.join(owner, club, member);
    await s.send('PATCH', `/api/groups/${club.id}`, owner.cookie, { postBy: 'members' });
    const post = (await gallery(member, { kind: 'group', id: club.id }, { visibility: 'members' }))!;
    await uploaded(post.id, member);
    // Eigner:in darf den Beitrag löschen, ist aber nicht Autor:in – meldet Fotos, statt sie einzeln zu löschen (K3)
    const asOwner = await ok<Card>(await card(post.id, owner.cookie));
    expect(asOwner.item.post.canDelete).toBe(true);
    expect(asOwner.item.post.gallery!.own).toBeUndefined();
    expect((await ok<Card>(await card(post.id, member.cookie))).item.post.gallery!.own).toBe(true);
    const before = await counter();
    const bytes = await sumBytes(post.id);
    expect((await s.send('DELETE', `/api/groups/${club.id}`, owner.cookie)).status).toBe(204);
    await expectGone(post.id, before, bytes);
  });

  it('[F-494] Boot gelöscht: Galerie-Beiträge im Boots-Verlauf', async () => {
    const me = await s.person();
    const boat = await s.boat(me);
    const post = (await gallery(me, { kind: 'boat', id: boat.id }))!;
    await uploaded(post.id, me);
    const before = await counter();
    const bytes = await sumBytes(post.id);
    expect((await s.send('DELETE', `/api/boats/${boat.id}`, me.cookie)).status).toBe(204);
    await expectGone(post.id, before, bytes);
  });

  it('[F-494] Hafen gelöscht (Moderation): Galerie-Beiträge im Hafen-Verlauf', async () => {
    const me = await s.person();
    const other = await s.person();
    const hb = ((await (await s.send('POST', '/api/harbors', me.cookie, { name: s.uniq('Galeriehafen'), lat: -46, lon: -171 })).json()) as { harbor: { id: string } }).harbor;
    await s.boat(me, { harborId: hb.id });
    const post = (await gallery(me, { kind: 'harbor', id: hb.id }))!;
    await uploaded(post.id, me);
    const before = await counter();
    const bytes = await sumBytes(post.id);
    expect((await s.send('POST', '/api/reports', other.cookie, { kind: 'harbor', id: hb.id, reason: 'spam' })).status).toBe(201);
    const rep = (await one<{ id: string }>(`SELECT id FROM reports WHERE target_kind = 'harbor' AND target_id = ?`, hb.id))!;
    expect((await s.send('POST', `/api/admin/reports/${rep.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    await expectGone(post.id, before, bytes);
  });

  it('[F-494] Konto gelöscht: eigene Galerien und fremde Galerien am eigenen Boot; Zähler stimmt', async () => {
    const me = await s.person();
    const friend = await s.person();
    const boat = await s.boat(me);
    await run(`INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)`, boat.id, friend.user.id, Date.now());
    const own = (await gallery(me, { kind: 'user' }))!;
    await uploaded(own.id, me);
    const theirs = (await gallery(friend, { kind: 'boat', id: boat.id }))!;
    await uploaded(theirs.id, friend);
    const before = await counter();
    const bytes = (await sumBytes(own.id)) + (await sumBytes(theirs.id));
    expect((await s.send('DELETE', '/api/account', me.cookie)).status).toBe(200);
    await expectGone(own.id, before, bytes);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', theirs.id)).toBeNull();
    expect(await r2Keys(theirs.id)).toEqual([]);
    expect(await one('SELECT 1 AS x FROM photo_log WHERE user_id = ?', me.user.id)).toBeNull();
    // die Nacht rechnet den Zähler neu – keine Abweichung
    const night = h.logs.length;
    expect((await h.scheduled()).outcome).toBe('ok');
    expect(h.logs.slice(night).join('\n')).not.toMatch(/retention step .* failed/);
  });

  it('[F-494] Konten zusammengeführt: Fotos und Monatszähler wandern mit', async () => {
    const from = await s.person();
    const into = await s.person();
    const post = (await gallery(from, { kind: 'user' }))!;
    const ph = await uploaded(post.id, from);
    const A = (m: string, p: string, b?: unknown) => s.send(m, p, admin.cookie, b);
    expect((await A('POST', `/api/admin/users/${from.user.id}/merge`, { into: into.user.id, confirm: from.user.id })).status).toBe(200);
    expect(await one('SELECT user_id FROM photos WHERE id = ?', ph.id)).toEqual({ user_id: into.user.id });
    expect(await one<{ n: number }>('SELECT COUNT(*) AS n FROM photo_log WHERE user_id = ?', into.user.id)).toEqual({ n: 1 });
    expect(await r2Keys(post.id)).toHaveLength(2);
  });

  it('[F-494] Häfen zusammengeführt: Galerie wandert mit ihrem Beitrag, Fotos und Dateien bleiben', async () => {
    const me = await s.person();
    const mk = async (name: string) => ((await (await s.send('POST', '/api/harbors', me.cookie, { name: s.uniq(name), lat: -47, lon: -172 })).json()) as { harbor: { id: string } }).harbor;
    const dup = await mk('Galeriedublette');
    const main = await mk('Galeriehaupt');
    await s.boat(me, { harborId: dup.id });
    const post = (await gallery(me, { kind: 'harbor', id: dup.id }))!;
    const ph = await uploaded(post.id, me);
    const before = await counter();
    expect((await s.send('POST', `/api/admin/harbors/${dup.id}/merge`, admin.cookie, { into: main.id })).status).toBe(200);
    expect(await one('SELECT channel_id FROM posts WHERE id = ?', post.id)).toEqual({ channel_id: main.id });
    expect((await photoRows(post.id)).map((r) => r.id)).toEqual([ph.id]);
    expect(await r2Keys(post.id)).toHaveLength(2);
    expect(await counter()).toBe(before);
  });

  it('[F-494] nächtlich: leere Galerie nach 24 h weg, Monatszähler nach 32 Tagen weg', async () => {
    const me = await s.person();
    const empty = (await gallery(me, { kind: 'user' }))!;
    const fresh = (await gallery(me, { kind: 'user' }))!;
    await run('UPDATE posts SET created_at = ? WHERE id = ?', Date.now() - 2 * DAY, empty.id);
    await run('INSERT INTO photo_log (user_id, created_at) VALUES (?, ?)', me.user.id, Date.now() - 40 * DAY);
    await run('INSERT INTO photo_log (user_id, created_at) VALUES (?, ?)', me.user.id, Date.now() - DAY);
    expect((await h.scheduled()).outcome).toBe('ok');
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', empty.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', fresh.id)).not.toBeNull();
    expect(await one<{ n: number }>('SELECT COUNT(*) AS n FROM photo_log WHERE user_id = ?', me.user.id)).toEqual({ n: 1 });
  });
});

// ---------------------------------------------------------------- Link-Vorschau

describe('F-495 Link-Vorschau /p/<id> mit dem ersten Foto nur bei effektiv öffentlich', () => {
  it('[F-495] öffentlich mit og:image in Fotogröße, „Nur Mitglieder“ neutral ohne Bild', async () => {
    const owner = await s.person({ profile: 'public' });
    const pub = (await gallery(owner, { kind: 'user' }, { visibility: 'public', body: '' }))!;
    const ph = await uploaded(pub.id, owner);
    const html = await (await h.fetch(`/p/${pub.id}`)).text();
    expect(html).toContain(`/api/photos/${ph.id}?s=f`);
    expect(html).toContain('og:image:width" content="1600"');
    expect(html).toMatch(/1 Foto/);
    const club = await s.group(owner);
    const mem = (await gallery(owner, { kind: 'group', id: club.id }, { visibility: 'members' }))!;
    const p2 = await uploaded(mem.id, owner);
    const html2 = await (await h.fetch(`/p/${mem.id}`)).text();
    expect(html2).not.toContain(p2.id);
    expect(html2).not.toContain('og:image');
  });
});
