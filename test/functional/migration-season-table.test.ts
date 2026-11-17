// Migrationstest 0052 (F-667): vorhandene Profile zeigen die Jahresansicht nicht ungefragt.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0052' });
  const db = await h.db();
  await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind('MigSeasonUserAAAAA', 'mig-season@example.org', 1).run();
  await db.prepare(`INSERT INTO profiles (user_id, handle, display_name, bio, visibility, created_at, updated_at) VALUES (?, 'alt-profil', 'Alt', '', 'public', 1, 1)`).bind('MigSeasonUserAAAAA').run();
  expect(migrationFiles({ from: '0052' })[0]).toBe('0052_season_table.sql');
  await applyMigrations(db, migrationFiles({ from: '0052' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-667 Migration Jahresansicht', () => {
  it('[F-667] Altbestand: nur für sich selbst', async () => {
    expect(await (await h.db()).prepare(`SELECT season_table FROM profiles WHERE user_id = 'MigSeasonUserAAAAA'`).first()).toEqual({ season_table: 'private' });
  });
});
