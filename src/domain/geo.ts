export const MS_TO_KN = 1.94384;
export const METERS_PER_NM = 1852;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const t = Math.PI / 180;
  const dLa = (lat2 - lat1) * t;
  const dLo = (lon2 - lon1) * t;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Beaufort-Stufe aus Knoten. */
export function beaufort(kn: number): number {
  const limits = [1, 4, 7, 11, 16, 22, 28, 34, 41, 48, 56, 64];
  let b = 0;
  for (let i = 0; i < limits.length; i++) if (kn >= limits[i]) b = i + 1;
  return b;
}

export function circularMean(degrees: Array<number | null>): number | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const d of degrees) {
    if (d == null || !isFinite(d)) continue;
    sx += Math.cos((d * Math.PI) / 180);
    sy += Math.sin((d * Math.PI) / 180);
    n++;
  }
  if (!n) return null;
  return ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
}

export function mean(values: Array<number | null>): number | null {
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (v == null || !isFinite(v)) continue;
    s += v;
    n++;
  }
  return n ? s / n : null;
}

export function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
