// Fahrtenbuch nach Jahren: reine Regeln (Konzept 27) – Zusatzangaben (F-412), Vorschläge aus dem Track (F-460), Filter und
// Summen (F-455), Crew-Ausnahme M1 (F-456), Meilennachweis als CSV (F-457).
import { describe, expect, it } from 'vitest';
import { LOG_LIMITS, fieldInArea, parseLog, readLog } from '../src/domain/logbook';
import { calendarDaysBerlin, suggestFromTracks, sunAltitude } from '../src/domain/logbook-suggest';
import {
  crewLogState, csvCell, csvFileName, durationText, entrySeason, filterEntries, logbookCsv, logbookSeasons, logbookTotals, parseLogFilter, pickSeason,
  type LogbookEntry,
} from '../src/domain/logbook-year';
import { LOG_STATES, type LogState } from '../src/domain/logbook';
import { computeTrackStats } from '../src/domain/stats';
import type { Track, TrackPoint } from '../src/domain/types';
import { shownSeason } from '../src/domain/support';

const H = 3_600_000;
const DAY = 24 * H;

describe('Zusatzangaben (F-412)', () => {
  it('[F-412] übernimmt Revier, Stunden, Tage, Regatta und Posten; rundet auf 0,1 h, Komma geht', () => {
    const r = parseLog({
      area: 'inland', sailH: '3,26', engineH: 0.5, daysAboard: 2, locks: 3, bridges: '1', mast: 2,
      regatta: { name: ' Havelpokal ', place: '2', starters: 12 }, items: [{ name: ' Training ', n: '1,5', note: 'Jugend' }, { name: '', n: 3 }],
    });
    expect(r).toEqual({
      log: {
        engineH: 0.5, area: 'inland', sailH: 3.3, daysAboard: 2, locks: 3, bridges: 1, mast: 2,
        regatta: { name: 'Havelpokal', place: 2, starters: 12 }, items: [{ name: 'Training', n: 1.5, note: 'Jugend' }],
      },
    });
  });

  it('[F-412] Felder, die nicht zum Revier passen, fallen weg (Binnen: Schleusen/Brücken/Mast, Küste: Nacht/Tide)', () => {
    expect(parseLog({ area: 'coastal', locks: 2, nightH: 4, tidal: true })).toEqual({ log: { area: 'coastal', nightH: 4, tidal: true } });
    expect(parseLog({ area: 'inland', locks: 2, nightH: 4, tidal: true })).toEqual({ log: { area: 'inland', locks: 2 } });
    expect(parseLog({ locks: 2, nightH: 4, sailH: 1 })).toEqual({ log: { sailH: 1 } });
    expect(fieldInArea('tidal', 'offshore')).toBe(true);
    expect(fieldInArea('mast', 'coastal')).toBe(false);
  });

  it('[F-412] lehnt Unbekanntes und Grenzüberschreitungen mit deutscher Meldung ab', () => {
    const bad = [
      { sailH: true }, { locks: [2] }, { area: 'inland', locks: { n: 2 } },
      { area: 'see' }, { sailH: 501 }, { daysAboard: 0 }, { daysAboard: 1.5 }, { locks: -1 }, { mast: 51 },
      { regatta: { name: '' } }, { regatta: { name: 'X', place: 5, starters: 3 } }, { regatta: 'X' },
      { items: 'Training' }, { items: Array.from({ length: LOG_LIMITS.itemsMax + 1 }, () => ({ name: 'a', n: 1 })) },
      { items: [{ name: 'x'.repeat(LOG_LIMITS.itemNameMax + 1) }] }, { items: [{ name: 'a', n: 1000 }] }, { items: [{ name: 'a', note: 'x'.repeat(201) }] },
    ];
    for (const b of bad) {
      const r = parseLog(b);
      expect('error' in r, JSON.stringify(b)).toBe(true);
      if ('error' in r) expect(r.error).toMatch(/[a-zäöü]/);
    }
  });

  it('[F-412] ganze Angaben höchstens 8.000 Zeichen; gespeicherte Angaben bleiben lesbar', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ name: `Posten ${i}`.padEnd(40, 'x'), n: 1, note: 'y'.repeat(200) }));
    expect('log' in parseLog({ notes: 'n'.repeat(2000), items })).toBe(true);
    expect(readLog(JSON.stringify({ area: 'offshore', tidal: true, items: [{ name: 'Überführung', n: 1 }] }))).toEqual({ area: 'offshore', tidal: true, items: [{ name: 'Überführung', n: 1 }] });
  });
});

// ---------------------------------------------------------------- Vorschläge aus dem Track

const pt = (lat: number, lon: number, time: number): TrackPoint => ({ lat, lon, time, ele: null, speed: null, speedSmooth: null, glitch: false, wx: null });
const track = (points: TrackPoint[], over: Partial<Track> = {}): Track => ({ id: 't', name: 'T', raw: '', points, stats: computeTrackStats(points), color: '#000', hidden: false, ...over });
/** Gerade nach Osten mit konstanter Fahrt (kn), ein Punkt je Minute. */
function straight(start: number, minutes: number, kn: number, lat = 54.2, lon = 11): TrackPoint[] {
  const dLon = (kn * 1852) / 60 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: minutes + 1 }, (_, i) => pt(lat, lon + i * dLon, start + i * 60_000));
}
/** Kreuzen: Zickzack mit wechselnder Fahrt (Wenden alle 5 Minuten). */
function tacking(start: number, minutes: number, lat = 54.2, lon = 11): TrackPoint[] {
  const out: TrackPoint[] = [];
  let a = lat;
  let o = lon;
  for (let i = 0; i <= minutes; i++) {
    out.push(pt(a, o, start + i * 60_000));
    const kn = 3 + 2 * Math.sin(i / 2);
    const m = (kn * 1852) / 60;
    const north = Math.floor(i / 5) % 2 === 0 ? 1 : -1;
    a += (north * m * 0.7) / 111_320;
    o += (m * 0.7) / (111_320 * Math.cos((lat * Math.PI) / 180));
  }
  return out;
}

describe('Vorschläge aus dem Track (F-460)', () => {
  it('[F-460] Sonnenstand: Mittag im Juni hoch, Mitternacht unter dem Horizont', () => {
    expect(sunAltitude(Date.UTC(2026, 5, 21, 11, 10), 52.4, 13.06)).toBeGreaterThan(58);
    expect(sunAltitude(Date.UTC(2026, 5, 21, 23, 0), 52.4, 13.06)).toBeLessThan(-5);
    expect(sunAltitude(Date.UTC(2026, 11, 21, 11, 0), 52.4, 13.06)).toBeLessThan(16);
  });

  it('[F-460] gleichmäßige gerade Fahrt = Motor, Kreuzen = Segel; Summe = Zeit in Fahrt', () => {
    const t0 = Date.UTC(2026, 5, 13, 8);
    const motor = suggestFromTracks([track(straight(t0, 60, 5.5))]);
    expect(motor.engineH).toBeGreaterThanOrEqual(0.9);
    expect(motor.sailH).toBeLessThanOrEqual(0.1);
    const sail = suggestFromTracks([track(tacking(t0, 60))]);
    expect(sail.engineH).toBe(0);
    expect(sail.sailH).toBeCloseTo(1, 1);
    expect(sail.nightH).toBe(0);
    expect(sail.daysAboard).toBe(1);
  });

  it('[F-460] Nacht nach Sonnenstand, Tage an Bord in Ortszeit (über Mitternacht = 2)', () => {
    const t0 = Date.UTC(2026, 5, 13, 21, 30); // 23:30 in Berlin
    const s = suggestFromTracks([track(tacking(t0, 120))]);
    expect(s.nightH).toBeGreaterThan(1.5);
    expect(s.daysAboard).toBe(2);
    expect(calendarDaysBerlin(Date.UTC(2026, 5, 13, 21, 30), Date.UTC(2026, 5, 13, 21, 50))).toBe(1);
    expect(calendarDaysBerlin(Date.UTC(2026, 5, 13, 21, 30), Date.UTC(2026, 5, 13, 22, 10))).toBe(2);
  });

  it('[F-460] ohne Zeitstempel bzw. für Einträge ohne GPX kein Vorschlag; lange Lücken zählen nicht', () => {
    const none = { sailH: null, engineH: null, nightH: null, daysAboard: null };
    expect(suggestFromTracks([])).toEqual(none);
    const noTime = straight(Date.UTC(2026, 5, 13, 8), 10, 5).map((p) => ({ ...p, time: null }));
    expect(suggestFromTracks([track(noTime)])).toEqual(none);
    expect(suggestFromTracks([track(straight(Date.UTC(2026, 5, 13, 8), 10, 5), { estimated: true })])).toEqual(none);
    const t0 = Date.UTC(2026, 5, 13, 8);
    const gap = [...tacking(t0, 30), ...tacking(t0 + 5 * H, 30, 54.25, 11.1)];
    const s = suggestFromTracks([track(gap)]);
    expect((s.sailH ?? 0) + (s.engineH ?? 0)).toBeLessThan(1.1);
  });
});

// ---------------------------------------------------------------- Liste, Filter, Summen

const base: LogbookEntry = {
  id: 'a', own: true, path: '/s/a', title: 'T', startedAt: Date.UTC(2026, 5, 13, 10), endedAt: null, timed: false, source: 'gpx',
  distNm: 10, distSource: 'track', from: { slug: 'potsdam', name: 'Potsdam' }, to: { slug: 'werder', name: 'Werder' },
  role: null, roleConfirmed: false, boat: null, logState: 'suggested', log: {},
};
const e = (o: Partial<LogbookEntry>): LogbookEntry => ({ ...base, ...o });

describe('Fahrtenbuch nach Jahren (F-411, F-455)', () => {
  it('[F-411] Saison wie überall (ab November die nächste), neueste zuerst; ohne Einträge die laufende', () => {
    expect(entrySeason(e({ startedAt: Date.UTC(2025, 10, 2) }))).toBe(2026);
    expect(logbookSeasons([e({ startedAt: Date.UTC(2024, 6, 1) }), e({ startedAt: Date.UTC(2026, 6, 1) }), e({ startedAt: Date.UTC(2024, 7, 1) })], 0)).toEqual([2026, 2024]);
    expect(logbookSeasons([], Date.UTC(2026, 10, 3))).toEqual([2026]);
  });

  it('[F-555] vorgewählt wird bis Ende Februar die abgelaufene Saison, ab 1. März die neue', () => {
    expect(shownSeason(Date.UTC(2026, 10, 3))).toBe(2026);
    expect(shownSeason(Date.UTC(2027, 1, 28))).toBe(2026);
    expect(shownSeason(Date.UTC(2027, 2, 1))).toBe(2027);
    expect(shownSeason(Date.UTC(2027, 6, 1))).toBe(2027);
    expect(pickSeason([2027, 2025], 2026)).toBe(2025);
    expect(pickSeason([2027], 2026)).toBe(2027);
    expect(pickSeason([2027, 2026], 2026)).toBe(2026);
    // Einträge ab November zählen weiter zur nächsten Saison
    expect(entrySeason(e({ startedAt: Date.UTC(2026, 10, 3) }))).toBe(2027);
  });

  it('[F-455] Filter nach Stand mit Mehrfachauswahl; Unbekanntes fällt weg, leer = Bestätigte und Vorschläge', () => {
    expect(parseLogFilter('excluded,confirmed,quatsch')).toEqual(['confirmed', 'excluded']);
    expect(parseLogFilter('')).toEqual(['confirmed', 'suggested']);
    expect(parseLogFilter(null)).toEqual(['confirmed', 'suggested']);
    const list = LOG_STATES.map((s, i) => e({ id: s, logState: s, startedAt: Date.UTC(2026, 5, 1 + i) }));
    expect(filterEntries(list, ['confirmed'], 2026).map((x) => x.id)).toEqual(['confirmed']);
    expect(filterEntries(list, ['suggested', 'excluded'], null).map((x) => x.id)).toEqual(['suggested', 'excluded']);
    expect(filterEntries(list, ['confirmed', 'suggested', 'excluded'], 2025)).toEqual([]);
  });

  it('[F-455] Summen: ausgeschlossene nie; aufgezeichnet, Skipper, Küste, Stunden, Tage, Häfen, Posten zusammengefasst', () => {
    const t = logbookTotals([
      e({ distNm: 10, role: 'skipper', log: { sailH: 2, engineH: 0.5, area: 'coastal', tidal: true, nightH: 1, items: [{ name: 'Training', n: 1 }] } }),
      e({ id: 'b', distNm: 5, distSource: 'stated', logState: 'confirmed', endedAt: base.startedAt + 2 * DAY, to: { slug: 'brandenburg', name: 'Brandenburg' }, log: { locks: 2, items: [{ name: 'training', n: 2 }] } }),
      e({ id: 'c', distNm: 100, logState: 'excluded', log: { sailH: 50 } }),
    ]);
    expect(t).toMatchObject({ count: 2, nm: 15, recordedNm: 10, skipperNm: 10, coastalNm: 10, tidal: 1, sailH: 2, engineH: 0.5, nightH: 1, locks: 2, harbors: 3, days: 4 });
    expect(t.items).toEqual([{ name: 'Training', n: 3 }]);
    expect(logbookTotals([e({ log: { daysAboard: 5 } })]).days).toBe(5);
  });

  it('[F-456] Crew-Ausnahme M1: bestätigt in jeder Sichtbarkeit, sonst nur öffentlich als Vorschlag; nie ausgeblendet, gesperrt, ausgeschlossen, gesperrtes Konto', () => {
    const ok = { confirmed: false, visibility: 'public' as const, hidden: false, locked: false, ownerSuspended: false, ownerState: 'suggested' as LogState };
    expect(crewLogState(ok)).toBe('suggested');
    expect(crewLogState({ ...ok, confirmed: true, visibility: 'private' })).toBe('confirmed');
    expect(crewLogState({ ...ok, visibility: 'unlisted' })).toBeNull();
    expect(crewLogState({ ...ok, confirmed: true, hidden: true })).toBeNull();
    expect(crewLogState({ ...ok, confirmed: true, locked: true })).toBeNull();
    expect(crewLogState({ ...ok, confirmed: true, ownerState: 'excluded' })).toBeNull();
    expect(crewLogState({ ...ok, confirmed: true, ownerSuspended: true })).toBeNull();
  });
});

describe('Meilennachweis als CSV (F-457)', () => {
  it('[F-457] Kopf, BOM, Semikolon, CRLF, älteste zuerst; Rundtörn nennt den Starthafen als Ziel', () => {
    const csv = logbookCsv([
      e({ id: 'b', startedAt: Date.UTC(2026, 6, 1, 8), endedAt: Date.UTC(2026, 6, 1, 11, 30), timed: true, role: 'skipper', roleConfirmed: true, boat: 'Möwe', distNm: 14.25 }),
      e({ startedAt: Date.UTC(2026, 5, 13, 10), source: 'manual', distSource: 'stated', to: null, endedAt: Date.UTC(2026, 5, 15, 10), role: 'crew' }),
    ]);
    expect(csv.startsWith('﻿Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer\r\n')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[1]).toBe('13.06.2026;Potsdam;Potsdam;10,0;Angabe;Crew;;3 Tage');
    expect(lines[2]).toBe('01.07.2026;Potsdam;Werder;14,3;aufgezeichnet;Skipper:in (bestätigt);Möwe;3,5 h');
  });

  it('[F-457] Datum in Ortszeit, Zellen gegen Formeln und Trennzeichen geschützt, Dateiname mit Saison', () => {
    expect(logbookCsv([e({ startedAt: Date.UTC(2026, 5, 13, 22, 30) })]).split('\r\n')[1]).toMatch(/^14\.06\.2026;/);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+49')).toBe("'+49");
    expect(csvCell('Steg; B')).toBe('"Steg; B"');
    expect(csvCell('Werder')).toBe('Werder');
    expect(durationText(e({ endedAt: base.startedAt + 3 * H }))).toBe('');
    // gekappt: Hinweis als letzte Zeile
    expect(logbookCsv([e({})], true).trimEnd().split('\r\n').at(-1)).toMatch(/^Hinweis: nur die neuesten 1000 Einträge/);
    expect(logbookCsv([e({})]).trimEnd().split('\r\n')).toHaveLength(2);
    expect(csvFileName(2026)).toBe('meilennachweis-2026.csv');
    expect(csvFileName(null)).toBe('meilennachweis.csv');
  });
});
