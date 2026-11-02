// Fahrtenbuch in Kennzahlen (Konzept 19, F-303) – reine Zeichenkette ohne Abhängigkeiten, damit Module mit
// SQL-Konstanten auf oberster Ebene (discover.ts) sie ohne Import-Zyklus nutzen können.

/**
 * „Ins Fahrtenbuch“ (F-422, `shares.log_state`): bestätigte und vorgeschlagene Törns zählen in Seemeilen, Törn-Zahlen,
 * Saison und Meilensteinen; ausgeschlossene (z. B. Spaziergang, Test-Track) nie – sie bleiben als Beitrag bestehen.
 * Bedingung für den Alias `s`.
 */
export const IN_LOGBOOK_SQL = `s.log_state <> 'excluded'`;

/** Summe der aufgezeichneten Seemeilen (dist_source = 'track') über Törns mit dem Alias `s`. */
export const RECORDED_NM_SQL = `COALESCE(SUM(CASE WHEN s.dist_source = 'track' THEN s.dist_nm END), 0)`;
