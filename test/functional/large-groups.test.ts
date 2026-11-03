// Funktionale Tests: Große Gruppen (Konzept 28, F-465 … F-469) – Publikums-Hinweis, Tageskarten im Gruppen- und
// Hafen-Stream, Blättern über zusammengefasste Tage, „Alle anzeigen“, Eigner-Schalter und Migration 0035 mit
// Altbestand. Echter Worker in workerd (Miniflare) – siehe worker-harness.ts. Beiträge werden per SQL in der
// Vergangenheit angelegt (die API schreibt nur „jetzt“ und höchstens 5 je Gruppe und Tag).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { DAY_CURSOR_ID, berlinDayKey, dayOfKey, type Audience, type DayCard } from '../../src/domain/large-groups';
import { STREAM_PAGE, decodeCursor } from '../../src/domain/groups';

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

interface Page {
  items: Array<{ id: string; kind: string; createdAt: number; post?: { id: string; body: string } }>;
  days?: DayCard[];
  cursor: string | null;
}

/** Tag vor `k` Tagen (Europe/Berlin). */
const dayAgo = (k: number) => berlinDayKey(Date.now() - k * DAY);
let tagN = 0;
const tag = () => `T${(++tagN).toString(36).padStart(3, '0')}${Date.now().toString(36).slice(-6)}`;

/**
 * `n` öffentliche Beiträge im Verlauf am Tag `key` (ab 12:00 Ortszeit minütlich rückwärts) samt Aktivität und Ziel –
 * so, wie `createPost` und das Aktivitäts-Log sie schreiben.
 */
async function seed(o: { channel: 'group' | 'harbor'; id: string; author: Person; key: string; n: number; kind?: string; hour?: number }) {
  const db = await s.db();
  const t = tag();
  const t0 = dayOfKey(o.key)!.start + (o.hour ?? 12) * 3_600_000;
  const gid = o.channel === 'group' ? o.id : null;
  const cte = `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?1 - 1)`;
  await db.prepare(
    `${cte} INSERT INTO posts (id, author_id, group_id, body, link, created_at, kind, channel_kind, channel_id, visibility, reach, link_key, data)
     SELECT 'P' || ?2 || printf('%06d', i), ?3, ?4, 'Beitrag ' || i, NULL, ?5 - i * 60000, ?6, ?7, ?8, 'public', 'here', NULL, '{}' FROM n`,
  ).bind(o.n, t, o.author.user.id, gid, t0, o.kind ?? 'text', o.channel, o.id).run();
  await db.prepare(
    `${cte} INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, group_id, data, created_at, updated_at)
     SELECT 'A' || ?2 || printf('%06d', i), 'post', ?3, 'post', 'P' || ?2 || printf('%06d', i), ?4, '{}', ?5 - i * 60000, ?5 - i * 60000 FROM n`,
  ).bind(o.n, t, o.author.user.id, gid, t0).run();
  await db.prepare(
    `${cte} INSERT INTO activity_target (activity_id, target_kind, target_id, created_at)
     SELECT 'A' || ?2 || printf('%06d', i), ?3, ?4, ?5 - i * 60000 FROM n`,
  ).bind(o.n, t, o.channel, o.id, t0).run();
}

/** Viele Mitglieder ohne Anmeldung (Konten nur als Zeilen). */
async function addMembers(groupId: string, n: number) {
  const db = await s.db();
  const t = tag();
  await db.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?1 - 1)
     INSERT INTO users (id, email, created_at) SELECT 'U' || ?2 || printf('%06d', i), 'u' || ?2 || i || '@example.org', 0 FROM n`,
  ).bind(n, t).run();
  await db.prepare(`INSERT INTO group_members (group_id, user_id, role, created_at) SELECT ?1, id, 'member', 0 FROM users WHERE id LIKE 'U' || ?2 || '%'`).bind(groupId, t).run();
}

async function page(path: string, p?: Person): Promise<Page & { cache: string | null }> {
  const res = await h.fetch(path, { cookie: p?.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...((await res.json()) as Page), cache: res.headers.get('X-Stream-Cache') };
}

async function all(path: string, p?: Person) {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const next: Page = await page(`${path}${path.includes('?') ? '&' : '?'}${cursor ? `cursor=${encodeURIComponent(cursor)}` : ''}`, p);
    pages.push(next);
    cursor = next.cursor;
  } while (cursor && pages.length < 20);
  return pages;
}

async function club(owner: Person, members: Person[]) {
  const g = await s.group(owner);
  for (const m of members) await s.join(owner, g, m);
  return g;
}

describe('F-466/F-467 Tageskarten im Gruppen-Stream', () => {
  it('[F-466] älterer Tag mit mehr als 15 Einträgen wird zur Karte; laufender Tag und kleine Tage bleiben einzeln', async () => {
    const [o, m, x] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const g = await club(o, [m, x]);
    await seed({ channel: 'group', id: g.id, author: m, key: dayAgo(3), n: 16 });
    await seed({ channel: 'group', id: g.id, author: m, key: dayAgo(4), n: 3 });
    await seed({ channel: 'group', id: g.id, author: m, key: dayAgo(0), n: 2, hour: 0 });
    // eine Reaktion macht einen Beitrag „meistbeachtet“
    const db = await s.db();
    const target = (await db.prepare(`SELECT p.id FROM posts p WHERE p.group_id = ? AND p.body = 'Beitrag 9' AND p.created_at < ?`).bind(g.id, dayOfKey(dayAgo(2))!.start).first<{ id: string }>())!;
    expect((await s.send('PUT', `/api/reactions/post/${target.id}`, x.cookie, { kind: 'like' })).status).toBe(200);
    const guest = await page(`/api/groups/${g.id}/stream`);
    expect(guest.days).toHaveLength(1);
    const card = guest.days![0];
    expect(card).toMatchObject({ day: dayAgo(3), count: 16, posts: 16, voyages: 0, more: false });
    expect(card.top).toHaveLength(3);
    expect(card.top[0].post!.id).toBe(target.id);
    // Einzelne: 2 von heute, 3 vom kleinen Tag; keine Beiträge des zusammengefassten Tages
    const day3 = dayOfKey(dayAgo(3))!;
    expect(guest.items).toHaveLength(5);
    expect(guest.items.some((i) => i.createdAt >= day3.start && i.createdAt < day3.end)).toBe(false);
    expect(guest.cursor).toBeNull();
  });

  it('[F-467] eigene, von Admins und Umfragen bleiben einzeln; Gast bekommt die Karte auch nach dem Abruf eines Mitglieds', async () => {
    const [o, m, x] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const g = await club(o, [m, x]);
    const key = dayAgo(2);
    await seed({ channel: 'group', id: g.id, author: m, key, n: 16 });
    await seed({ channel: 'group', id: g.id, author: o, key, n: 1, hour: 15 });
    await seed({ channel: 'group', id: g.id, author: x, key, n: 1, kind: 'poll', hour: 16 });
    // Mitglied m: alles Eigene einzeln – keine Karte (ungecacht)
    const own = await page(`/api/groups/${g.id}/stream`, m);
    expect(own.cache).toBeNull();
    expect(own.days ?? []).toHaveLength(0);
    // (dazu die Beitrittsmeldungen von heute, die Mitglieder sehen)
    expect(own.items.filter((i) => i.kind === 'post')).toHaveLength(18);
    // anderes Mitglied: Karte mit den 16, Admin-Beitrag und Umfrage daneben
    const other = await page(`/api/groups/${g.id}/stream`, x);
    expect(other.days![0].count).toBe(16);
    expect(other.items.filter((i) => i.kind === 'post')).toHaveLength(2);
    // Gast: gecacht, ohne Betrachter berechnet – gleich, auch nach den Abrufen der Mitglieder
    const g1 = await page(`/api/groups/${g.id}/stream`);
    const g2 = await page(`/api/groups/${g.id}/stream`);
    expect(g2.cache).toBe('hit');
    for (const p of [g1, g2]) {
      expect(p.days![0].count).toBe(16);
      expect(p.items.map((i) => i.post?.body).sort()).toEqual(['Beitrag 0', 'Beitrag 0']);
    }
  });

  it('[F-466] Hafen-Stream: Tag mit mehr als 15 Beiträgen wird zur Karte, Vertretung bleibt einzeln', async () => {
    const [o, m] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const res = await s.send('POST', '/api/harbors', o.cookie, { name: s.uniq('Hafen'), lat: -44, lon: -171 });
    const hb = ((await res.json()) as { harbor: { id: string } }).harbor;
    await seed({ channel: 'harbor', id: hb.id, author: m, key: dayAgo(5), n: 17 });
    await seed({ channel: 'harbor', id: hb.id, author: o, key: dayAgo(5), n: 1, hour: 18 });
    const p = await page(`/api/harbors/${hb.id}/stream`);
    expect(p.days!.map((d) => [d.day, d.count])).toEqual([[dayAgo(5), 17]]);
    expect(p.items).toHaveLength(1);
  });
});

describe('F-468 Blättern über zusammengefasste Tage', () => {
  it('[F-468] großer Verlauf (mehr als 150 Mitglieder): jeder Tag genau einmal, Seiten enden an Tagesgrenzen', async () => {
    const [o, m] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const g = await club(o, [m]);
    await addMembers(g.id, 150);
    const keys = Array.from({ length: 25 }, (_, i) => dayAgo(i + 1));
    for (const key of keys) await seed({ channel: 'group', id: g.id, author: m, key, n: 2 });
    const pages = await all(`/api/groups/${g.id}/stream`);
    expect(pages).toHaveLength(2);
    expect(pages[0].days).toHaveLength(STREAM_PAGE);
    const c = decodeCursor(pages[0].cursor)!;
    expect(c).toEqual({ at: dayOfKey(keys[STREAM_PAGE - 1])!.start, id: DAY_CURSOR_ID });
    const days = pages.flatMap((p) => (p.days ?? []).map((d) => d.day));
    expect(days).toEqual(keys);
    expect(pages.flatMap((p) => p.items)).toHaveLength(0);
  });

  it('[F-468] ein Tag über die Kandidatenliste hinaus wird vervollständigt; „Alle anzeigen“ blättert ihn einzeln', async () => {
    const [o, m] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const g = await club(o, [m]);
    const key = dayAgo(2);
    await seed({ channel: 'group', id: g.id, author: m, key, n: 70 });
    await seed({ channel: 'group', id: g.id, author: m, key: dayAgo(3), n: 1 });
    const [first, second] = await all(`/api/groups/${g.id}/stream`);
    expect(first.days!.map((d) => [d.day, d.count])).toEqual([[key, 70]]);
    expect(second.items).toHaveLength(1);
    const entries = await all(`/api/groups/${g.id}/stream?day=${key}`);
    expect(entries.map((p) => p.items.length)).toEqual([20, 20, 20, 10]);
    const ids = entries.flatMap((p) => p.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(70);
    expect(entries.every((p) => !p.days)).toBe(true);
    expect((await h.fetch(`/api/groups/${g.id}/stream?day=2026-13-01`)).status).toBe(400);
    expect((await h.fetch(`/api/groups/${g.id}/stream?day=gestern`)).status).toBe(400);
  });
});

describe('F-469 Schalter je Gruppe und Migration 0035', () => {
  it('[F-469] nur der Eigner schaltet ab; abgeschaltet einzeln wie bisher', async () => {
    const [o, a, m] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const g = await club(o, [a, m]);
    await (await s.db()).prepare(`UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?`).bind(g.id, a.user.id).run();
    const info = async () => ((await (await h.fetch(`/api/groups/${g.id}`, { cookie: o.cookie })).json()) as { group: { daySummary: boolean } }).group;
    expect((await info()).daySummary).toBe(true);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, a.cookie, { daySummary: false })).status).toBe(403);
    const bad = await s.send('PATCH', `/api/groups/${g.id}`, o.cookie, { daySummary: 'nein' });
    expect(bad.status).toBe(400);
    expect(await s.errorOf(bad)).toBe('invalid_day_summary');
    expect((await s.send('PATCH', `/api/groups/${g.id}`, o.cookie, { daySummary: false })).status).toBe(200);
    expect((await info()).daySummary).toBe(false);
    await seed({ channel: 'group', id: g.id, author: m, key: dayAgo(2), n: 16 });
    const p = await page(`/api/groups/${g.id}/stream`);
    expect(p.days ?? []).toHaveLength(0);
    expect(p.items).toHaveLength(16);
  });

  it('[F-469] Altbestand: bestehende Gruppen fassen nach 0035 zusammen (Standard an)', async () => {
    const old = await startWorker({}, { migrateBefore: '0035' });
    try {
      const db = await old.db();
      await db.prepare(`INSERT INTO users (id, email, created_at) VALUES ('MigOwnerAAAAAAAAAA', 'alt@example.org', 1)`).run();
      await db.prepare(`INSERT INTO groups (id, kind, slug, name, owner_id, created_at, updated_at) VALUES ('MigGroupAAAAAAAAAA', 'club', 'alt-verein', 'Alt', 'MigOwnerAAAAAAAAAA', 1, 1)`).run();
      await applyMigrations(db, migrationFiles({ from: '0035', before: '0036' }));
      expect(await db.prepare(`SELECT day_summary FROM groups WHERE id = 'MigGroupAAAAAAAAAA'`).first()).toEqual({ day_summary: 1 });
      expect(await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'users_home_harbor'`).first()).toEqual({ name: 'users_home_harbor' });
    } finally {
      await old.dispose();
    }
  }, 60_000);
});

describe('F-465 Publikum beim Schreiben', () => {
  const audience = async (p: Person, ctx: string) => {
    const res = await s.send('GET', `/api/me/compose/audience?ctx=${ctx}`, p.cookie);
    return { status: res.status, body: res.status === 200 ? ((await res.json()) as { audience: Audience }).audience : null, cache: res.headers.get('Cache-Control') };
  };

  it('[F-465] Mitglieder und Follower ohne „Stumm“, je Stufe; nur wer dort schreiben darf', async () => {
    const [o, m, x, y] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const g = await club(o, [m, x]);
    expect((await s.send('PUT', `/api/follows/group/${g.id}`, y.cookie)).status).toBe(200);
    expect((await s.send('PUT', `/api/notify/group/${g.id}`, m.cookie, { level: 'muted' })).status).toBe(200);
    const r = await audience(o, `group:${g.id}`);
    expect(r.status).toBe(200);
    expect(r.cache).toBe('private, no-store');
    // o, x und y (m ist stumm); „Nur Mitglieder“: o und x; der Verein hat einen Heimathafen (Stufe „Bis Hafen“)
    expect(r.body).toMatchObject({ here: 3, members: 2 });
    expect(r.body!.harbor).toBeGreaterThanOrEqual(3);
    expect((await audience(y, `group:${g.id}`)).status).toBe(404);
    expect((await audience(m, `group:${g.id}`)).status).toBe(404); // Verein: nur Admins schreiben
    expect((await audience(o, 'group:kaputt')).status).toBe(404);
    expect((await audience(o, 'user')).body).toMatchObject({ here: 0 });
    expect((await s.send('GET', '/api/me/compose/audience?ctx=user', undefined)).status).toBe(401);
  });

  it('[F-465] große Gruppe: auf 10 gerundet', async () => {
    const o = await s.person({ profile: 'public' });
    const g = await club(o, []);
    await addMembers(g.id, 152);
    expect((await audience(o, `group:${g.id}`)).body).toMatchObject({ here: 150, members: 150 });
  });
});
