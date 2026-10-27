// Funktionale Tests: Löschkonzept (Konzept 14.8, F-212) – alles Gespeicherte verschwindet auf jedem Weg: Moderation,
// Löschen durch Verwalter, Konto löschen, nächtlicher Lauf (Fristen, Aufräumen, Zähler).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminDeleteAAAAAA1';
let h: Harness;
let s: ReturnType<typeof social>;
let admin: { cookie: string };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'del-admin@example.org', Date.now() - 10 * DAY).run();
  admin = await login(h, 'del-admin@example.org');
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

// ---------------------------------------------------------------- Bilder (nur Kopfdaten)
const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
function webp(w: number, hh: number): Uint8Array<ArrayBuffer> {
  const data = [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, hh & 0xff, (hh >> 8) & 0x3f, ...new Array<number>(20).fill(0)];
  const vp8 = [...[...'VP8 '].map((c) => c.charCodeAt(0)), ...le32(data.length), ...data];
  const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...vp8];
  return new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
}
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xda, 0x00, 0x02, ...new Array<number>(32).fill(0x11), 0xff, 0xd9]);

const putCover = (kind: string, id: string, cookie: string) =>
  h.fetch(`/api/covers/${kind}/${id}`, { method: 'PUT', cookie, headers: { 'Content-Type': 'application/octet-stream' }, body: webp(1500, 600) });
async function coverKeys(kind: string, objectId: string) {
  return (await (await h.r2()).list({ prefix: `covers/${kind}/${objectId}/` })).objects.length;
}
const coverRow = async (kind: string, objectId: string) =>
  (await h.db()).prepare('SELECT user_id FROM covers WHERE kind = ? AND object_id = ?').bind(kind, objectId).first<{ user_id: string | null }>();

/** Melden und als Admin löschen lassen. */
async function moderateDelete(kind: string, id: string, targetId: string) {
  const reporter = await s.person();
  expect((await s.send('POST', '/api/reports', reporter.cookie, { kind, id, reason: 'abuse', note: '' })).status).toBe(201);
  const list = (await (await s.send('GET', '/api/admin/reports', admin.cookie)).json()) as { reports: Array<{ id: string; targetId: string }> };
  const g = list.reports.find((r) => r.targetId === targetId)!;
  expect((await s.send('POST', `/api/admin/reports/${g.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
}

describe('Titelbilder auf allen Löschwegen (F-212)', () => {
  it('[F-212] Moderation löscht Profil samt Titelbild sofort – ein neues Profil bringt es nicht zurück', async () => {
    const p = await s.person({ profile: 'public' });
    expect((await putCover('u', p.handle!, p.cookie)).status).toBe(201);
    await moderateDelete('profile', p.handle!, p.user.id);
    expect(await coverRow('u', p.user.id)).toBeNull();
    expect(await coverKeys('u', p.user.id)).toBe(0);
    const again = await s.send('PUT', '/api/me/profile', p.cookie, { handle: s.uniq('neu'), displayName: 'Neu', bio: '', visibility: 'public' });
    expect(again.status).toBe(200);
    const page = (await (await s.send('GET', `/api/profiles/${((await again.json()) as { profile: { handle: string } }).profile.handle}`, undefined)).json()) as { cover: unknown };
    expect(page.cover).toBeNull();
  });

  it('[F-212] Moderation löscht ein Boot, der Eigner löscht eine Gruppe – Titelbilder sofort weg', async () => {
    const p = await s.person({ profile: 'public' });
    const b = await s.boat(p);
    await putCover('b', b.id, p.cookie);
    await moderateDelete('boat', b.id, b.id);
    expect(await coverRow('b', b.id)).toBeNull();
    expect(await coverKeys('b', b.id)).toBe(0);

    const g = await s.group(p);
    await putCover('g', g.id, p.cookie);
    expect((await s.send('DELETE', `/api/groups/${g.id}`, p.cookie)).status).toBe(204);
    expect(await coverRow('g', g.id)).toBeNull();
    expect(await coverKeys('g', g.id)).toBe(0);
  });

  it('[F-212] Konto löschen: Profil-/Bootsbild und Übersichtsbilder sofort weg; übergebene Gruppe behält ihr Bild ohne Konto-ID', async () => {
    const owner = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const b = await s.boat(owner);
    const g = await s.group(owner);
    await s.join(owner, g, member);
    await putCover('u', owner.handle!, owner.cookie);
    await putCover('b', b.id, owner.cookie);
    await putCover('g', g.id, owner.cookie);
    const share = await s.share(owner);
    expect((await h.fetch(`/api/shares/${share.id}/image`, { method: 'PUT', cookie: owner.cookie, headers: { 'Content-Type': 'image/jpeg' }, body: jpeg() })).status).toBe(204);
    expect(await (await h.r2()).head(`previews/${share.id}.jpg`)).not.toBeNull();

    expect((await s.send('DELETE', '/api/account', owner.cookie)).status).toBe(200);
    expect(await coverKeys('u', owner.user.id)).toBe(0);
    expect(await coverKeys('b', b.id)).toBe(0);
    expect(await (await h.r2()).head(`previews/${share.id}.jpg`)).toBeNull();
    expect(await (await h.r2()).head(`shares/${share.id}`)).toBeNull();
    // Gruppe ging an das Mitglied: Bild bleibt, aber ohne Bezug zum gelöschten Konto
    expect(await coverKeys('g', g.id)).toBe(1);
    expect(await coverRow('g', g.id)).toEqual({ user_id: null });
  });
});

describe('Austritt und Fristen im nächtlichen Lauf (F-212)', () => {
  it('[F-212] Austritt nimmt die Beitritts-Neuigkeit mit', async () => {
    const owner = await s.person({ profile: 'public' });
    const m: Person = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    await s.join(owner, g, m);
    const db = await h.db();
    const bucket = `member:${g.id}:${m.user.id}`;
    expect(await db.prepare('SELECT 1 AS x FROM activity WHERE bucket = ?').bind(bucket).first()).not.toBeNull();
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me`, m.cookie)).status).toBe(204);
    expect(await db.prepare('SELECT 1 AS x FROM activity WHERE bucket = ?').bind(bucket).first()).toBeNull();

    // Boot aus der Gruppe entfernen nimmt seine Neuigkeit mit
    const b = await s.boat(owner);
    expect((await s.send('POST', `/api/groups/${g.id}/boats`, owner.cookie, { boatId: b.id })).status).toBe(201);
    const boatBucket = `boat:${g.id}:${b.id}`;
    expect(await db.prepare('SELECT 1 AS x FROM activity WHERE bucket = ?').bind(boatBucket).first()).not.toBeNull();
    expect((await s.send('DELETE', `/api/groups/${g.id}/boats/${b.id}`, owner.cookie)).status).toBe(204);
    expect(await db.prepare('SELECT 1 AS x FROM activity WHERE bucket = ?').bind(boatBucket).first()).toBeNull();
  });

  it('[F-212] Nacht: abgelaufene Challenges weg, offene Meldungen nach 180 Tagen anonym, alte Zahlungen gelöscht, Zähler ohne Drift', async () => {
    const db = await h.db();
    const now = Date.now();
    await db.prepare(`INSERT INTO webauthn_challenges (id, challenge, kind, user_id, expires_at) VALUES ('ChallengeOldAAAAAA', 'x', 'login', NULL, ?)`).bind(now - 1000).run();
    const p = await s.person({ profile: 'public' });
    const reporter = await s.person();
    await s.send('POST', '/api/reports', reporter.cookie, { kind: 'profile', id: p.handle, reason: 'other', note: 'privat' });
    await db.prepare('UPDATE reports SET created_at = ? WHERE target_id = ?').bind(now - 181 * DAY, p.user.id).run();
    await db
      .prepare(`INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until) VALUES ('SupportOldAAAAAAAA', NULL, 'stripe', 'cs_old', 500, 'eur', ?, ?)`)
      .bind(now - 12 * 365 * DAY, now - 11 * 365 * DAY)
      .run();
    // Mischung aus Törn, Übersichtsbild und Titelbild – danach darf die Neuberechnung nichts korrigieren müssen
    const share = await s.share(p);
    await h.fetch(`/api/shares/${share.id}/image`, { method: 'PUT', cookie: p.cookie, headers: { 'Content-Type': 'image/jpeg' }, body: jpeg() });
    await putCover('u', p.handle!, p.cookie);
    // Zählerstand der inkrementellen Pflege (alle bisherigen Lösch- und Ersetzungswege dieser Datei) vor der Nacht …
    const counted = (await db.prepare(`SELECT value FROM counters WHERE name = 'storage_bytes'`).first<{ value: number }>())!.value;
    await h.scheduled();
    // … muss der Neuberechnung entsprechen, und kein Schritt der Nacht darf gescheitert sein
    const run = JSON.parse(h.logs.filter((l) => l.startsWith('retention ')).at(-1)!.slice('retention '.length)) as { storageBytes: number; storageDrift: number; failed: string[] };
    expect(run).toMatchObject({ storageBytes: counted, storageDrift: 0, failed: [] });

    // Gegenproben: jüngere offene Meldung und jüngere Zahlung bleiben unverändert
    const q = await s.person({ profile: 'public' });
    await s.send('POST', '/api/reports', reporter.cookie, { kind: 'profile', id: q.handle, reason: 'other', note: 'bleibt' });
    await db.prepare('UPDATE reports SET created_at = ? WHERE target_id = ?').bind(now - 100 * DAY, q.user.id).run();
    await db
      .prepare(`INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until) VALUES ('SupportNewAAAAAAAA', NULL, 'stripe', 'cs_new', 500, 'eur', ?, ?)`)
      .bind(now - 5 * 365 * DAY, now - 4 * 365 * DAY)
      .run();
    await h.scheduled();
    expect(await db.prepare('SELECT note FROM reports WHERE target_id = ?').bind(q.user.id).first()).toEqual({ note: 'bleibt' });
    expect(await db.prepare(`SELECT 1 AS x FROM supports WHERE id = 'SupportNewAAAAAAAA'`).first()).not.toBeNull();

    expect(await db.prepare(`SELECT 1 AS x FROM webauthn_challenges WHERE id = 'ChallengeOldAAAAAA'`).first()).toBeNull();
    expect(await db.prepare('SELECT reporter_id, note FROM reports WHERE target_id = ?').bind(p.user.id).first()).toEqual({ reporter_id: null, note: '' });
    expect(await db.prepare(`SELECT 1 AS x FROM supports WHERE id = 'SupportOldAAAAAAAA'`).first()).toBeNull();
  });
});
