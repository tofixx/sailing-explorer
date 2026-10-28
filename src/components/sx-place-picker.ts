import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css?inline';
import { MAP_LANG, defaultBaseMap } from '../domain/basemaps';
import { parseHarborPosition } from '../domain/harbors';
import { fmtNum } from '../util/html';
import { base, emit } from './shared';

export interface PlacePoint {
  lat: number;
  lon: number;
}

/** Startausschnitt ohne Punkt: Potsdam/Berlin, wo die meisten Häfen der App liegen. */
const START: [number, number] = [52.42, 13.05];

/**
 * Ort auf der Karte wählen (F-353): kleine Karte, Antippen setzt den Punkt, die Markierung lässt sich verschieben.
 * Für Häfen (Anlegen und Bearbeiten) – Vereine und Teams haben ihren Ort über den Heimathafen. Kein Gerätestandort
 * nötig. Meldet `sx-place-pick` { lat, lon } (5 Nachkommastellen wie parseHarborPosition).
 */
export class SxPlacePicker extends LitElement {
  static properties = { value: { attribute: false }, label: { type: String } };
  declare value: PlacePoint | null;
  declare label: string;

  private map: L.Map | null = null;
  private marker: L.Marker | null = null;

  constructor() {
    super();
    this.value = null;
    this.label = 'Lage auf der Karte antippen';
  }

  static styles = [
    base,
    unsafeCSS(leafletCss),
    css`
      :host {
        display: grid;
        gap: var(--s-1);
      }
      .map {
        height: 220px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        overflow: hidden;
        background: var(--map-bg);
      }
      .pin {
        border-radius: 50%;
        background: var(--accent);
        border: 3px solid #fff;
        box-shadow: var(--shadow-1);
      }
      .hint {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
    `,
  ];

  firstUpdated(): void {
    const el = this.renderRoot.querySelector<HTMLElement>('.map')!;
    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    const bm = defaultBaseMap(MAP_LANG, dark);
    this.map = L.map(el, { zoomControl: true, attributionControl: true }).setView(this.value ? [this.value.lat, this.value.lon] : START, this.value ? 14 : 10);
    L.tileLayer(bm.url, { maxZoom: bm.maxZoom, maxNativeZoom: bm.maxNativeZoom, attribution: bm.attribution }).addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => this.pick(e.latlng.lat, e.latlng.lng));
    this.placeMarker();
    // in Dialogen/Formularen ist die Größe beim ersten Zeichnen oft noch 0
    new ResizeObserver(() => this.map?.invalidateSize()).observe(el);
  }

  updated(changed: PropertyValues<this>): void {
    if (changed.has('value') && this.map) this.placeMarker();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.map?.remove();
    this.map = null;
  }

  /** Punkt setzen (gerundet) und melden. */
  pick(lat: number, lon: number): void {
    const p = parseHarborPosition(lat, lon);
    if (!p || p.lat === null || p.lon === null) return;
    this.value = { lat: p.lat, lon: p.lon };
    emit(this, 'sx-place-pick', this.value);
  }

  private placeMarker() {
    if (!this.map) return;
    if (!this.value) {
      this.marker?.remove();
      this.marker = null;
      return;
    }
    const ll: [number, number] = [this.value.lat, this.value.lon];
    if (!this.marker) {
      this.marker = L.marker(ll, { draggable: true, icon: L.divIcon({ className: 'pin', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(this.map);
      this.marker.on('dragend', () => {
        const at = this.marker!.getLatLng();
        this.pick(at.lat, at.lng);
      });
    } else this.marker.setLatLng(ll);
  }

  render() {
    const v = this.value;
    return html`<div class="map" role="application" aria-label=${this.label}></div>
      <span class="hint" aria-live="polite">${v
        ? `Gewählt: ${fmtNum(v.lat, 4)}° N, ${fmtNum(v.lon, 4)}° O – zum Ändern woanders antippen oder die Markierung ziehen.`
        : this.label}</span>`;
  }
}
customElements.define('sx-place-picker', SxPlacePicker);
