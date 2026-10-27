// Funktionale Tests: Kommentare an Törns (F-110 … F-113, Konzept 4.1–4.3) – Rechte, Sichtbarkeit wie der Törn
// (inkl. Schlüssel), Text-Regeln, Spam-Grenzen, Eigentümer-Moderation, Tages-Sammelmail und Aufräumen.
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, loginSupporter, startWorker, type Harness } from './worker-harness';

const DAY = 86_400_000;

let h: Harness;
let n = 0;
const email = (tag = 'c') => `${tag}${++n}-${Date.now()}@example.org`;
const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;

beforeAll(async () => {
  h = await startWorker({ APP_ORIGIN: 'https://sail.example' });
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string | undefined, body?: unknown, headers: Record<string, string> = {}) =>
  h.fetch(path, {
    method,
    cookie,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const db = async () => h.db();

interface Person { cookie: string; user: { id: string; email: string }; email: string; handle?: string }

/** Konto (standardmäßig älter als 24 h) mit optionalem Profil. */
async function person(o: { profile?: 'public' | 'private' | null; supporter?: boolean; fresh?: boolean } = {}): Promise<Person> {
  const mail = email();
  const s = o.supporter || o.profile === 'private' ? await loginSupporter(h, mail) : await login(h, mail);
  if (!o.fresh) await (await db()).prepare('UPDATE users SET created_at = created_at - ? WHERE id = ?').bind(2 * DAY, s.user.id).run();
  const p: Person = { ...s, email: mail };
  if (o.profile === null) return p;
  const handle = uniq('seg');
  const res = await send('PUT', '/api/me/profile', s.cookie, { handle, displayName: `Name ${handle}`, bio: '', visibility: o.profile ?? 'public' });
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...p, handle };
}

async function newShare(owner: Person, visibility = 'public', title = 'Ostsee-Törn') {
  const res = await createShare(h, owner.cookie, { visibility, title });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string; shareKey: string | null; commentsMode: string } }).share;
}

/** Abstandsregel (20 s) für Folgekommentare im Test überspringen. */
const age = async (p: Person, ms = 30_000) => {
  await (await db()).prepare('UPDATE comment_log SET created_at = created_at - ? WHERE user_id = ?').bind(ms, p.user.id).run();
};

interface CommentOut { id: string; body: string; createdAt: number; author: { displayName: string; handle: string | null }; isMine: boolean; canDelete: boolean; hidden: boolean }
interface ListOut { mode: string; comments: CommentOut[]; canComment: boolean; block: string | null; isOwner: boolean; limits: { maxLength: number; maxLinks: number } }

const post = (p: Person | undefined, shareId: string, body: unknown, key?: string | null) =>
  send('POST', `/api/shares/${shareId}/comments`, p?.cookie, typeof body === 'string' ? { body } : body, key ? { 'X-Share-Key': key } : {});
const list = (p: Person | undefined, shareId: string, key?: string | null) =>
  h.fetch(`/api/shares/${shareId}/comments`, { cookie: p?.cookie, headers: key ? { 'X-Share-Key': key } : undefined });
const listJson = async (p: Person | undefined, shareId: string, key?: string | null) => {
  const res = await list(p, shareId, key);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ListOut;
};
async function comment(p: Person, shareId: string, body: string, key?: string | null): Promise<CommentOut> {
  const res = await post(p, shareId, body, key);
  expect(res.status, await res.clone().text()).toBe(201);
  await age(p);
  return ((await res.json()) as { comment: CommentOut }).comment;
}

// ---------------------------------------------------------------- F-110 Kommentieren

describe('F-110 Kommentare an sichtbaren Törns', () => {
  it('[F-110] angemeldet mit Profil kommentiert einen öffentlichen Törn; alle lesen mit Anzeigename, ohne Konto-ID und E-Mail', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const anna = await person({ profile: 'public' });
    const c = await comment(anna, share.id, 'Schöner Schlag nach Hiddensee!');
    expect(c).toMatchObject({ body: 'Schöner Schlag nach Hiddensee!', isMine: true, canDelete: true, hidden: false });
    expect(c.author).toEqual({ displayName: `Name ${anna.handle}`, handle: anna.handle });

    const anon = await listJson(undefined, share.id);
    expect(anon).toMatchObject({ mode: 'on', canComment: false, block: 'login', isOwner: false, limits: { maxLength: 1000, maxLinks: 2 } });
    expect(anon.comments.map((x) => x.body)).toEqual(['Schöner Schlag nach Hiddensee!']);
    expect(anon.comments[0]).toMatchObject({ isMine: false, canDelete: false });
    const raw = JSON.stringify(anon);
    expect(raw).not.toContain(anna.user.id);
    expect(raw).not.toContain(anna.email);

    const asOwner = await listJson(owner, share.id);
    expect(asOwner.isOwner).toBe(true);
    expect(asOwner.comments[0].canDelete).toBe(true);
  });

  it('[F-110] Name verlinkt nur bei öffentlichem Profil', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const shy = await person({ profile: 'private' });
    await comment(shy, share.id, 'Grüße von Bord');
    const out = await listJson(undefined, share.id);
    expect(out.comments[0].author).toEqual({ displayName: `Name ${shy.handle}`, handle: null });
  });

  it('[F-110] ohne Anmeldung 401, ohne Profil 403 profile_required; die Liste nennt den Grund', async () => {
    const owner = await person();
    const share = await newShare(owner);
    expect((await post(undefined, share.id, 'Hallo')).status).toBe(401);
    const noProfile = await person({ profile: null });
    const res = await post(noProfile, share.id, 'Hallo');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('profile_required');
    expect((await listJson(noProfile, share.id)).block).toBe('profile');
  });

  it('[F-110] reiner Text: bereinigt, HTML bleibt Text, > 1000 Zeichen und > 2 Links → 400, leer → 400', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const p = await person();
    const c = await comment(p, share.id, '  <b>fett</b>​  und\r\n\r\n\r\n\r\n\r\n\r\nweiter  ');
    expect(c.body).toBe('<b>fett</b> und\n\n\n\nweiter');
    const two = await comment(p, share.id, 'Siehe https://a.example/x und http://b.example/y');
    expect(two.body).toContain('https://a.example/x');

    const tooMany = await post(p, share.id, 'https://a.example https://b.example https://c.example');
    expect(tooMany.status).toBe(400);
    expect(((await tooMany.json()) as { error: string }).error).toBe('too_many_links');
    const tooLong = await post(p, share.id, 'x'.repeat(1001));
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { error: string }).error).toBe('comment_too_long');
    expect((await post(p, share.id, 'ä'.repeat(1000))).status).toBe(201);
    expect((await post(p, share.id, '   \n  ')).status).toBe(400);
    expect((await post(p, share.id, { body: 'mit Foto', photoId: 'abc' })).status).toBe(400);
  });

  it('[F-110] nur same-origin', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const p = await person();
    const res = await h.fetch(`/api/shares/${share.id}/comments`, {
      method: 'POST', cookie: p.cookie, origin: 'https://evil.example', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------- Sichtbarkeit wie der Törn

describe('F-110 Kommentare folgen der Sichtbarkeit des Törns (Vererbung, Schlüssel)', () => {
  it('[F-110] „Nur ich“: Fremde bekommen 404 beim Lesen und Schreiben, der Eigentümer nicht', async () => {
    const owner = await person({ supporter: true });
    const share = await newShare(owner, 'private');
    const other = await person();
    expect((await list(other, share.id)).status).toBe(404);
    expect((await list(undefined, share.id)).status).toBe(404);
    expect((await post(other, share.id, 'Hallo')).status).toBe(404);
    expect((await listJson(owner, share.id)).isOwner).toBe(true);
    expect((await post(owner, share.id, 'Notiz an mich')).status).toBe(201);
  });

  it('[F-110] „Nur mit Link“: lesen und schreiben nur mit dem Schlüssel (X-Share-Key); falscher oder fehlender Schlüssel → 404', async () => {
    const owner = await person({ supporter: true });
    const share = await newShare(owner, 'unlisted');
    expect(share.shareKey).toBeTruthy();
    const guest = await person();
    expect((await list(guest, share.id)).status).toBe(404);
    expect((await list(guest, share.id, 'A'.repeat(22))).status).toBe(404);
    expect((await post(guest, share.id, 'ohne Schlüssel')).status).toBe(404);
    await comment(guest, share.id, 'mit Schlüssel', share.shareKey);
    expect((await listJson(undefined, share.id, share.shareKey)).comments.map((c) => c.body)).toEqual(['mit Schlüssel']);

    // Link erneuern: alter Schlüssel öffnet auch die Kommentare nicht mehr.
    const rot = await send('PATCH', `/api/shares/${share.id}`, owner.cookie, { rotateKey: true });
    expect(rot.status).toBe(200);
    expect((await list(guest, share.id, share.shareKey)).status).toBe(404);
  });

  it('[F-110] Wechsel auf „Nur ich“ macht die Kommentare sofort für andere unsichtbar', async () => {
    const owner = await person({ supporter: true });
    const share = await newShare(owner, 'public');
    const p = await person();
    await comment(p, share.id, 'Öffentlich gesagt');
    expect((await send('PATCH', `/api/shares/${share.id}`, owner.cookie, { visibility: 'private' })).status).toBe(200);
    expect((await list(p, share.id)).status).toBe(404);
    expect((await post(p, share.id, 'noch einer')).status).toBe(404);
    expect((await listJson(owner, share.id)).comments).toHaveLength(1);
  });

  it('[F-110] unbekannter Törn → 404', async () => {
    expect((await list(undefined, 'Unbekannt1234567')).status).toBe(404);
  });
});

// ---------------------------------------------------------------- F-111 Moderation durch Eigentümer und Autoren

describe('F-111 Eigentümer und Autoren', () => {
  it('[F-111] Autor:in löscht eigene, Eigentümer jeden Kommentar auf dem Törn; Fremde 404', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const a = await person();
    const b = await person();
    const ca = await comment(a, share.id, 'Kommentar A');
    const cb = await comment(b, share.id, 'Kommentar B');
    expect((await send('DELETE', `/api/comments/${ca.id}`, b.cookie)).status).toBe(404);
    expect((await send('DELETE', `/api/comments/${ca.id}`, undefined)).status).toBe(401);
    expect((await send('DELETE', `/api/comments/${ca.id}`, a.cookie)).status).toBe(204);
    expect((await send('DELETE', `/api/comments/${cb.id}`, owner.cookie)).status).toBe(204);
    expect((await listJson(undefined, share.id)).comments).toHaveLength(0);
    expect((await send('DELETE', `/api/comments/${cb.id}`, owner.cookie)).status).toBe(404);
  });

  it('[F-111] commentsMode: off → kein Formular (403 comments_off), Bestehendes bleibt; hidden → nur der Eigentümer sieht sie; Unbekanntes → 400', async () => {
    const owner = await person();
    const share = await newShare(owner);
    expect(share.commentsMode).toBe('on');
    const p = await person();
    await comment(p, share.id, 'Vorher');

    const off = await send('PATCH', `/api/shares/${share.id}`, owner.cookie, { commentsMode: 'off' });
    expect(((await off.json()) as { share: { commentsMode: string } }).share.commentsMode).toBe('off');
    const res = await post(p, share.id, 'Nachher');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('comments_off');
    expect(await listJson(p, share.id)).toMatchObject({ mode: 'off', canComment: false, block: 'off' });
    expect((await listJson(p, share.id)).comments).toHaveLength(1);

    await send('PATCH', `/api/shares/${share.id}`, owner.cookie, { commentsMode: 'hidden' });
    expect((await listJson(p, share.id)).comments).toHaveLength(0);
    expect((await listJson(owner, share.id)).comments).toHaveLength(1);
    expect((await send('PATCH', `/api/shares/${share.id}`, owner.cookie, { commentsMode: 'weg' })).status).toBe(400);
    // nur der Eigentümer stellt um
    expect((await send('PATCH', `/api/shares/${share.id}`, p.cookie, { commentsMode: 'on' })).status).toBe(404);
  });
});

// ---------------------------------------------------------------- F-112 Grenzen

describe('F-112 Spam-Grenzen', () => {
  it('[F-112] Abstand ≥ 20 s zwischen zwei Kommentaren (429 comment_too_fast)', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const p = await person();
    expect((await post(p, share.id, 'eins')).status).toBe(201);
    const res = await post(p, share.id, 'zwei');
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('comment_too_fast');
    await age(p, 21_000);
    expect((await post(p, share.id, 'zwei')).status).toBe(201);
  });

  it('[F-112] Konten jünger als 24 h: höchstens 3 Kommentare', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const fresh = await person({ fresh: true });
    for (const t of ['a', 'b', 'c']) await comment(fresh, share.id, `neu ${t}`);
    const res = await post(fresh, share.id, 'neu d');
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('comment_new_account');
  });

  it('[F-112] 10 pro Stunde und 50 pro Tag – auch gelöschte Kommentare zählen', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const p = await person();
    const d = await db();
    const now = Date.now();
    // 10 Einträge in der letzten Stunde (Abstand ok)
    for (let i = 0; i < 10; i++) await d.prepare('INSERT INTO comment_log (user_id, body_hash, created_at) VALUES (?, ?, ?)').bind(p.user.id, `h${i}`, now - 60_000 - i * 1000).run();
    const hour = await post(p, share.id, 'elf');
    expect(hour.status).toBe(429);
    expect(((await hour.json()) as { error: string }).error).toBe('comment_quota');
    // auf den Tag verteilen: 50 in 24 h, keiner in der letzten Stunde
    await d.prepare('UPDATE comment_log SET created_at = created_at - ? WHERE user_id = ?').bind(2 * 3_600_000, p.user.id).run();
    for (let i = 10; i < 50; i++) await d.prepare('INSERT INTO comment_log (user_id, body_hash, created_at) VALUES (?, ?, ?)').bind(p.user.id, `h${i}`, now - 3 * 3_600_000).run();
    const day = await post(p, share.id, 'einundfünfzig');
    expect(day.status).toBe(429);
    expect(((await day.json()) as { message: string }).message).toContain('pro Tag');
  });

  it('[F-112] doppelter Text desselben Kontos innerhalb 24 h → 409, auch nach dem Löschen', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const other = await newShare(owner, 'public', 'Zweiter Törn');
    const p = await person();
    const c = await comment(p, share.id, 'Ahoi zusammen');
    expect((await send('DELETE', `/api/comments/${c.id}`, p.cookie)).status).toBe(204);
    const res = await post(p, other.id, 'AHOI   zusammen');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('duplicate_comment');
    // anderes Konto darf denselben Text schreiben
    expect((await post(await person(), share.id, 'Ahoi zusammen')).status).toBe(201);
  });

  it('[F-112] gesperrte Konten kommentieren nicht (403 suspended)', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const p = await person();
    await (await db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), p.user.id).run();
    const res = await post(p, share.id, 'Hallo');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('suspended');
    expect((await listJson(p, share.id)).block).toBe('suspended');
  });
});

// ---------------------------------------------------------------- F-113 Sammelmail

describe('F-113 Tägliche Sammelmail (opt-in)', () => {
  // nur Sammelmails (nicht den Anmeldelink)
  const mails = (to: string) => h.logs.filter((l) => l.includes(`[mail:log] an ${to}:`) && l.includes('Benachrichtigung'));

  it('[F-113] Einstellung: Standard aus, umschaltbar auf täglich, Unbekanntes → 400', async () => {
    const p = await person();
    const get = await send('GET', '/api/me/settings', p.cookie);
    expect(await get.json()).toEqual({
      notify: { comment: 'none', reaction: 'none', follow: 'none', invite: 'mail', request: 'none' },
      notifyComments: 'off', notifyGroups: 'off', suspended: false, hasProfile: true, isAdmin: false,
    });
    const on = await send('PATCH', '/api/me/settings', p.cookie, { notifyComments: 'daily' });
    expect(((await on.json()) as { notifyComments: string }).notifyComments).toBe('daily');
    expect((await send('PATCH', '/api/me/settings', p.cookie, { notifyComments: 'hourly' })).status).toBe(400);
    expect((await send('GET', '/api/me/settings', undefined)).status).toBe(401);
  });

  it('[F-113] Cron: eine Mail mit Anzahl und Törn, ohne Kommentartext; eigene Kommentare zählen nicht; nicht doppelt; ohne Opt-in keine Mail', async () => {
    const owner = await person();
    const quiet = await person();
    const share = await newShare(owner, 'public', 'Rund Rügen');
    const quietShare = await newShare(quiet, 'public', 'Stiller Törn');
    await send('PATCH', '/api/me/settings', owner.cookie, { notifyComments: 'daily' });
    // Opt-in zählt ab jetzt – Zeitpunkt zurückdatieren, damit der Lauf gleich greift
    await (await db()).prepare('UPDATE users SET comments_mailed_at = ? WHERE id = ?').bind(Date.now() - DAY, owner.user.id).run();
    const a = await person();
    const b = await person();
    await comment(a, share.id, 'Geheimer Text eins');
    await comment(b, share.id, 'Geheimer Text zwei');
    await comment(owner, share.id, 'Eigene Antwort');
    await comment(a, quietShare.id, 'An den Stillen');

    await h.scheduled();
    const got = mails(owner.email);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('2 neue Kommentare');
    expect(got[0]).toContain('Rund Rügen');
    expect(got[0]).toContain(`https://sail.example/s/${share.id}`);
    expect(got[0]).not.toContain('Geheimer Text');
    expect(mails(quiet.email)).toHaveLength(0);

    await comment(b, share.id, 'Noch einer');
    await h.scheduled();
    expect(mails(owner.email)).toHaveLength(1); // höchstens eine Sammelmail pro Tag
  });
});

// ---------------------------------------------------------------- Aufräumen

describe('F-110 Kommentare werden mit ihrem Törn und dem Konto gelöscht', () => {
  const count = async (sql: string, ...args: unknown[]) => (await (await db()).prepare(sql).bind(...args).first<{ n: number }>())!.n;

  it('[F-110] Törn löschen entfernt seine Kommentare und Meldungen dazu', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const p = await person();
    const c = await comment(p, share.id, 'weg damit');
    const r = await send('POST', '/api/reports', owner.cookie, { kind: 'comment', id: c.id, reason: 'spam', note: '' });
    expect(r.status).toBe(201);
    expect((await send('DELETE', `/api/shares/${share.id}`, owner.cookie)).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?', share.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM reports WHERE target_id = ?', c.id)).toBe(0);
  });

  it('[F-110] Konto löschen entfernt eigene Kommentare und alle Kommentare auf eigenen Törns', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const leaver = await person();
    const elsewhere = await newShare(await person());
    await comment(leaver, elsewhere.id, 'bin dann weg');
    await comment(await person(), share.id, 'auf dem Törn des Gehenden');
    const leaverShare = await newShare(leaver, 'public', 'Mein Törn');
    await comment(owner, leaverShare.id, 'Kommentar auf Törn des Gehenden');

    expect((await send('DELETE', '/api/account', leaver.cookie)).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?', leaver.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?', leaverShare.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comment_log WHERE user_id = ?', leaver.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?', share.id)).toBe(1);
  });

  it('[F-110] abgelaufene Törns (Cron) nehmen Kommentare mit; der Spam-Zähler hält nur 24 h', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const p = await person();
    await comment(p, share.id, 'läuft ab');
    const d = await db();
    await d.prepare('UPDATE shares SET created_at = ? WHERE id = ?').bind(Date.now() - 1200 * DAY, share.id).run();
    await d.prepare('UPDATE comment_log SET created_at = ? WHERE user_id = ?').bind(Date.now() - 2 * DAY, p.user.id).run();
    await h.scheduled();
    expect(await count('SELECT COUNT(*) AS n FROM shares WHERE id = ?', share.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?', share.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comment_log WHERE user_id = ?', p.user.id)).toBe(0);
  });
});

describe('Ohne ADMIN_USER_IDS', () => {
  it('[F-114] keine Admin-Oberfläche: /api/admin/reports ist 404, Meldungen werden trotzdem gespeichert', async () => {
    const p = await person();
    expect((await send('GET', '/api/admin/reports', p.cookie)).status).toBe(404);
    const owner = await person();
    const share = await newShare(owner);
    expect((await send('POST', '/api/reports', p.cookie, { kind: 'share', id: share.id, reason: 'spam' })).status).toBe(201);
    expect((await (await db()).prepare('SELECT COUNT(*) AS n FROM reports WHERE target_id = ?').bind(share.id).first<{ n: number }>())!.n).toBe(1);
  });
});
