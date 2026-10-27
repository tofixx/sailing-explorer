// Migrationstest 0014 (F-197): freie Heimathafen-Texte von Vereinen und Teams werden zu Häfen. Vorhandene Häfen
// (gleicher normalisierter Name) werden wiederverwendet, sonst entsteht je Name genau einer.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';

let h: Harness;
const T = Date.UTC(2026, 5, 1);
const OWNER = 'MigCoverOwnerAAAAA';

const GROUPS: Array<[id: string, slug: string, port: string]> = [
  ['GrpPotsdamAAAAAAAA', 'grp-potsdam', 'POTSDAM'],
  ['GrpPotsdam2AAAAAAA', 'grp-potsdam-2', ' potsdam '],
  ['GrpNeuAAAAAAAAAAAA', 'grp-neu', 'Neuer Hafen'],
  ['GrpNeu2AAAAAAAAAAA', 'grp-neu-2', 'neuer-hafen'],
  ['GrpLeerAAAAAAAAAAA', 'grp-leer', ''],
  ['GrpSlugAAAAAAAAAAA', 'grp-slug', 'Kiel Nord'],
];

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0014' });
  const db = await h.db();
  await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(OWNER, 'mig-cover@example.org', T).run();
  await db.prepare(`INSERT INTO harbors (id, slug, name, name_key, created_at, updated_at) VALUES ('HarborPotsdamAAAAA', 'potsdam', 'Potsdam', 'potsdam', ?, ?)`).bind(T, T).run();
  // Slug „kiel-nord“ gehört schon einem anders geschriebenen Hafen – der neue bekommt hafen-<id>.
  await db.prepare(`INSERT INTO harbors (id, slug, name, name_key, created_at, updated_at) VALUES ('HarborKielAAAAAAAA', 'kiel-nord', 'Kiel – Nord', 'kiel – nord', ?, ?)`).bind(T, T).run();
  for (const [id, slug, port] of GROUPS) {
    await db
      .prepare(`INSERT INTO groups (id, kind, slug, name, home_port, owner_id, created_at, updated_at) VALUES (?, 'club', ?, 'Verein', ?, ?, ?, ?)`)
      .bind(id, slug, port, OWNER, T, T)
      .run();
  }
  expect(migrationFiles({ from: '0014' })[0]).toBe('0014_covers.sql');
  await applyMigrations(db, migrationFiles({ from: '0014' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-197 Migration der Vereins-Heimathäfen', () => {
  it('[F-197] vorhandene Häfen werden wiederverwendet, neue je Name genau einmal angelegt, leere bleiben leer', async () => {
    const db = await h.db();
    const { results } = await db
      .prepare('SELECT g.id, g.home_port, g.harbor_id, h.slug FROM groups g LEFT JOIN harbors h ON h.id = g.harbor_id')
      .all<{ id: string; home_port: string; harbor_id: string | null; slug: string | null }>();
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by.GrpPotsdamAAAAAAAA).toMatchObject({ harbor_id: 'HarborPotsdamAAAAA', home_port: 'Potsdam' });
    expect(by.GrpPotsdam2AAAAAAA).toMatchObject({ harbor_id: 'HarborPotsdamAAAAA', home_port: 'Potsdam' });
    expect(by.GrpNeuAAAAAAAAAAAA.harbor_id).toBe(by.GrpNeu2AAAAAAAAAAA.harbor_id);
    expect(by.GrpNeuAAAAAAAAAAAA.slug).toBe('neuer-hafen');
    expect(['Neuer Hafen', 'neuer-hafen']).toContain(by.GrpNeuAAAAAAAAAAAA.home_port);
    expect(by.GrpLeerAAAAAAAAAAA).toMatchObject({ harbor_id: null, home_port: '' });
    expect(by.GrpSlugAAAAAAAAAAA.harbor_id).not.toBe('HarborKielAAAAAAAA');
    expect(by.GrpSlugAAAAAAAAAAA.slug).toBe(`hafen-${by.GrpSlugAAAAAAAAAAA.harbor_id}`);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM harbors').first<{ n: number }>();
    expect(count?.n).toBe(4);
  });

  it('[F-197] Titelbild-Tabelle ist angelegt, Hilfstabelle entfernt', async () => {
    const db = await h.db();
    expect(await db.prepare(`SELECT name FROM sqlite_master WHERE name = 'covers'`).first()).not.toBeNull();
    expect(await db.prepare(`SELECT name FROM sqlite_master WHERE name = 'harbor_import'`).first()).toBeNull();
  });
});
