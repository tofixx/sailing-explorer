// Migrationstest 0042 (F-538): vorhandene Boote bekommen ihre Klasse aus dem freien Typ – genau wie classifyBoatType
// beim Speichern; Boote ohne Typ bleiben leer, der Typ selbst bleibt unverändert.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';
import { BOAT_TYPE_SAMPLES } from '../boat-class-samples';
import { classifyBoatType } from '../../src/domain/boat-class';

let h: Harness;
const id = (i: number) => `MigClassBoat${String(i).padStart(4, '0')}`;
/** zusätzlich Sonderzeichen, die in SQL anders gelten könnten */
const SAMPLES: string[] = [...BOAT_TYPE_SAMPLES.map(([t]) => t), "O'Day 23", '100% Laser', 'FOLKEBOOT', 'ÄÖÜ Jollenkreuzer', 'Pirat_1'];

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0042' });
  const db = await h.db();
  await db.prepare(`INSERT INTO users (id, email, created_at) VALUES ('MigClassUser', 'mig-class@example.org', 1)`).all();
  for (const [i, t] of SAMPLES.entries()) {
    await db
      .prepare(`INSERT INTO boats (id, owner_id, name, boat_type, visibility, created_at, updated_at) VALUES (?, 'MigClassUser', 'Boot', ?, 'public', 1, 1)`)
      .bind(id(i), t)
      .run();
  }
  expect(migrationFiles({ from: '0042' })[0]).toBe('0042_boat_class.sql');
  await applyMigrations(db, migrationFiles({ from: '0042' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-538 Migration Bootsklasse', () => {
  it('[F-538] Altbestand: Klasse wie classifyBoatType, Typ unverändert, ohne Treffer leer', async () => {
    const db = await h.db();
    for (const [i, t] of SAMPLES.entries()) {
      const row = await db.prepare('SELECT boat_type, boat_class FROM boats WHERE id = ?').bind(id(i)).first<{ boat_type: string; boat_class: string }>();
      expect({ t, cls: row?.boat_class }).toEqual({ t, cls: classifyBoatType(t) });
      expect(row?.boat_type).toBe(t);
    }
    // Stichproben gegen die Erwartung (nicht nur gegen die Regel selbst)
    const get = async (i: number) => (await db.prepare('SELECT boat_class FROM boats WHERE id = ?').bind(id(i)).first<{ boat_class: string }>())?.boat_class;
    expect(await get(SAMPLES.indexOf('Hanse 470'))).toBe('fahrtenyacht');
    expect(await get(SAMPLES.indexOf('J/24'))).toBe('j24');
    expect(await get(SAMPLES.indexOf('Segelboot'))).toBe('');
    expect(await get(SAMPLES.indexOf('FOLKEBOOT'))).toBe('folkeboot');
  });
});
