// Saisonrückblick (Konzept 33): Zahlen der Saison (F-520), Abzeichen-Reihe (F-521) und das Bild ohne Browser (F-523).
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { datenschutz } from '../src/content/legal';
import { MILESTONES_NM } from '../src/domain/groups';
import type { LogbookEntry } from '../src/domain/logbook-year';
import {
  badgeText, reviewAltText, reviewFigures, reviewHeadline, reviewHours, seasonBadges, seasonImageFileName, seasonReview,
} from '../src/domain/season-review';
import { drawSeasonImage, seasonLayout } from '../src/services/season-image';
import { FORMATS, type ImageFormat } from '../src/services/share-image';

const entry = (o: Partial<LogbookEntry>): LogbookEntry => ({
  id: 'A', own: true, path: '/s/A', title: 'Havel', startedAt: Date.UTC(2026, 5, 13, 8), endedAt: null, timed: false, source: 'gpx',
  distNm: 10, distSource: 'track', from: { slug: 'potsdam', name: 'Potsdam' }, to: { slug: 'werder', name: 'Werder' },
  role: 'skipper', roleConfirmed: false, boat: 'Möwe', logState: 'confirmed', log: {}, ...o,
});

describe('Zahlen der Saison', () => {
  const entries = [
    // GPX am selben Tag mit Uhrzeiten: 6 h
    entry({ id: 'A', distNm: 20, timed: true, endedAt: Date.UTC(2026, 5, 13, 14) }),
    // Fahrtenbuch-Eintrag mit Angaben: 3 + 1,5 h, geschätzt, längster insgesamt – aber nicht aufgezeichnet
    entry({ id: 'B', source: 'manual', distSource: 'stated', distNm: 40, boat: 'möwe ', log: { sailH: 3, engineH: 1.5 } }),
    // mehrtägig mit Uhrzeiten, ohne Angaben: zählt keine Stunden (Liegezeit)
    entry({ id: 'C', distNm: 30, timed: true, startedAt: Date.UTC(2026, 6, 1, 8), endedAt: Date.UTC(2026, 6, 3, 16), boat: 'Jolle', to: { slug: 'brandenburg', name: 'Brandenburg' } }),
    // Crew-Törn anderer (M1): nur Eckdaten
    entry({ id: 'D', own: false, path: null, title: null, distNm: 15, boat: null, from: null, to: null, role: 'crew', roleConfirmed: true }),
    // Crew-Törn anderer, länger und aufgezeichnet: zählt in die Summen, aber nicht als „längster Törn“
    entry({ id: 'F', own: false, path: null, title: null, distNm: 35, boat: null, from: null, to: null, role: 'crew', roleConfirmed: true }),
    // ausgeschlossen: zählt nie
    entry({ id: 'E', distNm: 500, logState: 'excluded', boat: 'Yacht' }),
  ];

  it('[F-520] Summen wie die Seite, Stunden nur aus Angaben bzw. am selben Tag, Boote ohne Groß-/Kleinschreibung, längster nur aufgezeichnet', () => {
    const r = seasonReview(entries, 2026);
    expect(r.season).toBe(2026);
    expect(r.voyages).toBe(5);
    expect(r.nm).toBe(140);
    expect(r.recordedNm).toBe(100);
    expect(r.hours).toBeCloseTo(10.5);
    expect(r.boats).toBe(2);
    expect(r.harbors).toBe(3);
    expect(r.days).toBe(1 + 1 + 3 + 1 + 1);
    expect(r.longest).toEqual({ nm: 30, startedAt: Date.UTC(2026, 6, 1, 8) });
    expect(reviewHours(entry({ timed: false, endedAt: Date.UTC(2026, 5, 13, 14) }))).toBe(0);
    // eine Angabe 0 h gilt als Angabe – die Zeitspanne zählt dann nicht
    expect(reviewHours(entry({ timed: true, endedAt: Date.UTC(2026, 5, 13, 14), log: { engineH: 0 } }))).toBe(0);
    expect(reviewHours(entry({ timed: true, endedAt: Date.UTC(2026, 5, 13, 14) }))).toBe(6);
  });

  it('[F-520] Kacheln nur für vorhandene Werte; Kopfzahl nennt den aufgezeichneten Anteil (K3); Dateiname', () => {
    const r = seasonReview(entries, 2026);
    expect(reviewHeadline(r)).toEqual({ label: 'Seemeilen', value: '140,0 sm', detail: 'davon 100,0 sm aufgezeichnet' });
    expect(reviewFigures(r).map((f) => f.label)).toEqual(['Törns', 'Stunden', 'Tage an Bord', 'Boote', 'Häfen', 'Längster Törn']);
    const small = seasonReview([entry({ distSource: 'stated', boat: null, from: null, to: null })], 2026);
    expect(reviewHeadline(seasonReview([entry({})], 2026)).detail).toBeUndefined();
    expect(reviewHeadline(small).detail).toBe('davon 0,0 sm aufgezeichnet');
    expect(reviewFigures(small)).toEqual([{ label: 'Törn', value: '1' }, { label: 'Tag an Bord', value: '1' }]);
    expect(seasonReview([], 2026)).toMatchObject({ voyages: 0, nm: 0, longest: null });
    expect(seasonImageFileName(2026)).toBe('meine-saison-2026.jpg');
  });
});

describe('Abzeichen-Reihe', () => {
  it('[F-521] aus MILESTONES_NM: erreichte, das nächste mit Rest und Fortschritt, die übrigen offen', () => {
    expect(seasonBadges(612.4).map((b) => b.nm)).toEqual([...MILESTONES_NM]);
    const [a, b, c] = seasonBadges(612.4);
    expect(a).toMatchObject({ reached: true, next: false, missing: 0, progress: 1 });
    expect(b).toMatchObject({ reached: true, next: false });
    expect(c).toMatchObject({ reached: false, next: true });
    expect(c.missing).toBeCloseTo(387.6);
    expect(c.progress).toBeCloseTo(0.6124);
    expect(seasonBadges(50).map(badgeText)).toEqual(['100 sm – noch 50,0 sm', '500 sm', '1.000 sm']);
    expect(seasonBadges(1000).every((x) => x.reached && !x.next)).toBe(true);
    expect(seasonBadges(0)[0]).toMatchObject({ next: true, progress: 0 });
    // gerundet wie gezeigt: 99,97 sm steht als „100,0 sm“ da und ist erreicht
    expect(seasonBadges(99.97)[0]).toMatchObject({ reached: true, missing: 0 });
    expect(seasonBadges(99.94)[0]).toMatchObject({ reached: false, next: true });
    expect(badgeText(seasonBadges(99.94)[0])).toBe('100 sm – noch 0,1 sm');
  });

  it('[F-521] Alternativtext nennt Zahlen und Abzeichen – keine Vergleiche mit anderen (K6)', () => {
    const alt = reviewAltText(seasonReview([entry({ distNm: 120 })], 2026));
    expect(alt).toBe('Meine Saison 2026: Seemeilen 120,0 sm, Törn 1, Tag an Bord 1, Boot 1, Häfen 2, Längster Törn 120,0 sm (13.06.2026). Abzeichen: 100 sm erreicht, 500 sm – noch 380,0 sm, 1.000 sm.');
    expect(alt).not.toMatch(/Platz|Rang|Top|besser/);
  });
});

describe('Saison-Bild', () => {
  it.each(['square', 'landscape'] as ImageFormat[])('[F-523] %s: zeichnet im Format des Törn-Bildes, alles innerhalb des Bildes', (f) => {
    const { width, height } = FORMATS[f];
    const L = seasonLayout(f);
    for (const b of [L.head, L.tiles, L.badges]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(width);
      expect(b.y + b.h).toBeLessThanOrEqual(L.footY - 44);
    }
    expect(L.footY).toBeLessThanOrEqual(height);
    const canvas = createCanvas(10, 10);
    drawSeasonImage(canvas as unknown as HTMLCanvasElement, seasonReview([entry({ distNm: 612.4 })], 2026), f);
    expect([canvas.width, canvas.height]).toEqual([width, height]);
    // ein echtes, deckendes Bild (JPEG ohne Transparenz) mit Inhalt
    const ctx = canvas.getContext('2d');
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    expect(corner[3]).toBe(255);
    expect(canvas.toBuffer('image/png').length).toBeGreaterThan(10_000);
  });
});

describe('Datenschutz', () => {
  it('[F-524] der Datenschutztext nennt das Saison-Bild: nur im Browser, nicht gespeichert, verlässt das Gerät nur beim Teilen', () => {
    const t = JSON.stringify(datenschutz());
    expect(t).toContain('Das Bild „Meine Saison“');
    expect(t).toContain('entsteht nur in deinem Browser; wir speichern es nicht');
    expect(t).toContain('dein Gerät verlässt es nur, wenn du es selbst teilst');
  });
});
