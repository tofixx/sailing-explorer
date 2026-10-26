// Funktionale Tests: Folgen, Aktivitäts-Log und Neuigkeiten, Beiträge, RSS, Sammelmail, Meilensteine, Vorschläge und
// Aufräumen (F-158 … F-167, Konzept 11.2–11.9). Echter Worker in workerd (Miniflare) – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';
import { GROUP_LIMITS } from '../../src/domain/limits';
import { STREAM_PAGE } from '../../src/domain/groups';

const DAY = 86_400_000;
let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const stream = async (p: Person, cursor?: string) => {
  const res = await s.send('GET', `/api/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, p.cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as StreamOut;
};
const groupStream = async (g: { id: string }, p?: Person) => {
  const res = await h.fetch(`/api/groups/${g.id}/stream`, { cookie: p?.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return { res, body: (await res.json()) as StreamOut };
};
const kinds = (o: StreamOut) => o.items.map((i) => i.kind);
const voyageIds = (o: StreamOut) => o.items.filter((i) => i.voyage).map((i) => i.voyage!.id);
const follow = (p: Person, kind: string, id: string) => s.send('PUT', `/api/follows/${kind}/${id}`, p.cookie);

// ---------------------------------------------------------------- F-158 Folgen

describe('F-158 Folgen', () => {
  it('[F-158] Profilen, Booten und Gruppen folgen; Zähler und isFollowing; entfolgen; sich selbst nicht', async () => {
    const a = await s.person({ profile: 'public' });
    const b = await s.person({ profile: 'public' });
    const boat = await s.boat(b);
    const g = await s.group(b);
    const r1 = await follow(a, 'user', b.handle!);
    expect(r1.status, await r1.clone().text()).toBe(200);
    expect(await r1.json()).toEqual({ followers: 1, following: 0, isFollowing: true });
    expect((await follow(a, 'user', b.handle!)).status).toBe(200); // doppelt zählt einmal
    expect((await follow(a, 'boat', boat.id)).status).toBe(200);
    expect((await follow(a, 'group', g.id)).status).toBe(200);
    const prof = (await (await s.send('GET', `/api/profiles/${b.handle}`, a.cookie)).json()) as { social: unknown };
    expect(prof.social).toEqual({ followers: 1, following: 0, isFollowing: true });
    const mine = (await (await s.send('GET', `/api/profiles/${a.handle}`, a.cookie)).json()) as { social: { following: number } };
    expect(mine.social.following).toBe(3);
    const bt = (await (await h.fetch(`/api/boats/${boat.id}`)).json()) as { social: unknown };
    expect(bt.social).toEqual({ followers: 1, isFollowing: false });
    const self = await follow(a, 'user', a.handle!);
    expect(self.status).toBe(400);
    const un = await s.send('DELETE', `/api/follows/user/${b.handle}`, a.cookie);
    expect(await un.json()).toEqual({ followers: 0, following: 0, isFollowing: false });
    expect((await follow(a, 'user', b.handle!)).status).toBe(200);
  });

  it('[F-158] nicht öffentliche, ausgeblendete und unbekannte Ziele → 404; ohne Anmeldung 401; gesperrt 403', async () => {
    const a = await s.person();
    const priv = await s.person({ profile: 'private', supporter: true });
    const boat = await s.boat(priv, { visibility: 'unlisted' });
    const g = await s.group(priv, { visibility: 'private' });
    expect((await follow(a, 'user', priv.handle!)).status).toBe(404);
    expect((await follow(a, 'boat', boat.id)).status).toBe(404);
    expect((await follow(a, 'group', g.id)).status).toBe(404);
    expect((await follow(a, 'user', 'gibt-es-nicht')).status).toBe(404);
    expect((await s.send('PUT', '/api/follows/share/AAAAAAAAAAAAAAAAAA', a.cookie)).status).toBe(404);
    expect((await s.send('PUT', `/api/follows/user/${priv.handle}`, undefined)).status).toBe(401);
    const pub = await s.person({ profile: 'public' });
    await (await s.db()).prepare('UPDATE profiles SET hidden_at = ? WHERE user_id = ?').bind(Date.now(), pub.user.id).run();
    expect((await follow(a, 'user', pub.handle!)).status).toBe(404);
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), a.user.id).run();
    const target = await s.person({ profile: 'public' });
    expect((await follow(a, 'user', target.handle!)).status).toBe(403);
  });

  it('[F-158] höchstens 1000 Folgen pro Konto (409 quota)', async () => {
    const a = await s.person();
    const db = await s.db();
    const now = Date.now();
    for (let i = 0; i < GROUP_LIMITS.follows; i += 100) {
      const values = Array.from({ length: 100 }, (_, k) => `('${a.user.id}', 'group', 'G${String(i + k).padStart(17, '0')}', ${now})`).join(',');
      await db.prepare(`INSERT INTO follows (user_id, target_kind, target_id, created_at) VALUES ${values}`).all();
    }
    const b = await s.person({ profile: 'public' });
    const res = await follow(a, 'user', b.handle!);
    expect(res.status).toBe(409);
    expect(await s.errorOf(res)).toBe('quota');
  });
});

// ---------------------------------------------------------------- F-159/F-160 Aktivitäts-Log und Neuigkeiten

describe('F-159/F-160 Neuigkeiten', () => {
  it('[F-159] öffentlicher Törn eines Vereinsboots: eine Aktivität, Ziele Segler, Boot, Verein (kein Fan-out pro Mitglied)', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    const members = [await s.person(), await s.person(), await s.person()];
    for (const m of members) await s.join(owner, g, m);
    const sailor = members[0];
    const boat = await s.boat(sailor, { name: 'Vereinsboot' });
    await s.send('POST', `/api/groups/${g.id}/boats`, sailor.cookie, { boatId: boat.id });
    const share = await s.share(sailor, { boatId: boat.id, title: 'Kieler Woche' });
    const db = await s.db();
    const acts = await db.prepare(`SELECT id FROM activity WHERE subject_kind = 'share' AND subject_id = ?`).bind(share.id).all<{ id: string }>();
    expect(acts.results).toHaveLength(1);
    const targets = await db.prepare('SELECT target_kind, target_id FROM activity_target WHERE activity_id = ? ORDER BY target_kind').bind(acts.results[0].id).all<{ target_kind: string; target_id: string }>();
    expect(targets.results).toEqual([
      { target_kind: 'boat', target_id: boat.id },
      { target_kind: 'group', target_id: g.id },
      { target_kind: 'user', target_id: sailor.user.id },
    ]);
    // Alle Mitglieder sehen ihn – über das eine Ziel „Verein“
    for (const m of [owner, ...members]) expect(voyageIds(await stream(m))).toContain(share.id);
    const gs = await groupStream(g);
    expect(gs.body.items.find((i) => i.voyage?.id === share.id)?.voyage?.boat).toEqual({ id: boat.id, name: 'Vereinsboot' });
  });

  it('[F-159/F-160] private und „Nur mit Link“-Törns kommen nie in die Neuigkeiten – auch nicht für Mitglieder (Mitgliedschaft öffnet nichts)', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner);
    const m = await s.person();
    await s.join(owner, g, m);
    const priv = await s.share(owner, { visibility: 'private' });
    const linked = await s.share(owner, { visibility: 'unlisted' });
    expect(voyageIds(await stream(m))).not.toContain(priv.id);
    expect(voyageIds(await stream(m))).not.toContain(linked.id);
    const n = await (await s.db()).prepare(`SELECT COUNT(*) AS n FROM activity WHERE subject_id IN (?, ?)`).bind(priv.id, linked.id).first<{ n: number }>();
    expect(n?.n).toBe(0);
    // Wechsel auf öffentlich: jetzt (einmal) protokolliert
    await s.send('PATCH', `/api/shares/${linked.id}`, owner.cookie, { visibility: 'public' });
    await s.send('PATCH', `/api/shares/${linked.id}`, owner.cookie, { visibility: 'unlisted' });
    await s.send('PATCH', `/api/shares/${linked.id}`, owner.cookie, { visibility: 'public' });
    expect(voyageIds(await stream(m)).filter((id) => id === linked.id)).toHaveLength(1);
  });

  it('[F-160] Sichtbarkeit wird beim Lesen geprüft: privat geschaltet, ausgeblendet, gelöscht, gesperrtes Konto → verschwindet', async () => {
    const owner = await s.person({ supporter: true, profile: 'public' });
    const g = await s.group(owner);
    const reader = await s.person();
    await s.join(owner, g, reader);
    const [a, b, c, d] = [await s.share(owner, { title: 'A' }), await s.share(owner, { title: 'B' }), await s.share(owner, { title: 'C' }), await s.share(owner, { title: 'D' })];
    expect(voyageIds(await stream(reader))).toEqual(expect.arrayContaining([a.id, b.id, c.id, d.id]));
    await s.send('PATCH', `/api/shares/${a.id}`, owner.cookie, { visibility: 'private' });
    await (await s.db()).prepare('UPDATE shares SET hidden_at = ? WHERE id = ?').bind(Date.now(), b.id).run();
    await s.send('DELETE', `/api/shares/${c.id}`, owner.cookie);
    const after = voyageIds(await stream(reader));
    expect(after).not.toContain(a.id);
    expect(after).not.toContain(b.id);
    expect(after).not.toContain(c.id);
    expect(after).toContain(d.id);
    // gelöscht: auch die Aktivität ist weg
    expect((await (await s.db()).prepare('SELECT COUNT(*) AS n FROM activity WHERE subject_id = ?').bind(c.id).first<{ n: number }>())?.n).toBe(0);
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), owner.user.id).run();
    expect(voyageIds(await stream(reader))).not.toContain(d.id);
  });

  it('[F-160] Namen nur mit öffentlichem Profil, Boot nur öffentlich; keine Konto-IDs und E-Mail-Adressen in der Antwort', async () => {
    const owner = await s.person({ supporter: true, profile: 'private' });
    const g = await s.group(owner);
    const boat = await s.boat(owner, { visibility: 'private' });
    await s.send('POST', `/api/groups/${g.id}/boats`, owner.cookie, { boatId: boat.id });
    const share = await s.share(owner, { boatId: boat.id });
    const { body, res } = await groupStream(g);
    const item = body.items.find((i) => i.voyage?.id === share.id)!;
    expect(item.actor).toBeNull();
    expect(item.voyage?.boat).toBeNull();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(owner.user.id);
    expect(raw).not.toContain(owner.email);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    // keine Bootsaktivität für ein privates Boot
    expect(kinds(body)).not.toContain('boat');
  });

  it('[F-160] Gefolgte Profile, Boote und Gruppen erscheinen im persönlichen Stream; Folgen eines dann privaten Profils öffnet nichts', async () => {
    const reader = await s.person();
    const sailor = await s.person({ profile: 'public', supporter: true });
    const boatOwner = await s.person({ profile: 'public' });
    const boat = await s.boat(boatOwner);
    const club = await s.group(boatOwner);
    await follow(reader, 'user', sailor.handle!);
    await follow(reader, 'boat', boat.id);
    await follow(reader, 'group', club.id);
    const v1 = await s.share(sailor, { title: 'Gefolgter Segler' });
    const v2 = await s.share(boatOwner, { title: 'Gefolgtes Boot', boatId: boat.id });
    const post = await s.send('POST', `/api/groups/${club.id}/posts`, boatOwner.cookie, { body: 'Hallo Follower' });
    expect(post.status).toBe(201);
    const st = await stream(reader);
    expect(voyageIds(st)).toEqual(expect.arrayContaining([v1.id, v2.id]));
    expect(st.items.find((i) => i.kind === 'post')?.post?.body).toBe('Hallo Follower');
    expect(st.hasGroups).toBe(false);
    // Gruppe wird geschlossen: Follower (kein Mitglied) sehen ihre Beiträge nicht mehr
    await s.send('PATCH', `/api/groups/${club.id}`, boatOwner.cookie, { visibility: 'public', name: 'Club' });
    await (await s.db()).prepare(`UPDATE groups SET visibility = 'private' WHERE id = ?`).bind(club.id).run();
    expect(kinds(await stream(reader))).not.toContain('post');
  });

  it('[F-160] Cursor-Paginierung: 20 pro Seite, neueste zuerst, ohne Doppelte, Ende mit cursor null; kaputter Cursor 400', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner);
    const db = await s.db();
    const now = Date.now();
    // 45 Beiträge direkt ins Log (die Tagesgrenze für Beiträge gilt über die API)
    for (let i = 0; i < 45; i++) {
      const id = `P${String(i).padStart(17, '0')}${g.id.slice(0, 4)}`;
      const aid = `A${String(i).padStart(17, '0')}${g.id.slice(0, 4)}`;
      await db.prepare('INSERT INTO posts (id, author_id, group_id, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, owner.user.id, g.id, `Beitrag ${i}`, now - i * 1000).run();
      await db.prepare(`INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, group_id, data, created_at, updated_at) VALUES (?, 'post', ?, 'post', ?, ?, '{}', ?, ?)`)
        .bind(aid, owner.user.id, id, g.id, now - i * 1000, now - i * 1000).run();
      await db.prepare(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES (?, 'group', ?, ?)`).bind(aid, g.id, now - i * 1000).run();
    }
    // jeder dritte Beitrag ist ausgeblendet → wird beim Lesen aussortiert, Seiten bleiben trotzdem voll
    await db.prepare(`UPDATE posts SET hidden_at = 1 WHERE group_id = ? AND CAST(substr(id, 2, 17) AS INTEGER) % 3 = 2`).bind(g.id).run();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const p = await stream(owner, cursor);
      pages++;
      seen.push(...p.items.map((i) => i.post!.body));
      if (!p.cursor) break;
      expect(p.items.length).toBe(STREAM_PAGE);
      cursor = p.cursor;
    }
    expect(pages).toBe(2);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect(seen[0]).toBe('Beitrag 0');
    expect(seen).not.toContain('Beitrag 2');
    expect((await s.send('GET', '/api/stream?cursor=kaputt', owner.cookie)).status).toBe(400);
    expect((await s.send('GET', '/api/stream', undefined)).status).toBe(401);
  });

  it('[F-160] öffentlicher Gruppen-Stream ist 60 s gecacht (für Besucher), Verwalter und geschlossene Gruppen nie', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner);
    const first = await groupStream(g);
    expect(first.res.headers.get('X-Stream-Cache')).toBe('miss');
    await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'Neu nach dem Cache' });
    const second = await groupStream(g);
    expect(second.res.headers.get('X-Stream-Cache')).toBe('hit');
    expect(kinds(second.body)).not.toContain('post'); // höchstens 60 s alt
    const admin = await groupStream(g, owner);
    expect(admin.res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(admin.body.items.find((i) => i.kind === 'post')?.post?.canDelete).toBe(true);
    const closed = await s.group(owner, { visibility: 'private' });
    expect((await h.fetch(`/api/groups/${closed.id}/stream`)).status).toBe(404);
    const m = await s.person();
    await s.join(owner, closed, m);
    const ms = await groupStream(closed, m);
    expect(ms.res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(kinds(ms.body)).toContain('member');
  });

  it('[F-159] Fotos werden je Törn und Tag gebündelt; ohne öffentliche Fotos verschwindet das Bündel', async () => {
    const owner = await s.person({ supporter: true, profile: 'public' });
    const share = await s.share(owner);
    const db = await s.db();
    // Uploads simulieren wie recordPhotos (die Bildprüfung testet photos.test.ts)
    const now = Date.now();
    for (const pid of ['PhotoAAAAAAAAAAAA1', 'PhotoAAAAAAAAAAAA2']) {
      await db.prepare(`INSERT INTO photos (id, share_id, user_id, width, height, bytes, created_at) VALUES (?, ?, ?, 10, 10, 100, ?)`).bind(pid + share.id.slice(0, 2), share.id, owner.user.id, now).run();
    }
    const day = new Date(now).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, data, bucket, created_at, updated_at) VALUES (?, 'photos', ?, 'share', ?, '{"count":2}', ?, ?, ?)`)
      .bind(`PB${share.id}`.slice(0, 20), owner.user.id, share.id, `photos:${share.id}:${day}`, now, now).run();
    await db.prepare(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES (?, 'user', ?, ?)`).bind(`PB${share.id}`.slice(0, 20), owner.user.id, now).run();
    const st = await stream(owner);
    const item = st.items.find((i) => i.kind === 'photos')!;
    expect(item.photos?.count).toBe(2);
    expect(item.photos?.thumbs).toHaveLength(2);
    await db.prepare(`UPDATE photos SET visibility = 'private' WHERE share_id = ?`).bind(share.id).run();
    expect(kinds(await stream(owner))).not.toContain('photos');
  });

  it('[F-159] neues Mitglied und neues Boot erscheinen in der Gruppe; Mitglied ohne öffentliches Profil ohne Namen', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    const anon = await s.person();
    await s.join(owner, g, anon);
    const boat = await s.boat(anon, { name: 'Neuzugang' });
    await s.send('POST', `/api/groups/${g.id}/boats`, anon.cookie, { boatId: boat.id });
    const { body } = await groupStream(g, owner);
    const member = body.items.find((i) => i.kind === 'member')!;
    expect(member.actor).toBeNull();
    expect(member.group?.slug).toBe(g.slug);
    expect(body.items.find((i) => i.kind === 'boat')?.boat).toEqual({ id: boat.id, name: 'Neuzugang' });
  });
});

// ---------------------------------------------------------------- F-161 Beiträge, F-162 RSS

describe('F-161/F-162 Beiträge und RSS', () => {
  it('[F-161] Admins posten (bereinigt, Link optional); Mitglieder 403; Grenzen Länge, Links, Link-Form; 5 pro Tag (429, zählt auch gelöschte)', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const m = await s.person();
    await s.join(owner, g, m);
    expect((await s.send('POST', `/api/groups/${g.id}/posts`, m.cookie, { body: 'Ich bin nur Mitglied' })).status).toBe(403);
    expect((await s.send('POST', `/api/groups/${g.id}/posts`, (await s.person()).cookie, { body: 'Fremd' })).status).toBe(403);
    expect((await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: '   ' })).status).toBe(400);
    expect((await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'x'.repeat(2001) })).status).toBe(400);
    const links = Array.from({ length: 6 }, (_, i) => `https://example.org/${i}`).join(' ');
    expect(await s.errorOf(await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: links }))).toBe('too_many_links');
    expect(await s.errorOf(await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'ok', link: 'javascript:alert(1)' }))).toBe('invalid_link');
    const ok = await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'Absegeln​ am\tSamstag\n\n\n\n\nab 10 Uhr', link: 'https://example.org/termine' });
    expect(ok.status).toBe(201);
    const { post } = (await ok.json()) as { post: { id: string; body: string; link: string } };
    expect(post.body).toBe('Absegeln am Samstag\n\n\n\nab 10 Uhr');
    expect(post.link).toBe('https://example.org/termine');
    expect((await s.send('DELETE', `/api/posts/${post.id}`, owner.cookie)).status).toBe(204);
    for (let i = 0; i < GROUP_LIMITS.postsPerDay - 1; i++) expect((await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: `Nr. ${i}` })).status).toBe(201);
    const over = await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'zu viel' });
    expect(over.status).toBe(429);
    expect(await s.errorOf(over)).toBe('post_quota');
  });

  it('[F-161] Vereinsbeiträge erscheinen auch in den Teams; Löschen durch Autor:in oder Admins, sonst 404', async () => {
    const owner = await s.person({ supporter: true });
    const club = await s.group(owner);
    const team = await s.group(owner, { kind: 'team', parentId: club.id });
    const res = await s.send('POST', `/api/groups/${club.id}/posts`, owner.cookie, { body: 'Sommerfest!' });
    const { post } = (await res.json()) as { post: { id: string } };
    expect((await groupStream(team, owner)).body.items.find((i) => i.kind === 'post')?.post?.body).toBe('Sommerfest!');
    const m = await s.person();
    await s.join(owner, club, m);
    expect((await s.send('DELETE', `/api/posts/${post.id}`, m.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/posts/${post.id}`, owner.cookie)).status).toBe(204);
    expect(kinds((await groupStream(team, owner)).body)).not.toContain('post');
  });

  it('[F-157] Beiträge melden: „Ich bin genannt“ blendet sofort aus; der Beitrag verschwindet aus dem Stream', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const res = await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'Über jemanden' });
    const { post } = (await res.json()) as { post: { id: string } };
    const reporter = await s.person();
    const r = await s.send('POST', '/api/reports', reporter.cookie, { kind: 'post', id: post.id, reason: 'depicted' });
    expect(r.status, await r.clone().text()).toBe(201);
    expect(kinds((await groupStream(g, owner)).body)).not.toContain('post');
  });

  it('[F-162] Atom-Feed öffentlicher Gruppen: escaped, gültige Struktur, gecacht; geschlossene und unbekannte 404', async () => {
    const owner = await s.person({ supporter: true, profile: 'public' });
    const g = await s.group(owner, { name: 'Club <&> "Möwe"', description: "Wir & ihr <script>alert('x')</script>" });
    await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: '<b>Fett</b> & ]]> \u0001 Ende', link: 'https://example.org/?a=1&b=2' });
    const res = await h.fetch(`/g/${g.slug}/feed.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/atom+xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
    const xml = await res.text();
    expect(xml).toContain('<title>Club &lt;&amp;&gt; &quot;Möwe&quot; · Sail Explorer</title>');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toContain('<script>');
    expect(xml).not.toContain('<b>');
    expect(xml).toContain('&lt;b&gt;Fett&lt;/b&gt; &amp; ]]&gt; Ende');
    expect(xml).toContain('https://example.org/?a=1&amp;b=2');
    expect(xml).not.toContain('\u0001');
    expect(xml.match(/<entry>/g)?.length).toBe(xml.match(/<\/entry>/g)?.length);
    const closed = await s.group(owner, { visibility: 'private' });
    expect((await h.fetch(`/g/${closed.slug}/feed.xml`)).status).toBe(404);
    expect((await h.fetch('/g/gibt-es-nicht/feed.xml')).status).toBe(404);
  });
});

// ---------------------------------------------------------------- F-166 Meilensteine

describe('F-166 Meilensteine', () => {
  it('[F-166] 100 sm in der Saison: je einmal für Segler, Boot und Gruppe; sichtbar nur bei öffentlichem Profil/Boot', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    const boat = await s.boat(owner, { name: 'Meilenboot' });
    await s.send('POST', `/api/groups/${g.id}/boats`, owner.cookie, { boatId: boat.id });
    await s.share(owner, { distNm: 60, boatId: boat.id });
    expect(kinds(await stream(owner))).not.toContain('milestone');
    await s.share(owner, { distNm: 50, boatId: boat.id });
    await s.share(owner, { distNm: 10, boatId: boat.id });
    const ms = (await stream(owner)).items.filter((i) => i.kind === 'milestone');
    expect(ms.map((m) => m.milestone!.subject).sort()).toEqual(['boat', 'group', 'user']);
    expect(ms.every((m) => m.milestone!.nm === 100 && m.milestone!.year === new Date().getUTCFullYear())).toBe(true);
    expect(ms.find((m) => m.milestone!.subject === 'user')?.milestone?.path).toBe(`/u/${owner.handle}`);
    // Törns aus einer früheren Saison erzeugen keine Meilensteine
    const old = await s.person({ profile: 'public' });
    await s.share(old, { distNm: 600, startedAt: Date.UTC(new Date().getUTCFullYear() - 1, 5, 1) });
    expect(kinds(await stream(old))).not.toContain('milestone');
    // Profil nicht mehr öffentlich → Meilenstein des Seglers verschwindet
    await (await s.db()).prepare(`UPDATE profiles SET visibility = 'private' WHERE user_id = ?`).bind(owner.user.id).run();
    expect((await stream(owner)).items.filter((i) => i.kind === 'milestone').map((m) => m.milestone!.subject).sort()).toEqual(['boat', 'group']);
  });
});

// ---------------------------------------------------------------- F-164 Vorschläge

describe('F-164 Leute, die du kennen könntest', () => {
  it('[F-164] Gruppenmitglieder, Crew und Heimathafen – nur öffentliche Profile, ohne mich und Gefolgte, höchstens 6, mit Grund', async () => {
    const me = await s.person({ profile: 'public' });
    const g = await s.group(me);
    const clubmate = await s.person({ profile: 'public' });
    const hidden = await s.person({ profile: 'private' });
    const followed = await s.person({ profile: 'public' });
    for (const p of [clubmate, hidden, followed]) await s.join(me, g, p);
    await follow(me, 'user', followed.handle!);
    const skipper = await s.person({ profile: 'public' });
    const share = await s.share(skipper);
    await (await s.db()).prepare('INSERT INTO share_crew (share_id, user_id, created_at) VALUES (?, ?, ?)').bind(share.id, me.user.id, Date.now()).run();
    const port = `Hafen-${s.uniq('p')}`;
    await s.boat(me, { homePort: port });
    const neighbour = await s.person({ profile: 'public' });
    await s.boat(neighbour, { homePort: port.toUpperCase() });
    const res = await s.send('GET', '/api/me/suggestions', me.cookie);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    const { people } = (await res.json()) as { people: Array<{ handle: string; reason: string; reasonText: string }> };
    const by = Object.fromEntries(people.map((p) => [p.handle, p]));
    expect(by[clubmate.handle!]?.reasonText).toBe('Im selben Verein');
    expect(by[skipper.handle!]?.reasonText).toBe('Mit dir gesegelt');
    expect(by[neighbour.handle!]?.reasonText).toBe(`Heimathafen ${port.toUpperCase()}`);
    expect(by[hidden.handle!]).toBeUndefined();
    expect(by[followed.handle!]).toBeUndefined();
    expect(by[me.handle!]).toBeUndefined();
    expect(people.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(people)).not.toMatch(/@example\.org/);
  });
});

// ---------------------------------------------------------------- F-165 Sammelmail

describe('F-165 Wöchentliche Sammelmail', () => {
  it('[F-165] einschalten zählt ab jetzt; fällig: eine Mail mit Anzahlen je Gruppe, ohne Texte und Namen, nicht doppelt', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { name: 'Digest <Club>' });
    const reader = await s.person();
    await s.join(owner, g, reader);
    const set = await s.send('PATCH', '/api/me/settings', reader.cookie, { notifyGroups: 'weekly' });
    expect(((await set.json()) as { notifyGroups: string }).notifyGroups).toBe('weekly');
    expect((await s.send('PATCH', '/api/me/settings', reader.cookie, { notifyGroups: 'daily' })).status).toBe(400);
    await s.share(owner, { title: 'Geheimer Titel' });
    await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'Beitragstext darf nicht in die Mail' });
    // als wäre die letzte Mail über eine Woche her
    await (await s.db()).prepare('UPDATE users SET groups_mailed_at = ? WHERE id = ?').bind(Date.now() - 8 * DAY, reader.user.id).run();
    const before = h.logs.length;
    await h.scheduled();
    const mails = h.logs.slice(before).filter((l) => l.includes(`an ${reader.email}:`));
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain('Was war los in deinem Verein');
    expect(mails[0]).toContain('Digest <Club>: 1 neuer Törn, 1 Beitrag');
    expect(mails[0]).not.toContain('Geheimer Titel');
    expect(mails[0]).not.toContain('Beitragstext');
    expect(mails[0]).not.toContain(owner.handle!);
    const again = h.logs.length;
    await h.scheduled();
    expect(h.logs.slice(again).filter((l) => l.includes(`an ${reader.email}:`))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- F-167 Aufräumen

describe('F-167 Aufräumen', () => {
  it('[F-167] Konto löschen: Gruppe geht an den dienstältesten Admin; ohne Admin gelöscht; Folgen, Beiträge, Aktivitäten weg', async () => {
    const owner = await s.person({ profile: 'public' });
    const kept = await s.group(owner);
    const gone = await s.group(owner, {}).catch(() => null); // kostenlos nur eine – zweite über Unterstützer
    expect(gone).toBeNull();
    const supOwner = await s.person({ supporter: true, profile: 'public' });
    const g1 = await s.group(supOwner);
    const g2 = await s.group(supOwner);
    const [a1, a2] = [await s.person(), await s.person()];
    await s.join(supOwner, g1, a1);
    await s.join(supOwner, g1, a2);
    await s.send('PATCH', `/api/groups/${g1.id}/members/${a1.user.id}`, supOwner.cookie, { role: 'admin' });
    await s.send('PATCH', `/api/groups/${g1.id}/members/${a2.user.id}`, supOwner.cookie, { role: 'admin' });
    await s.send('POST', `/api/groups/${g1.id}/posts`, supOwner.cookie, { body: 'Abschied' });
    await s.share(supOwner);
    const fan = await s.person();
    await follow(fan, 'user', supOwner.handle!);
    await follow(supOwner, 'group', kept.id);
    expect((await s.send('DELETE', '/api/account', supOwner.cookie)).status).toBe(200);
    const db = await s.db();
    const g1row = await db.prepare('SELECT owner_id FROM groups WHERE id = ?').bind(g1.id).first<{ owner_id: string }>();
    expect(g1row?.owner_id).toBe(a1.user.id);
    expect((await db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').bind(g1.id, a1.user.id).first<{ role: string }>())?.role).toBe('owner');
    expect(await db.prepare('SELECT id FROM groups WHERE id = ?').bind(g2.id).first()).toBeNull();
    const left = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM follows WHERE user_id = ?1 OR target_id = ?1) AS f, (SELECT COUNT(*) FROM posts WHERE author_id = ?1) AS p,
         (SELECT COUNT(*) FROM activity WHERE actor_id = ?1) AS a, (SELECT COUNT(*) FROM group_members WHERE user_id = ?1) AS m,
         (SELECT COUNT(*) FROM activity_target WHERE target_kind = 'group' AND target_id = ?2) AS t`,
    ).bind(supOwner.user.id, g2.id).first<Record<string, number>>();
    expect(left).toEqual({ f: 0, p: 0, a: 0, m: 0, t: 0 });
    // Die übernommene Gruppe funktioniert weiter
    expect((await s.send('PATCH', `/api/groups/${g1.id}`, a1.cookie, { visibility: 'public' })).status).toBe(200);
  });

  it('[F-167] Boot löschen entfernt Zuordnungen, Folgen und Aktivitäten des Boots; Gruppe löschen alles der Gruppe', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const g = await s.group(owner);
    const boat = await s.boat(owner);
    await s.send('POST', `/api/groups/${g.id}/boats`, owner.cookie, { boatId: boat.id });
    const fan = await s.person();
    await follow(fan, 'boat', boat.id);
    await follow(fan, 'group', g.id);
    await s.send('DELETE', `/api/boats/${boat.id}`, owner.cookie);
    const db = await s.db();
    const b = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM group_boats WHERE boat_id = ?1) AS gb, (SELECT COUNT(*) FROM follows WHERE target_id = ?1) AS f,
         (SELECT COUNT(*) FROM activity WHERE subject_id = ?1) AS a, (SELECT COUNT(*) FROM activity_target WHERE target_id = ?1) AS t`,
    ).bind(boat.id).first<Record<string, number>>();
    expect(b).toEqual({ gb: 0, f: 0, a: 0, t: 0 });
    await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body: 'Letzter Beitrag' });
    await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, {});
    expect((await s.send('DELETE', `/api/groups/${g.id}`, owner.cookie)).status).toBe(204);
    const rest = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM posts WHERE group_id = ?1) AS p, (SELECT COUNT(*) FROM activity WHERE group_id = ?1) AS a,
         (SELECT COUNT(*) FROM activity_target WHERE target_id = ?1) AS t, (SELECT COUNT(*) FROM follows WHERE target_id = ?1) AS f,
         (SELECT COUNT(*) FROM invites WHERE group_id = ?1) AS i, (SELECT COUNT(*) FROM group_members WHERE group_id = ?1) AS m`,
    ).bind(g.id).first<Record<string, number>>();
    expect(rest).toEqual({ p: 0, a: 0, t: 0, f: 0, i: 0, m: 0 });
  });

  it('[F-167] nächtlich: Aktivitäten älter als 12 Monate, verwaiste Ziele und Folgen, alte Anfragen', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    const db = await s.db();
    await db.prepare('UPDATE activity SET created_at = ? WHERE subject_id = ?').bind(Date.now() - 400 * DAY, share.id).run();
    await db.prepare(`INSERT INTO follows (user_id, target_kind, target_id, created_at) VALUES (?, 'group', 'GoneGroup000000000', ?)`).bind(owner.user.id, Date.now()).run();
    await db.prepare(`INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, data, created_at, updated_at) VALUES ('OrphanActivity0001', 'member', NULL, 'group', 'GoneGroup000000000', '{}', ?, ?)`).bind(Date.now(), Date.now()).run();
    await db.prepare(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES ('OrphanActivity0001', 'group', 'GoneGroup000000000', ?)`).bind(Date.now()).run();
    const g = await s.group(await s.person());
    const req = await s.person();
    await s.send('POST', `/api/groups/${g.id}/requests`, req.cookie, {});
    await db.prepare('UPDATE group_requests SET created_at = ? WHERE user_id = ?').bind(Date.now() - 91 * DAY, req.user.id).run();
    await h.scheduled();
    const rest = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM activity WHERE subject_id = ?1) AS old, (SELECT COUNT(*) FROM follows WHERE target_id = 'GoneGroup000000000') AS f,
         (SELECT COUNT(*) FROM activity WHERE id = 'OrphanActivity0001') AS o, (SELECT COUNT(*) FROM group_requests WHERE user_id = ?2) AS r`,
    ).bind(share.id, req.user.id).first<Record<string, number>>();
    expect(rest).toEqual({ old: 0, f: 0, o: 0, r: 0 });
  });
});
