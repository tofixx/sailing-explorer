// Revier-Wärmekarte (Konzept 37): reine Regeln in src/domain/heat.ts – Raster je Törn, Prüfung, Zusammenfassen,
// Zoom-Faktor und dichtester Bereich.
import { describe, expect, it } from 'vitest';
import { HEAT, aggregateCells, binFactor, cellBounds, cellOf, heatOpacity, hotspot, parseCells, rebin, voyageCells } from '../src/domain/heat';

/** Gerade Linie nach Norden ab 52,40° N / 13,00° O, Schritt in Grad Breite */
const line = (n: number, step = 0.001, lon = 13) => Array.from({ length: n }, (_, k) => ({ lat: 52.4 + k * step, lon }));
const pairs = (flat: number[]) => Array.from({ length: flat.length / 2 }, (_, k) => [flat[2 * k], flat[2 * k + 1]]);

describe('F-580 Raster eines Törns (voyageCells)', () => {
  it('[F-580] Zellen in Wegreihenfolge, jede einmal, ohne die ersten und letzten 300 m', () => {
    const pts = line(101); // 0 … 0,1° ≈ 11 km
    const cells = pairs(voyageCells([pts]));
    // erste Zelle liegt ≥ 300 m vom Start, letzte ≥ 300 m vom Ziel
    expect(cells[0][0]).toBe(cellOf(52.4 + 0.003, 13)[0]);
    expect(cells.at(-1)![0]).toBe(cellOf(52.5 - 0.003, 13)[0]);
    expect(cells.some(([i]) => i === cellOf(52.4, 13)[0])).toBe(false);
    // aufsteigend, ohne Doppel
    const is = cells.map(([i]) => i);
    expect(is).toEqual([...new Set(is)].sort((a, b) => a - b));
  });

  it('[F-580] kurze Tracks (alles innerhalb 300 m) und Ausreißer liefern nichts; mehrere Tracks werden vereinigt', () => {
    expect(voyageCells([line(3)])).toEqual([]);
    const glitchy = line(101).map((p, k) => (k === 50 ? { lat: 60, lon: 20, glitch: true } : p));
    expect(pairs(voyageCells([glitchy])).some(([i]) => i === cellOf(60, 20)[0])).toBe(false);
    const a = voyageCells([line(101)]);
    const both = voyageCells([line(101), line(101, 0.001, 13.2)]);
    expect(both.length).toBe(2 * a.length);
    // derselbe Track zweimal: keine doppelten Zellen
    expect(voyageCells([line(101), line(101)])).toEqual(a);
  });

  it('[F-580] lange Törns enden nach 200 Zellen (erster Abschnitt), keine Zeiten im Ergebnis; das Ergebnis besteht die Prüfung', () => {
    const long = line(2000, 0.002); // ≈ 440 km
    const cells = voyageCells([long.map((p, k) => ({ ...p, time: k * 1000 }))]);
    expect(cells.length).toBe(2 * HEAT.maxCells);
    expect(cells.every(Number.isInteger)).toBe(true);
    expect(cells[0]).toBe(cellOf(52.4 + 0.004, 13)[0]);
    expect(parseCells(cells)).not.toBeNull();
  });

  it('[F-580] GPS-Lücken bis 2 km werden geradlinig ergänzt (zusammenhängender Weg), längere sind ein Neuanfang', () => {
    // Punkte alle 0,01° (≈ 1,1 km): ohne Ergänzung lägen Zellen 3–4 auseinander
    const sparse = voyageCells([line(11, 0.01)]);
    const is = pairs(sparse).map(([i]) => i);
    for (let k = 1; k < is.length; k++) expect(is[k] - is[k - 1]).toBeLessThanOrEqual(1);
    // 0,05° (≈ 5,5 km) Abstand: nicht ergänzt
    expect(pairs(voyageCells([line(4, 0.05)])).length).toBe(2);
    // mehrere Tracks weit auseinander: jedes Raster besteht die Prüfung
    expect(parseCells(voyageCells([line(101), line(101, 0.001, 13.5)]))).not.toBeNull();
  });
});

describe('F-581 Raster prüfen (parseCells)', () => {
  it('[F-581] nimmt ganze Zahlen in gerader Anzahl bis 200 Paare im gültigen Bereich', () => {
    expect(parseCells([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(parseCells([])).toBeNull();
    expect(parseCells([1, 2, 3])).toBeNull();
    expect(parseCells([1.5, 2])).toBeNull();
    expect(parseCells(['1', 2])).toBeNull();
    expect(parseCells([999_999, 2])).toBeNull();
    expect(parseCells(new Array(2 * HEAT.maxCells + 2).fill(1))).toBeNull();
    expect(parseCells({ cells: [1, 2] })).toBeNull();
  });

  it('[F-581] wegähnlich: jede Zelle höchstens 3 Zellen neben einer früheren, höchstens 20 Neuanfänge, Ausdehnung ≤ 1,5° × 2,5°', () => {
    const path = Array.from({ length: 30 }, (_, k) => [17000 + k, 2600]).flat();
    expect(parseCells(path)).toEqual(path);
    // 3 Zellen Abstand gehen noch, 4 sind ein Neuanfang
    expect(parseCells([1, 1, 4, 4])).not.toBeNull();
    // verstreute Zellen (Text, Bild): zu viele Neuanfänge
    const scattered = Array.from({ length: HEAT.maxJumps + 2 }, (_, k) => [17000 + 5 * k, 2600]).flat();
    expect(parseCells(scattered)).toBeNull();
    expect(parseCells(scattered.slice(0, 2 * (HEAT.maxJumps + 1)))).not.toBeNull();
    // zu weit ausgedehnt
    expect(parseCells([17000, 2600, 17000 + HEAT.spanI + 1, 2600])).toBeNull();
    expect(parseCells([17000, 2600, 17000, 2600 + HEAT.spanJ + 1])).toBeNull();
  });
});

describe('F-582 Zusammenfassen (aggregateCells)', () => {
  it('[F-582] zählt Törns je Zelle (ein Törn je Zelle einmal), meiste zuerst; ein Pin je Törn auf der Mitte seines Wegs', () => {
    const d = aggregateCells([
      { id: 'a', cells: [10, 20, 11, 20, 12, 20, 11, 20] },
      { id: 'b', cells: [11, 20, 13, 20] },
      { id: 'kaputt', cells: [1, 2, 3] },
      { id: 'fehlt', cells: null },
    ]);
    expect(d.cells.slice(0, 3)).toEqual([11, 20, 2]);
    expect(d.cells.length).toBe(4 * 3);
    expect(d.voyages).toEqual([
      ['a', 12, 20],
      ['b', 13, 20],
    ]);
  });

  it('[F-582] höchstens `max` Zellen', () => {
    const d = aggregateCells([{ id: 'a', cells: [1, 1, 2, 2, 3, 3] }], 2);
    expect(d.cells.length).toBe(6);
  });
});

describe('F-584 Darstellung je Zoomstufe', () => {
  it('[F-584] gröber zusammengefasst, bis eine Zelle mindestens 8 px breit ist', () => {
    for (const z of [5, 8, 11, 14, 18]) {
      const f = binFactor(z);
      expect(Number.isInteger(Math.log2(f))).toBe(true);
      expect((f * HEAT.cellLon * 256 * 2 ** z) / 360).toBeGreaterThanOrEqual(HEAT.minPx);
    }
    expect(binFactor(16)).toBe(1);
    // grobe Zelle trägt den höchsten Wert
    expect(rebin([0, 0, 1, 1, 1, 3, 2, 2, 2], 2)).toEqual([0, 0, 3, 1, 1, 2]);
    expect(rebin([5, 5, 1], 1)).toEqual([5, 5, 1]);
  });

  it('[F-584] Deckkraft 0,2 … 0,7 logarithmisch', () => {
    expect(heatOpacity(1, 10)).toBeCloseTo(0.2);
    expect(heatOpacity(10, 10)).toBeCloseTo(0.7);
    expect(heatOpacity(1, 1)).toBeCloseTo(0.45);
  });
});

describe('F-586 dichtester Bereich', () => {
  it('[F-586] Zelle mit den meisten Törns und ihre Umgebung; weit entfernte Zellen fallen weg', () => {
    const [i, j] = cellOf(52.4, 13.0);
    const [fi, fj] = cellOf(54.3, 10.1); // Kiel
    const b = hotspot([i, j, 5, i + 10, j + 10, 1, fi, fj, 2])!;
    expect(b[0]).toEqual(cellBounds(i, j)[0]);
    expect(b[1]).toEqual(cellBounds(i + 10, j + 10)[1]);
    expect(hotspot([])).toBeNull();
  });
});
