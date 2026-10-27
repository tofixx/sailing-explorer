// Migrationstest 0018 (F-210): vorhandene Titelbilder bekommen den Ausschnitt „mittig“ – sie sind schon 3:1 und
// sehen danach aus wie vorher.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0018' });
  const db = await h.db();
  await db.prepare(`INSERT INTO covers (kind, object_id, ver, format, bytes, user_id, created_at) VALUES (?, ?, 'abcdef1234', 'webp', 1000, NULL, 1)`).bind('b', 'MigFocusBoatAAAAAA').run();
  expect(migrationFiles({ from: '0018' })[0]).toBe('0018_cover_focus.sql');
  await applyMigrations(db, migrationFiles({ from: '0018' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-210 Migration Titelbild-Ausschnitt', () => {
  it('[F-210] vorhandene Titelbilder stehen auf mittig (50 %)', async () => {
    const row = await (await h.db()).prepare(`SELECT focus_y FROM covers WHERE object_id = 'MigFocusBoatAAAAAA'`).first<{ focus_y: number }>();
    expect(row?.focus_y).toBe(50);
  });
});
