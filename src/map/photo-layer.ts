import L from 'leaflet';
import { gridCluster, type Cluster } from '../domain/cluster';
import { escapeHtml } from '../util/html';
import { photoPin } from './glyphs';

/** Foto auf der Karte – Daten fertig aufbereitet vom Controller (Komponenten kennen Leaflet nicht). */
export interface MapPhoto {
  id: string;
  lat: number;
  lon: number;
  /** Vorschaubild (eigene Origin bzw. blob:) */
  thumbUrl: string;
  caption: string;
  /** noch nicht hochgeladen (Vorschau im Upload-Dialog) */
  pending?: boolean;
}

export interface PhotoLayerCallbacks {
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}

/** Zellgröße der Clusterung in Pixeln. */
const CELL_PX = 44;

/**
 * Ebene „Fotos“ (Konzept 3.3): Kamera-Marker in --c-photo, Raster-Clusterung je Zoomstufe, Hover mit Vorschaubild,
 * Klick öffnet die Lightbox, Cluster zoomen hinein. Dazu der Modus „manuell platzieren“ (Klick auf die Karte).
 */
export class PhotoLayer {
  private layer = L.layerGroup();
  private photos: MapPhoto[] = [];
  private active: string | null = null;
  private placing: { onPick: (lat: number, lon: number) => void; onCancel: () => void } | null = null;
  callbacks: PhotoLayerCallbacks = { onOpen: () => {}, onHover: () => {} };

  constructor(
    private map: L.Map,
    private el: HTMLElement,
  ) {
    this.layer.addTo(map);
    map.on('zoomend viewreset', () => this.draw());
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!this.placing) return;
      const p = this.placing;
      this.stopPlacing();
      p.onPick(e.latlng.lat, e.latlng.lng);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.placing) return;
      const p = this.placing;
      this.stopPlacing();
      p.onCancel();
    });
  }

  set(photos: MapPhoto[]): void {
    this.photos = photos;
    this.draw();
  }

  /** Hebt ein Foto (bzw. seinen Cluster) hervor – ohne die Karte zu bewegen. */
  highlight(id: string | null): void {
    if (id === this.active) return;
    this.active = id;
    this.draw();
  }

  /** Karte auf ein Foto zentrieren (z. B. „Auf Karte zeigen“). */
  focus(id: string): void {
    const p = this.photos.find((x) => x.id === id);
    if (!p) return;
    this.map.setView([p.lat, p.lon], Math.max(this.map.getZoom(), 14));
    this.highlight(id);
  }

  /** Nächster Klick auf die Karte setzt das Foto (Esc bricht ab). */
  startPlacing(onPick: (lat: number, lon: number) => void, onCancel: () => void): void {
    this.placing = { onPick, onCancel };
    this.el.classList.add('sx-placing');
  }

  stopPlacing(): void {
    this.placing = null;
    this.el.classList.remove('sx-placing');
  }

  get isPlacing(): boolean {
    return this.placing !== null;
  }

  private draw() {
    this.layer.clearLayers();
    if (!this.photos.length) return;
    const zoom = this.map.getZoom();
    const clusters = gridCluster(
      this.photos.map((p) => {
        const pt = this.map.project([p.lat, p.lon], zoom);
        return { item: p, x: pt.x, y: pt.y };
      }),
      CELL_PX,
    );
    for (const c of clusters) this.addCluster(c, zoom);
  }

  private addCluster(c: Cluster<MapPhoto>, zoom: number) {
    const single = c.items.length === 1;
    const first = c.items[0];
    const active = !!this.active && c.items.some((p) => p.id === this.active);
    const latlng = single ? L.latLng(first.lat, first.lon) : this.map.unproject([c.x, c.y], zoom);
    const label = single ? `Foto${first.caption ? `: ${first.caption}` : ''}` : `${c.items.length} Fotos`;
    const icon = L.divIcon({
      className: `sx-marker sx-photo-marker${active ? ' active' : ''}${first.pending ? ' pending' : ''}`,
      html: photoPin(c.items.length, active),
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      tooltipAnchor: [0, -16],
    });
    // keyboard: per Tab erreichbar, Enter löst „click“ aus (Leaflet); title als zugänglicher Name.
    const m = L.marker(latlng, { icon, keyboard: true, title: label, zIndexOffset: active ? 900 : 700, riseOnHover: true });
    const thumbs = c.items
      .slice(0, 3)
      .map((p) => `<img src="${escapeHtml(p.thumbUrl)}" alt="" width="96" height="72" loading="lazy">`)
      .join('');
    const caption = single && first.caption ? `<br>${escapeHtml(first.caption)}` : single ? '' : `<br>${c.items.length} Fotos – klicken zum Vergrößern`;
    m.bindTooltip(`<span class="sx-photo-tip">${thumbs}</span>${caption}`, { className: 'sx-tip', direction: 'top' });
    m.on('mouseover', () => this.callbacks.onHover(first.id));
    m.on('mouseout', () => this.callbacks.onHover(null));
    m.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      if (this.placing) return;
      if (single || zoom >= this.map.getMaxZoom()) return this.callbacks.onOpen(first.id);
      const bounds = L.latLngBounds(c.items.map((p) => [p.lat, p.lon] as L.LatLngTuple));
      // Fotos am selben Ort lassen sich nicht auseinanderzoomen – dann das erste öffnen.
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) return this.callbacks.onOpen(first.id);
      this.map.fitBounds(bounds.pad(0.3), { maxZoom: this.map.getMaxZoom() });
    });
    m.addTo(this.layer);
  }
}
