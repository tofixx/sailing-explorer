// Platzierung von Fotos auf dem Track (Konzept 3.2, F-102): rein, ohne DOM und Netz.
// Reihenfolge: GPS aus dem Foto (nur ≤ 2 km vom Track) → Zeitabgleich mit dem Track → manuell bzw. „ohne Ort“.
import { haversine } from './geo';

export type Placement = 'gps' | 'time' | 'manual' | 'none';
export const PLACEMENTS: readonly Placement[] = ['gps', 'time', 'manual', 'none'];
export const isPlacement = (v: unknown): v is Placement => typeof v === 'string' && (PLACEMENTS as readonly string[]).includes(v);

/** Foto-GPS weiter weg vom Track wird verworfen (Wohnadresse, Café an Land …). */
export const GPS_MAX_DIST_M = 2000;
/** Aufnahmezeit darf so weit vor dem Start bzw. nach dem Ende liegen. */
export const TIME_SLACK_MS = 10 * 60_000;
/** Zwischen zwei Trackpunkten wird nur bei kleinen Lücken interpoliert, sonst rastet das Foto am näheren Punkt ein. */
export const MAX_INTERP_GAP_MS = 30 * 60_000;
/** Zeitversatz: Kandidaten −12 h … +14 h in 15-min-Schritten (Konzept 3.2). */
export const OFFSET_MIN = -12 * 60;
export const OFFSET_MAX = 14 * 60;
export const OFFSET_STEP = 15;

export interface PlacePoint {
  lat: number;
  lon: number;
  /** ms UTC; null = Punkt ohne Zeitstempel */
  time: number | null;
}

/** Was die Platzierung von einem Foto braucht (aus src/domain/exif.ts). */
export interface PhotoClues {
  /** Wanduhrzeit (EXIF DateTimeOriginal, Felder als UTC gelesen) */
  localTime: number | null;
  /** OffsetTimeOriginal in Minuten; null = unbekannt, dann gilt der geschätzte bzw. eingestellte Versatz */
  offsetMin: number | null;
  lat: number | null;
  lon: number | null;
}

export interface PlacedPhoto {
  placement: Placement;
  lat: number | null;
  lon: number | null;
  /** Aufnahmezeit in UTC (ms) nach Zeitversatz; null = unbekannt */
  takenAt: number | null;
  /** Foto hatte GPS, aber zu weit vom Track (wird nicht übernommen) */
  gpsRejected: boolean;
}

/** Positionen werden auf 5 Nachkommastellen gerundet gespeichert (≈ 1 m). */
export const roundCoord = (v: number) => Math.round(v * 1e5) / 1e5;

/** Versatz auf das 15-min-Raster und den erlaubten Bereich bringen. */
export const clampOffset = (min: number) => Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, Math.round(min / OFFSET_STEP) * OFFSET_STEP));

/** Nächster Trackpunkt zu einer Koordinate (Index und Abstand in m); null bei leerem Track. */
export function nearestPoint(points: readonly PlacePoint[], lat: number, lon: number): { index: number; dist: number } | null {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = haversine(lat, lon, points[i].lat, points[i].lon);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best < 0 ? null : { index: best, dist: bd };
}

/** Punkte mit Zeit, nach Zeit sortiert (mehrere Tracks werden zusammengelegt). */
export function timedPoints(points: readonly PlacePoint[]): Array<PlacePoint & { time: number }> {
  return points.filter((p): p is PlacePoint & { time: number } => p.time !== null && Number.isFinite(p.time)).sort((a, b) => a.time - b.time);
}

/**
 * Position zur Zeit t (UTC): linear zwischen den Nachbarpunkten, bei großen Lücken der nähere Punkt,
 * bis TIME_SLACK_MS vor dem Start bzw. nach dem Ende der Endpunkt; sonst null.
 */
export function positionAt(timed: ReadonlyArray<PlacePoint & { time: number }>, t: number): { lat: number; lon: number } | null {
  if (!timed.length || !Number.isFinite(t)) return null;
  const first = timed[0];
  const last = timed[timed.length - 1];
  if (t < first.time - TIME_SLACK_MS || t > last.time + TIME_SLACK_MS) return null;
  if (t <= first.time) return { lat: first.lat, lon: first.lon };
  if (t >= last.time) return { lat: last.lat, lon: last.lon };
  let lo = 0;
  let hi = timed.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timed[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const a = timed[lo];
  const b = timed[hi];
  const gap = b.time - a.time;
  if (gap <= 0) return { lat: a.lat, lon: a.lon };
  if (gap > MAX_INTERP_GAP_MS) {
    const p = t - a.time <= b.time - t ? a : b;
    return { lat: p.lat, lon: p.lon };
  }
  const f = (t - a.time) / gap;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** Aufnahmezeit in UTC: eigener Versatz des Fotos vor dem allgemeinen. */
export function takenAtUtc(photo: Pick<PhotoClues, 'localTime' | 'offsetMin'>, offsetMin: number): number | null {
  if (photo.localTime === null) return null;
  return photo.localTime - (photo.offsetMin ?? offsetMin) * 60_000;
}

export type OffsetSource = 'photo' | 'gps' | 'time' | 'default';

export interface OffsetEstimate {
  /** Versatz für Fotos ohne eigene Zeitzone, in Minuten (Ortszeit − UTC) */
  offsetMin: number;
  /**
   * photo: alle Fotos mit Zeit bringen ihre Zone mit (Regler ohne Wirkung) · gps: aus Fotos mit GPS kalibriert ·
   * time: so gewählt, dass die meisten Fotos in die Trackzeit fallen · default: Browser-Zeitzone
   */
  source: OffsetSource;
}

/**
 * Zeitversatz für Fotos ohne OffsetTimeOriginal schätzen (Konzept 3.2):
 * 1. Kalibrierung über Fotos mit GPS nahe am Track (Aufnahmezeit gegen Trackzeit am GPS-Ort, Median);
 * 2. sonst der Versatz, bei dem die meisten Fotos in die Trackzeit (± 10 min) fallen, bei Gleichstand der
 *    dem Browser-Versatz nächste;
 * 3. sonst der Browser-Versatz (`fallbackMin`).
 */
export function estimateOffset(photos: readonly PhotoClues[], points: readonly PlacePoint[], fallbackMin: number): OffsetEstimate {
  const fallback = clampOffset(fallbackMin);
  const needs = photos.filter((p) => p.localTime !== null && p.offsetMin === null);
  if (!needs.length) return { offsetMin: fallback, source: photos.some((p) => p.localTime !== null) ? 'photo' : 'default' };
  const timed = timedPoints(points);
  if (!timed.length) return { offsetMin: fallback, source: 'default' };

  // 1. Kalibrierung: Wo das Foto laut GPS entstand, war der Track zu einer bekannten Zeit.
  const samples: number[] = [];
  for (const p of photos) {
    if (p.localTime === null || p.lat === null || p.lon === null) continue;
    const near = nearestPoint(timed, p.lat, p.lon);
    if (!near || near.dist > GPS_MAX_DIST_M) continue;
    samples.push((p.localTime - timed[near.index].time) / 60_000);
  }
  if (samples.length) {
    samples.sort((a, b) => a - b);
    return { offsetMin: clampOffset(samples[samples.length >> 1]), source: 'gps' };
  }

  // 2. Meiste Treffer in der Trackzeit.
  const t0 = timed[0].time - TIME_SLACK_MS;
  const t1 = timed[timed.length - 1].time + TIME_SLACK_MS;
  let best = fallback;
  let bestHits = 0;
  for (let off = OFFSET_MIN; off <= OFFSET_MAX; off += OFFSET_STEP) {
    let hits = 0;
    for (const p of needs) {
      const t = p.localTime! - off * 60_000;
      if (t >= t0 && t <= t1) hits++;
    }
    if (hits > bestHits || (hits === bestHits && hits > 0 && Math.abs(off - fallback) < Math.abs(best - fallback))) {
      best = off;
      bestHits = hits;
    }
  }
  return bestHits ? { offsetMin: best, source: 'time' } : { offsetMin: fallback, source: 'default' };
}

/** Platziert ein Foto: GPS (≤ 2 km vom Track) → Zeitabgleich → ohne Ort. */
export function placePhoto(photo: PhotoClues, points: readonly PlacePoint[], offsetMin: number, timed = timedPoints(points)): PlacedPhoto {
  const takenAt = takenAtUtc(photo, offsetMin);
  let gpsRejected = false;
  if (photo.lat !== null && photo.lon !== null) {
    const near = nearestPoint(points, photo.lat, photo.lon);
    if (near && near.dist <= GPS_MAX_DIST_M) return { placement: 'gps', lat: roundCoord(photo.lat), lon: roundCoord(photo.lon), takenAt, gpsRejected };
    gpsRejected = true;
  }
  if (takenAt !== null) {
    const pos = positionAt(timed, takenAt);
    if (pos) return { placement: 'time', lat: roundCoord(pos.lat), lon: roundCoord(pos.lon), takenAt, gpsRejected };
  }
  return { placement: 'none', lat: null, lon: null, takenAt, gpsRejected };
}

/** Ganzer Stapel mit gemeinsamem Versatz. */
export function placePhotos(photos: readonly PhotoClues[], points: readonly PlacePoint[], offsetMin: number): PlacedPhoto[] {
  const timed = timedPoints(points);
  return photos.map((p) => placePhoto(p, points, offsetMin, timed));
}

/** Manuelles Platzieren: Klick rastet auf den nächsten Trackpunkt ein (Position gerundet). */
export function snapToTrack(points: readonly PlacePoint[], lat: number, lon: number): { lat: number; lon: number; time: number | null } | null {
  const near = nearestPoint(points, lat, lon);
  if (!near) return null;
  const p = points[near.index];
  return { lat: roundCoord(p.lat), lon: roundCoord(p.lon), time: p.time };
}

/** Foto, das zeitlich am nächsten an t liegt (höchstens maxMs entfernt) – für „Hover auf den Track zeigt das Foto“. */
export function nearestPhotoByTime<T extends { takenAt: number | null }>(photos: readonly T[], t: number, maxMs = 15 * 60_000): T | null {
  let best: T | null = null;
  let bd = maxMs;
  for (const p of photos) {
    if (p.takenAt === null) continue;
    const d = Math.abs(p.takenAt - t);
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** „+2 h“, „−0:45 h“, „±0 h“ – Anzeige des Zeitversatzes. */
export function fmtOffset(min: number): string {
  if (min === 0) return '±0 h';
  const sign = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${m ? `${h}:${String(m).padStart(2, '0')}` : h} h`;
}
