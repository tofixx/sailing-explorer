// Löschzeitpunkt in SQL (Konzept 5.5): rein, ohne Worker-Typen – auch von Tests importierbar.
import { GRACE_MS, NEXT_SEASON_FROM_MONTH } from '../src/domain/support';

/**
 * 1. Januar (ms) nach der Saison eines Zeitpunkts in ms (wie seasonEnd(seasonOf(t)) in src/domain/support.ts),
 * mit `extra` Saisons dazu (Fahrtenbuch: + 1).
 */
export function seasonEndSql(t: string, extra: string | number = 0): string {
  const year = `CAST(strftime('%Y', ${t} / 1000, 'unixepoch') AS INTEGER)`;
  const late = `(CAST(strftime('%m', ${t} / 1000, 'unixepoch') AS INTEGER) > ${NEXT_SEASON_FROM_MONTH})`;
  return `CAST(ROUND((julianday(printf('%04d-01-01', ${year} + 1 + ${late} + ${extra})) - 2440587.5) * 86400000) AS INTEGER)`;
}

/**
 * Löschzeitpunkt eines Törns: 1. Februar nach seiner Saison bzw. nach der letzten unterstützten Saison (später gilt).
 * Fahrtenbuch-Einträge ohne GPX bleiben eine Saison länger (L2). Gleiche Regel wie shareExpiry() in
 * src/domain/support.ts bzw. manualExpiry() in src/domain/logbook.ts.
 */
export const EXPIRES_SQL = `(MAX(${seasonEndSql('s.created_at', "(s.source = 'manual')")}, COALESCE((SELECT MAX(valid_until) FROM supports WHERE user_id = s.user_id), 0)) + ${GRACE_MS})`;
