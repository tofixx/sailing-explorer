// Migrationstest 0048/0049 (F-641, Konzept 40): Neubau von `comments` mit Altbestand – Kommentare bleiben Zeile für
// Zeile gleich, Indizes und Kaskaden wie vorher; danach `post_id`, `posts.comments_mode` und die Glocken. Wer bisher als
// Mitkommentierende:r benachrichtigt wurde, hat danach eine Glocke „an“. 0048 wird wie bei `wrangler d1 migrations
// apply` als ein Batch (Transaktion) mit erzwungenen Fremdschlüsseln angewendet.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness, type D1Like } from './worker-harness';

let h: Harness;
let db: D1Like;
const T = 1_700_000_000_000;
const OWNER = 'MigCommOwnerAAAAA1';
const FAN = 'MigCommFanAAAAAAA1';
const HIDDEN = 'MigCommHiddenAAAA1';
const S1 = 'MigCommShareAAAAA1';
const S2 = 'MigCommShareAAAAA2';

type Batchable = D1Like & { batch(stmts: unknown[]): Promise<unknown> };
const COLS = 'id, share_id, photo_id, user_id, body, hidden_at, created_at';
const rows = async () => (await db.prepare(`SELECT ${COLS} FROM comments ORDER BY id`).all()).results;
const indexes = async () =>
  (await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'comments' AND sql IS NOT NULL ORDER BY name`).all<{ name: string }>()).results.map((r) => r.name);
const fks = async () => (await db.prepare(`SELECT "from" AS col, "table" AS parent, on_delete FROM pragma_foreign_key_list('comments') ORDER BY "from"`).all()).results;
const tableInfo = async () => (await db.prepare(`SELECT cid, name, type, "notnull" AS nn, dflt_value, pk FROM pragma_table_info('comments') ORDER BY cid`).all<Record<string, unknown>>()).results;

let before: unknown[] = [];
let infoBefore: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0048' });
  db = await h.db();
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
  for (const [id, mail] of [[OWNER, 'mco@example.org'], [FAN, 'mcf@example.org'], [HIDDEN, 'mch@example.org']]) {
    await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', id, mail, T);
  }
  for (const id of [S1, S2]) {
    await run(`INSERT INTO shares (id, user_id, title, visibility, size_bytes, track_count, created_at, updated_at) VALUES (?, ?, 'T', 'public', 10, 1, ?, ?)`, id, OWNER, T, T);
  }
  const c = (id: string, share: string, user: string, at: number, hidden: number | null = null) =>
    run(`INSERT INTO comments (id, share_id, photo_id, user_id, body, hidden_at, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)`, id, share, user, `Text ${id}`, hidden, at);
  await c('MigCommCAAAAAAAAA1', S1, FAN, T + 2);
  await c('MigCommCAAAAAAAAA2', S1, FAN, T + 1); // zweiter Kommentar derselben Person: eine Glocke, ab dem ersten
  await c('MigCommCAAAAAAAAA3', S1, OWNER, T + 3); // Eigentümer:in: keine Zeile nötig
  await c('MigCommCAAAAAAAAA4', S1, HIDDEN, T + 4, T + 5); // ausgeblendet: wurde bisher nicht benachrichtigt
  await c('MigCommCAAAAAAAAA5', S2, FAN, T + 6);
  before = await rows();
  infoBefore = await tableInfo();
  expect(await indexes()).toEqual(['comments_share', 'comments_user']);

  const files = migrationFiles({ from: '0048', before: '0049' });
  expect(files).toEqual(['0048_comments_rebuild.sql']);
  const sql = readFileSync(resolve('migrations', files[0]), 'utf8').replace(/--[^\n]*/g, '');
  const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
  await (db as Batchable).batch(stmts.map((s) => db.prepare(s)));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-641 Neubau comments (0048) mit Altbestand', () => {
  it('[F-641] alle Kommentare Zeile für Zeile unverändert, share_id jetzt nullable', async () => {
    expect(await rows()).toEqual(before);
    expect(infoBefore.find((c) => c.name === 'share_id')?.nn).toBe(1);
    expect(await tableInfo()).toEqual(infoBefore.map((c) => (c.name === 'share_id' ? { ...c, nn: 0 } : c)));
  });

  it('[F-641] Indizes und Fremdschlüssel wie vorher, keine Reste', async () => {
    expect(await indexes()).toEqual(['comments_share', 'comments_user']);
    expect(await fks()).toEqual([
      { col: 'share_id', parent: 'shares', on_delete: 'CASCADE' },
      { col: 'user_id', parent: 'users', on_delete: 'CASCADE' },
    ]);
    expect(await db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE name = 'comments_new'`).first()).toBeNull();
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});

describe('F-641 Verläufe und Glocken (0049)', () => {
  beforeAll(async () => {
    await applyMigrations(db, migrationFiles({ from: '0049', before: '0050' }));
  });

  it('[F-641] post_id mit Kaskade, posts.comments_mode = on für alle', async () => {
    expect(await fks()).toContainEqual({ col: 'post_id', parent: 'posts', on_delete: 'CASCADE' });
    expect(await indexes()).toEqual(['comments_post', 'comments_share', 'comments_user']);
    const info = (await db.prepare(`SELECT name, dflt_value FROM pragma_table_info('posts') WHERE name = 'comments_mode'`).first<{ dflt_value: string }>())!;
    expect(info.dflt_value).toBe(`'on'`);
  });

  it('[F-641] bisherige Mitkommentierende haben eine Glocke „an“ seit dem ersten Kommentar – ohne Eigentümer:in und Ausgeblendete', async () => {
    const subs = (await db.prepare('SELECT share_id, post_id, user_id, state, created_at FROM comment_subscriptions ORDER BY share_id, user_id').all()).results;
    expect(subs).toEqual([
      { share_id: S1, post_id: null, user_id: FAN, state: 'on', created_at: T + 1 },
      { share_id: S2, post_id: null, user_id: FAN, state: 'on', created_at: T + 6 },
    ]);
  });

  it('[F-641] Kaskaden: Törn gelöscht → Kommentare und Glocken weg; Konto gelöscht → seine Glocken weg', async () => {
    await db.prepare('DELETE FROM shares WHERE id = ?').bind(S2).run();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM comment_subscriptions WHERE share_id = ?').bind(S2).first()).toEqual({ n: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?').bind(S2).first()).toEqual({ n: 0 });
    await db.prepare('DELETE FROM users WHERE id = ?').bind(FAN).run();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM comment_subscriptions').first()).toEqual({ n: 0 });
  });
});
