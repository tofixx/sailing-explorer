// Reine Regeln zu Unterstützung und Aufbewahrung (src/domain/support.ts) und der Betragsprüfung (worker/validate.ts).
import { describe, expect, it } from 'vitest';
import {
  FREE_RETENTION_MS,
  SUPPORT_MS,
  SUPPORT_TIERS,
  extendSupport,
  formatEuro,
  needsSupport,
  quotaText,
  shareExpiry,
  tierFor,
} from '../src/domain/support';
import { parseSupportAmount } from '../worker/validate';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24, 12);

describe('extendSupport', () => {
  it('ohne bisherige Unterstützung: 365 Tage ab Zahltag', () => {
    expect(SUPPORT_MS).toBe(365 * DAY);
    expect(extendSupport(null, NOW)).toBe(NOW + 365 * DAY);
  });
  it('laufende Unterstützung wird ab ihrem Ende verlängert', () => {
    const until = NOW + 100 * DAY;
    expect(extendSupport(until, NOW)).toBe(until + 365 * DAY);
  });
  it('abgelaufene Unterstützung zählt nicht – neu ab Zahltag', () => {
    expect(extendSupport(NOW - 10 * DAY, NOW)).toBe(NOW + 365 * DAY);
    expect(extendSupport(NOW, NOW)).toBe(NOW + 365 * DAY);
  });
  it('mehrere Zahlungen addieren sich', () => {
    expect(extendSupport(extendSupport(null, NOW), NOW + DAY)).toBe(NOW + 730 * DAY);
  });
});

describe('shareExpiry', () => {
  it('kostenlos: 90 Tage nach Upload', () => {
    expect(FREE_RETENTION_MS).toBe(90 * DAY);
    expect(shareExpiry(NOW, null)).toBe(NOW + 90 * DAY);
  });
  it('Unterstützer: 90 Tage nach Ende der Unterstützung, wenn diese später endet', () => {
    expect(shareExpiry(NOW - 300 * DAY, NOW + 100 * DAY)).toBe(NOW + 190 * DAY);
  });
  it('Unterstützung endete vor dem Upload → zählt der Upload', () => {
    expect(shareExpiry(NOW, NOW - 10 * DAY)).toBe(NOW + 90 * DAY);
  });
  it('abgelaufene Unterstützung verlängert noch bis Ende + 90 Tage', () => {
    expect(shareExpiry(NOW - 500 * DAY, NOW - 80 * DAY)).toBe(NOW + 10 * DAY);
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
