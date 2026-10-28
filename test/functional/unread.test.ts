// Funktionale Tests: Community-Badge – ungelesene Einträge im persönlichen Stream (F-221, F-222, Konzept 12.10).
// Echter Worker in workerd (Miniflare) – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { UNREAD_MAX } from '../../src/domain/unread';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const unread = async (p: Person) => {
  const res = await s.send('GET', '/api/stream/unread', p.cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  expect(res.headers.get('Cache-Control')).toContain('no-store');
  return (await res.json()) as { count: number; more: boolean };
};
const seenAt = async (p: Person) =>
  (await (await s.db()).prepare('SELECT stream_seen_at AS v FROM users WHERE id = ?').bind(p.user.id).first<{ v: number | null }>())?.v ?? null;
const setSeen = async (p: Person, v: number) => (await s.db()).prepare('UPDATE users SET stream_seen_at = ? WHERE id = ?').bind(v, p.user.id).run();
const tick = () => new Promise((r) => setTimeout(r, 5));
const post = async (admin: Person, g: { id: string }, body: string) => {
  const res = await s.send('POST', `/api/groups/${g.id}/posts`, admin.cookie, { body });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { post: { id: string } }).post;
};

/** Verein mit Eigner und Leser; Gelesen-Zeitpunkt des Lesers steht auf „jetzt“. */
async function setup() {
  const owner = await s.person({ supporter: true });
  const g = await s.group(owner);
  const reader = await s.person();
  await s.join(owner, g, reader);
  await setSeen(reader, Date.now());
  await tick();
  return { owner, g, reader };
}

describe('F-221 Community-Badge: ungelesene Einträge zählen', () => {
  it('[F-221] noch nie geöffnet: 0 und ab jetzt zählen; ohne Anmeldung 401', async () => {
    const me = await s.person();
    expect(await seenAt(me)).toBeNull();
    expect(await unread(me)).toEqual({ count: 0, more: false });
    expect(await seenAt(me)).toBeGreaterThan(Date.now() - 60_000);
    expect((await s.send('GET', '/api/stream/unread', undefined)).status).toBe(401);
    expect((await s.send('POST', '/api/stream/seen', undefined, {})).status).toBe(401);
  });

  it('[F-221] zählt Neues aus dem Stream – nicht Eigenes, nicht Ausgeblendetes, nichts außerhalb der eigenen Ziele', async () => {
    const { owner, g, reader } = await setup();
    const p1 = await post(owner, g, 'Ansegeln am Samstag');
    await post(owner, g, 'Kranen am Montag');
    expect(await unread(reader)).toEqual({ count: 2, more: false });
    // eigener öffentlicher Törn: steht im Stream, ist aber nicht „neu“ für mich
    await s.share(reader, { title: 'Mein eigener' });
    expect((await unread(reader)).count).toBe(2);
    // ausgeblendeter Beitrag: dieselbe Prüfung beim Lesen wie im Stream
    await (await s.db()).prepare('UPDATE posts SET hidden_at = ? WHERE id = ?').bind(Date.now(), p1.id).run();
    expect((await unread(reader)).count).toBe(1);
    // fremder Verein, dem ich nicht angehöre
    const other = await s.person({ supporter: true });
    await post(other, await s.group(other), 'Woanders');
    expect((await unread(reader)).count).toBe(1);
  });

  it('[F-221] Grenze: höchstens 99, darüber `more` („99+“)', async () => {
    const { owner, g, reader } = await setup();
    const db = await s.db();
    const now = Date.now() + 1000;
    const rows = Array.from({ length: UNREAD_MAX + 11 }, (_, i) => ({ id: `Q${String(i).padStart(17, '0')}${g.id.slice(0, 4)}`, aid: `B${String(i).padStart(17, '0')}${g.id.slice(0, 4)}`, at: now + i }));
    await db.prepare(`INSERT INTO posts (id, author_id, group_id, body, created_at) VALUES ${rows.map((r) => `('${r.id}', '${owner.user.id}', '${g.id}', 'x', ${r.at})`).join(',')}`).all();
    await db
      .prepare(`INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, group_id, data, created_at, updated_at) VALUES ${rows.map((r) => `('${r.aid}', 'post', '${owner.user.id}', 'post', '${r.id}', '${g.id}', '{}', ${r.at}, ${r.at})`).join(',')}`)
      .all();
    await db.prepare(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES ${rows.map((r) => `('${r.aid}', 'group', '${g.id}', ${r.at})`).join(',')}`).all();
    expect(await unread(reader)).toEqual({ count: UNREAD_MAX, more: true });
  });

  it('[F-221] die Zählabfrage nutzt den Index von activity_target (Schlüsselliste als äußere Schleife)', async () => {
    const db = await s.db();
    const { UNREAD_SQL } = await import('../../worker/stream-sql');
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${UNREAD_SQL}`).bind('[["user","x"]]', Date.now(), 150).all<{ detail: string }>();
    const details = plan.results.map((r) => r.detail).join('\n');
    expect(details).toMatch(/SEARCH t USING (COVERING )?INDEX (activity_target_feed|sqlite_autoindex_activity_target_1)/);
    expect(details).not.toMatch(/SCAN t\b/);
  });
});

describe('F-222 Community gelesen', () => {
  it('[F-222] gelesen bis zum Stand der angezeigten Seite: Neueres bleibt ungelesen', async () => {
    const { owner, g, reader } = await setup();
    await post(owner, g, 'Schon gesehen');
    const page = (await (await s.send('GET', '/api/stream', reader.cookie)).json()) as { at: number };
    expect(page.at).toBeGreaterThan(0);
    await tick();
    await post(owner, g, 'Erst danach');
    const res = await s.send('POST', '/api/stream/seen', reader.cookie, { at: page.at });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await seenAt(reader)).toBe(page.at);
    expect((await unread(reader)).count).toBe(1);
  });

  it('[F-222] nur vorwärts (anderes Gerät war weiter) und nie in der Zukunft', async () => {
    const { reader } = await setup();
    const before = (await seenAt(reader))!;
    await s.send('POST', '/api/stream/seen', reader.cookie, { at: before - 60_000 });
    expect(await seenAt(reader)).toBe(before);
    await s.send('POST', '/api/stream/seen', reader.cookie, { at: Date.now() + 86_400_000 });
    expect(await seenAt(reader)).toBeLessThanOrEqual(Date.now());
    expect(await seenAt(reader)).toBeGreaterThanOrEqual(before);
  });

  it('[F-222] Löschkonzept: der Zeitpunkt liegt in der Konto-Zeile und verschwindet mit dem Konto', async () => {
    const { reader } = await setup();
    expect(await seenAt(reader)).not.toBeNull();
    const res = await s.send('DELETE', '/api/account', reader.cookie);
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const row = await (await s.db()).prepare('SELECT id FROM users WHERE id = ?').bind(reader.user.id).first();
    expect(row).toBeNull();
  });
});
