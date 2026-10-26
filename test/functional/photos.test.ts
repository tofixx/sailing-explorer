// Funktionale Tests: Fotos (Konzept 3, Phase C) – F-100 … F-104 und F-81 (Sichtbarkeit), Melden von Fotos (F-114).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
// Bilder sind kleine, von Hand gebaute JPEG-/WebP-Köpfe: der Worker liest nur Kopfdaten, er dekodiert nichts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, grantSupport, login, loginSupporter, startWorker, type Harness } from './worker-harness';
import { PHOTO_FULL_BYTES, PHOTO_THUMB_BYTES } from '../../src/domain/limits';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminPhoto0000001';
const ADMIN_MAIL = 'foto-admin@example.org';

let h: Harness;
let n = 0;
const email = (tag = 'p') => `${tag}${++n}-${Date.now()}@example.org`;
let admin: { cookie: string };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  admin = await login(h, ADMIN_MAIL);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

// ---------------------------------------------------------------- Bilder

/** Minimales JPEG: SOI, optionale Segmente, SOF0 (Größe), SOS, Füllbytes, EOI. */
function jpeg(w: number, h: number, o: { pad?: number; segments?: number[][] } = {}): Uint8Array<ArrayBuffer> {
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  const parts = [0xff, 0xd8, ...(o.segments ?? []).flat(), ...sof, ...sos, ...new Array<number>(o.pad ?? 32).fill(0x11), 0xff, 0xd9];
  return new Uint8Array(parts);
}
/** APP1-Segment (EXIF) */
const APP1 = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
const chunk = (id: string, data: number[]) => [...[...id].map((c) => c.charCodeAt(0)), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
/** Minimales verlustbehaftetes WebP (VP8-Chunk mit Größe), optional mit weiteren Chunks. */
function webp(w: number, h: number, extra: number[][] = []): Uint8Array<ArrayBuffer> {
  const vp8 = chunk('VP8 ', [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f, ...new Array<number>(20).fill(0)]);
  const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...extra.flat(), ...vp8];
  return new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

interface Meta {
  caption?: string;
  takenAt?: number | null;
  lat?: number | null;
  lon?: number | null;
  placement?: string;
  visibility?: string;
}
interface Photo {
  id: string;
  caption: string;
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
  placement: string;
  width: number;
  height: number;
  visibility: string | null;
  effectiveVisibility: string;
  bytes: number | null;
  hidden: boolean;
}

function upload(id: string, cookie: string | undefined, o: { full?: Uint8Array; thumb?: Uint8Array; meta?: Meta | string; headers?: Record<string, string> } = {}) {
  const full = o.full ?? jpeg(1600, 1200);
  const thumb = o.thumb ?? jpeg(400, 300);
  return h.fetch(`/api/shares/${id}/photos`, {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Photo-Thumb-Length': String(thumb.length),
      'X-Photo-Meta': typeof o.meta === 'string' ? o.meta : encodeURIComponent(JSON.stringify(o.meta ?? { caption: 'Ankerbucht', takenAt: Date.parse('2026-06-13T10:05:00Z'), lat: 54.005, lon: 13, placement: 'gps' })),
      ...(o.headers ?? {}),
    },
    body: concat(thumb, full),
  });
}

async function uploaded(id: string, cookie: string, o: Parameters<typeof upload>[2] = {}): Promise<Photo> {
  const res = await upload(id, cookie, o);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { photo: Photo }).photo;
}

const send = (method: string, path: string, cookie: string | undefined, body?: unknown, headers: Record<string, string> = {}) =>
  h.fetch(path, {
    method,
    cookie,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

interface Share {
  id: string;
  shareKey: string | null;
  sizeBytes: number;
}
async function newShare(cookie: string, visibility = 'public'): Promise<Share> {
  const res = await createShare(h, cookie, { visibility });
  expect(res.status).toBe(201);
  return ((await res.json()) as { share: Share }).share;
}

async function list(id: string, cookie?: string, key?: string | null) {
  const res = await h.fetch(`/api/shares/${id}/photos`, { cookie, headers: key ? { 'X-Share-Key': key } : {} });
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as { photos: Photo[]; upload: { allowed: boolean; reason: string | null; used: number; max: number } | null }) : null };
}

async function counter(): Promise<number> {
  return (await (await h.db()).prepare("SELECT value FROM counters WHERE name = 'storage_bytes'").first<{ value: number }>())!.value;
}
async function setCounter(value: number) {
  await (await h.db()).prepare("UPDATE counters SET value = ? WHERE name = 'storage_bytes'").bind(value).run();
}
const r2Keys = async (prefix: string) => (await (await h.r2()).list({ prefix })).objects.map((o) => o.key);

// ---------------------------------------------------------------- Hochladen

describe('F-100 Hochladen: nur Eigentümer mit Unterstützer-Status', () => {
  it('[F-100] Unterstützer lädt hoch: 201, Position gerundet, Dateien in R2, Bytes im Konto und im Zähler', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const before = await counter();
    const full = jpeg(1600, 1200, { pad: 500 });
    const thumb = jpeg(400, 300);
    const photo = await uploaded(share.id, owner.cookie, { full, thumb, meta: { caption: '  Hafen  ', takenAt: Date.parse('2026-06-13T10:05:00Z'), lat: 54.0051234, lon: 13.0000049, placement: 'gps' } });
    expect(photo).toMatchObject({ caption: 'Hafen', lat: 54.00512, lon: 13, placement: 'gps', width: 1600, height: 1200, visibility: 'public', effectiveVisibility: 'public' });
    expect(photo.bytes).toBe(full.length + thumb.length);
    expect((await r2Keys(`photos/${share.id}/`)).sort()).toEqual([`photos/${share.id}/${photo.id}.jpg`, `photos/${share.id}/${photo.id}_t.jpg`]);
    expect(await counter()).toBe(before + photo.bytes!);
    const s = (await (await h.fetch('/api/me/support', { cookie: owner.cookie })).json()) as { bytesUsed: number; photosUsed: number; photosMax: number };
    expect(s).toMatchObject({ photosUsed: 1, photosMax: 100 });
    expect(s.bytesUsed).toBe(share.sizeBytes + photo.bytes!);
    const l = await list(share.id, owner.cookie);
    expect(l.body!.photos.map((p) => p.id)).toEqual([photo.id]);
    expect(l.body!.upload).toMatchObject({ allowed: true, reason: null, used: 1, max: 100 });
  });

  it('[F-100] WebP wird angenommen', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie, { full: webp(2048, 1536), thumb: webp(400, 300) });
    expect(photo).toMatchObject({ width: 2048, height: 1536 });
    expect(await r2Keys(`photos/${share.id}/${photo.id}.webp`)).toHaveLength(1);
    const img = await h.fetch(`/api/photos/${photo.id}?s=f`);
    expect(img.headers.get('Content-Type')).toBe('image/webp');
  });

  it('[E3] kostenlos: 402 supporter_required mit deutscher Meldung; Liste meldet upload.reason', async () => {
    const owner = await login(h, email());
    const share = await newShare(owner.cookie);
    const res = await upload(share.id, owner.cookie);
    expect(res.status).toBe(402);
    const b = (await res.json()) as { error: string; message: string };
    expect(b.error).toBe('supporter_required');
    expect(b.message).toMatch(/Fotos gibt es nur für Unterstützer/);
    expect((await list(share.id, owner.cookie)).body!.upload).toMatchObject({ allowed: false, reason: 'supporter_required' });
  });

  it('[E4] abgelaufene Unterstützung: kein neues Foto, vorhandene bleiben, „Nur ich“ und Löschen gehen weiter', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie);
    await (await h.db()).prepare('UPDATE supports SET valid_until = ? WHERE user_id = ?').bind(Date.now() - DAY, owner.user.id).run();
    expect((await upload(share.id, owner.cookie)).status).toBe(402);
    expect((await list(share.id)).body!.photos).toHaveLength(1);
    const patched = await send('PATCH', `/api/photos/${photo.id}`, owner.cookie, { visibility: 'private', caption: 'neu' });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { photo: Photo }).photo).toMatchObject({ visibility: 'private', caption: 'neu', effectiveVisibility: 'private' });
    expect((await send('DELETE', `/api/photos/${photo.id}`, owner.cookie)).status).toBe(204);
  });

  it('[F-100] fremde Törns verhalten sich wie nicht existent (404), ohne Anmeldung 401, fremde Origin 403', async () => {
    const owner = await loginSupporter(h, email());
    const other = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    expect((await upload(share.id, other.cookie)).status).toBe(404);
    expect((await upload(share.id, undefined)).status).toBe(401);
    expect((await h.fetch(`/api/shares/${share.id}/photos`, { method: 'POST', cookie: owner.cookie, origin: 'https://evil.example' })).status).toBe(403);
    const photo = await uploaded(share.id, owner.cookie);
    expect((await send('PATCH', `/api/photos/${photo.id}`, other.cookie, { caption: 'x' })).status).toBe(404);
    expect((await send('DELETE', `/api/photos/${photo.id}`, other.cookie)).status).toBe(404);
  });

  it('[F-100] gesperrtes Konto lädt nichts hoch (403 suspended)', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    await (await h.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), owner.user.id).run();
    expect(await errorOf(await upload(share.id, owner.cookie))).toBe('suspended');
  });
});

// ---------------------------------------------------------------- Prüfung der Bilder

describe('F-101 Server lehnt Metadaten, falsche Formate und Übergrößen ab', () => {
  let cookie: string;
  let shareId: string;
  beforeAll(async () => {
    const owner = await loginSupporter(h, email());
    cookie = owner.cookie;
    shareId = (await newShare(cookie)).id;
  });

  it('[F-101] JPEG mit APP1 (EXIF) → 400 image_metadata, auch im Vorschaubild', async () => {
    expect(await errorOf(await upload(shareId, cookie, { full: jpeg(800, 600, { segments: [APP1] }) }))).toBe('image_metadata');
    expect(await errorOf(await upload(shareId, cookie, { thumb: jpeg(400, 300, { segments: [APP1] }) }))).toBe('image_metadata');
  });

  it('[F-101] WebP mit EXIF- oder XMP-Chunk → 400 image_metadata', async () => {
    expect(await errorOf(await upload(shareId, cookie, { full: webp(800, 600, [chunk('EXIF', [1, 2, 3, 4])]), thumb: webp(400, 300) }))).toBe('image_metadata');
    expect(await errorOf(await upload(shareId, cookie, { full: webp(800, 600, [chunk('XMP ', [1, 2])]), thumb: webp(400, 300) }))).toBe('image_metadata');
  });

  it('[F-101] PNG, Müll und gemischte Formate → 400 invalid_image', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(40).fill(0)]);
    expect(await errorOf(await upload(shareId, cookie, { full: png }))).toBe('invalid_image');
    expect(await errorOf(await upload(shareId, cookie, { full: webp(800, 600) }))).toBe('invalid_image');
  });

  it('[F-100] zu große Abmessungen → 400 too_large; Vorschau über 80 KB → 400; Vollbild über 1 MB → 413', async () => {
    expect(await errorOf(await upload(shareId, cookie, { full: jpeg(2049, 1000) }))).toBe('too_large');
    expect(await errorOf(await upload(shareId, cookie, { thumb: jpeg(401, 300) }))).toBe('too_large');
    expect(await errorOf(await upload(shareId, cookie, { thumb: jpeg(400, 300, { pad: PHOTO_THUMB_BYTES }) }))).toBe('invalid_thumb');
    const res = await upload(shareId, cookie, { full: jpeg(1600, 1200, { pad: PHOTO_FULL_BYTES + 10 }) });
    expect(res.status).toBe(413);
  });

  it('[F-100] falscher Content-Type → 415; kaputte Meta-Angaben → 400 invalid_meta', async () => {
    expect((await upload(shareId, cookie, { headers: { 'Content-Type': 'image/jpeg' } })).status).toBe(415);
    expect(await errorOf(await upload(shareId, cookie, { meta: '%7Bkaputt' }))).toBe('invalid_meta');
    expect(await errorOf(await upload(shareId, cookie, { meta: { lat: 95, lon: 0, placement: 'gps' } }))).toBe('invalid_meta');
    expect(await errorOf(await upload(shareId, cookie, { meta: { visibility: 'unlisted' } }))).toBe('invalid_meta');
    // Nichts davon wurde gespeichert.
    expect((await list(shareId, cookie)).body!.photos).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Kontingent, Speicher, Notbremse

describe('F-104 Kontingent, Speicher und Notbremse', () => {
  it('[F-104] höchstens 100 Fotos pro Törn (409 quota), auch bei parallelen Uploads', { timeout: 60_000 }, async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const db = await h.db();
    // 98 Fotos direkt in D1, dann 4 parallele Uploads: genau 2 kommen durch.
    for (let i = 0; i < 98; i++) {
      await db
        .prepare("INSERT INTO photos (id, share_id, user_id, width, height, bytes, created_at) VALUES (?, ?, ?, 10, 10, 1, ?)")
        .bind(`fill${i.toString().padStart(3, '0')}${share.id.slice(0, 10)}`, share.id, owner.user.id, Date.now())
        .run();
    }
    const results = await Promise.all([0, 1, 2, 3].map(() => upload(share.id, owner.cookie)));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 201, 409, 409]);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM photos WHERE share_id = ?').bind(share.id).first<{ n: number }>();
    expect(count!.n).toBe(100);
    // Abgelehnte Uploads hinterlassen keine Dateien.
    expect(await r2Keys(`photos/${share.id}/`)).toHaveLength(4);
  });

  it('[F-104] Speicher voll → 409 quota (Unterstützer haben 200 MB)', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    await (await h.db()).prepare('UPDATE shares SET size_bytes = ? WHERE id = ?').bind(200 * 1024 * 1024, share.id).run();
    const res = await upload(share.id, owner.cookie);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe('quota');
  });

  it('[F-104] Notbremse: ab „hart“ auch für Unterstützer 503 storage_paused mit „Fotos“; Löschen geht', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie);
    const saved = await counter();
    try {
      await setCounter(9.6e9);
      const res = await upload(share.id, owner.cookie);
      expect(res.status).toBe(503);
      const b = (await res.json()) as { error: string; message: string };
      expect(b.error).toBe('storage_paused');
      expect(b.message).toMatch(/neue Fotos/);
      expect((await list(share.id, owner.cookie)).body!.upload).toMatchObject({ allowed: false, reason: 'storage_paused' });
      expect((await send('DELETE', `/api/photos/${photo.id}`, owner.cookie)).status).toBe(204);
    } finally {
      await setCounter(saved - photo.bytes!);
    }
  });

  it('[F-104] Löschen eines Fotos: R2, Zeile, Zähler; Kommentar-Bezüge werden gelöst', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie);
    const db = await h.db();
    await db
      .prepare('INSERT INTO comments (id, share_id, photo_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`cmt${photo.id}`.slice(0, 18), share.id, photo.id, owner.user.id, 'schön', Date.now())
      .run();
    const before = await counter();
    expect((await send('DELETE', `/api/photos/${photo.id}`, owner.cookie)).status).toBe(204);
    expect(await r2Keys(`photos/${share.id}/`)).toEqual([]);
    expect(await counter()).toBe(before - photo.bytes!);
    expect(await db.prepare('SELECT id FROM photos WHERE id = ?').bind(photo.id).first()).toBeNull();
    const c = await db.prepare('SELECT photo_id FROM comments WHERE share_id = ?').bind(share.id).first<{ photo_id: string | null }>();
    expect(c!.photo_id).toBeNull();
    expect((await h.fetch(`/api/photos/${photo.id}`, { cookie: owner.cookie })).status).toBe(404);
  });

  it('[F-104] Törn löschen nimmt Fotos mit (R2, Zeilen, Zähler)', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    await uploaded(share.id, owner.cookie);
    await uploaded(share.id, owner.cookie);
    const before = await counter();
    const sum = (await (await h.db()).prepare('SELECT SUM(bytes) AS b FROM photos WHERE share_id = ?').bind(share.id).first<{ b: number }>())!.b;
    expect((await send('DELETE', `/api/shares/${share.id}`, owner.cookie)).status).toBe(204);
    expect(await r2Keys(`photos/${share.id}/`)).toEqual([]);
    expect(await counter()).toBe(before - sum - share.sizeBytes);
    const n = await (await h.db()).prepare('SELECT COUNT(*) AS n FROM photos WHERE share_id = ?').bind(share.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('[F-104] Konto löschen nimmt alle Fotos mit; Ablauf (Cron) ebenso', async () => {
    const a = await loginSupporter(h, email());
    const sa = await newShare(a.cookie);
    await uploaded(sa.id, a.cookie);
    expect((await send('DELETE', '/api/account', a.cookie)).status).toBe(200);
    expect(await r2Keys(`photos/${sa.id}/`)).toEqual([]);
    expect(await (await h.db()).prepare('SELECT id FROM photos WHERE user_id = ?').bind(a.user.id).first()).toBeNull();

    const b = await loginSupporter(h, email());
    const sb = await newShare(b.cookie);
    const photo = await uploaded(sb.id, b.cookie);
    const db = await h.db();
    // Unterstützung lange vorbei, Törn alt → abgelaufen.
    await db.prepare('UPDATE supports SET valid_until = ? WHERE user_id = ?').bind(Date.now() - 400 * DAY, b.user.id).run();
    await db.prepare('UPDATE shares SET created_at = ? WHERE id = ?').bind(Date.now() - 400 * DAY, sb.id).run();
    expect((await h.scheduled()).outcome).toBe('ok');
    expect(await r2Keys(`photos/${sb.id}/`)).toEqual([]);
    expect(await db.prepare('SELECT id FROM photos WHERE id = ?').bind(photo.id).first()).toBeNull();
    // Der Cron rechnet den Zähler aus D1 nach – Fotos zählen mit.
    const sums = await db
      .prepare('SELECT (SELECT COALESCE(SUM(size_bytes + image_bytes), 0) FROM shares) + (SELECT COALESCE(SUM(bytes), 0) FROM photos) AS v')
      .first<{ v: number }>();
    expect(await counter()).toBe(sums!.v);
  });
});

// ---------------------------------------------------------------- Sichtbarkeit

describe('F-81 Sichtbarkeit: Fotos sind nie sichtbarer als ihr Törn', () => {
  it('[F-81] öffentlicher Törn: „Wie der Törn“ für alle, „Nur ich“ nur für den Eigentümer; Bilder ebenso', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const pub = await uploaded(share.id, owner.cookie);
    const priv = await uploaded(share.id, owner.cookie, { meta: { visibility: 'private', caption: 'privat', lat: 54, lon: 13, placement: 'gps' } });
    const anon = await list(share.id);
    expect(anon.body!.photos.map((p) => p.id)).toEqual([pub.id]);
    expect(anon.body!.photos[0]).toMatchObject({ visibility: null, bytes: null });
    expect(anon.body!.upload).toBeNull();
    expect((await list(share.id, owner.cookie)).body!.photos).toHaveLength(2);

    const img = await h.fetch(`/api/photos/${pub.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/jpeg');
    expect(img.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(img.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(img.headers.get('X-Robots-Tag')).toBe('noindex');
    const etag = img.headers.get('ETag')!;
    expect((await h.fetch(`/api/photos/${pub.id}`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    expect((await h.fetch(`/api/photos/${priv.id}`)).status).toBe(404);
    const own = await h.fetch(`/api/photos/${priv.id}?s=f`, { cookie: owner.cookie });
    expect(own.status).toBe(200);
    expect(own.headers.get('Cache-Control')).toBe('private, no-cache');
    expect((await h.fetch(`/api/photos/${pub.id}?s=x`)).status).toBe(404);
  });

  it('[F-81] „Nur mit Link“: Liste und Bilder nur mit Schlüssel (Header bzw. ?k=), nicht cachebar', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie, 'unlisted');
    expect(share.shareKey).toBeTruthy();
    const photo = await uploaded(share.id, owner.cookie);
    expect((await list(share.id)).status).toBe(404);
    expect((await list(share.id, undefined, 'falsch')).status).toBe(404);
    const withKey = await list(share.id, undefined, share.shareKey);
    expect(withKey.body!.photos.map((p) => p.id)).toEqual([photo.id]);
    expect(withKey.body!.photos[0].effectiveVisibility).toBe('unlisted');
    expect((await h.fetch(`/api/photos/${photo.id}`)).status).toBe(404);
    const img = await h.fetch(`/api/photos/${photo.id}?s=t&k=${share.shareKey}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('[F-81] Törn „Nur ich“: Fotos für niemanden sonst; Wechsel des Törns wirkt sofort auf Fotos', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie);
    expect((await h.fetch(`/api/photos/${photo.id}`)).status).toBe(200);
    expect((await send('PATCH', `/api/shares/${share.id}`, owner.cookie, { visibility: 'private' })).status).toBe(200);
    expect((await h.fetch(`/api/photos/${photo.id}`)).status).toBe(404);
    expect((await list(share.id)).status).toBe(404);
    expect((await list(share.id, owner.cookie)).body!.photos[0].effectiveVisibility).toBe('private');
  });

  it('[F-102] Position und Platzierung ändern: manuell gesetzt, gelöscht, ungültig', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie, { meta: {} });
    expect(photo).toMatchObject({ placement: 'none', lat: null, lon: null, takenAt: null });
    const moved = await send('PATCH', `/api/photos/${photo.id}`, owner.cookie, { lat: 54.0012345, lon: 13.0000001, placement: 'manual' });
    expect(((await moved.json()) as { photo: Photo }).photo).toMatchObject({ lat: 54.00123, lon: 13, placement: 'manual' });
    const cleared = await send('PATCH', `/api/photos/${photo.id}`, owner.cookie, { placement: 'none' });
    expect(((await cleared.json()) as { photo: Photo }).photo).toMatchObject({ lat: null, lon: null, placement: 'none' });
    expect(await errorOf(await send('PATCH', `/api/photos/${photo.id}`, owner.cookie, { lat: 'x', lon: 1, placement: 'manual' }))).toBe('invalid_position');
    expect(await errorOf(await send('PATCH', `/api/photos/${photo.id}`, owner.cookie, { visibility: 'unlisted' }))).toBe('invalid_visibility');
    const long = await send('PATCH', `/api/photos/${photo.id}`, owner.cookie, { caption: 'x'.repeat(300) });
    expect(((await long.json()) as { photo: Photo }).photo.caption).toHaveLength(200);
  });
});

// ---------------------------------------------------------------- Melden

describe('F-114 Fotos melden', () => {
  it('[F-114] „Ich bin abgebildet“ blendet sofort aus; Admin sieht Vorschau und kann löschen (R2, Zähler)', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie);
    const reporter = await login(h, email());
    expect(await errorOf(await send('POST', '/api/reports', owner.cookie, { kind: 'photo', id: photo.id, reason: 'spam' }))).toBe('own_object');
    expect((await send('POST', '/api/reports', reporter.cookie, { kind: 'photo', id: photo.id, reason: 'depicted', note: 'Das bin ich' })).status).toBe(201);
    // ausgeblendet: andere sehen es nicht mehr, der Eigentümer schon (mit Hinweis)
    expect((await list(share.id)).body!.photos).toHaveLength(0);
    expect((await h.fetch(`/api/photos/${photo.id}`)).status).toBe(404);
    expect((await list(share.id, owner.cookie)).body!.photos[0].hidden).toBe(true);
    // Admins sehen ausgeblendete Fotos
    expect((await h.fetch(`/api/photos/${photo.id}`, { cookie: admin.cookie })).status).toBe(200);

    const reports = (await (await h.fetch('/api/admin/reports', { cookie: admin.cookie })).json()) as {
      reports: Array<{ id: string; kind: string; targetId: string; target: { title: string; imagePath?: string; hiddenAt: number | null } | null }>;
    };
    const r = reports.reports.find((x) => x.targetId === photo.id)!;
    expect(r.kind).toBe('photo');
    expect(r.target!.title).toMatch(/^Foto zu „Testtörn“/);
    expect(r.target!.imagePath).toBe(`/api/photos/${photo.id}?s=t`);
    expect(r.target!.hiddenAt).not.toBeNull();

    const before = await counter();
    expect((await send('POST', `/api/admin/reports/${r.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect(await r2Keys(`photos/${share.id}/`)).toEqual([]);
    expect(await counter()).toBe(before - photo.bytes!);
    const left = await (await h.db()).prepare("SELECT COUNT(*) AS n FROM reports WHERE target_kind = 'photo' AND target_id = ?").bind(photo.id).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it('[F-114] nur Sichtbares: „Nur ich“-Foto und unbekanntes Foto → 404; Behalten blendet wieder ein', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const priv = await uploaded(share.id, owner.cookie, { meta: { visibility: 'private' } });
    const reporter = await login(h, email());
    expect((await send('POST', '/api/reports', reporter.cookie, { kind: 'photo', id: priv.id, reason: 'spam' })).status).toBe(404);
    expect((await send('POST', '/api/reports', reporter.cookie, { kind: 'photo', id: 'gibtsnicht123456', reason: 'spam' })).status).toBe(404);

    const pub = await uploaded(share.id, owner.cookie);
    expect((await send('POST', '/api/reports', reporter.cookie, { kind: 'photo', id: pub.id, reason: 'depicted' })).status).toBe(201);
    const reports = (await (await h.fetch('/api/admin/reports', { cookie: admin.cookie })).json()) as { reports: Array<{ id: string; targetId: string }> };
    const r = reports.reports.find((x) => x.targetId === pub.id)!;
    expect((await send('POST', `/api/admin/reports/${r.id}`, admin.cookie, { action: 'keep' })).status).toBe(200);
    expect((await list(share.id)).body!.photos.map((p) => p.id)).toEqual([pub.id]);
  });

  it('[F-114] Meldungen zu Fotos fallen mit Törn und Konto weg', async () => {
    const owner = await loginSupporter(h, email());
    const share = await newShare(owner.cookie);
    const photo = await uploaded(share.id, owner.cookie);
    const reporter = await login(h, email());
    expect((await send('POST', '/api/reports', reporter.cookie, { kind: 'photo', id: photo.id, reason: 'spam' })).status).toBe(201);
    expect((await send('DELETE', `/api/shares/${share.id}`, owner.cookie)).status).toBe(204);
    const db = await h.db();
    const n1 = await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_kind = 'photo' AND target_id = ?").bind(photo.id).first<{ n: number }>();
    expect(n1!.n).toBe(0);

    const share2 = await newShare(owner.cookie);
    const photo2 = await uploaded(share2.id, owner.cookie);
    expect((await send('POST', '/api/reports', reporter.cookie, { kind: 'photo', id: photo2.id, reason: 'spam' })).status).toBe(201);
    await grantSupport(h, owner.user.id);
    expect((await send('DELETE', '/api/account', owner.cookie)).status).toBe(200);
    const n2 = await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_kind = 'photo' AND target_id = ?").bind(photo2.id).first<{ n: number }>();
    expect(n2!.n).toBe(0);
  });
});
