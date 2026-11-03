// Fahrtenbuch (Konzept 19, F-300 … F-312): Törns ohne GPX und Fahrtenbuch-Angaben an jedem Törn. Reine Regeln ohne DOM
// und Netz – genutzt vom Worker (Prüfen, Anlegen) und von der Oberfläche (Formular, Anzeige, Plausibilität vorab).
import { cleanComment, commentLength } from './comment-text';
import { METERS_PER_NM, haversine } from './geo';
import { fmtNum } from './format';
import { GRACE_MS, seasonEnd, seasonOf } from './support';
import type { Track, TrackPoint } from './types';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Herkunft eines Törns: GPX-Datei oder Fahrtenbuch-Eintrag ohne Aufzeichnung. */
export type ShareSource = 'gpx' | 'manual';
/** Herkunft der Distanz (Konzept 19.3, K3): aufgezeichnet, aus der Route berechnet, vom Segler angegeben. */
export type DistSource = 'track' | 'route' | 'stated';

export const isShareSource = (v: unknown): v is ShareSource => v === 'gpx' || v === 'manual';
export const isDistSource = (v: unknown): v is DistSource => v === 'track' || v === 'route' || v === 'stated';

/** Grenzen (Konzept 19.5, L1, L6, L8). */
export const LOG_LIMITS = {
  /** Fahrtenbuch-Einträge je Saison der Abfahrt – für alle Stufen gleich (L1) */
  perSeason: 100,
  /** neue Einträge je Konto und Tag */
  perDay: 20,
  /** Strecke je Eintrag (sm) */
  maxNm: 2000,
  /** mehrtägig höchstens so viele Tage */
  maxDays: 30,
  /** mit Uhrzeiten: höchstens so schnell im Mittel (kn) */
  maxKn: 15,
  /** ohne Uhrzeiten: höchstens so viele sm je Kalendertag */
  nmPerDay: 120,
  /** Abfahrt höchstens so viele Jahre zurück */
  maxAgeYears: 5,
  /** Payload in R2 (Route, später Wetter), gzip */
  payloadBytes: 32 * 1024,
  engineMaxH: 500,
  bftMax: 12,
  sailsMax: 120,
  berthMax: 120,
  notesMax: 2000,
  // Zusatzangaben (Konzept 27.4, F-412)
  hoursMax: 500,
  daysMax: 60,
  countMax: 200,
  mastMax: 50,
  regattaNameMax: 80,
  regattaMax: 999,
  itemsMax: 10,
  itemNameMax: 40,
  itemNoteMax: 200,
  itemCountMax: 999,
  /** ganze Angaben als JSON (Spalte `shares.log`, Zeichen) – Notizen und zehn volle Posten passen hinein */
  logChars: 8000,
} as const;

/** GPX-Plausibilität (L8, Konzept 19.5.1): großzügig, auch für Motor und schnelle Boote. */
export const GPX_LIMITS = { maxNm: 2000, maxDays: 60, maxKn: 30 } as const;

export const WIND_DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as const;
export type WindDir = (typeof WIND_DIRS)[number];
export const SEA_STATES = ['calm', 'slight', 'moderate', 'rough'] as const;
export type SeaState = (typeof SEA_STATES)[number];
export const SEA_LABEL: Record<SeaState, string> = { calm: 'glatt', slight: 'leicht', moderate: 'mäßig', rough: 'grob' };

/** Revier (B10, Konzept 27.4): schaltet die passenden Zusatzangaben um. */
export const LOG_AREAS = ['inland', 'coastal', 'offshore'] as const;
export type LogArea = (typeof LOG_AREAS)[number];
export const LOG_AREA_LABEL: Record<LogArea, string> = { inland: 'Binnen', coastal: 'Küste', offshore: 'Offshore' };
/** Felder nur für Binnenreviere bzw. nur für Küste/offshore – ohne Revier gibt es nur die gemeinsamen. */
export const INLAND_FIELDS = ['locks', 'bridges', 'mast'] as const;
export const COASTAL_FIELDS = ['nightH', 'tidal'] as const;
export type AreaField = (typeof INLAND_FIELDS)[number] | (typeof COASTAL_FIELDS)[number];
/** Gibt es das Feld im Revier? */
export const fieldInArea = (field: AreaField, area: LogArea | undefined): boolean =>
  (INLAND_FIELDS as readonly string[]).includes(field) ? area === 'inland' : area === 'coastal' || area === 'offshore';

/** Posten (B10): frei wählbarer Zusatz mit Anzahl und Begründung, z. B. Training, Arbeitsdienst, Überführung. */
export interface LogItem {
  name: string;
  n: number;
  note?: string;
}

/**
 * Fahrtenbuch-Angaben eines Törns (Spalte `shares.log`, JSON höchstens 8.000 Zeichen). Die eigene Rolle steht nicht hier, sondern in
 * `shares.owner_role` (Crew-Rollen, Konzept 15).
 */
export interface Logbook {
  /** Motorstunden, 0,1 h */
  engineH?: number;
  wind?: { bft: number; dir: WindDir | null };
  sea?: SeaState;
  sails?: string;
  berth?: string;
  notes?: string;
  /** nur Fahrtenbuch-Einträge: Abfahrt/Ankunft mit Uhrzeit angegeben (sonst zählt nur das Datum) */
  timed?: boolean;
  // ---- Zusatzangaben (Konzept 27.4, F-412) – alles Selbstangaben
  area?: LogArea;
  /** Tidengewässer (nur Küste/offshore) */
  tidal?: boolean;
  /** Stunden unter Segel, 0,1 h */
  sailH?: number;
  /** Nachtfahrt in Stunden (nur Küste/offshore) */
  nightH?: number;
  daysAboard?: number;
  /** Schleusen, Brücken, Mast legen/stellen (nur binnen) */
  locks?: number;
  bridges?: number;
  mast?: number;
  regatta?: { name: string; place?: number; starters?: number };
  items?: LogItem[];
}

const line = (v: unknown): string => cleanComment(v).replace(/\s*\n\s*/g, ' ');

/**
 * Prüft und bereinigt Fahrtenbuch-Angaben. Leere Felder fallen weg; Unbekanntes und zu Langes ist ein Fehler (deutsche
 * Meldung) statt still gekürzt – der Zähler im Formular zeigt die Grenzen vorher.
 */
export function parseLog(input: unknown): { log: Logbook } | { error: string } {
  if (input === undefined || input === null) return { log: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Ungültige Fahrtenbuch-Angaben.' };
  const o = input as Record<string, unknown>;
  const log: Logbook = {};
  const empty = (v: unknown) => v === undefined || v === null || v === '';

  if (!empty(o.engineH)) {
    const h = Number(o.engineH);
    if (!Number.isFinite(h) || h < 0 || h > LOG_LIMITS.engineMaxH) return { error: `Motorstunden: 0 bis ${LOG_LIMITS.engineMaxH}.` };
    log.engineH = Math.round(h * 10) / 10;
  }
  if (!empty(o.wind)) {
    const w = o.wind as { bft?: unknown; dir?: unknown };
    const bft = Number(w?.bft);
    if (typeof w !== 'object' || !Number.isInteger(bft) || bft < 0 || bft > LOG_LIMITS.bftMax) return { error: `Wind: 0 bis ${LOG_LIMITS.bftMax} Bft.` };
    if (!empty(w.dir) && !(WIND_DIRS as readonly unknown[]).includes(w.dir)) return { error: 'Unbekannte Windrichtung.' };
    log.wind = { bft, dir: empty(w.dir) ? null : (w.dir as WindDir) };
  }
  if (!empty(o.sea)) {
    if (!(SEA_STATES as readonly unknown[]).includes(o.sea)) return { error: 'Unbekannter Seegang.' };
    log.sea = o.sea as SeaState;
  }
  for (const [key, max, label] of [['sails', LOG_LIMITS.sailsMax, 'Segelführung'], ['berth', LOG_LIMITS.berthMax, 'Liegeplatz']] as const) {
    if (empty(o[key])) continue;
    if (typeof o[key] !== 'string') return { error: `${label}: bitte Text angeben.` };
    const v = line(o[key]);
    if (commentLength(v) > max) return { error: `${label}: höchstens ${max} Zeichen.` };
    if (v) log[key] = v;
  }
  if (!empty(o.notes)) {
    if (typeof o.notes !== 'string') return { error: 'Notizen: bitte Text angeben.' };
    const v = cleanComment(o.notes);
    if (commentLength(v) > LOG_LIMITS.notesMax) return { error: `Notizen: höchstens ${LOG_LIMITS.notesMax} Zeichen.` };
    if (v) log.notes = v;
  }
  if (o.timed === true) log.timed = true;
  const extra = parseExtra(o, log);
  if (extra) return { error: extra };
  if (JSON.stringify(log).length > LOG_LIMITS.logChars) return { error: 'Fahrtenbuch-Angaben zu lang – bitte Notizen oder Posten kürzen.' };
  return { log };
}

/** Zahl in [min, max] (mit `step` 0,1 bzw. ganzzahlig) – null = Fehler. */
function num(v: unknown, min: number, max: number, int: boolean): number | null {
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return null;
  return int ? n : Math.round(n * 10) / 10;
}

/** Zusatzangaben (F-412) prüfen und in `log` übernehmen; Felder, die zum Revier nicht passen, fallen weg. */
function parseExtra(o: Record<string, unknown>, log: Logbook): string | null {
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  if (!empty(o.area)) {
    if (!(LOG_AREAS as readonly unknown[]).includes(o.area)) return 'Unbekanntes Revier.';
    log.area = o.area as LogArea;
  }
  const L = LOG_LIMITS;
  const numbers: Array<[keyof Logbook, number, number, boolean, string]> = [
    ['sailH', 0, L.hoursMax, false, `Stunden unter Segel: 0 bis ${L.hoursMax}.`],
    ['nightH', 0, L.hoursMax, false, `Nachtfahrt: 0 bis ${L.hoursMax} Stunden.`],
    ['daysAboard', 1, L.daysMax, true, `Tage an Bord: 1 bis ${L.daysMax}.`],
    ['locks', 0, L.countMax, true, `Schleusen: 0 bis ${L.countMax}.`],
    ['bridges', 0, L.countMax, true, `Brücken: 0 bis ${L.countMax}.`],
    ['mast', 0, L.mastMax, true, `Mast legen/stellen: 0 bis ${L.mastMax}.`],
  ];
  for (const [key, min, max, int, msg] of numbers) {
    if (empty(o[key])) continue;
    const n = num(o[key], min, max, int);
    if (n === null) return msg;
    if ((key === 'nightH' || key === 'locks' || key === 'bridges' || key === 'mast') && !fieldInArea(key, log.area)) continue;
    (log as Record<string, unknown>)[key] = n;
  }
  if (o.tidal === true && fieldInArea('tidal', log.area)) log.tidal = true;
  if (!empty(o.regatta)) {
    const r = o.regatta as Record<string, unknown>;
    if (typeof r !== 'object' || Array.isArray(r) || typeof r.name !== 'string') return 'Regatta: bitte den Namen angeben.';
    const name = line(r.name);
    if (!name || commentLength(name) > L.regattaNameMax) return `Regatta: Name mit 1 bis ${L.regattaNameMax} Zeichen.`;
    const place = empty(r.place) ? undefined : num(r.place, 1, L.regattaMax, true);
    const starters = empty(r.starters) ? undefined : num(r.starters, 1, L.regattaMax, true);
    if (place === null || starters === null) return `Regatta: Platz und Starter 1 bis ${L.regattaMax}.`;
    if (place !== undefined && starters !== undefined && place > starters) return 'Regatta: Der Platz liegt über der Zahl der Starter.';
    log.regatta = { name, ...(place !== undefined ? { place } : {}), ...(starters !== undefined ? { starters } : {}) };
  }
  if (!empty(o.items)) {
    if (!Array.isArray(o.items)) return 'Posten: ungültige Angabe.';
    if (o.items.length > L.itemsMax) return `Höchstens ${L.itemsMax} Posten je Eintrag.`;
    const items: LogItem[] = [];
    for (const raw of o.items as unknown[]) {
      const it = raw as Record<string, unknown>;
      if (!it || typeof it !== 'object' || typeof it.name !== 'string') return 'Posten: bitte einen Namen angeben.';
      const name = line(it.name);
      if (!name) continue;
      if (commentLength(name) > L.itemNameMax) return `Posten: Name höchstens ${L.itemNameMax} Zeichen.`;
      const n = empty(it.n) ? 1 : num(it.n, 0, L.itemCountMax, false);
      if (n === null) return `Posten „${name}“: Anzahl 0 bis ${L.itemCountMax}.`;
      const note = typeof it.note === 'string' ? line(it.note) : '';
      if (commentLength(note) > L.itemNoteMax) return `Posten „${name}“: Begründung höchstens ${L.itemNoteMax} Zeichen.`;
      items.push({ name, n, ...(note ? { note } : {}) });
    }
    if (items.length) log.items = items;
  }
  return null;
}

/** Gespeicherte Angaben lesen (Spalte `log`): kaputtes JSON oder Unbekanntes ergibt leere Angaben, nie einen Fehler. */
export function readLog(raw: unknown): Logbook {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const r = parseLog(JSON.parse(raw));
    return 'log' in r ? r.log : {};
  } catch {
    return {};
  }
}

/** Gibt es Angaben, die das Fahrtenbuch-Panel zeigt? (`timed` ist nur ein Merker) */
export const hasLog = (log: Logbook): boolean => Object.keys(log).some((k) => k !== 'timed');

// ---------------------------------------------------------------- Route und Distanz

export type LatLon = [number, number];

/** Länge einer Route (Start → Wegpunkte → Ziel) in sm. */
export function routeNm(route: LatLon[]): number {
  let m = 0;
  for (let i = 1; i < route.length; i++) m += haversine(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]);
  return m / METERS_PER_NM;
}

export interface DistanceInput {
  distNm: number;
  /** Länge der Route aus den Hafenpositionen (sm), 0 = unbekannt oder Rundtörn */
  routeNm: number;
  startedAt: number;
  /** Ankunft; null = nicht angegeben */
  endedAt: number | null;
  /** hat die Abfahrt eine Uhrzeit? (sonst zählt nur der Kalendertag) */
  hasTime: boolean;
}

/**
 * Plausibilität eines Fahrtenbuch-Eintrags (Konzept 19.5): null = in Ordnung, sonst die deutsche Meldung.
 * Angabe ≥ Länge der Route; mit Uhrzeiten ≤ Dauer × 15 kn; ohne ≤ 120 sm je Kalendertag; höchstens 2.000 sm und 30 Tage.
 */
export function plausibleDistance(d: DistanceInput): string | null {
  if (!Number.isFinite(d.distNm) || d.distNm <= 0) return 'Bitte die Strecke in Seemeilen angeben.';
  if (d.distNm > LOG_LIMITS.maxNm) return `Höchstens ${fmtNum(LOG_LIMITS.maxNm, 0)} sm je Eintrag – längere Reisen bitte in Etappen eintragen.`;
  // Rundung der Anzeige (eine Nachkommastelle) und gerundete Hafenpositionen nicht als Fehler werten
  if (d.distNm + 0.15 < d.routeNm * 0.99) return `Die Strecke ist kürzer als die direkte Linie zwischen den Häfen (${fmtNum(d.routeNm, 1)} sm).`;
  if (d.endedAt !== null) {
    if (d.endedAt < d.startedAt) return 'Die Ankunft liegt vor der Abfahrt.';
    if (d.endedAt - d.startedAt > LOG_LIMITS.maxDays * DAY) return `Ein Eintrag umfasst höchstens ${LOG_LIMITS.maxDays} Tage.`;
  }
  if (d.hasTime && d.endedAt !== null && d.endedAt > d.startedAt) {
    const h = (d.endedAt - d.startedAt) / HOUR;
    if (d.distNm > h * LOG_LIMITS.maxKn) return `${fmtNum(d.distNm, 1)} sm in ${fmtNum(h, 1)} h wären über ${LOG_LIMITS.maxKn} kn im Mittel – bitte Strecke oder Zeiten prüfen.`;
    return null;
  }
  const days = calendarDays(d.startedAt, d.endedAt ?? d.startedAt);
  if (d.distNm > days * LOG_LIMITS.nmPerDay) return `Höchstens ${LOG_LIMITS.nmPerDay} sm je Tag ohne Uhrzeiten – bitte Ankunft angeben.`;
  return null;
}

/** Kalendertage (UTC) von a bis b, mindestens 1. */
const calendarDays = (a: number, b: number) => Math.max(1, Math.floor(b / DAY) - Math.floor(a / DAY) + 1);

/** Abfahrt: nicht in der Zukunft (+ 1 Tag Spielraum für Zeitzonen) und nicht älter als 5 Jahre. */
export function departureError(startedAt: number, now: number): string | null {
  if (!Number.isFinite(startedAt)) return 'Bitte das Datum der Abfahrt angeben.';
  if (startedAt > now + DAY) return 'Die Abfahrt liegt in der Zukunft.';
  if (startedAt < now - LOG_LIMITS.maxAgeYears * 365.25 * DAY) return `Einträge reichen höchstens ${LOG_LIMITS.maxAgeYears} Jahre zurück.`;
  return null;
}

/**
 * GPX-Törn (L8): Distanz ≤ 2.000 sm; mit Start und Ende Dauer ≤ 60 Tage und Distanz ≤ Dauer × 30 kn. Ohne Zeitstempel
 * (F-05) nur die Obergrenze. Gleiche Regel im Browser vor dem Hochladen und im Worker.
 */
export function plausibleGpx(distNm: number, startedAt: number | null, endedAt: number | null): string | null {
  if (distNm > GPX_LIMITS.maxNm) return `Höchstens ${fmtNum(GPX_LIMITS.maxNm, 0)} sm je Törn – bitte den Track in Etappen teilen.`;
  if (startedAt === null || endedAt === null) return null;
  if (endedAt < startedAt) return 'Das Ende des Tracks liegt vor seinem Start.';
  if (endedAt - startedAt > GPX_LIMITS.maxDays * DAY) return `Ein Törn umfasst höchstens ${GPX_LIMITS.maxDays} Tage.`;
  const h = (endedAt - startedAt) / HOUR;
  // kurze Tracks: mindestens eine Viertelstunde ansetzen, sonst kippt die Regel bei Sekunden-Tracks
  if (distNm > Math.max(h, 0.25) * GPX_LIMITS.maxKn) return `Die Distanz passt nicht zur Dauer (über ${GPX_LIMITS.maxKn} kn im Mittel).`;
  return null;
}

// ---------------------------------------------------------------- Titel, Kontingent, Aufbewahrung

/** Titel-Vorschlag: „Potsdam → Werder“ bzw. „Rundtörn ab Potsdam“. */
export function logTitle(from: string, to: string): string {
  const a = from.trim();
  const b = to.trim();
  if (!a && !b) return 'Fahrtenbuch-Eintrag';
  if (!b || a === b) return `Rundtörn ab ${a}`;
  if (!a) return `Törn nach ${b}`;
  return `${a} → ${b}`;
}

/** Zeitraum einer Saison (ms, Ende exklusiv): ab November zählt alles zur nächsten (wie seasonOf). */
export const seasonRange = (season: number): [number, number] => [Date.UTC(season - 1, 10, 1), Date.UTC(season, 10, 1)];

/** Meldung, wenn das Kontingent einer Saison erschöpft ist (L1). */
export const logQuotaMessage = (season: number) =>
  `${LOG_LIMITS.perSeason} Fahrtenbuch-Einträge für ${season} erreicht – bitte einen älteren löschen.`;

/**
 * Wann ein Fahrtenbuch-Eintrag gelöscht wird (L2): am 1. Februar nach der zweiten Saison ab Anlegen – oder nach der
 * letzten unterstützten Saison, wenn die später endet. (Gleiche Regel wie EXPIRES_SQL im Worker.)
 */
export function manualExpiry(createdAt: number, supporterUntil: number | null): number {
  return Math.max(seasonEnd(seasonOf(createdAt) + 1), supporterUntil ?? 0) + GRACE_MS;
}

// ---------------------------------------------------------------- Anzeige

export const DIST_SOURCE_LABEL: Record<DistSource, string> = { track: 'aufgezeichnet', route: 'aus der Route', stated: 'Angabe' };

/** „1.234 sm · davon 1.020 sm aufgezeichnet“ – der Zusatz nur, wenn nicht alles aufgezeichnet ist (F-303). */
export function recordedNote(totalNm: number, recordedNm: number): string {
  if (!(totalNm > 0) || recordedNm >= totalNm - 0.05) return '';
  return `davon ${fmtNum(recordedNm, 0)} sm aufgezeichnet`;
}

/** Nachtrag (K7): Abfahrt mehr als 14 Tage vor dem Anlegen – kommt gebündelt in den Stream. */
export const BACKFILL_MS = 14 * DAY;
export const isBackfill = (startedAt: number | null, createdAt: number): boolean => startedAt !== null && createdAt - startedAt > BACKFILL_MS;

// ---------------------------------------------------------------- Darstellung als Track (Konzept 19.2.2)

/**
 * Schematischer Track eines Eintrags ohne GPX: die Route (Start → Ziel, Rundtörn ein Punkt) ohne Zeitstempel, als
 * `estimated` markiert (gestrichelt, keine Speed-Kennzahlen). Distanz ist die gespeicherte (Angabe oder Route),
 * Fahrzeit die angegebene Dauer. Wegpunkte und Zeiten entlang der Linie (Wetter) folgen in Phase 2.
 */
export function routeTrack(route: LatLon[], o: { id: string; name: string; color: string; distNm: number; startedAt: number | null; endedAt: number | null; timed: boolean }): Track {
  const points: TrackPoint[] = route.map(([lat, lon]) => ({ lat, lon, time: null, ele: null, speed: null, speedSmooth: null, glitch: false, wx: null }));
  const movingH = o.timed && o.startedAt !== null && o.endedAt !== null && o.endedAt > o.startedAt ? (o.endedAt - o.startedAt) / HOUR : 0;
  return {
    id: o.id,
    name: o.name,
    raw: '',
    points,
    stats: { distNm: o.distNm, maxSpeed: 0, avgSpeed: 0, start: o.startedAt, end: o.endedAt ?? o.startedAt, movingH, nPts: points.length, hasTime: false, nGlitch: 0 },
    color: o.color,
    hidden: false,
    estimated: true,
  };
}

// ---------------------------------------------------------------- „Ins Fahrtenbuch“ (Konzept 21, F-422)

/**
 * Stand eines Törns im Fahrtenbuch: selbst angelegte Einträge sind bestätigt, Törns mit GPX zunächst ein Vorschlag
 * (zählt mit), vom Nutzer abgeschaltete ausgeschlossen (zählen nie, bleiben aber als Beitrag bestehen).
 */
export const LOG_STATES = ['confirmed', 'suggested', 'excluded'] as const;
export type LogState = (typeof LOG_STATES)[number];
export const isLogState = (v: unknown): v is LogState => typeof v === 'string' && (LOG_STATES as readonly string[]).includes(v);

/** Stand beim Anlegen: Fahrtenbuch-Eintrag bestätigt, GPX-Törn Vorschlag – außer ausdrücklich ausgeschlossen. */
export const initialLogState = (source: ShareSource, excluded = false): LogState => (excluded ? 'excluded' : source === 'manual' ? 'confirmed' : 'suggested');

/** Zählt der Törn in Seemeilen, Törn-Zahlen, Saison und Meilensteinen? */
export const countsInLogbook = (s: LogState): boolean => s !== 'excluded';

/** Schalter „Ins Fahrtenbuch“ wieder an: GPX-Törns werden wieder Vorschlag, eigene Einträge wieder bestätigt. */
export const logStateOn = (source: ShareSource): LogState => (source === 'manual' ? 'confirmed' : 'suggested');

export const LOG_STATE_LABEL: Record<LogState, string> = {
  confirmed: 'Im Fahrtenbuch (bestätigt)',
  suggested: 'Im Fahrtenbuch (Vorschlag)',
  excluded: 'Nicht im Fahrtenbuch',
};
