// Ausschnitt eines Titelbilds (Konzept 13.2): Das gespeicherte Bild ist höher als das 3:1-Banner; welcher Streifen
// sichtbar ist, bestimmt die vertikale Fokus-Position `focusY` (0 = oben, 100 = unten) – angezeigt per
// `object-position: 50% <focusY>%`. Rein, von Worker und Oberfläche genutzt.

/** u = Profil (öffentliche ID: Profiladresse), b = Boot, g = Verein/Team (öffentliche ID: Objekt-ID). */
export type CoverKind = 'u' | 'b' | 'g';

/** Titelbild in Listen (Neuigkeiten, Entdecken): Adresse und Ausschnitt. */
export interface CoverRef {
  src: string;
  y: number;
}

/** Adresse eines Titelbilds; die Version wechselt bei jedem Austausch. `key` bei „Nur mit Link“. */
export function coverPath(kind: CoverKind, publicId: string, ver: string, key?: string | null): string {
  return `/api/covers/${kind}/${encodeURIComponent(publicId)}/${ver}${key ? `?k=${encodeURIComponent(key)}` : ''}`;
}

/**
 * Titelbild eines öffentlichen Objekts für Listen – null ohne Bild. Gelesen wird beim Ausliefern (JOIN auf `covers`),
 * daher verschwindet ein gelöschtes Bild sofort und ein ausgetauschtes erscheint mit neuer Adresse.
 */
export function coverRef(kind: CoverKind, publicId: string, ver: string | null | undefined, y: number | null | undefined): CoverRef | null {
  return ver ? { src: coverPath(kind, publicId, ver), y: y ?? COVER_FOCUS_DEFAULT } : null;
}

/** Seitenverhältnis des Banners (Breite : Höhe). */
export const COVER_BANNER_RATIO = 3;
/** Höchstes gespeichertes Seitenverhältnis (3:2) – der Überstand über das Banner ist der Spielraum für den Ausschnitt. */
export const COVER_MIN_RATIO = 1.5;
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

/**
 * `covers.held_until` bei einer offenen Bild-Meldung (F-566): unbefristet zurückgehalten, bis ein Admin entscheidet.
 * Neue Konten tragen dort das Ende ihrer Neu-Phase (F-562).
 */
export const REPORT_HOLD = Number.MAX_SAFE_INTEGER;

/** Bild-Meldungen neuer Konten (Gewicht 0, F-565) halten ein Titelbild nur so lange zurück, ohne Entscheidung (F-569). */
export const NEW_REPORTER_HOLD_MS = 72 * 3_600_000;

/** Ende der Zurückhaltung durch eine Bild-Meldung (F-566, F-569): unbefristet, bei neuen Konten 72 h. */
export const reportHoldUntil = (weight: number, reportedAt: number): number => (weight > 0 ? REPORT_HOLD : reportedAt + NEW_REPORTER_HOLD_MS);

/** Öffentlich sichtbar (nicht zurückgehalten)? Gleiche Regel wie `coverShownSql` (worker/visible-sql.ts). */
export function coverShown(heldUntil: number | null | undefined, now = Date.now()): boolean {
  return heldUntil == null || heldUntil <= now;
}

/** Hinweis für Verwalter zu einem zurückgehaltenen Titelbild (F-563); leer, wenn es öffentlich ist. */
export function coverHoldText(heldUntil: number | null | undefined, now = Date.now()): string {
  if (coverShown(heldUntil, now)) return '';
  if (heldUntil! >= REPORT_HOLD) return 'Noch nicht öffentlich: Das Titelbild wurde gemeldet und ist ausgeblendet, bis die Moderation entschieden hat.';
  const day = new Date(heldUntil!).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Berlin' });
  // neues Konto (7 Tage) oder Bild-Meldung eines neuen Kontos (72 h) – beides endet von selbst
  return `Noch nicht öffentlich: Titelbilder neuer Konten und gemeldete Titelbilder sehen andere erst nach einer Wartezeit – ab ${day}`;
}
