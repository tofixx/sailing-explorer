// Kartenstile (F-216): feste Sets für Farbverlauf und Wind-/Wellen-Symbole, Vorrang der Quellen, Symbolfarben und -größen.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_STYLE, MAP_STYLES, MAP_STYLE_IDS, isMapStyleId, resolveMapStyle } from '../src/domain/map-style';
import { RAMP, rampColor, rampCss } from '../src/domain/metrics';
import { waveChevron, waveChevronSize, waveColor, windBadge, windBadgeSize, windColor } from '../src/map/glyphs';

/** relative Helligkeit (WCAG) einer Hex-Farbe */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

describe('F-216 Kartenstile', () => {
  it('[F-216] vier Sets: Klassisch (heutiger Stil, Standard), Kontrast, Farbenblind-freundlich, Dezent', () => {
    expect(MAP_STYLE_IDS).toEqual(['classic', 'contrast', 'colorblind', 'subtle']);
    expect(DEFAULT_MAP_STYLE).toBe('classic');
    expect(MAP_STYLES.classic.ramp).toBe(RAMP);
    expect(MAP_STYLES.classic).toMatchObject({ symbols: 'ramp', symbolScale: 1, lineWeight: 4 });
    for (const id of MAP_STYLE_IDS) {
      const s = MAP_STYLES[id];
      expect(s.id).toBe(id);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.ramp.length).toBeGreaterThanOrEqual(2);
      for (const c of s.ramp) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('[F-216] Farbenblind-freundlich wird stetig heller, Dezent stetig dunkler – eindeutig auch ohne Farbsehen', () => {
    for (const [id, dir] of [['colorblind', 1], ['subtle', -1]] as const) {
      const l = MAP_STYLES[id].ramp.map(luminance);
      for (let i = 1; i < l.length; i++) expect(dir * (l[i] - l[i - 1]), `${id} Stufe ${i}`).toBeGreaterThan(0);
    }
  });

  it('[F-216] Kontrast: Enden des Verlaufs mit deutlichem Helligkeitsabstand, dickere Linie, größere Symbole', () => {
    const s = MAP_STYLES.contrast;
    const l = s.ramp.map(luminance);
    expect(Math.max(...l) / Math.min(...l)).toBeGreaterThan(10);
    expect(s.lineWeight).toBeGreaterThan(MAP_STYLES.classic.lineWeight);
    expect(s.symbolScale).toBeGreaterThan(1);
  });

  it('[F-216] isMapStyleId kennt nur die Sets (keine Prototyp-Namen, keine anderen Typen)', () => {
    for (const id of MAP_STYLE_IDS) expect(isMapStyleId(id)).toBe(true);
    for (const v of ['', 'Classic', 'toString', '__proto__', 'constructor', null, undefined, 1, {}]) expect(isMapStyleId(v)).toBe(false);
  });

  it('[F-216] Vorrang: Wahl „Nur jetzt“ vor Profil-Standard vor Gerät, sonst Klassisch; Ungültiges wird übersprungen', () => {
    expect(resolveMapStyle('contrast', 'subtle', 'colorblind')).toBe('contrast');
    expect(resolveMapStyle(null, 'subtle', 'colorblind')).toBe('subtle');
    expect(resolveMapStyle(null, null, 'colorblind')).toBe('colorblind');
    expect(resolveMapStyle('kaputt', undefined, 'colorblind')).toBe('colorblind');
    expect(resolveMapStyle(null, null, null)).toBe('classic');
    expect(resolveMapStyle()).toBe('classic');
  });

  it('[F-216] rampColor und rampCss nehmen den Verlauf des Stils (Standard: Klassisch)', () => {
    const v = MAP_STYLES.colorblind.ramp;
    expect(rampColor(0, v)).toBe('rgb(68,1,84)');
    expect(rampColor(1, v)).toBe('rgb(253,231,37)');
    expect(rampColor(2, v)).toBe(rampColor(1, v));
    expect(rampColor(0.5)).toBe(rampColor(0.5, RAMP));
    expect(rampCss(v)).toBe(`linear-gradient(90deg, ${v.join(', ')})`);
  });

  it('[F-216] Symbole: Stärkefarbe aus dem Verlauf des Stils, bei Dezent die feste Bedeutungsfarbe; Größe skaliert', () => {
    const cb = MAP_STYLES.colorblind;
    expect(windColor(30, cb)).toBe(rampColor(1, cb.ramp));
    expect(waveColor(0, cb)).toBe(rampColor(0, cb.ramp));
    expect(windBadge(270, 30, cb)).toContain(rampColor(1, cb.ramp));
    expect(windColor(12)).toBe(rampColor(12 / 30));

    const subtle = MAP_STYLES.subtle;
    expect(windBadge(270, 30, subtle)).toContain('var(--c-wind)');
    expect(waveChevron(90, 2, subtle)).toContain('var(--c-wave)');

    const big = MAP_STYLES.contrast;
    expect(windBadgeSize(big)).toBe(55);
    expect(waveChevronSize(big)).toBe(38);
    expect(windBadge(0, 10, big)).toContain('width="55" height="55" viewBox="0 0 44 44"');
    expect(windBadge(0, 10)).toContain('width="44" height="44"');
  });
});
