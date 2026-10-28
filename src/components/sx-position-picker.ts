import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css?inline';
import { BASE_MAPS } from '../domain/basemaps';
import { base, emit } from './shared';

/** Ohne Vorgabe: Havel um Potsdam */
const DEFAULT_CENTER: L.LatLngTuple = [52.4, 13.0];

/**
 * Position auf einer kleinen Karte setzen (Fahrtenbuch, L3): Klick setzt bzw. versetzt den Punkt und meldet
 * `sx-position` { lat, lon }. `near` zentriert die Karte (z. B. auf den anderen Hafen). Fetcht nichts außer Kacheln.
 */
export class SxPositionPicker extends LitElement {
  static properties = {
    value: { attribute: false },
    near: { attribute: false },
    label: { type: String },
  };
  declare value: { lat: number; lon: number } | null;
  declare near: { lat: number; lon: number } | null;
  declare label: string;
  private map: L.Map | null = null;
  private marker: L.CircleMarker | null = null;

  constructor() {
    super();
    this.value = null;
    this.near = null;
    this.label = 'Position';
  }

  static styles = [
    base,
    unsafeCSS(leafletCss),
    css`
      :host {
        display: block;
      }
      .map {
        height: 200px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        cursor: crosshair;
      }
    `,
  ];

  protected firstUpdated(): void {
    const el = this.renderRoot.querySelector<HTMLElement>('.map')!;
    const start = this.value ?? this.near;
    this.map = L.map(el, { zoomControl: true, attributionControl: true }).setView(start ? [start.lat, start.lon] : DEFAULT_CENTER, start ? 12 : 9);
    const tiles = BASE_MAPS[0];
    L.tileLayer(tiles.url, { maxZoom: tiles.maxZoom, attribution: tiles.attribution }).addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      const lat = Math.round(e.latlng.lat * 1e5) / 1e5;
      const lon = Math.round(e.latlng.lng * 1e5) / 1e5;
      emit(this, 'sx-position', { lat, lon });
    });
    // im gerade geöffneten Dialog stimmt die Größe erst nach dem Layout
    requestAnimationFrame(() => this.map?.invalidateSize());
    this.placeMarker();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('value')) this.placeMarker();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.map?.remove();
    this.map = null;
  }

  private placeMarker() {
    if (!this.map) return;
    this.marker?.remove();
    this.marker = this.value ? L.circleMarker([this.value.lat, this.value.lon], { radius: 8, weight: 3, color: getComputedStyle(this).getPropertyValue('--accent').trim() || 'currentColor', fillOpacity: 0.6 }).addTo(this.map) : null;
  }

  render() {
    return html`<div class="map" role="application" aria-label=${this.label}></div>`;
  }
}
customElements.define('sx-position-picker', SxPositionPicker);
