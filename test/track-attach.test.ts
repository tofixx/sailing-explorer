// GPX nachreichen (Konzept 38): reine Regeln in src/domain/track-attach.ts.
import { describe, expect, it } from 'vitest';
import { attachExpiryError, canAttachTrack, trackDateError } from '../src/domain/track-attach';
import { WARN_MS, shareExpiry } from '../src/domain/support';

const DAY = 86_400_000;
const D = (m: number, d: number, h = 12) => Date.UTC(2026, m - 1, d, h);

describe('F-600 canAttachTrack', () => {
  it('[F-600] nur Eigentümer:in und nur Einträge ohne GPX', () => {
    expect(canAttachTrack({ isOwner: true, source: 'manual' })).toBe(true);
    expect(canAttachTrack({ isOwner: true, source: 'gpx' })).toBe(false);
    expect(canAttachTrack({ isOwner: true })).toBe(false);
    expect(canAttachTrack({ isOwner: false, source: 'manual' })).toBe(false);
  });
});

describe('F-602 trackDateError: Tag des Eintrags ± 1 Kalendertag (UTC)', () => {
  const entry = { startedAt: D(6, 13, 0), endedAt: null };
  it('[F-602] am Tag selbst, am Vortag und am Folgetag in Ordnung', () => {
    expect(trackDateError(entry, D(6, 13, 10), D(6, 13, 15))).toBeNull();
    expect(trackDateError(entry, D(6, 12, 0), D(6, 12, 1))).toBeNull();
    expect(trackDateError(entry, D(6, 14, 23), D(6, 14, 23))).toBeNull();
  });
  it('[F-602] zwei Tage daneben: Meldung mit beiden Daten', () => {
    expect(trackDateError(entry, D(6, 15, 0), D(6, 15, 2))).toMatch(/15\.06\.2026.*13\.06\.2026/);
    expect(trackDateError(entry, D(6, 10, 0), D(6, 11, 0) - 1)).not.toBeNull();
  });
  it('[F-602] mehrtägiger Eintrag: das ganze Fenster bis zur Ankunft zählt; ein langer Track, der es überspannt, auch', () => {
    const trip = { startedAt: D(6, 10), endedAt: D(6, 14) };
    expect(trackDateError(trip, D(6, 15, 8), D(6, 15, 9))).toBeNull();
    expect(trackDateError(trip, D(6, 1), D(6, 30))).toBeNull();
    expect(trackDateError(trip, D(6, 17), D(6, 17, 13))).not.toBeNull();
  });
  it('[F-602] ohne Zeitstempel im Track nichts zu prüfen', () => {
    expect(trackDateError(entry, null, null)).toBeNull();
    expect(trackDateError({ startedAt: null, endedAt: null }, D(1, 1), D(1, 1))).toBeNull();
  });
  it('[F-602] Track ohne Ende zählt als Zeitpunkt', () => {
    expect(trackDateError(entry, D(6, 13), null)).toBeNull();
  });
});

describe('F-604 attachExpiryError: Löschtermin nach Törn-Regel', () => {
  const now = Date.UTC(2026, 10, 3);
  it('[F-604] angelegt in der laufenden Saison: in Ordnung', () => {
    expect(attachExpiryError(Date.UTC(2026, 5, 1), null, now)).toBeNull();
  });
  it('[F-604] angelegt in der Vorsaison: Termin vorbei → Meldung mit Datum', () => {
    expect(attachExpiryError(Date.UTC(2025, 5, 1), null, now)).toContain('01.02.2026');
  });
  it('[F-604] Grenze ist die Warnfrist; Unterstützung verschiebt sie', () => {
    const created = Date.UTC(2025, 5, 1);
    const expires = shareExpiry(created, null);
    expect(attachExpiryError(created, null, expires - WARN_MS - DAY)).toBeNull();
    expect(attachExpiryError(created, null, expires - WARN_MS)).not.toBeNull();
    expect(attachExpiryError(created, Date.UTC(2027, 0, 1), now)).toBeNull();
  });
});
