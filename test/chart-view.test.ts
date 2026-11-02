// Zoom und Verschieben der Diagramm-Großansicht (F-430): reine Regeln aus src/domain/chart-view.ts.
import { describe, expect, it } from 'vitest';
import {
  MAX_CONTENT_PX,
  MIN_VISIBLE_MS,
  clampView,
  initialView,
  isZoomed,
  maxZoom,
  panBy,
  pinch,
  revealOffset,
  tickLabel,
  tickStep,
  ticks,
  zoomAt,
} from '../src/domain/chart-view';
import { layoutSegments, segmentByGaps, type TimedPoint } from '../src/domain/timeline';

const H = 3_600_000;
const MIN = 60_000;

describe('F-430 Ausschnitt der Großansicht', () => {
  it('[F-430] Grenzen: ganzer Zeitraum (1) bis etwa 5 Minuten im Bild, gedeckelt durch die Scrollbreite', () => {
    expect(maxZoom(10 * H, 800)).toBe((10 * H) / MIN_VISIBLE_MS); // 120
    expect(maxZoom(2 * MIN, 800)).toBe(1); // kürzer als 5 min: nicht zoombar
    expect(maxZoom(1000 * H, 1000)).toBe(MAX_CONTENT_PX / 1000);
    expect(maxZoom(10 * H, 0)).toBe(1);
    expect(clampView({ zoom: 0.2, offset: -50 }, 800, 10)).toEqual({ zoom: 1, offset: 0 });
    expect(clampView({ zoom: 50, offset: 1e9 }, 800, 10)).toEqual({ zoom: 10, offset: 7200 });
    expect(clampView({ zoom: NaN, offset: NaN }, 800, 10)).toEqual({ zoom: 1, offset: 0 });
  });

  it('[F-430] Zoom um einen Punkt: der Inhalt unter dem Zeiger bleibt stehen', () => {
    const v = { zoom: 2, offset: 300 };
    const anchor = 250;
    const before = (v.offset + anchor) / v.zoom; // Position im ungezoomten Maß
    const z = zoomAt(v, 3, anchor, 800, 100);
    expect(z.zoom).toBe(6);
    expect((z.offset + anchor) / z.zoom).toBeCloseTo(before, 9);
    // am Rand gekappt, nie über die Zeitreihe hinaus
    expect(zoomAt({ zoom: 1, offset: 0 }, 0.5, 400, 800, 100)).toEqual({ zoom: 1, offset: 0 });
    expect(zoomAt({ zoom: 90, offset: 0 }, 4, 0, 800, 100).zoom).toBe(100);
  });

  it('[F-430] Verschieben und Zwei-Finger-Geste', () => {
    expect(panBy({ zoom: 2, offset: 100 }, 250, 800, 10)).toEqual({ zoom: 2, offset: 350 });
    expect(panBy({ zoom: 2, offset: 100 }, -500, 800, 10).offset).toBe(0);
    expect(panBy({ zoom: 2, offset: 100 }, 5000, 800, 10).offset).toBe(800);
    // Finger auseinander um Mitte 400, Mitte wandert 50 px nach links: Punkt unter der Mitte folgt
    const start = { zoom: 2, offset: 400 };
    const p = pinch(start, 2, 400, 350, 800, 100);
    expect(p.zoom).toBe(4);
    expect((p.offset + 350) / p.zoom).toBeCloseTo((start.offset + 400) / start.zoom, 9);
  });

  it('[F-430] Anfangsansicht 28 px je Stunde, kurze Zeiträume passen ganz', () => {
    expect(initialView(72 * H, 800, 28).zoom).toBeCloseTo((72 * 28) / 800, 9);
    expect(initialView(5 * H, 800, 28)).toEqual({ zoom: 1, offset: 0 });
    expect(isZoomed(initialView(5 * H, 800, 28))).toBe(false);
    expect(isZoomed(initialView(72 * H, 800, 28))).toBe(true);
  });

  it('[F-430] Achsenschritt folgt dem Zoom: Tage, Stunden, 30/15/5 Minuten', () => {
    const msPerPx = (span: number, px = 800) => span / px;
    expect(tickStep(msPerPx(10 * 24 * H))).toBe(24 * H);
    expect(tickStep(msPerPx(8 * H))).toBe(H);
    expect(tickStep(msPerPx(4 * H))).toBe(30 * MIN);
    expect(tickStep(msPerPx(2 * H))).toBe(15 * MIN);
    expect(tickStep(msPerPx(30 * MIN))).toBe(5 * MIN);
  });

  it('[F-430] Ticks liegen auf runden Ortszeiten und tragen beim Tageswechsel das Datum', () => {
    const t0 = new Date(2026, 5, 13, 22, 7).getTime();
    const t1 = new Date(2026, 5, 14, 1, 50).getTime();
    const ts = ticks(t0, t1, 30 * MIN);
    expect(ts.length).toBe(7); // 22:30 … 01:30
    for (const t of ts) expect(new Date(t).getMinutes() % 30).toBe(0);
    expect(ts[0]).toBeGreaterThanOrEqual(t0);
    expect(ts.at(-1)!).toBeLessThanOrEqual(t1);
    expect(tickLabel(ts[0], 30 * MIN, null)).toBe('13.06. 22:30');
    expect(tickLabel(ts[1], 30 * MIN, ts[0])).toBe('23:00');
    expect(tickLabel(ts[3], 30 * MIN, ts[2])).toBe('14.06. 00:00');
    const days = ticks(t0, t0 + 3 * 24 * H, 24 * H);
    expect(days.map((t) => new Date(t).getHours())).toEqual([0, 0, 0]);
    expect(tickLabel(days[0], 24 * H, null)).toBe('14.06.');
    expect(ticks(0, 10, 0)).toEqual([]);
  });

  it('[F-430] Zeitpunkt von außen: nur verschieben, wenn er außerhalb liegt, Zoom bleibt', () => {
    const v = { zoom: 10, offset: 800 };
    expect(revealOffset(v, 900, 400, 10)).toBeNull(); // im Ausschnitt
    expect(revealOffset(v, 2000, 400, 10)).toBe(1800); // mittig
    expect(revealOffset(v, 10, 400, 10)).toBe(0); // am Anfang gekappt
    expect(revealOffset(v, 3990, 400, 10)).toBe(3600); // am Ende gekappt
  });

  it('[F-430] Achsenstriche bleiben über die Zeitumstellung auf runden Ortszeiten', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    try {
      // Winterzeit: 25.10.2026, 03:00 MESZ → 02:00 MEZ
      const fall = ticks(Date.UTC(2026, 9, 24, 10), Date.UTC(2026, 9, 25, 23), 6 * H);
      expect(fall.map((t) => new Date(t).getHours())).toEqual([12, 18, 0, 6, 12, 18, 0]);
      const half = ticks(Date.UTC(2026, 9, 24, 23), Date.UTC(2026, 9, 25, 2), 30 * MIN);
      expect(half).toHaveLength(7); // 4 echte Stunden … mit doppelter 02:00-Stunde
      for (let i = 1; i < half.length; i++) expect(half[i] - half[i - 1]).toBe(30 * MIN);
      for (const t of half) expect(new Date(t).getMinutes() % 30).toBe(0);
      // Sommerzeit: 29.03.2026, 02:00 MEZ → 03:00 MESZ
      const spring = ticks(Date.UTC(2026, 2, 28, 20), Date.UTC(2026, 2, 29, 12), 3 * H);
      for (const t of spring) expect(new Date(t).getHours() % 3).toBe(0);
      expect(new Set(spring).size).toBe(spring.length);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('[F-430] Layout kennt die Position einer Zeit, Pausen haben keine', () => {
    const pts = [0, 10, 20, 180, 190].map((m) => ({ time: m * MIN, lat: 0, lon: 0 })) as unknown as TimedPoint[];
    const lay = layoutSegments(pts, segmentByGaps(pts), 0, 400);
    expect(lay.segs).toHaveLength(2);
    expect(lay.xAt(0)).toBe(0);
    expect(lay.xAt(190 * MIN)).toBeCloseTo(400, 6);
    expect(lay.xAt(100 * MIN)).toBeNull();
    expect(lay.timeAt(lay.xAt(15 * MIN)!)).toBeCloseTo(15 * MIN, -1);
  });
});
