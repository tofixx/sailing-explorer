import { haversine } from './geo';
import type { Bounds, Conditions, Track } from './types';

/** Stündliche Wetterreihe an einem Gitterpunkt (0,25°-Raster). */
export interface WeatherSample {
  lat: number;
  lon: number;
  times: number[];
  wind: Array<number | null>;
  dir: Array<number | null>;
  gust: Array<number | null>;
  wave: Array<number | null>;
  wdir: Array<number | null>;
  wper: Array<number | null>;
}

export interface WeatherData {
  samples: WeatherSample[];
  windOk: boolean;
  waveOk: boolean;
}

export function bounds(tracks: Track[]): Bounds | null {
  let south = 90, north = -90, west = 180, east = -180;
  let tMin: number | null = null;
  let tMax: number | null = null;
  let any = false;
  for (const t of tracks) for (const p of t.points) {
    any = true;
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    if (p.time != null) {
      if (tMin == null || p.time < tMin) tMin = p.time;
      if (tMax == null || p.time > tMax) tMax = p.time;
    }
  }
  return any ? { south, north, west, east, tMin, tMax } : null;
}

/** Bis zu n gleichmäßig verteilte, auf 0,25° gerundete Abfragepunkte entlang der Tracks. */
export function samplePositions(tracks: Track[], n: number): Array<{ lat: number; lon: number }> {
  const all = tracks.flatMap((t) => t.points);
  if (!all.length) return [];
  const step = Math.max(1, Math.floor(all.length / n));
  const seen = new Set<string>();
  const out: Array<{ lat: number; lon: number }> = [];
  const q = (v: number) => Math.round(v * 4) / 4;
  for (let i = 0; i < all.length; i += step) {
    const lat = q(all[i].lat);
    const lon = q(all[i].lon);
    const k = `${lat},${lon}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ lat, lon });
  }
  return out;
}

function nearestSample(w: WeatherData, lat: number, lon: number): WeatherSample | null {
  let best: WeatherSample | null = null;
  let bd = Infinity;
  for (const s of w.samples) {
    const d = haversine(lat, lon, s.lat, s.lon);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function nearestHour(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(times[lo - 1] - t) < Math.abs(times[lo] - t) ? lo - 1 : lo;
}

export function conditionsAt(w: WeatherData | null, lat: number, lon: number, time: number | null): Conditions | null {
  if (!w || time == null) return null;
  const s = nearestSample(w, lat, lon);
  if (!s || !s.times.length) return null;
  const i = nearestHour(s.times, time);
  const g = (a: Array<number | null>) => a[i] ?? null;
  return { wind: g(s.wind), dir: g(s.dir), gust: g(s.gust), wave: g(s.wave), wdir: g(s.wdir), wper: g(s.wper) };
}

/** Obergrenzen für gespeicherte Wetterdaten: wenige Messpunkte, höchstens ~60 Tage stündlich. */
const MAX_SAMPLES = 20;
const MAX_HOURS = 24 * 62;
const SERIES = ['wind', 'dir', 'gust', 'wave', 'wdir', 'wper'] as const;

const finiteOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

/**
 * Prüft mitgespeicherte Wetterdaten (aus einer Freigabe oder dem lokalen Arbeitsbereich) – alles ist untrusted.
 * Ungültig → null; dann lädt die App wie früher selbst nach.
 */
export function parseWeatherData(input: unknown): WeatherData | null {
  const w = input as Partial<WeatherData> | null;
  if (!w || typeof w !== 'object' || typeof w.windOk !== 'boolean' || typeof w.waveOk !== 'boolean') return null;
  if (!Array.isArray(w.samples) || !w.samples.length || w.samples.length > MAX_SAMPLES) return null;
  const samples: WeatherSample[] = [];
  for (const raw of w.samples as unknown[]) {
    const s = raw as Partial<WeatherSample> | null;
    if (!s || typeof s.lat !== 'number' || typeof s.lon !== 'number' || Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180) return null;
    if (!Array.isArray(s.times) || !s.times.length || s.times.length > MAX_HOURS || !s.times.every((t) => typeof t === 'number' && Number.isFinite(t))) return null;
    for (const k of SERIES) {
      const a = s[k];
      // leere Reihe = keine Daten dieser Art (z. B. Wellen an Land)
      if (!Array.isArray(a) || (a.length && a.length !== s.times.length) || !a.every(finiteOrNull)) return null;
    }
    samples.push({ lat: s.lat, lon: s.lon, times: s.times, wind: s.wind!, dir: s.dir!, gust: s.gust!, wave: s.wave!, wdir: s.wdir!, wper: s.wper! });
  }
  return { samples, windOk: w.windOk, waveOk: w.waveOk };
}

/** Hängt Wetter an jeden Punkt (mutiert). */
export function attachConditions(tracks: Track[], w: WeatherData | null): void {
  for (const t of tracks) for (const p of t.points) p.wx = conditionsAt(w, p.lat, p.lon, p.time);
}
