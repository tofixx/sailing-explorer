import L from 'leaflet';
import { BASE_MAPS, MAP_LANG, defaultBaseMap, type BaseMap } from '../domain/basemaps';

/**
 * Grundkarte (Kacheln aus `src/domain/basemaps.ts`, F-661): ohne eigene Wahl passend zu Farbschema und Sprache der
 * Beschriftung (MAP_LANG) – tagsüber deutsch beschriftet, nachts ohne Beschriftung – und folgt einem Wechsel des
 * Systemschemas. Eine Wahl im Kartenstil-Menü (F-660) gilt bis zum Neuladen, auch über einen Schemawechsel hinweg.
 * Keine eigene Steuerung auf der Karte – gewählt wird nur im Kartenstil-Menü (UX N1).
 */
export class BaseMapLayer {
  private tiles = new Map<string, L.TileLayer>();
  private current: BaseMap;
  private chosen = false;

  constructor(
    private map: L.Map,
    /** meldet jede geltende Grundkarte (Start, Wahl, Schemawechsel) */
    private onChange: (key: string) => void = () => {},
    scheme: MediaQueryList = matchMedia('(prefers-color-scheme: dark)'),
  ) {
    this.current = defaultBaseMap(MAP_LANG, scheme.matches);
    this.tile(this.current).addTo(map);
    onChange(this.current.key);
    scheme.addEventListener('change', () => {
      if (!this.chosen) this.show(defaultBaseMap(MAP_LANG, scheme.matches));
    });
  }

  /** Schlüssel der geltenden Grundkarte */
  get key(): string {
    return this.current.key;
  }

  /** Wahl im Menü; unbekannte Schlüssel ändern nichts. */
  set(key: string): void {
    const m = BASE_MAPS.find((b) => b.key === key);
    if (!m) return;
    this.chosen = true;
    this.show(m);
  }

  private tile(m: BaseMap): L.TileLayer {
    let t = this.tiles.get(m.key);
    if (!t) this.tiles.set(m.key, (t = L.tileLayer(m.url, { maxZoom: m.maxZoom, maxNativeZoom: m.maxNativeZoom, attribution: m.attribution })));
    return t;
  }

  private show(m: BaseMap): void {
    if (m !== this.current) {
      this.tile(this.current).remove();
      this.current = m;
      this.tile(m).addTo(this.map);
    }
    this.onChange(m.key);
  }
}
