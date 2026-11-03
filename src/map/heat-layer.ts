import L from 'leaflet';
import { gridCluster, type Cluster } from '../domain/cluster';
import { HEAT, binFactor, cellBounds, cellCenter, heatOpacity, hotspot, rebin, type HeatData } from '../domain/heat';
import { cssVar } from '../util/html';
import { voyagePin } from './glyphs';

interface Pin {
  id: string;
  lat: number;
  lon: number;
}

/**
 * Ebene „Revier“ (Konzept 37, F-584/F-585): Wärmekarte der öffentlichen Törns als Rechtecke in `--map-heat` auf einer
 * eigenen Ebene unter den Tracks (Canvas, nicht anklickbar), je Zoomstufe gröber zusammengefasst; dazu – nur wo die
 * Karte Community-Hintergrund ist – Pins je Törn, mit `gridCluster` zusammengefasst. Bekommt fertige Daten, lädt nichts.
 */
export class HeatLayer {
  private cells = L.layerGroup();
  private pins = L.layerGroup();
  private renderer: L.Canvas;
  private data: HeatData | null = null;
  private points: Pin[] = [];
  private showPins = false;

  constructor(
    private map: L.Map,
    private el: HTMLElement,
  ) {
    // unter den Tracks (overlayPane 400), über den Kacheln
    map.createPane('sx-heat').style.zIndex = '350';
    this.renderer = L.canvas({ pane: 'sx-heat', padding: 0.2 });
    this.cells.addTo(map);
    this.pins.addTo(map);
    map.on('zoomend viewreset', () => this.draw());
    // Farbe folgt dem Farbschema (Token hell/dunkel)
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw());
  }

  /** Daten setzen bzw. (null) die Ebene leeren; `pins`: Törn-Pins zeigen. */
  set(data: HeatData | null, pins: boolean): void {
    if (data === this.data && pins === this.showPins) return;
    this.data = data;
    this.showPins = pins;
    this.points = (data?.voyages ?? []).map(([id, i, j]) => ({ id, ...cellCenter(i, j) }));
    this.draw();
  }

  /** Karte auf den dichtesten Bereich einpassen (F-586) – false, wenn es keinen gibt. */
  fitHotspot(): boolean {
    const b = this.data ? hotspot(this.data.cells) : null;
    if (!b) return false;
    this.map.invalidateSize({ animate: false });
    // Ohne Größe (versteckt, Raster noch nicht umgeschaltet) ergäbe fitBounds mit Rand eine Zoomstufe NaN – und
    // Leaflets Zuschneiden der Rechtecke liefe endlos. Dann beim ersten Größenwechsel einpassen.
    const size = this.map.getSize();
    if (size.x < 100 || size.y < 100) this.map.once('resize', () => this.fitHotspot());
    else this.map.fitBounds(b, { maxZoom: 12, animate: false, padding: [24, 24] });
    return true;
  }

  private draw() {
    this.cells.clearLayers();
    this.pins.clearLayers();
    const zoom = this.map.getZoom();
    if (!this.data || !Number.isFinite(zoom)) return;
    const f = binFactor(zoom);
    const cells = rebin(this.data.cells, f);
    let max = 1;
    for (let k = 2; k < cells.length; k += 3) max = Math.max(max, cells[k]);
    const color = cssVar(this.el, '--map-heat');
    for (let k = 0; k < cells.length; k += 3) {
      L.rectangle(cellBounds(cells[k], cells[k + 1], f), {
        renderer: this.renderer,
        stroke: false,
        fillColor: color,
        fillOpacity: heatOpacity(cells[k + 2], max),
        interactive: false,
      }).addTo(this.cells);
    }
    if (!this.showPins || !this.points.length) return;
    const clusters = gridCluster(
      this.points.map((p) => {
        const pt = this.map.project([p.lat, p.lon], zoom);
        return { item: p, x: pt.x, y: pt.y };
      }),
      HEAT.pinPx,
    );
    for (const c of clusters) this.addPin(c, zoom);
  }

  private addPin(c: Cluster<Pin>, zoom: number) {
    const single = c.items.length === 1;
    const first = c.items[0];
    const latlng = single ? L.latLng(first.lat, first.lon) : this.map.unproject([c.x, c.y], zoom);
    const icon = L.divIcon({ className: 'sx-marker sx-heat-pin', html: voyagePin(c.items.length), iconSize: [44, 44], iconAnchor: [22, 22] });
    // keyboard: per Tab erreichbar, Enter löst „click“ aus (Leaflet); title als zugänglicher Name.
    const title = single ? 'Törn ansehen' : `${c.items.length} Törns – hineinzoomen`;
    const m = L.marker(latlng, { icon, keyboard: true, title, alt: title, zIndexOffset: 400, riseOnHover: true });
    m.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      const bounds = L.latLngBounds(c.items.map((p) => [p.lat, p.lon] as L.LatLngTuple));
      // ein Törn – oder mehrere an derselben Stelle, die sich nicht auseinanderzoomen lassen: den ersten öffnen
      if (single || zoom >= this.map.getMaxZoom() || bounds.getNorthEast().equals(bounds.getSouthWest())) {
        location.assign(`/s/${encodeURIComponent(first.id)}`);
        return;
      }
      this.map.fitBounds(bounds.pad(0.3), { maxZoom: this.map.getMaxZoom() });
    });
    m.addTo(this.pins);
  }
}
