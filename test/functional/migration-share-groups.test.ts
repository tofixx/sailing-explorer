// Migrationstest 0028 (F-377): Bestand bekommt „In Gruppen zeigen“ aus den Gruppen des Boots, in denen die
// Eigentümer:in Mitglied ist – nicht mehr aus allen Gruppen der Segler:in; die Stream-Ziele werden angeglichen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;
const T = 1_700_000_000_000;

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0028' });
  const db = await h.db();
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
  for (const u of ['MigSgUserAAAAAAAA1', 'MigSgUserAAAAAAAA2']) await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', u, `${u}@example.org`, T);
  await run(`INSERT INTO boats (id, owner_id, name, created_at, updated_at) VALUES ('MigSgBoatAAAAAAAA1', 'MigSgUserAAAAAAAA1', 'Boot', ?, ?)`, T, T);
  for (const [id, owner] of [['MigSgClubAAAAAAAA1', 'MigSgUserAAAAAAAA1'], ['MigSgTeamAAAAAAAA1', 'MigSgUserAAAAAAAA1'], ['MigSgFremdAAAAAAA1', 'MigSgUserAAAAAAAA2']]) {
    await run(`INSERT INTO groups (id, kind, slug, name, owner_id, created_at, updated_at) VALUES (?, 'club', ?, ?, ?, ?, ?)`, id, id.toLowerCase(), id, owner, T, T);
  }
  // Mitglied in Verein und Team; das Boot ist Verein und fremdem Club zugeordnet (dort nicht Mitglied)
  await run(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES ('MigSgClubAAAAAAAA1', 'MigSgUserAAAAAAAA1', 'owner', ?)`, T);
  await run(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES ('MigSgTeamAAAAAAAA1', 'MigSgUserAAAAAAAA1', 'owner', ?)`, T);
  await run(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES ('MigSgFremdAAAAAAA1', 'MigSgUserAAAAAAAA2', 'owner', ?)`, T);
  await run(`INSERT INTO group_boats (group_id, boat_id, created_at) VALUES ('MigSgClubAAAAAAAA1', 'MigSgBoatAAAAAAAA1', ?)`, T);
  await run(`INSERT INTO group_boats (group_id, boat_id, created_at) VALUES ('MigSgFremdAAAAAAA1', 'MigSgBoatAAAAAAAA1', ?)`, T);
  for (const [id, boat, vis] of [['MigSgShareBoat0001', 'MigSgBoatAAAAAAAA1', 'public'], ['MigSgSharePriv0001', 'MigSgBoatAAAAAAAA1', 'private'], ['MigSgShareNone0001', null, 'public']]) {
    await run(
      `INSERT INTO shares (id, user_id, title, visibility, size_bytes, track_count, created_at, updated_at, boat_id) VALUES (?, 'MigSgUserAAAAAAAA1', 'T', ?, 1, 1, ?, ?, ?)`,
      id, vis, T, T, boat,
    );
  }
  // Alte Ziele: Törn mit Boot im Team (über die Mitgliedschaft), Törn ohne Boot in Verein und Team
  await run(`INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, data, bucket, created_at, updated_at) VALUES ('MigSgActBoat000001', 'voyage', 'MigSgUserAAAAAAAA1', 'share', 'MigSgShareBoat0001', '{}', 'voyage:MigSgShareBoat0001', ?, ?)`, T, T);
  await run(`INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, data, bucket, created_at, updated_at) VALUES ('MigSgActNone000001', 'voyage', 'MigSgUserAAAAAAAA1', 'share', 'MigSgShareNone0001', '{}', 'voyage:MigSgShareNone0001', ?, ?)`, T, T);
  await run(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES ('MigSgActBoat000001', 'group', 'MigSgTeamAAAAAAAA1', ?)`, T);
  await run(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES ('MigSgActBoat000001', 'user', 'MigSgUserAAAAAAAA1', ?)`, T);
  await run(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES ('MigSgActNone000001', 'group', 'MigSgClubAAAAAAAA1', ?)`, T);
  await run(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES ('MigSgActNone000001', 'group', 'MigSgTeamAAAAAAAA1', ?)`, T);
  expect(migrationFiles({ from: '0028' })[0]).toBe('0028_share_groups.sql');
  await applyMigrations(db, migrationFiles({ from: '0028' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-377 Migration Törns in Gruppen', () => {
  it('[F-377] Bestand: Gruppen des Boots mit Mitgliedschaft der Eigentümer:in; Ziele angeglichen', async () => {
    const db = await h.db();
    const { results } = await db.prepare('SELECT share_id, group_id FROM share_groups ORDER BY share_id').all<{ share_id: string; group_id: string }>();
    expect(results).toEqual([
      { share_id: 'MigSgShareBoat0001', group_id: 'MigSgClubAAAAAAAA1' },
      { share_id: 'MigSgSharePriv0001', group_id: 'MigSgClubAAAAAAAA1' },
    ]);
    const targets = await db.prepare('SELECT activity_id, target_kind, target_id, created_at FROM activity_target ORDER BY activity_id, target_kind').all();
    expect(targets.results).toEqual([
      { activity_id: 'MigSgActBoat000001', target_kind: 'group', target_id: 'MigSgClubAAAAAAAA1', created_at: T },
      { activity_id: 'MigSgActBoat000001', target_kind: 'user', target_id: 'MigSgUserAAAAAAAA1', created_at: T },
    ]);
  });
});
