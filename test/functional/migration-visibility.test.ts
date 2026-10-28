// Migration 0006_visibility (F-86): Altbestand im alten Schema (0001–0005) anlegen, 0006 anwenden und die
// Übernahme prüfen – Zuordnung der Stufen, erhaltene Spalten, Indizes, Fremdschlüssel und das Verhalten der API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, gzip, migrationFiles, payloadJson, startWorker, type Harness } from './worker-harness';

let h: Harness;
const T = 1_780_000_000_000;

interface ShareRow {
  id: string;
  visibility: string;
  share_key: string | null;
  listed: number;
  title: string;
  boat_id: string | null;
  dist_nm: number;
  started_at: number | null;
  has_image: number;
  expiry_warned_at: number | null;
  size_bytes: number;
}

beforeAll(async () => {
  h = await startWorker({}, { migrateBefore: '0006' });
  const db = await h.db();
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
  await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', 'MigUserAAAAAAAAAAA', 'alt@example.org', T);
  await run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', 'MigUserBBBBBBBBBBB', 'alt2@example.org', T);
  await run("INSERT INTO profiles (user_id, handle, display_name, bio, visibility, created_at, updated_at) VALUES (?, 'alt-privat', 'Alt Privat', '', 'private', ?, ?)", 'MigUserAAAAAAAAAAA', T, T);
  await run("INSERT INTO profiles (user_id, handle, display_name, bio, visibility, created_at, updated_at) VALUES (?, 'alt-offen', 'Alt Offen', '', 'public', ?, ?)", 'MigUserBBBBBBBBBBB', T, T);
  await run("INSERT INTO boats (id, owner_id, name, visibility, created_at, updated_at) VALUES ('MigBoatPrivateAAAA', ?, 'Privatboot', 'private', ?, ?)", 'MigUserAAAAAAAAAAA', T, T);
  await run("INSERT INTO boats (id, owner_id, name, visibility, created_at, updated_at) VALUES ('MigBoatPublicAAAAA', ?, 'Offenes Boot', 'public', ?, ?)", 'MigUserBBBBBBBBBBB', T, T);
  const share = (id: string, visibility: string, listed: number, extra: { boat?: string; image?: number; warned?: number } = {}) =>
    run(
      `INSERT INTO shares (id, user_id, title, summary, visibility, view, size_bytes, track_count, created_at, updated_at, boat_id, listed, dist_nm, started_at, has_image, expiry_warned_at)
       VALUES (?, 'MigUserAAAAAAAAAAA', ?, 'Kurz', ?, 'm=wind', 123, 2, ?, ?, ?, ?, 12.5, ?, ?, ?)`,
      id, `Törn ${id}`, visibility, T, T + 1, extra.boat ?? null, listed, T - 5000, extra.image ?? 0, extra.warned ?? null,
    );
  await share('MigPrivateAAAAAAAA', 'private', 0);
  await share('MigPrivateListedAA', 'private', 1, { warned: T + 7 });
  await share('MigPublicAAAAAAAAA', 'unlisted', 1, { boat: 'MigBoatPublicAAAAA', image: 1 });
  await share('MigLinkAAAAAAAAAAA', 'unlisted', 0, { boat: 'MigBoatPrivateAAAA' });
  // Track-Daten des Altbestands in R2
  const r2 = (await h.mf.getR2Bucket('TRACKS')) as unknown as { put(k: string, v: Uint8Array, o: unknown): Promise<unknown> };
  await r2.put('shares/MigLinkAAAAAAAAAAA', await gzip(payloadJson()), {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
    customMetadata: { owner: 'MigUserAAAAAAAAAAA' },
  });

  expect(migrationFiles({ from: '0006' })[0]).toBe('0006_visibility.sql');
  await applyMigrations(db, migrationFiles({ from: '0006' }));
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const row = async (id: string) => (await (await h.db()).prepare('SELECT * FROM shares WHERE id = ?').bind(id).first<ShareRow>())!;

describe('F-86 Migration 0006_visibility', () => {
  it('[F-86] private → private, unlisted+listed → public, unlisted → unlisted (ohne Schlüssel)', async () => {
    expect(await row('MigPrivateAAAAAAAA')).toMatchObject({ visibility: 'private', share_key: null, listed: 0 });
    expect(await row('MigPrivateListedAA')).toMatchObject({ visibility: 'private', share_key: null, listed: 0 });
    expect(await row('MigPublicAAAAAAAAA')).toMatchObject({ visibility: 'public', share_key: null, listed: 1 });
    expect(await row('MigLinkAAAAAAAAAAA')).toMatchObject({ visibility: 'unlisted', share_key: null, listed: 0 });
  });

  it('[F-86] alle übrigen Spalten bleiben erhalten', async () => {
    expect(await row('MigPublicAAAAAAAAA')).toMatchObject({
      title: 'Törn MigPublicAAAAAAAAA', boat_id: 'MigBoatPublicAAAAA', dist_nm: 12.5, started_at: T - 5000, has_image: 1, size_bytes: 123, expiry_warned_at: null,
    });
    expect((await row('MigPrivateListedAA')).expiry_warned_at).toBe(T + 7);
    const n = await (await h.db()).prepare('SELECT COUNT(*) AS n FROM shares').first<{ n: number }>();
    expect(n!.n).toBe(4);
  });

  it('[F-86] Boote und Profile behalten ihre Stufe und haben (noch) keinen Schlüssel', async () => {
    const db = await h.db();
    const boats = await db.prepare('SELECT id, visibility, share_key FROM boats ORDER BY id').all<{ id: string; visibility: string; share_key: string | null }>();
    expect(boats.results).toEqual([
      { id: 'MigBoatPrivateAAAA', visibility: 'private', share_key: null },
      { id: 'MigBoatPublicAAAAA', visibility: 'public', share_key: null },
    ]);
    const profiles = await db.prepare('SELECT handle, visibility, share_key FROM profiles ORDER BY handle').all();
    expect(profiles.results).toEqual([
      { handle: 'alt-offen', visibility: 'public', share_key: null },
      { handle: 'alt-privat', visibility: 'private', share_key: null },
    ]);
  });

  it('alle Indizes auf shares sind neu angelegt; kein SQL-CHECK mehr auf visibility', async () => {
    const db = await h.db();
    const idx = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'shares' AND name NOT LIKE 'sqlite_%' ORDER BY name").all<{ name: string }>();
    // alle Indizes nach allen Migrationen (0025 fügt die Fahrtenbuch-Indizes hinzu)
    expect(idx.results.map((r) => r.name)).toEqual(['shares_boat', 'shares_created', 'shares_from_harbor', 'shares_public_recent', 'shares_to_harbor', 'shares_user', 'shares_user_manual']);
    const ddl = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shares'").first<{ sql: string }>();
    expect(ddl!.sql).not.toMatch(/CHECK/i);
    expect(ddl!.sql).toContain('share_key');
    expect(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'shares_new'").first()).toBeNull();
  });

  it('Fremdschlüssel wirken weiter: Boot löschen setzt boat_id auf NULL, Konto löschen entfernt die Törns', async () => {
    const db = await h.db();
    await db.prepare("DELETE FROM boats WHERE id = 'MigBoatPublicAAAAA'").all();
    expect((await row('MigPublicAAAAAAAAA')).boat_id).toBeNull();
    await db
      .prepare("INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at) VALUES ('MigFkTestAAAAAAAAA', 'MigUserBBBBBBBBBBB', 'x', 1, 1, 1, 1)")
      .all();
    expect((await row('MigFkTestAAAAAAAAA')).visibility).toBe('public'); // neuer Spalten-Standard
    await db.prepare("DELETE FROM users WHERE id = 'MigUserBBBBBBBBBBB'").all();
    expect(await db.prepare("SELECT 1 FROM shares WHERE id = 'MigFkTestAAAAAAAAA'").first()).toBeNull();
  });

  it('[F-91] übernommener „Nur mit Link“-Törn bleibt über /s/<id> ohne Schlüssel erreichbar, ist aber nirgends gelistet', async () => {
    expect((await h.fetch('/api/shares/MigLinkAAAAAAAAAAA')).status).toBe(200);
    expect((await h.fetch('/api/shares/MigLinkAAAAAAAAAAA/data')).status).toBe(200);
    expect(await (await h.fetch('/s/MigLinkAAAAAAAAAAA')).text()).toContain('Törn MigLinkAAAAAAAAAAA · Sail Explorer');
    const d = (await (await h.fetch('/api/discover?limit=24')).json()) as { voyages: Array<{ id: string; sailor: unknown }> };
    expect(d.voyages.map((v) => v.id)).toEqual(['MigPublicAAAAAAAAA']);
    // Autor hat ein privates Profil → ohne Namen (F-82)
    expect(d.voyages[0].sailor).toBeNull();
    expect((await h.fetch('/api/shares/MigPrivateAAAAAAAA')).status).toBe(404);
    expect((await h.fetch('/api/boats/MigBoatPrivateAAAA')).status).toBe(404);
  });
});
