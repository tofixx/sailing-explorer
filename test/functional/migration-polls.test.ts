// Migrationstest 0036 (Konzept 29, F-477): additiv – bestehende Beiträge bleiben unverändert, Stimmen an einem
// Bestands-Beitrag fallen per ON DELETE CASCADE mit ihm und mit dem Konto der Wählenden.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;
const T = 1_700_000_000_000;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0036' });
  const db = await h.db();
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
  for (const u of ['MigPollUserAAAAAA1', 'MigPollUserAAAAAA2']) await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', u, `${u}@example.org`, T);
  await run(
    `INSERT INTO posts (id, author_id, body, created_at, kind, channel_kind, channel_id, visibility, reach) VALUES ('MigPollPostAAAAAA1', 'MigPollUserAAAAAA1', 'Alt', ?, 'text', 'user', 'MigPollUserAAAAAA1', 'public', 'all')`,
    T,
  );
  expect(migrationFiles({ from: '0036' })[0]).toBe('0036_poll_votes.sql');
  await applyMigrations(db, migrationFiles({ from: '0036' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-477 Migration Stimmen', () => {
  it('[F-477] Bestand unverändert; Stimmen fallen mit Beitrag und Konto', async () => {
    const db = await h.db();
    const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
    expect(await db.prepare('SELECT kind, body FROM posts WHERE id = ?').bind('MigPollPostAAAAAA1').first()).toEqual({ kind: 'text', body: 'Alt' });
    await run(`INSERT INTO poll_votes (post_id, user_id, choice, created_at) VALUES ('MigPollPostAAAAAA1', 'MigPollUserAAAAAA1', 0, ?), ('MigPollPostAAAAAA1', 'MigPollUserAAAAAA2', 1, ?)`, T, T);
    await run(`DELETE FROM users WHERE id = 'MigPollUserAAAAAA2'`);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM poll_votes').first<{ n: number }>())!.n).toBe(1);
    await run(`DELETE FROM posts WHERE id = 'MigPollPostAAAAAA1'`);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM poll_votes').first<{ n: number }>())!.n).toBe(0);
  });
});
