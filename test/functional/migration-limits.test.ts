// Migration 0008_limits (Phase B): image_bytes für Altbestand mit Übersichtsbild geschätzt, Zähler storage_bytes
// aus dem Bestand vorbelegt.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;
const T = 1_780_000_000_000;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0008' });
  const db = await h.db();
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
  await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', 'LimUserAAAAAAAAAAA', 'lim@example.org', T);
  const share = (id: string, size: number, image: number) =>
    run(
      `INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at, has_image) VALUES (?, 'LimUserAAAAAAAAAAA', 'T', ?, 1, ?, ?, ?)`,
      id, size, T, T, image,
    );
  await share('LimWithImageAAAAAA', 1000, 1);
  await share('LimNoImageAAAAAAAA', 2000, 0);
  expect(migrationFiles({ from: '0008' })[0]).toBe('0008_limits.sql');
  await applyMigrations(db, migrationFiles({ from: '0008' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('Migration 0008_limits', () => {
  it('Altbestand mit Übersichtsbild bekommt eine geschätzte Bildgröße, ohne Bild 0', async () => {
    const db = await h.db();
    const rows = (await db.prepare('SELECT id, image_bytes FROM shares ORDER BY id').all<{ id: string; image_bytes: number }>()).results;
    expect(rows).toEqual([
      { id: 'LimNoImageAAAAAAAA', image_bytes: 0 },
      { id: 'LimWithImageAAAAAA', image_bytes: 153600 },
    ]);
  });

  it('storage_bytes ist mit Tracks + Bildern des Bestands vorbelegt', async () => {
    const row = await (await h.db()).prepare("SELECT value FROM counters WHERE name = 'storage_bytes'").first<{ value: number }>();
    expect(row!.value).toBe(1000 + 2000 + 153600);
  });
});
