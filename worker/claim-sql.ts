// Verifizierung (Konzept 20.5): reine SQL-Bausteine ohne Abhängigkeiten – auch von Tests direkt prüfbar.
import type { ClaimKind } from '../src/domain/claims';

/**
 * SQL-Bedingung „Konto :user ist für Objekt :kind/:id verdrängt“ (angenommener Antrag mit ihm als bisheriger
 * Eigner:in). `user` und `id` sind SQL-Ausdrücke (Spalten oder Parameter), `kind` ein fester Wert.
 */
export const displacedSql = (kind: ClaimKind, id: string, user: string): string =>
  `EXISTS (SELECT 1 FROM claims dc WHERE dc.target_kind = '${kind === 'group' ? 'group' : 'harbor'}' AND dc.target_id = ${id}
     AND dc.status = 'accepted' AND dc.previous_user_id = ${user})`;

/**
 * Hafen ?1 darf über „wer zuerst die Position setzt“ (Fahrtenbuch L3) übernommen werden: nie, wenn er verifiziert ist
 * oder je verifiziert wurde (angenommener Antrag besteht) – damit auch nie von Verdrängten, die es nur dort gibt. Dort
 * setzt nur die Moderation eine neue Anleger:in. Liefert eine Zeile, wenn die Übernahme erlaubt ist.
 */
export const ADOPTABLE_HARBOR_SQL = `SELECT 1 AS ok FROM harbors h WHERE h.id = ?1 AND h.verified_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.target_kind = 'harbor' AND c.target_id = h.id AND c.status = 'accepted')`;
