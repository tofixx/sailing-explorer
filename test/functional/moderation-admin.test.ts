// Funktionale Tests: Moderation 3, 6, 8 (Roadmap, Konzept 35; F-570 … F-575) – Hinweis auf offene Meldungen
// (Sammelmail im Nachtlauf, Zähler), Begründung an Betroffene nach Meldungs-Entscheidungen (DSA Art. 17),
// Meldungen zu Gesperrtem. Eigener Worker: Sammelmail und Zähler zählen alle offenen Meldungen der Datenbank.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { decisionGround, noticeReasons, reportBadge, reportLockTarget, shouldNotify, suggestLock } from '../../src/domain/report-decisions';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminMelde0000001';
const ADMIN_MAIL = 'admin-meldungen@example.org';
const CONTACT = 'meldestelle@example.org';
const ORIGIN = 'https://luv.example';

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID, REPORT_CONTACT: CONTACT, APP_ORIGIN: ORIGIN });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  admin = { ...(await login(h, ADMIN_MAIL)), email: ADMIN_MAIL };
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const A = (method: string, path: string, body?: unknown) => s.send(method, path, admin.cookie, body);
const json = async <T>(res: Response): Promise<T> => {
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return (await res.json()) as T;
};
const one = async <T>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const mails = (to: string) => h.logs.filter((l) => l.includes(`[mail:log] an ${to}:`));

async function share(p: Person, title = 'Gemeldeter Törn') {
  const res = await createShare(h, p.cookie, { visibility: 'public', title });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string } }).share;
}
async function report(by: Person, kind: string, id: string, reason = 'spam', note = '') {
  expect((await s.send('POST', '/api/reports', by.cookie, { kind, id, reason, note })).status).toBe(201);
  // bei Profilen ist die Ziel-ID die Konto-ID, nicht der Profilname – daher die letzte Meldung der Person
  return (await one<{ id: string }>('SELECT id FROM reports WHERE reporter_id = ? AND target_kind = ? ORDER BY created_at DESC, rowid DESC', by.user.id, kind))!.id;
}
const decide = async (id: string, action: string) => json<{ ok: true; notified: boolean }>(await A('POST', `/api/admin/reports/${id}`, { action }));
/** Alle offenen Meldungen entscheiden (Ausgangslage je Test) */
async function clearReports() {
  await (await s.db()).prepare(`UPDATE reports SET resolved_at = ?, resolution = 'kept' WHERE resolved_at IS NULL`).bind(Date.now()).run();
}
const count = async () => (await json<{ open: number }>(await A('GET', '/api/admin/reports/count'))).open;
/** „Nächste Nacht“: die letzte Sammelmail 21 h zurückdatieren (Sperre gegen doppelte Läufe: 20 h) */
async function nextNight() {
  await (await s.db()).prepare(`UPDATE admin_log SET created_at = created_at - ? WHERE action = 'report_digest'`).bind(21 * 3_600_000).run();
}
const digests = (from: number) => mails(ADMIN_MAIL).slice(from).filter((l) => l.includes('offene Meldung'));

describe('Moderation: reine Regeln', () => {
  it('[F-572] [F-573] [F-574] Gründe, Benachrichtigung, Sperr-Ziel, Zähler', () => {
    expect(noticeReasons({ spam: 1, illegal: 3, abuse: 0 })).toEqual(['rechtswidriger Inhalt', 'Spam oder Werbung']);
    expect(noticeReasons({ depicted: 1, minors: 2 })).toEqual(['Schutz von Kindern: ein Kind ist abgebildet', 'Recht am eigenen Bild: eine abgebildete Person möchte nicht gezeigt werden']);
    expect([decisionGround({ illegal: 1, spam: 2 }), decisionGround({ depicted: 1 }), decisionGround({ spam: 3, abuse: 1 })]).toEqual(['law', 'law', 'rules']);
    expect(noticeReasons({ neu: 1 })).toEqual(['sonstiger Grund']);
    const base = { wasHidden: false, reasons: { abuse: 1 }, sentToday: 0, sentTotal: 0, selfDecided: false };
    expect(shouldNotify({ ...base, decision: 'hide' })).toBe(true);
    expect(shouldNotify({ ...base, decision: 'delete' })).toBe(true);
    expect(shouldNotify({ ...base, decision: 'keep' })).toBe(false);
    expect(shouldNotify({ ...base, decision: 'keep', wasHidden: true })).toBe(true);
    expect(shouldNotify({ ...base, decision: 'hide', selfDecided: true })).toBe(false);
    // nur Spam: höchstens drei am Tag; sonst immer
    expect(shouldNotify({ ...base, decision: 'delete', reasons: { spam: 4 }, sentToday: 3 })).toBe(false);
    expect(shouldNotify({ ...base, decision: 'delete', reasons: { spam: 4 }, sentToday: 2 })).toBe(true);
    expect(shouldNotify({ ...base, decision: 'delete', reasons: { spam: 4, illegal: 1 }, sentToday: 9 })).toBe(true);
    // Tagesgrenze insgesamt (Mail-Budget)
    expect(shouldNotify({ ...base, decision: 'delete', sentTotal: 29 })).toBe(true);
    expect(shouldNotify({ ...base, decision: 'delete', sentTotal: 30 })).toBe(false);
    expect(reportLockTarget('share', 'S1', 'U1')).toEqual({ kind: 'shares', id: 'S1', account: false });
    expect(reportLockTarget('harbor', 'H1', null)).toEqual({ kind: 'harbors', id: 'H1', account: false });
    expect(reportLockTarget('profile', 'U1', 'U1')).toEqual({ kind: 'users', id: 'U1', account: true });
    expect(reportLockTarget('comment', 'C1', 'U2')).toEqual({ kind: 'users', id: 'U2', account: true });
    expect(reportLockTarget('photo', 'F1', null)).toBeNull();
    expect(suggestLock({ illegal: 1 })).toBe(true);
    expect(suggestLock({ minors: 1 })).toBe(true);
    expect(suggestLock({ spam: 5, illegal: 0 })).toBe(false);
    expect([reportBadge(0), reportBadge(1), reportBadge(99), reportBadge(100)]).toEqual(['', '1', '99', '99+']);
  });
});

describe('Moderation 3: Hinweis an die Admins', () => {
  it('[F-570] Sammelmail im Nachtlauf: nur bei neuen offenen Meldungen, einmal je Nacht, ohne Inhalte und Namen', async () => {
    await clearReports();
    const owner = await s.person({ profile: 'public' });
    const reporter = await s.person({ profile: 'public' });
    // keine offenen Meldungen: keine Mail
    let before = mails(ADMIN_MAIL).length;
    await h.scheduled();
    expect(digests(before)).toHaveLength(0);

    const sh = await share(owner, 'Geheimer Titel');
    await report(reporter, 'share', sh.id, 'abuse', 'Notiz mit Namen');
    before = mails(ADMIN_MAIL).length;
    await h.scheduled();
    const sent = digests(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('eine offene Meldung');
    expect(sent[0]).toContain(`${ORIGIN}/?konto=meldungen`);
    for (const secret of ['Geheimer Titel', 'Notiz mit Namen', owner.email, reporter.email, sh.id]) expect(sent[0]).not.toContain(secret);
    // Wasserstand = Zeitpunkt der neuesten gemeldeten Meldung, nicht der Laufzeit
    const newest = await one<{ t: number }>(`SELECT MAX(created_at) AS t FROM reports WHERE resolved_at IS NULL`);
    const log = await one<{ admin_id: string | null; detail: string; target_id: string }>(`SELECT admin_id, detail, target_id FROM admin_log WHERE action = 'report_digest' ORDER BY created_at DESC`);
    expect(log).toEqual({ admin_id: null, detail: '1 offen, 1 neu', target_id: String(newest!.t) });

    // doppelt gestarteter Lauf in derselben Nacht: keine zweite Mail, auch wenn inzwischen Neues kam
    const other = await share(owner, 'Zweiter Törn');
    await report(reporter, 'share', other.id);
    before = mails(ADMIN_MAIL).length;
    await h.scheduled();
    expect(digests(before)).toHaveLength(0);

    // nächste Nacht: die neue Meldung kommt mit; danach ohne Neues keine Mail
    await nextNight();
    before = mails(ADMIN_MAIL).length;
    await h.scheduled();
    const again = digests(before);
    expect(again).toHaveLength(1);
    expect(again[0]).toContain('2 offene Meldungen (davon 1 neu seit der letzten Mail)');
    await nextNight();
    before = mails(ADMIN_MAIL).length;
    await h.scheduled();
    expect(digests(before)).toHaveLength(0);

    // eine Meldung, die vor dem Lauf entstand, aber nach dem Wasserstand (Wettlauf) – zählt in der nächsten Nacht als neu
    const wm = Number((await one<{ t: string }>(`SELECT target_id AS t FROM admin_log WHERE action = 'report_digest' ORDER BY created_at DESC`))!.t);
    const third = await share(owner, 'Dritter Törn');
    const late = await report(reporter, 'share', third.id);
    await (await s.db()).prepare('UPDATE reports SET created_at = ? WHERE id = ?').bind(wm + 1, late).run();
    await nextNight();
    before = mails(ADMIN_MAIL).length;
    await h.scheduled();
    expect(digests(before)[0]).toContain('3 offene Meldungen (davon 1 neu seit der letzten Mail)');
    await clearReports();
  });

  it('[F-571] Zähler offener Meldungen (je Ziel) nur für Admins; Meldungen zu Gesperrtem zählen nicht und fehlen in der Liste', async () => {
    await clearReports();
    const owner = await s.person({ profile: 'public' });
    const r1 = await s.person({ profile: 'public' });
    const r2 = await s.person({ profile: 'public' });
    expect((await s.send('GET', '/api/admin/reports/count', undefined)).status).toBe(404);
    expect((await s.send('GET', '/api/admin/reports/count', owner.cookie)).status).toBe(404);
    expect(await count()).toBe(0);
    const a = await share(owner, 'Eins');
    const b = await share(owner, 'Zwei');
    await report(r1, 'share', a.id);
    await report(r2, 'share', a.id);
    await report(r1, 'share', b.id);
    expect(await count()).toBe(2);
    // gesperrt: entschieden wird im Admin-Bereich, die Meldung bleibt als Beleg offen
    expect((await A('PUT', `/api/admin/shares/${b.id}/lock`, { reason: 'Beleg' })).status).toBe(200);
    expect(await count()).toBe(1);
    const list = await json<{ reports: Array<{ targetId: string }>; total: number }>(await A('GET', '/api/admin/reports'));
    expect(list.reports.map((r) => r.targetId)).toEqual([a.id]);
    expect(list.total).toBe(1);
    expect(await one(`SELECT 1 AS x FROM reports WHERE target_id = ? AND resolved_at IS NULL`, b.id)).not.toBeNull();
    // ein gesperrtes Profil zählt über das Konto
    const bad = await s.person({ profile: 'public' });
    await report(r1, 'profile', bad.handle!);
    expect(await count()).toBe(2);
    expect((await A('PUT', `/api/admin/users/${bad.user.id}/lock`, { reason: 'Beleg' })).status).toBe(200);
    expect(await count()).toBe(1);
    await clearReports();
  });
});

describe('Moderation 6: Begründung an Betroffene', () => {
  it('[F-572] Ausblenden und Löschen: Mail an Eigentümer:in mit Maßnahme, Grund und Widerspruch – ohne Meldende und Anmerkungen', async () => {
    const owner = await s.person({ profile: 'public' });
    const reporter = await s.person({ profile: 'public' });
    const sh = await share(owner, 'Mein Sommertörn');
    // Kommentar vor dem Ausblenden des Törns (danach kann niemand mehr kommentieren)
    const author = await s.person({ profile: 'public' });
    const c = await json<{ comment: { id: string } }>(await s.send('POST', `/api/shares/${sh.id}/comments`, author.cookie, { body: 'Böser Kommentar' }));
    const cid = await report(reporter, 'comment', c.comment.id, 'illegal');
    const id = await report(reporter, 'share', sh.id, 'abuse', 'Anmerkung des Meldenden');
    let before = mails(owner.email).length;
    expect(await decide(id, 'hide')).toEqual({ ok: true, notified: true });
    const hidden = mails(owner.email).slice(before);
    expect(hidden).toHaveLength(1);
    for (const part of [
      'Moderation – Törn ausgeblendet',
      'dein Törn „Mein Sommertörn“',
      'bis auf Weiteres für alle außer dir nicht mehr sichtbar',
      'Grundlage der Entscheidung: Verstoß gegen die Regeln',
      'beleidigend oder belästigend',
      'Antworte',
      CONTACT,
      'an ein Gericht',
      'ein Mensch',
    ]) expect(hidden[0]).toContain(part);
    for (const secret of [reporter.email, 'Anmerkung des Meldenden']) expect(hidden[0]).not.toContain(secret);
    const log = await one<{ admin_id: string; detail: string }>(`SELECT admin_id, detail FROM admin_log WHERE action = 'report_notice' AND target_kind = 'user' AND target_id = ?`, owner.user.id);
    expect(log?.admin_id).toBe(ADMIN_ID);
    expect(log?.detail).not.toContain('@');

    // Kommentar löschen: Mail an die Autor:in des Kommentars (nicht an den Törn-Eigner)
    before = mails(author.email).length;
    const ownerBefore = mails(owner.email).length;
    expect((await decide(cid, 'delete')).notified).toBe(true);
    const deleted = mails(author.email).slice(before);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('dein Kommentar zum Törn „Mein Sommertörn“');
    expect(deleted[0]).toContain('gelöscht');
    expect(deleted[0]).toContain('rechtswidriger Inhalt');
    expect(deleted[0]).toContain('Grundlage der Entscheidung: rechtswidriger Inhalt bzw. Verletzung von Rechten Dritter');
    expect(mails(owner.email).slice(ownerBefore)).toHaveLength(0);
    expect(await one('SELECT 1 AS x FROM comments WHERE id = ?', c.comment.id)).toBeNull();

    // Profil löschen (Konto bleibt): Mail an das Konto
    const prof = await s.person({ profile: 'public' });
    const pid = await report(reporter, 'profile', prof.handle!, 'other');
    before = mails(prof.email).length;
    expect((await decide(pid, 'delete')).notified).toBe(true);
    expect(mails(prof.email).slice(before)[0]).toContain('dein Profil');

    // Hafen ausblenden: Substantiv im Betreff, „für alle“ (Anleger:innen sehen Ausgeblendetes nicht)
    const anleger = await s.person({ profile: 'public' });
    const hb = (await json<{ harbor: { id: string } }>(await s.send('POST', '/api/harbors', anleger.cookie, { name: s.uniq('Begründungshafen'), lat: -45, lon: -170 }))).harbor;
    before = mails(anleger.email).length;
    expect((await decide(await report(reporter, 'harbor', hb.id, 'abuse'), 'hide')).notified).toBe(true);
    const hm = mails(anleger.email).slice(before)[0];
    expect(hm).toContain('Moderation – Hafen ausgeblendet');
    expect(hm).toContain('bis auf Weiteres für alle nicht mehr sichtbar');
  });

  it('[F-573] Behalten nur nach Ausblenden; keine Mail an gesperrte Konten, ohne Eigentümer:in und bei Spam in Massen', async () => {
    const owner = await s.person({ profile: 'public' });
    const reporter = await s.person({ profile: 'public' });
    const db = await s.db();
    // nicht ausgeblendet → Behalten ohne Mail
    const a = await share(owner, 'Harmlos');
    const ra = await report(reporter, 'share', a.id, 'other');
    let before = mails(owner.email).length;
    expect(await decide(ra, 'keep')).toEqual({ ok: true, notified: false });
    expect(mails(owner.email).slice(before)).toHaveLength(0);
    // bis zur Prüfung ausgeblendet → Behalten mit Mail „wieder sichtbar“, ohne Widerspruch
    const b = await share(owner, 'War ausgeblendet');
    const rb = await report(reporter, 'share', b.id, 'other');
    await db.prepare('UPDATE shares SET hidden_at = ? WHERE id = ?').bind(Date.now(), b.id).run();
    expect((await decide(rb, 'keep')).notified).toBe(true);
    const kept = mails(owner.email).slice(before);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('wieder sichtbar');
    expect(kept[0]).not.toContain('nicht einverstanden');

    // nur Spam: höchstens drei Begründungen je Konto und Tag
    const spammer = await s.person({ profile: 'public' });
    const flags: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const sh = await share(spammer, `Werbung ${i}`);
      flags.push((await decide(await report(reporter, 'share', sh.id, 'spam'), 'delete')).notified);
    }
    expect(flags).toEqual([true, true, true, false]);
    // … anderer Grund geht trotzdem raus
    const sh = await share(spammer, 'Beleidigung');
    expect((await decide(await report(reporter, 'share', sh.id, 'abuse'), 'hide')).notified).toBe(true);

    // Hafen ohne (noch vorhandene) Anleger:in: Entscheidung ja, Mail nein
    const gone = await s.person();
    const hb = (await json<{ harbor: { id: string } }>(await s.send('POST', '/api/harbors', gone.cookie, { name: s.uniq('Meldehafen'), lat: -45, lon: -170 }))).harbor;
    expect((await s.send('DELETE', '/api/account', gone.cookie)).status).toBe(200);
    expect(await decide(await report(reporter, 'harbor', hb.id, 'abuse'), 'hide')).toEqual({ ok: true, notified: false });

    // Tagesgrenze insgesamt: ab 30 Begründungen in 24 h wird entschieden, aber nicht gemailt
    const db2 = await s.db();
    const sentToday = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM admin_log WHERE action = 'report_notice' AND created_at > ?`, Date.now() - DAY))!.n;
    for (let i = sentToday; i < 30; i++) {
      await db2.prepare(`INSERT INTO admin_log (id, admin_id, action, target_kind, target_id, detail, created_at) VALUES (?, ?, 'report_notice', 'user', 'Fuellkonto', '', ?)`).bind(`fuell-${i}`, ADMIN_ID, Date.now()).run();
    }
    const capped = await share(owner, 'Über der Grenze');
    expect(await decide(await report(reporter, 'share', capped.id, 'abuse'), 'hide')).toEqual({ ok: true, notified: false });
    await db2.prepare(`DELETE FROM admin_log WHERE id LIKE ?`).bind('fuell-%').run();
  });

  it('[F-575] Sperre aus einer Kommentar-Meldung: Konto der Autor:in gesperrt → Meldung zählt nicht mehr, Entscheidung 409, Beleg bleibt', async () => {
    await clearReports();
    const owner = await s.person({ profile: 'public' });
    const author = await s.person({ profile: 'public' });
    const reporter = await s.person({ profile: 'public' });
    const sh = await share(owner, 'Törn mit Strafbarem');
    const c = await json<{ comment: { id: string } }>(await s.send('POST', `/api/shares/${sh.id}/comments`, author.cookie, { body: 'Strafbar' }));
    const rc = await report(reporter, 'comment', c.comment.id, 'illegal', 'Beleg-Notiz');
    expect(await count()).toBe(1);
    // „Sperren“ aus der Meldungsansicht trifft bei Kommentaren das Konto (F-574)
    expect((await A('PUT', `/api/admin/users/${author.user.id}/lock`, { reason: 'Gemeldet: rechtswidriger Inhalt' })).status).toBe(200);
    expect(await count()).toBe(0);
    const list = await json<{ reports: unknown[]; total: number }>(await A('GET', '/api/admin/reports'));
    expect(list).toMatchObject({ reports: [], total: 0 });
    const before = mails(author.email).length;
    const res = await A('POST', `/api/admin/reports/${rc}`, { action: 'delete' });
    expect(res.status).toBe(409);
    expect(await one('SELECT 1 AS x FROM comments WHERE id = ?', c.comment.id)).not.toBeNull();
    expect(mails(author.email).slice(before)).toHaveLength(0);
    // nicht nach 180 Tagen anonymisiert, solange das Konto gesperrt ist
    await (await s.db()).prepare('UPDATE reports SET created_at = ? WHERE id = ?').bind(Date.now() - 200 * DAY, rc).run();
    await h.scheduled();
    expect(await one<{ note: string }>('SELECT note FROM reports WHERE id = ?', rc)).toEqual({ note: 'Beleg-Notiz' });
  });

  it('[F-572] [F-573] Titelbild: „Nur Titelbild entfernen“ mit eigener Begründung; „Behalten“ nach Zurückhalten meldet „wieder sichtbar“', async () => {
    const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
    const data = [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 1500 & 0xff, (1500 >> 8) & 0x3f, 500 & 0xff, (500 >> 8) & 0x3f, ...new Array<number>(20).fill(0)];
    const vp8 = [...[...'VP8 '].map((c) => c.charCodeAt(0)), ...le32(data.length), ...data];
    const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...vp8];
    const webp = new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
    const owner = await s.person({ profile: 'public' });
    // altes Konto: sein Titelbild ist sofort öffentlich (sonst hielte F-562 es zurück)
    await (await s.db()).prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(Date.now() - 30 * DAY, owner.user.id).run();
    const reporter = await s.person({ profile: 'public' });
    const boatWithCover = async (name: string) => {
      const b = await s.boat(owner, { visibility: 'public', name });
      const res = await h.fetch(`/api/covers/b/${b.id}`, { method: 'PUT', cookie: owner.cookie, headers: { 'Content-Type': 'application/octet-stream' }, body: webp });
      expect(res.status, await res.clone().text()).toBe(201);
      return b;
    };
    const a = await boatWithCover('Bildboot');
    let before = mails(owner.email).length;
    expect((await decide(await report(reporter, 'boat', a.id, 'depicted'), 'cover')).notified).toBe(true);
    const removed = mails(owner.email).slice(before);
    expect(removed).toHaveLength(1);
    for (const part of ['Moderation – Titelbild entfernt, Boot wieder sichtbar', 'dein Boot „Bildboot“', 'Titelbild entfernt', 'Recht am eigenen Bild', 'Grundlage der Entscheidung: rechtswidriger Inhalt', 'an ein Gericht']) {
      expect(removed[0]).toContain(part);
    }

    // Bild-Meldung hält das Titelbild zurück → „Behalten“ gibt es frei und meldet das
    const b = await boatWithCover('Zweitboot');
    const rb = await report(reporter, 'boat', b.id, 'depicted');
    expect((await one<{ held_until: number | null }>(`SELECT held_until FROM covers WHERE kind = 'b' AND object_id = ?`, b.id))!.held_until).toBeGreaterThan(Date.now());
    before = mails(owner.email).length;
    expect((await decide(rb, 'keep')).notified).toBe(true);
    expect(mails(owner.email).slice(before)[0]).toContain('Boot wieder sichtbar');
  });
});
