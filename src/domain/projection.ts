// Web-Mercator-Hilfen für das Übersichtsbild (reine Rechnung, ohne DOM).

export const TILE_SIZE = 256;

/** Weltpixel bei Zoomstufe z. */
export function project(lat: number, lon: number, z: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

export interface Viewport {
  zoom: number;
  /** Weltpixel der linken oberen Bildecke */
  originX: number;
  originY: number;
}

/**
 * Größte ganzzahlige Zoomstufe, bei der die Ausdehnung in den Rahmen passt,
 * und der Bildausschnitt, der sie darin zentriert.
 */
export function fitBounds(
  b: { south: number; north: number; west: number; east: number },
  frame: { width: number; height: number; padding: number; offsetY?: number },
  maxZoom = 13,
): Viewport {
  const availW = frame.width - 2 * frame.padding;
  const availH = frame.height - 2 * frame.padding;
  let zoom = 1;
  for (let z = maxZoom; z >= 1; z--) {
    const nw = project(b.north, b.west, z);
    const se = project(b.south, b.east, z);
    if (se.x - nw.x <= availW && se.y - nw.y <= availH) {
      zoom = z;
      break;
    }
  }
  const nw = project(b.north, b.west, zoom);
  const se = project(b.south, b.east, zoom);
  const cx = (nw.x + se.x) / 2;
  const cy = (nw.y + se.y) / 2;
  return { zoom, originX: cx - frame.width / 2, originY: cy - frame.height / 2 + (frame.offsetY ?? 0) };
}

/** Kacheln, die den Ausschnitt abdecken. */
export function tilesFor(v: Viewport, width: number, height: number): Array<{ x: number; y: number; z: number; dx: number; dy: number }> {
  const n = 2 ** v.zoom;
  const out = [];
  const x0 = Math.floor(v.originX / TILE_SIZE);
  const y0 = Math.floor(v.originY / TILE_SIZE);
  const x1 = Math.floor((v.originX + width) / TILE_SIZE);
  const y1 = Math.floor((v.originY + height) / TILE_SIZE);
  for (let ty = y0; ty <= y1; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = x0; tx <= x1; tx++) {
      out.push({ x: ((tx % n) + n) % n, y: ty, z: v.zoom, dx: tx * TILE_SIZE - v.originX, dy: ty * TILE_SIZE - v.originY });
    }
  }
  return out;
}
