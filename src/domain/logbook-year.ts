// Fahrtenbuch nach Jahren (Konzept 27, F-411, F-455 … F-457): reine Regeln ohne DOM und Netz – Saisons, Filter nach
// `log_state`, Summen, Crew-Ausnahme M1 und Meilennachweis als CSV. Genutzt von der Seite `/konto/fahrtenbuch` (Summen im
// Browser) und vom Worker (`GET /api/me/logbook`, `GET /api/me/logbook.csv`).
import { VOYAGE_ROLE_SHORT, type VoyageRole } from './crew-roles';
import { DIST_SOURCE_LABEL, LOG_STATES, countsInLogbook, isLogState, type DistSource, type LogState, type Logbook, type ShareSource } from './logbook';
import { calendarDaysBerlin } from './logbook-suggest';
import { seasonOf } from './support';
import type { Visibility } from './visibility';

const HOUR = 3_600_000;

/** Eine Zeile im Fahrtenbuch: eigener Törn (alle Angaben) oder Crew-Törn anderer (nur Eckdaten, M1). */
export interface LogbookEntry {
  id: string;
  /** eigener Törn – sonst Crew-Törn einer anderen Person */
  own: boolean;
  /** Link zum Törn (eigene immer, „Nur mit Link“ mit Schlüssel; Crew-Törns nur, wenn öffentlich) */
  path: string | null;
  /** Titel nur bei eigenen bzw. öffentlichen Törns */
  title: string | null;
  /** Abfahrt (ohne Zeitstempel im GPX: Zeitpunkt des Hochladens) */
  startedAt: number;
  endedAt: number | null;
  /** echte Uhrzeiten (GPX mit Zeitstempeln oder Eintrag mit Uhrzeit) – sonst zählt nur das Datum */
  timed: boolean;
  source: ShareSource;
  distNm: number;
  distSource: DistSource;
  from: { slug: string; name: string } | null;
  to: { slug: string; name: string } | null;
  role: VoyageRole | null;
  /** Rolle von der Skipper:in bestätigt (Konzept 15) */
  roleConfirmed: boolean;
  boat: string | null;
  logState: LogState;
  /** Zusatzangaben für Summen und Liste (ohne Notizen, Liegeplatz, Segelführung); Crew-Törns: leer */
  log: Logbook;
}

/** Höchstens so viele Einträge liefert `GET /api/me/logbook` (eigene und Crew zusammen). */
export const LOGBOOK_MAX_ENTRIES = 1000;

/** Saison eines Eintrags – wie überall (ab November zählt zur nächsten Saison). */
export const entrySeason = (e: Pick<LogbookEntry, 'startedAt'>): number => seasonOf(e.startedAt);

/** Saisons mit Einträgen, neueste zuerst; ohne Einträge die laufende. */
export function logbookSeasons(entries: Array<Pick<LogbookEntry, 'startedAt'>>, now: number): number[] {
  const set = new Set(entries.map(entrySeason));
  if (!set.size) set.add(seasonOf(now));
  return [...set].sort((a, b) => b - a);
}

/** Standard-Filter (B14): Bestätigte und Vorschläge – Ausgeschlossene nur auf Wunsch. */
export const DEFAULT_LOG_FILTER: readonly LogState[] = ['confirmed', 'suggested'];

export const LOG_FILTER_LABEL: Record<LogState, string> = { confirmed: 'Bestätigt', suggested: 'Vorschläge', excluded: 'Ausgeschlossen' };

/** Filter aus der Adresse bzw. Anfrage lesen (`confirmed,suggested`); Unbekanntes fällt weg, leer = Standard. */
export function parseLogFilter(raw: string | null | undefined): LogState[] {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(isLogState);
  const unique = LOG_STATES.filter((s) => list.includes(s));
  return unique.length ? unique : [...DEFAULT_LOG_FILTER];
}

/** Einträge einer Saison (null = alle) mit einem der gewählten Stände. */
export function filterEntries<T extends Pick<LogbookEntry, 'startedAt' | 'logState'>>(entries: T[], states: readonly LogState[], season: number | null): T[] {
  return entries.filter((e) => states.includes(e.logState) && (season === null || entrySeason(e) === season));
}

/**
 * Crew-Ausnahme M1 (Konzept 15, 27.3) als Regel: Steht ein Crew-Törn einer anderen Person in meinem Fahrtenbuch – und
 * mit welchem Stand? Nie ausgeblendete, gesperrte, von der Eigentümer:in ausgeschlossene Törns und keine Törns gesperrter
 * Konten (Konzept 4.4); mit bestätigter Rolle in jeder Sichtbarkeit (nur Eckdaten), sonst nur öffentliche als Vorschlag.
 * = `CREW_LOGBOOK_SQL`.
 */
export function crewLogState(s: { confirmed: boolean; visibility: Visibility; hidden: boolean; locked: boolean; ownerSuspended: boolean; ownerState: LogState }): LogState | null {
  if (s.hidden || s.locked || s.ownerSuspended || !countsInLogbook(s.ownerState)) return null;
  if (s.confirmed) return 'confirmed';
  return s.visibility === 'public' ? 'suggested' : null;
}

/** Dauer in Stunden (nur mit echten Uhrzeiten), sonst null. */
export function entryHours(e: Pick<LogbookEntry, 'startedAt' | 'endedAt' | 'timed'>): number | null {
  return e.timed && e.endedAt !== null && e.endedAt > e.startedAt ? (e.endedAt - e.startedAt) / HOUR : null;
}

/** Tage an Bord: Angabe, sonst Kalendertage von Abfahrt bis Ankunft (Ortszeit). */
export const entryDays = (e: Pick<LogbookEntry, 'startedAt' | 'endedAt' | 'log'>): number =>
  e.log.daysAboard ?? calendarDaysBerlin(e.startedAt, e.endedAt ?? e.startedAt);

export interface LogbookTotals {
  count: number;
  nm: number;
  /** davon aufgezeichnet (`dist_source = 'track'`, K3) */
  recordedNm: number;
  sailH: number;
  engineH: number;
  /** Seemeilen als Skipper:in */
  skipperNm: number;
  nightH: number;
  days: number;
  /** verschiedene Häfen (Start und Ziel) */
  harbors: number;
  /** Seemeilen an der Küste bzw. offshore */
  coastalNm: number;
  /** Einträge im Tidengewässer */
  tidal: number;
  locks: number;
  bridges: number;
  mast: number;
  /** Posten mit Summe, nach Name zusammengefasst (Groß-/Kleinschreibung egal), größte zuerst */
  items: Array<{ name: string; n: number }>;
}

/** Summen über Einträge – ausgeschlossene zählen nie (F-422), auch wenn der Filter sie zeigt. */
export function logbookTotals(entries: LogbookEntry[]): LogbookTotals {
  const t: LogbookTotals = { count: 0, nm: 0, recordedNm: 0, sailH: 0, engineH: 0, skipperNm: 0, nightH: 0, days: 0, harbors: 0, coastalNm: 0, tidal: 0, locks: 0, bridges: 0, mast: 0, items: [] };
  const harbors = new Set<string>();
  const items = new Map<string, { name: string; n: number }>();
  for (const e of entries) {
    if (!countsInLogbook(e.logState)) continue;
    const log = e.log;
    t.count++;
    t.nm += e.distNm;
    if (e.distSource === 'track') t.recordedNm += e.distNm;
    if (e.role === 'skipper') t.skipperNm += e.distNm;
    if (log.area === 'coastal' || log.area === 'offshore') t.coastalNm += e.distNm;
    if (log.tidal) t.tidal++;
    t.sailH += log.sailH ?? 0;
    t.engineH += log.engineH ?? 0;
    t.nightH += log.nightH ?? 0;
    t.locks += log.locks ?? 0;
    t.bridges += log.bridges ?? 0;
    t.mast += log.mast ?? 0;
    t.days += entryDays(e);
    for (const h of [e.from, e.to]) if (h) harbors.add(h.slug);
    for (const it of log.items ?? []) {
      const key = it.name.toLocaleLowerCase('de-DE');
      const sum = items.get(key) ?? { name: it.name, n: 0 };
      sum.n += it.n;
      items.set(key, sum);
    }
  }
  t.harbors = harbors.size;
  t.items = [...items.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'));
  return t;
}

// ---------------------------------------------------------------- Meilennachweis als CSV (F-457)

/** Kopfzeile des Meilennachweises (Konzept 19.6, 27.5). */
export const CSV_HEADER = ['Datum', 'Von', 'Nach', 'sm', 'Quelle', 'Rolle', 'Boot', 'Dauer'] as const;

const comma = (n: number, d = 1) => n.toFixed(d).replace('.', ',');
const berlinDate = (t: number) => new Date(t).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Eine Zelle: Formeln entschärfen (`= + - @` am Anfang), bei Trennzeichen, Anführungszeichen und Zeilenumbruch quoten. */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Dauer für den Nachweis: „3,5 h“ mit Uhrzeiten, sonst „2 Tage“ bei mehrtägigen Einträgen, sonst leer. */
export function durationText(e: Pick<LogbookEntry, 'startedAt' | 'endedAt' | 'timed'>): string {
  const h = entryHours(e);
  if (h !== null) return `${comma(h)} h`;
  if (e.endedAt === null) return '';
  const days = calendarDaysBerlin(e.startedAt, e.endedAt);
  return days > 1 ? `${days} Tage` : '';
}

/** Rolle mit Bestätigung: „Skipper:in (bestätigt)“. */
export const roleText = (e: Pick<LogbookEntry, 'role' | 'roleConfirmed'>): string =>
  e.role ? `${VOYAGE_ROLE_SHORT[e.role]}${e.roleConfirmed ? ' (bestätigt)' : ''}` : '';

/**
 * Meilennachweis als CSV: Datum; Von; Nach; sm; Quelle; Rolle; Boot; Dauer – Semikolon, UTF-8 mit BOM (öffnet in Excel),
 * Zeilenende CRLF, älteste zuerst. Rundtörns nennen bei „Nach“ den Starthafen. `truncated`: Hinweiszeile am Ende.
 */
export function logbookCsv(entries: LogbookEntry[], truncated = false): string {
  const rows = [...entries]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((e) => [
      berlinDate(e.startedAt),
      e.from?.name ?? '',
      e.to?.name ?? e.from?.name ?? '',
      comma(e.distNm),
      DIST_SOURCE_LABEL[e.distSource],
      roleText(e),
      e.boat ?? '',
      durationText(e),
    ]);
  // gekappt (mehr als LOGBOOK_MAX_ENTRIES): Hinweis als letzte Zeile, damit der Nachweis nicht unbemerkt unvollständig ist
  const note = truncated ? [[`Hinweis: nur die neuesten ${LOGBOOK_MAX_ENTRIES} Einträge – ältere fehlen in dieser Datei.`]] : [];
  return '\uFEFF' + [CSV_HEADER as readonly string[], ...rows, ...note].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Dateiname des Exports: `meilennachweis-2026.csv` bzw. `meilennachweis.csv` (alle Jahre). */
export const csvFileName = (season: number | null) => `meilennachweis${season ? `-${season}` : ''}.csv`;
