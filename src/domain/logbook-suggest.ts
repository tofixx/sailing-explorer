// Vorschläge für Fahrtenbuch-Zusatzangaben aus dem GPX (Konzept 27.4, F-460): reine Regeln ohne DOM und Netz, laufen im
// Browser (Prinzip „Billig im Betrieb“). Alles sind Vorschläge – übernommen wird nur per Klick, gespeichert erst mit
// „Speichern“ (B10).
import { haversine } from './geo';
import type { Track } from './types';

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Rad je Grad */
const RAD = Math.PI / 180;

/** Grenzen der Erkennung – großzügig, es ist nur ein Vorschlag. */
export const SUGGEST_RULES = {
  /** ab dieser Fahrt (kn) gilt ein Punkt als „in Fahrt“ */
  movingKn: 0.5,
  /** längere Lücken zwischen zwei Punkten zählen nicht (Gerät aus, Hafen) */
  maxGapH: 0.5,
  /** Länge eines Abschnitts für die Motor-Erkennung */
  windowMin: 10,
  /** Motor: mindestens so schnell im Mittel (kn) … */
  motorMinKn: 3,
  /** … so gleichmäßig (Streuung / Mittel) … */
  motorMaxCv: 0.12,
  /** … und so gerade (Luftlinie / gefahrene Strecke) */
  motorMinStraight: 0.97,
  /** Sonne unter dieser Höhe (°) = Nacht (Sonnenuntergang mit Refraktion) */
  nightAltDeg: -0.833,
} as const;

/** Vorschlag aus dem Track; null-Felder lassen sich nicht ableiten (z. B. ohne Zeitstempel). */
export interface LogSuggestion {
  sailH: number | null;
  engineH: number | null;
  nightH: number | null;
  daysAboard: number | null;
}

/** Sonnenhöhe in Grad zum Zeitpunkt `t` (UTC ms) am Ort – Näherung nach dem Astronomical Almanac (≈ 0,1° genau). */
export function sunAltitude(t: number, lat: number, lon: number): number {
  const d = (t - Date.UTC(2000, 0, 1, 12)) / DAY;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15 * RAD;
  const h = gmst + lon * RAD - ra;
  const la = lat * RAD;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(h)) / RAD;
}

/** Kalendertag in Ortszeit (Europe/Berlin) als ms des UTC-Mitternachts – zum Zählen von Tagen. */
function berlinDay(t: number): number {
  const [y, m, d] = new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Kalendertage in Ortszeit von `a` bis `b` (mindestens 1). */
export const calendarDaysBerlin = (a: number, b: number): number => Math.max(1, Math.round((berlinDay(b) - berlinDay(a)) / DAY) + 1);

const round1 = (h: number) => Math.round(h * 10) / 10;

interface Leg {
  t: number;
  dtH: number;
  kn: number;
  m: number;
  /** Anfang und Ende des Abschnitts */
  a: [number, number];
  b: [number, number];
}

/** Fahrt-Abschnitte zwischen zwei gültigen Punkten mit Zeit (ohne Ausreißer, ohne lange Lücken). */
function legs(track: Track): Leg[] {
  const out: Leg[] = [];
  let prev: Track['points'][number] | null = null;
  for (const p of track.points) {
    if (p.glitch || p.time === null) continue;
    if (prev && prev.time !== null && p.time > prev.time) {
      const dtH = (p.time - prev.time) / HOUR;
      const m = haversine(prev.lat, prev.lon, p.lat, p.lon);
      if (dtH <= SUGGEST_RULES.maxGapH) out.push({ t: prev.time + (p.time - prev.time) / 2, dtH, kn: m / 1852 / dtH, m, a: [prev.lat, prev.lon], b: [p.lat, p.lon] });
    }
    prev = p;
  }
  return out;
}

/** Läuft ein Abschnitt unter Motor? Gleichmäßig schnell und fast gerade (kein Kreuzen, keine Böen-Spitzen). */
function looksMotored(win: Leg[]): boolean {
  const first = win[0].a;
  const last = win[win.length - 1].b;
  const straightM = haversine(first[0], first[1], last[0], last[1]);
  const h = win.reduce((a, l) => a + l.dtH, 0);
  const pathM = win.reduce((a, l) => a + l.m, 0);
  // kurze Reste (unter 5 Minuten) sagen nichts aus
  if (h * 60 < SUGGEST_RULES.windowMin / 2 || pathM <= 0) return false;
  const mean = pathM / 1852 / h;
  if (mean < SUGGEST_RULES.motorMinKn) return false;
  const v = win.reduce((a, l) => a + l.dtH * (l.kn - mean) ** 2, 0) / h;
  return Math.sqrt(v) / mean <= SUGGEST_RULES.motorMaxCv && straightM / pathM >= SUGGEST_RULES.motorMinStraight;
}

/**
 * Stunden unter Segel/Motor, Nachtstunden und Tage an Bord aus den Tracks eines Törns. Ohne Zeitstempel (F-05) gibt es
 * keinen Vorschlag (alles null). Motor: Abschnitte von 10 Minuten in Fahrt, die gleichmäßig und gerade laufen.
 */
export function suggestFromTracks(tracks: Track[]): LogSuggestion {
  const none: LogSuggestion = { sailH: null, engineH: null, nightH: null, daysAboard: null };
  const timed = tracks.filter((t) => !t.estimated && t.stats.hasTime);
  if (!timed.length) return none;
  let moving = 0;
  let engine = 0;
  let night = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const track of timed) {
    const all = legs(track);
    if (!all.length) continue;
    first = Math.min(first, all[0].t);
    last = Math.max(last, all[all.length - 1].t);
    // in Fahrt: Zeit und Nacht
    const move = all.filter((l) => l.kn >= SUGGEST_RULES.movingKn);
    for (const l of move) {
      moving += l.dtH;
      if (sunAltitude(l.t, l.b[0], l.b[1]) < SUGGEST_RULES.nightAltDeg) night += l.dtH;
    }
    // Motor: zusammenhängende Fahrt in Fenster von 10 Minuten schneiden
    let win: Leg[] = [];
    // laufende Dauer des Fensters (h) statt erneuter Summe je Punkt
    let winH = 0;
    const flush = () => {
      if (win.length && looksMotored(win)) engine += winH;
      win = [];
      winH = 0;
    };
    for (const l of all) {
      if (l.kn < SUGGEST_RULES.movingKn) {
        flush();
        continue;
      }
      win.push(l);
      winH += l.dtH;
      if (winH * 60 >= SUGGEST_RULES.windowMin) flush();
    }
    flush();
  }
  if (!Number.isFinite(first)) return none;
  return {
    sailH: round1(Math.max(0, moving - engine)),
    engineH: round1(engine),
    nightH: round1(night),
    daysAboard: calendarDaysBerlin(first, last),
  };
}
