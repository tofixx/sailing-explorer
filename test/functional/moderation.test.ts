// Funktionale Tests: Melden (DSA) und Moderation (F-114, Konzept 4.4) – Meldungen nur für Sichtbares, automatisches
// Ausblenden, Admin-Liste und Entscheidungen, Kontosperre, Aufräumen. Admins kommen aus ADMIN_USER_IDS.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, loginSupporter, startWorker, type Harness } from './worker-harness';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminUser00000001';
const ADMIN_MAIL = 'moderation@example.org';

let h: Harness;
let n = 0;
const email = (tag = 'm') => `${tag}${++n}-${Date.now()}@example.org`;
const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;

interface Person { cookie: string; user: { id: string; email: string }; email: string; handle?: string }
let admin: Person;

beforeAll(async () => {
  // Leerzeichen und ungültige Einträge in der Liste werden ignoriert.
  h = await startWorker({ ADMIN_USER_IDS: ` ${ADMIN_ID} , kaputt!, `, REPORT_CONTACT: 'meldung@example.org' });
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  const s = await login(h, ADMIN_MAIL);
  admin = { ...s, email: ADMIN_MAIL };
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
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

async function person(o: { profile?: 'public' | 'unlisted' | null; supporter?: boolean } = {}): Promise<Person> {
  const mail = email();
  const s = o.supporter || o.profile === 'unlisted' ? await loginSupporter(h, mail) : await login(h, mail);
  await (await db()).prepare('UPDATE users SET created_at = created_at - ? WHERE id = ?').bind(2 * DAY, s.user.id).run();
  if (o.profile === null) return { ...s, email: mail };
  const handle = uniq('mod');
  const res = await send('PUT', '/api/me/profile', s.cookie, { handle, displayName: `Name ${handle}`, bio: 'Bio', visibility: o.profile ?? 'public' });
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...s, email: mail, handle };
}

async function newShare(owner: Person, visibility = 'public', title = 'Gemeldeter Törn') {
  const res = await createShare(h, owner.cookie, { visibility, title });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string; shareKey: string | null } }).share;
}

async function newBoat(owner: Person, name = 'Möwe') {
  const res = await send('POST', '/api/boats', owner.cookie, { name, visibility: 'public' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { boat: { id: string } }).boat;
}

async function newComment(p: Person, shareId: string, body: string) {
  const res = await send('POST', `/api/shares/${shareId}/comments`, p.cookie, { body });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { comment: { id: string } }).comment;
}

const report = (p: Person | undefined, kind: string, id: string, reason = 'spam', note = '', key?: string | null) =>
  send('POST', '/api/reports', p?.cookie, { kind, id, reason, note }, key ? { 'X-Share-Key': key } : {});

interface AdminReport {
  id: string; kind: string; targetId: string; count: number; reporters: number; reasons: Record<string, number>;
  notes: Array<{ reason: string; note: string }>;
  target: { title: string; text: string; path: string; hiddenAt: number | null; owner: { id: string; displayName: string; suspended: boolean } } | null;
}
async function adminList(): Promise<AdminReport[]> {
  const res = await send('GET', '/api/admin/reports', admin.cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { reports: AdminReport[] }).reports;
}
const groupFor = async (targetId: string) => (await adminList()).find((r) => r.targetId === targetId);

// ---------------------------------------------------------------- Melden

describe('F-114 Melden', () => {
  it('[F-114] Törn, Kommentar, Profil und Boot lassen sich melden; zweite Meldung desselben Kontos zählt einmal', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const boat = await newBoat(owner);
    const author = await person();
    const c = await newComment(author, share.id, 'Kauft billige Segel!');
    const r = await person();
    expect((await report(r, 'share', share.id, 'abuse', 'Beleidigender Titel')).status).toBe(201);
    expect((await report(r, 'comment', c.id, 'spam')).status).toBe(201);
    expect((await report(r, 'profile', owner.handle!, 'other')).status).toBe(201);
    expect((await report(r, 'boat', boat.id, 'illegal')).status).toBe(201);
    const again = await report(r, 'share', share.id, 'spam');
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, already: true });
    // Profil-Meldungen speichern die Konto-ID, nicht den Profilnamen (stabil bei Umbenennung)
    const row = await (await db()).prepare(`SELECT target_id FROM reports WHERE target_kind = 'profile' AND reporter_id = ?`).bind(r.user.id).first<{ target_id: string }>();
    expect(row!.target_id).toBe(owner.user.id);
  });

  it('[F-114] nur angemeldet (401), gültige Art und Grund (400), eigene Inhalte nicht (400 own_object), Anmerkung ≤ 500 Zeichen', async () => {
    const owner = await person();
    const share = await newShare(owner);
    expect((await report(undefined, 'share', share.id)).status).toBe(401);
    const r = await person();
    expect(await errorOf(await report(r, 'track', share.id))).toBe('invalid_report');
    expect(await errorOf(await report(r, 'share', share.id, 'langweilig'))).toBe('invalid_reason');
    expect(await errorOf(await report(owner, 'share', share.id))).toBe('own_object');
    expect((await report(r, 'share', share.id, 'other', 'x'.repeat(800))).status).toBe(201);
    const note = await (await db()).prepare('SELECT note FROM reports WHERE reporter_id = ?').bind(r.user.id).first<{ note: string }>();
    expect(note!.note).toHaveLength(500);
  });

  it('[F-114] nur Sichtbares: privater Törn → 404, „Nur mit Link“ nur mit Schlüssel, privates Profil → 404', async () => {
    const owner = await person({ supporter: true });
    const priv = await newShare(owner, 'private');
    const unl = await newShare(owner, 'unlisted');
    const r = await person();
    expect((await report(r, 'share', priv.id)).status).toBe(404);
    expect((await report(r, 'share', unl.id)).status).toBe(404);
    expect((await report(r, 'share', unl.id, 'spam', '', unl.shareKey)).status).toBe(201);
    const hidden = await person({ profile: 'unlisted' });
    expect((await report(r, 'profile', hidden.handle!)).status).toBe(404);
    expect((await report(r, 'boat', 'Unbekannt1234567')).status).toBe(404);
    expect((await report(r, 'comment', 'Unbekannt1234567')).status).toBe(404);
  });

  it('[F-114] Kontaktadresse für Meldungen ohne Konto', async () => {
    const res = await h.fetch('/api/reports/info');
    expect(await res.json()).toMatchObject({ contact: 'meldung@example.org', reasons: ['spam', 'abuse', 'illegal', 'depicted', 'other'] });
  });
});

// ---------------------------------------------------------------- Automatisch ausblenden

describe('F-114 Automatisch ausblenden bis zur Prüfung', () => {
  it('[F-114] 3 verschiedene Konten blenden einen Törn aus: für andere 404 und aus Entdecken verschwunden, Eigentümer und Admins sehen ihn', async () => {
    const owner = await person();
    const share = await newShare(owner, 'public', 'Spam-Törn');
    const [a, b, c] = [await person(), await person(), await person()];
    await report(a, 'share', share.id);
    await report(b, 'share', share.id);
    expect((await h.fetch(`/api/shares/${share.id}`)).status).toBe(200); // 2 reichen nicht
    await report(c, 'share', share.id);

    expect((await h.fetch(`/api/shares/${share.id}`)).status).toBe(404);
    expect((await h.fetch(`/api/shares/${share.id}/data`)).status).toBe(404);
    expect((await h.fetch(`/api/shares/${share.id}/comments`)).status).toBe(404);
    const disc = (await (await h.fetch('/api/discover?limit=24')).json()) as { voyages: Array<{ id: string }> };
    expect(disc.voyages.some((v) => v.id === share.id)).toBe(false);
    const page = await (await h.fetch(`/s/${share.id}`)).text();
    expect(page).toContain('noindex');
    expect(page).not.toContain('Spam-Törn');
    const prof = (await (await h.fetch(`/api/profiles/${owner.handle}`)).json()) as { voyages: Array<{ id: string }> };
    expect(prof.voyages.some((v) => v.id === share.id)).toBe(false);

    const own = await send('GET', `/api/shares/${share.id}`, owner.cookie);
    expect(own.status).toBe(200);
    expect(((await own.json()) as { share: { hiddenAt: number | null } }).share.hiddenAt).toBeGreaterThan(0);
    expect((await send('GET', `/api/shares/${share.id}`, admin.cookie)).status).toBe(200);
  });

  it('[F-114] „Ich bin abgebildet“ blendet sofort aus – Kommentar sehen dann nur Autor:in (markiert) und Admins', async () => {
    const owner = await person();
    const share = await newShare(owner);
    const author = await person();
    const c = await newComment(author, share.id, 'Hier ist Max Mustermann zu sehen');
    expect((await report(await person(), 'comment', c.id, 'depicted', 'Das bin ich')).status).toBe(201);
    const list = async (p?: Person) =>
      ((await (await send('GET', `/api/shares/${share.id}/comments`, p?.cookie)).json()) as { comments: Array<{ id: string; hidden: boolean }> }).comments;
    expect(await list()).toHaveLength(0);
    expect(await list(owner)).toHaveLength(0);
    expect(await list(author)).toEqual([expect.objectContaining({ id: c.id, hidden: true })]);
    expect((await list(admin))[0]).toMatchObject({ id: c.id, hidden: true });
  });

  it('[F-114] ausgeblendete Profile und Boote: Seiten 404, nicht in Entdecken, Autor ohne Namen', async () => {
    const owner = await person();
    const boat = await newBoat(owner, 'Gemeldetes Boot');
    const share = await newShare(owner, 'public', 'Normaler Törn');
    expect((await report(await person(), 'boat', boat.id, 'depicted')).status).toBe(201);
    expect((await report(await person(), 'profile', owner.handle!, 'depicted')).status).toBe(201);
    expect((await h.fetch(`/api/boats/${boat.id}`)).status).toBe(404);
    expect((await h.fetch(`/api/profiles/${owner.handle}`)).status).toBe(404);
    expect((await send('GET', `/api/boats/${boat.id}`, owner.cookie)).status).toBe(200);
    expect((await send('GET', `/api/profiles/${owner.handle}`, owner.cookie)).status).toBe(200);
    expect(await (await h.fetch(`/u/${owner.handle}`)).text()).not.toContain(`Name ${owner.handle}`);
    const disc = (await (await h.fetch('/api/discover?limit=24')).json()) as {
      voyages: Array<{ id: string; sailor: unknown; boat: unknown }>; people: Array<{ handle: string }>; boats: Array<{ id: string }>;
    };
    expect(disc.boats.some((b) => b.id === boat.id)).toBe(false);
    expect(disc.people.some((p) => p.handle === owner.handle)).toBe(false);
    const v = disc.voyages.find((x) => x.id === share.id);
    expect(v).toMatchObject({ sailor: null });
  });
});

// ---------------------------------------------------------------- Admin

describe('F-114 Admin: sichten und entscheiden', () => {
  it('[F-114] nur Admins: andere bekommen 404; die Liste fasst je Ziel zusammen – ohne Meldende', async () => {
    const r1 = await person();
    expect((await send('GET', '/api/admin/reports', r1.cookie)).status).toBe(404);
    expect((await send('GET', '/api/admin/reports', undefined)).status).toBe(401);
    expect((await send('GET', '/api/me/settings', admin.cookie)).ok).toBe(true);
    expect(((await (await send('GET', '/api/me/settings', admin.cookie)).json()) as { isAdmin: boolean }).isAdmin).toBe(true);

    const owner = await person();
    const share = await newShare(owner, 'public', 'Listentörn');
    const r2 = await person();
    await report(r1, 'share', share.id, 'spam', 'Werbung im Titel');
    await report(r2, 'share', share.id, 'abuse');
    const g = await groupFor(share.id);
    expect(g).toMatchObject({ kind: 'share', count: 2, reporters: 2, reasons: { spam: 1, abuse: 1 } });
    expect(g!.notes).toEqual([expect.objectContaining({ reason: 'spam', note: 'Werbung im Titel' })]);
    expect(g!.target).toMatchObject({ title: 'Listentörn', path: `/s/${share.id}`, hiddenAt: null, owner: { id: owner.user.id, suspended: false } });
    const raw = JSON.stringify(g);
    expect(raw).not.toContain(r1.user.id);
    expect(raw).not.toContain(r1.email);
    expect(raw).not.toContain(owner.email);
  });

  it('[F-114] keep blendet wieder ein und anonymisiert die Meldungen; hide lässt ausgeblendet', async () => {
    const owner = await person();
    const kept = await newShare(owner, 'public', 'Zu Unrecht gemeldet');
    const hiddenShare = await newShare(owner, 'public', 'Zu Recht gemeldet');
    for (const s of [kept, hiddenShare]) await report(await person(), 'share', s.id, 'depicted', 'bitte prüfen');
    expect((await h.fetch(`/api/shares/${kept.id}`)).status).toBe(404);

    const gk = await groupFor(kept.id);
    expect((await send('POST', `/api/admin/reports/${gk!.id}`, admin.cookie, { action: 'keep' })).status).toBe(200);
    expect((await h.fetch(`/api/shares/${kept.id}`)).status).toBe(200);
    const row = await (await db()).prepare('SELECT reporter_id, note, resolution, resolved_at FROM reports WHERE target_id = ?').bind(kept.id).first<{ reporter_id: string | null; note: string; resolution: string; resolved_at: number }>();
    expect(row).toMatchObject({ reporter_id: null, note: '', resolution: 'kept' });
    expect(await groupFor(kept.id)).toBeUndefined();

    const gh = await groupFor(hiddenShare.id);
    expect((await send('POST', `/api/admin/reports/${gh!.id}`, admin.cookie, { action: 'hide' })).status).toBe(200);
    expect((await h.fetch(`/api/shares/${hiddenShare.id}`)).status).toBe(404);
    expect((await send('POST', `/api/admin/reports/${gh!.id}`, admin.cookie, { action: 'weg' })).status).toBe(400);
    expect((await send('POST', `/api/admin/reports/${gh!.id}`, owner.cookie, { action: 'keep' })).status).toBe(404);
  });

  it('[F-114] delete löscht das Ziel samt Dateien und Meldungen (Törn, Kommentar)', async () => {
    const owner = await person();
    const share = await newShare(owner, 'public', 'Löschfall');
    const author = await person();
    const c = await newComment(author, share.id, 'Rechtswidrig');
    await report(owner, 'comment', c.id, 'illegal');
    const gc = await groupFor(c.id);
    expect((await send('POST', `/api/admin/reports/${gc!.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect((await (await db()).prepare('SELECT COUNT(*) AS n FROM comments WHERE id = ?').bind(c.id).first<{ n: number }>())!.n).toBe(0);

    await report(author, 'share', share.id, 'illegal');
    const gs = await groupFor(share.id);
    expect((await send('POST', `/api/admin/reports/${gs!.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect((await send('GET', `/api/shares/${share.id}`, owner.cookie)).status).toBe(404);
    expect(await (await h.r2()).head(`shares/${share.id}`)).toBeNull();
    expect((await (await db()).prepare('SELECT COUNT(*) AS n FROM reports WHERE target_id IN (?, ?)').bind(share.id, c.id).first<{ n: number }>())!.n).toBe(0);
  });

  it('[F-114] Konto sperren: keine Uploads, Kommentare, Meldungen, Einladungen; Inhalte aus Entdecken; entsperren hebt es auf', async () => {
    const bad = await person({ supporter: true });
    const share = await newShare(bad, 'public', 'Vom Gesperrten');
    const target = await newShare(await person());
    const res = await send('POST', `/api/admin/users/${bad.user.id}/suspend`, admin.cookie, { suspended: true });
    expect(await res.json()).toEqual({ suspended: true });

    expect(await errorOf(await createShare(h, bad.cookie, { title: 'Neu' }))).toBe('suspended');
    expect(await errorOf(await send('POST', `/api/shares/${target.id}/comments`, bad.cookie, { body: 'Hallo' }))).toBe('suspended');
    expect(await errorOf(await report(bad, 'share', target.id))).toBe('suspended');
    expect(await errorOf(await send('POST', `/api/shares/${share.id}/invites`, bad.cookie, {}))).toBe('suspended');
    expect(await errorOf(await send('PUT', `/api/shares/${share.id}/image`, bad.cookie, undefined, { 'Content-Type': 'image/jpeg' }))).toBe('suspended');
    const disc = (await (await h.fetch('/api/discover?limit=24')).json()) as { voyages: Array<{ id: string }> };
    expect(disc.voyages.some((v) => v.id === share.id)).toBe(false);
    // Ansehen und Löschen eigener Inhalte bleibt möglich
    expect((await send('GET', `/api/shares/${share.id}`, bad.cookie)).status).toBe(200);
    expect(((await (await send('GET', '/api/me/settings', bad.cookie)).json()) as { suspended: boolean }).suspended).toBe(true);

    await send('POST', `/api/admin/users/${bad.user.id}/suspend`, admin.cookie, { suspended: false });
    expect((await createShare(h, bad.cookie, { title: 'Wieder da' })).status).toBe(201);
  });

  it('[F-114] Admins lassen sich nicht sperren; nur Admins sperren; unbekannte Konten 404', async () => {
    expect((await send('POST', `/api/admin/users/${ADMIN_ID}/suspend`, admin.cookie, { suspended: true })).status).toBe(400);
    const p = await person();
    expect((await send('POST', `/api/admin/users/${p.user.id}/suspend`, p.cookie, { suspended: true })).status).toBe(404);
    expect((await send('POST', '/api/admin/users/Unbekannt1234567/suspend', admin.cookie, { suspended: true })).status).toBe(404);
    expect((await send('POST', `/api/admin/users/${p.user.id}/suspend`, admin.cookie, { suspended: 'ja' })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- Aufräumen

describe('F-114 Meldungen aufräumen', () => {
  const count = async (sql: string, ...args: unknown[]) => (await (await db()).prepare(sql).bind(...args).first<{ n: number }>())!.n;

  it('[F-114] Konto löschen: Meldungen zu eigenen Inhalten fallen weg, eigene Meldungen bleiben ohne Meldenden und Anmerkung', async () => {
    const leaver = await person();
    const share = await newShare(leaver);
    const other = await newShare(await person());
    await report(await person(), 'share', share.id, 'spam');
    await report(await person(), 'profile', leaver.handle!, 'spam');
    await report(leaver, 'share', other.id, 'abuse', 'Mein Name steht hier');
    expect((await send('DELETE', '/api/account', leaver.cookie)).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM reports WHERE target_id IN (?, ?)', share.id, leaver.user.id)).toBe(0);
    const kept = await (await db()).prepare('SELECT reporter_id, note FROM reports WHERE target_id = ?').bind(other.id).first<{ reporter_id: string | null; note: string }>();
    expect(kept).toEqual({ reporter_id: null, note: '' });
  });

  it('[F-114] Cron: verwaiste Meldungen und alte entschiedene Meldungen werden gelöscht', async () => {
    const d = await db();
    const now = Date.now();
    await d.prepare(`INSERT INTO reports (id, target_kind, target_id, reason, created_at) VALUES ('Orphan0000000001', 'share', 'GibtEsNicht00001', 'spam', ?)`).bind(now).run();
    await d.prepare(`INSERT INTO reports (id, target_kind, target_id, reason, created_at, resolved_at, resolution) VALUES ('OldResolved00001', 'profile', ?, 'spam', ?, ?, 'kept')`).bind(admin.user.id, now - 400 * DAY, now - 200 * DAY).run();
    await h.scheduled();
    expect(await count(`SELECT COUNT(*) AS n FROM reports WHERE id IN ('Orphan0000000001', 'OldResolved00001')`)).toBe(0);
  });
});
