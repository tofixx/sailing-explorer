// Funktionale Tests: Umfragen (Konzept 29, Phase 4) – Anlegen über „+ Neu“ (F-470), Abstimmen (F-471), Ende (F-472),
// wer das Ergebnis sieht (F-473), namentlich (F-474), Cache (F-475), Benachrichtigungen (F-476) und Löschwege (F-477).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type GroupOut, type Person } from './social-helpers';
import type { PollView } from '../../src/domain/polls';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminPollsAAAAAAAA1';
let h: Harness;
let s: ReturnType<typeof social>;
let admin: { cookie: string };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'polls-admin@example.org', Date.now() - 10 * DAY).run();
  admin = await login(h, 'polls-admin@example.org');
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const run = async (sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).run();
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};
const votes = async (postId: string) => (await one<{ n: number }>('SELECT COUNT(*) AS n FROM poll_votes WHERE post_id = ?', postId))!.n;

type StreamPoll = { items: Array<{ kind: string; post?: { id: string; body: string; link: string | null; poll?: PollView } }> };

/** Umfrage über den Plus-Knopf (POST /api/posts, `kind: 'poll'`). */
async function poll(author: Person, channel: { kind: string; id?: string }, o: Record<string, unknown> = {}, status = 201) {
  const { visibility, reach, question, ...cfg } = o;
  const res = await s.send('POST', '/api/posts', author.cookie, {
    channel: { id: '', ...channel },
    kind: 'poll',
    body: question ?? 'Wer segelt Mittwoch?',
    visibility: visibility ?? 'public',
    ...(reach ? { reach } : {}),
    poll: { options: ['Ja', 'Nein', 'Vielleicht'], ...cfg },
  });
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 201 ? ((await res.json()) as { post: { id: string; kind: string } }).post : null;
}
const vote = (p: Person | null, id: string, choices: unknown, headers: Record<string, string> = {}) => s.send('PUT', `/api/posts/${id}/vote`, p?.cookie, { choices }, headers);

/** Verein mit Eigner und Mitglied (öffentlich). */
async function club(): Promise<{ owner: Person; member: Person; g: GroupOut }> {
  const owner = await s.person({ profile: 'public' });
  const member = await s.person({ profile: 'public' });
  const g = await s.group(owner, { visibility: 'public' });
  await s.join(owner, g, member);
  return { owner, member, g };
}
const cardIn = (st: StreamPoll, id: string) => st.items.find((i) => i.post?.id === id)?.post;

describe('F-470 Umfrage anlegen', () => {
  it('[F-407] [F-470] über POST /api/posts mit Art „poll“: Frage im Text, Einstellungen geprüft, Link und Anhang gibt es nicht', async () => {
    const { owner, g } = await club();
    const res = await s.send('POST', '/api/posts', owner.cookie, {
      channel: { kind: 'group', id: g.id }, kind: 'poll', body: 'Grillen am Samstag?', visibility: 'public', link: 'https://example.org',
      poll: { options: [' Ja ', 'Nein'], max: 1, results: 'always', named: true },
    });
    const { post } = await ok<{ post: { id: string; kind: string } }>(res, 201);
    expect(post.kind).toBe('poll');
    const row = await one<{ kind: string; body: string; link: string | null; data: string }>('SELECT kind, body, link, data FROM posts WHERE id = ?', post.id);
    expect(row).toMatchObject({ kind: 'poll', body: 'Grillen am Samstag?', link: null });
    expect(JSON.parse(row!.data)).toEqual({ poll: { options: ['Ja', 'Nein'], max: 1, closesAt: null, results: 'always', named: true } });
    // zählt in post_log wie Text-Beiträge
    expect((await one<{ n: number }>('SELECT COUNT(*) AS n FROM post_log WHERE group_id = ?', g.id))!.n).toBe(1);
  });

  it('[F-470] Grenzen: 2–10 verschiedene Antworten ≤ 100 Zeichen, Frage ≤ 300, Mehrfachauswahl ≤ Antworten, Ende ≤ 90 Tage, unbekannte Art 400', async () => {
    const me = await s.person({ profile: 'public' });
    const err = async (body: Record<string, unknown>) => s.errorOf(await s.send('POST', '/api/posts', me.cookie, { channel: { kind: 'user', id: '' }, kind: 'poll', body: 'Frage?', poll: { options: ['a', 'b'] }, ...body }));
    expect(await err({ poll: { options: ['nur eine'] } })).toBe('invalid_options');
    expect(await err({ poll: { options: Array.from({ length: 11 }, (_, i) => `A${i}`) } })).toBe('invalid_options');
    expect(await err({ poll: { options: ['x'.repeat(101), 'b'] } })).toBe('invalid_options');
    expect(await err({ poll: { options: ['Ja', 'ja'] } })).toBe('invalid_options');
    expect(await err({ poll: { options: ['a', ''] } })).toBe('invalid_options');
    expect(await err({ poll: { options: ['a', 'b'], max: 3 } })).toBe('invalid_max');
    expect(await err({ poll: { options: ['a', 'b'], closesAt: Date.now() - 1000 } })).toBe('invalid_closes_at');
    expect(await err({ poll: { options: ['a', 'b'], closesAt: Date.now() + 91 * DAY } })).toBe('invalid_closes_at');
    expect(await err({ poll: { options: ['a', 'b'], results: 'nie' } })).toBe('invalid_results');
    expect(await err({ body: 'x'.repeat(301) })).toBe('too_long');
    expect(await err({ kind: 'umfrage' })).toBe('invalid_kind');
    expect(await err({ kind: 'voyage' })).toBe('invalid_kind');
    await poll(me, { kind: 'user' }, { options: ['a', 'b', 'c'], max: 2, closesAt: Date.now() + 89 * DAY });
  });
});

describe('F-471 Abstimmen', () => {
  it('[F-471] setzen, ändern, zurücknehmen; Mehrfachauswahl höchstens n; ungültige Wahl 400; Gast 401', async () => {
    const { owner, member, g } = await club();
    const p = await poll(owner, { kind: 'group', id: g.id }, { options: ['a', 'b', 'c'], max: 2 });
    let r = await ok<{ poll: PollView }>(await vote(member, p!.id, [2, 0]));
    expect(r.poll.mine).toEqual([0, 2]);
    expect(r.poll.counts).toEqual([1, 0, 1]);
    expect(r.poll.voters).toBe(1);
    r = await ok<{ poll: PollView }>(await vote(member, p!.id, [1]));
    expect(r.poll.counts).toEqual([0, 1, 0]);
    expect(await s.errorOf(await vote(member, p!.id, [0, 1, 2]))).toBe('invalid_choices');
    expect(await s.errorOf(await vote(member, p!.id, [3]))).toBe('invalid_choices');
    expect(await s.errorOf(await vote(member, p!.id, [1, 1]))).toBe('invalid_choices');
    expect(await s.errorOf(await vote(member, p!.id, 'a'))).toBe('invalid_choices');
    r = await ok<{ poll: PollView }>(await vote(member, p!.id, []));
    expect(r.poll.mine).toEqual([]);
    expect(await votes(p!.id)).toBe(0);
    expect((await vote(null, p!.id, [0])).status).toBe(401);
  });

  it('[F-471] nur wer die Umfrage sehen darf: „Nur Mitglieder“ für andere 404; ein Text-Beitrag ist keine Umfrage (404)', async () => {
    const { owner, member, g } = await club();
    const p = await poll(owner, { kind: 'group', id: g.id }, { visibility: 'members' });
    const stranger = await s.person({ profile: 'public' });
    expect((await vote(stranger, p!.id, [0])).status).toBe(404);
    expect((await vote(member, p!.id, [0])).status).toBe(200);
    const text = await ok<{ post: { id: string } }>(await s.send('POST', '/api/posts', owner.cookie, { channel: { kind: 'group', id: g.id }, body: 'Nur Text', visibility: 'public' }), 201);
    expect((await vote(member, text.post.id, [0])).status).toBe(404);
  });

  it('[F-471] höchstens 1000 Teilnehmende – atomar; wer schon abgestimmt hat, ändert weiter', async () => {
    const { owner, member, g } = await club();
    const p = await poll(owner, { kind: 'group', id: g.id });
    await ok(await vote(member, p!.id, [0]));
    const now = Date.now();
    // 999 weitere Konten mit Stimme (direkt in der DB)
    await run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 999)
       INSERT INTO users (id, email, created_at) SELECT 'PollFill' || printf('%06d', i) || ?1, 'pf' || i || ?1 || '@example.org', ?2 FROM n`,
      p!.id.slice(0, 8), now,
    );
    await run(`INSERT INTO poll_votes (post_id, user_id, choice, created_at) SELECT ?1, id, 1, ?2 FROM users WHERE id LIKE 'PollFill%' || ?3`, p!.id, now, p!.id.slice(0, 8));
    expect(await votes(p!.id)).toBe(1000);
    const late = await s.person();
    await s.join(owner, g, late);
    expect(await s.errorOf(await vote(late, p!.id, [0]))).toBe('poll_full');
    expect(await votes(p!.id)).toBe(1000);
    const r = await ok<{ poll: PollView }>(await vote(member, p!.id, [2]));
    expect(r.poll.mine).toEqual([2]);
  });

  it('[F-471] Tagesgrenze gemeinsam mit Reaktionen (429)', async () => {
    const { owner, member, g } = await club();
    const p = await poll(owner, { kind: 'group', id: g.id });
    await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300) INSERT INTO reaction_log (user_id, created_at) SELECT ?1, ?2 FROM n`, member.user.id, Date.now());
    expect(await s.errorOf(await vote(member, p!.id, [0]))).toBe('reaction_quota');
  });
});

describe('F-472 Ende', () => {
  it('[F-472] nach dem Ende kein Abstimmen und kein Zurücknehmen (409); die Stimmen bleiben', async () => {
    const { owner, member, g } = await club();
    const p = await poll(owner, { kind: 'group', id: g.id }, { closesAt: Date.now() + DAY });
    await ok(await vote(member, p!.id, [1]));
    await run(`UPDATE posts SET data = json_set(data, '$.poll.closesAt', ?) WHERE id = ?`, Date.now() - 1000, p!.id);
    expect(await s.errorOf(await vote(member, p!.id, [0]))).toBe('poll_closed');
    expect(await s.errorOf(await vote(member, p!.id, []))).toBe('poll_closed');
    expect(await votes(p!.id)).toBe(1);
  });

  it('[F-472] die Autor:in beendet vorzeitig; andere 404, zweimal 409', async () => {
    const { owner, member, g } = await club();
    const p = await poll(owner, { kind: 'group', id: g.id });
    expect((await s.send('POST', `/api/posts/${p!.id}/close`, member.cookie)).status).toBe(404);
    const r = await ok<{ poll: PollView }>(await s.send('POST', `/api/posts/${p!.id}/close`, owner.cookie));
    expect(r.poll.open).toBe(false);
    expect(r.poll.canClose).toBe(false);
    expect(await s.errorOf(await s.send('POST', `/api/posts/${p!.id}/close`, owner.cookie))).toBe('poll_closed');
    expect(await s.errorOf(await vote(member, p!.id, [0]))).toBe('poll_closed');
  });
});

describe('F-473 Wer sieht das Ergebnis', () => {
  it('[F-473] „nach eigener Stimme“: erst nach der Stimme; Autor:in immer; nach dem Ende alle', async () => {
    const { owner, member, g } = await club();
    const other = await s.person({ profile: 'public' });
    await s.join(owner, g, other);
    const p = await poll(owner, { kind: 'group', id: g.id });
    await ok(await vote(member, p!.id, [0]));
    const view = async (who: Person | undefined) => (await ok<{ poll: PollView }>(await s.send('GET', `/api/posts/${p!.id}/poll`, who?.cookie))).poll;
    expect((await view(other)).counts).toBeNull();
    expect((await view(undefined)).counts).toBeNull();
    expect((await view(owner)).counts).toEqual([1, 0, 0]);
    expect((await view(owner)).canClose).toBe(true);
    expect((await view(member)).counts).toEqual([1, 0, 0]);
    await ok(await s.send('POST', `/api/posts/${p!.id}/close`, owner.cookie));
    expect((await view(undefined)).counts).toEqual([1, 0, 0]);
  });

  it('[F-473] „immer“ für alle, „erst nach Ende“ auch nach eigener Stimme nicht; gesperrte Konten zählen nicht', async () => {
    const { owner, member, g } = await club();
    const always = await poll(owner, { kind: 'group', id: g.id }, { results: 'always' });
    const late = await poll(owner, { kind: 'group', id: g.id }, { results: 'closed' });
    await ok(await vote(member, always!.id, [2]));
    expect((await ok<{ poll: PollView }>(await s.send('GET', `/api/posts/${always!.id}/poll`, undefined))).poll.counts).toEqual([0, 0, 1]);
    expect((await ok<{ poll: PollView }>(await vote(member, late!.id, [0]))).poll.counts).toBeNull();
    await run('UPDATE users SET suspended_at = ? WHERE id = ?', Date.now(), member.user.id);
    expect((await ok<{ poll: PollView }>(await s.send('GET', `/api/posts/${always!.id}/poll`, undefined))).poll).toMatchObject({ counts: [0, 0, 0], voters: 0 });
  });
});

describe('F-474 Namentlich', () => {
  it('[F-474] Namen nur öffentlicher Profile, Rest als Anzahl; anonym nie Namen – auch nicht für die Autor:in', async () => {
    const { owner, member, g } = await club();
    const hidden = await s.person();
    await s.join(owner, g, hidden);
    const named = await poll(owner, { kind: 'group', id: g.id }, { named: true });
    const anon = await poll(owner, { kind: 'group', id: g.id });
    for (const p of [named!, anon!]) for (const who of [member, hidden]) await ok(await vote(who, p.id, [0]));
    const out = await ok<{ people: Array<{ people: Array<{ handle: string }>; others: number }> | null }>(await s.send('GET', `/api/posts/${named!.id}/poll`, owner.cookie));
    expect(out.people![0].people.map((x) => x.handle)).toEqual([member.handle]);
    expect(out.people![0].others).toBe(1);
    expect(JSON.stringify(out)).not.toContain(member.user.id);
    expect((await ok<{ people: unknown }>(await s.send('GET', `/api/posts/${anon!.id}/poll`, owner.cookie))).people).toBeNull();
    // wer das Ergebnis (noch) nicht sieht, sieht auch keine Namen
    const fresh = await s.person();
    await s.join(owner, g, fresh);
    expect((await ok<{ people: unknown }>(await s.send('GET', `/api/posts/${named!.id}/poll`, fresh.cookie))).people).toBeNull();
  });
});

describe('F-475 Cache', () => {
  it('[F-475] Gast sieht weder eigene Wahl noch Ergebnis – auch nicht nach dem Abruf eines Mitglieds; Mitglied sieht seine Wahl', async () => {
    const { owner, member, g } = await club();
    const p = await poll(owner, { kind: 'group', id: g.id });
    const follower = await s.person({ profile: 'public' });
    // Nicht-Mitglied (Follower) liest den öffentlichen, gecachten Gruppen-Stream – mit Betrachter
    await ok(await vote(follower, p!.id, [1]));
    const mine = await ok<StreamPoll>(await s.send('GET', `/api/groups/${g.id}/stream`, follower.cookie));
    expect(cardIn(mine, p!.id)!.poll).toMatchObject({ mine: [1], counts: [0, 1, 0] });
    const guest = await s.send('GET', `/api/groups/${g.id}/stream`, undefined);
    expect(guest.headers.get('Cache-Control')).toMatch(/public/);
    const card = cardIn((await guest.json()) as StreamPoll, p!.id)!;
    expect(card.poll).toMatchObject({ mine: [], counts: null, voters: null, options: ['Ja', 'Nein', 'Vielleicht'] });
    // das Mitglied (ungecacht) sieht seine Wahl erst nach der Stimme
    expect(cardIn(await ok<StreamPoll>(await s.send('GET', `/api/groups/${g.id}/stream`, member.cookie)), p!.id)!.poll!.counts).toBeNull();
  });
});

describe('F-476 Benachrichtigungen', () => {
  it('[F-476] neue Umfrage ab „Wichtiges“ (Standard der Mitglieder) mit eigenem Satz; Text-Beiträge nicht', async () => {
    const { owner, member, g } = await club();
    await ok(await s.send('POST', '/api/posts', owner.cookie, { channel: { kind: 'group', id: g.id }, body: 'Nur Text', visibility: 'public' }), 201);
    const p = await poll(owner, { kind: 'group', id: g.id });
    const list = await ok<{ items: Array<{ kind: string; href: string; text: string }> }>(await s.send('GET', '/api/notifications', member.cookie));
    const posts = list.items.filter((n) => n.kind === 'post');
    expect(posts.map((n) => n.href)).toEqual([`/p/${p!.id}`]);
    expect(posts[0].text).toMatch(/neue Umfrage/);
  });

  it('[F-476] Nachtlauf meldet beendete Umfragen einmal an die Autor:in; selbst beendete nicht', async () => {
    const { owner, member, g } = await club();
    const ends = await poll(owner, { kind: 'group', id: g.id }, { closesAt: Date.now() + DAY });
    const self = await poll(owner, { kind: 'group', id: g.id });
    await ok(await vote(member, ends!.id, [0]));
    await ok(await s.send('POST', `/api/posts/${self!.id}/close`, owner.cookie));
    await run(`UPDATE posts SET data = json_set(data, '$.poll.closesAt', ?) WHERE id = ?`, Date.now() - 1000, ends!.id);
    await h.scheduled();
    await h.scheduled();
    const rows = (await (await s.db()).prepare(`SELECT subject_id FROM notifications WHERE kind = 'poll_closed' AND user_id = ?`).bind(owner.user.id).all<{ subject_id: string }>()).results;
    expect(rows.map((r) => r.subject_id)).toEqual([ends!.id]);
    const list = await ok<{ items: Array<{ kind: string; href: string; text: string }> }>(await s.send('GET', '/api/notifications', owner.cookie));
    const n = list.items.find((x) => x.kind === 'poll_closed')!;
    expect(n.href).toBe(`/p/${ends!.id}`);
    expect(n.text).toMatch(/Umfrage .*ist beendet/);
  });
});

describe('F-477 Löschwege', () => {
  async function voted(channel?: { kind: string; id: string }) {
    const { owner, member, g } = await club();
    const p = await poll(owner, channel ?? { kind: 'group', id: g.id });
    await ok(await vote(member, p!.id, [0]));
    await ok(await vote(owner, p!.id, [1]));
    expect(await votes(p!.id)).toBe(2);
    return { owner, member, g, p: p! };
  }

  it('[F-477] einzeln gelöscht (Autor:in): Beitrag und Stimmen weg', async () => {
    const { owner, p } = await voted();
    expect((await s.send('DELETE', `/api/posts/${p.id}`, owner.cookie)).status).toBe(204);
    expect(await votes(p.id)).toBe(0);
  });

  it('[F-477] Moderation (Meldung → löschen): Stimmen weg', async () => {
    const { member, p } = await voted();
    expect((await s.send('POST', '/api/reports', member.cookie, { kind: 'post', id: p.id, reason: 'spam', note: '' })).status).toBe(201);
    const rep = await one<{ id: string }>(`SELECT id FROM reports WHERE target_kind = 'post' AND target_id = ?`, p.id);
    expect((await s.send('POST', `/api/admin/reports/${rep!.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', p.id)).toBeNull();
    expect(await votes(p.id)).toBe(0);
  });

  it('[F-477] Gruppe gelöscht: Umfrage und Stimmen weg', async () => {
    const { owner, g, p } = await voted();
    expect((await s.send('DELETE', `/api/groups/${g.id}`, owner.cookie)).status).toBe(204);
    expect(await votes(p.id)).toBe(0);
  });

  it('[F-477] Hafen gelöscht (Moderation): Umfrage im Hafen samt Stimmen weg', async () => {
    const owner = await s.person({ profile: 'public' });
    const hb = ((await (await s.send('POST', '/api/harbors', owner.cookie, { name: s.uniq('Umfragehafen'), lat: -46, lon: -171 })).json()) as { harbor: { id: string } }).harbor;
    const p = await poll(owner, { kind: 'harbor', id: hb.id });
    await ok(await vote(owner, p!.id, [0]));
    expect((await s.send('DELETE', `/api/admin/harbors/${hb.id}`, admin.cookie, { confirm: hb.id })).status).toBe(204);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', p!.id)).toBeNull();
    expect(await votes(p!.id)).toBe(0);
  });

  it('[F-477] Konto der Wählenden gelöscht: nur ihre Stimme fällt (Ergebnis ändert sich); Konto der Autor:in: alles', async () => {
    const { owner, member, p } = await voted();
    expect((await s.send('DELETE', '/api/account', member.cookie)).status).toBe(200);
    expect(await votes(p.id)).toBe(1);
    expect((await s.send('DELETE', '/api/account', owner.cookie)).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM posts WHERE id = ?', p.id)).toBeNull();
    expect(await votes(p.id)).toBe(0);
  });

  it('[F-477] Konten zusammengeführt: Stimmen der Quelle wandern, wo das Ziel nicht abgestimmt hat', async () => {
    const { owner, member, g, p } = await voted();
    const q = await poll(owner, { kind: 'group', id: g.id });
    const into = await s.person({ profile: 'public' });
    await s.join(owner, g, into);
    await ok(await vote(into, p.id, [2]));
    await ok(await vote(member, q!.id, [1]));
    await ok(await s.send('POST', `/api/admin/users/${member.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: member.user.id }));
    const mine = async (id: string) => (await (await s.db()).prepare('SELECT choice FROM poll_votes WHERE post_id = ? AND user_id = ? ORDER BY choice').bind(id, into.user.id).all<{ choice: number }>()).results.map((r) => r.choice);
    expect(await mine(p.id)).toEqual([2]);
    expect(await mine(q!.id)).toEqual([1]);
    expect(await one('SELECT 1 AS x FROM poll_votes WHERE user_id = ?', member.user.id)).toBeNull();
  });
});
