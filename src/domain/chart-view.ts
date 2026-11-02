/**
 * Ausschnitt der Diagramm-Großansicht (F-430): Zoom und Verschieben auf der (um Pausen verdichteten) Zeitachse.
 *
 * Gerechnet wird in Pixeln der Datenfläche: `viewport` ist deren sichtbare Breite, die ganze Zeitreihe ist
 * `viewport * zoom` breit, `offset` ist der seitliche Versatz (= scrollLeft des Scrollbereichs). zoom = 1 heißt
 * „ganzer Zeitraum passt“. Die Komponente zeichnet nur den sichtbaren Ausschnitt; die Inhaltsbreite ist nur die
 * Breite des Scrollbereichs, keine Canvas-Größe.
 */
export interface ChartView {
  zoom: number;
  offset: number;
}

/** Stärkster Zoom: etwa 5 Minuten in der sichtbaren Breite */
export const MIN_VISIBLE_MS = 5 * 60_000;
/** Obergrenze für die Breite des Scrollbereichs (Browser kappen Elementbreiten bei etwa 17–33 Mio. px) */
export const MAX_CONTENT_PX = 4_000_000;
/** Schrittweiten der Zeitachse in Minuten */
export const TICK_STEPS_MIN = [5, 15, 30, 60, 120, 180, 360, 720, 1440];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Größter erlaubter Zoom für `dataMs` Datenzeit in `viewport` px Breite (mindestens 1). */
export function maxZoom(dataMs: number, viewport: number): number {
  if (!(viewport > 0) || !(dataMs > 0)) return 1;
  return Math.max(1, Math.min(dataMs / MIN_VISIBLE_MS, MAX_CONTENT_PX / viewport));
}

/** Zoom in [1, maxZ], Versatz so, dass nie über den Rand der Zeitreihe hinaus geschaut wird. */
export function clampView(v: ChartView, viewport: number, maxZ: number): ChartView {
  const zoom = clamp(Number.isFinite(v.zoom) ? v.zoom : 1, 1, Math.max(1, maxZ));
  const offset = clamp(Number.isFinite(v.offset) ? v.offset : 0, 0, Math.max(0, viewport * (zoom - 1)));
  return { zoom, offset };
}

/** Zoomt um den Faktor `factor`; der Punkt unter `anchor` (px ab linkem Rand der Datenfläche) bleibt stehen. */
export function zoomAt(v: ChartView, factor: number, anchor: number, viewport: number, maxZ: number): ChartView {
  const zoom = clamp(v.zoom * factor, 1, Math.max(1, maxZ));
  const content = v.offset + anchor;
  return clampView({ zoom, offset: content * (zoom / v.zoom) - anchor }, viewport, maxZ);
}

/** Verschiebt den Ausschnitt um `dx` px (positiv = später). */
export function panBy(v: ChartView, dx: number, viewport: number, maxZ: number): ChartView {
  return clampView({ zoom: v.zoom, offset: v.offset + dx }, viewport, maxZ);
}

/**
 * Zwei-Finger-Geste: ausgehend vom Ausschnitt beim Aufsetzen um `scale` (Fingerabstand jetzt / vorher) um die
 * Fingermitte zoomen und um deren Bewegung verschieben – der Punkt unter der Mitte folgt den Fingern.
 */
export function pinch(start: ChartView, scale: number, startMid: number, mid: number, viewport: number, maxZ: number): ChartView {
  return panBy(zoomAt(start, scale, startMid, viewport, maxZ), startMid - mid, viewport, maxZ);
}

/** Anfangsansicht: mindestens `pxPerHour` je Stunde Datenzeit (bisheriges F-430-Verhalten), sonst ganzer Zeitraum. */
export function initialView(dataMs: number, viewport: number, pxPerHour: number): ChartView {
  const maxZ = maxZoom(dataMs, viewport);
  return clampView({ zoom: viewport > 0 ? ((dataMs / 3_600_000) * pxPerHour) / viewport : 1, offset: 0 }, viewport, maxZ);
}

/** Weiter als „ganzer Zeitraum“ hineingezoomt? */
export function isZoomed(v: ChartView): boolean {
  return v.zoom > 1.001;
}

/** Kleinste Schrittweite der Zeitachse (ms), deren Beschriftungen mindestens `minGapPx` auseinanderliegen. */
export function tickStep(msPerPx: number, minGapPx = 56): number {
  for (const m of TICK_STEPS_MIN) if ((m * 60_000) / msPerPx >= minGapPx) return m * 60_000;
  return TICK_STEPS_MIN[TICK_STEPS_MIN.length - 1] * 60_000;
}

/** Ortszeit-runde Zeitpunkte im Schritt `step` (ms) zwischen t0 und t1 (Tage: Mitternacht). Höchstens `limit`. */
export function ticks(t0: number, t1: number, step: number, limit = 5000): number[] {
  if (!(step > 0) || !(t1 >= t0)) return [];
  const d = new Date(t0);
  const day = step >= 86_400_000;
  if (day) d.setHours(0, 0, 0, 0);
  else {
    const stepMin = Math.round(step / 60_000);
    const mins = d.getHours() * 60 + d.getMinutes();
    d.setHours(0, mins - (mins % stepMin), 0, 0);
  }
  const out: number[] = [];
  while (out.length < limit) {
    const t = d.getTime();
    if (t > t1) break;
    if (t >= t0) out.push(t);
    if (day) d.setDate(d.getDate() + 1);
    else d.setTime(t + step);
  }
  return out;
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Beschriftung eines Achsen-Ticks: bei Tagesschritten das Datum, sonst die Uhrzeit – mit Datum davor, wenn es die
 * erste Beschriftung ist oder ein neuer Tag beginnt (`prev` = Zeit der vorigen Beschriftung).
 */
export function tickLabel(t: number, step: number, prev: number | null): string {
  const d = new Date(t);
  const date = `${two(d.getDate())}.${two(d.getMonth() + 1)}.`;
  if (step >= 86_400_000) return date;
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return prev == null || new Date(prev).toDateString() !== d.toDateString() ? `${date} ${time}` : time;
}
