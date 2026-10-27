// Migrationstest 0012 (F-175): freie Heimathafen-Texte werden zu Häfen – je normalisiertem Namen genau einer, die
// Boote werden zugeordnet. Die SQL-Normalisierung muss exakt harborKey (src/domain/harbors.ts) entsprechen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, startWorker, type Harness } from './worker-harness';
import { harborKey } from '../../src/domain/harbors';

let h: Harness;
const T = Date.UTC(2026, 5, 1);

const NAMES: Array<[boat: string, port: string]> = [
  ['BoatPotsdamWestAAA', 'Potsdam-West'],
  ['BoatPotsdamWest2AA', 'potsdam west'],
  ['BoatPotsdamWest3AA', 'POTSDAM  –  West'],
  ['BoatKielAAAAAAAAAA', ' Hafen (Kiel) '],
  ['BoatKiel2AAAAAAAAA', 'Hafen Kiel'],
  ['BoatAergerAAAAAAAA', 'Ärger-Hafen'],
  ['BoatAerger2AAAAAAA', 'aerger hafen'],
  ['BoatStrasseAAAAAAA', 'Große Straße; Steg 3'],
  ['BoatSpanishAAAAAAA', 'Ñandú'],
  ['BoatQuoteAAAAAAAAA', `Sankt "Peter's" Ording/Nord & Co.+`],
  ['BoatEmptyAAAAAAAAA', ''],
  ['BoatDotsAAAAAAAAAA', '...'],
];

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0012' });
  const db = await h.db();
  await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind('MigUserAAAAAAAAAAA', 'mig@example.org', T).run();
  for (const [id, port] of NAMES) {
    await db
      .prepare(`INSERT INTO boats (id, owner_id, name, home_port, visibility, created_at, updated_at) VALUES (?, 'MigUserAAAAAAAAAAA', 'Boot', ?, 'public', ?, ?)`)
      .bind(id, port, T, T)
      .run();
  }
  expect(migrationFiles({ from: '0012' })[0]).toBe('0012_social.sql');
  await applyMigrations(db, migrationFiles({ from: '0012' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

describe('F-175 Migration der Heimathäfen', () => {
  it('[F-175] je normalisiertem Namen genau ein Hafen; SQL-Schlüssel = harborKey', async () => {
    const db = await h.db();
    const { results } = await db.prepare('SELECT id, slug, name, name_key FROM harbors ORDER BY name_key').all<{ id: string; slug: string; name: string; name_key: string }>();
    const expected = [...new Set(NAMES.map(([, p]) => harborKey(p.trim())).filter(Boolean))].sort();
    expect(results.map((r) => r.name_key).sort()).toEqual(expected);
    // Stichproben der Regel
    expect(harborKey('Potsdam-West')).toBe('potsdam west');
    expect(harborKey('POTSDAM  –  West')).toBe('potsdam – west');
    expect(harborKey(' Hafen (Kiel) ')).toBe('hafen kiel');
    expect(harborKey('Ärger-Hafen')).toBe('aerger hafen');
    expect(harborKey('Große Straße; Steg 3')).toBe('grosse strasse steg 3');
    expect(harborKey('...')).toBe('');
  });

  it('[F-175] Boote sind zugeordnet, home_port ist der Hafenname; leere bleiben ohne Hafen', async () => {
    const db = await h.db();
    const { results } = await db
      .prepare('SELECT b.id, b.home_port, b.harbor_id, h.name, h.name_key FROM boats b LEFT JOIN harbors h ON h.id = b.harbor_id')
      .all<{ id: string; home_port: string; harbor_id: string | null; name: string | null; name_key: string | null }>();
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    for (const [id, port] of NAMES) {
      const key = harborKey(port.trim());
      if (!key) {
        expect(by[id].harbor_id, id).toBeNull();
        continue;
      }
      expect(by[id].name_key, id).toBe(key);
      expect(by[id].home_port, id).toBe(by[id].name);
    }
    expect(by.BoatPotsdamWestAAA.harbor_id).toBe(by.BoatPotsdamWest2AA.harbor_id);
    expect(by.BoatKielAAAAAAAAAA.harbor_id).toBe(by.BoatKiel2AAAAAAAAA.harbor_id);
    expect(by.BoatAergerAAAAAAAA.harbor_id).toBe(by.BoatAerger2AAAAAAA.harbor_id);
    expect(by.BoatPotsdamWest3AA.harbor_id).not.toBe(by.BoatPotsdamWestAAA.harbor_id); // Gedankenstrich ist kein Satzzeichen der Regel
  });

  it('[F-175] Slugs: a–z, 0–9, Bindestrich; andere Zeichen → hafen-<id>; eindeutig; Seite und API erreichbar', async () => {
    const db = await h.db();
    const { results } = await db.prepare('SELECT id, slug, name_key FROM harbors').all<{ id: string; slug: string; name_key: string }>();
    for (const r of results) expect(r.slug).toMatch(/^[a-z0-9-]{1,100}$/);
    expect(new Set(results.map((r) => r.slug)).size).toBe(results.length);
    const kiel = results.find((r) => r.name_key === 'hafen kiel')!;
    expect(kiel.slug).toBe('hafen-kiel');
    const nandu = results.find((r) => r.name_key === harborKey('Ñandú'))!;
    expect(nandu.slug).toBe(`hafen-${nandu.id}`);
    const res = await h.fetch('/api/harbors/slug/hafen-kiel');
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { harbor: { name: string }; boats: Array<{ id: string }> };
    expect(body.harbor.name).toBe('Hafen (Kiel)');
    expect(body.boats.map((b) => b.id).sort()).toEqual(['BoatKiel2AAAAAAAAA', 'BoatKielAAAAAAAAAA']);
    const page = await h.fetch('/h/hafen-kiel');
    expect(await page.text()).toContain('<title>Hafen Hafen (Kiel) · Sail Explorer</title>');
  });

  it('[F-175] nach der Migration erkennt das Anlegen die Dubletten (gleiche Regel in SQL und TypeScript)', async () => {
    const db = await h.db();
    // Konto mit Session anlegen geht über den normalen Login – hier reicht der Abgleich per Abfrage
    for (const variant of ['Potsdam West', 'POTSDAM-west', 'Hafen Kiel', 'Aerger-Hafen', 'Sankt Peter s Ording Nord Co']) {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM harbors WHERE name_key = ?').bind(harborKey(variant)).first<{ n: number }>();
      expect(row?.n, variant).toBe(1);
    }
  });
});
