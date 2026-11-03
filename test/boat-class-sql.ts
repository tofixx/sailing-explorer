// Rückbefüllung der Bootsklasse in Migration 0042 (Konzept 34, F-538), erzeugt aus den Regeln in
// src/domain/boat-class.ts. Nur für die Migration gebraucht, deshalb hier statt im App-Code: der Migrationstest
// vergleicht die Datei mit `migration0042()` und wendet sie auf Altbestand an. Neu erzeugen nach Regeländerungen
// (nur solange 0042 nicht ausgerollt ist, sonst eine neue Migration):
//   npx tsx -e "import('./test/boat-class-sql.ts').then(m => require('fs').writeFileSync('migrations/0042_boat_class.sql', m.migration0042()))"
import { BOAT_CLASS_RULES, BOAT_TYPE_SEPARATORS } from '../src/domain/boat-class';

/** SQL-Zeichenkette (einfache Anführungszeichen verdoppelt). */
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** `foldBoatType` als SQL-Ausdruck über die Spalte `col`. */
export function boatTypeFoldSql(col: string): string {
  let folded = `lower(${col})`;
  for (const ch of BOAT_TYPE_SEPARATORS) folded = `replace(${folded}, ${sqlStr(ch)}, ' ')`;
  return `' ' || ${folded} || ' '`;
}

/**
 * `classifyBoatType` als SQL über die schon gefaltete Spalte `x`. `instr` statt `LIKE`, damit `_` und `%` keine
 * Platzhalter sind; `=`-Muster vergleichen den ganzen Typ (`trim`).
 */
export function boatClassSql(x: string): string {
  const cond = (p: string) => (p.startsWith('=') ? `trim(${x}) = ${sqlStr(p.slice(1))}` : `instr(${x}, ${sqlStr(p)}) > 0`);
  const whens = BOAT_CLASS_RULES.map(([id, ps]) => `WHEN ${ps.map(cond).join(' OR ')} THEN ${sqlStr(id)}`);
  return `CASE\n    ${whens.join('\n    ')}\n    ELSE '' END`;
}

/** Inhalt von migrations/0042_boat_class.sql (ohne Semikolon in Kommentaren – die Migration wird daran geteilt). */
export const migration0042 = (): string => `-- Bootsklasse (Konzept 34, F-535 … F-539): kuratierte Klasse je Boot für den Filter auf /entdecken. Der freie Typ
-- (\`boat_type\`) bleibt als Angabe stehen, \`boat_class\` ist eine ID aus BOAT_CLASSES (src/domain/boat-class.ts), leer =
-- nicht zugeordnet. Nur additiv: neue Spalte mit Vorgabe '', fällt mit der Bootszeile (kein eigener Löschweg).
ALTER TABLE boats ADD COLUMN boat_class TEXT NOT NULL DEFAULT '';

-- Rückbefüllung des Altbestands aus dem freien Typ. Erzeugt von test/boat-class-sql.ts (migration0042), der Test
-- test/functional/migration-boat-class.test.ts hält diese Datei, die Regeln und classifyBoatType gleich.
WITH f AS (SELECT id, ${boatTypeFoldSql('boat_type')} AS x FROM boats WHERE boat_type <> '')
UPDATE boats SET boat_class = (SELECT ${boatClassSql('f.x')} FROM f WHERE f.id = boats.id)
WHERE boat_type <> '';
`;
