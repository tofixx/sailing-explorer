// Ungelesene Einträge im persönlichen Stream (Konzept 12.10, F-220 … F-222) – reine Regeln für Server und Oberfläche.

/** Höchstens so viele werden gezählt; darüber zeigt das Badge „99+“. */
export const UNREAD_MAX = 99;
/** Kandidaten je Zählung (danach wird beim Lesen geprüft, wie im Stream). */
export const UNREAD_SCAN = 150;
/** Frühestens nach dieser Zeit wird beim Zurückkehren in den Tab neu gezählt (Free-Tier schonen). */
export const UNREAD_REFRESH_MS = 2 * 60_000;
/** Solange der Tab sichtbar ist, wird in diesem Abstand neu gezählt. */
export const UNREAD_POLL_MS = 10 * 60_000;

/** Text im Badge: leer ohne Neues, sonst die Zahl bzw. „99+“. */
export function unreadLabel(count: number): string {
  if (!(count > 0)) return '';
  return count > UNREAD_MAX ? `${UNREAD_MAX}+` : String(Math.floor(count));
}

/**
 * Gelesen bis: der Zeitpunkt, zu dem der angezeigte Stream geladen wurde (Neues danach bleibt ungelesen) – nie in der
 * Zukunft; ohne gültige Angabe „jetzt“. Vorwärts-only setzt der Server beim Speichern durch.
 */
export function seenUntil(at: unknown, now: number): number {
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? Math.min(Math.floor(at), now) : now;
}
