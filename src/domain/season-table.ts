// Jahresansicht der Fahrten und Regatten im Profil (Konzept 43, F-665 … F-669): reine Regeln ohne DOM und Netz.
// Eine Zeile je Fahrt; Saisons wie im Fahrtenbuch (`seasonOf`, ab November die nächste); Summen je Saison.
import { seasonOf } from './support';
import type { RegattaResult } from './regatta';
import type { VoyageRole } from './crew-roles';

/** Wer die Jahresansicht im Profil sieht: nur man selbst (Standard) oder alle, die das Profil sehen dürfen. */
export const SEASON_TABLE_MODES = ['private', 'public'] as const;
export type SeasonTableMode = (typeof SEASON_TABLE_MODES)[number];
export const seasonTableMode = (v: unknown): SeasonTableMode => (v === 'public' ? 'public' : 'private');

/** Eine Fahrt in der Jahresansicht – für andere nur aus öffentlichen Einträgen. */
export interface SeasonRow {
  /** Törn-Adresse, null = nicht verlinkbar (z. B. nicht öffentlicher Crew-Törn in der eigenen Ansicht) */
  path: string | null;
  title: string | null;
  startedAt: number;
  distNm: number;
  /** aufgezeichnet (`track`) oder angegeben/aus Wegpunkten */
  recorded: boolean;
  role: VoyageRole | null;
  boat: string | null;
  /** eigene Fahrt oder als Crew mitgesegelt */
  own: boolean;
  regatta: RegattaResult | null;
}

export interface SeasonSummary {
  season: number;
  voyages: number;
  nm: number;
  recordedNm: number;
  regattas: number;
  /** beste Platzierung der Saison (kleinster Platz), null = keine mit Platz */
  bestPlace: number | null;
}

/** Summen je Saison, neueste zuerst; Seemeilen auf eine Nachkommastelle. */
export function seasonSummaries(rows: SeasonRow[]): SeasonSummary[] {
  const by = new Map<number, SeasonSummary>();
  for (const r of rows) {
    const season = seasonOf(r.startedAt);
    const s = by.get(season) ?? { season, voyages: 0, nm: 0, recordedNm: 0, regattas: 0, bestPlace: null };
    s.voyages++;
    s.nm += r.distNm;
    if (r.recorded) s.recordedNm += r.distNm;
    if (r.regatta) {
      s.regattas++;
      if (r.regatta.place && (s.bestPlace === null || r.regatta.place < s.bestPlace)) s.bestPlace = r.regatta.place;
    }
    by.set(season, s);
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return [...by.values()].map((s) => ({ ...s, nm: round(s.nm), recordedNm: round(s.recordedNm) })).sort((a, b) => b.season - a.season);
}

/** Fahrten einer Saison, neueste zuerst. */
export const rowsOfSeason = (rows: SeasonRow[], season: number): SeasonRow[] =>
  rows.filter((r) => seasonOf(r.startedAt) === season).sort((a, b) => b.startedAt - a.startedAt);
