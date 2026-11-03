// Fahrtenbuch in Kennzahlen (Konzept 19, F-303) – reine Zeichenkette ohne Abhängigkeiten, damit Module mit
// SQL-Konstanten auf oberster Ebene (discover.ts) sie ohne Import-Zyklus nutzen können.
import { liveSql, notSuspendedSql } from './visible-sql';

/**
 * „Ins Fahrtenbuch“ (F-422, `shares.log_state`): bestätigte und vorgeschlagene Törns zählen in Seemeilen, Törn-Zahlen,
 * Saison und Meilensteinen; ausgeschlossene (z. B. Spaziergang, Test-Track) nie – sie bleiben als Beitrag bestehen.
 * Bedingung für den Alias `s`.
 */
export const IN_LOGBOOK_SQL = `s.log_state <> 'excluded'`;

/** Summe der aufgezeichneten Seemeilen (dist_source = 'track') über Törns mit dem Alias `s`. */
export const RECORDED_NM_SQL = `COALESCE(SUM(CASE WHEN s.dist_source = 'track' THEN s.dist_nm END), 0)`;

/**
 * Crew-Ausnahme M1 (Konzept 15, 27.3): Steht ein Crew-Törn (Alias `s`, Crew-Zeile `c`) einer anderen Person im
 * Fahrtenbuch des Crew-Mitglieds? Nicht ausgeblendet, nicht gesperrt, Konto der Eigentümer:in nicht gesperrt, von ihr
 * nicht ausgeschlossen; mit bestätigter Rolle in jeder Sichtbarkeit (nur Eckdaten), sonst nur öffentlich. Bausteine aus
 * visible-sql.ts (ohne Abhängigkeiten, also kein Import-Zyklus). = `crewLogState` in src/domain/logbook-year.ts (Test hält
 * beide gleich).
 */
export const CREW_LOGBOOK_SQL =
  `${liveSql('s')} AND ${notSuspendedSql('s.user_id')} AND ${IN_LOGBOOK_SQL} AND (c.confirmed_at IS NOT NULL OR s.visibility = 'public')`;
