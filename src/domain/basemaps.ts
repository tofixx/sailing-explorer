// Grundkarten und Sprache der Kartenbeschriftung. Rasterkacheln bringen ihre Beschriftung fertig mit – die Sprache
// lässt sich also nur über die Wahl der Kachelquelle steuern. Eine Einstellung (MAP_LANG) bestimmt, welche Grundkarte
// standardmäßig erscheint; ein späterer Sprachwechsel ändert nur diesen Wert.

/** Sprache der Kartenbeschriftung – die App ist durchgehend deutsch. */
export type MapLang = 'de' | 'en';
export const MAP_LANG: MapLang = 'de';

export interface BaseMap {
  key: string;
  /** Name im Ebenen-Menü */
  label: string;
  url: string;
  maxZoom: number;
  maxNativeZoom?: number;
  /** Quellenangabe für Leaflet (HTML) */
  attribution: string;
  /** dieselbe Angabe als reiner Text (Teilen-Bild) */
  attributionText: string;
  /** Sprache der eingebrannten Beschriftung: `local` = Ortsname der Region (z. B. schwedisch), `none` = keine */
  labels: MapLang | 'local' | 'none';
  /** für das dunkle Farbschema gedacht */
  dark?: boolean;
}

const esri = (service: string, maxNativeZoom: number) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`,
  maxZoom: 19,
  maxNativeZoom,
  attribution: 'Kacheln © Esri, GEBCO, NOAA, Garmin, HERE',
  attributionText: 'Kacheln © Esri, GEBCO, NOAA',
});
const OSM_COPYRIGHT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>';

export const BASE_MAPS: readonly BaseMap[] = [
  // OSM Deutschland beschriftet mit name:de, sonst mit dem Ortsnamen – „Ostsee“ statt „Östersjön“/„Baltic Sea“.
  { key: 'osm-de', label: 'Tag (deutsch beschriftet)', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', maxZoom: 18, attribution: `${OSM_COPYRIGHT}, Kacheln OSM Deutschland (FOSSGIS e.V.)`, attributionText: '© OpenStreetMap-Mitwirkende, Kacheln OSM Deutschland', labels: 'de' },
  { key: 'esri-ocean', label: 'Seekarte (Esri, englisch)', ...esri('Ocean/World_Ocean_Base', 13), labels: 'en' },
  { key: 'esri-dark', label: 'Nacht', ...esri('Canvas/World_Dark_Gray_Base', 16), labels: 'none', dark: true },
  { key: 'osm', label: 'OpenStreetMap (Ortsnamen)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM_COPYRIGHT, attributionText: '© OpenStreetMap-Mitwirkende', labels: 'local' },
];

/** Passt die Beschriftung zur Sprache? Karten ohne Beschriftung passen immer. */
export const labelsFit = (m: BaseMap, lang: MapLang) => m.labels === lang || m.labels === 'none';

/**
 * Grundkarte, die ohne eigene Wahl erscheint: passend zum Farbschema und mit Beschriftung in der eingestellten
 * Sprache (sonst ohne Beschriftung); erst wenn keine passt, die erste fürs Schema.
 */
export function defaultBaseMap(lang: MapLang, dark: boolean, maps: readonly BaseMap[] = BASE_MAPS): BaseMap {
  const forScheme = maps.filter((m) => !!m.dark === dark);
  return forScheme.find((m) => m.labels === lang) ?? forScheme.find((m) => labelsFit(m, lang)) ?? forScheme[0] ?? maps[0];
}
