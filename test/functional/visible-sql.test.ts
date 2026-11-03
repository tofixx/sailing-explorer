// Sichtbarkeits-Bausteine (worker/visible-sql.ts, Retro R 1, F-454): SQL und die Regel `canView` (worker/access.ts)
// stimmen für alle Kombinationen aus Stufe, Ausblenden und Sperre überein – ausgewertet in derselben D1 wie im Worker.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness, type D1Like } from './worker-harness';
import { canView } from '../../worker/access';
import { liveSql, notSuspendedSql, publicSql } from '../../worker/visible-sql';
import { VISIBILITIES } from '../../src/domain/visibility';

let h: Harness;
let db: D1Like;

beforeAll(async () => {
  h = await startWorker();
  db = await h.db();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const GUEST = { manager: false, key: null };

/** Wertet `expr` für eine Zeile mit dem Alias `t` aus (1/0). */
async function evalRow(expr: string, row: { visibility: string; hidden_at: number | null; locked_at: number | null }): Promise<boolean> {
  const r = await db
    .prepare(`SELECT (${expr}) AS ok FROM (SELECT ?1 AS visibility, ?2 AS hidden_at, ?3 AS locked_at) t`)
    .bind(row.visibility, row.hidden_at, row.locked_at)
    .first<{ ok: number }>();
  return r?.ok === 1;
}

describe('F-454 Sichtbarkeits-Bausteine: SQL = canView', () => {
  const combos = VISIBILITIES.flatMap((visibility) =>
    [null, 1].flatMap((hidden_at) => [null, 1].map((locked_at) => ({ visibility, hidden_at, locked_at }))),
  );

  it('[F-454] publicSql AND liveSql = canView für Gäste (alle Stufen, ausgeblendet, gesperrt)', async () => {
    for (const row of combos) {
      const rule = canView({ visibility: row.visibility, shareKey: null, hiddenAt: row.hidden_at, lockedAt: row.locked_at }, GUEST);
      expect(await evalRow(`${publicSql('t')} AND ${liveSql('t')}`, row), JSON.stringify(row)).toBe(rule);
    }
  });

  it('[F-454] publicSql allein = canView für Gäste ohne Sperre; liveSql allein = nicht ausgeblendet und nicht gesperrt', async () => {
    for (const row of combos) {
      const unlocked = canView({ visibility: row.visibility, shareKey: null, hiddenAt: row.hidden_at, lockedAt: null }, GUEST);
      expect(await evalRow(publicSql('t'), row), JSON.stringify(row)).toBe(unlocked);
      const live = canView({ visibility: 'public', shareKey: null, hiddenAt: row.hidden_at, lockedAt: row.locked_at }, GUEST);
      expect(await evalRow(liveSql('t'), row), JSON.stringify(row)).toBe(live);
    }
    // ohne Alias: die Spalten der Tabelle selbst
    expect(publicSql()).toBe(`(visibility = 'public' AND hidden_at IS NULL)`);
  });

  it('[F-454] notSuspendedSql: gesperrtes Konto fällt heraus, aktives und fehlendes nicht', async () => {
    const now = Date.now();
    await db.prepare('INSERT INTO users (id, email, created_at, suspended_at) VALUES (?, ?, ?, ?)').bind('VisSqlActiveAAAAAA1', 'va@example.org', now, null).run();
    await db.prepare('INSERT INTO users (id, email, created_at, suspended_at) VALUES (?, ?, ?, ?)').bind('VisSqlSuspendAAAAA1', 'vs@example.org', now, now).run();
    const ok = async (id: string) => (await db.prepare(`SELECT (${notSuspendedSql('?1')}) AS ok`).bind(id).first<{ ok: number }>())?.ok === 1;
    expect(await ok('VisSqlActiveAAAAAA1')).toBe(true);
    expect(await ok('VisSqlSuspendAAAAA1')).toBe(false);
    expect(await ok('VisSqlMissingAAAAA1')).toBe(true);
  });
});

/**
 * Sperrklinke (PRINCIPLES „Erweitern“ 2): Die verbliebenen Literal-Kopien der Bausteine (Stand F-454 in Dateien
 * paralleler Branches: Streams, Benachrichtigungen, Profil, Startseite) dürfen nur weniger werden. Wer eine Datei
 * ohnehin anfasst, ersetzt sie und senkt die Zahl hier. Bekannte Lücke: andere Schreibweisen (Zeilenumbruch, andere
 * Reihenfolge, `visibility='public'`) zählt sie nicht – bewusst nicht verschärft, das Review prüft den Rest.
 */
describe('F-454 keine neuen Literal-Kopien', () => {
  const LIMITS: Array<[string, RegExp, number]> = [
    ['publicSql', /\b([a-z][a-z0-9]*)\.visibility = 'public' AND \1\.hidden_at IS NULL|(?:^|[^.\w])visibility = 'public' AND hidden_at IS NULL/g, 18],
    ['liveSql', /\b([a-z][a-z0-9]*)\.hidden_at IS NULL AND \1\.locked_at IS NULL/g, 5],
    ['notSuspendedSql', /NOT EXISTS \(SELECT 1 FROM users (\w+) WHERE \1\.id = \S+ AND \1\.suspended_at IS NOT NULL\)/g, 4],
  ];

  it('[F-454] Kopien der Regeln im Worker nehmen nicht zu', () => {
    const dir = resolve('worker');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'visible-sql.ts');
    for (const [name, re, max] of LIMITS) {
      const hits = files.flatMap((f) => [...readFileSync(resolve(dir, f), 'utf8').matchAll(re)].map(() => f));
      expect(hits.length, `${name} statt Literal benutzen (worker/visible-sql.ts); Fundstellen: ${hits.join(', ')}`).toBeLessThanOrEqual(max);
    }
  });
});
