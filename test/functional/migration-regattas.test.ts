// Migrationstest 0051 (F-645): vorhandene Gruppen bekommen keine Bootsklasse – Vereine und Teams bleiben, wie sie sind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0051' });
  const db = await h.db();
  await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind('MigRegUserAAAAAAAA', 'mig-reg@example.org', 1).run();
  await db.prepare(`INSERT INTO groups (id, kind, slug, name, owner_id, created_at, updated_at) VALUES (?, 'club', 'alt-verein', 'Alt', ?, 1, 1)`).bind('MigRegGroupAAAAAAA', 'MigRegUserAAAAAAAA').run();
  expect(migrationFiles({ from: '0051' })[0]).toBe('0051_regattas.sql');
  await applyMigrations(db, migrationFiles({ from: '0051' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-645 Migration Klassenvereinigung', () => {
  it('[F-645] Altbestand: Gruppen ohne Bootsklasse, Art unverändert', async () => {
    expect(await (await h.db()).prepare(`SELECT kind, boat_class FROM groups WHERE id = 'MigRegGroupAAAAAAA'`).first()).toEqual({ kind: 'club', boat_class: '' });
  });
});
