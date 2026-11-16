// Migrationstest 0050 (F-270): vorhandene Boote bekommen die strengsten Schalter (keine Beiträge, keine Einladungen,
// Zuordnen nur durch die Stammcrew) und eine leere Stammcrew – nichts wird still freigeschaltet.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0050' });
  const db = await h.db();
  await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind('MigCrewUserAAAAAAA', 'mig-crew@example.org', 1).run();
  await db.prepare(`INSERT INTO boats (id, owner_id, name, visibility, created_at, updated_at) VALUES ('MigCrewBoatAAAAAAA', 'MigCrewUserAAAAAAA', 'Alt', 'public', 1, 1)`).run();
  expect(migrationFiles({ from: '0050' })[0]).toBe('0050_boat_crew.sql');
  await applyMigrations(db, migrationFiles({ from: '0050' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-270 Migration Stammcrew', () => {
  it('[F-270] Altbestand: Schalter aus, Zuordnen nur Stammcrew, Stammcrew leer', async () => {
    const db = await h.db();
    expect(await db.prepare(`SELECT crew_post, crew_invite, crew_assign FROM boats WHERE id = 'MigCrewBoatAAAAAAA'`).first()).toEqual({ crew_post: 0, crew_invite: 0, crew_assign: 'crew' });
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM boat_crew`).first()).toEqual({ n: 0 });
  });
});
