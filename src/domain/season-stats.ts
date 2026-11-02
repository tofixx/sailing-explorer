// Saison-Zahlen der Community für die Startseite der Gäste (F-431, Konzept 22): öffentliche Törns, Seemeilen und aktive
// Boote im laufenden Kalenderjahr – dieselbe Saison wie in den Kennzahlen von Gruppe und Hafen.

export interface SeasonStats {
  /** Kalenderjahr (UTC) */
  season: number;
  voyages: number;
  /** Seemeilen, gerundet */
  nm: number;
  /** Boote mit mindestens einem dieser Törns */
  boats: number;
}

/** Darunter wirken Zahlen leer – die Folie zeigt dann nur Text (F-431). */
export const SEASON_STATS_MIN = { voyages: 10, boats: 3 } as const;

/** Beginn der Saison (Kalenderjahr, UTC) eines Zeitpunkts in ms. */
export const seasonStart = (now: number): number => Date.UTC(new Date(now).getUTCFullYear(), 0, 1);

/** Lohnen die Zahlen das Zeigen? */
export const seasonStatsShown = (s: SeasonStats | null | undefined): s is SeasonStats =>
  !!s && s.voyages >= SEASON_STATS_MIN.voyages && s.boats >= SEASON_STATS_MIN.boats;
