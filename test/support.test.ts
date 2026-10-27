// Reine Regeln zu Unterstützung und Aufbewahrung (src/domain/support.ts) und der Betragsprüfung (worker/validate.ts).
import { describe, expect, it } from 'vitest';
import {
  GRACE_MS,
  SUPPORT_TIERS,
  extendSupport,
  formatEuro,
  needsSupport,
  quotaText,
  seasonEnd,
  seasonOf,
  shareExpiry,
  tierFor,
} from '../src/domain/support';
import { parseSupportAmount } from '../worker/validate';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24, 12);
const JAN1 = (y: number) => Date.UTC(y, 0, 1);
const FEB1 = (y: number) => Date.UTC(y, 1, 1);

describe('Saison (Konzept 5.5)', () => {
  it('Saison = Kalenderjahr, ab November die nächste', () => {
    expect(seasonOf(Date.UTC(2026, 0, 1))).toBe(2026);
    expect(seasonOf(Date.UTC(2026, 9, 31, 23, 59))).toBe(2026);
    expect(seasonOf(Date.UTC(2026, 10, 1))).toBe(2027);
    expect(seasonOf(Date.UTC(2026, 11, 31))).toBe(2027);
    expect(seasonEnd(2026)).toBe(JAN1(2027));
    expect(GRACE_MS).toBe(31 * DAY);
  });
});

describe('extendSupport', () => {
  it('ohne bisherige Unterstützung: bis Ende der Saison des Zahltags', () => {
    expect(extendSupport(null, NOW)).toBe(JAN1(2027));
    expect(extendSupport(null, Date.UTC(2026, 11, 20))).toBe(JAN1(2028)); // Weihnachten → nächste Saison
  });
  it('laufende Unterstützung: eine Saison mehr', () => {
    expect(extendSupport(JAN1(2027), NOW)).toBe(JAN1(2028));
    expect(extendSupport(JAN1(2028), Date.UTC(2026, 11, 20))).toBe(JAN1(2029));
  });
  it('abgelaufene Unterstützung zählt nicht', () => {
    expect(extendSupport(JAN1(2026), NOW)).toBe(JAN1(2027));
  });
  it('mehrere Zahlungen hängen Saisons an', () => {
    expect(extendSupport(extendSupport(null, NOW), NOW + DAY)).toBe(JAN1(2028));
  });
});

describe('shareExpiry', () => {
  it('kostenlos: 1. Februar nach der Saison des Uploads', () => {
    expect(shareExpiry(Date.UTC(2026, 2, 1), null)).toBe(FEB1(2027));
    expect(shareExpiry(NOW, null)).toBe(FEB1(2027));
    expect(shareExpiry(Date.UTC(2026, 10, 5), null)).toBe(FEB1(2028)); // November zählt zur nächsten Saison
  });
  it('Unterstützer: 1. Februar nach der letzten unterstützten Saison', () => {
    expect(shareExpiry(Date.UTC(2025, 5, 1), JAN1(2028))).toBe(FEB1(2028));
  });
  it('Unterstützung endete vor der Saison des Uploads → zählt die Saison', () => {
    expect(shareExpiry(NOW, JAN1(2026))).toBe(FEB1(2027));
  });
});

describe('parseSupportAmount', () => {
  it('nur die festen Stufen (in Cent) als Zahl', () => {
    for (const t of SUPPORT_TIERS) expect(parseSupportAmount(t.amount)).toBe(t.amount);
    expect(SUPPORT_TIERS.map((t) => t.amount)).toEqual([300, 500, 1000, 2000, 5000]);
  });
  it('alles andere → null', () => {
    for (const v of [0, -500, 499, 501, 5.5, 3, 300.0001, 1e9, NaN, Infinity, '500', '', null, undefined, {}, [500], true]) {
      expect(parseSupportAmount(v), String(v)).toBeNull();
    }
  });
});

describe('Stufen, Kontingent und Texte', () => {
  it('tierFor findet nur exakte Stufen', () => {
    expect(tierFor(500)?.label).toBe('Bier');
    expect(tierFor(501)).toBeUndefined();
  });
  it('formatEuro ohne Nachkommastellen bei vollen Euro', () => {
    expect(formatEuro(300).replace(/\s/g, ' ')).toBe('3 €');
    expect(formatEuro(250).replace(/\s/g, ' ')).toBe('2,50 €');
  });
  it('needsSupport und quotaText', () => {
    expect(needsSupport(null)).toBe(false);
    expect(needsSupport({ supporter: false, sharesUsed: 3, sharesFree: 3 })).toBe(true);
    expect(needsSupport({ supporter: false, sharesUsed: 2, sharesFree: 3 })).toBe(false);
    expect(needsSupport({ supporter: true, sharesUsed: 50, sharesFree: 3 })).toBe(false);
    expect(quotaText({ supporter: false, sharesUsed: 5, sharesFree: 3 })).toBe('3 von 3 kostenlosen Freigaben genutzt');
    expect(quotaText({ supporter: true, sharesUsed: 5, sharesFree: 3 })).toBe('');
  });
});
