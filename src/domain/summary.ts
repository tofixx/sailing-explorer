import { circularMean, mean } from './geo';
import { fmtDate, fmtDuration, fmtNum } from './format';
import type { Conditions, Track, TrackPoint } from './types';

export interface Kpi {
  key: string;
  label: string;
  value: string;
  unit: string;
  /** Punkt, an dem das Maximum auftrat – für Hover-Verknüpfung mit der Karte */
  point?: TrackPoint;
  colorVar?: string;
}

/** Kennzahlen über alle sichtbaren Tracks. */
export function kpis(tracks: Track[]): Kpi[] {
  let dist = 0, moving = 0, sumSp = 0, nSp = 0;
  let maxSpPt: TrackPoint | undefined;
  const wind = new Agg(), gust = new Agg(), wave = new Agg();

  for (const t of tracks) {
    dist += t.stats.distNm;
    moving += t.stats.movingH;
    for (const p of t.points) {
      if (p.speed != null && isFinite(p.speed) && !p.glitch) {
        sumSp += p.speed;
        nSp++;
      }
      if (p.speedSmooth != null && (!maxSpPt || p.speedSmooth > (maxSpPt.speedSmooth ?? 0))) maxSpPt = p;
      if (p.wx) {
        wind.add(p.wx.wind, p);
        gust.add(p.wx.gust, p);
        wave.add(p.wx.wave, p);
      }
    }
  }

  const out: Kpi[] = [
    { key: 'dist', label: 'Distanz', value: fmtNum(dist, 1), unit: 'sm' },
    { key: 'time', label: 'Fahrzeit', value: fmtDuration(moving), unit: 'h' },
    { key: 'avgSpeed', label: 'Ø Fahrt', value: fmtNum(nSp ? sumSp / nSp : 0, 1), unit: 'kn', colorVar: '--c-speed' },
    { key: 'maxSpeed', label: 'Max. Fahrt', value: fmtNum(maxSpPt?.speedSmooth ?? 0, 1), unit: 'kn', point: maxSpPt, colorVar: '--c-speed' },
  ];
  if (wind.n) out.push(
    { key: 'avgWind', label: 'Ø Wind', value: fmtNum(wind.avg(), 0), unit: 'kn', colorVar: '--c-wind' },
    { key: 'maxWind', label: 'Max. Wind', value: fmtNum(wind.max, 0), unit: 'kn', point: wind.at, colorVar: '--c-wind' },
  );
  if (gust.n) out.push(
    { key: 'avgGust', label: 'Ø Böen', value: fmtNum(gust.avg(), 0), unit: 'kn', colorVar: '--c-gust' },
    { key: 'maxGust', label: 'Max. Böen', value: fmtNum(gust.max, 0), unit: 'kn', point: gust.at, colorVar: '--c-gust' },
  );
  if (wave.n) out.push(
    { key: 'avgWave', label: 'Ø Wellen', value: fmtNum(wave.avg(), 1), unit: 'm', colorVar: '--c-wave' },
    { key: 'maxWave', label: 'Max. Wellen', value: fmtNum(wave.max, 1), unit: 'm', point: wave.at, colorVar: '--c-wave' },
  );
  return out;
}

class Agg {
  sum = 0;
  n = 0;
  max = -Infinity;
  at: TrackPoint | undefined;
  add(v: number | null, p: TrackPoint) {
    if (v == null || !isFinite(v)) return;
    this.sum += v;
    this.n++;
    if (v > this.max) {
      this.max = v;
      this.at = p;
    }
  }
  avg() {
    return this.n ? this.sum / this.n : 0;
  }
}

/** Mittlere Bedingungen der Reise (Richtungen zirkulär gemittelt). */
export function averageConditions(tracks: Track[]): Conditions | null {
  const pts = tracks.flatMap((t) => t.points).filter((p) => p.wx);
  if (!pts.length) return null;
  const pick = (k: keyof Conditions) => pts.map((p) => p.wx![k]);
  return {
    wind: mean(pick('wind')),
    gust: mean(pick('gust')),
    dir: circularMean(pick('dir')),
    wave: mean(pick('wave')),
    wdir: circularMean(pick('wdir')),
    wper: mean(pick('wper')),
  };
}

/** Kurztext für Link-Vorschauen: „42,1 sm · 13.–14.06.2026 · 2 Etappen“. */
export function shareSummary(tracks: Track[]): string {
  const dist = tracks.reduce((s, t) => s + t.stats.distNm, 0);
  const starts = tracks.map((t) => t.stats.start).filter((x): x is number => x != null);
  const ends = tracks.map((t) => t.stats.end).filter((x): x is number => x != null);
  const parts = [`${fmtNum(dist, 1)} sm`];
  if (starts.length && ends.length) {
    const a = fmtDate(Math.min(...starts));
    const b = fmtDate(Math.max(...ends));
    parts.push(a === b ? a : `${a} – ${b}`);
  }
  if (tracks.length > 1) parts.push(`${tracks.length} Etappen`);
  return parts.join(' · ');
}
