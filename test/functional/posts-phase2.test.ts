// Funktionale Tests: Beiträge als Grundtyp, Phase 2 (Konzept 21.12) – Plus-Knopf und „Wo steht es?“ (F-405), `/p/<id>`
// (F-406), Ausbreitung nach oben mit „Sichtbar bis“ (F-409), Schreiben im Hafen und am Boot (F-425), Törn als Anhang
// (F-426), „Sichtbar bis“ für Törns (F-427), Konto-Menü und Reiter „Fahrtenbuch“ (F-428), Löschkonzept (F-404).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminPhase2AAAAAA1';
let h: Harness;
let s: ReturnType<typeof social>;
let admin: { cookie: string };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'phase2-admin@example.org', Date.now() - 10 * DAY).run();
  admin = await login(h, 'phase2-admin@example.org');
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const all = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await (await s.db()).prepare(sql).bind(...args).all<T>()).results;
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};
const stream = async (path: string, cookie?: string) => ok<StreamOut>(await s.send('GET', path, cookie));
const postIds = (st: StreamOut) => st.items.filter((i) => i.kind === 'post').map((i) => i.post!.id);

/** Beitrag über den Plus-Knopf in einen Verlauf. */
async function write(p: Person, channel: { kind: string; id?: string }, body: Record<string, unknown>, status = 201) {
  const res = await s.send('POST', '/api/posts', p.cookie, { channel: { id: '', ...channel }, ...body });
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 201 ? ((await res.json()) as { post: { id: string; path: string; home: string | null; reach: string } }).post : null;
}

let harborN = 0;
async function harbor(p: Person) {
  const res = await s.send('POST', '/api/harbors', p.cookie, { name: s.uniq(`Phase2hafen${++harborN}`), lat: -50 - harborN / 10, lon: -150 });
  return ((await res.json()) as { harbor: { id: string; slug: string } }).harbor;
}
const clubHarbor = async (clubId: string) => (await one<{ harbor_id: string }>('SELECT harbor_id FROM groups WHERE id = ?', clubId))!.harbor_id;
const targets = async (postId: string) =>
  (await all<{ k: string; t: string }>(`SELECT target_kind AS k, target_id AS t FROM activity_target WHERE activity_id IN (SELECT id FROM activity WHERE subject_kind = 'post' AND subject_id = ?) ORDER BY k, t`, postId)).map((r) => `${r.k}:${r.t}`);

describe('F-405 Plus-Knopf: wohin darf ich schreiben?', () => {
  it('[F-405] Profil, Gruppen mit Schreibrecht, Häfen meiner Boote, eigene Boote – mit Stufen und Kette; Seite vorausgewählt', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const me = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: 'PYC' });
    const team = await s.group(owner, { kind: 'team', name: 'Mittwochsregatta', parentId: club.id });
    await s.join(owner, club, me);
    await s.join(owner, team, me);
    const h1 = await harbor(owner);
    const boat = await s.boat(me, { harborId: h1.id });
    const c = await ok<{ targets: Array<{ ref: { kind: string; slug?: string }; id: string; choices: string[]; reaches: Array<{ reach: string; chain: string }> }>; preselect: string | null }>(
      await s.send('GET', `/api/me/compose?ctx=group:${team.id}`, me.cookie),
    );
    const kinds = c.targets.map((t) => `${t.ref.kind}:${t.id}`);
    expect(kinds).toContain('user:');
    // Verein: Mitglieder schreiben standardmäßig nicht (B3) – Team schon
    expect(kinds).toContain(`group:${team.id}`);
    expect(kinds).not.toContain(`group:${club.id}`);
    expect(kinds).toContain(`harbor:${h1.id}`);
    expect(kinds).toContain(`boat:${boat.id}`);
    expect(c.preselect).toBe(`group:${team.slug}`);
    const t = c.targets.find((x) => x.id === team.id)!;
    expect(t.choices).toEqual(['public', 'members']);
    expect(t.reaches.map((r) => r.reach)).toEqual(['here', 'club', 'harbor', 'all']);
    expect(t.reaches[3].chain).toMatch(/^Mittwochsregatta → PYC → Hafen .+ → überall$/);
    expect((await s.send('GET', '/api/me/compose', undefined)).status).toBe(401);
  });

  it('[F-405] ohne Schreibrecht 403, unbekannter Verlauf 400; Stufe „Sichtbar bis“, die es nicht gibt, 400', async () => {
    const owner = await s.person({ profile: 'public' });
    const me = await s.person({ profile: 'public' });
    const club = await s.group(owner);
    await s.join(owner, club, me);
    await write(me, { kind: 'group', id: club.id }, { body: 'x' }, 403);
    await write(me, { kind: 'mond', id: club.id }, { body: 'x' }, 400);
    expect(await s.errorOf(await s.send('POST', '/api/posts', me.cookie, { channel: { kind: 'user', id: '' }, body: 'x', reach: 'club' }))).toBe('invalid_reach');
  });
});

describe('F-425 Hafen- und Boots-Verlauf', () => {
  it('[F-425] Hafen: wer dort ein Boot hat, schreibt (B6), andere 403; Beitrag im Hafen-Stream; „Nur Mitglieder“ gibt es dort nicht', async () => {
    const skipper = await s.person({ profile: 'public' });
    const stranger = await s.person({ profile: 'public' });
    const h1 = await harbor(stranger);
    await s.boat(skipper, { harborId: h1.id });
    const p = await write(skipper, { kind: 'harbor', id: h1.id }, { body: 'Kran am Freitag defekt', reach: 'here' });
    expect(p!.home).toBe(`/h/${h1.slug}`);
    // die Anleger:in des Hafens darf auch
    await write(stranger, { kind: 'harbor', id: h1.id }, { body: 'Willkommen' });
    const third = await s.person();
    await write(third, { kind: 'harbor', id: h1.id }, { body: 'x' }, 403);
    expect(await s.errorOf(await s.send('POST', '/api/posts', skipper.cookie, { channel: { kind: 'harbor', id: h1.id }, body: 'x', visibility: 'members' }))).toBe('invalid_visibility');
    const st = await stream(`/api/harbors/${h1.id}/stream`, skipper.cookie);
    const item = st.items.find((i) => i.post?.id === p!.id) as unknown as { post: { where: { kind: string; slug: string } } };
    expect(item.post.where).toMatchObject({ kind: 'harbor', slug: h1.slug });
  });

  it('[F-425] Boot: Eigner schreibt, Bootsseite zeigt es; privates Boot: Stream nur für Verwalter, F-415 – nie aus dem Cache für andere', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const other = await s.person({ profile: 'public' });
    const boat = await s.boat(owner);
    const p = await write(owner, { kind: 'boat', id: boat.id }, { body: 'Neue Segel!' });
    expect(postIds(await stream(`/api/boats/${boat.id}/stream`))).toContain(p!.id);
    await write(other, { kind: 'boat', id: boat.id }, { body: 'x' }, 403);
    const priv = await s.boat(owner, { visibility: 'private' });
    const q = await write(owner, { kind: 'boat', id: priv.id }, { body: 'Nur für uns' });
    expect((await s.send('GET', `/api/boats/${priv.id}/stream`, other.cookie)).status).toBe(404);
    const mine = await s.send('GET', `/api/boats/${priv.id}/stream`, owner.cookie);
    expect(mine.headers.get('Cache-Control')).toBe('private, no-store');
    expect(postIds((await mine.json()) as StreamOut)).toContain(q!.id);
    // privates Boot: kein Weg nach oben (Kette geschlossen), nichts in der Community
    expect(await targets(q!.id)).toEqual([`boat:${priv.id}`]);
  });
});

describe('F-409 Ausbreitung nach oben', () => {
  it('[F-409] Team → Verein → Hafen → Community je nach „Sichtbar bis“; ändern gleicht Ziele an, nichts springt nach oben', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: 'Ausbreitungsclub' });
    const team = await s.group(owner, { kind: 'team', name: 'Ausbreitungsteam', parentId: club.id });
    await s.join(owner, club, member);
    const hid = await clubHarbor(club.id);
    const here = await write(owner, { kind: 'group', id: team.id }, { body: 'nur hier', reach: 'here' });
    const toClub = await write(owner, { kind: 'group', id: team.id }, { body: 'bis Verein', reach: 'club' });
    const everywhere = await write(owner, { kind: 'group', id: team.id }, { body: 'überall', reach: 'all' });
    expect(await targets(here!.id)).toEqual([`group:${team.id}`]);
    expect(await targets(toClub!.id)).toEqual([`group:${club.id}`, `group:${team.id}`].sort());
    expect(await targets(everywhere!.id)).toEqual([`group:${club.id}`, `group:${team.id}`, `harbor:${hid}`].sort());
    // Vereins-Stream (Mitglied, ungecacht): ausgebreitete Beiträge bis „Verein“
    const clubIds = postIds(await stream(`/api/groups/${club.id}/stream`, member.cookie));
    expect(clubIds).toContain(toClub!.id);
    expect(clubIds).toContain(everywhere!.id);
    expect(clubIds).not.toContain(here!.id);
    const harborIds = postIds(await stream(`/api/harbors/${hid}/stream`, member.cookie));
    expect(harborIds).toContain(everywhere!.id);
    expect(harborIds).not.toContain(toClub!.id);
    // herabsetzen: Ziele fallen, Zeit bleibt
    const before = await one<{ created_at: number }>(`SELECT created_at FROM activity WHERE subject_kind = 'post' AND subject_id = ?`, everywhere!.id);
    await ok(await s.send('PATCH', `/api/posts/${everywhere!.id}`, owner.cookie, { reach: 'here' }));
    expect(await targets(everywhere!.id)).toEqual([`group:${team.id}`]);
    expect(postIds(await stream(`/api/groups/${club.id}/stream`, member.cookie))).not.toContain(everywhere!.id);
    await ok(await s.send('PATCH', `/api/posts/${everywhere!.id}`, owner.cookie, { reach: 'all' }));
    const after = await all<{ created_at: number }>(`SELECT t.created_at FROM activity_target t JOIN activity a ON a.id = t.activity_id WHERE a.subject_kind = 'post' AND a.subject_id = ?`, everywhere!.id);
    expect(after.every((r) => r.created_at === before!.created_at)).toBe(true);
    // fremde Beiträge ändert niemand
    expect((await s.send('PATCH', `/api/posts/${toClub!.id}`, member.cookie, { reach: 'here' })).status).toBe(404);
  });

  it('[F-409] „Alles“ zeigt Beiträge nur mit „überall“; Profil-Beiträge breiten sich über den Heimathafen aus', async () => {
    const p = await s.person({ profile: 'public' });
    const h1 = await harbor(p);
    await ok(await s.send('PUT', '/api/me/home', p.cookie, { harborId: h1.id }));
    const local = await write(p, { kind: 'user' }, { body: 'Nur Umgebung', reach: 'harbor' });
    const wide = await write(p, { kind: 'user' }, { body: 'Für alle', reach: 'all' });
    expect(await targets(local!.id)).toEqual([`harbor:${h1.id}`, `user:${p.user.id}`]);
    // einziger Abruf von „Alles“ in dieser Datei – kein Treffer aus dem 60-s-Cache
    const pub = postIds(await stream('/api/stream/public'));
    expect(pub).toContain(wide!.id);
    expect(pub).not.toContain(local!.id);
  });

  it('[F-409] [F-415] „Nur Mitglieder“ und „Nur mit Link“ breiten sich nie aus; „Nur mit Link“ steht in keinem Verlauf', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    const mem = await write(owner, { kind: 'group', id: team.id }, { body: 'intern', visibility: 'members', reach: 'all' });
    expect(mem!.reach).toBe('here');
    expect(await targets(mem!.id)).toEqual([`group:${team.id}`]);
    const link = await write(owner, { kind: 'group', id: team.id }, { body: 'mit Link', visibility: 'unlisted' });
    expect(await targets(link!.id)).toEqual([]);
    expect(link!.path).toMatch(new RegExp(`^/p/${link!.id}/[A-Za-z0-9]{22}$`));
  });
});

describe('F-406 /p/<id>', () => {
  it('[F-406] Ziel: Heimatverlauf mit Karte; „Nur mit Link“ nur mit Schlüssel als einzelne Karte; alles andere dieselbe 404, nie gecacht', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const team = await s.group(owner, { kind: 'team' });
    const pub = await write(owner, { kind: 'group', id: team.id }, { body: 'Absegeln\nam Samstag' });
    const r = await s.send('GET', `/api/posts/${pub!.id}`, undefined);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await ok<{ link: { home: string; inStream: boolean } }>(r)).link).toMatchObject({ home: `/g/${team.slug}`, inStream: true });
    const link = await write(owner, { kind: 'user' }, { body: 'Geheimtipp', visibility: 'unlisted' });
    const key = link!.path.split('/')[3];
    const without = await s.send('GET', `/api/posts/${link!.id}`, undefined);
    const wrong = await s.send('GET', `/api/posts/${link!.id}`, undefined, undefined, { 'X-Share-Key': 'a'.repeat(22) });
    const unknown = await s.send('GET', '/api/posts/Unbekannt0000001', undefined);
    const bodies = await Promise.all([without, wrong, unknown].map(async (x) => [x.status, await x.text()]));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toEqual(bodies[2]);
    expect(bodies[0][0]).toBe(404);
    const withKey = await ok<{ item: { post: { path: string } }; link: { inStream: boolean } }>(await s.send('GET', `/api/posts/${link!.id}`, undefined, undefined, { 'X-Share-Key': key }));
    expect(withKey.link.inStream).toBe(false);
    expect(withKey.item.post.path).toBe(link!.path);
  });

  it('[F-406] Link-Vorschau mit erster Zeile nur bei effektiv öffentlich; Benachrichtigungen verlinken /p/<id>', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const fan = await s.person({ profile: 'public' });
    const team = await s.group(owner, { kind: 'team' });
    const pub = await write(owner, { kind: 'group', id: team.id }, { body: '  Absegeln am Samstag  \nTreffpunkt 10 Uhr' });
    const html = await (await h.fetch(`/p/${pub!.id}`)).text();
    expect(html).toMatch(/<meta property="og:description" content="Absegeln am Samstag"/);
    const link = await write(owner, { kind: 'user' }, { body: 'Nicht in der Vorschau', visibility: 'unlisted' });
    const html2 = await (await h.fetch(link!.path)).text();
    expect(html2).not.toContain('Nicht in der Vorschau');
    await s.join(owner, team, fan);
    expect((await s.send('PUT', `/api/reactions/post/${pub!.id}`, fan.cookie, { kind: 'like' })).status).toBe(200);
    const bell = await ok<{ items: Array<{ kind: string; href: string }> }>(await s.send('GET', '/api/notifications', owner.cookie));
    expect(bell.items.find((n) => n.kind === 'reaction')!.href).toBe(`/p/${pub!.id}`);
  });
});

describe('F-426 Törn als Anhang', () => {
  it('[F-426] nur eigene Törns; für Leser ohne Zugriff fällt der Anhang weg', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const reader = await s.person({ profile: 'public' });
    const other = await s.person({ profile: 'public' });
    const team = await s.group(owner, { kind: 'team' });
    await s.join(owner, team, reader);
    const pubShare = await s.share(owner, { title: 'Rügen' });
    const privShare = await s.share(owner, { title: 'Geheim', visibility: 'private' });
    const foreign = await s.share(other);
    expect(await s.errorOf(await s.send('POST', '/api/posts', owner.cookie, { channel: { kind: 'group', id: team.id }, body: 'x', shareId: foreign.id }))).toBe('invalid_share');
    const a = await write(owner, { kind: 'group', id: team.id }, { body: 'mit Rügen', shareId: pubShare.id });
    const b = await write(owner, { kind: 'group', id: team.id }, { body: 'mit Geheim', shareId: privShare.id });
    const st = (await stream(`/api/groups/${team.id}/stream`, reader.cookie)).items as unknown as Array<{ post?: { id: string; voyage: { id: string; title: string } | null } }>;
    expect(st.find((i) => i.post?.id === a!.id)!.post!.voyage).toMatchObject({ id: pubShare.id, title: 'Rügen' });
    expect(st.find((i) => i.post?.id === b!.id)!.post!.voyage).toBeNull();
    const own = (await stream(`/api/groups/${team.id}/stream`, owner.cookie)).items as unknown as Array<{ post?: { id: string; voyage: { id: string } | null } }>;
    expect(own.find((i) => i.post?.id === b!.id)!.post!.voyage).toMatchObject({ id: privShare.id });
  });
});

describe('F-427 „Sichtbar bis“ für Törns', () => {
  const shareTargets = async (shareId: string) =>
    (await all<{ k: string; t: string }>(`SELECT DISTINCT target_kind AS k, target_id AS t FROM activity_target WHERE activity_id IN (SELECT id FROM activity WHERE subject_kind = 'share' AND subject_id = ?) ORDER BY k, t`, shareId)).map((r) => `${r.k}:${r.t}`);

  it('[F-427] „nur hier“: Profil und gewählte Gruppen – kein Boot, kein Hafen, keine Hafenseite; ändern ergibt dieselben Ziele wie neu anlegen', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    const h1 = await harbor(owner);
    const boat = await s.boat(owner, { harborId: h1.id });
    const create = async (reach: string) => {
      const r = await createShare(h, owner.cookie, { visibility: 'public', title: `R-${reach}`, headers: { 'X-Share-Groups': JSON.stringify([team.id]), 'X-Share-Boat': boat.id, 'X-Share-Reach': reach } });
      expect(r.status, await r.clone().text()).toBe(201);
      return ((await r.json()) as { share: { id: string; reach: string } }).share;
    };
    const expected: Record<string, string[]> = {
      here: [`group:${team.id}`, `user:${owner.user.id}`],
      club: [`group:${club.id}`, `group:${team.id}`, `user:${owner.user.id}`],
      harbor: [`boat:${boat.id}`, `group:${club.id}`, `group:${team.id}`, `harbor:${h1.id}`, `user:${owner.user.id}`],
    };
    expected.all = expected.harbor;
    // Matrix: direkt anlegen vs. mit „überall“ anlegen und danach umstellen (auch über einen Umweg)
    const moved = await create('all');
    for (const reach of ['here', 'club', 'harbor', 'all']) {
      const direct = await create(reach);
      expect(direct.reach).toBe(reach);
      expect(await shareTargets(direct.id), `direkt ${reach}`).toEqual([...expected[reach]].sort());
      await ok(await s.send('PATCH', `/api/shares/${moved.id}`, owner.cookie, { reach: reach === 'here' ? 'all' : 'here' }));
      await ok(await s.send('PATCH', `/api/shares/${moved.id}`, owner.cookie, { reach }));
      expect(await shareTargets(moved.id), `geändert ${reach}`).toEqual([...expected[reach]].sort());
    }
    // Hafenseite listet nur Törns ab „bis Hafen“
    const page = await ok<{ voyages: Array<{ id: string; title: string }> }>(await s.send('GET', `/api/harbors/slug/${h1.slug}`, undefined));
    const titles = page.voyages.map((v) => v.title);
    expect(titles).toContain('R-harbor');
    expect(titles).not.toContain('R-here');
    expect(titles).not.toContain('R-club');
    expect(await s.errorOf(await s.send('PATCH', `/api/shares/${moved.id}`, owner.cookie, { reach: 'mond' }))).toBe('invalid_reach');
  });
});

describe('F-428 Konto-Menü und Reiter „Fahrtenbuch“', () => {
  it('[F-428] /api/auth/me nennt Profilname und Anzeigename (ohne Profil null); „Fahrtenbuch“ = Törns im Fahrtenbuch', async () => {
    const p = await s.person({ profile: 'private', supporter: true });
    const me = await ok<{ user: { handle: string | null; displayName: string | null } }>(await s.send('GET', '/api/auth/me', p.cookie));
    expect(me.user).toMatchObject({ handle: p.handle, displayName: `Name ${p.handle}` });
    const bare = await s.person();
    expect((await ok<{ user: { handle: string | null } }>(await s.send('GET', '/api/auth/me', bare.cookie))).user.handle).toBeNull();
    // eigene Seite auch mit privatem Profil
    expect((await s.send('GET', `/api/profiles/${p.handle}`, p.cookie)).status).toBe(200);
    const inLog = await s.share(p, { title: 'zählt' });
    const out = await s.share(p, { title: 'zählt nicht' });
    await ok(await s.send('PATCH', `/api/shares/${out.id}`, p.cookie, { logState: 'excluded' }));
    const text = await write(p, { kind: 'user' }, { body: 'Text' });
    const list = await ok<{ items: Array<{ id: string }> }>(await s.send('GET', '/api/me/posts?area=logbook', p.cookie));
    const ids = list.items.map((i) => i.id);
    expect(ids).toContain(inLog.id);
    expect(ids).not.toContain(out.id);
    expect(ids).not.toContain(text!.id);
  });
});

describe('F-404 Löschkonzept der neuen Verläufe', () => {
  const gone = async (postId: string) => ({
    post: await one('SELECT 1 AS x FROM posts WHERE id = ?', postId),
    activity: await one(`SELECT 1 AS x FROM activity WHERE subject_kind = 'post' AND subject_id = ?`, postId),
    reactions: await one(`SELECT 1 AS x FROM reactions WHERE subject_kind = 'post' AND subject_id = ?`, postId),
    reports: await one(`SELECT 1 AS x FROM reports WHERE target_kind = 'post' AND target_id = ?`, postId),
    notifications: await one(`SELECT 1 AS x FROM notifications WHERE subject_kind = 'post' AND subject_id = ?`, postId),
  });
  const none = { post: null, activity: null, reactions: null, reports: null, notifications: null };
  /** Beitrag mit Reaktion (samt Glocke) und Meldung. */
  async function busyPost(author: Person, channel: { kind: string; id?: string }) {
    const p = await write(author, channel, { body: 'Hallo' });
    const fan = await s.person({ profile: 'public' });
    expect((await s.send('PUT', `/api/reactions/post/${p!.id}`, fan.cookie, { kind: 'like' })).status).toBe(200);
    expect((await s.send('POST', '/api/reports', fan.cookie, { kind: 'post', id: p!.id, reason: 'spam', note: '' })).status).toBe(201);
    expect((await gone(p!.id)).reactions).not.toBeNull();
    return p!;
  }

  it('[F-404] Hafen von der Moderation gelöscht: Beiträge im Hafen samt Reaktionen, Glocke, Meldungen, Aktivität und Tageszähler weg', async () => {
    const p = await s.person({ profile: 'public' });
    const h1 = await harbor(p);
    const post = await busyPost(p, { kind: 'harbor', id: h1.id });
    expect((await s.send('DELETE', `/api/admin/harbors/${h1.id}`, admin.cookie, { confirm: h1.id })).status).toBe(204);
    expect(await gone(post.id)).toEqual(none);
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `harbor:${h1.id}`)).toBeNull();
  });

  it('[F-404] Häfen zusammengeführt: Beiträge, Ziele und Tageszähler wandern zum Ziel', async () => {
    const p = await s.person({ profile: 'public' });
    const src = await harbor(p);
    const dst = await harbor(p);
    const post = await write(p, { kind: 'harbor', id: src.id }, { body: 'wandert' });
    await ok(await s.send('POST', `/api/admin/harbors/${src.id}/merge`, admin.cookie, { into: dst.id }));
    expect(await one('SELECT channel_id FROM posts WHERE id = ?', post!.id)).toEqual({ channel_id: dst.id });
    expect(await targets(post!.id)).toEqual([`harbor:${dst.id}`]);
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `harbor:${src.id}`)).toBeNull();
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `harbor:${dst.id}`)).not.toBeNull();
  });

  it('[F-404] Boot gelöscht – direkt und über die Kontolöschung der Eigner:in: Beiträge am Boot weg', async () => {
    const p = await s.person({ profile: 'public' });
    const boat = await s.boat(p);
    const post = await busyPost(p, { kind: 'boat', id: boat.id });
    expect((await s.send('DELETE', `/api/boats/${boat.id}`, p.cookie)).status).toBe(204);
    expect(await gone(post.id)).toEqual(none);
    const q = await s.person({ profile: 'public' });
    const boat2 = await s.boat(q);
    const post2 = await write(q, { kind: 'boat', id: boat2.id }, { body: 'bald weg' });
    expect((await s.send('DELETE', '/api/account', q.cookie)).status).toBe(200);
    expect(await gone(post2!.id)).toEqual(none);
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `boat:${boat2.id}`)).toBeNull();
  });

  it('[F-404] Autor:in gelöscht bzw. inaktiv entfernt: Beitrag im Hafen samt Reaktionen, Glocke, Meldungen und Aktivität weg', async () => {
    const p = await s.person({ profile: 'public' });
    const h1 = await harbor(await s.person());
    await s.boat(p, { harborId: h1.id });
    const post = await busyPost(p, { kind: 'harbor', id: h1.id });
    expect((await s.send('DELETE', '/api/account', p.cookie)).status).toBe(200);
    expect(await gone(post.id)).toEqual(none);
  });

  it('[F-404] übergeordneter Verlauf gelöscht: nur dessen Ziele fallen, der Beitrag im Team bleibt', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    const post = await write(owner, { kind: 'group', id: team.id }, { body: 'bleibt', reach: 'club' });
    expect(await targets(post!.id)).toContain(`group:${club.id}`);
    expect((await s.send('DELETE', `/api/groups/${club.id}`, owner.cookie, { confirm: club.slug })).status).toBeLessThan(300);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', post!.id)).not.toBeNull();
    expect(await targets(post!.id)).toEqual([`group:${team.id}`]);
  });
});
