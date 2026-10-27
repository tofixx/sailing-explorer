// Funktionale Tests: nächtliches Aufräumen (Cron, worker/retention.ts) – F-63, Saison-Regeln (Konzept 5.5).
// Daten werden direkt in D1/R2 mit Zeitstempeln in der Vergangenheit angelegt, dann wird der
// scheduled-Handler des echten Workers (Miniflare) ausgelöst.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { seasonOf } from '../../src/domain/support';

const DAY = 86_400_000;
/** Upload vor drei Saisons – als kostenloser Törn längst abgelaufen, mit Unterstützung zählt deren Ende. */
const OLD = () => Date.UTC(seasonOf(Date.now()) - 3, 5, 1);
/** Unterstützung, deren Ende den Törn in `days` Tagen ablaufen lässt (Ende + 31 Tage Schonfrist). */
const lapsedUntil = (days: number) => Date.now() - 31 * DAY + days * DAY;

let h: Harness;
/** Mailversand schlägt fehl (resend ohne API-Key) → nichts darf als gewarnt markiert werden. */
let hFail: Harness;

beforeAll(async () => {
  [h, hFail] = await Promise.all([startWorker({ APP_ORIGIN: 'https://sail.example' }), startWorker({ MAIL_PROVIDER: 'resend' })]);
}, 90_000);
afterAll(async () => {
  await Promise.all([h?.dispose(), hFail?.dispose()]);
});

let seq = 0;
const uid = (tag: string) => `${tag}${(++seq).toString().padStart(4, '0')}${Math.random().toString(36).slice(2, 10)}`.replace(/[^A-Za-z0-9]/g, 'x');

type R2Put = { put(key: string, value: string): Promise<unknown> };

async function user(hh: Harness, o: { createdAgo?: number; loginAgo?: number | null } = {}) {
  const id = uid('u');
  const email = `${id}@example.org`;
  const now = Date.now();
  const created = now - (o.createdAgo ?? 0);
  const login = o.loginAgo === null ? null : now - (o.loginAgo ?? 0);
  await (await hh.db()).prepare('INSERT INTO users (id, email, created_at, last_login) VALUES (?, ?, ?, ?)').bind(id, email, created, login).run();
  return { id, email };
}

async function share(hh: Harness, userId: string, t: number, title = 'Törn') {
  const id = uid('s');
  await (await hh.db())
    .prepare('INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at, has_image) VALUES (?, ?, ?, 10, 1, ?, ?, 1)')
    .bind(id, userId, title, t, t)
    .run();
  const r2 = (await hh.r2()) as unknown as R2Put;
  await r2.put(`shares/${id}`, 'gpx');
  await r2.put(`previews/${id}.jpg`, 'jpg');
  return id;
}

async function support(hh: Harness, userId: string, validUntil: number) {
  const id = uid('p');
  await (await hh.db())
    .prepare("INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until) VALUES (?, ?, 'test', ?, 500, 'eur', ?, ?)")
    .bind(id, userId, id, Date.now() - 400 * DAY, validUntil)
    .run();
}

async function shareRow(hh: Harness, id: string) {
  return (await hh.db()).prepare('SELECT id, expiry_warned_at FROM shares WHERE id = ?').bind(id).first<{ id: string; expiry_warned_at: number | null }>();
}
async function userExists(hh: Harness, id: string) {
  return !!(await (await hh.db()).prepare('SELECT id FROM users WHERE id = ?').bind(id).first());
}
async function objects(hh: Harness, id: string) {
  const r2 = await hh.r2();
  return [await r2.head(`shares/${id}`), await r2.head(`previews/${id}.jpg`)].filter(Boolean).length;
}
const mailsTo = (hh: Harness, email: string) => hh.logs.filter((l) => l.includes(`[mail:log] an ${email}:`));

describe('F-63 Aufbewahrung (Cron)', () => {
  // Szenarien – alle vor dem ersten Lauf angelegt, ein gemeinsamer Lauf
  let free: { id: string; email: string };
  let expiredShare: string;
  let freshShare: string;
  let supporter: { id: string; email: string };
  let supporterOldShare: string;
  let lapsed: { id: string; email: string };
  let lapsedShare: string;
  let rewarn: { id: string; email: string };
  let rewarnShare: string;
  let warn: { id: string; email: string };
  let warnA: string;
  let warnB: string;
  let inactiveEmpty: { id: string; email: string };
  let inactiveNeverLoggedIn: { id: string; email: string };
  let inactiveWithShares: { id: string; email: string };
  let inactiveShare: string;
  let inactiveSupporter: { id: string; email: string };
  let inactiveExpired: { id: string; email: string };
  let recentEmpty: { id: string; email: string };
  let mailsBefore: number;

  beforeAll(async () => {
    const now = Date.now();
    free = await user(h);
    expiredShare = await share(h, free.id, OLD());
    freshShare = await share(h, free.id, now);

    supporter = await user(h);
    await support(h, supporter.id, now + 100 * DAY);
    supporterOldShare = await share(h, supporter.id, OLD());

    // Unterstützung beendet → Törn läuft in 10 Tagen ab (Ende der Unterstützung + Januar)
    lapsed = await user(h);
    await support(h, lapsed.id, lapsedUntil(10));
    lapsedShare = await share(h, lapsed.id, OLD(), 'Alter Törn');

    // Vor einem Jahr schon einmal gewarnt, dann unterstützt (Ablauf verschoben) – jetzt läuft er wieder ab
    rewarn = await user(h);
    await support(h, rewarn.id, lapsedUntil(10));
    rewarnShare = await share(h, rewarn.id, OLD());
    await (await h.db()).prepare('UPDATE shares SET expiry_warned_at = ? WHERE id = ?').bind(now - 370 * DAY, rewarnShare).run();

    warn = await user(h);
    await support(h, warn.id, lapsedUntil(7));
    warnA = await share(h, warn.id, OLD(), 'Ostsee');
    warnB = await share(h, warn.id, OLD() + DAY, '<b>Bodden</b>');

    inactiveEmpty = await user(h, { createdAgo: 500 * DAY, loginAgo: 400 * DAY });
    await (await h.db())
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(uid('sess'), inactiveEmpty.id, now - 400 * DAY, now - 370 * DAY)
      .run();
    inactiveNeverLoggedIn = await user(h, { createdAgo: 400 * DAY, loginAgo: null });
    inactiveWithShares = await user(h, { createdAgo: 500 * DAY, loginAgo: 400 * DAY });
    inactiveShare = await share(h, inactiveWithShares.id, now);
    inactiveSupporter = await user(h, { createdAgo: 500 * DAY, loginAgo: 400 * DAY });
    await support(h, inactiveSupporter.id, now + 10 * DAY);
    // Einziger Törn ist abgelaufen → wird gelöscht, danach ist das Konto leer und inaktiv
    inactiveExpired = await user(h, { createdAgo: 500 * DAY, loginAgo: 400 * DAY });
    await share(h, inactiveExpired.id, OLD());
    recentEmpty = await user(h, { createdAgo: 400 * DAY, loginAgo: 30 * DAY });

    const db = await h.db();
    await db.prepare('INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)').bind('tok_old', free.email, now - 2 * DAY, now - DAY).run();
    await db.prepare('INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)').bind('tok_new', free.email, now, now + DAY).run();
    await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind('sess_old', free.id, now - 40 * DAY, now - DAY).run();
    await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind('sess_new', free.id, now, now + DAY).run();

    mailsBefore = h.logs.length;
    const res = await h.scheduled();
    expect(res.outcome).toBe('ok');
  }, 60_000);

  it('[F-63] abgelaufener kostenloser Törn wird gelöscht (Datensatz, Datei, Vorschaubild); jüngere bleiben', async () => {
    expect(await shareRow(h, expiredShare)).toBeNull();
    expect(await objects(h, expiredShare)).toBe(0);
    expect(await shareRow(h, freshShare)).not.toBeNull();
    expect(await objects(h, freshShare)).toBe(2);
    expect(await userExists(h, free.id)).toBe(true);
  });

  it('[F-63] Törns laufender Unterstützer bleiben – auch aus früheren Saisons', async () => {
    const row = await shareRow(h, supporterOldShare);
    expect(row).toMatchObject({ id: supporterOldShare, expiry_warned_at: null });
    expect(await objects(h, supporterOldShare)).toBe(2);
    expect(mailsTo(h, supporter.email)).toHaveLength(0);
  });

  it('[F-63] Törns, die in < 14 Tagen ablaufen: eine Mail pro Konto, expiry_warned_at gesetzt', async () => {
    for (const id of [warnA, warnB]) expect((await shareRow(h, id))!.expiry_warned_at).toEqual(expect.any(Number));
    const mails = mailsTo(h, warn.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatch(/2 Törns werden bald gelöscht/);
    expect(mails[0]).toContain('Ostsee');
    expect(mails[0]).toContain('https://sail.example/?support=open');

    // nach abgelaufener Unterstützung zählt deren Ende + Januar
    expect((await shareRow(h, lapsedShare))!.expiry_warned_at).toEqual(expect.any(Number));
    expect(mailsTo(h, lapsed.email)).toHaveLength(1);
    expect(mailsTo(h, lapsed.email)[0]).toMatch(/Ein Törn wird bald gelöscht/);

    // veraltete Warnung aus einem früheren Ablauf → erneut gewarnt
    expect((await shareRow(h, rewarnShare))!.expiry_warned_at).toBeGreaterThan(Date.now() - 60_000);
    expect(mailsTo(h, rewarn.email)).toHaveLength(1);

    // noch lange hin → keine Mail
    expect((await shareRow(h, freshShare))!.expiry_warned_at).toBeNull();
    expect(mailsTo(h, free.email)).toHaveLength(0);
    expect(h.logs.length).toBeGreaterThan(mailsBefore);
  });

  it('[F-63] inaktive leere Konten werden gelöscht (inkl. Sitzungen); mit Törns, Unterstützung oder jüngerer Anmeldung bleiben sie', async () => {
    expect(await userExists(h, inactiveEmpty.id)).toBe(false);
    expect(await (await h.db()).prepare('SELECT 1 FROM sessions WHERE user_id = ?').bind(inactiveEmpty.id).first()).toBeNull();
    expect(await userExists(h, inactiveNeverLoggedIn.id)).toBe(false);
    expect(await userExists(h, inactiveExpired.id)).toBe(false);

    expect(await userExists(h, inactiveWithShares.id)).toBe(true);
    expect(await shareRow(h, inactiveShare)).not.toBeNull();
    expect(await userExists(h, inactiveSupporter.id)).toBe(true);
    expect(await userExists(h, recentEmpty.id)).toBe(true);
  });

  it('[F-63] abgelaufene Login-Tokens und Sitzungen werden entfernt, gültige bleiben', async () => {
    const db = await h.db();
    const tokens = (await db.prepare('SELECT token_hash FROM login_tokens WHERE email = ?').bind(free.email).all<{ token_hash: string }>()).results;
    expect(tokens.map((t) => t.token_hash)).toEqual(['tok_new']);
    const sessions = (await db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').bind(free.id).all<{ token_hash: string }>()).results;
    expect(sessions.map((s) => s.token_hash)).toEqual(['sess_new']);
  });

  it('[F-63] ein zweiter Lauf warnt nicht erneut und ändert expiry_warned_at nicht', async () => {
    const before = (await shareRow(h, warnA))!.expiry_warned_at;
    expect((await h.scheduled()).outcome).toBe('ok');
    expect((await shareRow(h, warnA))!.expiry_warned_at).toBe(before);
    expect(mailsTo(h, warn.email)).toHaveLength(1);
    expect(mailsTo(h, lapsed.email)).toHaveLength(1);
    expect(mailsTo(h, rewarn.email)).toHaveLength(1);
  });

  it('[F-63] Mailversand fehlgeschlagen → Törn bleibt ungewarnt (nächste Nacht erneut), Lauf bricht nicht ab', async () => {
    const u = await user(hFail);
    await support(hFail, u.id, lapsedUntil(10));
    const s = await share(hFail, u.id, OLD());
    const old = await user(hFail);
    const expired = await share(hFail, old.id, OLD());
    const empty = await user(hFail, { createdAgo: 400 * DAY, loginAgo: 400 * DAY });
    expect((await hFail.scheduled()).outcome).toBe('ok');
    expect((await shareRow(hFail, s))!.expiry_warned_at).toBeNull();
    // die übrigen Schritte laufen trotzdem
    expect(await shareRow(hFail, expired)).toBeNull();
    expect(await userExists(hFail, empty.id)).toBe(false);
  });
});

describe('Saison-Erinnerung im Dezember (Konzept 5.5)', () => {
  it('[F-64] einmal pro Konto und Jahr, nur für Törns, die mit der Saison enden; Unterstützer der nächsten Saison nicht', async () => {
    const season = seasonOf(Date.now()) + 1;
    const dec = new Date(Date.UTC(season, 11, 3, 3, 17));
    const ending = await user(h);
    const a = await share(h, ending.id, Date.UTC(season, 4, 1), 'Havel');
    await share(h, ending.id, Date.UTC(season, 6, 1), 'Wannsee');
    const later = await user(h);
    await share(h, later.id, Date.UTC(season, 10, 10)); // November: zählt zur nächsten Saison
    const backer = await user(h);
    await support(h, backer.id, Date.UTC(season + 2, 0, 1));
    await share(h, backer.id, Date.UTC(season, 4, 1));

    expect((await h.scheduled('17 3 * * *', dec)).outcome).toBe('ok');
    const mails = mailsTo(h, ending.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain('Deine Saison ' + season);
    expect(mails[0]).toContain('deine 2 Törns');
    expect(mails[0]).toContain('privates Projekt');
    expect(mails[0]).toContain('1.2.' + (season + 1));
    expect(mailsTo(h, later.email)).toHaveLength(0);
    expect(mailsTo(h, backer.email)).toHaveLength(0);
    expect(await shareRow(h, a)).not.toBeNull();

    // zweiter Lauf im selben Dezember: keine weitere Mail; außerhalb des Dezembers nie
    expect((await h.scheduled('17 3 * * *', new Date(dec.getTime() + 86_400_000))).outcome).toBe('ok');
    expect(mailsTo(h, ending.email)).toHaveLength(1);
    const novUser = await user(h);
    await share(h, novUser.id, Date.UTC(season, 4, 1));
    expect((await h.scheduled('17 3 * * *', new Date(Date.UTC(season, 10, 20)))).outcome).toBe('ok');
    expect(mailsTo(h, novUser.email)).toHaveLength(0);
  });
});

describe('Löschzeitpunkt: SQL = TypeScript (Konzept 5.5)', () => {
  it('[F-63] EXPIRES_SQL rechnet wie shareExpiry – auch an Monats- und Jahresgrenzen', async () => {
    const { EXPIRES_SQL } = await import('../../worker/shares');
    const { shareExpiry } = await import('../../src/domain/support');
    const db = await h.db();
    const times = [Date.UTC(2026, 0, 1), Date.UTC(2026, 9, 31, 23, 59, 59, 999), Date.UTC(2026, 10, 1), Date.UTC(2027, 11, 31, 23), Date.UTC(2028, 1, 29, 12)];
    for (const t of times) {
      for (const until of [null, Date.UTC(2027, 0, 1), Date.UTC(2030, 0, 1)]) {
        const u = await user(h, { createdAgo: 0 });
        if (until !== null) await support(h, u.id, until);
        const id = await share(h, u.id, t);
        const row = await db.prepare(`SELECT ${EXPIRES_SQL} AS e FROM shares s WHERE s.id = ?`).bind(id).first<{ e: number }>();
        expect(row?.e, `${new Date(t).toISOString()} / ${until}`).toBe(shareExpiry(t, until));
      }
    }
  });
});
