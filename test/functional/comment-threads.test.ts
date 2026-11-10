// Funktionale Tests: Kommentare an allen Beiträgen und Glocke je Verlauf (Konzept 40, F-635 … F-640, F-642, F-644).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type GroupOut, type Person } from './social-helpers';
import { isSubscribed } from '../../src/domain/comment-thread';
import { subscribedSql } from '../../worker/comment-thread-sql';

const DAY = 86_400_000;
const ADMIN_ID = 'ThreadAdmin0000001';
const ADMIN_MAIL = 'thread-admin@example.org';

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID, APP_ORIGIN: 'https://sail.example' });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  admin = { ...(await login(h, ADMIN_MAIL)), email: ADMIN_MAIL };
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface ListOut { mode: string; comments: Array<{ id: string; body: string; canDelete: boolean }>; canComment: boolean; block: string | null; isOwner: boolean; subscribed: boolean | null; canSetMode: boolean }

const one = async <T>(sql: string, ...args: unknown[]) => (await (await s.db()).prepare(sql).bind(...args).first<T>())!;
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args)).n;
/** Abstandsregel (20 s) für Folgekommentare überspringen. */
const age = async (p: Person) => {
  await (await s.db()).prepare('UPDATE comment_log SET created_at = created_at - 30000 WHERE user_id = ?').bind(p.user.id).run();
};

const path = (kind: 'shares' | 'posts', id: string) => `/api/${kind}/${id}/comments`;
const list = (p: Person | undefined, id: string, key?: string, kind: 'shares' | 'posts' = 'posts') =>
  s.send('GET', path(kind, id), p?.cookie, undefined, key ? { 'X-Share-Key': key } : {});
async function listJson(p: Person | undefined, id: string, key?: string, kind: 'shares' | 'posts' = 'posts'): Promise<ListOut> {
  const res = await list(p, id, key, kind);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ListOut;
}
const write = (p: Person, id: string, body: string, key?: string, kind: 'shares' | 'posts' = 'posts') =>
  s.send('POST', path(kind, id), p.cookie, { body }, key ? { 'X-Share-Key': key } : {});
async function comment(p: Person, id: string, body = 'Bin dabei!', kind: 'shares' | 'posts' = 'posts', key?: string) {
  const res = await write(p, id, body, key, kind);
  expect(res.status, await res.clone().text()).toBe(201);
  await age(p);
  return ((await res.json()) as { comment: { id: string } }).comment;
}
const bell = (p: Person | undefined, id: string, on: boolean, kind: 'shares' | 'posts' = 'posts') => s.send('PUT', `${path(kind, id)}/subscription`, p?.cookie, { on });

/** Beitrag über den Plus-Knopf (POST /api/posts). */
async function newPost(author: Person, channel: { kind: string; id?: string }, o: Record<string, unknown> = {}) {
  const res = await s.send('POST', '/api/posts', author.cookie, { channel: { id: '', ...channel }, kind: 'text', body: 'Wer kommt mit?', visibility: 'public', ...o });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { post: { id: string; path?: string } }).post;
}

async function club(visibility = 'public'): Promise<{ owner: Person; member: Person; g: GroupOut }> {
  const owner = await s.person({ profile: 'public' });
  const member = await s.person({ profile: 'public' });
  const g = await s.group(owner, { visibility });
  await s.join(owner, g, member);
  return { owner, member, g };
}

const commentNotes = (userId: string, postId: string) =>
  count(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'comment' AND subject_kind = 'post' AND subject_id = ?`, userId, postId);

// ---------------------------------------------------------------- F-635

describe('F-635 Kommentare an allen Beiträgen', () => {
  it('[F-635] Text, Umfrage und Veranstaltung haben einen Kommentar-Verlauf; Törn-Beiträge kommentiert man am Törn', async () => {
    const { owner, member, g } = await club();
    const text = await newPost(owner, { kind: 'group', id: g.id });
    const poll = await newPost(owner, { kind: 'group', id: g.id }, { kind: 'poll', body: 'Grillen?', poll: { options: ['Ja', 'Nein'] } });
    const event = await newPost(owner, { kind: 'group', id: g.id }, {
      kind: 'event', body: 'Ansegeln', event: { type: 'sail', place: 'Steg B', description: '', startsAt: Date.now() + 3 * DAY, endsAt: Date.now() + 3 * DAY + 7_200_000 },
    });
    for (const p of [text, poll, event]) {
      await comment(member, p.id, `Zu ${p.id}`);
      const l = await listJson(member, p.id);
      expect(l.comments.map((c) => c.body)).toEqual([`Zu ${p.id}`]);
      expect(l.canComment).toBe(true);
      expect((await list(member, p.id)).headers.get('Cache-Control')).toBe('private, no-store');
    }
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE post_id IN (?, ?, ?) AND share_id IS NULL', text.id, poll.id, event.id)).toBe(3);
    // Törn als Beitrag: eigene Post-Zeile mit share_id → am Beitrag 404, am Törn geht es
    const sh = await s.share(owner);
    expect((await list(member, sh.id)).status).toBe(404);
    expect((await write(member, sh.id, 'Hallo')).status).toBe(404);
    await comment(member, sh.id, 'Am Törn', 'shares');
    expect((await listJson(member, sh.id, undefined, 'shares')).comments.map((c) => c.body)).toEqual(['Am Törn']);
  });

  it('[F-635] Gast liest öffentliche Beitrags-Kommentare, schreibt aber nicht (401); ohne Profil kein Kommentar', async () => {
    const { owner, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id });
    const guest = await listJson(undefined, p.id);
    expect(guest.block).toBe('login');
    expect(guest.subscribed).toBeNull();
    const noProfile = await s.person();
    expect((await listJson(noProfile, p.id)).block).toBe('profile');
    expect((await write(noProfile, p.id, 'x')).status).toBe(403);
  });
});

// ---------------------------------------------------------------- F-636

describe('F-636 Sichtbarkeit und Modus wie der Beitrag', () => {
  it('[F-636] „Nur Mitglieder“: Nicht-Mitglieder und Gäste 404 – auch nach dem Abruf eines Mitglieds', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id }, { visibility: 'members' });
    await comment(member, p.id, 'Intern');
    expect((await listJson(member, p.id)).comments).toHaveLength(1);
    const stranger = await s.person({ profile: 'public' });
    expect((await list(stranger, p.id)).status).toBe(404);
    expect((await list(undefined, p.id)).status).toBe(404);
    expect((await write(stranger, p.id, 'Ich auch')).status).toBe(404);
    expect((await bell(stranger, p.id, true)).status).toBe(404);
  });

  it('[F-636] „Nur mit Link“ braucht den Schlüssel; Kommentar-Modus setzt nur die Autor:in', async () => {
    const author = await s.person({ profile: 'public', supporter: true });
    const p = await newPost(author, { kind: 'user', id: author.user.id }, { visibility: 'unlisted' });
    const key = p.path!.split('/').pop()!;
    const reader = await s.person({ profile: 'public' });
    expect((await list(reader, p.id)).status).toBe(404);
    await comment(reader, p.id, 'Mit Link', 'posts', key);
    // Modus: nur die Autor:in, andere 404; unbekannter Wert 400
    expect((await s.send('PUT', `/api/posts/${p.id}/comments/mode`, reader.cookie, { mode: 'off' }, { 'X-Share-Key': key })).status).toBe(404);
    expect((await s.send('PUT', `/api/posts/${p.id}/comments/mode`, author.cookie, { mode: 'egal' })).status).toBe(400);
    expect((await listJson(author, p.id)).canSetMode).toBe(true);
    expect((await listJson(reader, p.id, key)).canSetMode).toBe(false);
    expect((await s.send('PUT', `/api/posts/${p.id}/comments/mode`, author.cookie, { mode: 'off' })).status).toBe(200);
    expect(await s.errorOf(await write(reader, p.id, 'Noch was', key))).toBe('comments_off');
    expect((await listJson(reader, p.id, key)).comments).toHaveLength(1);
    await s.send('PUT', `/api/posts/${p.id}/comments/mode`, author.cookie, { mode: 'hidden' });
    expect((await listJson(reader, p.id, key)).comments).toHaveLength(0);
    expect((await listJson(author, p.id)).comments).toHaveLength(1);
    expect(await s.errorOf(await s.send('PUT', `${path('posts', p.id)}/subscription`, reader.cookie, { on: true }, { 'X-Share-Key': key }))).toBe('comments_hidden');
  });

  it('[F-636] löschen: Autor:in des Kommentars und des Beitrags, Admins; andere 404', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id });
    const c1 = await comment(member, p.id, 'Eins');
    const c2 = await comment(member, p.id, 'Zwei');
    const c3 = await comment(member, p.id, 'Drei');
    const other = await s.person({ profile: 'public' });
    expect((await s.send('DELETE', `/api/comments/${c1.id}`, other.cookie)).status).toBe(404);
    expect((await listJson(owner, p.id)).comments.every((c) => c.canDelete)).toBe(true);
    expect((await s.send('DELETE', `/api/comments/${c1.id}`, owner.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/comments/${c2.id}`, member.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/comments/${c3.id}`, admin.cookie)).status).toBe(204);
    expect((await listJson(owner, p.id)).comments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- F-637, F-638, F-639

describe('F-637 Benachrichtigung nur im Verlauf', () => {
  it('[F-637] der Kanal hört nur vom Beitrag; Kommentare erreichen Autor:in und wer selbst kommentiert hat', async () => {
    const { owner, member, g } = await club();
    const quiet = await s.person({ profile: 'public' });
    await s.join(owner, g, quiet);
    const p = await newPost(owner, { kind: 'group', id: g.id });
    await comment(member, p.id, 'Erster');
    expect(await commentNotes(owner.user.id, p.id)).toBe(1);
    expect(await commentNotes(quiet.user.id, p.id)).toBe(0);
    expect(await commentNotes(member.user.id, p.id)).toBe(0); // nie an sich selbst
    await comment(owner, p.id, 'Antwort');
    expect(await commentNotes(member.user.id, p.id)).toBe(1);
    expect(await commentNotes(quiet.user.id, p.id)).toBe(0);
    // Glocke zeigt „… hat deinen Beitrag in „Verein“ kommentiert“ bzw. „einen Beitrag“ – nie den Beitragstext
    const n = (await (await s.send('GET', '/api/notifications', member.cookie)).json()) as { items: Array<{ kind: string; text: string; href: string }> };
    const it0 = n.items.find((i) => i.kind === 'comment')!;
    expect(it0.text).toContain('einen Beitrag in „Segelclub Möwe“');
    expect(it0.text).not.toContain('Wer kommt mit');
    expect(it0.href).toBe(`/p/${p.id}`);
    const own = (await (await s.send('GET', '/api/notifications', owner.cookie)).json()) as { items: Array<{ kind: string; text: string }> };
    expect(own.items.find((i) => i.kind === 'comment')!.text).toContain('deinen Beitrag');
  });

  it('[F-637] wer die Gruppe verlässt, sieht den Kommentar-Hinweis zu „Nur Mitglieder“ nicht mehr', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id }, { visibility: 'members' });
    await comment(member, p.id, 'Ich');
    await comment(owner, p.id, 'Du');
    expect(await commentNotes(member.user.id, p.id)).toBe(1);
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/${member.user.id}`, member.cookie)).status).toBe(204);
    const n = (await (await s.send('GET', '/api/notifications', member.cookie)).json()) as { items: Array<{ kind: string }> };
    expect(n.items.filter((i) => i.kind === 'comment')).toHaveLength(0);
  });

  it('[F-637] isSubscribed = subscribedSql für alle Fälle', async () => {
    const db = await s.db();
    for (const state of [null, 'on', 'off'] as const) {
      for (const owner of [false, true]) {
        const r = await db.prepare(`SELECT ${subscribedSql('?1', '?2')} AS ok`).bind(state, owner ? 1 : 0).first<{ ok: number }>();
        expect(r?.ok === 1, `${state}/${owner}`).toBe(isSubscribed(state, owner));
      }
    }
  });
});

describe('F-638 Glocke an mit dem ersten eigenen Kommentar, stumm bleibt stumm', () => {
  it('[F-638] erster Kommentar schaltet an; nach „stumm“ schalten weitere Kommentare nicht wieder an', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id });
    expect((await listJson(member, p.id)).subscribed).toBe(false);
    expect((await listJson(owner, p.id)).subscribed).toBe(true); // Autor:in ohne Zeile: an
    await comment(member, p.id, 'Erster');
    expect((await listJson(member, p.id)).subscribed).toBe(true);
    expect((await bell(member, p.id, false)).status).toBe(200);
    await comment(member, p.id, 'Zweiter');
    expect((await listJson(member, p.id)).subscribed).toBe(false);
    await comment(owner, p.id, 'Antwort');
    expect(await commentNotes(member.user.id, p.id)).toBe(0);
  });
});

describe('F-639 Glocke an/aus je Verlauf', () => {
  it('[F-639] ohne Kommentar einschalten; Autor:in schaltet stumm; Gäste 401; ungültig 400', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id });
    expect((await bell(undefined, p.id, true)).status).toBe(401);
    expect((await s.send('PUT', `${path('posts', p.id)}/subscription`, member.cookie, { on: 'ja' })).status).toBe(400);
    expect((await bell(member, p.id, true)).status).toBe(200);
    expect((await bell(owner, p.id, false)).status).toBe(200);
    const writer = await s.person({ profile: 'public' });
    await s.join(owner, g, writer);
    await comment(writer, p.id, 'Hallo');
    expect(await commentNotes(member.user.id, p.id)).toBe(1);
    expect(await commentNotes(owner.user.id, p.id)).toBe(0);
    expect((await listJson(owner, p.id)).subscribed).toBe(false);
  });

  it('[F-639] auch an Törns: Mitlesende schalten ein, Eigentümer:in schaltet stumm', async () => {
    const owner = await s.person({ profile: 'public' });
    const sh = await s.share(owner);
    const fan = await s.person({ profile: 'public' });
    const writer = await s.person({ profile: 'public' });
    expect((await bell(fan, sh.id, true, 'shares')).status).toBe(200);
    expect((await bell(owner, sh.id, false, 'shares')).status).toBe(200);
    await comment(writer, sh.id, 'Schön!', 'shares');
    const notes = (u: string) => count(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'comment' AND subject_id = ?`, u, sh.id);
    expect(await notes(fan.user.id)).toBe(1);
    expect(await notes(owner.user.id)).toBe(0);
  });
});

// ---------------------------------------------------------------- F-640 Löschwege

describe('F-640 Löschwege für Kommentare an Beiträgen und Glocken', () => {
  it('[F-640] Beitrag löschen entfernt Kommentare, Glocken und Meldungen zu den Kommentaren', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id });
    const c = await comment(member, p.id, 'Spam?');
    await bell(owner, p.id, false);
    expect((await s.send('POST', '/api/reports', owner.cookie, { kind: 'comment', id: c.id, reason: 'spam' })).status).toBe(201);
    expect((await s.send('DELETE', `/api/posts/${p.id}`, owner.cookie)).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?', p.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comment_subscriptions WHERE post_id = ?', p.id)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM reports WHERE target_kind = 'comment' AND target_id = ?`, c.id)).toBe(0);
  });

  it('[F-640] Gruppe löschen entfernt Beiträge samt Kommentaren und Glocken', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id });
    await comment(member, p.id, 'Hallo');
    expect((await s.send('DELETE', `/api/groups/${g.id}`, owner.cookie)).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?', p.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comment_subscriptions WHERE post_id = ?', p.id)).toBe(0);
  });

  it('[F-640] Törn löschen entfernt Glocken am Törn', async () => {
    const owner = await s.person({ profile: 'public' });
    const fan = await s.person({ profile: 'public' });
    const sh = await s.share(owner);
    await comment(fan, sh.id, 'Toll', 'shares');
    expect(await count('SELECT COUNT(*) AS n FROM comment_subscriptions WHERE share_id = ?', sh.id)).toBe(1);
    expect((await s.send('DELETE', `/api/shares/${sh.id}`, owner.cookie)).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM comment_subscriptions WHERE share_id = ?', sh.id)).toBe(0);
  });

  it('[F-640] Konto löschen entfernt eigene Glocken und Kommentare, auch an fremden Beiträgen', async () => {
    const { owner, g } = await club();
    const leaver = await s.person({ profile: 'public' });
    await s.join(owner, g, leaver);
    const p = await newPost(owner, { kind: 'group', id: g.id });
    await comment(leaver, p.id, 'Tschüss');
    expect((await s.send('DELETE', '/api/account', leaver.cookie)).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM comment_subscriptions WHERE user_id = ?', leaver.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?', leaver.user.id)).toBe(0);
  });

  it('[F-640] Konten zusammenführen hängt Glocken um; doppelte gelten als die des Ziels', async () => {
    const { owner, g } = await club();
    const from = await s.person({ profile: 'public' });
    const into = await s.person({ profile: 'public' });
    const p1 = await newPost(owner, { kind: 'group', id: g.id });
    const p2 = await newPost(owner, { kind: 'group', id: g.id }, { body: 'Zweiter' });
    await bell(from, p1.id, true);
    await bell(from, p2.id, true);
    await bell(into, p2.id, false);
    const res = await s.send('POST', `/api/admin/users/${from.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: from.user.id });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM comment_subscriptions WHERE user_id = ?', from.user.id)).toBe(0);
    expect((await one<{ state: string }>('SELECT state FROM comment_subscriptions WHERE post_id = ? AND user_id = ?', p1.id, into.user.id)).state).toBe('on');
    expect((await one<{ state: string }>('SELECT state FROM comment_subscriptions WHERE post_id = ? AND user_id = ?', p2.id, into.user.id)).state).toBe('off');
  });
});

// ---------------------------------------------------------------- F-642 Melden

describe('F-642 Melden und Moderation von Kommentaren an Beiträgen', () => {
  it('[F-642] melden nur, wer den Beitrag sieht; Admin-Liste führt zur Karte; ausblenden wirkt', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id }, { visibility: 'members' });
    const c = await comment(member, p.id, 'Unfreundlich');
    const stranger = await s.person({ profile: 'public' });
    expect((await s.send('POST', '/api/reports', stranger.cookie, { kind: 'comment', id: c.id, reason: 'spam' })).status).toBe(404);
    expect((await s.send('POST', '/api/reports', owner.cookie, { kind: 'comment', id: c.id, reason: 'abuse' })).status).toBe(201);
    const r = (await (await s.send('GET', '/api/admin/reports', admin.cookie)).json()) as { reports: Array<{ targetId: string; target: { title: string; path: string } | null }> };
    expect(r.reports.find((i) => i.targetId === c.id)?.target).toMatchObject({ title: 'Kommentar zu einem Beitrag', path: `/p/${p.id}` });
    await (await s.db()).prepare('UPDATE comments SET hidden_at = ? WHERE id = ?').bind(Date.now(), c.id).run();
    expect((await listJson(owner, p.id)).comments).toHaveLength(0);
    expect((await listJson(member, p.id)).comments).toHaveLength(1); // Autor:in sieht ihn mit Hinweis
  });
});

// ---------------------------------------------------------------- F-644 Gelesen und Sammelmail

describe('F-644 Gelesen beim Öffnen der Kommentare', () => {
  it('[F-644] Öffnen der Kommentare eines Beitrags liest seine Kommentar-Benachrichtigungen', async () => {
    const { owner, member, g } = await club();
    const p = await newPost(owner, { kind: 'group', id: g.id });
    await comment(member, p.id, 'Hallo');
    expect(await count(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'comment' AND read_at IS NULL`, owner.user.id)).toBe(1);
    await listJson(owner, p.id);
    expect(await count(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'comment' AND read_at IS NULL`, owner.user.id)).toBe(0);
  });
});
