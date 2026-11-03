// Funktionale Tests: Moderation von Titelbildern und Melde-Gewicht (Konzept 36, F-560 … F-569). Tageslimit,
// Zurückhalten neuer Konten, Bild-Gründe, Admin-Entscheidung „Nur Titelbild entfernen“, Löschwege von `cover_log`,
// geprüfte Bilder, befristete Zurückhaltung durch neue Konten.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantSupport, login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { COVER_LIMITS } from '../../src/domain/limits';
import { NEW_REPORTER_HOLD_MS, REPORT_HOLD } from '../../src/domain/cover';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminCoverModAAAA1';

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'covermod-admin@example.org', Date.now() - 10 * DAY).run();
  const a = await login(h, 'covermod-admin@example.org');
  admin = { ...a, email: 'covermod-admin@example.org' };
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
function webp(w = 1500, hh = 500): Uint8Array<ArrayBuffer> {
  const data = [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, hh & 0xff, (hh >> 8) & 0x3f, ...new Array<number>(20).fill(0)];
  const vp8 = [...[...'VP8 '].map((c) => c.charCodeAt(0)), ...le32(data.length), ...data];
  const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...vp8];
  return new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
}

const putCover = (kind: string, id: string, p: Person) =>
  h.fetch(`/api/covers/${kind}/${id}`, { method: 'PUT', cookie: p.cookie, headers: { 'Content-Type': 'application/octet-stream' }, body: webp() });
const run = async (sql: string, ...args: unknown[]) => (await h.db()).prepare(sql).bind(...args).run();
const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await h.db()).prepare(sql).bind(...args).first<T>();
/** Konto frisch angelegt (F-560: neu) */
const makeNew = (p: Person) => run('UPDATE users SET created_at = ? WHERE id = ?', Date.now() - DAY, p.user.id);
const report = (p: Person, kind: string, id: string, reason: string) => s.send('POST', '/api/reports', p.cookie, { kind, id, reason });
const profile = async (handle: string, p?: Person) =>
  (await (await s.send('GET', `/api/profiles/${handle}`, p?.cookie)).json()) as { cover: string | null; coverHeldUntil?: number | null };
const boatPage = async (id: string, p?: Person) => (await (await s.send('GET', `/api/boats/${id}`, p?.cookie)).json()) as { cover: string | null; coverHeldUntil?: number | null };
const discoverBoat = async (id: string, p?: Person) =>
  ((await (await s.send('GET', '/api/discover?limit=24', p?.cookie)).json()) as { boats: Array<{ id: string; cover: unknown }> }).boats.find((b) => b.id === id);

interface AdminReport { id: string; kind: string; targetId: string; target: { imagePath?: string; coverHeld?: boolean; hiddenAt: number | null } | null }
const adminReport = async (targetId: string) =>
  ((await (await s.send('GET', '/api/admin/reports', admin.cookie)).json()) as { reports: AdminReport[] }).reports.find((r) => r.targetId === targetId);

describe('F-561 Tageslimit für Titelbilder', () => {
  it('[F-561] höchstens 5 neue Titelbilder je Konto in 24 h über alle Objekte; Ausschnitt und Entfernen zählen nicht', async () => {
    const me = await s.person({ profile: 'public' });
    const b = await s.boat(me);
    for (let i = 0; i < COVER_LIMITS.perDay; i++) expect((await putCover(i % 2 ? 'b' : 'u', i % 2 ? b.id : me.handle!, me)).status).toBe(201);
    expect((await s.send('PATCH', `/api/covers/b/${b.id}`, me.cookie, { focusY: 20 })).status).toBe(200);
    expect((await s.send('DELETE', `/api/covers/b/${b.id}`, me.cookie)).status).toBe(204);
    const over = await putCover('b', b.id, me);
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toBe('cover_quota');
    // ein anderes Konto hat sein eigenes Limit
    const other = await s.person({ profile: 'public' });
    expect((await putCover('u', other.handle!, other)).status).toBe(201);
    // nach 24 h wieder frei
    await run('UPDATE cover_log SET created_at = created_at - ? WHERE user_id = ?', DAY + 1000, me.user.id);
    expect((await putCover('b', b.id, me)).status).toBe(201);
  });

  it('[F-561] cover_log: nachts nach 2 Tagen weg, mit dem Konto gelöscht, beim Zusammenführen umgehängt', async () => {
    const me = await s.person({ profile: 'public' });
    expect((await putCover('u', me.handle!, me)).status).toBe(201);
    await run('INSERT INTO cover_log (user_id, created_at) VALUES (?, ?)', me.user.id, Date.now() - 3 * DAY);
    expect((await h.scheduled()).outcome).toBe('ok');
    expect(await one<{ n: number }>('SELECT COUNT(*) AS n FROM cover_log WHERE user_id = ?', me.user.id)).toEqual({ n: 1 });

    const into = await s.person();
    expect((await s.send('POST', `/api/admin/users/${me.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: me.user.id })).status).toBe(200);
    expect(await one<{ n: number }>('SELECT COUNT(*) AS n FROM cover_log WHERE user_id = ?', into.user.id)).toEqual({ n: 1 });

    expect((await s.send('DELETE', '/api/account', into.cookie)).status).toBe(200);
    expect(await one<{ n: number }>('SELECT COUNT(*) AS n FROM cover_log WHERE user_id = ?', into.user.id)).toEqual({ n: 0 });
  });
});

describe('F-562 Titelbilder neuer Konten zurückhalten', () => {
  it('[F-560][F-562][F-563] neues Konto: Bild nur für Verwalter und Admins (mit Zeitpunkt für den Hinweis), nicht für Gäste, nicht in Listen; ab Tag 7 öffentlich', async () => {
    const me = await s.person({ profile: 'public' });
    await makeNew(me);
    const b = await s.boat(me, { visibility: 'public' });
    const res = await putCover('b', b.id, me);
    expect(res.status).toBe(201);
    const put = (await res.json()) as { cover: string; coverHeldUntil: number };
    const created = (await one<{ created_at: number }>('SELECT created_at FROM users WHERE id = ?', me.user.id))!.created_at;
    expect(put.coverHeldUntil).toBe(created + 7 * DAY);

    // Verwalter und Admin sehen es samt Hinweis-Zeitpunkt, Gäste nicht
    expect(await boatPage(b.id, me)).toMatchObject({ cover: put.cover, coverHeldUntil: put.coverHeldUntil });
    expect(await boatPage(b.id, admin)).toMatchObject({ cover: put.cover, coverHeldUntil: put.coverHeldUntil });
    expect(await boatPage(b.id)).toMatchObject({ cover: null, coverHeldUntil: null });
    const other = await s.person();
    expect((await boatPage(b.id, other)).cover).toBeNull();

    // Bilddatei: Verwalter privat, sonst 404 – nie öffentlich cachebar
    const own = await s.send('GET', put.cover, me.cookie);
    expect(own.status).toBe(200);
    expect(own.headers.get('Cache-Control')).toBe('private, no-cache');
    expect((await s.send('GET', put.cover, admin.cookie)).status).toBe(200);
    expect((await h.fetch(put.cover)).status).toBe(404);
    expect((await s.send('GET', put.cover, other.cookie)).status).toBe(404);

    // Cache: auch nach dem Abruf durch den Verwalter enthält Entdecken (öffentlich gecacht) kein Bild
    expect((await discoverBoat(b.id, me))?.cover).toBeNull();
    expect((await discoverBoat(b.id))?.cover).toBeNull();

    // Frist abgelaufen: öffentlich, überall
    await run('UPDATE covers SET held_until = ? WHERE object_id = ?', Date.now() - 1000, b.id);
    expect(await boatPage(b.id)).toMatchObject({ cover: put.cover, coverHeldUntil: null });
    const pub = await h.fetch(put.cover);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect((await discoverBoat(b.id))?.cover).toMatchObject({ src: put.cover });
  });

  it('[F-560][F-562] Unterstützer: sofort öffentlich; späterer Unterstützer-Status gilt nur für neue Bilder', async () => {
    const sup = await s.person({ profile: 'public', supporter: true });
    await makeNew(sup);
    expect(((await (await putCover('u', sup.handle!, sup)).json()) as { coverHeldUntil: number | null }).coverHeldUntil).toBeNull();
    expect((await profile(sup.handle!)).cover).not.toBeNull();

    const fresh = await s.person({ profile: 'public' });
    await makeNew(fresh);
    expect((await putCover('u', fresh.handle!, fresh)).status).toBe(201);
    expect((await profile(fresh.handle!)).cover).toBeNull();
    expect((await profile(fresh.handle!, fresh)).cover).not.toBeNull();
    // Unterstützer-Status nach dem Upload: das bereits hochgeladene Bild wartet (Konzept 36.2 Nr. 1), ein neues nicht
    await grantSupport(h, fresh.user.id);
    expect((await profile(fresh.handle!)).cover).toBeNull();
    expect((await putCover('u', fresh.handle!, fresh)).status).toBe(201);
    expect((await profile(fresh.handle!)).cover).not.toBeNull();
  });

  it('[F-562] Gruppe: Titelbild eines neuen Admin-Kontos wartet ebenfalls, Löschen der Gruppe entfernt es', async () => {
    const owner = await s.person({ profile: 'public' });
    await makeNew(owner);
    const g = await s.group(owner, { visibility: 'public' });
    expect((await putCover('g', g.id, owner)).status).toBe(201);
    const page = async (p?: Person) => (await (await s.send('GET', `/api/groups/${g.id}`, p?.cookie)).json()) as { cover: string | null };
    expect((await page()).cover).toBeNull();
    expect((await page(owner)).cover).not.toBeNull();
    expect((await s.send('DELETE', `/api/groups/${g.id}`, owner.cookie)).status).toBeLessThan(300);
    expect(await one(`SELECT 1 AS x FROM covers WHERE kind = 'g' AND object_id = ?`, g.id)).toBeNull();
  });
});

describe('F-565 Melde-Gewicht neuer Konten', () => {
  it('[F-565] drei Meldungen neuer Konten blenden nicht aus, die dritte eines älteren Kontos schon', async () => {
    const owner = await s.person({ profile: 'public' });
    const sh = await s.share(owner);
    const fresh = [await s.person(), await s.person(), await s.person()];
    for (const p of fresh) {
      await makeNew(p);
      expect((await report(p, 'share', sh.id, 'spam')).status).toBe(201);
    }
    expect((await h.fetch(`/api/shares/${sh.id}`)).status).toBe(200);
    expect(await one<{ n: number }>('SELECT SUM(weight) AS n FROM reports WHERE target_id = ?', sh.id)).toEqual({ n: 0 });
    for (let i = 0; i < 2; i++) expect((await report(await s.person(), 'share', sh.id, 'spam')).status).toBe(201);
    expect((await h.fetch(`/api/shares/${sh.id}`)).status).toBe(200);
    // Unterstützer zählen, auch wenn ihr Konto neu ist
    const sup = await s.person({ supporter: true });
    await makeNew(sup);
    expect((await report(sup, 'share', sh.id, 'spam')).status).toBe(201);
    expect((await h.fetch(`/api/shares/${sh.id}`)).status).toBe(404);
  });
});

describe('F-566 Bild-Gründe', () => {
  it('[F-566] „Ich bin abgebildet“ am Profil blendet nur das Titelbild aus; Austausch bleibt zurückgehalten; Behalten gibt es frei', async () => {
    const owner = await s.person({ profile: 'public' });
    expect((await putCover('u', owner.handle!, owner)).status).toBe(201);
    const reporter = await s.person();
    expect((await report(reporter, 'profile', owner.handle!, 'depicted')).status).toBe(201);
    expect((await h.fetch(`/api/profiles/${owner.handle}`)).status).toBe(200);
    expect((await profile(owner.handle!)).cover).toBeNull();
    expect((await profile(owner.handle!, owner)).coverHeldUntil).toBe(REPORT_HOLD);
    // ohne sichtbares Bild gibt es den Grund nicht mehr
    expect(await s.errorOf(await report(await s.person(), 'profile', owner.handle!, 'minors'))).toBe('invalid_reason');
    // neues Bild während der offenen Meldung: weiter zurückgehalten
    expect((await putCover('u', owner.handle!, owner)).status).toBe(201);
    expect((await profile(owner.handle!)).cover).toBeNull();

    const r = await adminReport(owner.user.id);
    expect(r!.target).toMatchObject({ coverHeld: true, imagePath: expect.stringMatching(new RegExp(`^/api/covers/u/${owner.handle}/`)) });
    expect((await s.send('GET', r!.target!.imagePath!, admin.cookie)).status).toBe(200);
    expect((await s.send('POST', `/api/admin/reports/${r!.id}`, admin.cookie, { action: 'keep' })).status).toBe(200);
    expect((await profile(owner.handle!)).cover).not.toBeNull();
  });

  it('[F-566] Bild-Gründe nur für Bilder: Boot ohne Titelbild, Törn → 400; „Kinder abgebildet“ am Boot hält nur das Bild zurück', async () => {
    const owner = await s.person({ profile: 'public' });
    const b = await s.boat(owner, { visibility: 'public' });
    const sh = await s.share(owner);
    const p = await s.person();
    expect(await s.errorOf(await report(p, 'boat', b.id, 'depicted'))).toBe('invalid_reason');
    expect(await s.errorOf(await report(p, 'share', sh.id, 'minors'))).toBe('invalid_reason');
    expect((await putCover('b', b.id, owner)).status).toBe(201);
    expect((await report(p, 'boat', b.id, 'minors')).status).toBe(201);
    expect((await boatPage(b.id)).cover).toBeNull();
    expect((await h.fetch(`/api/boats/${b.id}`)).status).toBe(200);
    expect((await discoverBoat(b.id))?.cover).toBeNull();
    expect((await one<{ held_until: number }>(`SELECT held_until FROM covers WHERE kind = 'b' AND object_id = ?`, b.id))!.held_until).toBe(REPORT_HOLD);
  });
});

describe('F-564 Admin: nur das Titelbild entfernen', () => {
  it('[F-564] Entscheidung „cover“ löscht Bild, Datei und Zähleranteil, blendet das Objekt wieder ein, protokolliert', async () => {
    const owner = await s.person({ profile: 'public' });
    const b = await s.boat(owner, { visibility: 'public' });
    expect((await putCover('b', b.id, owner)).status).toBe(201);
    const ver = (await one<{ ver: string }>(`SELECT ver FROM covers WHERE kind = 'b' AND object_id = ?`, b.id))!.ver;
    const counter = async () => (await one<{ value: number }>(`SELECT value FROM counters WHERE name = 'storage_bytes'`))?.value ?? 0;
    const before = await counter();
    // drei Konten: das Boot ist ausgeblendet
    for (let i = 0; i < 3; i++) expect((await report(await s.person(), 'boat', b.id, 'abuse')).status).toBe(201);
    expect((await h.fetch(`/api/boats/${b.id}`)).status).toBe(404);
    const r = await adminReport(b.id);
    expect(r!.target!.imagePath).toBe(`/api/covers/b/${b.id}/${ver}`);
    expect((await s.send('POST', `/api/admin/reports/${r!.id}`, admin.cookie, { action: 'cover' })).status).toBe(200);
    expect(await one(`SELECT 1 AS x FROM covers WHERE kind = 'b' AND object_id = ?`, b.id)).toBeNull();
    expect(await counter()).toBeLessThan(before);
    expect((await (await h.r2()).list({ prefix: `covers/b/${b.id}/` })).objects).toEqual([]);
    expect((await h.fetch(`/api/boats/${b.id}`)).status).toBe(200);
    expect(await one(`SELECT 1 AS x FROM admin_log WHERE action = 'report_cover' AND target_id = ?`, b.id)).not.toBeNull();
    expect(await one<{ resolution: string }>('SELECT resolution FROM reports WHERE target_id = ?', b.id)).toEqual({ resolution: 'cover_removed' });
  });

  it('[F-564] „cover“ nur für Profil, Boot, Gruppe', async () => {
    const owner = await s.person({ profile: 'public' });
    const sh = await s.share(owner);
    expect((await report(await s.person(), 'share', sh.id, 'spam')).status).toBe(201);
    const r = await adminReport(sh.id);
    expect(await s.errorOf(await s.send('POST', `/api/admin/reports/${r!.id}`, admin.cookie, { action: 'cover' }))).toBe('invalid_action');
  });
});

// ---------------------------------------------------------------- Review-Befunde (Konzept 36.2)

const heldUntil = async (kind: string, id: string) =>
  (await one<{ held_until: number | null }>('SELECT held_until FROM covers WHERE kind = ? AND object_id = ?', kind, id))?.held_until;
const photoHidden = async (id: string) => (await one<{ hidden_at: number | null }>('SELECT hidden_at FROM photos WHERE id = ?', id))!.hidden_at;

describe('F-568 Geprüftes Bild', () => {
  it('[F-568] nach „Behalten“ hält eine neue Bild-Meldung dieselbe Version nicht erneut zurück, ein neues Bild schon', async () => {
    const owner = await s.person({ profile: 'public' });
    expect((await putCover('u', owner.handle!, owner)).status).toBe(201);
    expect((await report(await s.person(), 'profile', owner.handle!, 'depicted')).status).toBe(201);
    const r = await adminReport(owner.user.id);
    expect((await s.send('POST', `/api/admin/reports/${r!.id}`, admin.cookie, { action: 'keep' })).status).toBe(200);
    // erneut gemeldet: nur in der Liste, das Bild bleibt öffentlich
    expect((await report(await s.person(), 'profile', owner.handle!, 'minors')).status).toBe(201);
    expect((await profile(owner.handle!)).cover).not.toBeNull();
    expect(await adminReport(owner.user.id)).toBeDefined();
    // ein neues Bild ist nicht geprüft: die offene Bild-Meldung hält es zurück
    expect((await putCover('u', owner.handle!, owner)).status).toBe(201);
    expect((await profile(owner.handle!)).cover).toBeNull();
  });

  it('[F-568][F-566] „Kinder abgebildet“ blendet ein Foto aus; nach „Behalten“ nicht erneut', async () => {
    const owner = await s.person({ profile: 'public' });
    const sh = await s.share(owner);
    const photoId = `Ph${Date.now().toString(36)}abc`;
    await run(
      `INSERT INTO photos (id, share_id, user_id, visibility, width, height, format, bytes, created_at) VALUES (?, ?, ?, 'public', 10, 10, 'jpeg', 100, ?)`,
      photoId, sh.id, owner.user.id, Date.now(),
    );
    expect((await report(await s.person(), 'photo', photoId, 'minors')).status).toBe(201);
    expect(await photoHidden(photoId)).not.toBeNull();
    const r = await adminReport(photoId);
    expect((await s.send('POST', `/api/admin/reports/${r!.id}`, admin.cookie, { action: 'keep' })).status).toBe(200);
    expect(await photoHidden(photoId)).toBeNull();
    expect((await report(await s.person(), 'photo', photoId, 'depicted')).status).toBe(201);
    expect(await photoHidden(photoId)).toBeNull();
  });
});

describe('F-569 Bild-Meldungen neuer Konten', () => {
  it('[F-569] halten ein Titelbild nur 72 h zurück, höchstens 3 am Tag; Admins sehen „neues Konto“', async () => {
    const owner = await s.person({ profile: 'public', supporter: true }); // mehr als 3 Boote
    const boats: Array<{ id: string }> = [];
    for (let i = 0; i < 4; i++) {
      const b = await s.boat(owner, { visibility: 'public' });
      expect((await putCover('b', b.id, owner)).status).toBe(201);
      boats.push(b);
    }
    const fresh = await s.person();
    await makeNew(fresh);
    const before = Date.now();
    expect((await report(fresh, 'boat', boats[0].id, 'depicted')).status).toBe(201);
    const until = (await heldUntil('b', boats[0].id))!;
    expect(until).toBeGreaterThanOrEqual(before + NEW_REPORTER_HOLD_MS);
    expect(until).toBeLessThan(REPORT_HOLD);
    expect((await boatPage(boats[0].id)).cover).toBeNull();
    // ohne Entscheidung endet die Zurückhaltung von selbst (Zeitpunkt vorgezogen)
    await run('UPDATE covers SET held_until = ? WHERE object_id = ?', Date.now() - 1, boats[0].id);
    expect((await boatPage(boats[0].id)).cover).not.toBeNull();
    // eine Meldung eines älteren Kontos hält unbefristet zurück
    expect((await report(await s.person(), 'boat', boats[0].id, 'depicted')).status).toBe(201);
    expect(await heldUntil('b', boats[0].id)).toBe(REPORT_HOLD);
    // höchstens 3 Bild-Meldungen am Tag für neue Konten; andere Gründe begrenzt nur das allgemeine Limit
    expect((await report(fresh, 'boat', boats[1].id, 'depicted')).status).toBe(201);
    expect((await report(fresh, 'boat', boats[2].id, 'minors')).status).toBe(201);
    expect(await s.errorOf(await report(fresh, 'boat', boats[3].id, 'depicted'))).toBe('report_quota');
    expect((await report(fresh, 'boat', boats[3].id, 'spam')).status).toBe(201);

    const list = ((await (await s.send('GET', '/api/admin/reports', admin.cookie)).json()) as { reports: Array<{ targetId: string; newReporters: number }> }).reports;
    expect(list.find((x) => x.targetId === boats[0].id)?.newReporters).toBe(1);
    expect(list.find((x) => x.targetId === boats[1].id)?.newReporters).toBe(1);
  });
});

describe('Konzept 36: Wechselwirkungen', () => {
  it('[F-566] Ausblenden hebt die Melde-Sperre des Titelbilds auf, Sperren (K 18) ebenso', async () => {
    const owner = await s.person({ profile: 'public' });
    expect((await putCover('u', owner.handle!, owner)).status).toBe(201);
    expect((await report(await s.person(), 'profile', owner.handle!, 'depicted')).status).toBe(201);
    expect(await heldUntil('u', owner.user.id)).toBe(REPORT_HOLD);
    const r = await adminReport(owner.user.id);
    expect((await s.send('POST', `/api/admin/reports/${r!.id}`, admin.cookie, { action: 'hide' })).status).toBe(200);
    expect(await heldUntil('u', owner.user.id)).toBeNull();
    expect((await h.fetch(`/api/profiles/${owner.handle}`)).status).toBe(404);

    const other = await s.person({ profile: 'public' });
    const b = await s.boat(other, { visibility: 'public' });
    expect((await putCover('b', b.id, other)).status).toBe(201);
    expect((await report(await s.person(), 'boat', b.id, 'minors')).status).toBe(201);
    expect(await heldUntil('b', b.id)).toBe(REPORT_HOLD);
    const lock = await s.send('PUT', `/api/admin/boats/${b.id}/lock`, admin.cookie, { reason: 'Prüfung' });
    expect(lock.status, await lock.clone().text()).toBeLessThan(300);
    expect(await heldUntil('b', b.id)).toBeNull();
  });

  it('[F-566] Upload während einer Melde-Sperre: die Sperre bleibt, auch wenn sie erst zwischen Prüfung und Speichern kam', async () => {
    const owner = await s.person({ profile: 'public' });
    const b = await s.boat(owner, { visibility: 'public' });
    expect((await putCover('b', b.id, owner)).status).toBe(201);
    await run('UPDATE covers SET held_until = ? WHERE object_id = ?', REPORT_HOLD, b.id);
    expect((await putCover('b', b.id, owner)).status).toBe(201);
    expect(await heldUntil('b', b.id)).toBe(REPORT_HOLD);
  });

  it('[F-562] zurückgehaltene Titelbilder fehlen in Neuigkeiten (Person, Boot) und Entdecken (Personen, Gruppen) – für alle', async () => {
    type Item = { kind: string; cover?: { src: string } };
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { visibility: 'public' });
    const crew = await s.person({ profile: 'public' });
    await makeNew(crew);
    await s.join(owner, g, crew);
    const boat = await s.boat(crew, { visibility: 'public' });
    await s.share(crew, { boatId: boat.id });
    expect((await putCover('u', crew.handle!, crew)).status).toBe(201);
    expect((await putCover('b', boat.id, crew)).status).toBe(201);
    await s.send('POST', `/api/groups/${g.id}/boats`, crew.cookie, { boatId: boat.id });
    for (const viewer of [owner, crew]) {
      const items = ((await (await s.send('GET', `/api/groups/${g.id}/stream`, viewer.cookie)).json()) as { items: Item[] }).items;
      expect(items.some((i) => i.kind === 'member')).toBe(true);
      expect(items.find((i) => i.kind === 'member')?.cover).toBeUndefined();
      expect(items.find((i) => i.kind === 'boat')?.cover).toBeUndefined();
    }
    const fresh = await s.person({ profile: 'public' });
    await makeNew(fresh);
    const g2 = await s.group(fresh, { visibility: 'public' });
    expect((await putCover('g', g2.id, fresh)).status).toBe(201);
    type Card = { cover?: unknown };
    for (const viewer of [crew, fresh, undefined]) {
      const d = (await (await s.send('GET', '/api/discover?limit=50', viewer?.cookie)).json()) as { people: (Card & { handle: string })[]; groups: (Card & { id: string })[] };
      expect(d.people.some((x) => x.handle === crew.handle)).toBe(true);
      expect(d.people.find((x) => x.handle === crew.handle)?.cover ?? null).toBeNull();
      expect(d.groups.find((x) => x.id === g2.id)?.cover ?? null).toBeNull();
    }
    // Gruppen-Titelbild im Stream: Beitritt in der Gruppe des neuen Kontos
    const joiner = await s.person({ profile: 'public' });
    await s.join(fresh, g2, joiner);
    const items2 = ((await (await s.send('GET', `/api/groups/${g2.id}/stream`, fresh.cookie)).json()) as { items: Item[] }).items;
    expect(items2.every((i) => !i.cover?.src.startsWith('/api/covers/g/'))).toBe(true);
  });
});
