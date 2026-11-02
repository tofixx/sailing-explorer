// Funktionale Tests: Beiträge als Grundtyp, Phase 1 (Konzept 21) – Dach `posts` für Törns (F-400), „Mein Verlauf“
// (F-401), Sichtbarkeit beim Lesen (F-402), Löschkonzept (F-404), „Nur Mitglieder“ nie aus öffentlichen Caches
// (F-415), Text-Beiträge im Profil (F-420), Schreibrecht je Gruppe (F-421), „Ins Fahrtenbuch“ (F-422) und
// „Ansehen als …“ (F-423).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminPostsAAAAAAA1';
let h: Harness;
let s: ReturnType<typeof social>;
let admin: { cookie: string };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'posts-admin@example.org', Date.now() - 10 * DAY).run();
  admin = await login(h, 'posts-admin@example.org');
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface MyPostOut {
  id: string;
  kind: string;
  visibility: string;
  channel: { kind: string; slug?: string; name?: string };
  groups: Array<{ slug: string; name: string }>;
  body: string;
  voyage?: { title: string; path: string; logState: string };
}

const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const json = async <T>(res: Response) => {
  expect(res.ok, await res.clone().text()).toBe(true);
  return (await res.json()) as T;
};
async function myPosts(p: Person, area = 'all') {
  return json<{ items: MyPostOut[]; cursor: string | null }>(await s.send('GET', `/api/me/posts?area=${area}`, p.cookie));
}
async function groupPost(p: Person, groupId: string, body: Record<string, unknown>, status = 201) {
  const res = await s.send('POST', `/api/groups/${groupId}/posts`, p.cookie, { visibility: 'public', ...body });
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 201 ? ((await res.json()) as { post: { id: string } }).post : null;
}
async function profilePost(p: Person, body: Record<string, unknown>, status = 201) {
  const res = await s.send('POST', '/api/me/posts', p.cookie, body);
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 201 ? ((await res.json()) as { post: { id: string } }).post : null;
}
const stream = async (path: string, cookie?: string) => json<StreamOut>(await s.send('GET', path, cookie));
const postIds = (st: StreamOut) => st.items.filter((i) => i.kind === 'post').map((i) => i.post!.id);

let harborN = 0;
async function harbor(p: Person) {
  const res = await s.send('POST', '/api/harbors', p.cookie, { name: s.uniq(`Posthafen${++harborN}`), lat: -40 - harborN / 10, lon: -160 });
  return ((await res.json()) as { harbor: { id: string } }).harbor.id;
}
async function manual(p: Person, o: Record<string, unknown> = {}) {
  const from = await harbor(p);
  const res = await s.send('POST', '/api/shares/manual', p.cookie, { startedAt: Date.now() - DAY, fromHarbor: { harborId: from }, toHarbor: { harborId: from }, distNm: 8, ...o });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string; logState: string } }).share;
}

describe('F-400 Dach `posts`: Törns bekommen eine Post-Zeile mit derselben ID', () => {
  it('[F-400] GPX-Törn und Fahrtenbuch-Eintrag schreiben ihre Post-Zeile im selben Batch (Heimatverlauf Profil)', async () => {
    const p = await s.person({ profile: 'public' });
    const gpx = await s.share(p);
    const log = await manual(p);
    expect(await one('SELECT kind, channel_kind, channel_id, share_id, author_id FROM posts WHERE id = ?', gpx.id)).toEqual({
      kind: 'voyage', channel_kind: 'user', channel_id: p.user.id, share_id: gpx.id, author_id: p.user.id,
    });
    expect(await one('SELECT kind, share_id FROM posts WHERE id = ?', log.id)).toEqual({ kind: 'logbook', share_id: log.id });
  });

  it('[F-400] nächtlicher Waisen-Check trägt eine fehlende Post-Zeile nach', async () => {
    const p = await s.person();
    const sh = await s.share(p);
    await (await s.db()).prepare('DELETE FROM posts WHERE id = ?').bind(sh.id).run();
    await h.scheduled();
    expect(await one('SELECT kind, share_id FROM posts WHERE id = ?', sh.id)).toEqual({ kind: 'voyage', share_id: sh.id });
  });

  it('[F-400] Törn-Zeilen sind keine Text-Beiträge: Reagieren und Melden als `post` → 404', async () => {
    const p = await s.person({ profile: 'public' });
    const other = await s.person({ profile: 'public' });
    const sh = await s.share(p);
    expect((await s.send('PUT', `/api/reactions/post/${sh.id}`, other.cookie, { kind: 'like' })).status).toBe(404);
    expect((await s.send('POST', '/api/reports', other.cookie, { kind: 'post', id: sh.id, reason: 'abuse', note: '' })).status).toBe(404);
  });
});

describe('F-401 Mein Verlauf: alles Eigene, getrennt nach „Wer sieht es“ und „Wo steht es“', () => {
  it('[F-401] zeigt Törns jeder Sichtbarkeit (auch „Nur mit Link“ und „Nur ich“), Profil- und Gruppen-Beiträge; „Privat“ nur „Nur ich“', async () => {
    const p = await s.person({ profile: 'public', supporter: true });
    const g = await s.group(p, { kind: 'team', name: 'Mittwochsregatta' });
    const pub = await s.share(p, { title: 'Öffentlich', groups: [g.id] });
    const link = await s.share(p, { title: 'Mit Link', visibility: 'unlisted' });
    const priv = await s.share(p, { title: 'Geheim', visibility: 'private' });
    const note = await profilePost(p, { body: 'Nur für mich', visibility: 'private' });
    const prof = await profilePost(p, { body: 'Hallo Welt' });
    const inGroup = await groupPost(p, g.id, { body: 'Training heute', visibility: 'members' });

    const all = await myPosts(p);
    const by = new Map(all.items.map((i) => [i.id, i]));
    expect(by.get(pub.id)).toMatchObject({ kind: 'voyage', visibility: 'public', channel: { kind: 'user' }, groups: [{ slug: g.slug, name: 'Mittwochsregatta' }] });
    expect(by.get(link.id)).toMatchObject({ visibility: 'unlisted' });
    expect(by.get(link.id)!.voyage!.path).toBe(`/s/${link.id}/${link.shareKey}`);
    expect(by.get(priv.id)).toMatchObject({ visibility: 'private' });
    expect(by.get(note!.id)).toMatchObject({ kind: 'text', visibility: 'private', channel: { kind: 'user' }, body: 'Nur für mich' });
    expect(by.get(prof!.id)).toMatchObject({ visibility: 'public', channel: { kind: 'user' } });
    expect(by.get(inGroup!.id)).toMatchObject({ visibility: 'members', channel: { kind: 'group', slug: g.slug } });
    // neueste zuerst
    expect(all.items[0].id).toBe(inGroup!.id);

    const priv2 = await myPosts(p, 'private');
    expect(priv2.items.map((i) => i.id).sort()).toEqual([priv.id, note!.id].sort());
  });

  it('[F-401] Cursor, nur angemeldet, Bereich geprüft; andere sehen nichts davon', async () => {
    const p = await s.person({ profile: 'public' });
    for (let i = 0; i < 3; i++) await s.share(p, { title: `T${i}` });
    const db = await s.db();
    // 22 Beiträge ohne Tagesgrenze direkt anlegen (Seitengröße 20)
    for (let i = 0; i < 20; i++) {
      await db.prepare(`INSERT INTO posts (id, author_id, body, created_at, kind, channel_kind, channel_id, visibility, reach) VALUES (?, ?, 'x', ?, 'text', 'user', ?, 'public', 'here')`)
        .bind(`PostCursorTest${String(i).padStart(4, '0')}${p.user.id.slice(0, 4)}`, p.user.id, Date.now() - i * 1000, p.user.id).run();
    }
    const first = await myPosts(p);
    expect(first.items).toHaveLength(20);
    expect(first.cursor).toBeTruthy();
    const second = await json<{ items: MyPostOut[]; cursor: string | null }>(await s.send('GET', `/api/me/posts?cursor=${first.cursor}`, p.cookie));
    expect(second.items).toHaveLength(3);
    expect(second.cursor).toBeNull();
    expect((await s.send('GET', '/api/me/posts', undefined)).status).toBe(401);
    expect((await s.send('GET', '/api/me/posts?area=fremd', p.cookie)).status).toBe(400);
    const other = await s.person();
    expect((await myPosts(other)).items).toEqual([]);
  });
});

describe('F-402/F-415 Sichtbarkeit beim Lesen, „Nur Mitglieder“', () => {
  it('[F-402] „Nur Mitglieder“: Mitglieder sehen ihn im Gruppen- und persönlichen Stream, Fremde, Gäste und Teams nicht; Reagieren 404', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const stranger = await s.person({ profile: 'public' });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    await s.join(owner, club, member);
    const pub = await groupPost(owner, club.id, { body: 'Für alle' });
    const mem = await groupPost(owner, club.id, { body: 'Nur Mitglieder', visibility: 'members' });

    expect(postIds(await stream(`/api/groups/${club.id}/stream`, member.cookie))).toEqual(expect.arrayContaining([pub!.id, mem!.id]));
    expect(postIds(await stream('/api/stream', member.cookie))).toContain(mem!.id);
    expect(postIds(await stream(`/api/groups/${club.id}/stream`, stranger.cookie))).toEqual([pub!.id]);
    expect(postIds(await stream(`/api/groups/${club.id}/stream`))).toEqual([pub!.id]);
    // Vereinsbeiträge erscheinen in den Teams – „Nur Mitglieder“ nie (F-415)
    expect(postIds(await stream(`/api/groups/${team.id}/stream`, owner.cookie))).toEqual([pub!.id]);
    expect((await s.send('PUT', `/api/reactions/post/${mem!.id}`, stranger.cookie, { kind: 'like' })).status).toBe(404);
    expect((await s.send('PUT', `/api/reactions/post/${mem!.id}`, member.cookie, { kind: 'like' })).status).toBe(200);
    expect((await s.send('POST', '/api/reports', stranger.cookie, { kind: 'post', id: mem!.id, reason: 'abuse', note: '' })).status).toBe(404);
  });

  it('[F-415] nie aus dem 60-s-Cache öffentlicher Gruppen-Streams, nie im RSS, nie in der Community', async () => {
    const owner = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const g = await s.group(owner, { kind: 'team' });
    await s.join(owner, g, member);
    const mem = await groupPost(member, g.id, { body: 'Intern', visibility: 'members' });
    // Gast füllt den Cache, das Mitglied bekommt trotzdem seinen Beitrag (nie aus dem Cache)
    expect(postIds(await stream(`/api/groups/${g.id}/stream`))).not.toContain(mem!.id);
    const res = await s.send('GET', `/api/groups/${g.id}/stream`, member.cookie);
    expect(res.headers.get('X-Stream-Cache')).toBeNull();
    expect(postIds((await res.json()) as StreamOut)).toContain(mem!.id);
    const feed = await (await h.fetch(`/g/${g.slug}/feed.xml`)).text();
    expect(feed).not.toContain('Intern');
    expect(postIds(await stream(`/api/stream/public?club=${g.slug}`))).not.toContain(mem!.id);
    expect(postIds(await stream('/api/stream/public'))).not.toContain(mem!.id);
  });

  it('[F-402] Gruppe: Stufen außerhalb von öffentlich/„Nur Mitglieder“ → 400', async () => {
    const owner = await s.person();
    const g = await s.group(owner, { kind: 'team' });
    expect(await s.errorOf((await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'x', visibility: 'private' })))).toBe('invalid_visibility');
    expect(await s.errorOf((await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'x', visibility: 'kaputt' })))).toBe('invalid_visibility');
  });
});

describe('F-420 Text-Beiträge im eigenen Profil', () => {
  it('[F-420] öffentlich: Follower und man selbst im Stream, Besucher auf dem Profil; nicht in „Alles“', async () => {
    const p = await s.person({ profile: 'public' });
    const fan = await s.person({ profile: 'public' });
    expect((await s.send('PUT', `/api/follows/user/${p.handle}`, fan.cookie)).status).toBe(200);
    const post = await profilePost(p, { body: 'Saisonstart! https://example.org', link: 'https://example.org/x' });
    const fanStream = await stream('/api/stream', fan.cookie);
    const item = fanStream.items.find((i) => i.post?.id === post!.id)!;
    expect(item).toMatchObject({ kind: 'post', group: null, actor: { handle: p.handle } });
    expect(postIds(await stream('/api/stream', p.cookie))).toContain(post!.id);
    const page = await json<{ posts: Array<{ id: string; group: unknown }> }>(await s.send('GET', `/api/profiles/${p.handle}`, fan.cookie));
    expect(page.posts.map((x) => x.id)).toContain(post!.id);
    expect(postIds(await stream('/api/stream/public'))).not.toContain(post!.id);
    // eigene Seite zeigt statt der Besucherliste „Mein Verlauf“
    expect((await json<{ posts: unknown[] }>(await s.send('GET', `/api/profiles/${p.handle}`, p.cookie))).posts).toEqual([]);
    // Reagieren geht, die Autor:in bekommt eine Glocke mit Link aufs Profil
    expect((await s.send('PUT', `/api/reactions/post/${post!.id}`, fan.cookie, { kind: 'like' })).status).toBe(200);
    const bell = await json<{ items: Array<{ kind: string; href: string; text: string }> }>(await s.send('GET', '/api/notifications', p.cookie));
    // Beiträge verlinken `/p/<id>` (F-406)
    expect(bell.items.find((n) => n.kind === 'reaction')).toMatchObject({ href: `/p/${post!.id}` });
  });

  it('[F-420] nicht öffentliches Profil: Beitrag für niemanden sonst sichtbar; „Nur ich“ nur für Unterstützer und nie im Log', async () => {
    const free = await s.person({ profile: 'public' });
    expect(await s.errorOf((await s.send('POST', '/api/me/posts', free.cookie, { body: 'geheim', visibility: 'private' })))).toBe('supporter_required');
    const sup = await s.person({ profile: 'public', supporter: true });
    const priv = await profilePost(sup, { body: 'geheim', visibility: 'private' });
    expect(await one(`SELECT 1 AS x FROM activity WHERE subject_kind = 'post' AND subject_id = ?`, priv!.id)).toBeNull();
    const other = await s.person({ profile: 'public' });
    expect((await s.send('PUT', `/api/reactions/post/${priv!.id}`, other.cookie, { kind: 'like' })).status).toBe(404);
    expect((await json<{ posts: Array<{ id: string }> }>(await s.send('GET', `/api/profiles/${sup.handle}`, other.cookie))).posts.map((x) => x.id)).not.toContain(priv!.id);

    const hidden = await s.person({ profile: 'unlisted' });
    const pub = await profilePost(hidden, { body: 'öffentlich, Profil nicht' });
    expect((await s.send('PUT', `/api/reactions/post/${pub!.id}`, other.cookie, { kind: 'like' })).status).toBe(404);
  });

  it('[F-420] Besucherliste filtert im SQL: viele neuere unsichtbare Beiträge verdrängen keine älteren öffentlichen', async () => {
    const p = await s.person({ profile: 'public' });
    const g = await s.group(p, { kind: 'team' });
    const old = await profilePost(p, { body: 'älter, öffentlich' });
    const db = await s.db();
    for (let i = 0; i < 25; i++) {
      await db.prepare(`INSERT INTO posts (id, author_id, group_id, body, created_at, kind, channel_kind, channel_id, visibility, reach) VALUES (?, ?, ?, 'intern', ?, 'text', 'group', ?, 'members', 'here')`)
        .bind(`PostMembersFill${String(i).padStart(3, '0')}${p.user.id.slice(0, 4)}`, p.user.id, g.id, Date.now() + 1000 + i, g.id).run();
    }
    const stranger = await s.person();
    const page = await json<{ posts: Array<{ id: string }> }>(await s.send('GET', `/api/profiles/${p.handle}`, stranger.cookie));
    expect(page.posts.map((x) => x.id)).toEqual([old!.id]);
    const asMember = await json<{ posts: Array<{ id: string }> }>(await s.send('GET', `/api/profiles/${p.handle}?as=group:${g.id}`, p.cookie));
    expect(asMember.posts).toHaveLength(20);
  });

  it('[F-420] höchstens 5 Beiträge pro Tag im Profil, leer und kaputter Link → 400, ohne Anmeldung 401', async () => {
    const p = await s.person({ profile: 'public' });
    for (let i = 0; i < 5; i++) await profilePost(p, { body: `Nr. ${i}` });
    expect(await s.errorOf(await s.send('POST', '/api/me/posts', p.cookie, { body: 'eins zu viel' }))).toBe('post_quota');
    const q = await s.person();
    expect(await s.errorOf(await s.send('POST', '/api/me/posts', q.cookie, { body: '  ' }))).toBe('empty');
    expect(await s.errorOf(await s.send('POST', '/api/me/posts', q.cookie, { body: 'x', link: 'javascript:alert(1)' }))).toBe('invalid_link');
    expect((await s.send('POST', '/api/me/posts', undefined, { body: 'x' })).status).toBe(401);
  });
});

describe('F-421 Schreibrecht je Gruppe', () => {
  it('[F-421] Verein: Mitglieder standardmäßig nicht, nach „alle Mitglieder“ schon; Team: alle Mitglieder; Fremde nie', async () => {
    const owner = await s.person({ supporter: true });
    const admin2 = await s.person();
    const member = await s.person();
    const stranger = await s.person();
    const club = await s.group(owner);
    expect(club).toMatchObject({ postBy: 'admins' });
    await s.join(owner, club, member);
    await s.join(owner, club, admin2);
    expect((await s.send('PATCH', `/api/groups/${club.id}/members/${admin2.user.id}`, owner.cookie, { role: 'admin' })).status).toBe(200);
    await groupPost(member, club.id, { body: 'darf ich?' }, 403);
    await groupPost(admin2, club.id, { body: 'Admins dürfen' });
    // nur der Eigner ändert die Einstellung
    expect((await s.send('PATCH', `/api/groups/${club.id}`, admin2.cookie, { postBy: 'members' })).status).toBe(403);
    expect(await s.errorOf(await s.send('PATCH', `/api/groups/${club.id}`, owner.cookie, { postBy: 'alle' }))).toBe('invalid_post_by');
    const saved = await json<{ group: { postBy: string } }>(await s.send('PATCH', `/api/groups/${club.id}`, owner.cookie, { postBy: 'members' }));
    expect(saved.group.postBy).toBe('members');
    await groupPost(member, club.id, { body: 'jetzt schon' });
    await groupPost(stranger, club.id, { body: 'fremd' }, 403);

    const team = await s.group(owner, { kind: 'team' });
    expect(team).toMatchObject({ postBy: 'members' });
    await s.join(owner, team, member);
    await groupPost(member, team.id, { body: 'Team-Mitglied' });
  });
});

describe('F-404 Löschkonzept: ein Einstieg `removePost`, jeder Weg', () => {
  it('[F-404] einzeln: Autor:in bzw. Gruppen-Admin löscht Text-Beitrag samt Aktivität, Reaktionen, Meldungen', async () => {
    const owner = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const g = await s.group(owner, { kind: 'team' });
    await s.join(owner, g, member);
    const a = await groupPost(member, g.id, { body: 'von Mitglied' });
    const b = await profilePost(member, { body: 'im Profil' });
    expect((await s.send('PUT', `/api/reactions/post/${a!.id}`, owner.cookie, { kind: 'like' })).status).toBe(200);
    expect((await s.send('POST', '/api/reports', owner.cookie, { kind: 'post', id: b!.id, reason: 'spam', note: '' })).status).toBe(201);
    // Gruppen-Admin löscht den Gruppen-Beitrag, aber nicht den Profil-Beitrag
    expect((await s.send('DELETE', `/api/posts/${a!.id}`, owner.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/posts/${b!.id}`, owner.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/posts/${b!.id}`, member.cookie)).status).toBe(204);
    for (const id of [a!.id, b!.id]) {
      expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', id)).toBeNull();
      expect(await one(`SELECT 1 AS x FROM activity WHERE subject_kind = 'post' AND subject_id = ?`, id)).toBeNull();
      expect(await one(`SELECT 1 AS x FROM reactions WHERE subject_kind = 'post' AND subject_id = ?`, id)).toBeNull();
      expect(await one(`SELECT 1 AS x FROM reports WHERE target_kind = 'post' AND target_id = ?`, id)).toBeNull();
    }
  });

  it('[F-404] Törn über `DELETE /api/posts/:id`: nur die Eigentümer:in; Dateien, Speicher und Post-Zeile weg', async () => {
    const owner = await s.person({ profile: 'public' });
    const groupAdmin = await s.person();
    const g = await s.group(groupAdmin, { kind: 'team' });
    await s.join(groupAdmin, g, owner);
    const sh = await s.share(owner, { groups: [g.id] });
    expect((await s.send('DELETE', `/api/posts/${sh.id}`, groupAdmin.cookie)).status).toBe(404);
    // geprüft wird die Eigentümer:in des Törns, nicht die Kopie in posts.author_id
    await (await s.db()).prepare('UPDATE posts SET author_id = ? WHERE id = ?').bind(groupAdmin.user.id, sh.id).run();
    expect((await s.send('DELETE', `/api/posts/${sh.id}`, groupAdmin.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/posts/${sh.id}`, owner.cookie)).status).toBe(204);
    expect(await one('SELECT 1 AS x FROM shares WHERE id = ?', sh.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', sh.id)).toBeNull();
    expect(await (await h.r2()).head(`shares/${sh.id}`)).toBeNull();
  });

  it('[F-404] Törn auf den bisherigen Wegen gelöscht (Teilen-Dialog, Moderation, Ablauf): Post-Zeile fällt mit', async () => {
    const p = await s.person({ profile: 'public' });
    const a = await s.share(p);
    expect((await s.send('DELETE', `/api/shares/${a.id}`, p.cookie)).status).toBe(204);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', a.id)).toBeNull();

    const b = await s.share(p);
    const reporter = await s.person();
    expect((await s.send('POST', '/api/reports', reporter.cookie, { kind: 'share', id: b.id, reason: 'abuse', note: '' })).status).toBe(201);
    const list = await json<{ reports: Array<{ id: string; targetId: string }> }>(await s.send('GET', '/api/admin/reports', admin.cookie));
    const r = list.reports.find((x) => x.targetId === b.id)!;
    expect((await s.send('POST', `/api/admin/reports/${r.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', b.id)).toBeNull();

    // Ablauf (Saison, Konzept 5.5): kostenloser Törn von vor drei Jahren
    const c = await s.share(p);
    const old = Date.UTC(new Date().getUTCFullYear() - 3, 5, 1);
    await (await s.db()).prepare('UPDATE shares SET created_at = ?, started_at = ? WHERE id = ?').bind(old, old, c.id).run();
    await h.scheduled();
    expect(await one('SELECT 1 AS x FROM shares WHERE id = ?', c.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', c.id)).toBeNull();
  });

  it('[F-404] Moderation löscht einen Profil-Beitrag; Gruppe löschen nimmt ihre Beiträge mit', async () => {
    const p = await s.person({ profile: 'public' });
    const reporter = await s.person();
    const post = await profilePost(p, { body: 'unpassend' });
    expect((await s.send('POST', '/api/reports', reporter.cookie, { kind: 'post', id: post!.id, reason: 'abuse', note: '' })).status).toBe(201);
    const list = await json<{ reports: Array<{ id: string; targetId: string; title?: string }> }>(await s.send('GET', '/api/admin/reports', admin.cookie));
    const r = list.reports.find((x) => x.targetId === post!.id)!;
    expect(r).toBeTruthy();
    expect((await s.send('POST', `/api/admin/reports/${r.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', post!.id)).toBeNull();

    const g = await s.group(p, { kind: 'team' });
    const gp = await groupPost(p, g.id, { body: 'weg mit der Gruppe', visibility: 'members' });
    expect((await s.send('DELETE', `/api/groups/${g.id}`, p.cookie)).status).toBe(204);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', gp!.id)).toBeNull();
    expect(await one(`SELECT 1 AS x FROM activity WHERE subject_kind = 'post' AND subject_id = ?`, gp!.id)).toBeNull();
  });

  it('[F-404] Konto löschen und inaktives Konto entfernen: Beiträge, Post-Zeilen der Törns, Tageszähler weg', async () => {
    const p = await s.person({ profile: 'public' });
    const sh = await s.share(p);
    const post = await profilePost(p, { body: 'bis bald' });
    expect((await s.send('DELETE', '/api/account', p.cookie)).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM posts WHERE author_id = ?', p.user.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM posts WHERE id IN (?, ?)', sh.id, post!.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `user:${p.user.id}`)).toBeNull();
    expect(await one(`SELECT 1 AS x FROM activity WHERE subject_kind = 'post' AND subject_id = ?`, post!.id)).toBeNull();

    // inaktiv (ohne Törns): der nächtliche Lauf entfernt das Konto samt Beiträgen
    const q = await s.person({ profile: 'public' });
    const qp = await profilePost(q, { body: 'lange her' });
    await (await s.db()).prepare('UPDATE users SET created_at = ?, last_login = ? WHERE id = ?').bind(Date.now() - 1000 * DAY, Date.now() - 900 * DAY, q.user.id).run();
    await (await s.db()).prepare('DELETE FROM sessions WHERE user_id = ?').bind(q.user.id).run();
    await h.scheduled();
    expect(await one('SELECT 1 AS x FROM users WHERE id = ?', q.user.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', qp!.id)).toBeNull();
    expect(await one('SELECT 1 AS x FROM post_log WHERE group_id = ?', `user:${q.user.id}`)).toBeNull();
  });

  it('[F-404] Konten verbinden: Beiträge und Profil-Verlauf wandern ans Ziel', async () => {
    const from = await s.person({ profile: 'public' });
    const into = await s.person({ profile: 'public' });
    const sh = await s.share(from);
    const post = await profilePost(from, { body: 'umziehen' });
    expect((await s.send('POST', `/api/admin/users/${from.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: from.user.id })).status).toBe(200);
    expect(await one('SELECT author_id, channel_id FROM posts WHERE id = ?', post!.id)).toEqual({ author_id: into.user.id, channel_id: into.user.id });
    expect(await one('SELECT author_id, channel_id FROM posts WHERE id = ?', sh.id)).toEqual({ author_id: into.user.id, channel_id: into.user.id });
  });
});

describe('F-422 Ins Fahrtenbuch', () => {
  it('[F-422] GPX = Vorschlag, eigener Eintrag = bestätigt, beim Speichern abschaltbar; ausgeschlossen zählt nicht in Kennzahlen', async () => {
    const p = await s.person({ profile: 'public' });
    const b = await s.boat(p);
    const gpx = await s.share(p, { boatId: b.id, distNm: 10 });
    const log = await manual(p, { distNm: 5 });
    expect(log.logState).toBe('confirmed');
    // nur die Eigentümer:in erfährt den Stand
    const stranger = await s.person();
    expect((await json<{ share: { logState?: string } }>(await s.send('GET', `/api/shares/${log.id}`, stranger.cookie))).share.logState).toBeUndefined();
    expect((await json<{ share: { logState: string } }>(await s.send('GET', `/api/shares/${gpx.id}`, p.cookie))).share.logState).toBe('suggested');
    const off = await (await import('./worker-harness')).createShare(h, p.cookie, { headers: { 'X-Share-Log-State': 'excluded', 'X-Share-Distance': '3' } });
    expect(((await off.json()) as { share: { logState: string } }).share.logState).toBe('excluded');

    const stats = async () => (await json<{ stats: { voyages: number; distNm: number } }>(await s.send('GET', `/api/profiles/${p.handle}`, undefined))).stats;
    expect(await stats()).toEqual(expect.objectContaining({ voyages: 2, distNm: 15 }));
    expect((await s.send('PATCH', `/api/shares/${gpx.id}`, p.cookie, { logState: 'excluded' })).status).toBe(200);
    expect(await stats()).toEqual(expect.objectContaining({ voyages: 1, distNm: 5 }));
    const boat = await json<{ stats: { voyages: number; distNm: number } }>(await s.send('GET', `/api/boats/${b.id}`, undefined));
    expect(boat.stats).toEqual(expect.objectContaining({ voyages: 0, distNm: 0 }));
    // bleibt als Beitrag und in der Liste
    const page = await json<{ voyages: Array<{ id: string }> }>(await s.send('GET', `/api/profiles/${p.handle}`, undefined));
    expect(page.voyages.map((v) => v.id)).toContain(gpx.id);
    expect((await myPosts(p)).items.find((i) => i.id === gpx.id)!.voyage!.logState).toBe('excluded');
    // bestätigen und wieder an
    expect((await s.send('PATCH', `/api/shares/${gpx.id}`, p.cookie, { logState: 'confirmed' })).status).toBe(200);
    expect(await stats()).toEqual(expect.objectContaining({ voyages: 2, distNm: 15 }));
    expect(await s.errorOf(await s.send('PATCH', `/api/shares/${gpx.id}`, p.cookie, { logState: 'vielleicht' }))).toBe('invalid_log_state');
  });
});

describe('F-424 Törn umbenennen nach dem Teilen, auch „Nur mit Link“', () => {
  it('[F-424] Eigentümer:in benennt öffentliche und „Nur mit Link“-Törns um; Schlüssel bleibt, Link-Vorschau folgt; andere 404', async () => {
    const p = await s.person({ profile: 'public', supporter: true });
    const link = await s.share(p, { visibility: 'unlisted', title: 'Alt' });
    const res = await json<{ share: { title: string; shareKey: string } }>(await s.send('PATCH', `/api/shares/${link.id}`, p.cookie, { title: 'Neuer Name' }));
    expect(res.share).toMatchObject({ title: 'Neuer Name', shareKey: link.shareKey });
    const html = await (await h.fetch(`/s/${link.id}/${link.shareKey}`)).text();
    expect(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1]).toContain('Neuer Name');
    expect((await myPosts(p)).items.find((i) => i.id === link.id)!.voyage).toMatchObject({ title: 'Neuer Name', path: `/s/${link.id}/${link.shareKey}` });
    const pub = await s.share(p, { title: 'Öffentlich' });
    expect((await s.send('PATCH', `/api/shares/${pub.id}`, p.cookie, { title: 'Umbenannt' })).status).toBe(200);
    const other = await s.person();
    expect((await s.send('PATCH', `/api/shares/${pub.id}`, other.cookie, { title: 'Fremd' })).status).toBe(404);
    expect(await s.errorOf(await s.send('PATCH', `/api/shares/${pub.id}`, p.cookie, { title: '   ' }))).toBe('invalid_title');
  });
});

describe('F-423 Ansehen als …', () => {
  it('[F-423] Vorschau als Öffentlichkeit bzw. Mitglied einer eigenen Gruppe – nie mehr als ein echter Betrachter', async () => {
    const p = await s.person({ profile: 'public', supporter: true });
    const g = await s.group(p, { kind: 'team', visibility: 'private' });
    const pub = await profilePost(p, { body: 'für alle' });
    const priv = await profilePost(p, { body: 'nur ich', visibility: 'private' });
    const mem = await groupPost(p, g.id, { body: 'nur Team', visibility: 'members' });

    const self = await json<{ previewOptions: { groups: Array<{ id: string }> }; posts: unknown[] }>(await s.send('GET', `/api/profiles/${p.handle}`, p.cookie));
    expect(self.previewOptions.groups.map((x) => x.id)).toContain(g.id);

    const asPublic = await json<{ profile: { isSelf: boolean }; posts: Array<{ id: string }>; preview: { as: string; visible: boolean } }>(
      await s.send('GET', `/api/profiles/${p.handle}?as=public`, p.cookie),
    );
    expect(asPublic.preview).toEqual({ as: 'public', visible: true });
    expect(asPublic.profile.isSelf).toBe(false);
    expect(asPublic.posts.map((x) => x.id)).toEqual([pub!.id]);

    const asMember = await json<{ posts: Array<{ id: string; group: { slug: string } | null; visibility: string }> }>(
      await s.send('GET', `/api/profiles/${p.handle}?as=group:${g.id}`, p.cookie),
    );
    expect(asMember.posts.map((x) => x.id).sort()).toEqual([pub!.id, mem!.id].sort());
    expect(asMember.posts.find((x) => x.id === mem!.id)).toMatchObject({ group: { slug: g.slug }, visibility: 'members' });
    expect(asMember.posts.map((x) => x.id)).not.toContain(priv!.id);

    // echter Betrachter bekommt dasselbe wie die Vorschau – ein Fremder ohne Mitgliedschaft nur Öffentliches
    const stranger = await s.person();
    expect((await json<{ posts: Array<{ id: string }> }>(await s.send('GET', `/api/profiles/${p.handle}`, stranger.cookie))).posts.map((x) => x.id)).toEqual([pub!.id]);
    // fremde Gruppe, unbekannte Vorschau und fremde Seite → 400
    const other = await s.person({ profile: 'public' });
    const og = await s.group(other, { kind: 'team' });
    expect(await s.errorOf(await s.send('GET', `/api/profiles/${p.handle}?as=group:${og.id}`, p.cookie))).toBe('invalid_preview');
    expect(await s.errorOf(await s.send('GET', `/api/profiles/${p.handle}?as=admin`, p.cookie))).toBe('invalid_preview');
    expect(await s.errorOf(await s.send('GET', `/api/profiles/${p.handle}?as=public`, other.cookie))).toBe('invalid_preview');
  });

  it('[F-423] Profil „Nur mit Link“: als Öffentlichkeit nicht sichtbar (ohne Schlüssel)', async () => {
    const p = await s.person({ profile: 'unlisted' });
    const res = await json<{ preview: { visible: boolean }; posts?: unknown }>(await s.send('GET', `/api/profiles/${p.handle}?as=public`, p.cookie));
    expect(res.preview.visible).toBe(false);
    expect(res.posts).toBeUndefined();
  });
});
