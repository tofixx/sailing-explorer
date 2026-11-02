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

  it('[F-425] Tageszähler im Hafen je Konto: wer fünfmal schreibt und löscht, sperrt nur sich selbst', async () => {
    const a = await s.person({ profile: 'public' });
    const b = await s.person({ profile: 'public' });
    const h1 = await harbor(a);
    for (const p of [a, b]) await s.boat(p, { harborId: h1.id });
    for (let i = 0; i < 5; i++) {
      const p = await write(a, { kind: 'harbor', id: h1.id }, { body: `Nr. ${i}` });
      expect((await s.send('DELETE', `/api/posts/${p!.id}`, a.cookie)).status).toBe(204);
    }
    expect(await s.errorOf(await s.send('POST', '/api/posts', a.cookie, { channel: { kind: 'harbor', id: h1.id }, body: 'zu viel' }))).toBe('post_quota');
    await write(b, { kind: 'harbor', id: h1.id }, { body: 'geht noch' });
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

describe('F-427 Fahrtenbuch-Bündel und Austritt nutzen dieselbe Ziel-Funktion', () => {
  const bundleTargets = async (userId: string) =>
    (await all<{ k: string; t: string }>(`SELECT DISTINCT target_kind AS k, target_id AS t FROM activity_target WHERE activity_id IN (SELECT id FROM activity WHERE kind = 'logbook' AND actor_id = ?) ORDER BY k, t`, userId)).map((r) => `${r.k}:${r.t}`);

  it('[F-427] [F-308] Nachtrag: Bündel-Ziele wie beim Törn je „Sichtbar bis“; Ändern und Austritt bauen sie gleich neu', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    const h1 = await harbor(owner);
    const boat = await s.boat(owner, { harborId: h1.id });
    const res = await s.send('POST', '/api/shares/manual', owner.cookie, {
      startedAt: Date.now() - 30 * DAY, fromHarbor: { harborId: h1.id }, toHarbor: { harborId: h1.id }, distNm: 8, boatId: boat.id, groupIds: [team.id], reach: 'here',
    });
    const entry = (await ok<{ share: { id: string } }>(res, 201)).share;
    expect(await bundleTargets(owner.user.id)).toEqual([`group:${team.id}`, `user:${owner.user.id}`]);
    await ok(await s.send('PATCH', `/api/shares/${entry.id}`, owner.cookie, { reach: 'harbor' }));
    expect(await bundleTargets(owner.user.id)).toEqual([`boat:${boat.id}`, `group:${club.id}`, `group:${team.id}`, `harbor:${h1.id}`, `user:${owner.user.id}`].sort());
    await ok(await s.send('PATCH', `/api/shares/${entry.id}`, owner.cookie, { reach: 'club' }));
    expect(await bundleTargets(owner.user.id)).toEqual([`group:${club.id}`, `group:${team.id}`, `user:${owner.user.id}`].sort());
    // Austritt aus dem Team (Eigner überträgt nicht – ein Mitglied tritt aus): eigener Fall mit Mitglied
    const member = await s.person({ profile: 'public' });
    await s.join(owner, team, member);
    const m = await ok<{ share: { id: string } }>(await s.send('POST', '/api/shares/manual', member.cookie, {
      startedAt: Date.now() - 30 * DAY, fromHarbor: { harborId: h1.id }, toHarbor: { harborId: h1.id }, distNm: 3, groupIds: [team.id], reach: 'club',
    }), 201);
    expect(await bundleTargets(member.user.id)).toEqual([`group:${club.id}`, `group:${team.id}`, `user:${member.user.id}`].sort());
    expect((await s.send('DELETE', `/api/groups/${team.id}/members/${member.user.id}`, member.cookie)).status).toBe(204);
    expect(await bundleTargets(member.user.id)).toEqual([`user:${member.user.id}`]);
    void m;
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
    expect(await one(`SELECT 1 AS x FROM post_log WHERE group_id LIKE ?`, `harbor:${h1.id}:%`)).toBeNull();
  });

  it('[F-404] Häfen zusammengeführt: Beiträge, Ziele und Tageszähler wandern zum Ziel', async () => {
    const p = await s.person({ profile: 'public' });
    const src = await harbor(p);
    const dst = await harbor(p);
    const post = await write(p, { kind: 'harbor', id: src.id }, { body: 'wandert' });
    await ok(await s.send('POST', `/api/admin/harbors/${src.id}/merge`, admin.cookie, { into: dst.id }));
    expect(await one('SELECT channel_id FROM posts WHERE id = ?', post!.id)).toEqual({ channel_id: dst.id });
    expect(await targets(post!.id)).toEqual([`harbor:${dst.id}`]);
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `harbor:${src.id}:${p.user.id}`)).toBeNull();
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `harbor:${dst.id}:${p.user.id}`)).not.toBeNull();
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
    expect(await one(`SELECT 1 AS x FROM post_log WHERE group_id LIKE ?`, `boat:${boat2.id}:%`)).toBeNull();
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

describe('F-427 /entdecken beachtet „Sichtbar bis“', () => {
  it('[F-427] nur Törns mit „überall“ erscheinen auf /entdecken', async () => {
    const owner = await s.person({ profile: 'public' });
    const make = async (reach: string, title: string) => {
      const r = await createShare(h, owner.cookie, { visibility: 'public', title, headers: { 'X-Share-Reach': reach } });
      expect(r.status, await r.clone().text()).toBe(201);
      return ((await r.json()) as { share: { id: string } }).share;
    };
    const wide = await make('all', s.uniq('Weit'));
    const near = await make('harbor', s.uniq('Nah'));
    const d = await ok<{ voyages: Array<{ id: string }> }>(await s.send('GET', '/api/discover?limit=24', undefined));
    const ids = d.voyages.map((v) => v.id);
    expect(ids).toContain(wide.id);
    expect(ids).not.toContain(near.id);
  });

  it('[F-405] Hafenseite: „Beitrag schreiben“ nur, wer dort schreiben darf (canPost)', async () => {
    const skipper = await s.person({ profile: 'public' });
    const other = await s.person({ profile: 'public' });
    const h1 = await harbor(other);
    await s.boat(skipper, { harborId: h1.id });
    const third = await s.person({ profile: 'public' });
    const page = async (p?: Person) => (await ok<{ canPost: boolean }>(await s.send('GET', `/api/harbors/slug/${h1.slug}`, p?.cookie))).canPost;
    expect(await page(skipper)).toBe(true);
    expect(await page(other)).toBe(true);
    expect(await page(third)).toBe(false);
    expect(await page()).toBe(false);
  });
});

describe('F-416 Benachrichtigung bei neuen Beiträgen', () => {
  const bell = async (p: Person) => (await ok<{ items: Array<{ kind: string; href: string; text: string }> }>(await s.send('GET', '/api/notifications', p.cookie))).items.filter((n) => n.kind === 'post');
  const optIn = async (p: Person, channel = 'none') => expect((await s.send('PATCH', '/api/me/settings', p.cookie, { notify: { post: channel } })).status).toBe(200);

  it('[F-416] Standard aus; eingeschaltet: Mitglieder der Heimatgruppe, nicht stumm, nie die Autor:in, Link /p/<id>; Ausbreitung benachrichtigt nie', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const silent = await s.person({ profile: 'public' });
    const muted = await s.person({ profile: 'public' });
    const clubOnly = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: 'Glockenclub' });
    const team = await s.group(owner, { kind: 'team', name: 'Glockenteam', parentId: club.id });
    for (const p of [member, silent, muted]) await s.join(owner, team, p);
    await s.join(owner, club, clubOnly);
    for (const p of [member, muted, clubOnly, owner]) await optIn(p);
    expect((await s.send('PUT', `/api/groups/${team.id}/mute`, muted.cookie, { muted: true })).status).toBeLessThan(300);
    const post = await write(owner, { kind: 'group', id: team.id }, { body: 'Training', reach: 'all' });
    expect(await bell(member)).toEqual([expect.objectContaining({ href: `/p/${post!.id}` })]);
    expect((await bell(member))[0].text).toContain('Glockenteam');
    expect(await bell(silent)).toEqual([]);
    expect(await bell(muted)).toEqual([]);
    expect(await bell(owner)).toEqual([]);
    // im Verein nur ausgebreitet – keine Glocke
    expect(await bell(clubOnly)).toEqual([]);
    // „Nur mit Link“ benachrichtigt nicht; „Aus“ nur für neue Beiträge wählbar
    await write(owner, { kind: 'group', id: team.id }, { body: 'Link', visibility: 'unlisted' });
    expect(await bell(member)).toHaveLength(1);
    expect((await s.send('PATCH', '/api/me/settings', member.cookie, { notify: { comment: 'off' } })).status).toBe(400);
  });

  it('[F-416] Hafen: Konten mit Boot oder Heimathafen dort; Boot: Eigner und Boots-Admins', async () => {
    const skipper = await s.person({ profile: 'public' });
    const local = await s.person({ profile: 'public' });
    const h1 = await harbor(skipper);
    const boat = await s.boat(skipper, { harborId: h1.id });
    await ok(await s.send('PUT', '/api/me/home', local.cookie, { harborId: h1.id }));
    for (const p of [skipper, local]) await optIn(p);
    const hp = await write(local, { kind: 'harbor', id: h1.id }, { body: 'Kran' }, 403);
    void hp;
    const other = await s.person({ profile: 'public' });
    await s.boat(other, { harborId: h1.id });
    const p1 = await write(other, { kind: 'harbor', id: h1.id }, { body: 'Kran defekt' });
    expect((await bell(skipper)).map((n) => n.href)).toEqual([`/p/${p1!.id}`]);
    expect((await bell(local)).map((n) => n.href)).toEqual([`/p/${p1!.id}`]);
    await write(skipper, { kind: 'boat', id: boat.id }, { body: 'Neue Segel' });
    expect(await bell(local)).toHaveLength(1);
  });
});

describe('F-403 Anpinnen', () => {
  const pin = (p: Person, postId: string, channel: { kind: string; id: string }, pinned = true) => s.send('PUT', `/api/posts/${postId}/pin`, p.cookie, { channel, pinned });
  const pins = async (channel: string, p?: Person) => ok<{ items: Array<{ post?: { id: string } }>; canManage: boolean }>(await s.send('GET', `/api/pins?channel=${channel}`, p?.cookie));

  it('[F-403] in jedem Verlauf, in dem der Beitrag erscheint, nur dort; nur Verwalter; Pins nur, was Lesende sehen; nie gecacht', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: 'Pinclub' });
    const team = await s.group(owner, { kind: 'team', name: 'Pinteam', parentId: club.id });
    await s.join(owner, team, member);
    const a = await write(owner, { kind: 'group', id: team.id }, { body: 'Termine', reach: 'club' });
    const b = await write(owner, { kind: 'group', id: team.id }, { body: 'Nur Team', reach: 'here' });
    expect((await pin(owner, a!.id, { kind: 'group', id: club.id })).status).toBe(200);
    // im Verein nicht erschienen → 404; Mitglied ohne Verwaltung → 403
    expect((await pin(owner, b!.id, { kind: 'group', id: club.id })).status).toBe(404);
    expect((await pin(member, b!.id, { kind: 'group', id: team.id })).status).toBe(403);
    const clubPins = await s.send('GET', `/api/pins?channel=group:${club.id}`, undefined);
    expect(clubPins.headers.get('Cache-Control')).toBe('private, no-store');
    expect(((await clubPins.json()) as { items: Array<{ post: { id: string } }> }).items.map((i) => i.post.id)).toEqual([a!.id]);
    // wirkt nur dort: im Team nicht angepinnt
    expect((await pins(`group:${team.id}`, member)).items).toEqual([]);
    expect((await pins(`group:${team.id}`, owner)).canManage).toBe(true);
    // „Sichtbar bis“ herabgesetzt → der Pin im Verein zeigt nichts mehr
    await ok(await s.send('PATCH', `/api/posts/${a!.id}`, owner.cookie, { reach: 'here' }));
    expect((await pins(`group:${club.id}`)).items).toEqual([]);
    // lösen
    expect((await pin(owner, a!.id, { kind: 'group', id: club.id }, false)).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM channel_pins WHERE post_id = ?', a!.id)).toBeNull();
  });

  it('[F-403] Profil: nur die Person selbst; angepinnte stehen für Besucher oben', async () => {
    const p = await s.person({ profile: 'public' });
    const visitor = await s.person({ profile: 'public' });
    const old = await write(p, { kind: 'user' }, { body: 'Alt, aber wichtig' });
    await write(p, { kind: 'user' }, { body: 'Neu' });
    expect((await pin(p, old!.id, { kind: 'user', id: '' })).status).toBe(200);
    const page = await ok<{ posts: Array<{ id: string; pinned?: boolean }> }>(await s.send('GET', `/api/profiles/${p.handle}`, visitor.cookie));
    expect(page.posts[0]).toMatchObject({ id: old!.id, pinned: true });
    expect((await ok<{ items: Array<{ id: string; pinned: boolean }> }>(await s.send('GET', '/api/me/posts', p.cookie))).items.find((i) => i.id === old!.id)!.pinned).toBe(true);
    expect((await pin(visitor, old!.id, { kind: 'user', id: '' })).status).toBe(404);
  });

  it('[F-403] [F-425] Löschpfade: Beitrag, Gruppe, Hafen, Boot, Konto; Verwalter von Hafen und Boot löschen fremde Beiträge dort', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const team = await s.group(owner, { kind: 'team' });
    const gp = await write(owner, { kind: 'group', id: team.id }, { body: 'x' });
    await ok(await pin(owner, gp!.id, { kind: 'group', id: team.id }));
    const gp2 = await write(owner, { kind: 'group', id: team.id }, { body: 'y' });
    await ok(await pin(owner, gp2!.id, { kind: 'group', id: team.id }));
    expect((await s.send('DELETE', `/api/posts/${gp!.id}`, owner.cookie)).status).toBe(204);
    expect(await one('SELECT 1 AS x FROM channel_pins WHERE post_id = ?', gp!.id)).toBeNull();
    expect((await s.send('DELETE', `/api/groups/${team.id}`, owner.cookie, { confirm: team.slug })).status).toBeLessThan(300);
    expect(await one(`SELECT 1 AS x FROM channel_pins WHERE channel_kind = 'group' AND channel_id = ?`, team.id)).toBeNull();
    // Hafen: Anleger:in verwaltet, löscht einen fremden Beitrag; Pin fällt mit dem Hafen
    const creator = await s.person({ profile: 'public' });
    const skipper = await s.person({ profile: 'public' });
    const h1 = await harbor(creator);
    await s.boat(skipper, { harborId: h1.id });
    const hp = await write(skipper, { kind: 'harbor', id: h1.id }, { body: 'fremd' });
    const hp2 = await write(skipper, { kind: 'harbor', id: h1.id }, { body: 'bleibt angepinnt' });
    await ok(await pin(creator, hp2!.id, { kind: 'harbor', id: h1.id }));
    expect((await pins(`harbor:${h1.id}`, creator)).canManage).toBe(true);
    expect((await s.send('DELETE', `/api/posts/${hp!.id}`, creator.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/posts/${hp2!.id}`, (await s.person()).cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/admin/harbors/${h1.id}`, admin.cookie, { confirm: h1.id })).status).toBe(204);
    expect(await one(`SELECT 1 AS x FROM channel_pins WHERE channel_kind = 'harbor' AND channel_id = ?`, h1.id)).toBeNull();
    // Boot: Pin fällt mit dem Boot; Profil-Pins mit dem Konto
    const bo = await s.person({ profile: 'public' });
    const boat = await s.boat(bo);
    const bp = await write(bo, { kind: 'boat', id: boat.id }, { body: 'Boot' });
    await ok(await pin(bo, bp!.id, { kind: 'boat', id: boat.id }));
    const up = await write(bo, { kind: 'user' }, { body: 'Profil' });
    await ok(await pin(bo, up!.id, { kind: 'user', id: '' }));
    expect((await s.send('DELETE', `/api/boats/${boat.id}`, bo.cookie)).status).toBe(204);
    expect(await one(`SELECT 1 AS x FROM channel_pins WHERE channel_kind = 'boat' AND channel_id = ?`, boat.id)).toBeNull();
    expect((await s.send('DELETE', '/api/account', bo.cookie)).status).toBe(200);
    expect(await one(`SELECT 1 AS x FROM channel_pins WHERE channel_kind = 'user' AND channel_id = ?`, bo.user.id)).toBeNull();
  });
});

describe('F-403 Pins: Zusammenführen und nächtliches Aufräumen', () => {
  const pin = (p: Person, postId: string, channel: { kind: string; id: string }) => s.send('PUT', `/api/posts/${postId}/pin`, p.cookie, { channel, pinned: true });

  it('[F-403] Häfen zusammengeführt: Pins wandern zum Ziel, doppelte fallen, im alten Hafen bleibt keiner', async () => {
    const p = await s.person({ profile: 'public' });
    const src = await harbor(p);
    const dst = await harbor(p);
    const a = await write(p, { kind: 'harbor', id: src.id }, { body: 'wandert' });
    await ok(await pin(p, a!.id, { kind: 'harbor', id: src.id }));
    // derselbe Beitrag schon im Ziel angepinnt (Hafen-Ziel der Ausbreitung nachgebildet)
    await (await s.db()).prepare(`INSERT INTO channel_pins (channel_kind, channel_id, post_id, created_at) VALUES ('harbor', ?, ?, 1)`).bind(dst.id, a!.id).run();
    await ok(await s.send('POST', `/api/admin/harbors/${src.id}/merge`, admin.cookie, { into: dst.id }));
    expect(await all(`SELECT channel_id FROM channel_pins WHERE post_id = ?`, a!.id)).toEqual([{ channel_id: dst.id }]);
  });

  it('[F-403] Konten zusammengeführt: Profil-Pins wandern, keine Pins des alten Kontos bleiben', async () => {
    const from = await s.person({ profile: 'public' });
    const into = await s.person({ profile: 'public' });
    const a = await write(from, { kind: 'user' }, { body: 'alt' });
    await ok(await pin(from, a!.id, { kind: 'user', id: '' }));
    expect((await s.send('POST', `/api/admin/users/${from.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: from.user.id })).status).toBe(200);
    expect(await all(`SELECT channel_kind, channel_id FROM channel_pins WHERE post_id = ?`, a!.id)).toEqual([{ channel_kind: 'user', channel_id: into.user.id }]);
    expect(await one(`SELECT 1 AS x FROM channel_pins WHERE channel_kind = 'user' AND channel_id = ?`, from.user.id)).toBeNull();
  });

  it('[F-403] nächtlich: Pins verschwundener Verläufe fallen, andere bleiben', async () => {
    const p = await s.person({ profile: 'public' });
    const team = await s.group(p, { kind: 'team' });
    const post = await write(p, { kind: 'group', id: team.id }, { body: 'bleibt' });
    await ok(await pin(p, post!.id, { kind: 'group', id: team.id }));
    const db = await s.db();
    await db.prepare(`INSERT INTO channel_pins (channel_kind, channel_id, post_id, created_at) VALUES ('boat', 'GoneBoat00000001', ?, 1)`).bind(post!.id).run();
    await db.prepare(`INSERT INTO channel_pins (channel_kind, channel_id, post_id, created_at) VALUES ('harbor', 'GoneHarbor000001', ?, 1)`).bind(post!.id).run();
    await h.scheduled();
    expect(await all(`SELECT channel_kind FROM channel_pins WHERE post_id = ? ORDER BY channel_kind`, post!.id)).toEqual([{ channel_kind: 'group' }]);
  });
});

describe('Review-Befunde Phase 2/3', () => {
  it('[F-416] Glocke nur, solange die Empfängerin den Beitrag sehen darf – nicht mehr nach „Nur mit Link“', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const team = await s.group(owner, { kind: 'team' });
    await s.join(owner, team, member);
    expect((await s.send('PATCH', '/api/me/settings', member.cookie, { notify: { post: 'none' } })).status).toBe(200);
    const post = await write(owner, { kind: 'group', id: team.id }, { body: 'gleich mit Link' });
    const bell = async () => (await ok<{ items: Array<{ kind: string }> }>(await s.send('GET', '/api/notifications', member.cookie))).items.filter((n) => n.kind === 'post');
    expect(await bell()).toHaveLength(1);
    await ok(await s.send('PATCH', `/api/posts/${post!.id}`, owner.cookie, { visibility: 'unlisted' }));
    expect(await bell()).toEqual([]);
  });

  it('[F-406] die Autor:in sieht eigene Beiträge in jedem Verlauf, auch am privaten Boot über /p/<id>', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const other = await s.person({ profile: 'public' });
    const boat = await s.boat(owner, { visibility: 'private' });
    const p = await write(owner, { kind: 'boat', id: boat.id }, { body: 'privat' });
    expect((await s.send('GET', `/api/posts/${p!.id}`, other.cookie)).status).toBe(404);
    const mine = await ok<{ item: { post: { where: { kind: string } } } }>(await s.send('GET', `/api/posts/${p!.id}`, owner.cookie));
    expect(mine.item.post.where.kind).toBe('boat');
  });

  it('[F-409] erweitern nur mit aktuellem Schreibrecht im Verlauf, einschränken immer', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    await s.join(owner, team, member);
    const p = await write(member, { kind: 'group', id: team.id }, { body: 'noch drin', reach: 'club' });
    expect((await s.send('DELETE', `/api/groups/${team.id}/members/${member.user.id}`, member.cookie)).status).toBe(204);
    expect((await s.send('PATCH', `/api/posts/${p!.id}`, member.cookie, { reach: 'all' })).status).toBe(403);
    await ok(await s.send('PATCH', `/api/posts/${p!.id}`, member.cookie, { reach: 'here' }));
    await ok(await s.send('PATCH', `/api/posts/${p!.id}`, member.cookie, { visibility: 'members' }));
  });

  it('[F-426] angehängter Törn nur, wenn sein „Sichtbar bis“ die Stufe abdeckt, in der der Beitrag erscheint', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const clubMember = await s.person({ profile: 'public' });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    await s.join(owner, club, clubMember);
    await s.join(owner, team, clubMember);
    const r = await createShare(h, owner.cookie, { visibility: 'public', title: 'Nur Team', headers: { 'X-Share-Groups': JSON.stringify([team.id]), 'X-Share-Reach': 'here' } });
    const share = ((await r.json()) as { share: { id: string } }).share;
    const post = await write(owner, { kind: 'group', id: team.id }, { body: 'mit Anhang', reach: 'club', shareId: share.id });
    type Items = Array<{ post?: { id: string; voyage: { id: string } | null } }>;
    const inTeam = (await stream(`/api/groups/${team.id}/stream`, clubMember.cookie)).items as unknown as Items;
    expect(inTeam.find((i) => i.post?.id === post!.id)!.post!.voyage).toMatchObject({ id: share.id });
    const inClub = (await stream(`/api/groups/${club.id}/stream`, clubMember.cookie)).items as unknown as Items;
    expect(inClub.find((i) => i.post?.id === post!.id)!.post!.voyage).toBeNull();
  });
});

