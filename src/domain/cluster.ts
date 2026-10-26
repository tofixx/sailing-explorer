// Einfache Raster-Clusterung in Bildschirm-Pixeln (Konzept 3.3): bei ≤ 100 Fotos pro Törn reicht das, ohne Bibliothek.
// Rein, ohne DOM – die Karte projiziert vorher in Pixel der aktuellen Zoomstufe.

export interface ClusterInput<T> {
  item: T;
  x: number;
  y: number;
}

export interface Cluster<T> {
  items: T[];
  /** Schwerpunkt in Pixeln */
  x: number;
  y: number;
}

/**
 * Fasst Punkte zusammen, die in dieselbe Rasterzelle (`cell` px) fallen; danach werden Cluster, deren Schwerpunkte
 * näher als `cell` liegen, noch einmal verschmolzen (Zellgrenzen trennen sonst nahe Nachbarn). Reihenfolge stabil.
 */
export function gridCluster<T>(points: ReadonlyArray<ClusterInput<T>>, cell: number): Cluster<T>[] {
  const cells = new Map<string, Cluster<T>>();
  for (const p of points) {
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    const c = cells.get(key);
    if (c) {
      const n = c.items.length;
      c.x = (c.x * n + p.x) / (n + 1);
      c.y = (c.y * n + p.y) / (n + 1);
      c.items.push(p.item);
    } else cells.set(key, { items: [p.item], x: p.x, y: p.y });
  }
  const out: Cluster<T>[] = [];
  for (const c of cells.values()) {
    const near = out.find((o) => (o.x - c.x) ** 2 + (o.y - c.y) ** 2 < cell * cell);
    if (!near) {
      out.push(c);
      continue;
    }
    const a = near.items.length;
    const b = c.items.length;
    near.x = (near.x * a + c.x * b) / (a + b);
    near.y = (near.y * a + c.y * b) / (a + b);
    near.items.push(...c.items);
  }
  return out;
}
