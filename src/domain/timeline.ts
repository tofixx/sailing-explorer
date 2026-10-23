import type { Track, TrackPoint } from './types';

export type TimedPoint = TrackPoint & { time: number };

/** Alle Punkte mit Zeitstempel der sichtbaren Tracks, nach Zeit sortiert. */
export function timeline(tracks: Track[]): TimedPoint[] {
  const all: TimedPoint[] = [];
  for (const t of tracks) for (const p of t.points) if (p.time != null) all.push(p as TimedPoint);
  return all.sort((a, b) => a.time - b.time);
}

/** Index des zeitlich nächsten Punkts (binäre Suche). */
export function nearestByTime(points: TimedPoint[], time: number): number {
  if (!points.length) return -1;
  let lo = 0;
  let hi = points.length - 1;
  if (time <= points[0].time) return 0;
  if (time >= points[hi].time) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(points[lo - 1].time - time) < Math.abs(points[lo].time - time) ? lo - 1 : lo;
}

export interface Segment {
  /** erster/letzter Index in points */
  a: number;
  b: number;
  t0: number;
  t1: number;
  dur: number;
}

/**
 * Teilt eine Zeitreihe an großen Lücken (Pausen zwischen Etappen), damit Diagramme
 * die Pause nicht als lange Linie zeichnen. Schwelle: max(20 min, 8 × Median-Abstand).
 */
export function segmentByGaps(points: TimedPoint[]): Segment[] {
  if (!points.length) return [];
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i].time - points[i - 1].time);
  gaps.sort((a, b) => a - b);
  const medGap = gaps[gaps.length >> 1] || 0;
  const threshold = Math.max(20 * 60_000, medGap * 8);

  const segs: Segment[] = [];
  let start = 0;
  const push = (a: number, b: number) => {
    const t0 = points[a].time;
    const t1 = points[b].time;
    segs.push({ a, b, t0, t1, dur: Math.max(1, t1 - t0) });
  };
  for (let i = 1; i < points.length; i++) {
    if (points[i].time - points[i - 1].time > threshold) {
      push(start, i - 1);
      start = i;
    }
  }
  push(start, points.length - 1);
  return segs;
}

export interface Layout {
  segs: Array<Segment & { x0: number; w: number }>;
  x: (i: number) => number;
  /** Zeit an Pixelposition (null in Lücken außerhalb) */
  timeAt: (px: number) => number | null;
}

/** Verteilt Segmente proportional zur Dauer auf [left, right] mit festen Lücken dazwischen. */
export function layoutSegments(points: TimedPoint[], segs: Segment[], left: number, right: number, gapPx = 12): Layout {
  const total = segs.reduce((s, x) => s + x.dur, 0) || 1;
  const cut = segs.length > 1 ? gapPx : 0;
  const avail = right - left - cut * (segs.length - 1);
  let cx = left;
  const laid = segs.map((s) => {
    const w = avail * (s.dur / total);
    const out = { ...s, x0: cx, w };
    cx += w + cut;
    return out;
  });
  const segOf = (i: number) => laid.find((s) => i >= s.a && i <= s.b) ?? laid[0];
  return {
    segs: laid,
    x: (i) => {
      const s = segOf(i);
      return s.x0 + s.w * ((points[i].time - s.t0) / s.dur);
    },
    timeAt: (px) => {
      let best = laid[0];
      let bd = Infinity;
      for (const s of laid) {
        if (px >= s.x0 && px <= s.x0 + s.w) return s.t0 + ((px - s.x0) / Math.max(1, s.w)) * s.dur;
        const d = Math.min(Math.abs(px - s.x0), Math.abs(px - s.x0 - s.w));
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (!best) return null;
      return px < best.x0 ? best.t0 : best.t1;
    },
  };
}
