// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GpxError, parseGpx } from '../src/domain/gpx';
import { computeTrackStats } from '../src/domain/stats';

const gpx = (body: string, name = 'Testtörn') =>
  `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${body}</trkseg></trk></gpx>`;

const pt = (lat: number, lon: number, iso: string) => `<trkpt lat="${lat}" lon="${lon}"><time>${iso}</time></trkpt>`;

describe('parseGpx', () => {
  it('liest Trackpunkte, Zeit und Namen', () => {
    const g = parseGpx(gpx(pt(54, 13, '2026-06-13T10:00:00Z') + pt(54.01, 13, '2026-06-13T10:10:00Z')), 'fallback');
    expect(g.name).toBe('Testtörn');
    expect(g.points).toHaveLength(2);
    expect(g.points[0].time).toBe(Date.parse('2026-06-13T10:00:00Z'));
  });

  it('behandelt Namen als Text (kein HTML)', () => {
    const g = parseGpx(gpx(pt(54, 13, '2026-06-13T10:00:00Z') + pt(54.01, 13, '2026-06-13T10:10:00Z'), '&lt;img src=x onerror=alert(1)&gt;'), 'f');
    expect(g.name).toBe('<img src=x onerror=alert(1)>'); // wird später escaped gerendert
  });

  it('lehnt DOCTYPE/ENTITY ab', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "aaaa">]><gpx><trk><trkseg>${pt(1, 1, '2026-01-01T00:00:00Z')}${pt(1, 1.1, '2026-01-01T00:01:00Z')}</trkseg></trk></gpx>`;
    expect(() => parseGpx(evil, 'x')).toThrow(GpxError);
  });

  it('lehnt Nicht-GPX und zu wenige Punkte ab', () => {
    expect(() => parseGpx('<html></html>', 'x')).toThrow(GpxError);
    expect(() => parseGpx(gpx(pt(54, 13, '2026-06-13T10:00:00Z')), 'x')).toThrow('Zu wenige Trackpunkte');
  });

  it('ignoriert ungültige Koordinaten', () => {
    const g = parseGpx(gpx(pt(54, 13, '2026-06-13T10:00:00Z') + pt(999, 13, '2026-06-13T10:05:00Z') + pt(54.01, 13, '2026-06-13T10:10:00Z')), 'x');
    expect(g.points).toHaveLength(2);
  });

  it('wertet die mitgelieferten Beispiel-Tracks plausibel aus', () => {
    const text = readFileSync(resolve('public/tracks/20260613_Stralsund_Prerow.gpx'), 'utf8');
    const g = parseGpx(text, 'x');
    const s = computeTrackStats(g.points);
    expect(g.points.length).toBeGreaterThan(5000);
    expect(s.distNm).toBeGreaterThan(20);
    expect(s.distNm).toBeLessThan(80);
    expect(s.maxSpeed).toBeLessThan(15); // Segelboot – Ausreißer müssen raus sein
    expect(s.hasTime).toBe(true);
  });
});
