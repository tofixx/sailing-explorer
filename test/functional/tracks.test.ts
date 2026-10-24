// @vitest-environment happy-dom
// Funktionale Tests: Tracks laden & auswerten, Darstellung (Logik), Wetter (F-01 … F-05, F-11, F-14, F-15, F-20, F-21)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GpxError, parseGpx } from '../../src/domain/gpx';
import { computeTrackStats, validSpeed } from '../../src/domain/stats';
import { METRICS, METRIC_KEYS, metricRange, rampColor, RAMP } from '../../src/domain/metrics';
import { kpis } from '../../src/domain/summary';
import { layoutSegments, segmentByGaps, timeline } from '../../src/domain/timeline';
import { attachConditions, bounds } from '../../src/domain/weather';
import { median } from '../../src/domain/geo';
import { initialState, visibleTracks, type State } from '../../src/services/store';
import { loadWeather } from '../../src/services/weather-api';
import { P, T0, genPoints, gpxDoc, jsonResponse, makeTrack, meteoResponse, sampleGpx, leanParser, trackFrom, type MeteoValues } from './helpers';

/** KPI-Wert als Zahl (deutsches Format „6,0“ bzw. Dauer „h:mm“). */
function kpi(tracks: Parameters<typeof kpis>[0], key: string): number {
  const v = kpis(tracks).find((k) => k.key === key)?.value;
  if (v == null) return NaN;
  const dur = /^(\d+):(\d\d)$/.exec(v);
  if (dur) return Number(dur[1]) + Number(dur[2]) / 60;
  return Number(v.replace(/\./g, '').replace(',', '.'));
}

describe('F-01 GPX laden', () => {
  it('[F-01] erkennt Trackpunkte (trkpt)', () => {
    const g = parseGpx(gpxDoc(genPoints({ n: 5 }), 'Trk', 'trk'), 'f');
    expect(g.name).toBe('Trk');
    expect(g.points).toHaveLength(5);
  });

  it('[F-01] erkennt Routenpunkte (rtept), wenn keine Trackpunkte vorhanden sind', () => {
    const g = parseGpx(gpxDoc(genPoints({ n: 4 }), 'Route', 'rte'), 'f');
    expect(g.name).toBe('Route');
    expect(g.points).toHaveLength(4);
  });

  it('[F-01] erkennt Wegpunkte (wpt), wenn weder Track noch Route vorhanden sind', () => {
    const g = parseGpx(gpxDoc(genPoints({ n: 3 }), 'Wegpunkte', 'wpt'), 'f');
    expect(g.name).toBe('Wegpunkte');
    expect(g.points).toHaveLength(3);
  });

  it('[F-01] Trackpunkte haben Vorrang vor Wegpunkten (Beispieldatei mit Start/Ende-wpt)', { timeout: 60_000 }, () => {
    const g = parseGpx(sampleGpx('20260613_Stralsund_Prerow'), 'x');
    expect(g.name).toBe('Stralsund Prerow');
    expect(g.points.length).toBeGreaterThan(1000);
  });

  it('[F-01] ohne Namen im GPX wird der Dateiname verwendet', () => {
    const doc = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="54" lon="13"/><trkpt lat="54.1" lon="13"/></trkseg></trk></gpx>`;
    expect(parseGpx(doc, '20260613_Datei').name).toBe('20260613_Datei');
  });

  it('[F-01] mehrere Dateien werden unabhängig voneinander gelesen (beide Beispiel-Tracks)', { timeout: 60_000 }, () => {
    const names = ['20260613_Stralsund_Prerow', '20260614_Prerow_Rostock'].map((f) => parseGpx(sampleGpx(f), f, leanParser()).name);
    expect(names).toEqual(['Stralsund Prerow', expect.stringMatching(/Prerow.*Rostock/)]);
  });
});

describe('F-02 Ungültige Dateien', () => {
  const twoPts = genPoints({ n: 2 });
  const cases: Array<[string, string, RegExp]> = [
    ['kein GPX (HTML)', '<html><body>x</body></html>', /Keine GPX-Datei/],
    ['kaputtes XML', '<gpx><trk><trkseg><trkpt lat="1" lon="1"></trk>', /Ungültige GPX\/XML-Datei/],
    ['DOCTYPE', `<?xml version="1.0"?><!DOCTYPE gpx>${gpxDoc(twoPts).replace('<?xml version="1.0"?>', '')}`, /DOCTYPE/],
    ['ENTITY (Billion Laughs)', `<?xml version="1.0"?><!DOCTYPE g [<!ENTITY a "aaaaaaaa"><!ENTITY b "&a;&a;&a;">]><gpx/>`, /DOCTYPE/],
    ['nur 1 Punkt', gpxDoc(genPoints({ n: 1 })), /Zu wenige Trackpunkte/],
    ['leeres GPX', '<gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>', /Zu wenige Trackpunkte/],
    ['nur ungültige Koordinaten', gpxDoc([{ lat: 99, lon: 13, time: null }, { lat: 54, lon: 200, time: null }]), /Zu wenige Trackpunkte/],
  ];
  for (const [label, text, msg] of cases) {
    it(`[F-02] lehnt ab mit verständlicher Meldung: ${label}`, () => {
      expect(() => parseGpx(text, 'x')).toThrow(GpxError);
      expect(() => parseGpx(text, 'x')).toThrow(msg);
    });
  }

  it('[F-02] Fehlermeldungen sind deutschsprachig und ohne technische Stacktraces', () => {
    for (const [, text] of cases) {
      try {
        parseGpx(text, 'x');
      } catch (e) {
        expect((e as Error).message.length).toBeLessThan(60);
        expect((e as Error).message).not.toMatch(/at |Error:|undefined/);
      }
    }
  });
});

describe('F-03 Kennzahlen pro Track', () => {
  it('[F-03] Distanz (sm), Fahrzeit (h), Ø- und Max-Speed (kn) aus den Zeitstempeln', () => {
    // 1 h mit 6 kn, ein Punkt pro Minute
    const t = trackFrom({ n: 61, dt: 60, kn: 6 });
    expect(t.stats.distNm).toBeCloseTo(6, 1);
    expect(t.stats.movingH).toBeCloseTo(1, 2);
    expect(t.stats.avgSpeed).toBeCloseTo(6, 1);
    expect(t.stats.maxSpeed).toBeCloseTo(6, 1);
    expect(t.stats.start).toBe(T0);
    expect(t.stats.end).toBe(T0 + 3_600_000);
    expect(t.stats.hasTime).toBe(true);
  });

  it('[F-03] Liegezeiten (keine Bewegung) und lange Lücken zählen nicht zur Fahrzeit', () => {
    const a = genPoints({ n: 31, dt: 60, kn: 6 });
    const last = a[a.length - 1];
    // 30 min stillliegen (gleiche Position), dann 2 h Lücke, dann weiter
    const still = Array.from({ length: 30 }, (_, i) => ({ ...last, time: last.time! + (i + 1) * 60_000 }));
    const b = genPoints({ n: 31, dt: 60, kn: 6, start: still[still.length - 1].time! + 2 * 3_600_000, lat: last.lat });
    const t = makeTrack([...a, ...still, ...b].map((p) => P(p.lat, p.lon, p.time)));
    expect(t.stats.movingH).toBeCloseTo(1, 1);
    expect(t.stats.distNm).toBeCloseTo(6, 1);
  });

  it('[F-03] Kennzahlen der Reise summieren die Tracks (Distanz, Fahrzeit) und mitteln Speed', () => {
    const a = trackFrom({ n: 61, kn: 6 });
    const b = trackFrom({ n: 61, kn: 4, start: T0 + 86_400_000 });
    expect((kpi([a, b], 'dist'))).toBeCloseTo(10, 0);
    expect((kpi([a, b], 'time'))).toBeCloseTo(2, 1);
    expect((kpi([a, b], 'avgSpeed'))).toBeCloseTo(5, 0);
    expect((kpi([a, b], 'maxSpeed'))).toBeCloseTo(6, 0);
  });

  it('[F-03] Beispiel-Track liefert plausible Werte für ein Segelboot', { timeout: 60_000 }, () => {
    const g = parseGpx(sampleGpx('20260614_Prerow_Rostock'), 'x', leanParser());
    const s = computeTrackStats(g.points);
    expect(s.distNm).toBeGreaterThan(10);
    expect(s.movingH).toBeGreaterThan(1);
    expect(s.avgSpeed).toBeGreaterThan(1);
    expect(s.maxSpeed).toBeGreaterThan(s.avgSpeed);
    expect(s.maxSpeed).toBeLessThan(15);
  });
});

describe('F-04 GPS-Ausreißer', () => {
  function withJump() {
    const pts = genPoints({ n: 121, dt: 10, kn: 6 }).map((p) => P(p.lat, p.lon, p.time));
    // ein Punkt springt 2 km zur Seite und wieder zurück
    pts[60] = P(pts[60].lat, pts[60].lon + 0.03, pts[60].time);
    return makeTrack(pts);
  }

  it('[F-04] erkennt Sprünge, zählt sie und hält Max-Speed realistisch', () => {
    const t = withJump();
    expect(t.stats.nGlitch).toBeGreaterThan(0);
    expect(t.stats.maxSpeed).toBeLessThan(8);
    expect(t.points.filter((p) => p.glitch)).toHaveLength(t.stats.nGlitch);
  });

  it('[F-04] Ausreißer fließen nicht in Ø-Speed und Einfärbung (validSpeed) ein', () => {
    const t = withJump();
    expect(t.stats.avgSpeed).toBeLessThan(7);
    for (const p of t.points.filter((x) => x.glitch)) {
      expect(validSpeed(p)).toBeNull();
      expect(METRICS.speed.get(p)).toBeNull();
    }
  });

  it('[F-04] saubere Tracks haben keine Ausreißer', () => {
    expect(trackFrom({ n: 200, dt: 5 }).stats.nGlitch).toBe(0);
  });
});

describe('F-05 Tracks ohne Zeitstempel', () => {
  it('[F-05] Distanz und Punkte funktionieren, Zeit-/Speed-Werte fehlen', () => {
    const g = parseGpx(gpxDoc(genPoints({ n: 61, withTime: false })), 'x');
    const s = computeTrackStats(g.points);
    expect(s.distNm).toBeCloseTo(6, 1);
    expect(s.hasTime).toBe(false);
    expect(s.start).toBeNull();
    expect(s.movingH).toBe(0);
    expect(g.points.every((p) => p.speed == null)).toBe(true);
    expect(bounds([makeTrack(g.points)])).toMatchObject({ tMin: null, tMax: null });
  });

  it('[F-05] Wetter wird nicht abgefragt und nicht zugeordnet – mit Hinweis', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const t = trackFrom({ withTime: false });
    const { data, status } = await loadWeather([t]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(data).toBeNull();
    expect(status.level).toBe('warn');
    expect(status.text).toMatch(/ohne Zeitstempel/);
    attachConditions([t], data);
    expect(t.points.every((p) => p.wx === null)).toBe(true);
  });
});

describe('F-11 Einfärbung und Legende', () => {
  it('[F-11] es gibt die Metriken Speed, Wind, Böen, Wellen mit Einheit', () => {
    expect(METRIC_KEYS).toEqual(['speed', 'wind', 'gust', 'wave']);
    expect(METRIC_KEYS.map((k) => METRICS[k].unit)).toEqual(['kn', 'kn', 'kn', 'm']);
  });

  it('[F-11] Metriken ohne Daten liefern keinen Bereich (→ deaktiviert)', () => {
    const t = trackFrom();
    const available = (k: (typeof METRIC_KEYS)[number]) => t.points.some((p) => METRICS[k].get(p) != null);
    expect(available('speed')).toBe(true);
    expect(available('wind')).toBe(false);
    expect(metricRange([t], 'wind')).toBeNull();
    expect(metricRange([t], 'wave')).toBeNull();
  });

  it('[F-11] Bereich für die Legende: robust (ohne Extremwerte), Speed ab 0', () => {
    const t = trackFrom({ n: 200, dt: 10 });
    t.points.forEach((p, i) => (p.wx = { wind: 10 + (i % 10), gust: 20, dir: 270, wave: i === 50 ? 99 : 1 + (i % 5) / 10, wdir: 0, wper: 4 }));
    expect(metricRange([t], 'speed')!.lo).toBe(0);
    const wind = metricRange([t], 'wind')!;
    expect(wind.lo).toBeGreaterThanOrEqual(10);
    expect(wind.hi).toBeLessThanOrEqual(19);
    expect(metricRange([t], 'wave')!.hi).toBeLessThan(99); // Ausreißer bestimmt die Skala nicht
  });

  it('[F-11] Farbrampe: Anfang/Ende der Legende entsprechen den Rampenfarben', () => {
    const hex = (c: string) => `rgb(${[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',')})`;
    expect(rampColor(0)).toBe(hex(RAMP[0]));
    expect(rampColor(1)).toBe(hex(RAMP[RAMP.length - 1]));
    expect(rampColor(-5)).toBe(rampColor(0));
  });
});

describe('F-14 Diagramme', () => {
  it('[F-14] Pause zwischen Etappen wird getrennt statt überbrückt', () => {
    const a = trackFrom({ n: 61 });
    const b = trackFrom({ n: 61, start: T0 + 20 * 3_600_000 });
    const pts = timeline([a, b]);
    const segs = segmentByGaps(pts);
    expect(segs).toHaveLength(2);
    expect(segs[0].b).toBe(60);
    expect(segs[1].a).toBe(61);
    const lay = layoutSegments(pts, segs, 0, 1000, 12);
    // Lücke zwischen den Segmenten statt einer Linie über die Nacht
    expect(lay.segs[1].x0 - (lay.segs[0].x0 + lay.segs[0].w)).toBe(12);
    // Breite proportional zur Fahrdauer (beide 1 h) – die 19 h Pause nehmen keinen Platz ein
    expect(lay.segs[0].w).toBeCloseTo(lay.segs[1].w, 5);
  });

  it('[F-14] kurze Lücken innerhalb einer Etappe trennen nicht', () => {
    const pts = timeline([trackFrom({ n: 120, dt: 30 })]);
    expect(segmentByGaps(pts)).toHaveLength(1);
  });

  it('[F-14] Median der Geschwindigkeit (wie im Speed-Diagramm)', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('F-15 Sichtbare Tracks', () => {
  it('[F-15] Kennzahlen und Zeitachse beziehen sich nur auf sichtbare Tracks', () => {
    const a = trackFrom({ n: 61, kn: 6 }, { id: 'a' });
    const b = trackFrom({ n: 61, kn: 4, start: T0 + 86_400_000 }, { id: 'b', hidden: true });
    const s: State = { ...initialState, tracks: [a, b] };
    const vis = visibleTracks(s);
    expect(vis.map((t) => t.id)).toEqual(['a']);
    expect((kpi(vis, 'dist'))).toBeCloseTo(6, 0);
    expect(timeline(vis)).toHaveLength(61);
  });
});

// ---------------------------------------------------------------- Wetter

describe('F-20/F-21 Wetter von Open-Meteo', () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockMeteo(handlers: { forecast?: MeteoValues | 'fail' | 'empty'; archive?: MeteoValues | 'fail' | 'empty'; marine?: MeteoValues | 'fail' | 'empty' }) {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      const which = url.includes('marine-api') ? 'marine' : url.includes('archive-api') ? 'archive' : 'forecast';
      const h = handlers[which];
      if (!h || h === 'fail') throw new TypeError('Failed to fetch');
      if (h === 'empty') return jsonResponse(meteoResponse(url, {}));
      return jsonResponse(meteoResponse(url, h));
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  it('[F-20] fragt Wind (Forecast) und Seegang (Marine) für Zeitraum und Gebiet des Tracks stündlich ab', async () => {
    const calls = mockMeteo({ forecast: { wind: 12, gust: 18, dir: 270 }, marine: { wave: 0.8, wdir: 260, wper: 4 } });
    const t = trackFrom({ n: 61, lat: 54.2, lon: 12.5 });
    const { data, status } = await loadWeather([t]);
    const fc = calls.find((u) => u.includes('api.open-meteo.com/v1/forecast'))!;
    const u = new URL(fc);
    expect(u.searchParams.get('latitude')).toBe('54.25');
    expect(u.searchParams.get('longitude')).toBe('12.5');
    expect(u.searchParams.get('start_date')).toBe('2026-06-13');
    expect(u.searchParams.get('end_date')).toBe('2026-06-13');
    expect(u.searchParams.get('hourly')).toBe('wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    expect(u.searchParams.get('wind_speed_unit')).toBe('kn');
    expect(calls.some((x) => x.includes('marine-api.open-meteo.com/v1/marine') && x.includes('wave_height'))).toBe(true);
    expect(calls.some((x) => x.includes('archive-api'))).toBe(false);
    expect(data).toMatchObject({ windOk: true, waveOk: true });
    expect(status).toEqual({ level: 'ok', text: expect.stringMatching(/^Wind und Wellen für .* geladen\.$/) });
  });

  it('[F-20] ohne Forecast-Daten wird das Archiv verwendet', async () => {
    const calls = mockMeteo({ forecast: 'empty', archive: { wind: 9 }, marine: { wave: 1 } });
    const { data } = await loadWeather([trackFrom()]);
    expect(calls.some((u) => u.includes('archive-api.open-meteo.com/v1/archive'))).toBe(true);
    expect(data!.samples[0].wind.every((v) => v === 9)).toBe(true);
  });

  it('[F-20] jedem Punkt werden die Bedingungen der nächsten Stunde zugeordnet', async () => {
    mockMeteo({ forecast: { windAt: (h) => h, gust: 20, dir: 180 }, marine: { wave: 1.2, wdir: 200, wper: 5 } });
    // 10:00 … 11:00 UTC am 13.06.
    const t = trackFrom({ n: 61, dt: 60 });
    const { data } = await loadWeather([t]);
    attachConditions([t], data);
    expect(t.points.every((p) => p.wx != null)).toBe(true);
    expect(t.points[0].wx).toEqual({ wind: 10, dir: 180, gust: 20, wave: 1.2, wdir: 200, wper: 5 });
    expect(t.points[20].wx!.wind).toBe(10); // 10:20 → 10 Uhr
    expect(t.points[40].wx!.wind).toBe(11); // 10:40 → 11 Uhr
    expect(t.points[60].wx!.wind).toBe(11);
    expect(kpis([t]).map((k) => k.key)).toEqual(expect.arrayContaining(['avgWind', 'maxWind', 'avgGust', 'maxGust', 'avgWave', 'maxWave']));
  });

  it('[F-20] mehrere Abfragepunkte entlang langer Tracks (Gebiet), Zuordnung zum nächstgelegenen', async () => {
    const calls = mockMeteo({ forecast: { wind: 10 }, marine: { wave: 1 } });
    // 60 sm nach Norden → mehrere 0,25°-Rasterpunkte
    const t = trackFrom({ n: 601, dt: 60, kn: 6 });
    await loadWeather([t]);
    const lats = new Set(calls.filter((u) => u.includes('/forecast')).map((u) => new URL(u).searchParams.get('latitude')));
    expect(lats.size).toBeGreaterThan(2);
    expect(lats.size).toBeLessThanOrEqual(7);
  });

  it('[F-21] ohne Netz bleibt die App benutzbar: keine Wetterdaten, Fehlerstatus erklärt warum', async () => {
    mockMeteo({ forecast: 'fail', archive: 'fail', marine: 'fail' });
    const t = trackFrom();
    const { data, status } = await loadWeather([t]);
    expect(data).toBeNull();
    expect(status.level).toBe('err');
    expect(status.text).toMatch(/nicht erreichbar/);
    attachConditions([t], data);
    // Speed-Auswertung funktioniert weiter
    expect((kpi([t], 'dist'))).toBeGreaterThan(5);
    expect(kpis([t]).some((k) => k.key === 'avgWind')).toBe(false);
  });

  it('[F-21] Track in der Zukunft: Hinweis „noch keine Messwerte“', async () => {
    mockMeteo({ forecast: 'empty', archive: 'empty', marine: 'empty' });
    const t = trackFrom({ start: Date.now() + 30 * 86_400_000 });
    const { data, status } = await loadWeather([t]);
    expect(data).toBeNull();
    expect(status.level).toBe('warn');
    expect(status.text).toMatch(/noch keine Messwerte/);
  });

  it('[F-21] Wind ohne Wellen (Binnen): Status erklärt fehlende Wellendaten', async () => {
    mockMeteo({ forecast: { wind: 8 }, marine: 'empty' });
    const { data, status } = await loadWeather([trackFrom()]);
    expect(data).toMatchObject({ windOk: true, waveOk: false });
    expect(status.level).toBe('ok');
    expect(status.text).toMatch(/^Wind für .*Keine Wellendaten/);
  });

  it('[F-21] HTTP-Fehler einer Quelle (z. B. 429) führen zur nächsten Quelle statt zum Abbruch', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/forecast')) return new Response('rate limited', { status: 429 });
      return jsonResponse(meteoResponse(url, url.includes('marine') ? { wave: 1 } : { wind: 7 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { data } = await loadWeather([trackFrom()]);
    expect(data!.windOk).toBe(true);
    expect(data!.samples[0].wind[0]).toBe(7);
  });
});
