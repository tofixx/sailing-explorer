// Fahrtenbuch in Kennzahlen (Konzept 19, F-303) – reine Zeichenkette ohne Abhängigkeiten, damit Module mit
// SQL-Konstanten auf oberster Ebene (discover.ts) sie ohne Import-Zyklus nutzen können.

/** Summe der aufgezeichneten Seemeilen (dist_source = 'track') über Törns mit dem Alias `s`. */
export const RECORDED_NM_SQL = `COALESCE(SUM(CASE WHEN s.dist_source = 'track' THEN s.dist_nm END), 0)`;
