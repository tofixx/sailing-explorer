// Migrationstest 0038/0039 (F-490, Konzept 31, Retro R 4): Neubau von `photos` mit Altbestand – Törn-Fotos bleiben
// Zeile für Zeile gleich, Speicherzähler und R2-Dateien unverändert, Indizes und Kaskaden wie vorher, keine Waisen.
// 0038 wird wie bei `wrangler d1 migrations apply` als ein Batch (Transaktion) angewendet, mit erzwungenen
// Fremdschlüsseln – so fiele ein DROP, der Post-Zeilen oder Fotos mitreißt, hier auf.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness, type D1Like } from './worker-harness';

let h: Harness;
let db: D1Like;
const T = 1_700_000_000_000;
const U = 'MigPhotoUserAAAAAA1';
const S1 = 'MigPhotoShareAAAAA1';
const S2 = 'MigPhotoShareAAAAA2';

type Batchable = D1Like & { batch(stmts: unknown[]): Promise<unknown> };

/** Spalten außer `post_id` (kommt erst mit 0039) in fester Reihenfolge. */
const COLS = 'id, share_id, user_id, visibility, caption, taken_at, lat, lon, placement, width, height, format, bytes, hidden_at, created_at';
const rows = async () => (await db.prepare(`SELECT ${COLS} FROM photos ORDER BY id`).all()).results;
const indexes = async () =>
  (await db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'photos' AND sql IS NOT NULL ORDER BY name`).all<{ name: string; sql: string }>()).results.map(
    (r) => r.name,
  );
const fks = async () =>
  (await db.prepare(`SELECT "from" AS col, "table" AS parent, on_delete FROM pragma_foreign_key_list('photos') ORDER BY "from"`).all()).results;

let before: unknown[] = [];
/** Spalten vollständig (Name, Typ, NOT NULL, Standardwert, Schlüssel) – vor und nach dem Neubau */
const tableInfo = async () => (await db.prepare(`SELECT cid, name, type, "notnull" AS nn, dflt_value, pk FROM pragma_table_info('photos') ORDER BY cid`).all<Record<string, unknown>>()).results;
let infoBefore: Array<Record<string, unknown>> = [];
let counterBefore: unknown = null;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0038' });
  db = await h.db();
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
  await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', U, 'mphoto@example.org', T);
  for (const [id, vis] of [[S1, 'public'], [S2, 'private']]) {
    await run(`INSERT INTO shares (id, user_id, title, visibility, size_bytes, track_count, created_at, updated_at) VALUES (?, ?, 'T', ?, 10, 1, ?, ?)`, id, U, vis, T, T);
    await run(`INSERT INTO posts (id, author_id, kind, channel_kind, channel_id, share_id, body, created_at) VALUES (?, ?, 'voyage', 'user', ?, ?, '', ?)`, id, U, U, id, T);
  }
  // Post-Zeilen der Törns (0029) – sie verweisen auf shares, nicht auf photos, und dürfen den Neubau überleben
  expect((await db.prepare('SELECT COUNT(*) AS n FROM posts WHERE share_id IS NOT NULL').first<{ n: number }>())?.n).toBe(2);
  const photo = (id: string, share: string, o: Partial<Record<string, unknown>> = {}) =>
    run(
      `INSERT INTO photos (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, share, U, o.visibility ?? 'public', o.caption ?? '', o.taken_at ?? null, o.lat ?? null, o.lon ?? null, o.placement ?? 'none',
      800, 600, o.format ?? 'webp', o.bytes ?? 1000, o.hidden_at ?? null, T,
    );
  await photo('MigPhotoPicAAAAAAA1', S1, { caption: 'Am Steg', taken_at: T - 5, lat: 52.40001, lon: 13.05002, placement: 'gps', bytes: 123_456 });
  await photo('MigPhotoPicAAAAAAA2', S1, { visibility: 'private', format: 'jpeg', placement: 'manual', lat: 52.4, lon: 13.1, bytes: 98_765, hidden_at: T + 1 });
  await photo('MigPhotoPicAAAAAAA3', S2, { caption: 'Ohne Ort', bytes: 50_000 });
  // Zähler wie im Betrieb (recomputeStorage): Törns + Fotos
  await run(`INSERT INTO counters (name, value) VALUES ('storage_bytes', 20 + 123456 + 98765 + 50000) ON CONFLICT(name) DO UPDATE SET value = excluded.value`);
  before = await rows();
  infoBefore = await tableInfo();
  counterBefore = await db.prepare(`SELECT value FROM counters WHERE name = 'storage_bytes'`).first();
  expect(await indexes()).toEqual(['photos_share', 'photos_user']);

  // 0038 als ein Batch wie wrangler (Kommentare entfernt, an „;“ getrennt)
  const files = migrationFiles({ from: '0038', before: '0039' });
  expect(files).toEqual(['0038_photos_rebuild.sql']);
  const sql = readFileSync(resolve('migrations', files[0]), 'utf8').replace(/--[^\n]*/g, '');
  const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
  await (db as Batchable).batch(stmts.map((s) => db.prepare(s)));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-490 Neubau photos (0038) mit Altbestand', () => {
  it('[F-490] alle Törn-Fotos Zeile für Zeile unverändert, share_id jetzt nullable', async () => {
    expect(await rows()).toEqual(before);
    // Spalten vollständig gleich (Reihenfolge, Typ, Standardwert, Primärschlüssel) – einzige Änderung: share_id nullable
    const after = await tableInfo();
    expect(after).toEqual(infoBefore.map((c) => (c.name === 'share_id' ? { ...c, nn: 0 } : c)));
    expect(infoBefore.find((c) => c.name === 'share_id')?.nn).toBe(1);
    expect(after.map((c) => c.name)).toEqual(COLS.split(', '));
  });

  it('[F-490] Indizes und Fremdschlüssel wie vorher, keine Reste des Neubaus', async () => {
    expect(await indexes()).toEqual(['photos_share', 'photos_user']);
    expect(await fks()).toEqual([
      { col: 'share_id', parent: 'shares', on_delete: 'CASCADE' },
      { col: 'user_id', parent: 'users', on_delete: 'CASCADE' },
    ]);
    expect(await db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE name = 'photos_new'`).first()).toBeNull();
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });

  it('[F-490] Speicherzähler und Post-Zeilen der Törns unverändert, R2 braucht nichts', async () => {
    expect(await db.prepare(`SELECT value FROM counters WHERE name = 'storage_bytes'`).first()).toEqual(counterBefore);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM posts WHERE share_id IS NOT NULL').first<{ n: number }>())?.n).toBe(2);
    // Schlüssel hängen nur an share_id/id/format – die sind gleich geblieben (photo-keys.ts)
  });
});

describe('F-490 Galerie-Erweiterung (0039)', () => {
  beforeAll(async () => {
    await applyMigrations(db, migrationFiles({ from: '0039', before: '0040' }));
  });

  it('[F-490] post_id mit Kaskade auf posts, photo_log, Bestand bleibt Törn-Fotos', async () => {
    expect(await fks()).toContainEqual({ col: 'post_id', parent: 'posts', on_delete: 'CASCADE' });
    expect(await indexes()).toEqual(['photos_post', 'photos_share', 'photos_user']);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM photos WHERE post_id IS NULL AND share_id IS NOT NULL').first()).toEqual({ n: 3 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM photo_log').first()).toEqual({ n: 0 });
  });

  it('[F-490] Kaskaden greifen weiter: Törn gelöscht → seine Fotos weg, andere bleiben', async () => {
    await db.prepare('DELETE FROM shares WHERE id = ?').bind(S2).run();
    expect((await rows()).map((r) => (r as { id: string }).id)).toEqual(['MigPhotoPicAAAAAAA1', 'MigPhotoPicAAAAAAA2']);
  });
});
