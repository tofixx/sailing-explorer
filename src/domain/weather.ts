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

/** Hängt Wetter an jeden Punkt (mutiert). */
export function attachConditions(tracks: Track[], w: WeatherData | null): void {
  for (const t of tracks) for (const p of t.points) p.wx = conditionsAt(w, p.lat, p.lon, p.time);
}
