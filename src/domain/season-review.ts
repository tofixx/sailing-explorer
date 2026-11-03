// Saisonrückblick (Konzept 33, F-520, F-521): Zahlen einer Saison und Abzeichen-Reihe aus den Einträgen, die die Seite
// „Mein Fahrtenbuch“ gerade summiert – reine Regeln ohne DOM und Netz. Nur eigene Werte, keine Vergleiche (K6).
import { fmtDate, fmtNum } from './format';
import { MILESTONES_NM } from './groups';
import { calendarDaysBerlin } from './logbook-suggest';
import { countsInLogbook, type LogState } from './logbook';
import { entryHours, filterEntries, logbookSeasons, logbookTotals, recordedNote, type LogbookEntry } from './logbook-year';

/** Ein Abzeichen der Reihe (F-521). */
export interface SeasonBadge {
  /** Schwelle in Seemeilen */
  nm: number;
  reached: boolean;
  /** das nächste noch offene Abzeichen */
  next: boolean;
  /** fehlende Seemeilen (0, wenn erreicht) */
  missing: number;
  /** Fortschritt 0…1 */
  progress: number;
}

export interface SeasonReview {
  season: number;
  voyages: number;
  nm: number;
  /** davon aufgezeichnet (K3) */
  recordedNm: number;
  /** Stunden unter Segel + Motor bzw. Zeit am selben Tag mit echten Uhrzeiten */
  hours: number;
  days: number;
  boats: number;
  harbors: number;
  /** längster **aufgezeichneter** eigener Törn (K6), ohne Titel und Häfen */
  longest: { nm: number; startedAt: number } | null;
  badges: SeasonBadge[];
}

/** Abzeichen aus `MILESTONES_NM`: erreicht, das nächste mit Rest, die übrigen offen. */
export function seasonBadges(raw: number, thresholds: readonly number[] = MILESTONES_NM): SeasonBadge[] {
  // auf die gezeigte Nachkommastelle runden: 99,97 sm steht als „100,0 sm“ da und zählt dann auch als erreicht
  const nm = Math.round(raw * 10) / 10;
  const nextAt = thresholds.find((t) => nm < t);
  return thresholds.map((t) => ({
    nm: t,
    reached: nm >= t,
    next: t === nextAt,
    missing: Math.max(0, t - nm),
    progress: Math.max(0, Math.min(1, nm / t)),
  }));
}

/**
 * Stunden eines Eintrags: Angaben „unter Segel“ + „unter Motor“; ohne Angaben die Zeit von Abfahrt bis Ankunft, aber nur
 * mit echten Uhrzeiten und am selben Tag – mehrtägige Spannen enthielten Liegezeiten.
 */
export function reviewHours(e: Pick<LogbookEntry, 'startedAt' | 'endedAt' | 'timed' | 'log'>): number {
  // eine Angabe (auch 0) gilt – dann zählt die Zeitspanne nicht
  if (e.log.sailH != null || e.log.engineH != null) return (e.log.sailH ?? 0) + (e.log.engineH ?? 0);
  const h = entryHours(e);
  return h !== null && e.endedAt !== null && calendarDaysBerlin(e.startedAt, e.endedAt) === 1 ? h : 0;
}

/**
 * Rückblick über die Einträge der Ansicht (schon nach Saison und Stand gefiltert, wie die Summen der Seite);
 * ausgeschlossene zählen nie (F-422).
 */
export function seasonReview(entries: LogbookEntry[], season: number): SeasonReview {
  const t = logbookTotals(entries);
  const counted = entries.filter((e) => countsInLogbook(e.logState));
  const boats = new Set(counted.flatMap((e) => (e.boat ? [e.boat.trim().toLocaleLowerCase('de-DE')] : [])));
  let longest: SeasonReview['longest'] = null;
  for (const e of counted) {
    if (e.own && e.distSource === 'track' && e.distNm > 0 && (!longest || e.distNm > longest.nm)) longest = { nm: e.distNm, startedAt: e.startedAt };
  }
  return {
    season,
    voyages: t.count,
    nm: t.nm,
    recordedNm: t.recordedNm,
    hours: counted.reduce((s, e) => s + reviewHours(e), 0),
    days: t.days,
    boats: boats.size,
    harbors: t.harbors,
    longest,
    badges: seasonBadges(t.nm),
  };
}

/** Segellebenslauf (F-611): je Saison mit Einträgen (neueste zuerst) der Rückblick, dazu die Summen über alle. */
export interface Lifetime {
  rows: SeasonReview[];
  total: { voyages: number; nm: number; hours: number; days: number };
}

/** Rückblick je Saison über alle Einträge mit den gewählten Ständen – gleiche Regeln wie die Saison-Summen (`seasonReview`). */
export function lifetimeReview(entries: LogbookEntry[], states: readonly LogState[]): Lifetime {
  const rows = logbookSeasons(entries, 0)
    .map((s) => seasonReview(filterEntries(entries, states, s), s))
    .filter((r) => r.voyages > 0);
  const sum = (f: (r: SeasonReview) => number) => rows.reduce((a, r) => a + f(r), 0);
  return { rows, total: { voyages: sum((r) => r.voyages), nm: sum((r) => r.nm), hours: sum((r) => r.hours), days: sum((r) => r.days) } };
}

/** Dateiname des Bildes: `meine-saison-2026.jpg`. */
export const seasonImageFileName = (season: number): string => `meine-saison-${season}.jpg`;

/** Eine Kachel im Bild bzw. Dialog. */
export interface ReviewFigure {
  label: string;
  value: string;
  detail?: string;
}

const sm = (n: number) => `${fmtNum(n, 1)} sm`;

/** Kopfzahl: Seemeilen, mit „davon … aufgezeichnet“, wenn geschätzte Meilen dabei sind (K3). */
export function reviewHeadline(r: SeasonReview): ReviewFigure {
  return { label: 'Seemeilen', value: sm(r.nm), detail: recordedNote(r) };
}

/** Kacheln unter der Kopfzahl – nur vorhandene Werte (F-520). */
export function reviewFigures(r: SeasonReview): ReviewFigure[] {
  const out: ReviewFigure[] = [{ label: r.voyages === 1 ? 'Törn' : 'Törns', value: fmtNum(r.voyages, 0) }];
  if (r.hours > 0) out.push({ label: 'Stunden', value: fmtNum(r.hours, r.hours < 10 ? 1 : 0) });
  if (r.voyages) out.push({ label: r.days === 1 ? 'Tag an Bord' : 'Tage an Bord', value: fmtNum(r.days, 0) });
  if (r.boats) out.push({ label: r.boats === 1 ? 'Boot' : 'Boote', value: fmtNum(r.boats, 0) });
  if (r.harbors) out.push({ label: r.harbors === 1 ? 'Hafen' : 'Häfen', value: fmtNum(r.harbors, 0) });
  if (r.longest) out.push({ label: 'Längster Törn', value: sm(r.longest.nm), detail: fmtDate(r.longest.startedAt) });
  return out;
}

/** Beschriftung unter einem Abzeichen: „erreicht“, beim nächsten „noch 376,6 sm“, sonst leer. */
export const badgeCaption = (b: SeasonBadge): string => (b.reached ? 'erreicht' : b.next ? `noch ${sm(b.missing)}` : '');

/** Kurztext eines Abzeichens: „100 sm erreicht“, „500 sm – noch 376,6 sm“, „1.000 sm“. */
export function badgeText(b: SeasonBadge): string {
  const name = `${fmtNum(b.nm, 0)} sm`;
  if (b.reached) return `${name} erreicht`;
  return b.next ? `${name} – ${badgeCaption(b)}` : name;
}

/** Alternativtext des Bildes: alle Zahlen und Abzeichen als Satz. */
export function reviewAltText(r: SeasonReview): string {
  const figs = [reviewHeadline(r), ...reviewFigures(r)].map((f) => `${f.label} ${f.value}${f.detail ? ` (${f.detail})` : ''}`);
  return `Meine Saison ${r.season}: ${figs.join(', ')}. Abzeichen: ${r.badges.map(badgeText).join(', ')}.`;
}
