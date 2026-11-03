// Revier-Wärmekarte (Konzept 37, F-580 … F-586): grobes Raster der öffentlichen Törns. Reine Regeln ohne DOM – der
// Browser rechnet das Raster eines Törns (der Worker parst kein GPX, 10 ms CPU), der Worker prüft und fasst zusammen,
// die Karte fasst je Zoomstufe gröber zusammen und findet den dichtesten Bereich.
import { haversine } from './geo';

export const HEAT = {
  /** Zellgröße in Grad: 0,003° Breite ≈ 333 m, 0,005° Länge ≈ 340 m auf 52° N */
  cellLat: 0.003,
  cellLon: 0.005,
  /** Anfang und Ende jedes Tracks (Luftlinie) fallen weg – kein Liegeplatz auf der Karte */
  trimM: 300,
  /** höchstens so viele Zellen je Törn – längere Wege enden danach (erster Abschnitt) */
  maxCells: 200,
  /** Wegähnlich: jede Zelle liegt höchstens so viele Zellen neben einer früheren … */
  near: 3,
  /** … außer an höchstens so vielen Neuanfängen (weitere Tracks, Lücken im GPS, Anfang/Ende im Hafen) */
  maxJumps: 20,
  /** Ausdehnung eines Rasters höchstens 1,5° Breite × 2,5° Länge (in Zellen) – längere Wege enden davor */
  spanI: 500,
  spanJ: 500,
  /** GPS-Lücken bis zu dieser Länge (m) werden geradlinig ergänzt, längere sind ein Neuanfang */
  gapM: 2000,
  /** höchstens so viele Törns fließen ein (neueste zuerst) … */
  voyages: 100,
  /** … und davon höchstens so viele je Konto */
  perUser: 10,
  /** höchstens so viele Zellen in der Antwort (meiste Törns zuerst) */
  maxOut: 4000,
  /** Cache der Antwort in Sekunden: im Rechenzentrum (Cache API) und im Browser – zusammen höchstens 15 Minuten */
  edgeTtl: 840,
  browserTtl: 60,
  /** gezeichnete Zellen sind mindestens so breit (px) – darunter fasst die Karte gröber zusammen */
  minPx: 8,
  /** Raster der Cluster-Pins in px */
  pinPx: 48,
} as const;

/** Grenzen der Zell-Indizes (Breite ±90°, Länge ±180°) */
const I_MAX = Math.ceil(90 / HEAT.cellLat);
const J_MAX = Math.ceil(180 / HEAT.cellLon);

export interface HeatPoint {
  lat: number;
  lon: number;
  /** GPS-Ausreißer (F-04) zählen nicht */
  glitch?: boolean;
}

/** Zusammengefasste Wärmekarte, wie sie `GET /api/discover/heat` liefert. */
export interface HeatData {
  /** flach: i, j, n – Zelle (Index Breite, Länge) und Zahl der Törns, die sie berühren */
  cells: number[];
  /** je Törn: ID und eine Zelle aus der Mitte seines Wegs (für die Pins) */
  voyages: Array<[string, number, number]>;
}

export const cellOf = (lat: number, lon: number): [number, number] => [Math.floor(lat / HEAT.cellLat), Math.floor(lon / HEAT.cellLon)];

/** Mittelpunkt einer Zelle (bei Faktor f: der zusammengefassten Zelle) */
export const cellCenter = (i: number, j: number, f = 1): { lat: number; lon: number } => ({
  lat: (i + 0.5) * f * HEAT.cellLat,
  lon: (j + 0.5) * f * HEAT.cellLon,
});

/** Ecken einer (zusammengefassten) Zelle: [[Süd, West], [Nord, Ost]] */
export const cellBounds = (i: number, j: number, f = 1): [[number, number], [number, number]] => [
  [i * f * HEAT.cellLat, j * f * HEAT.cellLon],
  [(i + 1) * f * HEAT.cellLat, (j + 1) * f * HEAT.cellLon],
];

/** Zellen, die das Raster schon hat, und seine Ausdehnung – für `voyageCells` und `parseCells` dieselbe Regel. */
class CellSet {
  readonly flat: number[] = [];
  private keys = new Set<number>();
  private lo = [Infinity, Infinity];
  private hi = [-Infinity, -Infinity];
  jumps = 0;

  has(i: number, j: number): boolean {
    return this.keys.has(keyOf(i, j));
  }

  /** Grenzen: Zahl der Zellen und Ausdehnung – false, wenn die Zelle nicht mehr passt. */
  fits(i: number, j: number): boolean {
    if (this.flat.length >= 2 * HEAT.maxCells) return false;
    return Math.max(this.hi[0], i) - Math.min(this.lo[0], i) <= HEAT.spanI && Math.max(this.hi[1], j) - Math.min(this.lo[1], j) <= HEAT.spanJ;
  }

  /** Liegt eine frühere Zelle höchstens `HEAT.near` Zellen daneben? */
  touches(i: number, j: number): boolean {
    for (let di = -HEAT.near; di <= HEAT.near; di++) for (let dj = -HEAT.near; dj <= HEAT.near; dj++) if (this.keys.has(keyOf(i + di, j + dj))) return true;
    return false;
  }

  add(i: number, j: number): void {
    if (this.flat.length && !this.touches(i, j)) this.jumps++;
    this.keys.add(keyOf(i, j));
    this.flat.push(i, j);
    this.lo = [Math.min(this.lo[0], i), Math.min(this.lo[1], j)];
    this.hi = [Math.max(this.hi[0], i), Math.max(this.hi[1], j)];
  }
}

/**
 * Raster eines Törns (F-580): Zellen in der Reihenfolge des Wegs, jede einmal, ohne die ersten und letzten 300 m
 * (Luftlinie zum ersten bzw. letzten Punkt) jedes Tracks und ohne GPS-Ausreißer. GPS-Lücken bis 2 km werden
 * geradlinig ergänzt, damit das Raster ein zusammenhängender Weg ist (`parseCells`). Lange Wege enden, sobald 200
 * Zellen, 20 Neuanfänge oder 1,5° × 2,5° Ausdehnung erreicht sind (der erste Abschnitt zählt). Flach [i0, j0, …];
 * keine Zeiten.
 */
export function voyageCells(tracks: ReadonlyArray<ReadonlyArray<HeatPoint>>): number[] {
  const set = new CellSet();
  const put = (lat: number, lon: number): boolean => {
    const [i, j] = cellOf(lat, lon);
    if (set.has(i, j)) return true;
    if (!set.fits(i, j) || (set.flat.length && !set.touches(i, j) && set.jumps >= HEAT.maxJumps)) return false;
    set.add(i, j);
    return true;
  };
  for (const pts of tracks) {
    const ok = pts.filter((p) => !p.glitch && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!ok.length) continue;
    const a = ok[0];
    const b = ok[ok.length - 1];
    const inside = (p: HeatPoint) => haversine(a.lat, a.lon, p.lat, p.lon) >= HEAT.trimM && haversine(b.lat, b.lon, p.lat, p.lon) >= HEAT.trimM;
    let prev: HeatPoint | null = null;
    for (const p of ok) {
      if (!inside(p)) {
        prev = null;
        continue;
      }
      // Lücke ergänzen: Zwischenpunkte etwa alle halbe Zelle (nur zwischen zwei gezählten Punkten, bis 2 km)
      const d = prev ? haversine(prev.lat, prev.lon, p.lat, p.lon) : 0;
      const steps = prev && d <= HEAT.gapM ? Math.floor(d / 150) : 0;
      for (let k = 1; k <= steps; k++) if (!put(prev!.lat + ((p.lat - prev!.lat) * k) / (steps + 1), prev!.lon + ((p.lon - prev!.lon) * k) / (steps + 1))) return set.flat;
      if (!put(p.lat, p.lon)) return set.flat;
      prev = p;
    }
  }
  return set.flat;
}

/**
 * Prüft ein Raster aus dem Netz (F-581): flache Liste ganzer Zahlen, gerade Länge, 1 … `HEAT.maxCells` Paare, Indizes
 * im gültigen Bereich, Ausdehnung höchstens 1,5° × 2,5°, und wegähnlich: jede Zelle liegt höchstens 3 Zellen neben
 * einer früheren, bis auf höchstens 20 Neuanfänge (kein Text oder Bild aus verstreuten Zellen). Sonst null (fail closed).
 */
export function parseCells(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length < 2 || input.length % 2 || input.length > 2 * HEAT.maxCells) return null;
  const set = new CellSet();
  for (let k = 0; k < input.length; k += 2) {
    const i = input[k];
    const j = input[k + 1];
    if (!Number.isInteger(i) || !Number.isInteger(j) || Math.abs(i) > I_MAX || Math.abs(j) > J_MAX) return null;
    if (set.has(i, j)) continue;
    if (!set.fits(i, j)) return null;
    set.add(i, j);
    if (set.jumps > HEAT.maxJumps) return null;
  }
  return input as number[];
}

/** Ganzzahliger Schlüssel einer Zelle (für Maps; sicher im Bereich der Indizes) */
const keyOf = (i: number, j: number) => (i + I_MAX) * (2 * J_MAX + 1) + (j + J_MAX);
const fromKey = (k: number): [number, number] => [Math.floor(k / (2 * J_MAX + 1)) - I_MAX, (k % (2 * J_MAX + 1)) - J_MAX];

/**
 * Zusammenfassen (F-582): je Zelle die Zahl der Törns, die sie berühren (ein Törn zählt je Zelle einmal), meiste zuerst,
 * höchstens `max` Zellen; je Törn ein Pin auf der mittleren Zelle seines Wegs. Ungültige Raster fallen weg.
 */
export function aggregateCells(list: ReadonlyArray<{ id: string; cells: unknown }>, max: number = HEAT.maxOut): HeatData {
  const counts = new Map<number, number>();
  const voyages: HeatData['voyages'] = [];
  for (const v of list) {
    const cells = parseCells(v.cells);
    if (!cells) continue;
    const own = new Set<number>();
    for (let k = 0; k < cells.length; k += 2) {
      const key = keyOf(cells[k], cells[k + 1]);
      if (own.has(key)) continue;
      own.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const mid = 2 * Math.floor(cells.length / 4);
    voyages.push([v.id, cells[mid], cells[mid + 1]]);
  }
  const top = [...counts].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, max);
  const cells: number[] = [];
  for (const [key, n] of top) cells.push(...fromKey(key), n);
  return { cells, voyages };
}

/**
 * Faktor der Zusammenfassung für eine Zoomstufe: Zweierpotenz, so dass eine gezeichnete Zelle mindestens `minPx` breit
 * ist (Breite einer Zelle in Web-Mercator-Pixeln: Länge × 256 × 2^zoom / 360).
 */
export function binFactor(zoom: number, minPx: number = HEAT.minPx): number {
  const px = (HEAT.cellLon * 256 * 2 ** zoom) / 360;
  return px >= minPx ? 1 : 2 ** Math.ceil(Math.log2(minPx / px));
}

/** Zellen (i, j, n) zu gröberen Zellen mit Faktor f; n = höchster Wert darin („mindestens so viele Törns“). */
export function rebin(cells: ReadonlyArray<number>, f: number): number[] {
  if (f <= 1) return [...cells];
  const out = new Map<number, number>();
  for (let k = 0; k < cells.length; k += 3) {
    const key = keyOf(Math.floor(cells[k] / f), Math.floor(cells[k + 1] / f));
    out.set(key, Math.max(out.get(key) ?? 0, cells[k + 2]));
  }
  const flat: number[] = [];
  for (const [key, n] of out) flat.push(...fromKey(key), n);
  return flat;
}

/** Deckkraft einer Zelle: 0,2 … 0,7, logarithmisch nach der Zahl der Törns (eine Spur bleibt sichtbar, Häfen glühen nicht). */
export function heatOpacity(n: number, max: number): number {
  if (max <= 1) return 0.45;
  return 0.2 + (0.5 * Math.log(n)) / Math.log(max);
}

/**
 * Dichtester Bereich für die Startseite (F-586): Zelle mit den meisten Törns und alle Zellen bis ±0,25° Breite bzw.
 * ±0,4° Länge darum – als Rechteck [[Süd, West], [Nord, Ost]]; ohne Zellen null.
 */
export function hotspot(cells: ReadonlyArray<number>): [[number, number], [number, number]] | null {
  if (cells.length < 3) return null;
  let best = 0;
  for (let k = 3; k < cells.length; k += 3) if (cells[k + 2] > cells[best + 2]) best = k;
  const c = cellCenter(cells[best], cells[best + 1]);
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (let k = 0; k < cells.length; k += 3) {
    const [[cs, cw], [cn, ce]] = cellBounds(cells[k], cells[k + 1]);
    if (Math.abs(cs - c.lat) > 0.25 || Math.abs(cw - c.lon) > 0.4) continue;
    s = Math.min(s, cs);
    w = Math.min(w, cw);
    n = Math.max(n, cn);
    e = Math.max(e, ce);
  }
  return [[s, w], [n, e]];
}
