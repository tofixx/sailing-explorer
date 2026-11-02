// „Sichtbar bis“ als SQL-Fragment (Konzept 21.2, B2, F-409, F-427) – die eine Stelle für die Regel in Abfragen, nach
// dem Vorbild von IN_LOGBOOK_SQL. Die Stufen stammen aus REACH_RANK (src/domain/posts.ts), damit SQL und `reachCovers`
// nie auseinanderlaufen (Test in test/posts.test.ts).
import { reachesAtLeast, type Reach } from '../src/domain/posts';

/**
 * „Sichtbar bis“ der Post-Zeile mit der ID im SQL-Ausdruck `idExpr` deckt `level` ab. Ohne Post-Zeile (Altbestand vor
 * 0029) gilt „überall“ wie bisher.
 */
export const reachAtLeastSql = (idExpr: string, level: Reach): string =>
  `COALESCE((SELECT reach FROM posts WHERE id = ${idExpr}), 'all') IN (${reachesAtLeast(level).map((r) => `'${r}'`).join(', ')})`;
