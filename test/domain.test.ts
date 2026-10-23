import { describe, expect, it } from 'vitest';
import { beaufort, circularMean, compassName, haversine } from '../src/domain/geo';
import { metricRange, rampColor } from '../src/domain/metrics';
import { computeTrackStats } from '../src/domain/stats';
import { layoutSegments, nearestByTime, segmentByGaps, type TimedPoint } from '../src/domain/timeline';
import { shareSummary } from '../src/domain/summary';
import type { Track, TrackPoint } from '../src/domain/types';

const P = (lat: number, lon: number, time: number | null): TrackPoint => ({ lat, lon, time, ele: null, speed: null, speedSmooth: null, glitch: false, wx: null });

/** Gleichmäßige Fahrt nach Norden: ~6 kn, Punkt alle 10 s. */
function steady(n: number, start = 0): TrackPoint[] {
  const stepDeg = (6 / 1.94384) * 10 / 111_195; // 6 kn × 10 s in Grad Breite
  return Array.from({ length: n }, (_, i) => P(54 + i * stepDeg, 13, start + i * 10_000));
}

const track = (points: TrackPoint[]): Track => ({ id: 't', name: 'T', raw: '', points, stats: computeTrackStats(points), color: '#000', hidden: false });

describe('geo', () => {
  it('haversine: 1 Breitenminute ≈ 1 sm', () => {
    expect(haversine(54, 13, 54 + 1 / 60, 13)).toBeCloseTo(1853, -1);
  });
  it('Kompass und Beaufort', () => {
    expect(compassName(0)).toBe('N');
    expect(compassName(359)).toBe('N');
    expect(compassName(225)).toBe('SW');
    expect(beaufort(0)).toBe(0);
    expect(beaufort(12)).toBe(4);
    expect(beaufort(65)).toBe(12);
  });
  it('zirkuläres Mittel über 0° hinweg', () => {
    expect(circularMean([350, 10])).toBeCloseTo(0, 5);
  });
});

describe('computeTrackStats', () => {
  it('berechnet Speed und Distanz', () => {
    const s = computeTrackStats(steady(361)); // 1 h
    expect(s.avgSpeed).toBeCloseTo(6, 1);
    expect(s.distNm).toBeCloseTo(6, 1);
    expect(s.movingH).toBeCloseTo(1, 2);
    expect(s.nGlitch).toBe(0);
  });

  it('erkennt GPS-Sprünge als Ausreißer und hält Max-Speed realistisch', () => {
    const pts = steady(400);
    // Sprung um ~0,05° (≈ 3 sm) und zurück
    pts[200] = P(pts[200].lat + 0.05, 13, pts[200].time);
    const s = computeTrackStats(pts);
    expect(s.nGlitch).toBeGreaterThan(0);
    expect(s.maxSpeed).toBeLessThan(8);
    expect(pts[200].glitch).toBe(true);
  });

  it('kommt ohne Zeitstempel aus', () => {
    const s = computeTrackStats([P(54, 13, null), P(54.1, 13, null)]);
    expect(s.hasTime).toBe(false);
    expect(s.distNm).toBeGreaterThan(5);
  });
});

describe('metrics', () => {
  it('Speed-Bereich beginnt bei 0', () => {
    const r = metricRange([track(steady(100))], 'speed');
    expect(r?.lo).toBe(0);
    expect(r!.hi).toBeGreaterThan(5);
  });
  it('ohne Wetterdaten kein Wind-Bereich', () => {
    expect(metricRange([track(steady(100))], 'wind')).toBeNull();
  });
  it('Rampe ist an den Enden stabil', () => {
    expect(rampColor(-1)).toBe(rampColor(0));
    expect(rampColor(2)).toBe(rampColor(1));
  });
});

describe('timeline', () => {
  const pts = [...steady(10, 0), ...steady(10, 3 * 3_600_000)] as TimedPoint[];

  it('trennt an langen Pausen', () => {
    const segs = segmentByGaps(pts);
    expect(segs).toHaveLength(2);
    expect(segs[1].a).toBe(10);
  });

  it('Layout: x und timeAt sind invers', () => {
    const lay = layoutSegments(pts, segmentByGaps(pts), 0, 400);
    const x = lay.x(15);
    expect(lay.timeAt(x)).toBeCloseTo(pts[15].time, -3);
  });

  it('findet den zeitlich nächsten Punkt', () => {
    expect(nearestByTime(pts, 24_000)).toBe(2);
    expect(nearestByTime(pts, -5)).toBe(0);
    expect(nearestByTime(pts, 1e15)).toBe(19);
  });
});

describe('shareSummary', () => {
  it('fasst Distanz und Datum zusammen', () => {
    const t = track(steady(361, Date.parse('2026-06-13T10:00:00Z')));
    expect(shareSummary([t])).toMatch(/^6(,\d)? sm · 13\.06\.2026$/);
  });
});

describe('Formate', () => {
  it('deutsches Zahlenformat und Dauer h:mm', async () => {
    const { fmtNum, fmtDuration, plural } = await import('../src/domain/format');
    expect(fmtNum(42.123, 1)).toBe('42,1');
    expect(fmtDuration(5.3)).toBe('5:18');
    expect(fmtDuration(0.99)).toBe('0:59');
    expect(plural(1, 'Track', 'Tracks')).toBe('1 Track');
    expect(plural(1200, 'Punkt', 'Punkte')).toBe('1.200 Punkte');
  });
});
