// Übersichtsbild: Geometrie, Inhalte und ein echter Render ohne Browser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { DOMParser } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { parseGpx } from '../src/domain/gpx';
import { metricRange } from '../src/domain/metrics';
import { fitBounds, project, tilesFor } from '../src/domain/projection';
import { computeTrackStats } from '../src/domain/stats';
import { bounds } from '../src/domain/weather';
import type { Track } from '../src/domain/types';
import { DEFAULT_CONTENT, FORMATS, drawShareImage, imageFileName, infoRows, layout, type ImageFormat } from '../src/services/share-image';

const sample = (): Track => {
  const g = parseGpx(readFileSync(resolve('public/tracks/20260613_Stralsund_Prerow.gpx'), 'utf8'), 'x', new (DOMParser as unknown as new () => globalThis.DOMParser)());
  return { id: 't', name: g.name, raw: '', points: g.points, stats: computeTrackStats(g.points), color: '--c-track-1', hidden: false };
};
const track = sample();

describe('Projektion', () => {
  it('Web Mercator: Nullpunkt und Datumsgrenze', () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(project(0, 180, 1).x).toBeCloseTo(512);
  });

  it('fitBounds passt die Ausdehnung mit Rand in den Rahmen', () => {
    const b = bounds([track])!;
    const frame = { width: 820, height: 630, padding: 48 };
    const v = fitBounds(b, frame);
    const nw = project(b.north, b.west, v.zoom);
    const se = project(b.south, b.east, v.zoom);
    expect(nw.x - v.originX).toBeGreaterThanOrEqual(frame.padding - 1);
    expect(nw.y - v.originY).toBeGreaterThanOrEqual(frame.padding - 1);
    expect(se.x - v.originX).toBeLessThanOrEqual(frame.width - frame.padding + 1);
    expect(se.y - v.originY).toBeLessThanOrEqual(frame.height - frame.padding + 1);
    // eine Stufe mehr würde nicht mehr passen
    const nw2 = project(b.north, b.west, v.zoom + 1);
    const se2 = project(b.south, b.east, v.zoom + 1);
    expect(se2.x - nw2.x > frame.width - 2 * frame.padding || se2.y - nw2.y > frame.height - 2 * frame.padding).toBe(true);
  });

  it('tilesFor deckt den Ausschnitt lückenlos ab', () => {
    const v = fitBounds(bounds([track])!, { width: 820, height: 630, padding: 48 });
    const tiles = tilesFor(v, 820, 630);
    expect(Math.min(...tiles.map((t) => t.dx))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.dy))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.dx + 256))).toBeGreaterThanOrEqual(820);
    expect(Math.max(...tiles.map((t) => t.dy + 256))).toBeGreaterThanOrEqual(630);
  });
});

describe('Layout', () => {
  it.each(['landscape', 'square'] as ImageFormat[])('%s: Karten- und Infobereich überlappen nicht und füllen das Bild', (f) => {
    const { map, info } = layout(f);
    const { width, height } = FORMATS[f];
    const overlapW = Math.min(map.x + map.w, info.x + info.w) - Math.max(map.x, info.x);
    const overlapH = Math.min(map.y + map.h, info.y + info.h) - Math.max(map.y, info.y);
    expect(overlapW <= 0 || overlapH <= 0).toBe(true);
    expect(map.w * map.h + info.w * info.h).toBe(width * height);
  });
});

describe('Inhalte', () => {
  it('Optionen schalten Zeilen ab', () => {
    const all = infoRows([track], DEFAULT_CONTENT).map((r) => r.label);
    expect(all).toEqual(expect.arrayContaining(['Start', 'Ziel', 'Distanz', 'Fahrzeit', 'Fahrt']));
    const none = infoRows([track], { ...DEFAULT_CONTENT, startEnd: false, distance: false, duration: false, speed: false });
    expect(none).toEqual([]);
  });

  it('ohne Wetterdaten keine Wind-/Wellenzeilen', () => {
    const labels = infoRows([track], DEFAULT_CONTENT).map((r) => r.label);
    expect(labels).not.toContain('Wind');
    expect(labels).not.toContain('Wellen');
  });

  it('Dateiname aus dem Titel', () => {
    expect(imageFileName('Stralsund → Prerow (Tag 1)')).toBe('Stralsund-Prerow-Tag-1.jpg');
    expect(imageFileName('Ärø Ümläüte')).toBe('Aro-Umlaute.jpg');
    expect(imageFileName('…')).toBe('toern.jpg');
  });
});

describe('Rendern', () => {
  it.each(['landscape', 'square'] as ImageFormat[])('%s: Bild entsteht in Zielgröße, Infobereich ist hell', async (f) => {
    const canvas = createCanvas(10, 10);
    await drawShareImage(canvas as unknown as HTMLCanvasElement, [track], {
      title: 'Stralsund → Prerow',
      metric: 'speed',
      range: metricRange([track], 'speed'),
      format: f,
      content: { map: false },
    });
    expect([canvas.width, canvas.height]).toEqual([FORMATS[f].width, FORMATS[f].height]);
    // Ecke im Infobereich: weißer Hintergrund (Track wird dort nie gezeichnet)
    const { info } = layout(f);
    const px = canvas.getContext('2d').getImageData(info.x + info.w - 4, info.y + 4, 1, 1).data;
    expect([...px].slice(0, 3)).toEqual([255, 255, 255]);
  });
});
