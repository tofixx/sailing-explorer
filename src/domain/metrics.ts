import { validSpeed } from './stats';
import type { MetricKey, Track, TrackPoint } from './types';

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  unit: string;
  decimals: number;
  /** Token-Name der semantischen Farbe */
  colorVar: string;
  get: (p: TrackPoint) => number | null;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  speed: { key: 'speed', label: 'Fahrt über Grund', short: 'Fahrt', unit: 'kn', decimals: 1, colorVar: '--c-speed', get: validSpeed },
  wind: { key: 'wind', label: 'Windgeschwindigkeit', short: 'Wind', unit: 'kn', decimals: 0, colorVar: '--c-wind', get: (p) => p.wx?.wind ?? null },
  gust: { key: 'gust', label: 'Böen', short: 'Böen', unit: 'kn', decimals: 0, colorVar: '--c-gust', get: (p) => p.wx?.gust ?? null },
  wave: { key: 'wave', label: 'Wellenhöhe', short: 'Wellen', unit: 'm', decimals: 1, colorVar: '--c-wave', get: (p) => p.wx?.wave ?? null },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function isMetricKey(v: unknown): v is MetricKey {
  return typeof v === 'string' && v in METRICS;
}

export interface Range {
  lo: number;
  hi: number;
}

/** Robuster Wertebereich (2.–98. Perzentil) der sichtbaren Tracks. */
export function metricRange(tracks: Track[], metric: MetricKey): Range | null {
  const get = METRICS[metric].get;
  const vals: number[] = [];
  for (const t of tracks) for (const p of t.points) {
    const v = get(p);
    if (v != null && isFinite(v)) vals.push(v);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const q = (f: number) => vals[Math.min(vals.length - 1, Math.floor(f * (vals.length - 1)))];
  let lo = q(0.02);
  let hi = q(0.98);
  if (metric === 'speed') lo = 0;
  if (hi - lo < 0.1) hi = lo + 1;
  return { lo, hi };
}

/**
 * Dreiecksgewichteter gleitender Mittelwert für weiche Farbverläufe.
 * Fenster skaliert mit der Punktzahl.
 */
export function smoothedMetric(points: TrackPoint[], metric: MetricKey): Array<number | null> {
  const get = METRICS[metric].get;
  const n = points.length;
  const raw = points.map((p) => {
    const v = get(p);
    return v != null && isFinite(v) ? v : null;
  });
  const win = Math.max(2, Math.min(14, Math.round(n / 45)));
  const out = new Array<number | null>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      const v = raw[j];
      if (v == null) continue;
      const w = 1 - Math.abs(i - j) / (win + 1);
      sum += v * w;
      cnt += w;
    }
    out[i] = cnt ? sum / cnt : null;
  }
  return out;
}

/** Sequentielle Rampe (kühl → warm), identisch in Karte und Legende. */
export const RAMP = ['#3b6fb5', '#3aa0c4', '#46c4a8', '#7ed957', '#f2d544', '#f0a93b', '#e8682f', '#d62f2f'];

export function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = hex(RAMP[i]);
  const b = hex(RAMP[i + 1]);
  const c = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.join(', ')})`;
