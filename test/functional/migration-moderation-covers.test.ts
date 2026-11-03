// Migrationstest 0044 (F-567): Altbestand bleibt, wie er war – vorhandene Titelbilder öffentlich, vorhandene
// Meldungen zählen zur Schwelle; das Tageslimit beginnt leer.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0044' });
  const db = await h.db();
  await db.prepare(`INSERT INTO covers (kind, object_id, ver, format, bytes, user_id, created_at) VALUES ('b', 'MigModBoatAAAAAAA', 'abcdef1234', 'webp', 1000, NULL, 1)`).bind().run();
  await db.prepare(`INSERT INTO reports (id, target_kind, target_id, reporter_id, reason, note, created_at) VALUES ('MigRep1', 'share', 'S1', NULL, 'depicted', '', 1)`).bind().run();
  expect(migrationFiles({ from: '0044' })[0]).toBe('0044_moderation_covers.sql');
  await applyMigrations(db, migrationFiles({ from: '0044' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-567 Migration Moderation Titelbilder', () => {
  it('[F-567] Titelbilder nicht zurückgehalten und ungeprüft, Meldungen mit Gewicht 1, cover_log leer', async () => {
    const db = await h.db();
    expect(await db.prepare(`SELECT held_until, kept_ver FROM covers WHERE object_id = 'MigModBoatAAAAAAA'`).first()).toEqual({ held_until: null, kept_ver: null });
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('photos') WHERE name = 'kept_at'`).first()).toEqual({ n: 1 });
    expect(await db.prepare(`SELECT weight, reason FROM reports WHERE id = 'MigRep1'`).first()).toEqual({ weight: 1, reason: 'depicted' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM cover_log').first()).toEqual({ n: 0 });
  });
});
