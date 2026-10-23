// Gemeinsame Testdaten für die funktionalen Client-Tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeTrackStats } from '../../src/domain/stats';
import type { Track, TrackPoint } from '../../src/domain/types';

export const T0 = Date.parse('2026-06-13T10:00:00Z');
const KN = 1.94384;
/** Grad Breite pro Meter (Nord-Süd) */
const DEG_PER_M = 1 / 111_195;

export interface GenOpts {
  start?: number;
  /** Anzahl Punkte */
  n?: number;
  /** Abstand in s */
  dt?: number;
  /** Geschwindigkeit in kn */
  kn?: number;
  lat?: number;
  lon?: number;
  withTime?: boolean;
}

/** Punkte einer gleichmäßigen Fahrt nach Norden. */
export function genPoints(o: GenOpts = {}): Array<{ lat: number; lon: number; time: number | null }> {
  const { start = T0, n = 61, dt = 60, kn = 6, lat = 54.2, lon = 12.5, withTime = true } = o;
  const step = (kn / KN) * dt * DEG_PER_M;
  return Array.from({ length: n }, (_, i) => ({ lat: lat + i * step, lon, time: withTime ? start + i * dt * 1000 : null }));
}

export type Kind = 'trk' | 'rte' | 'wpt';

export function gpxDoc(points: Array<{ lat: number; lon: number; time: number | null }>, name = 'Testtörn', kind: Kind = 'trk'): string {
  const tag = kind === 'trk' ? 'trkpt' : kind === 'rte' ? 'rtept' : 'wpt';
  const pts = points
    .map((p) => `<${tag} lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.time != null ? `<time>${new Date(p.time).toISOString()}</time>` : ''}</${tag}>`)
    .join('');
  const body =
    kind === 'trk' ? `<trk><name>${name}</name><trkseg>${pts}</trkseg></trk>` : kind === 'rte' ? `<rte><name>${name}</name>${pts}</rte>` : `<metadata><name>${name}</name></metadata>${pts}`;
  return `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
}

export const P = (lat: number, lon: number, time: number | null): TrackPoint => ({ lat, lon, time, ele: null, speed: null, speedSmooth: null, glitch: false, wx: null });

export function makeTrack(points: TrackPoint[], over: Partial<Track> = {}): Track {
  return { id: over.id ?? Math.random().toString(36).slice(2), name: 'T', raw: '', points, stats: computeTrackStats(points), color: '#000', hidden: false, ...over };
}

export const trackFrom = (o: GenOpts = {}, over: Partial<Track> = {}) => makeTrack(genPoints(o).map((p) => P(p.lat, p.lon, p.time)), over);

export const sampleGpx = (file: string) => readFileSync(resolve('public/tracks', `${file}.gpx`), 'utf8');

// ---------------------------------------------------------------- Open-Meteo-Fake

export interface MeteoValues {
  wind?: number | null;
  gust?: number | null;
  dir?: number | null;
  wave?: number | null;
  wdir?: number | null;
  wper?: number | null;
  /** Wert abhängig von der Stunde (überschreibt wind) */
  windAt?: (hourIndex: number) => number;
}

/** Baut eine stündliche Open-Meteo-Antwort für die im URL angefragten Tage. */
export function meteoResponse(url: string, v: MeteoValues): unknown {
  const u = new URL(url);
  const sd = u.searchParams.get('start_date')!;
  const ed = u.searchParams.get('end_date')!;
  const t0 = Date.parse(`${sd}T00:00Z`);
  const t1 = Date.parse(`${ed}T23:00Z`);
  const time: string[] = [];
  for (let t = t0; t <= t1; t += 3_600_000) time.push(new Date(t).toISOString().slice(0, 16));
  const fill = (x: number | null | undefined) => time.map(() => (x === undefined ? null : x));
  const hourly: Record<string, unknown> = { time };
  if (u.pathname.includes('marine')) {
    Object.assign(hourly, { wave_height: fill(v.wave), wave_direction: fill(v.wdir), wave_period: fill(v.wper) });
  } else {
    Object.assign(hourly, {
      wind_speed_10m: v.windAt ? time.map((_, i) => v.windAt!(i)) : fill(v.wind),
      wind_direction_10m: fill(v.dir),
      wind_gusts_10m: fill(v.gust),
    });
  }
  return { hourly };
}

export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
