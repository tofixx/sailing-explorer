// Zugriffsregeln für Törns, Boote und Profile (Konzept 1–2): rein, ohne Worker-APIs, damit unit-testbar.
import { SHARE_KEY_LENGTH, isShareKey, type Visibility } from '../src/domain/visibility';
import { randomId } from './crypto';
import { timingSafeEqual } from './validate';

export interface Guarded {
  visibility: Visibility;
  /** gespeicherter Schlüssel; null = keiner (bei Törns: Altbestand) */
  shareKey: string | null;
}

export interface Viewer {
  /** Eigentümer bzw. bei Booten Eigner oder Admin – braucht nie einen Schlüssel */
  manager: boolean;
  /** mitgeschickter Schlüssel (Header X-Share-Key, bei Bildern ?k=, auf Seiten das Pfadsegment) */
  key: string | null;
}

/**
 * Darf der Betrachter das Objekt sehen?
 * - Verwalter immer; „Öffentlich“ immer (ein mitgeschickter Schlüssel wird ignoriert, auch ein falscher).
 * - „Nur ich“ nie.
 * - „Nur mit Link“ nur mit passendem Schlüssel. `legacyWithoutKey`: Altbestand ohne Schlüssel (nur Törns, F-91)
 *   bleibt über die ID allein erreichbar; für Boote/Profile gibt es keinen solchen Altbestand → fail closed.
 */
export function canView(obj: Guarded, viewer: Viewer, legacyWithoutKey = false): boolean {
  if (viewer.manager || obj.visibility === 'public') return true;
  if (obj.visibility !== 'unlisted') return false;
  if (obj.shareKey === null) return legacyWithoutKey;
  return viewer.key !== null && timingSafeEqual(viewer.key, obj.shareKey);
}

/** Schlüssel aus einer Anfrage: Header X-Share-Key, für Bilder zusätzlich ?k=. Unpassende Form zählt als falscher Schlüssel. */
export function requestKey(request: Request, allowQuery = false): string | null {
  const raw = request.headers.get('X-Share-Key') ?? (allowQuery ? new URL(request.url).searchParams.get('k') : null);
  if (raw === null || raw === '') return null;
  return isShareKey(raw) ? raw : '!';
}

/** Neuer Schlüssel mit ca. 128 Bit. */
export const newShareKey = () => randomId(SHARE_KEY_LENGTH);

/**
 * Schlüssel nach einem Stufenwechsel (Konzept 2.2): beim ersten Wechsel auf „Nur mit Link“ bzw. bei neuen
 * „Nur mit Link“-Objekten wird einer erzeugt, ein vorhandener bleibt (auch über „Nur ich“ hinweg) bestehen;
 * `rotate` erzeugt immer einen neuen. `legacyWithoutKey` (nur Törns): Altbestand ohne Schlüssel, der „Nur mit Link“
 * bleibt, behält NULL (F-91); sonst bekommt ein „Nur mit Link“-Objekt ohne Schlüssel immer einen.
 */
export function nextShareKey(
  current: Visibility | null,
  next: Visibility,
  key: string | null,
  rotate: boolean,
  legacyWithoutKey = false,
  make: () => string = newShareKey,
): string | null {
  if (rotate) return make();
  if (next === 'unlisted' && key === null && !(legacyWithoutKey && current === 'unlisted')) return make();
  return key;
}
