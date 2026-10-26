// Funktionale Tests: Kontingente pro Stufe und globale Notbremse (Konzept 5, Phase B) – F-120 … F-123.
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
//   h:  Standard-Konfiguration (Schwellen 8 GB / 9,5 GB, Zähler wird für einzelne Tests gezielt gesetzt)
//   hb: kleine Schwellen (soft 1 MB, hard 2 MB) – Notbremse mit echten Uploads
// Speicher großer Konten wird direkt in D1 angelegt (size_bytes/image_bytes), ohne echte Dateien.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, grantSupport, gzip, login, startWorker, type Harness } from './worker-harness';

/** Ergebnis des letzten Cron-Laufs aus dem Log („retention {…}“). */
function lastRetention(hh: Harness): { deleted: number; storageBytes: number; storageDrift: number | null } {
  const line = [...hh.logs].reverse().find((l) => l.startsWith('retention '));
  return JSON.parse(line!.slice('retention '.length));
}
import { limitsFor } from '../../src/domain/limits';

const MB = 1024 * 1024;
const DAY = 86_400_000;
const JPEG = (size = 68): Uint8Array<ArrayBuffer> => {
  const b = new Uint8Array(size).fill(1);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

let h: Harness;
let hb: Harness;
let n = 0;
const email = (tag = 'l') => `${tag}${++n}-${Date.now()}@example.org`;

beforeAll(async () => {
  [h, hb] = await Promise.all([startWorker(), startWorker({ STORAGE_SOFT_BYTES: String(1 * MB), STORAGE_HARD_BYTES: String(2 * MB) })]);
}, 90_000);
afterAll(async () => {
  await Promise.all([h?.dispose(), hb?.dispose()]);
});

type Json = Record<string, unknown>;
const body = async (res: Response) => (await res.json()) as Json;
const status = async (hh: Harness, cookie: string) => body(await hh.fetch('/api/me/support', { cookie }));
const newBoat = (hh: Harness, cookie: string, name = 'Boot') =>
  hh.fetch('/api/boats', { method: 'POST', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
const putImage = (hh: Harness, id: string, cookie: string, bytes: Uint8Array<ArrayBuffer>) =>
  hh.fetch(`/api/shares/${id}/image`, { method: 'PUT', cookie, headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
const del = (hh: Harness, id: string, cookie: string) => hh.fetch(`/api/shares/${id}`, { method: 'DELETE', cookie });

async function counter(hh: Harness): Promise<number | null> {
  const row = await (await hh.db()).prepare("SELECT value FROM counters WHERE name = 'storage_bytes'").first<{ value: number }>();
  return row ? row.value : null;
}
async function setCounter(hh: Harness, value: number | null) {
  const db = await hh.db();
  if (value === null) await db.prepare("DELETE FROM counters WHERE name = 'storage_bytes'").bind().run();
  else await db.prepare("INSERT INTO counters (name, value) VALUES ('storage_bytes', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").bind(value).run();
}
async function sumShares(hh: Harness): Promise<number> {
  return (await (await hh.db()).prepare('SELECT COALESCE(SUM(size_bytes + image_bytes), 0) AS v FROM shares').first<{ v: number }>())!.v;
}

let seq = 0;
/** Törn direkt in D1 (große Größen ohne echte Datei). */
async function bigShare(hh: Harness, userId: string, size: number, image = 0, createdAgo = 0): Promise<string> {
  const id = `big${(++seq).toString().padStart(4, '0')}${Math.random().toString(36).slice(2, 12)}`.replace(/[^A-Za-z0-9]/g, 'x');
  const t = Date.now() - createdAgo;
  await (await hh.db())
    .prepare('INSERT INTO shares (id, user_id, title, size_bytes, image_bytes, has_image, track_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, userId, 'Groß', size, image, image ? 1 : 0, t, t)
    .run();
  return id;
}

async function created(hh: Harness, cookie: string): Promise<{ id: string; sizeBytes: number }> {
  const res = await createShare(hh, cookie);
  expect(res.status).toBe(201);
  return ((await res.json()) as { share: { id: string; sizeBytes: number } }).share;
}

// ---------------------------------------------------------------- Status

describe('F-123 GET /api/me/support', () => {
  it('[F-123] kostenlos: Grenzen der Stufe, Boote, Grenzen beider Stufen', async () => {
    const { cookie } = await login(h, email());
    expect((await newBoat(h, cookie)).status).toBe(201);
    const s = await status(h, cookie);
    expect(s).toMatchObject({
      supporter: false, sharesUsed: 0, sharesFree: 3, sharesMax: 3, bytesUsed: 0, bytesMax: limitsFor('free').bytes, boatsUsed: 1, boatsMax: 3,
      limits: { free: limitsFor('free'), supporter: limitsFor('supporter') }, storagePaused: false,
    });
  });

  it('[F-123] Unterstützer: 100 Törns, 200 MB, 20 Boote; Speicher zählt Track und Übersichtsbild', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    const share = await created(h, cookie);
    expect((await putImage(h, share.id, cookie, JPEG(5000))).status).toBe(204);
    const s = await status(h, cookie);
    expect(s).toMatchObject({ supporter: true, sharesUsed: 1, sharesMax: 100, bytesMax: 200 * MB, boatsUsed: 0, boatsMax: 20 });
    expect(s.bytesUsed).toBe(share.sizeBytes + 5000);
  });

  it('[F-123] abgelaufene Unterstützung zählt als kostenlos', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id, Date.now() - DAY);
    expect(await status(h, cookie)).toMatchObject({ supporter: false, sharesMax: 3, boatsMax: 3, bytesMax: limitsFor('free').bytes });
  });
});

// ---------------------------------------------------------------- Boote

describe('F-121 Boote: kostenlos 3, Unterstützer 20', () => {
  it('[F-121] kostenlos: das 4. Boot verlangt Unterstützung (402, deutsche Meldung)', async () => {
    const { cookie } = await login(h, email());
    for (let i = 0; i < 3; i++) expect((await newBoat(h, cookie, `Boot ${i}`)).status).toBe(201);
    const res = await newBoat(h, cookie);
    expect(res.status).toBe(402);
    const b = await body(res);
    expect(b.error).toBe('supporter_required');
    expect(b.message).toMatch(/Kostenlos kannst du 3 Boote anlegen/);
  });

  it('[F-121] Unterstützer: bis 20 Boote, das 21. ist 409 quota', { timeout: 30_000 }, async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    for (let i = 0; i < 20; i++) expect((await newBoat(h, cookie, `Boot ${i}`)).status).toBe(201);
    const res = await newBoat(h, cookie);
    expect(res.status).toBe(409);
    const b = await body(res);
    expect(b.error).toBe('quota');
    expect(b.message).toMatch(/Maximal 20 Boote/);
  });

  it('[F-120] abgelaufene Unterstützung: 5 Boote bleiben (bearbeiten geht), ein neues verlangt Unterstützung; nach Löschen unter 3 geht es wieder', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(((await (await newBoat(h, cookie, `Boot ${i}`)).json()) as { boat: { id: string } }).boat.id);
    await (await h.db()).prepare('UPDATE supports SET valid_until = ? WHERE user_id = ?').bind(Date.now() - 1000, user.id).run();
    expect((await newBoat(h, cookie)).status).toBe(402);
    const patch = await h.fetch(`/api/boats/${ids[0]}`, { method: 'PATCH', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Neu' }) });
    expect(patch.status).toBe(200);
    for (const id of ids.slice(0, 3)) expect((await h.fetch(`/api/boats/${id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await newBoat(h, cookie)).status).toBe(201);
  });
});

// ---------------------------------------------------------------- Speicher pro Konto

describe('F-121 Speicher pro Konto (Tracks + Übersichtsbilder)', () => {
  it('[F-121] Unterstützer am 200-MB-Limit: neuer Törn 409 quota – das Übersichtsbild zählt mit', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    // Track allein läge unter der Grenze, erst das Bild füllt sie
    await bigShare(h, user.id, 200 * MB - 1000, 1000);
    const res = await createShare(h, cookie);
    expect(res.status).toBe(409);
    const b = await body(res);
    expect(b.error).toBe('quota');
    expect(b.message).toMatch(/Speicher voll: Höchstens 200 MB pro Konto/);
  });

  it('[F-121] Upload größer als der Rest: 413; kleiner passt', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    await bigShare(h, user.id, 200 * MB - 4000);
    // gzip-Kopf mit zufälligem (nicht komprimierbarem) Rest – größer als die 4000 Bytes, die noch frei sind
    const big = crypto.getRandomValues(new Uint8Array(6000));
    big.set((await gzip('x')).slice(0, 10));
    const res = await createShare(h, cookie, { body: big });
    expect(res.status).toBe(413);
    expect((await createShare(h, cookie)).status).toBe(201);
  });

  it('[F-120] kostenlos über der (impliziten) Speichergrenze: 402 mit Hinweis auf Unterstützer-Speicher', async () => {
    const { cookie, user } = await login(h, email());
    // Altbestand, z. B. aus einer abgelaufenen Unterstützung: 1 Törn, aber mehr Speicher als kostenlos vorgesehen
    await bigShare(h, user.id, limitsFor('free').bytes);
    const res = await createShare(h, cookie);
    expect(res.status).toBe(402);
    const b = await body(res);
    expect(b.error).toBe('supporter_required');
    expect(b.message).toMatch(/Kostenlos stehen dir 41 MB Speicher zur Verfügung/);
    // Bestehendes bleibt
    expect((await status(h, cookie)).sharesUsed).toBe(1);
  });

  it('[F-121] Übersichtsbild über der Grenze: 409; ein gleich großes oder kleineres ersetzen geht', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    const share = await created(h, cookie);
    expect((await putImage(h, share.id, cookie, JPEG(3000))).status).toBe(204);
    await bigShare(h, user.id, 200 * MB - share.sizeBytes - 3000 - 10);
    const bigger = await putImage(h, share.id, cookie, JPEG(3100));
    expect(bigger.status).toBe(409);
    expect((await putImage(h, share.id, cookie, JPEG(2500))).status).toBe(204);
    const row = await (await h.db()).prepare('SELECT image_bytes FROM shares WHERE id = ?').bind(share.id).first<{ image_bytes: number }>();
    expect(row!.image_bytes).toBe(2500);
  });
});

// ---------------------------------------------------------------- Globaler Zähler

describe('F-122 Zähler storage_bytes wird gepflegt', () => {
  it('[F-122] Upload, Übersichtsbild, Ersetzen und Löschen verschieben den Zähler um genau die Bytes', async () => {
    const { cookie } = await login(h, email());
    const before = (await counter(h))!;
    const share = await created(h, cookie);
    expect(await counter(h)).toBe(before + share.sizeBytes);
    expect((await putImage(h, share.id, cookie, JPEG(4000))).status).toBe(204);
    expect(await counter(h)).toBe(before + share.sizeBytes + 4000);
    expect((await putImage(h, share.id, cookie, JPEG(1000))).status).toBe(204);
    expect(await counter(h)).toBe(before + share.sizeBytes + 1000);
    expect((await del(h, share.id, cookie)).status).toBe(204);
    expect(await counter(h)).toBe(before);
  });

  it('[F-122] Konto löschen zieht alle Törns samt Bildern ab', async () => {
    const { cookie } = await login(h, email());
    const before = (await counter(h))!;
    const a = await created(h, cookie);
    const b = await created(h, cookie);
    expect((await putImage(h, a.id, cookie, JPEG(2000))).status).toBe(204);
    expect(await counter(h)).toBe(before + a.sizeBytes + b.sizeBytes + 2000);
    expect((await h.fetch('/api/account', { method: 'DELETE', cookie })).status).toBe(200);
    expect(await counter(h)).toBe(before);
  });

  it('[F-122] der Cron zieht abgelaufene Törns ab und rechnet den Zähler neu (auch eine fehlende Zeile)', async () => {
    const { user } = await login(h, email());
    const expired = await bigShare(h, user.id, 7000, 3000, 120 * DAY);
    // Zähler absichtlich falsch: der Cron korrigiert ihn auf die Summe aus D1
    await setCounter(h, 123);
    const res = await h.scheduled();
    expect(res.outcome).toBe('ok');
    expect(await (await h.db()).prepare('SELECT id FROM shares WHERE id = ?').bind(expired).first()).toBeNull();
    expect(await counter(h)).toBe(await sumShares(h));
    // Abweichung wird geloggt (Betrieb: zeigt Lücken in der inkrementellen Pflege). 123 − 10.000 wird bei 0 gekappt.
    expect(lastRetention(h).storageDrift).toBe(await sumShares(h));

    await setCounter(h, null);
    await h.scheduled();
    expect(await counter(h)).toBe(await sumShares(h));
  });

  it('[F-122] beim Ablauf im Cron wird der Speicher inkrementell abgezogen – das Neuberechnen findet keine Abweichung', async () => {
    const { user } = await login(h, email());
    const total = await sumShares(h);
    await bigShare(h, user.id, 5000, 1000, 120 * DAY);
    // Zähler stimmt (der direkt angelegte Törn ist mitgezählt)
    await setCounter(h, total + 6000);
    await h.scheduled();
    expect(lastRetention(h)).toMatchObject({ deleted: 1, storageBytes: total, storageDrift: 0 });
    expect(await counter(h)).toBe(total);
  });
});

// ---------------------------------------------------------------- Notbremse

describe('F-122 Notbremse', () => {
  it('[F-122] Standard-Schwellen: ab 8 GB pausieren kostenlose Konten (503), Unterstützer laden weiter; ab 9,5 GB alle', async () => {
    const free = await login(h, email());
    const sup = await login(h, email());
    await grantSupport(h, sup.user.id);
    const real = (await counter(h))!;
    try {
      await setCounter(h, 8e9 - 1);
      expect((await createShare(h, free.cookie)).status).toBe(201);
      await setCounter(h, 8e9);
      const res = await createShare(h, free.cookie);
      expect(res.status).toBe(503);
      const b = await body(res);
      expect(b.error).toBe('storage_paused');
      expect(b.message).toMatch(/für kostenlose Konten vorübergehend pausiert/);
      expect((await status(h, free.cookie)).storagePaused).toBe(true);
      expect((await status(h, sup.cookie)).storagePaused).toBe(false);
      expect((await createShare(h, sup.cookie)).status).toBe(201);
      await setCounter(h, 9.5e9);
      expect((await createShare(h, sup.cookie)).status).toBe(503);
      expect((await status(h, sup.cookie)).storagePaused).toBe(true);
    } finally {
      await setCounter(h, real);
    }
  });

  it('[F-122] Schwellen als Worker-Variablen; echte Uploads füllen den Zähler bis zur Bremse', async () => {
    const free = await login(hb, email());
    const sup = await login(hb, email());
    await grantSupport(hb, sup.user.id);
    await setCounter(hb, 1 * MB - 10);
    expect((await createShare(hb, free.cookie)).status).toBe(201);
    // jetzt über soft (1 MB)
    expect((await counter(hb))!).toBeGreaterThanOrEqual(1 * MB);
    expect((await createShare(hb, free.cookie)).status).toBe(503);
    expect((await createShare(hb, sup.cookie)).status).toBe(201);
    await setCounter(hb, 2 * MB);
    expect((await createShare(hb, sup.cookie)).status).toBe(503);
    // Löschen und Übersichtsbilder gehen auch bei voller Bremse
    const { shares } = (await (await hb.fetch('/api/shares', { cookie: sup.cookie })).json()) as { shares: Array<{ id: string }> };
    expect((await putImage(hb, shares[0].id, sup.cookie, JPEG(500))).status).toBe(204);
    expect((await del(hb, shares[0].id, sup.cookie)).status).toBe(204);
  });

  it('[F-122] fail closed: ohne Zähler-Zeile sind neue Törns für alle pausiert', async () => {
    const sup = await login(hb, email());
    await grantSupport(hb, sup.user.id);
    await setCounter(hb, null);
    try {
      const res = await createShare(hb, sup.cookie);
      expect(res.status).toBe(503);
      expect((await body(res)).message).toMatch(/gerade voll/);
      expect((await status(hb, sup.cookie)).storagePaused).toBe(true);
      // Löschen funktioniert auch ohne Zeile und legt sie nicht an
      const s = await bigShare(hb, sup.user.id, 100);
      expect((await del(hb, s, sup.cookie)).status).toBe(204);
      expect(await counter(hb)).toBeNull();
    } finally {
      await setCounter(hb, 0);
    }
  });

  it('[F-120] Reihenfolge: Kontingent des Kontos (402) vor der Notbremse', async () => {
    const { cookie, user } = await login(hb, email());
    for (let i = 0; i < 3; i++) await bigShare(hb, user.id, 10);
    await setCounter(hb, 5 * MB);
    try {
      expect((await createShare(hb, cookie)).status).toBe(402);
    } finally {
      await setCounter(hb, 0);
    }
  });
});
