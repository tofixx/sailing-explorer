// Regatten (Konzept 42, F-645 … F-654): reine Regeln ohne DOM und Netz. Eine Regatta ist ein Fahrtenbuch-Eintrag mit
// Angaben in `log.regatta` (K1, kein eigenes Objekt). Hier stehen Zeilen für „Meine Regatten“, der
// CSV-Export und das Bündeln der Vereinsübersicht nach Regatta – gleich für Worker und Oberfläche.
import { boatClassLabel } from './boat-class';
import { seasonOf, shownSeason } from './support';
import { csvCell, roleText } from './logbook-year';
import type { LogbookEntry } from './logbook-year';
import type { Logbook } from './logbook';
import { VOYAGE_ROLE_SHORT, type VoyageRole } from './crew-roles';

export type RegattaResult = NonNullable<Logbook['regatta']>;

/** „Platz 3 von 20“, „Platz 3“, „20 Starter“ oder leer. */
export function placeText(r: Pick<RegattaResult, 'place' | 'starters'>): string {
  if (r.place && r.starters) return `Platz ${r.place} von ${r.starters}`;
  if (r.place) return `Platz ${r.place}`;
  return r.starters ? `${r.starters} Starter` : '';
}

/** Weitere Angaben in einer Zeile: Wettfahrten, Punkte, Klasse. */
export function resultDetails(r: RegattaResult): string {
  return [
    r.races ? `${r.races} ${r.races === 1 ? 'Wettfahrt' : 'Wettfahrten'}` : '',
    r.points !== undefined ? `${String(r.points).replace('.', ',')} Pkt.` : '',
    r.boatClass ? boatClassLabel(r.boatClass) : '',
  ].filter(Boolean).join(' · ');
}

/** Einträge mit Regatta-Angaben (eigene und Crew-Törns), neueste zuerst. */
export const regattaEntries = (entries: LogbookEntry[]): Array<LogbookEntry & { log: Logbook & { regatta: RegattaResult } }> =>
  entries.filter((e): e is LogbookEntry & { log: Logbook & { regatta: RegattaResult } } => !!e.log.regatta).sort((a, b) => b.startedAt - a.startedAt);

export const REGATTA_CSV_HEADER = ['Datum', 'Regatta', 'Veranstalter', 'Klasse', 'Boot', 'Rolle', 'Platz', 'Starter', 'Wettfahrten', 'Punkte'] as const;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Regatta-Ergebnisse als CSV (F-648): eine Zeile je Regatta, Semikolon, Formel-Schutz über `csvCell`. Klasse aus der
 * Angabe zur Regatta, sonst aus dem Boot. `truncated`: Hinweis, dass ältere Einträge fehlen.
 */
export function regattaCsv(entries: LogbookEntry[], truncated = false): string {
  const rows = regattaEntries(entries).map((e) => {
    const r = e.log.regatta;
    return [
      day(e.startedAt), r.name, r.organizer ?? '', boatClassLabel(r.boatClass ?? e.boatClass ?? ''), e.boat ?? '', roleText(e),
      r.place ? String(r.place) : '', r.starters ? String(r.starters) : '', r.races ? String(r.races) : '',
      r.points !== undefined ? String(r.points).replace('.', ',') : '',
    ].map(csvCell).join(';');
  });
  const lines = [REGATTA_CSV_HEADER.join(';'), ...rows];
  if (truncated) lines.push('', csvCell('Nur die neuesten Einträge – ältere fehlen.'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Dateiname des Exports. */
export const regattaCsvName = (season: number | 'alle') => `regatten-${season}.csv`;

/** Eine freigegebene Platzierung in der Übersicht eines Vereins bzw. einer Klassenvereinigung. */
export interface ClubRegattaRow {
  /** Törn-Adresse nur bei öffentlichem Törn */
  path: string | null;
  startedAt: number;
  regatta: RegattaResult;
  person: { name: string; handle: string | null };
  role: VoyageRole | null;
  boat: string | null;
  boatClass: string | null;
}

export interface ClubRegatta {
  name: string;
  /** erster Tag (bei mehreren Meldungen der früheste) */
  startedAt: number;
  organizer: string | null;
  results: ClubRegattaRow[];
}

/**
 * Übersicht nach Regatta (F-650): gleiche Regatta = gleicher Name (ohne Groß-/Kleinschreibung) in derselben Woche;
 * Ergebnisse darin nach Platz (ohne Platz zuletzt). Neueste Regatta zuerst. Keine Rangliste über Regatten hinweg (K6).
 */
export function groupRegattas(rows: ClubRegattaRow[]): ClubRegatta[] {
  const WEEK = 7 * 86_400_000;
  const out: ClubRegatta[] = [];
  for (const r of [...rows].sort((a, b) => a.startedAt - b.startedAt)) {
    const key = r.regatta.name.trim().toLowerCase();
    const hit = out.find((g) => g.name.trim().toLowerCase() === key && r.startedAt - g.startedAt < WEEK);
    if (hit) {
      hit.results.push(r);
      hit.organizer ??= r.regatta.organizer ?? null;
    } else out.push({ name: r.regatta.name, startedAt: r.startedAt, organizer: r.regatta.organizer ?? null, results: [r] });
  }
  const byPlace = (a: ClubRegattaRow, b: ClubRegattaRow) => (a.regatta.place ?? Infinity) - (b.regatta.place ?? Infinity);
  return out.map((g) => ({ ...g, results: g.results.sort(byPlace) })).sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Wählbare Saisons der Vereinsübersicht, neueste zuerst: ab November auch die schon begonnene nächste (`seasonOf`),
 * dann die vorgewählte (`shownSeason`) und die davor – insgesamt `n` bzw. eine mehr.
 */
export function regattaSeasons(now: number, n = 5): number[] {
  const top = Math.max(seasonOf(now), shownSeason(now));
  return Array.from({ length: n + (top - shownSeason(now)) }, (_, i) => top - i);
}

/** Rolle kurz für Listen („Skipper:in“); ohne Rolle leer. */
export const roleShort = (r: VoyageRole | null): string => (r ? VOYAGE_ROLE_SHORT[r] : '');
