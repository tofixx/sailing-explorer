import { METERS_PER_NM, MS_TO_KN, haversine } from './geo';
import type { TrackPoint, TrackStats } from './types';

/** Zentrierter gleitender Mittelwert, ignoriert Lücken. */
export function smooth(values: Array<number | null>, half: number): Array<number | null> {
  const n = values.length;
  const out = new Array<number | null>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      const v = values[j];
      if (v != null && isFinite(v)) {
        acc += v;
        c++;
      }
    }
    out[i] = c ? acc / c : null;
  }
  return out;
}

/**
 * Berechnet Geschwindigkeiten und Kennzahlen und markiert GPS-Ausreißer (mutiert die Punkte).
 *
 * Ausreißer-Erkennung per Median + MAD der geglätteten Geschwindigkeit: GPS-Sprünge liegen weit
 * über der bootsspezifischen Streuung und werden verworfen; echte Surf-Spitzen bleiben erhalten.
 * Die Grenze skaliert automatisch mit dem Track (schnelleres Boot → größere Streuung).
 * Ausreißer-Punkte zählen auch nicht zur Distanz (L8, F-04): gemessen wird von gültigem zu gültigem Punkt.
 */
export function computeTrackStats(pts: TrackPoint[]): TrackStats {
  const n = pts.length;
  let movingS = 0;
  const raw = new Array<number | null>(n).fill(null);

  for (let i = 1; i < n; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    let sp: number | null = null;
    if (a.time != null && b.time != null) {
      const dt = (b.time - a.time) / 1000;
      if (dt > 0 && dt < 3600) {
        sp = (d / dt) * MS_TO_KN;
        if (d > 1) movingS += dt;
      }
    }
    b.speed = sp;
    raw[i] = sp != null && isFinite(sp) ? sp : null;
  }
  if (n > 1) {
    pts[0].speed = pts[1].speed;
    raw[0] = raw[1];
  }

  const sm = smooth(raw, 3);
  const sorted = sm.filter((v): v is number => v != null).sort((a, b) => a - b);
  const M = sorted.length ? sorted[sorted.length >> 1] : 0;
  const devs = sorted.map((v) => Math.abs(v - M)).sort((a, b) => a - b);
  const sigma = 1.4826 * (devs.length ? devs[devs.length >> 1] : 0);
  const cap = M + 4.5 * Math.max(sigma, 0.3);

  let maxSp = 0;
  let sumSp = 0;
  let nSp = 0;
  let nGlitch = 0;
  for (let i = 0; i < n; i++) {
    const s = raw[i];
    const ss = sm[i];
    const glitch = (ss != null && ss > cap) || (s != null && s > cap * 1.6 && s > M + 5);
    pts[i].glitch = glitch;
    pts[i].speedSmooth = ss != null && !glitch ? ss : null;
    if (s == null) continue;
    if (glitch) nGlitch++;
    else {
      sumSp += s;
      nSp++;
      if (ss != null && ss > maxSp) maxSp = ss;
    }
  }

  // Distanz ohne Ausreißer: Sprünge zu einem falschen Punkt und zurück fallen weg
  let dist = 0;
  let last: TrackPoint | null = null;
  for (const p of pts) {
    if (p.glitch) continue;
    if (last) dist += haversine(last.lat, last.lon, p.lat, p.lon);
    last = p;
  }

  const times = pts.map((p) => p.time).filter((t): t is number => t != null);
  return {
    distNm: dist / METERS_PER_NM,
    maxSpeed: maxSp,
    avgSpeed: nSp ? sumSp / nSp : 0,
    start: times[0] ?? null,
    end: times[times.length - 1] ?? null,
    movingH: movingS / 3600,
    nPts: n,
    hasTime: times.length > 0,
    nGlitch,
  };
}

/** Gültige (nicht als Ausreißer markierte) Geschwindigkeit. */
export function validSpeed(p: TrackPoint): number | null {
  return p.speed != null && isFinite(p.speed) && !p.glitch ? p.speed : null;
}
