// Ausschnitt eines Titelbilds (Konzept 13.2): Das gespeicherte Bild ist höher als das 3:1-Banner; welcher Streifen
// sichtbar ist, bestimmt die vertikale Fokus-Position `focusY` (0 = oben, 100 = unten) – angezeigt per
// `object-position: 50% <focusY>%`. Rein, von Worker und Oberfläche genutzt.

/** Seitenverhältnis des Banners (Breite : Höhe). */
export const COVER_BANNER_RATIO = 3;
/** Fokus ohne Angabe: mittig (auch für ältere Titelbilder). */
export const COVER_FOCUS_DEFAULT = 50;

/** Gültige Fokus-Position (ganze Prozent 0 … 100) oder null. */
export function parseFocusY(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null;
}

/**
 * Überstand des Bilds über das Banner in Pixeln (bei `object-fit: cover`): so weit lässt es sich vertikal verschieben.
 * 0 = kein Spielraum (Bild höchstens so hoch wie das Banner, dann wird links/rechts beschnitten).
 */
export function focusSlack(frameW: number, frameH: number, imgW: number, imgH: number): number {
  if (!(frameW > 0 && frameH > 0 && imgW > 0 && imgH > 0)) return 0;
  const scale = Math.max(frameW / imgW, frameH / imgH);
  return Math.max(0, imgH * scale - frameH);
}

/**
 * Fokus nach dem Ziehen um `dy` Pixel (positiv = Bild nach unten gezogen, also weiter oben ins Bild sehen),
 * ausgehend von `start`, bei `slack` Pixeln Spielraum. Ganze Prozent, begrenzt auf 0 … 100.
 */
export function focusAfterDrag(start: number, dy: number, slack: number): number {
  if (slack <= 0) return start;
  return Math.min(100, Math.max(0, Math.round(start - (dy / slack) * 100)));
}
