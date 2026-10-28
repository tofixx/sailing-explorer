// Fahrtenbuch: reine Regeln (Konzept 19, src/domain/logbook.ts).
import { describe, expect, it } from 'vitest';
import {
  BACKFILL_MS, LOG_LIMITS, departureError, hasLog, isBackfill, logQuotaMessage, logTitle, manualExpiry, parseLog, plausibleDistance, plausibleGpx,
  readLog, recordedNote, routeNm, seasonRange,
} from '../src/domain/logbook';
import { seasonOf, shareExpiry } from '../src/domain/support';

const DAY = 86_400_000;
const H = 3_600_000;

describe('parseLog', () => {
  it('[F-301] übernimmt gültige Angaben, rundet Motorstunden, lässt Leeres weg', () => {
    expect(parseLog({ engineH: '1.26', wind: { bft: 4, dir: 'SW' }, sea: 'moderate', sails: ' Groß ', berth: '', notes: 'a\r\nb' })).toEqual({
      log: { engineH: 1.3, wind: { bft: 4, dir: 'SW' }, sea: 'moderate', sails: 'Groß', notes: 'a\nb' },
    });
    expect(parseLog(undefined)).toEqual({ log: {} });
    expect(parseLog({ wind: { bft: 0 } })).toEqual({ log: { wind: { bft: 0, dir: null } } });
  });

  it('[F-301] lehnt Unbekanntes und zu Langes ab', () => {
    for (const bad of [[], 'x', { engineH: 501 }, { wind: { bft: 2.5 } }, { wind: { bft: 3, dir: 'X' } }, { sea: 'still' }, { berth: 'x'.repeat(LOG_LIMITS.berthMax + 1) }, { notes: 5 }]) {
      expect('error' in parseLog(bad), JSON.stringify(bad)).toBe(true);
    }
  });

  it('[F-301] readLog verträgt kaputtes JSON; timed zählt nicht als Angabe', () => {
    expect(readLog('{kaputt')).toEqual({});
    expect(readLog('{"timed":true,"sea":"calm"}')).toEqual({ timed: true, sea: 'calm' });
    expect(hasLog({ timed: true })).toBe(false);
    expect(hasLog({ sea: 'calm' })).toBe(true);
  });
});

describe('plausibleDistance', () => {
  const t = Date.UTC(2026, 5, 13, 10);
  const ok = (o: Partial<Parameters<typeof plausibleDistance>[0]>) => plausibleDistance({ distNm: 10, routeNm: 5, startedAt: t, endedAt: null, hasTime: false, ...o });

  it('[F-304] Strecke mindestens die Linie zwischen den Häfen (mit Rundungsspielraum)', () => {
    expect(ok({})).toBeNull();
    expect(ok({ distNm: 4.9, routeNm: 5 })).toBeNull();
    expect(ok({ distNm: 4, routeNm: 5 })).toMatch(/kürzer/);
  });

  it('[F-304] Obergrenzen: 2.000 sm, 120 sm je Kalendertag, 15 kn, 30 Tage', () => {
    expect(ok({ distNm: 0 })).toMatch(/Strecke/);
    expect(ok({ distNm: 2001 })).toMatch(/2.000 sm/);
    expect(ok({ distNm: 121 })).toMatch(/120 sm je Tag/);
    expect(ok({ distNm: 240, endedAt: t + DAY })).toBeNull();
    expect(ok({ distNm: 46, endedAt: t + 3 * H, hasTime: true })).toMatch(/15 kn/);
    expect(ok({ distNm: 45, endedAt: t + 3 * H, hasTime: true })).toBeNull();
    expect(ok({ endedAt: t - H })).toMatch(/vor der Abfahrt/);
    expect(ok({ endedAt: t + 31 * DAY })).toMatch(/30 Tage/);
  });

  it('[F-304] Abfahrt: nicht in der Zukunft, höchstens 5 Jahre zurück', () => {
    const now = Date.UTC(2026, 9, 28);
    expect(departureError(now - DAY, now)).toBeNull();
    expect(departureError(now + 12 * H, now)).toBeNull();
    expect(departureError(now + 2 * DAY, now)).toMatch(/Zukunft/);
    expect(departureError(now - 6 * 365 * DAY, now)).toMatch(/5 Jahre/);
    expect(departureError(NaN, now)).toMatch(/Datum/);
  });
});

describe('plausibleGpx', () => {
  const t = Date.UTC(2026, 5, 13, 10);
  it('[F-311] 2.000 sm, 60 Tage, 30 kn; ohne Zeitstempel nur die Obergrenze', () => {
    expect(plausibleGpx(1999, null, null)).toBeNull();
    expect(plausibleGpx(2001, null, null)).toMatch(/2.000 sm/);
    expect(plausibleGpx(90, t, t + 3 * H)).toBeNull();
    expect(plausibleGpx(91, t, t + 3 * H)).toMatch(/30 kn/);
    expect(plausibleGpx(5, t, t + 61 * DAY)).toMatch(/60 Tage/);
    expect(plausibleGpx(5, t, t - H)).toMatch(/vor seinem Start/);
    // kurze Tracks: mindestens eine Viertelstunde
    expect(plausibleGpx(7, t, t + 60_000)).toBeNull();
  });
});

describe('Titel, Route, Saison', () => {
  it('[F-300] Titel-Vorschlag', () => {
    expect(logTitle('Potsdam', 'Werder')).toBe('Potsdam → Werder');
    expect(logTitle('Potsdam', 'Potsdam')).toBe('Rundtörn ab Potsdam');
    expect(logTitle('Potsdam', '')).toBe('Rundtörn ab Potsdam');
  });

  it('[F-300] Länge der Route in sm', () => {
    expect(routeNm([[54, 13], [54 + 1 / 60, 13]])).toBeCloseTo(1, 2);
    expect(routeNm([[54, 13]])).toBe(0);
  });

  it('[F-305] Saison-Zeitraum passt zu seasonOf; Meldung nennt die Saison', () => {
    const [a, b] = seasonRange(2026);
    expect(seasonOf(a)).toBe(2026);
    expect(seasonOf(b - 1)).toBe(2026);
    expect(seasonOf(b)).toBe(2027);
    expect(seasonOf(a - 1)).toBe(2025);
    expect(logQuotaMessage(2026)).toBe('100 Fahrtenbuch-Einträge für 2026 erreicht – bitte einen älteren löschen.');
  });

  it('[F-306] manualExpiry: eine Saison länger als ein Törn, Unterstützung kann verlängern', () => {
    expect(manualExpiry(Date.UTC(2026, 5, 1), null)).toBe(Date.UTC(2028, 1, 1));
    expect(manualExpiry(Date.UTC(2026, 10, 5), null)).toBe(Date.UTC(2029, 1, 1));
    expect(manualExpiry(Date.UTC(2026, 5, 1), Date.UTC(2030, 0, 1))).toBe(Date.UTC(2030, 1, 1));
    expect(manualExpiry(Date.UTC(2026, 5, 1), null) - shareExpiry(Date.UTC(2026, 5, 1), null)).toBe(365 * DAY);
  });

  it('[F-303] „davon aufgezeichnet“ nur, wenn nicht alles aufgezeichnet ist', () => {
    expect(recordedNote(1234, 1020)).toBe('davon 1.020 sm aufgezeichnet');
    expect(recordedNote(100, 100)).toBe('');
    expect(recordedNote(0, 0)).toBe('');
  });

  it('[F-308] Nachtrag: Abfahrt mehr als 14 Tage vor dem Anlegen', () => {
    const now = Date.UTC(2026, 9, 28);
    expect(isBackfill(now - BACKFILL_MS - 1, now)).toBe(true);
    expect(isBackfill(now - BACKFILL_MS + 1, now)).toBe(false);
    expect(isBackfill(null, now)).toBe(false);
  });
});
