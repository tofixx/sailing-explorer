// Sichtbarkeit und Sperre als SQL-Bausteine (Retro R 1, F-454) – die eine Stelle für die Regel `canView`
// (worker/access.ts) in Listen, Zählungen und Streams, nach dem Vorbild von IN_LOGBOOK_SQL, reach-sql.ts und
// member-sql.ts. Ohne Abhängigkeiten zu Worker-Modulen, damit Module mit SQL-Konstanten auf oberster Ebene
// (discover.ts) sie ohne Import-Zyklus nutzen. Ein Test (test/functional/visible-sql.test.ts) hält SQL und `canView`
// für alle Kombinationen gleich. Neue Listen nutzen diese Bausteine statt der Literale (PRINCIPLES „Erweitern“ 2).
// Die Bausteine stehen in Klammern, damit sie neben OR sicher einzusetzen sind.
import type { Visibility } from '../src/domain/visibility';

const PUBLIC: Visibility = 'public';

/**
 * Öffentlich und nicht ausgeblendet (Konzept 4.4): Törn, Boot, Profil, Gruppe oder Foto mit dem Alias `a` (ohne Alias
 * die Spalten der Tabelle selbst). = `canView` für Gäste, ohne die Sperre – die prüft `liveSql` bzw. die Abfrage.
 */
export const publicSql = (a?: string): string => {
  const c = a ? `${a}.` : '';
  return `(${c}visibility = '${PUBLIC}' AND ${c}hidden_at IS NULL)`;
};

/**
 * Weder ausgeblendet noch gesperrt (Konzept 4.4, 18.2): Gruppe oder Boot mit dem Alias `a` – Häfen und Profile haben
 * keine eigene Sperre (`locked_at`), dort genügt `hidden_at IS NULL`.
 */
export const liveSql = (a: string): string => `(${a}.hidden_at IS NULL AND ${a}.locked_at IS NULL)`;

/**
 * Konto im SQL-Ausdruck `id` ist nicht gesperrt (suspendiert, Konzept 4.4): seine Inhalte verschwinden aus Listen und
 * Zählungen. Ohne Konto-Zeile gilt es als nicht gesperrt.
 */
export const notSuspendedSql = (id: string): string => `NOT EXISTS (SELECT 1 FROM users su WHERE su.id = ${id} AND su.suspended_at IS NOT NULL)`;
