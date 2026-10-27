// Kartenstile: Farbverlauf der Track-Einfärbung und Darstellung der Wind-/Wellen-Symbole als feste Sets.
// Reine Daten und Regeln – Karte, Legende und Teilen-Bild lesen daraus, der Worker prüft damit die Profil-Einstellung.
import { RAMP } from './metrics';

export type MapStyleId = 'classic' | 'contrast' | 'colorblind' | 'subtle';

export interface MapStyle {
  id: MapStyleId;
  label: string;
  description: string;
  /** Stützfarben des Farbverlaufs (niedrig → hoch), 6-stellige Hex-Werte */
  ramp: readonly string[];
  /**
   * Farbe der Wind- und Wellen-Symbole: `ramp` = Stärke aus dem Farbverlauf,
   * `semantic` = immer die Bedeutungsfarbe (`--c-wind`, `--c-wave`), die Zahl trägt die Stärke.
   */
  symbols: 'ramp' | 'semantic';
  /** Größe der Symbole (1 = Standard) */
  symbolScale: number;
  /** Strichstärke der Track-Linie in px */
  lineWeight: number;
}

export const MAP_STYLES: Record<MapStyleId, MapStyle> = {
  classic: {
    id: 'classic',
    label: 'Klassisch',
    description: 'Kühl bis warm, Symbole in der Stärkefarbe.',
    ramp: RAMP,
    symbols: 'ramp',
    symbolScale: 1,
    lineWeight: 4,
  },
  contrast: {
    id: 'contrast',
    label: 'Kontrast',
    description: 'Kräftige Farben, dickere Linie, größere Symbole – gut bei Sonne auf dem Display.',
    ramp: ['#08306b', '#1f5fd1', '#00b4d8', '#2fbf4a', '#ffd400', '#ff8c00', '#e4002b', '#7a0019'],
    symbols: 'ramp',
    symbolScale: 1.25,
    lineWeight: 5,
  },
  colorblind: {
    id: 'colorblind',
    label: 'Farbenblind-freundlich',
    description: 'Viridis: von Violett über Grün nach Gelb, auch bei Rot-Grün-Schwäche und in Graustufen eindeutig.',
    ramp: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'],
    symbols: 'ramp',
    symbolScale: 1,
    lineWeight: 4,
  },
  subtle: {
    id: 'subtle',
    label: 'Dezent',
    description: 'Hellgrau bis Rostrot – nur hohe Werte fallen auf; Symbole in ihrer festen Farbe.',
    ramp: ['#b8c2cc', '#bfbdb7', '#c7b9a1', '#cead85', '#d49e64', '#d48846', '#c6642a', '#b8400f'],
    symbols: 'semantic',
    symbolScale: 1,
    lineWeight: 4,
  },
};

export const MAP_STYLE_IDS = Object.keys(MAP_STYLES) as MapStyleId[];
export const DEFAULT_MAP_STYLE: MapStyleId = 'classic';

export function isMapStyleId(v: unknown): v is MapStyleId {
  return typeof v === 'string' && Object.hasOwn(MAP_STYLES, v);
}

/**
 * Welcher Stil gilt: die erste gültige Angabe in Vorrang-Reihenfolge, sonst „Klassisch“.
 * Die App übergibt: Wahl „Nur jetzt“ dieser Sitzung, Profil-Standard, Wahl auf diesem Gerät (Gast).
 */
export function resolveMapStyle(...candidates: unknown[]): MapStyleId {
  return candidates.find(isMapStyleId) ?? DEFAULT_MAP_STYLE;
}
