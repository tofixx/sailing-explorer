// Funktionale Tests: Admin-Bereich (Konzept 15, F-230 … F-242) – Zugang, Übersicht, Sperren und Sperrfristen,
// Umbenennen, Eigner, Häfen zusammenführen, Konten verbinden, Löschen, Protokoll. Admins kommen aus ADMIN_USER_IDS.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { LOCK_MS, lockDaysLeft, parseAdminFilter, parsePage } from '../../src/domain/admin';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminUser00000001';
const ADMIN_MAIL = 'admin-bereich@example.org';

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
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

interface Item { id: string; name: string; sub: string; lock: { until: number; viaUser: string | null } | null; hidden: boolean; suspended: boolean; owner: { id: string } | null }
const list = async (kind: string, qs = '') => json<{ items: Item[]; more: boolean }>(await A('GET', `/api/admin/list/${kind}?${qs}`));

async function share(p: Person, visibility = 'public', title = 'Admin-Törn') {
  const res = await createShare(h, p.cookie, { visibility, title });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string; shareKey: string | null } }).share;
}
async function boat(p: Person, o: Record<string, unknown> = {}) {
  return (await json<{ boat: { id: string } }>(await s.send('POST', '/api/boats', p.cookie, { name: 'Möwe', visibility: 'public', ...o }))).boat;
}
async function harbor(p: Person, name: string) {
  return (await json<{ harbor: { id: string; slug: string } }>(await s.send('POST', '/api/harbors', p.cookie, { name }))).harbor;
}
const lock = (kind: string, id: string, reason = 'Prüfung') => A('PUT', `/api/admin/${kind}/${id}/lock`, { reason });

describe('Admin-Bereich: reine Regeln', () => {
  it('[F-231] Filter je Art, Seiten, Restlaufzeit', () => {
    expect(parseAdminFilter('users', undefined)).toBe('all');
    expect(parseAdminFilter('users', 'suspended')).toBe('suspended');
    expect(parseAdminFilter('harbors', 'private')).toBeNull();
    expect(parseAdminFilter('users', 'ownerless')).toBeNull();
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('x')).toBe(1);
    expect(parsePage('99999')).toBe(1);
    expect(lockDaysLeft(Date.now() + LOCK_MS)).toBe(180);
    expect(lockDaysLeft(Date.now() - DAY)).toBe(0);
  });
});

describe('Admin-Bereich (Konzept 15)', () => {
  it('[F-230] nur Admins: me.admin, Admin-Routen und /admin sonst 404 (auch für Gäste)', async () => {
    const p = await s.person();
    expect(((await json<{ admin?: boolean }>(await s.send('GET', '/api/auth/me', admin.cookie))).admin)).toBe(true);
    expect(((await json<{ admin?: boolean }>(await s.send('GET', '/api/auth/me', p.cookie))).admin)).toBeUndefined();
    for (const path of ['/api/admin/list/users', '/api/admin/log', `/api/admin/users/${p.user.id}`, '/api/admin/reports']) {
      expect((await s.send('GET', path, p.cookie)).status, path).toBe(404);
      expect((await s.send('GET', path, undefined)).status, path).toBe(404);
    }
    expect((await s.send('PUT', `/api/admin/users/${p.user.id}/lock`, p.cookie, { reason: 'x' })).status).toBe(404);
    expect((await h.fetch('/admin', { cookie: p.cookie })).status).toBe(404);
    expect((await h.fetch('/admin')).status).toBe(404);
    expect((await h.fetch('/admin', { cookie: admin.cookie })).status).toBe(200);
  });

  it('[F-231] Übersicht zeigt auch Nicht-Öffentliches, sucht (auch E-Mail), filtert und blättert', async () => {
    const p = await s.person({ profile: 'public', supporter: true });
    const priv = await share(p, 'private', 'Geheimer Admin-Törn');
    const found = await list('shares', 'q=Geheimer%20Admin');
    expect(found.items.map((i) => i.id)).toContain(priv.id);
    expect((await list('shares', 'filter=private')).items.map((i) => i.id)).toContain(priv.id);
    const users = await list('users', `q=${encodeURIComponent(p.email)}`);
    expect(users.items).toHaveLength(1);
    expect(users.items[0].sub).toBe(p.email);
    expect((await A('GET', '/api/admin/list/foo')).status).toBe(400);
    expect((await A('GET', '/api/admin/list/harbors?filter=private')).status).toBe(400);
    expect((await A('GET', '/api/admin/list/users?page=1')).status).toBe(200);
  });

  it('[F-232] Details und Einblicke stehen im Protokoll', async () => {
    const p = await s.person({ profile: 'public' });
    const d = await json<{ item: Item; extra: { sessions: number } }>(await A('GET', `/api/admin/users/${p.user.id}`));
    expect(d.item.id).toBe(p.user.id);
    expect(d.extra.sessions).toBe(1);
    expect((await A('GET', '/api/admin/users/Unbekannt1234567')).status).toBe(404);
    expect(await one('SELECT 1 AS x FROM admin_log WHERE action = ? AND target_id = ? AND admin_id = ?', 'view', p.user.id, ADMIN_ID)).not.toBeNull();
    expect(await one(`SELECT 1 AS x FROM admin_log WHERE action = 'list' AND admin_id = ?`, ADMIN_ID)).not.toBeNull();
  });

  it('[F-233] gesperrter Törn: für alle außer Admins 404, auch für den Eigner; nicht änderbar; Entsperren stellt wieder her', async () => {
    const owner = await s.person({ profile: 'public' });
    const sh = await share(owner);
    expect((await lock('shares', sh.id, '')).status).toBe(400);
    expect((await json<{ action: string }>(await lock('shares', sh.id))).action).toBe('lock');
    expect((await s.send('GET', `/api/shares/${sh.id}`, owner.cookie)).status).toBe(404);
    expect((await s.send('GET', `/api/shares/${sh.id}`, undefined)).status).toBe(404);
    expect((await s.send('GET', `/api/shares/${sh.id}`, admin.cookie)).status).toBe(200);
    expect((await s.send('PATCH', `/api/shares/${sh.id}`, owner.cookie, { title: 'neu' })).status).toBe(404);
    expect((await s.send('DELETE', `/api/shares/${sh.id}`, owner.cookie)).status).toBe(404);
    const mine = await json<{ shares: Array<{ id: string }> }>(await s.send('GET', '/api/shares', owner.cookie));
    expect(mine.shares.map((x) => x.id)).not.toContain(sh.id);
    // nochmal sperren = verlängern
    expect((await json<{ action: string }>(await lock('shares', sh.id, 'Behörde'))).action).toBe('extend');
    expect((await A('DELETE', `/api/admin/shares/${sh.id}/lock`)).status).toBe(200);
    expect((await s.send('GET', `/api/shares/${sh.id}`, undefined)).status).toBe(200);
    expect(await one<{ hidden_at: number | null }>('SELECT hidden_at FROM shares WHERE id = ?', sh.id)).toEqual({ hidden_at: null });
    expect((await A('DELETE', `/api/admin/shares/${sh.id}/lock`)).status).toBe(404);
  });

  it('[F-233] Boot, Gruppe und Hafen: auch Verwalter und Mitglieder sehen Gesperrtes nicht; Meldungs-Entscheidung → 409', async () => {
    const owner = await s.person({ profile: 'public' });
    const b = await boat(owner);
    expect((await lock('boats', b.id)).status).toBe(200);
    expect((await s.send('GET', `/api/boats/${b.id}`, owner.cookie)).status).toBe(404);
    expect((await s.send('PATCH', `/api/boats/${b.id}`, owner.cookie, { name: 'x' })).status).toBe(404);
    expect((await s.send('DELETE', `/api/boats/${b.id}`, owner.cookie)).status).toBe(404);
    expect((await json<{ boats: unknown[] }>(await s.send('GET', '/api/boats', owner.cookie))).boats).toHaveLength(0);
    expect((await s.send('GET', `/api/boats/${b.id}`, admin.cookie)).status).toBe(200);

    const g = await s.group(owner);
    const { link } = await json<{ link: string }>(await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, {}));
    const inv = { token: /#token=([A-Za-z0-9_-]+)$/.exec(link)![1] };
    expect((await lock('groups', g.id)).status).toBe(200);
    // Einladungen in gesperrte Gruppen sind ungültig
    const guest = await s.person({ profile: 'public' });
    expect((await s.send('POST', '/api/invites/accept', guest.cookie, { token: inv.token })).status).toBe(400);
    expect((await s.send('GET', `/api/groups/slug/${g.slug}`, owner.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/groups/${g.id}`, owner.cookie)).status).toBe(404);
    expect((await s.send('GET', `/api/groups/slug/${g.slug}`, admin.cookie)).status).toBe(200);

    const hb = await harbor(owner, s.uniq('Sperrhafen'));
    expect((await lock('harbors', hb.id)).status).toBe(200);
    expect((await s.send('GET', `/api/harbors/slug/${hb.slug}`, undefined)).status).toBe(404);

    // Meldung zu einem gesperrten Ziel: Entscheidung über den Admin-Bereich
    const reporter = await s.person({ profile: 'public' });
    const sh = await share(owner);
    expect((await s.send('POST', '/api/reports', reporter.cookie, { kind: 'share', id: sh.id, reason: 'spam' })).status).toBe(201);
    await lock('shares', sh.id);
    const rep = await one<{ id: string }>(`SELECT id FROM reports WHERE target_id = ?`, sh.id);
    expect((await A('POST', `/api/admin/reports/${rep!.id}`, { action: 'keep' })).status).toBe(409);
  });

  it('[F-234] Konto sperren: Sitzungen enden, keine Anmeldung, Profil, Törns, Boote und Kommentare weg; Entsperren nur das Mitgesperrte', async () => {
    const p = await s.person({ profile: 'public' });
    const other = await s.person({ profile: 'public' });
    const sh = await share(p);
    const own = await share(p, 'public', 'Einzeln gesperrt');
    const b = await boat(p);
    const g = await s.group(p);
    const target = await share(other);
    expect((await s.send('POST', `/api/shares/${target.id}/comments`, p.cookie, { body: 'Schöner Törn!' })).status).toBe(201);
    await lock('shares', own.id, 'einzeln');
    expect((await lock('users', p.user.id, 'Spam-Konto')).status).toBe(200);

    expect((await json<{ user: unknown }>(await s.send('GET', '/api/auth/me', p.cookie))).user).toBeNull();
    const req = await json<{ devLink: string }>(await s.send('POST', '/api/auth/request', undefined, { email: p.email }));
    const token = /#token=([A-Za-z0-9_-]+)/.exec(req.devLink)![1];
    const ver = await s.send('POST', '/api/auth/verify', undefined, { token });
    expect(ver.status).toBe(403);
    expect(await s.errorOf(ver)).toBe('account_locked');

    expect((await s.send('GET', `/api/profiles/${p.handle}`, undefined)).status).toBe(404);
    expect((await s.send('GET', `/api/shares/${sh.id}`, undefined)).status).toBe(404);
    expect((await s.send('GET', `/api/boats/${b.id}`, undefined)).status).toBe(404);
    expect((await s.send('GET', `/api/groups/slug/${g.slug}`, undefined)).status).toBe(200);
    const comments = await json<{ comments: unknown[] }>(await s.send('GET', `/api/shares/${target.id}/comments`, other.cookie));
    expect(comments.comments).toHaveLength(0);
    expect((await A('POST', `/api/admin/users/${p.user.id}/suspend`, { suspended: false })).status).toBe(409);
    expect((await lock('users', ADMIN_ID)).status).toBe(400);
    // mitgesperrt: nur über das Konto entsperrbar
    expect((await A('DELETE', `/api/admin/shares/${sh.id}/lock`)).status).toBe(409);

    expect((await A('DELETE', `/api/admin/users/${p.user.id}/lock`)).status).toBe(200);
    expect((await s.send('GET', `/api/shares/${sh.id}`, undefined)).status).toBe(200);
    expect((await s.send('GET', `/api/boats/${b.id}`, undefined)).status).toBe(200);
    expect((await s.send('GET', `/api/profiles/${p.handle}`, undefined)).status).toBe(200);
    expect((await s.send('GET', `/api/shares/${own.id}`, undefined)).status).toBe(404);
    expect(await one<{ suspended_at: number | null }>('SELECT suspended_at FROM users WHERE id = ?', p.user.id)).toEqual({ suspended_at: null });
    expect((await login(h, p.email)).user.id).toBe(p.user.id);
  });

  it('[F-235] Gesperrtes ist von Fristen ausgenommen, Konto löschen → 409; nach Ablauf löscht die Nacht endgültig', async () => {
    const p = await s.person({ profile: 'public' });
    const sh = await share(p);
    const old = Date.now() - 3 * 365 * DAY;
    await (await s.db()).prepare('UPDATE shares SET created_at = ? WHERE id = ?').bind(old, sh.id).run();
    await lock('shares', sh.id);
    expect(await s.errorOf(await s.send('DELETE', '/api/account', p.cookie))).toBe('locked_content');
    await h.scheduled();
    expect(await one('SELECT id FROM shares WHERE id = ?', sh.id)).not.toBeNull();

    // Sperrfrist abgelaufen → endgültig gelöscht (auch die Datei), System-Eintrag
    await (await s.db()).prepare(`UPDATE locks SET until = ? WHERE target_kind = 'share' AND target_id = ?`).bind(Date.now() - 1000, sh.id).run();
    await h.scheduled();
    expect(await one('SELECT id FROM shares WHERE id = ?', sh.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM locks WHERE target_id = ?', sh.id)).toBeNull();
    expect((await (await h.r2()).list({ prefix: `shares/${sh.id}` })).objects).toHaveLength(0);
    expect(await one(`SELECT 1 AS x FROM admin_log WHERE action = 'lock_expired' AND target_id = ? AND admin_id IS NULL`, sh.id)).not.toBeNull();
    // ohne Sperre geht das Konto zu löschen
    expect((await s.send('DELETE', '/api/account', p.cookie)).status).toBe(200);

    // Sperren ohne Ziel fallen nachts weg
    await (await s.db()).prepare(`INSERT INTO locks (target_kind, target_id, locked_at, until, locked_by) VALUES ('boat', 'Verwaist12345678', 1, ?, ?)`).bind(Date.now() + DAY, ADMIN_ID).run();
    await h.scheduled();
    expect(await one(`SELECT 1 AS x FROM locks WHERE target_id = 'Verwaist12345678'`)).toBeNull();
  });

  it('[F-236] umbenennen: Profil, Boot, Gruppe, Hafen – mit Konflikten und Sperre', async () => {
    const p = await s.person({ profile: 'public' });
    const q = await s.person({ profile: 'public' });
    const handle = s.uniq('neu');
    expect((await A('PATCH', `/api/admin/users/${p.user.id}`, { displayName: 'Neuer Name', handle })).status).toBe(200);
    expect((await s.send('GET', `/api/profiles/${handle}`, undefined)).status).toBe(200);
    expect(await s.errorOf(await A('PATCH', `/api/admin/users/${q.user.id}`, { handle }))).toBe('handle_taken');
    const noProfile = await s.person();
    expect(await s.errorOf(await A('PATCH', `/api/admin/users/${noProfile.user.id}`, { displayName: 'x' }))).toBe('no_profile');

    const hb = await harbor(p, s.uniq('Alter Hafen'));
    const b = await boat(p, { harborId: hb.id });
    expect((await A('PATCH', `/api/admin/boats/${b.id}`, { name: 'Albatros' })).status).toBe(200);
    const newName = s.uniq('Neuer Hafen');
    expect((await A('PATCH', `/api/admin/harbors/${hb.id}`, { name: newName })).status).toBe(200);
    expect(await one<{ name: string; home_port: string }>('SELECT name, home_port FROM boats WHERE id = ?', b.id)).toEqual({ name: 'Albatros', home_port: newName });
    const other = await harbor(p, s.uniq('Anderer Hafen'));
    expect(await s.errorOf(await A('PATCH', `/api/admin/harbors/${other.id}`, { name: newName }))).toBe('harbor_exists');

    const g1 = await s.group(p);
    const g2 = await s.group(q);
    expect(await s.errorOf(await A('PATCH', `/api/admin/groups/${g2.id}`, { slug: g1.slug }))).toBe('slug_taken');
    expect((await A('PATCH', `/api/admin/groups/${g2.id}`, { name: 'Umbenannt' })).status).toBe(200);
    await lock('groups', g2.id);
    expect(await s.errorOf(await A('PATCH', `/api/admin/groups/${g2.id}`, { name: 'Nochmal' }))).toBe('locked');
    const sh = await share(p);
    expect(await s.errorOf(await A('PATCH', `/api/admin/shares/${sh.id}`, { name: 'x' }))).toBe('not_supported');
  });

  it('[F-237] Eigner neu zuweisen: Boot, Gruppe, Hafen – Törns nicht', async () => {
    const old = await s.person({ profile: 'public' });
    const neu = await s.person({ profile: 'public' });
    const b = await boat(old);
    expect((await A('POST', `/api/admin/boats/${b.id}/owner`, { userId: neu.user.id })).status).toBe(200);
    expect(await one<{ owner_id: string }>('SELECT owner_id FROM boats WHERE id = ?', b.id)).toEqual({ owner_id: neu.user.id });
    expect(await one('SELECT 1 AS x FROM boat_admins WHERE boat_id = ? AND user_id = ?', b.id, old.user.id)).not.toBeNull();
    expect((await s.send('PATCH', `/api/boats/${b.id}`, neu.cookie, { name: 'Meins' })).status).toBe(200);

    const g = await s.group(old);
    expect((await A('POST', `/api/admin/groups/${g.id}/owner`, { userId: neu.user.id })).status).toBe(200);
    const roles = await (await s.db()).prepare('SELECT user_id, role FROM group_members WHERE group_id = ? ORDER BY role').bind(g.id).all<{ user_id: string; role: string }>();
    expect(roles.results).toEqual(expect.arrayContaining([{ user_id: neu.user.id, role: 'owner' }, { user_id: old.user.id, role: 'admin' }]));

    const hb = await harbor(old, s.uniq('Eignerhafen'));
    expect((await A('POST', `/api/admin/harbors/${hb.id}/owner`, { userId: neu.user.id })).status).toBe(200);
    expect(await one<{ created_by: string }>('SELECT created_by FROM harbors WHERE id = ?', hb.id)).toEqual({ created_by: neu.user.id });

    const sh = await share(old);
    expect(await s.errorOf(await A('POST', `/api/admin/shares/${sh.id}/owner`, { userId: neu.user.id }))).toBe('not_supported');
    expect(await s.errorOf(await A('POST', `/api/admin/boats/${b.id}/owner`, { userId: 'Unbekannt1234567' }))).toBe('invalid_user');
    expect(await s.errorOf(await A('POST', `/api/admin/boats/${b.id}/owner`, { userId: neu.user.id }))).toBe('same_owner');
  });

  it('[F-238] Filter „ohne Eigner“: Häfen ohne Anleger:in, Gruppen ohne Eigner-Mitgliedschaft', async () => {
    const p = await s.person({ profile: 'public' });
    const hb = await harbor(p, s.uniq('Waisenhafen'));
    await (await s.db()).prepare('UPDATE harbors SET created_by = NULL WHERE id = ?').bind(hb.id).run();
    expect((await list('harbors', 'filter=ownerless')).items.map((i) => i.id)).toContain(hb.id);
    const g = await s.group(p);
    expect((await list('groups', 'filter=ownerless')).items.map((i) => i.id)).not.toContain(g.id);
    await (await s.db()).prepare('DELETE FROM group_members WHERE group_id = ?').bind(g.id).run();
    expect((await list('groups', 'filter=ownerless')).items.map((i) => i.id)).toContain(g.id);
  });

  it('[F-239] Häfen zusammenführen: Boote, Gruppen, Heimathafen, Folgen umhängen, Weiterleitung, Dublette weg', async () => {
    const p = await s.person({ profile: 'public' });
    const fan = await s.person({ profile: 'public' });
    const dup = await harbor(p, s.uniq('Hafen Potsdam'));
    const main = await harbor(p, s.uniq('Potsdam'));
    const b = await boat(p, { harborId: dup.id });
    const g = await s.group(p, { harborId: dup.id });
    expect((await s.send('PUT', '/api/me/home', fan.cookie, { harborId: dup.id })).status).toBe(200);
    expect((await s.send('PUT', `/api/follows/harbor/${dup.id}`, fan.cookie)).status).toBeLessThan(300);
    expect((await s.send('PUT', `/api/follows/harbor/${main.id}`, fan.cookie)).status).toBeLessThan(300);

    expect((await A('POST', `/api/admin/harbors/${dup.id}/merge`, { into: dup.id })).status).toBe(400);
    expect((await A('POST', `/api/admin/harbors/${dup.id}/merge`, { into: main.id })).status).toBe(200);
    expect(await one('SELECT id FROM harbors WHERE id = ?', dup.id)).toBeNull();
    expect(await one<{ harbor_id: string }>('SELECT harbor_id FROM boats WHERE id = ?', b.id)).toEqual({ harbor_id: main.id });
    expect(await one<{ harbor_id: string }>('SELECT harbor_id FROM groups WHERE id = ?', g.id)).toEqual({ harbor_id: main.id });
    expect(await one<{ home_harbor_id: string }>('SELECT home_harbor_id FROM users WHERE id = ?', fan.user.id)).toEqual({ home_harbor_id: main.id });
    expect(await one<{ n: number }>(`SELECT COUNT(*) AS n FROM follows WHERE user_id = ? AND target_kind = 'harbor'`, fan.user.id)).toEqual({ n: 1 });

    const page = await h.fetch(`/h/${dup.slug}`, { redirect: 'manual' });
    expect(page.status).toBe(301);
    expect(page.headers.get('Location')).toMatch(new RegExp(`/h/${main.slug}$`));
    const api = await json<{ harbor: { id: string } }>(await s.send('GET', `/api/harbors/slug/${dup.slug}`, undefined));
    expect(api.harbor.id).toBe(main.id);
    expect(await one(`SELECT 1 AS x FROM admin_log WHERE action = 'merge_harbor' AND target_id = ?`, main.id)).not.toBeNull();
  });

  it('[F-240] Konten verbinden: Vorschau, Bestätigung, alles wandert, Konflikte nach Regel, Quellkonto weg', async () => {
    const into = await s.person({ profile: 'public' });
    const from = await s.person({ profile: 'public' });
    const third = await s.person({ profile: 'public' });
    const sh = await share(from);
    const b = await boat(from);
    const g = await s.group(from);
    // beide in derselben Gruppe: die höhere Rolle gewinnt (Eigner)
    await (await s.db()).prepare(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`).bind(g.id, into.user.id, Date.now()).run();
    expect((await s.send('PUT', `/api/follows/user/${into.handle}`, from.cookie)).status).toBeLessThan(300);
    expect((await s.send('PUT', `/api/follows/user/${from.handle}`, third.cookie)).status).toBeLessThan(300);
    await (await s.db()).prepare(`INSERT INTO passkeys (id, user_id, public_key, created_at) VALUES ('pk-merge-1', ?, 'x', ?)`).bind(from.user.id, Date.now()).run();

    const prev = await json<{ counts: Record<string, number>; profile: string }>(await A('GET', `/api/admin/users/${from.user.id}/merge?into=${into.user.id}`));
    expect(prev.counts.shares).toBe(1);
    expect(prev.counts.bothGroups).toBe(1);
    expect(prev.profile).toBe('keep');
    expect(await s.errorOf(await A('POST', `/api/admin/users/${from.user.id}/merge`, { into: into.user.id, confirm: 'falsch' }))).toBe('confirm_required');
    expect((await A('POST', `/api/admin/users/${from.user.id}/merge`, { into: into.user.id, confirm: from.user.id })).status).toBe(200);

    expect(await one('SELECT id FROM users WHERE id = ?', from.user.id)).toBeNull();
    expect(await one<{ user_id: string }>('SELECT user_id FROM shares WHERE id = ?', sh.id)).toEqual({ user_id: into.user.id });
    expect(await one<{ owner_id: string }>('SELECT owner_id FROM boats WHERE id = ?', b.id)).toEqual({ owner_id: into.user.id });
    expect(await one<{ owner_id: string }>('SELECT owner_id FROM groups WHERE id = ?', g.id)).toEqual({ owner_id: into.user.id });
    expect(await one<{ role: string }>('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', g.id, into.user.id)).toEqual({ role: 'owner' });
    expect(await one<{ user_id: string }>(`SELECT user_id FROM passkeys WHERE id = 'pk-merge-1'`)).toEqual({ user_id: into.user.id });
    // Folgen auf sich selbst entfallen, Folgende der Quelle folgen dem Ziel
    expect(await one(`SELECT 1 AS x FROM follows WHERE user_id = ?1 AND target_kind = 'user' AND target_id = ?1`, into.user.id)).toBeNull();
    expect(await one(`SELECT 1 AS x FROM follows WHERE user_id = ? AND target_kind = 'user' AND target_id = ?`, third.user.id, into.user.id)).not.toBeNull();
    expect((await s.send('GET', `/api/profiles/${from.handle}`, undefined)).status).toBe(404);
    expect((await s.send('GET', '/api/auth/me', from.cookie)).status).toBe(200);
    expect((await json<{ user: unknown }>(await s.send('GET', '/api/auth/me', from.cookie))).user).toBeNull();
    // Admins lassen sich nicht auflösen, gleiche Konten nicht verbinden
    expect(await s.errorOf(await A('GET', `/api/admin/users/${ADMIN_ID}/merge?into=${into.user.id}`))).toBe('cannot_merge_admin');
    expect(await s.errorOf(await A('GET', `/api/admin/users/${into.user.id}/merge?into=${into.user.id}`))).toBe('same_user');
  });

  it('[F-241] endgültig löschen nur mit Bestätigung, über den Löschpfad (auch die Datei)', async () => {
    const p = await s.person({ profile: 'public' });
    const sh = await share(p);
    await lock('shares', sh.id);
    expect(await s.errorOf(await A('DELETE', `/api/admin/shares/${sh.id}`, { confirm: 'nein' }))).toBe('confirm_required');
    expect((await A('DELETE', `/api/admin/shares/${sh.id}`, { confirm: sh.id })).status).toBe(204);
    expect(await one('SELECT id FROM shares WHERE id = ?', sh.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM locks WHERE target_id = ?', sh.id)).toBeNull();
    expect((await (await h.r2()).list({ prefix: `shares/${sh.id}` })).objects).toHaveLength(0);
    expect(await s.errorOf(await A('DELETE', `/api/admin/users/${ADMIN_ID}`, { confirm: ADMIN_ID }))).toBe('cannot_delete_admin');
    const q = await s.person({ profile: 'public' });
    expect((await A('DELETE', `/api/admin/users/${q.user.id}`, { confirm: q.user.id })).status).toBe(204);
    expect(await one('SELECT id FROM users WHERE id = ?', q.user.id)).toBeNull();
  });

  it('[F-243] Unterstützer-Gutschein: wirkt wie eine Zahlung, entziehen lässt bezahlte Unterstützung stehen', async () => {
    const p = await s.person({ profile: 'public' });
    type Support = { supporter: boolean; supporterUntil: number | null };
    expect((await json<Support>(await s.send('GET', '/api/me/support', p.cookie))).supporter).toBe(false);
    expect(await s.errorOf(await A('POST', `/api/admin/users/${p.user.id}/support`, { seasons: 4 }))).toBe('invalid_seasons');
    expect((await s.send('POST', `/api/admin/users/${p.user.id}/support`, p.cookie, { seasons: 1 })).status).toBe(404);
    const one1 = await json<{ supporterUntil: number }>(await A('POST', `/api/admin/users/${p.user.id}/support`, { seasons: 1, note: 'Vereinsvorstand' }));
    expect(one1.supporterUntil).toBeGreaterThan(Date.now());
    expect((await json<Support>(await s.send('GET', '/api/me/support', p.cookie))).supporter).toBe(true);
    // zweiter Gutschein wird angehängt (eine Saison später)
    const two = await json<{ supporterUntil: number }>(await A('POST', `/api/admin/users/${p.user.id}/support`, { seasons: 1 }));
    expect(new Date(two.supporterUntil).getUTCFullYear()).toBe(new Date(one1.supporterUntil).getUTCFullYear() + 1);
    expect(await one(`SELECT 1 AS x FROM admin_log WHERE action = 'grant_support' AND target_id = ? AND detail LIKE '%Vereinsvorstand%'`, p.user.id)).not.toBeNull();
    // bezahlte Unterstützung bleibt beim Entziehen
    await (await s.db()).prepare(`INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until) VALUES ('paid-1', ?, 'stripe', 'cs_test_paid1', 500, 'eur', ?, ?)`).bind(p.user.id, Date.now(), Date.now() + 30 * DAY).run();
    expect((await A('DELETE', `/api/admin/users/${p.user.id}/support`)).status).toBe(200);
    expect(await one<{ n: number }>(`SELECT COUNT(*) AS n FROM supports WHERE user_id = ?`, p.user.id)).toEqual({ n: 1 });
    expect((await A('DELETE', `/api/admin/users/${p.user.id}/support`)).status).toBe(404);
    // Frist: abgelaufene Gutscheine nach 2 Jahren weg
    await (await s.db()).prepare(`INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until) VALUES ('alt-gutschein', ?, 'admin', 'admin:alt', 0, '', ?, ?)`).bind(p.user.id, Date.now() - 900 * DAY, Date.now() - 800 * DAY).run();
    await h.scheduled();
    expect(await one(`SELECT 1 AS x FROM supports WHERE id = 'alt-gutschein'`)).toBeNull();
  });

  it('[F-242] Protokoll: Aktionen lesbar, ohne Mail-Adressen; Fristen 180 Tage für Einblicke, 2 Jahre für Aktionen', async () => {
    const p = await s.person({ profile: 'public' });
    await A('PUT', `/api/admin/users/${p.user.id}/lock`, { reason: 'Test' });
    const log = await json<{ entries: Array<{ action: string; detail: string; adminId: string }> }>(await A('GET', `/api/admin/log?q=${p.user.id}`));
    expect(log.entries.map((e) => e.action)).toContain('lock');
    expect(JSON.stringify(log.entries)).not.toContain(p.email);
    expect(await one(`SELECT 1 AS x FROM admin_log WHERE detail LIKE '%@%'`)).toBeNull();

    const db = await s.db();
    const now = Date.now();
    await db.prepare(`INSERT INTO admin_log (id, admin_id, action, created_at) VALUES ('alt-view', ?, 'view', ?)`).bind(ADMIN_ID, now - 200 * DAY).run();
    await db.prepare(`INSERT INTO admin_log (id, admin_id, action, created_at) VALUES ('alt-rename', ?, 'rename', ?)`).bind(ADMIN_ID, now - 200 * DAY).run();
    await db.prepare(`INSERT INTO admin_log (id, admin_id, action, created_at) VALUES ('uralt-rename', ?, 'rename', ?)`).bind(ADMIN_ID, now - 800 * DAY).run();
    await db.prepare(`INSERT INTO admin_log (id, admin_id, action, target_kind, target_id, created_at) VALUES ('uralt-gesperrt', ?, 'lock', 'user', ?, ?)`).bind(ADMIN_ID, p.user.id, now - 800 * DAY).run();
    await h.scheduled();
    const ids = (await db.prepare(`SELECT id FROM admin_log WHERE id IN ('alt-view', 'alt-rename', 'uralt-rename', 'uralt-gesperrt')`).all<{ id: string }>()).results.map((r) => r.id).sort();
    expect(ids).toEqual(['alt-rename', 'uralt-gesperrt']);
  });
});
