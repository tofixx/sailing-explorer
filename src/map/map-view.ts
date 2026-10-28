import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { METRICS, rampColor, smoothedMetric, type Range } from '../domain/metrics';
import { BASE_MAPS, MAP_LANG, defaultBaseMap } from '../domain/basemaps';
import { compassName } from '../domain/geo';
import { MAP_STYLES, type MapStyle } from '../domain/map-style';
import type { MetricKey, Track, TrackPoint } from '../domain/types';
import type { Layers } from '../services/store';
import { cssVar, escapeHtml, fmtDateTime, fmtNum } from '../util/html';
import { endpointPin, waveChevron, waveChevronSize, windBadge, windBadgeSize } from './glyphs';
import { PhotoLayer } from './photo-layer';

export interface MapCallbacks {
  onHover: (p: TrackPoint | null) => void;
}

/** Anzahl Farbstufen: benachbarte Segmente gleicher Stufe werden zu einer Polylinie. */
const COLOR_STEPS = 20;
const HOVER_RADIUS_PX = 28;

/**
 * Kapselt Leaflet. Bekommt fertige Daten, rendert sie und meldet Hover zurück –
 * kennt weder Store noch Komponenten.
 */
/** Deckkraft der übrigen Tracks, solange einer hervorgehoben ist – blasser, aber gut erkennbar. */
const DIMMED = 0.3;

export class MapView {
  private map: L.Map;
  private trackLayer = L.layerGroup();
  private windLayer = L.layerGroup();
  private waveLayer = L.layerGroup();
  private seamarks: L.TileLayer;
  private depth: L.LayerGroup;
  private hoverMarker: L.CircleMarker | null = null;
  private projected: Array<{ p: TrackPoint; x: number; y: number }> = [];
  private tracks: Track[] = [];
  /** Ebene je Track und Zuordnung Punkt → Track – für das Hervorheben beim Hovern (F-224) */
  private trackGroups = new Map<Track, L.LayerGroup>();
  private pointTrack = new WeakMap<TrackPoint, Track>();
  private focused: Track | null = null;
  private style: MapStyle = MAP_STYLES.classic;
  private raf = 0;
  /** Ebene „Fotos“ (Phase C) – Callbacks setzt die Verdrahtung */
  readonly photos: PhotoLayer;

  constructor(
    private el: HTMLElement,
    private cb: MapCallbacks,
  ) {
    this.map = L.map(el, { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([54.4, 12.7], 8);
    L.control.zoom({ position: 'topleft', zoomInTitle: 'Hineinzoomen', zoomOutTitle: 'Herauszoomen' }).addTo(this.map);

    // Grundkarten (src/domain/basemaps.ts). Standard folgt dem Farbschema und der Sprache der Beschriftung (MAP_LANG):
    // tagsüber deutsch beschriftet, nachts ohne Beschriftung – die Daten (Track, Wind, Wellen) bleiben im Vordergrund.
    const layers = new Map(
      BASE_MAPS.map((m) => [m.key, L.tileLayer(m.url, { maxZoom: m.maxZoom, maxNativeZoom: m.maxNativeZoom, attribution: m.attribution })]),
    );
    const bases = Object.fromEntries(BASE_MAPS.map((m) => [m.label, layers.get(m.key)!]));
    const auto = (isDark: boolean) => layers.get(defaultBaseMap(MAP_LANG, isDark).key)!;
    const dark = matchMedia('(prefers-color-scheme: dark)');
    let current = auto(dark.matches).addTo(this.map);
    this.map.on('baselayerchange', (e: L.LayersControlEvent) => (current = e.layer as L.TileLayer));
    // Folgt dem Systemschema, solange der Nutzer keine eigene Wahl getroffen hat.
    dark.addEventListener('change', () => {
      if (current !== auto(true) && current !== auto(false)) return;
      current.remove();
      current = auto(dark.matches).addTo(this.map);
    });
    L.control.layers(bases, undefined, { position: 'topright' }).addTo(this.map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    this.seamarks = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap' });
    const wms = 'https://ows.emodnet-bathymetry.eu/wms';
    this.depth = L.layerGroup([
      L.tileLayer.wms(wms, { layers: 'emodnet:mean_multicolour', format: 'image/png', transparent: true, opacity: 0.55, attribution: '© EMODnet Bathymetry' }),
      L.tileLayer.wms(wms, { layers: 'emodnet:contours', format: 'image/png', transparent: true, opacity: 0.8 }),
    ]);

    this.trackLayer.addTo(this.map);
    this.waveLayer.addTo(this.map);
    this.windLayer.addTo(this.map);
    this.photos = new PhotoLayer(this.map, el);

    this.map.on('zoomend viewreset', () => {
      this.project();
      this.renderArrows(this.tracks);
    });
    this.map.on('mousemove', (e: L.LeafletMouseEvent) => this.onMove(e.containerPoint));
    // Touch: Tippen auf den Track wählt den Punkt
    this.map.on('click', (e: L.LeafletMouseEvent) => this.onMove(e.containerPoint));
    this.map.on('mouseout', () => this.cb.onHover(null));

    new ResizeObserver(() => this.map.invalidateSize()).observe(el);
  }

  setLayers(layers: Layers): void {
    this.toggle(this.seamarks, layers.seamarks);
    this.toggle(this.depth, layers.depth);
    this.toggle(this.windLayer, layers.windArrows);
    this.toggle(this.waveLayer, layers.waveArrows);
  }

  private toggle(layer: L.Layer, on: boolean) {
    if (on && !this.map.hasLayer(layer)) layer.addTo(this.map);
    if (!on && this.map.hasLayer(layer)) layer.remove();
  }

  render(tracks: Track[], metric: MetricKey, range: Range | null, style: MapStyle = MAP_STYLES.classic): void {
    this.tracks = tracks;
    this.style = style;
    const weight = style.lineWeight;
    this.trackLayer.clearLayers();
    this.trackGroups.clear();
    this.focused = null;
    const noData = cssVar(this.el, '--text-3');
    const halo = cssVar(this.el, '--map-halo');

    for (const t of tracks) {
      const pts = t.points;
      const group = L.layerGroup().addTo(this.trackLayer);
      this.trackGroups.set(t, group);
      for (const p of pts) this.pointTrack.set(p, t);
      const trackColor = cssVar(this.el, t.color);
      // Fahrtenbuch ohne GPX: gestrichelt in der Trackfarbe, nie nach Metrik eingefärbt (Konzept 19.2.1, F-302)
      const dash = t.estimated ? `${weight * 2} ${weight * 2}` : undefined;
      const values = range && !t.estimated ? smoothedMetric(pts, metric) : null;
      const colorAt = (i: number): string => {
        if (!range || !values) return trackColor;
        const a = values[i - 1];
        const b = values[i];
        const v = a != null && b != null ? (a + b) / 2 : (b ?? a);
        if (v == null) return noData;
        const step = Math.round(((v - range.lo) / (range.hi - range.lo)) * (COLOR_STEPS - 1));
        return rampColor(Math.max(0, Math.min(COLOR_STEPS - 1, step)) / (COLOR_STEPS - 1), style.ramp);
      };

      // Halo unter der Linie für Kontrast auf jeder Grundkarte
      L.polyline(pts.map((p) => [p.lat, p.lon] as L.LatLngTuple), { color: halo, weight: weight + 3, opacity: 0.7, dashArray: dash, interactive: false }).addTo(group);

      let run: L.LatLngTuple[] = [[pts[0].lat, pts[0].lon]];
      let runColor = pts.length > 1 ? colorAt(1) : trackColor;
      for (let i = 1; i < pts.length; i++) {
        const c = colorAt(i);
        if (c !== runColor) {
          L.polyline(run, { color: runColor, weight, opacity: 1, lineCap: 'butt', lineJoin: 'round', dashArray: dash, interactive: false }).addTo(group);
          run = [run[run.length - 1]];
          runColor = c;
        }
        run.push([pts[i].lat, pts[i].lon]);
      }
      L.polyline(run, { color: runColor, weight, opacity: 1, lineCap: 'butt', lineJoin: 'round', dashArray: dash, interactive: false }).addTo(group);

      const name = escapeHtml(t.name);
      const s = pts[0];
      const e = pts[pts.length - 1];
      const ends = t.estimated && pts.length === 1 ? ([['start', s, 'Rundtörn']] as const) : ([['start', s, 'Start'], ['end', e, 'Ziel']] as const);
      for (const [kind, p, label] of ends) {
        const icon = L.divIcon({ className: 'sx-marker', html: endpointPin(kind, t.color), iconSize: [28, 36], iconAnchor: [14, 34], tooltipAnchor: [0, -30] });
        L.marker([p.lat, p.lon], { icon, keyboard: false, zIndexOffset: kind === 'end' ? 600 : 500 })
          .bindTooltip(`<b>${label}</b><br>${name}`, { className: 'sx-tip', direction: 'top' })
          .addTo(group);
      }
    }
    this.renderArrows(tracks);
    this.project();
  }

  /**
   * Wind-Badges und Wellen-Chevrons mit Mindestabstand auf dem Bildschirm verteilen,
   * damit sie sich bei keinem Zoom überlappen. Wird bei jedem Zoom neu berechnet.
   */
  private renderArrows(tracks: Track[]) {
    this.windLayer.clearLayers();
    this.waveLayer.clearLayers();
    const zoom = this.map.getZoom();
    // gemeinsame Liste: Wellen-Chevrons weichen auch den Wind-Badges aus
    const placed: L.Point[] = [];
    const place = (layer: L.LayerGroup, minPx: number, offset: number, make: (p: TrackPoint) => L.DivIcon | null) => {
      for (const t of tracks) {
        const pts = t.points;
        const stride = Math.max(1, Math.floor(pts.length / 400));
        for (let i = Math.floor(stride * offset); i < pts.length; i += stride) {
          const px = this.map.project([pts[i].lat, pts[i].lon], zoom);
          if (placed.some((q) => q.distanceTo(px) < minPx)) continue;
          const icon = make(pts[i]);
          if (!icon) continue;
          placed.push(px);
          L.marker([pts[i].lat, pts[i].lon], { icon, interactive: false, keyboard: false }).addTo(layer);
        }
      }
    };
    const style = this.style;
    const wind = windBadgeSize(style);
    const wave = waveChevronSize(style);
    place(this.windLayer, 90 * style.symbolScale, 0, (p) =>
      p.wx?.wind != null && p.wx.dir != null
        ? L.divIcon({ className: 'sx-marker', html: windBadge(p.wx.dir, p.wx.wind, style), iconSize: [wind, wind], iconAnchor: [wind / 2, wind / 2] })
        : null,
    );
    place(this.waveLayer, 60 * style.symbolScale, 0.5, (p) =>
      p.wx?.wave != null && p.wx.wdir != null
        ? L.divIcon({ className: 'sx-marker', html: waveChevron(p.wx.wdir, p.wx.wave, style), iconSize: [wave, wave], iconAnchor: [wave / 2, wave / 2] })
        : null,
    );
  }

  fit(tracks: Track[]): void {
    const latlngs = tracks.flatMap((t) => [t.points[0], t.points[t.points.length - 1], ...t.points.filter((_, i) => i % 50 === 0)]);
    if (!latlngs.length) return;
    // Die Karte kann sich gerade erst verkleinert haben (Seitenleiste nach dem ersten Upload, Wechsel von der
    // Startseite). Der ResizeObserver meldet das erst später – also jetzt messen, sonst passt der Ausschnitt
    // zur alten Breite und der Track liegt teils unter der Seitenleiste.
    this.map.invalidateSize({ animate: false });
    this.map.fitBounds(L.latLngBounds(latlngs.map((p) => [p.lat, p.lon])), {
      // unten etwas mehr Luft für Maßstab und Quellenangabe
      paddingTopLeft: [48, 48],
      paddingBottomRight: [48, 64],
      animate: false,
      // Rundtörn im Fahrtenbuch: nur ein Hafen – nicht bis zur höchsten Stufe hineinzoomen
      ...(latlngs.every((p) => p.lat === latlngs[0].lat && p.lon === latlngs[0].lon) ? { maxZoom: 13 } : {}),
    });
  }

  /** Projiziert Punkte einmal pro Zoomstufe – Hover sucht dann nur noch in Pixeln. */
  private project() {
    const zoom = this.map.getZoom();
    this.projected = [];
    for (const t of this.tracks) {
      // Auf niedrigen Zoomstufen reicht jeder n-te Punkt.
      const stride = zoom >= 13 ? 1 : zoom >= 11 ? 2 : 4;
      for (let i = 0; i < t.points.length; i += stride) {
        const p = t.points[i];
        const pt = this.map.project([p.lat, p.lon], zoom);
        this.projected.push({ p, x: pt.x, y: pt.y });
      }
    }
  }

  private onMove(container: L.Point) {
    if (!this.projected.length || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const origin = this.map.getPixelOrigin();
      const lp = this.map.containerPointToLayerPoint(container);
      const x = lp.x + origin.x;
      const y = lp.y + origin.y;
      let best: TrackPoint | null = null;
      let bd = HOVER_RADIUS_PX ** 2;
      for (const q of this.projected) {
        const d = (q.x - x) ** 2 + (q.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = q.p;
        }
      }
      this.cb.onHover(best);
    });
  }

  /** Track, zu dem ein gezeichneter Punkt gehört (Verlauf ↔ Trackliste, F-226). */
  trackOf(p: TrackPoint): Track | null {
    return this.pointTrack.get(p) ?? null;
  }

  /**
   * Bei mehreren Tracks den gehoverten hervorheben: die übrigen deutlich verblasst, aber sichtbar (F-224, F-226).
   * null bzw. ein einzelner Track: alle normal.
   */
  focus(t: Track | null): void {
    const target = this.trackGroups.size > 1 ? t : null;
    if (target === this.focused) return;
    this.focused = target;
    for (const [track, group] of this.trackGroups) {
      const dim = target !== null && track !== target;
      group.eachLayer((l) => {
        if (l instanceof L.Polyline) {
          const o = l.options as L.PolylineOptions & { baseOpacity?: number };
          o.baseOpacity ??= o.opacity ?? 1;
          l.setStyle({ opacity: dim ? o.baseOpacity * DIMMED : o.baseOpacity });
        } else if (l instanceof L.Marker) {
          l.setOpacity(dim ? DIMMED : 1);
        }
      });
    }
  }

  /** Zeigt den Hover-Punkt; bei Bedarf wird die Karte dorthin verschoben. */
  showHover(p: TrackPoint | null, opts: { emphasize?: boolean; pan?: boolean } = {}): void {
    this.focus(p ? this.trackOf(p) : null);
    if (!p) {
      this.hoverMarker?.remove();
      this.hoverMarker = null;
      return;
    }
    const color = opts.emphasize ? cssVar(this.el, '--c-gust') : cssVar(this.el, '--accent');
    if (!this.hoverMarker) {
      this.hoverMarker = L.circleMarker([p.lat, p.lon], { radius: 7, weight: 3, fillColor: cssVar(this.el, '--surface'), fillOpacity: 1, interactive: false }).addTo(this.map);
      this.hoverMarker.bindTooltip('', { direction: 'top', offset: [0, -10], className: 'sx-tip', opacity: 1 });
    }
    this.hoverMarker.setLatLng([p.lat, p.lon]).setStyle({ color, radius: opts.emphasize ? 8 : 7 });
    this.hoverMarker.setTooltipContent(pointTooltip(p)).openTooltip();
    if (opts.pan && !this.map.getBounds().pad(-0.15).contains([p.lat, p.lon])) this.map.panTo([p.lat, p.lon]);
  }
}

function pointTooltip(p: TrackPoint): string {
  const when = p.time != null ? fmtDateTime(p.time) : 'ohne Zeitstempel';
  const sp = METRICS.speed.get(p);
  const dot = (v: string) => `<span class="dot" style="background:var(${v})"></span>`;
  const rows = [`<b>${when}</b>`];
  rows.push(`${dot('--c-speed')}Fahrt <b>${sp != null ? fmtNum(sp, 1) + ' kn' : p.glitch ? '– <span class="muted">(GPS-Ausreißer)</span>' : '–'}</b>`);
  const wx = p.wx;
  if (wx?.wind != null) {
    rows.push(
      `${dot('--c-wind')}Wind <b>${fmtNum(wx.wind, 0)} kn</b>` +
        (wx.dir != null ? ` <span class="muted">aus ${compassName(wx.dir)}</span>` : '') +
        (wx.gust != null ? ` · Böen <b>${fmtNum(wx.gust, 0)}</b>` : ''),
    );
  }
  if (wx?.wave != null) {
    rows.push(`${dot('--c-wave')}Wellen <b>${fmtNum(wx.wave, 1)} m</b>` + (wx.wper != null ? ` <span class="muted">· ${fmtNum(wx.wper, 0)} s</span>` : ''));
  }
  return rows.join('<br>');
}
