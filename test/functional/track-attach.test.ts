// Funktionale Tests: GPX nachreichen (Konzept 38, F-600 … F-606) gegen den echten Worker (Miniflare).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, gzip, payloadJson, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { shareExpiry } from '../../src/domain/support';

const DAY = 86_400_000;
let h: Harness;
let s: ReturnType<typeof social>;
const harbors = { from: '', to: '' };

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
  const owner = await s.person();
  const mk = async (name: string, lat: number, lon: number) =>
    ((await (await s.send('POST', '/api/harbors', owner.cookie, { name: `${name} ${Date.now().toString(36)}`, lat, lon })).json()) as { harbor: { id: string } }).harbor.id;
  harbors.from = await mk('Warnemünde', 54.0, 13.0);
  harbors.to = await mk('Kühlungsborn', 54.02, 13.0);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface Share {
  id: string;
  title: string;
  summary: string;
  source: string;
  distSource: string;
  distNm: number;
  startedAt: number;
  endedAt: number | null;
  sizeBytes: number;
  trackCount: number;
  hasImage: boolean;
  expiresAt: number | null;
  visibility: string;
  from: { id: string } | null;
  to: { id: string } | null;
  log: Record<string, unknown>;
  logState: string;
}

/** SAMPLE_GPX: 13.06.2026, 10:00–10:10 UTC, ≈ 0,6 sm */
const TRACK_START = Date.UTC(2026, 5, 13, 10);
const TRACK_END = Date.UTC(2026, 5, 13, 10, 10);
const UNTIMED_GPX = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Ohne Zeit</name><trkseg><trkpt lat="54" lon="13"></trkpt><trkpt lat="54.01" lon="13"></trkpt></trkseg></trk></gpx>`;

async function manual(p: Person, o: Record<string, unknown> = {}): Promise<Share> {
  const res = await s.send('POST', '/api/shares/manual', p.cookie, {
    startedAt: Date.UTC(2026, 5, 13, 8),
    fromHarbor: { harborId: harbors.from },
    toHarbor: { harborId: harbors.to },
    distNm: 3,
    log: { notes: 'Schöner Tag', windBft: 4 },
    ...o,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: Share }).share;
}

function attach(id: string, cookie: string | undefined, o: { gpx?: string; started?: number | null; ended?: number | null; dist?: number; summary?: string } = {}) {
  const started = o.started === undefined ? TRACK_START : o.started;
  const ended = o.ended === undefined ? TRACK_END : o.ended;
  return gzip(payloadJson([{ name: 'Mini', gpx: o.gpx ?? `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Mini</name><trkseg><trkpt lat="54" lon="13"><time>2026-06-13T10:00:00Z</time></trkpt><trkpt lat="54.01" lon="13"><time>2026-06-13T10:10:00Z</time></trkpt></trkseg></trk></gpx>` }])).then((body) =>
    h.fetch(`/api/shares/${id}/track`, {
      method: 'PUT',
      cookie,
      headers: {
        'Content-Type': 'application/gzip',
        'X-Share-Summary': encodeURIComponent(o.summary ?? '0,6 sm · 13.06.2026'),
        'X-Share-Tracks': '1',
        'X-Share-Distance': String(o.dist ?? 0.6),
        ...(started !== null ? { 'X-Share-Started': String(started) } : {}),
        ...(started !== null && ended !== null ? { 'X-Share-Ended': String(ended) } : {}),
      },
      body,
    }),
  );
}

const errorOf = async (res: Response) => ((await res.json()) as { error: string; message: string });
const db = () => h.db();
const counter = async () => (await (await db()).prepare("SELECT value FROM counters WHERE name = 'storage_bytes'").first<{ value: number }>())!.value;
const meta = async (id: string, cookie?: string) => ((await (await h.fetch(`/api/shares/${id}`, { cookie })).json()) as { share: Share }).share;

describe('F-600 GPX nachreichen: nur Eigentümer:in, nur Einträge ohne GPX', () => {
  it('[F-600] fremde Konten und Gäste bekommen 404 bzw. 401; GPX-Törns 409 not_manual', async () => {
    const owner = await s.person();
    const other = await s.person();
    const entry = await manual(owner);
    expect((await attach(entry.id, undefined)).status).toBe(401);
    expect((await attach(entry.id, other.cookie)).status).toBe(404);
    const gpx = (await (await createShare(h, owner.cookie)).json()) as { share: Share };
    const res = await attach(gpx.share.id, owner.cookie);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).error).toBe('not_manual');
    // ein zweites Nachreichen ersetzt den Track nicht (v1)
    expect((await attach(entry.id, owner.cookie)).status).toBe(200);
    expect((await errorOf(await attach(entry.id, owner.cookie))).error).toBe('not_manual');
  });

  it('[F-600] gesperrte Konten reichen nichts nach (403), gesperrte Törns sind 404', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    await (await db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), owner.user.id).run();
    expect((await attach(entry.id, owner.cookie)).status).toBe(403);
    await (await db()).prepare('UPDATE users SET suspended_at = NULL WHERE id = ?').bind(owner.user.id).run();
    await (await db()).prepare('UPDATE shares SET locked_at = ? WHERE id = ?').bind(Date.now(), entry.id).run();
    expect((await attach(entry.id, owner.cookie)).status).toBe(404);
  });
});

describe('F-601 Aus dem Eintrag wird ein GPX-Törn, der Rest bleibt', () => {
  it('[F-601] Herkunft, Distanz, Zeiten und Payload aus dem Track; Titel, Häfen, Angaben, Crew, Kommentare, Reaktionen bleiben', async () => {
    const owner = await s.person({ profile: 'public' });
    const fan = await s.person({ profile: 'public' });
    const entry = await manual(owner, { title: 'Ostsee-Schlag', ownerRole: 'skipper' });
    expect((await s.send('POST', `/api/shares/${entry.id}/comments`, fan.cookie, { body: 'Toll!' })).status).toBe(201);
    expect((await s.send('PUT', `/api/reactions/share/${entry.id}`, fan.cookie, { kind: 'like' })).status).toBeLessThan(300);
    const res = await attach(entry.id, owner.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const after = ((await res.json()) as { share: Share }).share;
    expect(after).toMatchObject({
      id: entry.id, title: 'Ostsee-Schlag', source: 'gpx', distSource: 'track', distNm: 0.6, startedAt: TRACK_START, endedAt: TRACK_END,
      trackCount: 1, summary: '0,6 sm · 13.06.2026', visibility: entry.visibility, logState: entry.logState,
    });
    expect(after.from?.id).toBe(harbors.from);
    expect(after.to?.id).toBe(harbors.to);
    expect(after.log).toEqual(entry.log);
    const payload = JSON.parse(await (await h.fetch(`/api/shares/${entry.id}/data`, { cookie: owner.cookie })).text()) as { tracks: unknown[]; route?: unknown };
    expect(payload.tracks).toHaveLength(1);
    expect(payload.route).toBeUndefined();
    const d = await db();
    expect((await d.prepare('SELECT kind FROM posts WHERE id = ?').bind(entry.id).first<{ kind: string }>())!.kind).toBe('voyage');
    expect((await d.prepare('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?').bind(entry.id).first<{ n: number }>())!.n).toBe(1);
    expect((await d.prepare('SELECT owner_role FROM shares WHERE id = ?').bind(entry.id).first<{ owner_role: string }>())!.owner_role).toBe('skipper');
    // Medien sind jetzt erlaubt (F-309 gilt nicht mehr): Übersichtsbild
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const img = await h.fetch(`/api/shares/${entry.id}/image`, { method: 'PUT', cookie: owner.cookie, headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
    expect(img.status).toBe(204);
    expect((await meta(entry.id, owner.cookie)).hasImage).toBe(true);
  });

  it('[F-601] Track ohne Zeitstempel: Abfahrt und Ankunft des Eintrags bleiben', async () => {
    const owner = await s.person();
    const entry = await manual(owner, { endedAt: Date.UTC(2026, 5, 13, 16), timed: true });
    const res = await attach(entry.id, owner.cookie, { gpx: UNTIMED_GPX, started: null });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = ((await res.json()) as { share: Share }).share;
    expect(after).toMatchObject({ source: 'gpx', distSource: 'track', startedAt: entry.startedAt, endedAt: Date.UTC(2026, 5, 13, 16) });
  });
});

describe('F-602 Plausibilität und Zeitfenster wie beim Hochladen', () => {
  it('[F-602] Track an einem anderen Tag als ± 1 Tag um den Eintrag: 409 track_mismatch, nichts geändert', async () => {
    const owner = await s.person();
    const entry = await manual(owner, { startedAt: Date.UTC(2026, 5, 10, 8) });
    const before = await counter();
    const res = await attach(entry.id, owner.cookie);
    expect(res.status).toBe(409);
    const err = await errorOf(res);
    expect(err.error).toBe('track_mismatch');
    expect(err.message).toContain('13.06.2026');
    expect(await counter()).toBe(before);
    expect((await meta(entry.id, owner.cookie)).source).toBe('manual');
    // am Vortag (Toleranz) geht es
    const near = await manual(owner, { startedAt: Date.UTC(2026, 5, 12, 20) });
    expect((await attach(near.id, owner.cookie)).status).toBe(200);
  });

  it('[F-602] unplausible Distanz: 400 implausible_distance (plausibleGpx)', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    const res = await attach(entry.id, owner.cookie, { dist: 500 });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe('implausible_distance');
  });

  it('[F-602] kein gültiges Format: 400 invalid_payload', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    const res = await h.fetch(`/api/shares/${entry.id}/track`, { method: 'PUT', cookie: owner.cookie, headers: { 'Content-Type': 'application/gzip' }, body: new Uint8Array([1, 2, 3]) });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe('invalid_payload');
  });
});

describe('F-603 Kontingente und Speicherzähler', () => {
  it('[F-603] Zähler wächst um die Differenz neue Payload − alte Route; Größe am Törn', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    const before = await counter();
    const after = ((await (await attach(entry.id, owner.cookie)).json()) as { share: Share }).share;
    expect(after.sizeBytes).toBeGreaterThan(0);
    expect(await counter()).toBe(before + after.sizeBytes - entry.sizeBytes);
  });

  it('[F-603] Törn-Kontingent: ohne Unterstützung über FREE_SHARES 402, das Fahrtenbuch-Kontingent wird frei', async () => {
    const owner = await s.person();
    for (let i = 0; i < 3; i++) expect((await createShare(h, owner.cookie)).status).toBe(201);
    const entry = await manual(owner);
    const res = await attach(entry.id, owner.cookie);
    expect(res.status).toBe(402);
    expect((await errorOf(res)).error).toBe('supporter_required');
    const support = async () => (await (await h.fetch('/api/me/support', { cookie: owner.cookie })).json()) as { sharesUsed: number; logEntriesUsed: number };
    expect(await support()).toMatchObject({ sharesUsed: 3 });
    await (await db()).prepare('DELETE FROM shares WHERE id = (SELECT id FROM shares WHERE user_id = ? AND source = ? LIMIT 1)').bind(owner.user.id, 'gpx').run();
    expect((await attach(entry.id, owner.cookie)).status).toBe(200);
    expect(await support()).toMatchObject({ sharesUsed: 3 });
  });
});

describe('F-604 Aufbewahrung nach Törn-Regel', () => {
  it('[F-604] Löschtermin danach wie ein GPX-Törn (eine Saison früher), Warnung zurückgesetzt', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    await (await db()).prepare('UPDATE shares SET expiry_warned_at = 1 WHERE id = ?').bind(entry.id).run();
    const row = (await (await db()).prepare('SELECT created_at FROM shares WHERE id = ?').bind(entry.id).first<{ created_at: number }>())!;
    expect((await attach(entry.id, owner.cookie)).status).toBe(200);
    const after = await meta(entry.id, owner.cookie);
    expect(after.expiresAt).toBe(shareExpiry(row.created_at, null));
    expect(after.expiresAt!).toBeLessThan(entry.expiresAt!);
    expect((await (await db()).prepare('SELECT expiry_warned_at AS w FROM shares WHERE id = ?').bind(entry.id).first<{ w: number | null }>())!.w).toBeNull();
  });

  it('[F-604] Eintrag der Vorsaison: Löschtermin läge in der Vergangenheit → 409 expiry_soon, Eintrag bleibt', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    await (await db()).prepare('UPDATE shares SET created_at = ? WHERE id = ?').bind(Date.UTC(2025, 5, 14), entry.id).run();
    const res = await attach(entry.id, owner.cookie);
    expect(res.status).toBe(409);
    const err = await errorOf(res);
    expect(err.error).toBe('expiry_soon');
    expect(err.message).toContain('01.02.2026');
    expect((await meta(entry.id, owner.cookie)).source).toBe('manual');
  });
});

describe('F-606 Löschwege nach dem Nachreichen', () => {
  async function attached(p: Person): Promise<Share> {
    const entry = await manual(p);
    const res = await attach(entry.id, p.cookie);
    expect(res.status).toBe(200);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    expect((await h.fetch(`/api/shares/${entry.id}/image`, { method: 'PUT', cookie: p.cookie, headers: { 'Content-Type': 'image/jpeg' }, body: jpeg })).status).toBe(204);
    return ((await res.json()) as { share: Share }).share;
  }
  const files = async (id: string) => (await (await h.r2()).list({ prefix: '' })).objects.filter((o) => o.key.includes(id)).length;

  it('[F-606] die Route wird überschrieben (eine Datei), einzeln löschen entfernt Track, Bild und Zähleranteil', async () => {
    const owner = await s.person();
    const before = await counter();
    const share = await attached(owner);
    expect(await files(share.id)).toBe(2); // Track + Übersichtsbild, keine alte Route daneben
    expect((await h.fetch(`/api/shares/${share.id}`, { method: 'DELETE', cookie: owner.cookie })).status).toBe(204);
    expect(await files(share.id)).toBe(0);
    expect(await counter()).toBe(before);
  });

  it('[F-606] Frist: der Nachtlauf löscht nach der Törn-Regel (nicht mehr eine Saison später)', async () => {
    const owner = await s.person();
    const share = await attached(owner);
    // angelegt in der Saison 2025: als Eintrag ohne GPX bliebe er bis 1.2.2027, als Törn ist er seit 1.2.2026 fällig
    await (await db()).prepare('UPDATE shares SET created_at = ? WHERE id = ?').bind(Date.UTC(2025, 5, 14), share.id).run();
    await h.scheduled();
    expect(await (await db()).prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(share.id).first()).toBeNull();
    expect(await files(share.id)).toBe(0);
  });

  it('[F-606] Konto löschen entfernt den nachgereichten Track samt Bild', async () => {
    const owner = await s.person();
    const share = await attached(owner);
    expect((await h.fetch('/api/account', { method: 'DELETE', cookie: owner.cookie })).status).toBe(200);
    expect(await files(share.id)).toBe(0);
  });

  // Gleichzeitigkeit: Ein Trigger am Speicherzähler (erstes Statement im Batch) ändert den Törn, bevor sein UPDATE läuft.
  async function race(entryId: string, action: string): Promise<void> {
    await (await db()).prepare(`CREATE TRIGGER race_${entryId} AFTER UPDATE ON counters BEGIN ${action}; END`).run();
  }
  const dropRace = async (entryId: string) => (await db()).prepare(`DROP TRIGGER IF EXISTS race_${entryId}`).run();

  it('[F-606] während des Nachreichens gelöscht: die neue Datei wird wieder entfernt, 404', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    await race(entry.id, `DELETE FROM shares WHERE id = '${entry.id}'`);
    try {
      expect((await attach(entry.id, owner.cookie)).status).toBe(404);
    } finally {
      await dropRace(entry.id);
    }
    expect(await files(entry.id)).toBe(0);
  });

  // Ein echter paralleler Aufruf hat vor diesem Batch umgestellt (ein D1-Batch ist eine Transaktion); dann bucht
  // replaceManualPayloadStmt 0 – die Simulation hier stellt erst nach dem Zähler um und prüft nur den Ausgang.
  it('[F-606] parallel schon nachgereicht: 409 conflict, der Törn bleibt beim anderen Stand', async () => {
    const owner = await s.person();
    const entry = await manual(owner);
    await race(entry.id, `UPDATE shares SET source = 'gpx' WHERE id = '${entry.id}'`);
    try {
      const res = await attach(entry.id, owner.cookie);
      expect(res.status).toBe(409);
      expect((await errorOf(res)).error).toBe('conflict');
    } finally {
      await dropRace(entry.id);
    }
    const row = (await (await db()).prepare('SELECT source, dist_source AS ds, size_bytes AS sb FROM shares WHERE id = ?').bind(entry.id).first<{ source: string; ds: string; sb: number }>())!;
    expect(row).toEqual({ source: 'gpx', ds: entry.distSource, sb: entry.sizeBytes });
  });
});
