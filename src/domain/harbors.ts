// Häfen (Konzept 12.2): reine Regeln ohne DOM und Netz – genutzt von Worker (Anlegen, Dubletten, Migration) und
// Oberfläche (Autovervollständigung, Hafenseite).
import { slugFromName } from './groups';

/** Grenzen (Konzept 12.8). */
export const HARBOR_LIMITS = {
  /** neue Häfen je Konto und Tag */
  perDay: 10,
  /** Treffer der Autovervollständigung */
  search: 10,
  /** Länge des Suchtexts */
  queryMin: 2,
  queryMax: 80,
  /** Länge des Namens */
  nameMax: 80,
} as const;

const UMLAUTS: Record<string, string> = { Ä: 'ae', ä: 'ae', Ö: 'oe', ö: 'oe', Ü: 'ue', ü: 'ue', ß: 'ss' };

/** Satzzeichen, die beim Vergleich wie Leerzeichen zählen – dieselbe Liste steht in migrations/0012_social.sql. */
export const HARBOR_PUNCTUATION = ['.', ',', '-', '_', '/', '(', ')', "'", '"', ':', ';', '&', '+'] as const;
const PUNCT_RE = /[.,\-_/()'":;&+]/g;

/**
 * Normalisierter Name zum Erkennen von Dubletten („Hafen Potsdam-West“ = „hafen potsdam west“). Bewusst einfach, damit
 * dieselbe Regel in SQL geht (SQLite `lower()` kennt nur A–Z): A–Z klein, Ä/Ö/Ü/ä/ö/ü/ß → ae/oe/ue/ss, Satzzeichen →
 * Leerzeichen, Leerzeichen zusammengefasst und am Rand entfernt. Andere Zeichen bleiben, wie sie sind.
 */
export function harborKey(name: string): string {
  return name
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[ÄäÖöÜüß]/g, (c) => UMLAUTS[c])
    .replace(PUNCT_RE, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/^ +| +$/g, '');
}

/** Slug eines Hafens in der Adresse /h/<slug>: a–z, 0–9, Bindestrich, 1–100 Zeichen. */
export const HARBOR_SLUG_RE = /^[a-z0-9-]{1,100}$/;
export const isHarborSlug = (s: unknown): s is string => typeof s === 'string' && HARBOR_SLUG_RE.test(s);

/** Slug-Vorschlag für einen neuen Hafen (wie bei Gruppen), notfalls „hafen“. */
export const harborSlugBase = (name: string): string => slugFromName(name) || 'hafen';

/** Breite/Länge eines Hafens: beide gesetzt und gültig, beide leer (null) – sonst ungültig (undefined). */
export function parseHarborPosition(lat: unknown, lon: unknown): { lat: number | null; lon: number | null } | undefined {
  const empty = (v: unknown) => v === null || v === '' || v === undefined;
  if (empty(lat) && empty(lon)) return { lat: null, lon: null };
  const a = Number(lat);
  const o = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) return undefined;
  return { lat: Math.round(a * 1e5) / 1e5, lon: Math.round(o * 1e5) / 1e5 };
}

/** Hafen, wie ihn der Server in Listen und an Booten liefert. */
export interface HarborRef {
  id: string;
  slug: string;
  name: string;
}
