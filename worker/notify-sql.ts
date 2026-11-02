// Benachrichtigungs-Stufen als SQL-Baustein (Konzept 24.6, F-449) – die Regel `shouldNotify` aus
// src/domain/notifications.ts für die Empfänger-Abfragen. Die Liste der Stufen stammt aus `levelsNotifying`, damit SQL
// und Domain nie auseinanderlaufen (Test in test/notify-levels.test.ts).
import { DEFAULT_LEVEL_CHOICES, DEFAULT_NOTIFY_LEVEL, FOLLOW_DEFAULT_LEVEL, NOTIFY_LEVELS, levelsNotifying, type NotifyEvent } from '../src/domain/notifications';

const list = (l: readonly string[]) => l.map((x) => `'${x}'`).join(', ');

/**
 * Wirksame Stufe: gespeicherte Stufe der Mitgliedschaft bzw. des Folgens (`stored`, SQL-Ausdrücke, erste gültige gewinnt), sonst
 * die Voreinstellung des Kontos `u` (`notify_prefs.level`, nur gültige Werte), sonst der Standard.
 */
export const effectiveLevelSql = (...stored: string[]): string =>
  `COALESCE(${[...stored.map((x) => `CASE WHEN ${x} IN (${list(NOTIFY_LEVELS)}) THEN ${x} END`), `CASE WHEN json_valid(u.notify_prefs) AND json_extract(u.notify_prefs, '$.level') IN (${list(DEFAULT_LEVEL_CHOICES)}) THEN json_extract(u.notify_prefs, '$.level') END`, `'${DEFAULT_NOTIFY_LEVEL}'`].join(', ')})`;

/**
 * Stufe eines Folgens (Alias `f` aus einem LEFT JOIN): gespeichert oder – ohne eigene Wahl – „Nur Direktes“
 * (FOLLOW_DEFAULT_LEVEL, F-446); ohne Zeile NULL.
 */
export const followLevelSql = (f: string): string => `CASE WHEN ${f}.user_id IS NOT NULL THEN COALESCE(${f}.notify_level, '${FOLLOW_DEFAULT_LEVEL}') END`;

/** Benachrichtigt `event` bei der wirksamen Stufe? (Konto-Alias `u` muss verfügbar sein.) */
export const notifyLevelSql = (event: NotifyEvent, isDirect: boolean, ...stored: string[]): string => {
  const levels = levelsNotifying(event, isDirect);
  return levels.length ? `${effectiveLevelSql(...stored)} IN (${list(levels)})` : '0';
};

/** Verlauf nicht stumm (persönlicher Stream, Wochenmail, F-346): gespeicherte Stufe ist nicht `muted`. */
export const notMutedSql = (stored: string): string => `${stored} IS NOT 'muted'`;
