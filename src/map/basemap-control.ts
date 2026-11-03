import L from 'leaflet';

/** Name der Grundkarten-Wahl (F-617) – Leaflet nennt den Knopf „Layers“. */
export const BASE_MAP_LABEL = 'Grundkarte';

/**
 * Grundkarten-Wahl oben rechts (Leaflet-Ebenen-Steuerung): deutsch benannt und so vom Kartenstil-Knopf unten rechts
 * (F-218, F-531) unterscheidbar – der wählt die Einfärbung, dieser die Kacheln (F-617).
 */
export function addBaseMapControl(map: L.Map, bases: Record<string, L.Layer>): L.Control.Layers {
  const ctl = L.control.layers(bases, undefined, { position: 'topright' }).addTo(map);
  const toggle = ctl.getContainer()?.querySelector<HTMLElement>('.leaflet-control-layers-toggle');
  toggle?.setAttribute('title', BASE_MAP_LABEL);
  toggle?.setAttribute('aria-label', BASE_MAP_LABEL);
  return ctl;
}
