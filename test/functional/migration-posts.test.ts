// Migrationstest 0029 (F-400, F-422): bestehende Gruppen-Beiträge bekommen ihren Heimatverlauf (nur hier), jeder
// Törn eine Post-Zeile mit derselben ID; „Ins Fahrtenbuch“: eigene Einträge bestätigt, GPX-Törns Vorschlag.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;
const T = 1_700_000_000_000;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0029' });
  const db = await h.db();
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
  await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', 'MigPostUserAAAAAA1', 'mp@example.org', T);
  await run(`INSERT INTO groups (id, kind, slug, name, owner_id, created_at, updated_at) VALUES ('MigPostClubAAAAAA1', 'club', 'migpost', 'Club', 'MigPostUserAAAAAA1', ?, ?)`, T, T);
  await run(`INSERT INTO posts (id, author_id, group_id, body, created_at) VALUES ('MigPostNewsAAAAAA1', 'MigPostUserAAAAAA1', 'MigPostClubAAAAAA1', 'Hallo', ?)`, T);
  await run(`INSERT INTO shares (id, user_id, title, visibility, size_bytes, track_count, created_at, updated_at) VALUES ('MigPostGpxAAAAAAA1', 'MigPostUserAAAAAA1', 'GPX', 'private', 1, 1, ?, ?)`, T, T);
  await run(`INSERT INTO shares (id, user_id, title, visibility, size_bytes, track_count, created_at, updated_at, source) VALUES ('MigPostLogAAAAAAA1', 'MigPostUserAAAAAA1', 'Log', 'public', 1, 1, ?, ?, 'manual')`, T + 1, T + 1);
  expect(migrationFiles({ from: '0029' })[0]).toBe('0029_posts.sql');
  await applyMigrations(db, migrationFiles({ from: '0029' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-400 Migration Beiträge als Grundtyp', () => {
  it('[F-400] Gruppen-Beiträge: Verlauf Gruppe, nur hier; Törns: Post-Zeile mit gleicher ID im Profil-Verlauf', async () => {
    const db = await h.db();
    const { results } = await db.prepare('SELECT id, kind, channel_kind, channel_id, share_id, reach, visibility, author_id, created_at FROM posts ORDER BY id').all();
    expect(results).toEqual([
      { id: 'MigPostGpxAAAAAAA1', kind: 'voyage', channel_kind: 'user', channel_id: 'MigPostUserAAAAAA1', share_id: 'MigPostGpxAAAAAAA1', reach: 'all', visibility: 'public', author_id: 'MigPostUserAAAAAA1', created_at: T },
      { id: 'MigPostLogAAAAAAA1', kind: 'logbook', channel_kind: 'user', channel_id: 'MigPostUserAAAAAA1', share_id: 'MigPostLogAAAAAAA1', reach: 'all', visibility: 'public', author_id: 'MigPostUserAAAAAA1', created_at: T + 1 },
      { id: 'MigPostNewsAAAAAA1', kind: 'text', channel_kind: 'group', channel_id: 'MigPostClubAAAAAA1', share_id: null, reach: 'here', visibility: 'public', author_id: 'MigPostUserAAAAAA1', created_at: T },
    ]);
    expect(await db.prepare('SELECT post_by FROM groups').first()).toEqual({ post_by: null });
    // Törn gelöscht → Post-Zeile fällt per Fremdschlüssel
    await db.prepare(`DELETE FROM shares WHERE id = 'MigPostGpxAAAAAAA1'`).bind().run();
    expect(await db.prepare(`SELECT 1 AS x FROM posts WHERE id = 'MigPostGpxAAAAAAA1'`).first()).toBeNull();
  });

  it('[F-422] Bestand „Ins Fahrtenbuch“: Fahrtenbuch-Einträge bestätigt, GPX-Törns Vorschlag', async () => {
    const db = await h.db();
    expect(await db.prepare(`SELECT log_state FROM shares WHERE id = 'MigPostLogAAAAAAA1'`).first()).toEqual({ log_state: 'confirmed' });
    await db.prepare(`INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at) VALUES ('MigPostNewAAAAAAA1', 'MigPostUserAAAAAA1', 'Neu', 1, 1, 1, 1)`).bind().run();
    expect(await db.prepare(`SELECT log_state FROM shares WHERE id = 'MigPostNewAAAAAAA1'`).first()).toEqual({ log_state: 'suggested' });
  });
});
