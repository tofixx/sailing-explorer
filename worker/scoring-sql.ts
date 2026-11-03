// Vereinsliste der Wertung (Konzept 32, F-503) als SQL-Baustein – die eine Stelle für `countsInClubList`
// (src/domain/scoring.ts) in Abfragen, nach dem Vorbild von CREW_LOGBOOK_SQL. Bausteine aus visible-sql.ts und
// logbook-sql.ts (ohne Abhängigkeiten, kein Import-Zyklus). Ein Test (test/functional/scoring.test.ts) hält SQL und
// Domain-Regel gleich.
import { IN_LOGBOOK_SQL } from './logbook-sql';
import { liveSql, notSuspendedSql, publicSql } from './visible-sql';

/**
 * Zählt der Törn mit dem Alias `s` in der Vereinsliste des Vereins im SQL-Ausdruck `club`? Die Abfrage geht von den im
 * Verein gezeigten Törns aus (`share_groups` mit dem Alias `csg`, Index `share_groups_group`); dazu öffentlich, weder
 * ausgeblendet noch gesperrt, im Fahrtenbuch, Konto nicht gesperrt, die Person nimmt teil
 * (`group_members.scoring_opt_in_at`) und die Vorlage des Eintrags ist eine Vorlage des Vereins mit Faktor.
 */
export const CLUB_LIST_FROM = 'share_groups csg JOIN shares s ON s.id = csg.share_id';
export const clubListSql = (club: string): string =>
  `csg.group_id = ${club} AND ${publicSql('s')} AND ${liveSql('s')} AND ${notSuspendedSql('s.user_id')} AND ${IN_LOGBOOK_SQL}
  AND EXISTS (SELECT 1 FROM group_members com WHERE com.group_id = ${club} AND com.user_id = s.user_id AND com.scoring_opt_in_at IS NOT NULL)
  AND json_extract(s.log, '$.templateId') IN (SELECT cst.id FROM scoring_templates cst WHERE cst.group_id = ${club} AND cst.list_weight IS NOT NULL)`;
