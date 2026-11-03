// Lösch-Register (worker/cleanup-registry.ts, Retro R 3, F-451 … F-453): das Register gegen das Schema nach allen
// Migrationen. Eine neue Tabelle, eine neue Spalte `*_kind` oder ein neues R2-Präfix ohne Eintrag macht diese Tests rot –
// Prüfpunkt 6 (Löschkonzept) wird damit maschinell geprüft, bevor das Review es tut.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness, type D1Like } from './worker-harness';
import { KIND_COLUMNS, R2_PREFIXES, TABLES, type ArtWeg } from '../../worker/cleanup-registry';

let h: Harness;
let db: D1Like;

beforeAll(async () => {
  h = await startWorker();
  db = await h.db();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

/** Tabellen der App (ohne SQLite- und D1-interne). */
async function tables(): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name`)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

/** Quelltext der Worker-Module (Dateiname → Inhalt). */
const SOURCES = Object.fromEntries(
  readdirSync(resolve('worker'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(resolve('worker', f), 'utf8')]),
);
/** Von Worker-Modulen exportierte Funktionen bzw. Konstanten. */
const EXPORTS = new Set(Object.values(SOURCES).flatMap((src) => [...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1])));

const columns = async (t: string) => (await db.prepare('SELECT name FROM pragma_table_info(?)').bind(t).all<{ name: string }>()).results.map((r) => r.name);

describe('F-451 Lösch-Register: jede Tabelle hat einen Löschweg', () => {
  it('[F-451] jede Tabelle nach allen Migrationen steht im Register und umgekehrt', async () => {
    const actual = await tables();
    const missing = actual.filter((t) => !(t in TABLES));
    expect(missing, `Tabellen ohne Eintrag in worker/cleanup-registry.ts (TABLES): ${missing.join(', ')}`).toEqual([]);
    expect(Object.keys(TABLES).filter((t) => !actual.includes(t)), 'Einträge ohne Tabelle').toEqual([]);
  });

  it('[F-451] jeder Eintrag nennt einen Weg; behauptete Kaskaden gibt es als ON DELETE CASCADE', async () => {
    for (const [table, weg] of Object.entries(TABLES)) {
      expect(!!(weg.cascade?.length || weg.durch?.length || weg.nachts || weg.bleibt), `${table}: kein Löschweg`).toBe(true);
      for (const fn of weg.durch ?? []) expect(EXPORTS.has(fn), `${table}: ${fn} exportiert kein Worker-Modul`).toBe(true);
      const { results } = await db.prepare('SELECT "table" AS parent, on_delete FROM pragma_foreign_key_list(?)').bind(table).all<{ parent: string; on_delete: string }>();
      for (const parent of weg.cascade ?? []) {
        expect(results.some((fk) => fk.parent === parent && fk.on_delete === 'CASCADE'), `${table} → ${parent}: kein ON DELETE CASCADE`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- Bezüge ohne Fremdschlüssel

describe('F-452 Bezüge ohne Fremdschlüssel: jede Art ist registriert, Waisen räumt die Nacht weg', () => {
  it('[F-452] jede Spalte *_kind steht im Register (und jeder Eintrag ist eine echte Spalte)', async () => {
    const found: string[] = [];
    for (const t of await tables()) for (const c of await columns(t)) if (c.endsWith('_kind')) found.push(`${t}.${c}`);
    const missing = found.filter((k) => !(k in KIND_COLUMNS));
    expect(missing, `Spalten ohne Eintrag in worker/cleanup-registry.ts (KIND_COLUMNS): ${missing.join(', ')}`).toEqual([]);
    for (const key of Object.keys(KIND_COLUMNS)) {
      const [t, c] = key.split('.');
      expect(await columns(t), key).toContain(c);
    }
  });

  /** Eine Zeile je Tabelle, deren Bezug (`kind`, `id`) ins Leere zeigt; Pflichtspalten mit gültigen Werten. */
  const ORPHAN: Record<string, (kind: string, id: string, ctx: { user: string; post: string; now: number }) => [string, unknown[]]> = {
    'reactions.subject_kind': (k, id, c) => ['INSERT INTO reactions (subject_kind, subject_id, user_id, kind, created_at) VALUES (?, ?, ?, ?, ?)', [k, id, c.user, 'like', c.now]],
    'notifications.subject_kind': (k, id, c) => [
      'INSERT INTO notifications (id, user_id, kind, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [`n${id}`, c.user, 'comment', k, id, c.now, c.now],
    ],
    'activity.subject_kind': (k, id, c) => [
      'INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [`a${id}`, 'member', c.user, k, id, c.now, c.now],
    ],
    'activity_target.target_kind': (k, id, c) => ['INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES (?, ?, ?, ?)', [ACT, k, id, c.now]],
    'follows.target_kind': (k, id, c) => ['INSERT INTO follows (user_id, target_kind, target_id, created_at) VALUES (?, ?, ?, ?)', [c.user, k, id, c.now]],
    'channel_pins.channel_kind': (k, id, c) => ['INSERT INTO channel_pins (channel_kind, channel_id, post_id, created_at) VALUES (?, ?, ?, ?)', [k, id, c.post, c.now]],
    'claims.target_kind': (k, id, c) => ['INSERT INTO claims (id, target_kind, target_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)', [`c${id}`, k, id, c.user, c.now]],
    'reports.target_kind': (k, id, c) => ['INSERT INTO reports (id, target_kind, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)', [`r${id}`, k, id, 'spam', c.now]],
    'locks.target_kind': (k, id, c) => [
      'INSERT INTO locks (target_kind, target_id, locked_at, until, locked_by) VALUES (?, ?, ?, ?, ?)',
      [k, id, c.now, c.now + 365 * 86_400_000, c.user],
    ],
    'covers.kind': (k, id, c) => ['INSERT INTO covers (kind, object_id, ver, format, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [k, id, 'v1', 'webp', 1, c.now]],
  };
  const ACT = 'RegistryActivityAAAA1';

  const swept = Object.entries(KIND_COLUMNS).flatMap(([col, arten]) =>
    'bleibt' in arten ? [] : Object.entries(arten as Record<string, ArtWeg>).filter(([, a]) => a.waise).map(([kind]) => [col, kind] as const),
  );

  it('[F-452] jede Art nennt Aufräumfunktionen, die es gibt', () => {
    for (const [col, arten] of Object.entries(KIND_COLUMNS)) {
      if ('bleibt' in arten) continue;
      for (const [kind, a] of Object.entries(arten as Record<string, ArtWeg>)) {
        expect(a.durch.length, `${col} = '${kind}'`).toBeGreaterThan(0);
        for (const fn of a.durch) expect(EXPORTS.has(fn), `${col} = '${kind}': ${fn} exportiert kein Worker-Modul`).toBe(true);
      }
    }
  });

  it('[F-452] für jede Art mit nächtlicher Waisen-Suche gibt es hier einen Testfall', () => {
    for (const [col] of swept) expect(ORPHAN[col], `ORPHAN-Vorlage für ${col} fehlt`).toBeDefined();
  });

  it('[F-452] die Nacht entfernt jede verwaiste Zeile, deren Art Waisen-Suche verspricht', async () => {
    const now = Date.now();
    const user = 'RegistryUserAAAAAAA1';
    const post = 'RegistryPostAAAAAAA1';
    const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
    await run('INSERT INTO users (id, email, created_at, last_login) VALUES (?, ?, ?, ?)', user, 'registry@example.org', now, now);
    await run('INSERT INTO posts (id, author_id, body, created_at, kind, channel_kind, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)', post, user, 'x', now, 'text', 'user', user);
    // Aktivität mit gültigem Ziel – Träger für verwaiste Ziele (activity_target)
    await run('INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ACT, 'member', user, 'user', user, now, now);
    await run('INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES (?, ?, ?, ?)', ACT, 'user', user, now);
    const rows = swept.map(([col, kind], i) => {
      const id = `RegistryGone${String(i).padStart(4, '0')}AAAA`;
      const [sql, args] = ORPHAN[col](kind, id, { user, post, now });
      return { col, kind, id, sql, args };
    });
    for (const r of rows) await run(r.sql, ...r.args);
    // verwaiste Aktivitäten bekommen ein gültiges Ziel – sonst räumte sie schon „ohne Ziel“ weg, nicht die Waisen-Suche
    await run(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) SELECT id, 'user', ?, ? FROM activity WHERE id LIKE 'aRegistryGone%'`, user, now);

    expect((await h.scheduled()).outcome).toBe('ok');

    const left: string[] = [];
    for (const r of rows) {
      const [table, column] = r.col.split('.');
      const idCol = column === 'kind' ? 'object_id' : column.replace(/_kind$/, '_id');
      const row = await db.prepare(`SELECT 1 AS x FROM ${table} WHERE ${column} = ? AND ${idCol} = ?`).bind(r.kind, r.id).first();
      if (row) left.push(`${r.col} = '${r.kind}'`);
    }
    expect(left, 'nicht weggeräumt – Waisen-Suche in der nächtlichen Aufräumfunktion ergänzen oder waise: false').toEqual([]);
    // Kontrolle: Gültiges bleibt
    expect(await db.prepare('SELECT 1 AS x FROM activity_target WHERE activity_id = ? AND target_kind = ?').bind(ACT, 'user').first()).not.toBeNull();
  });
});

// ---------------------------------------------------------------- R2

describe('F-453 R2-Präfixe: jede Datei hat einen registrierten Schlüssel und Löschweg', () => {
  it('[F-453] jede Schlüssel-Funktion erzeugt ihr Präfix, ihre Löschwege gibt es', () => {
    for (const [prefix, { key, weg }] of Object.entries(R2_PREFIXES)) {
      // Definition: ab `export const key =` bzw. `export function key(` bis zum nächsten Export
      const def = Object.values(SOURCES)
        .map((src) => {
          const at = Math.max(src.indexOf(`export const ${key} =`), src.indexOf(`export function ${key}(`));
          return at < 0 ? undefined : src.slice(at).split('\nexport ')[0];
        })
        .find(Boolean);
      expect(def, `${key} nicht gefunden`).toBeDefined();
      expect(def, key).toContain('`' + prefix);
      for (const fn of weg.durch ?? []) expect(EXPORTS.has(fn), `${prefix}: ${fn}`).toBe(true);
    }
  });

  it('[F-453] jedes TRACKS.put im Worker schreibt über eine registrierte Schlüssel-Funktion', () => {
    const names = Object.values(R2_PREFIXES).map((p) => p.key);
    let puts = 0;
    for (const [f, src] of Object.entries(SOURCES)) {
      for (const m of src.matchAll(/TRACKS\.put\(\s*([^,]*?)\(/g)) {
        puts++;
        expect(names, `${f}: TRACKS.put mit ${m[1] || 'Literal'} – Präfix in R2_PREFIXES eintragen`).toContain(m[1]);
      }
      expect([...src.matchAll(/TRACKS\.put\(/g)].length, `${f}: TRACKS.put ohne Schlüssel-Funktion`).toBe([...src.matchAll(/TRACKS\.put\(\s*\w+\(/g)].length);
    }
    expect(puts).toBeGreaterThan(0);
  });
});
