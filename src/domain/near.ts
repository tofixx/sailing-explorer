// Umgebung (F-340 … F-345): reine Regeln für Stream-Modus, Umkreis und Standort – ohne DOM und Netz, genutzt von
// Worker und Oberfläche.

/** Was die Startseite zeigt: alles Öffentliche, die Umgebung (Umkreis um einen Ort) oder nur eigene Mitgliedschaften. */
export const STREAM_MODES = ['near', 'all', 'mine'] as const;
export type StreamMode = (typeof STREAM_MODES)[number];
export const isStreamMode = (v: unknown): v is StreamMode => typeof v === 'string' && (STREAM_MODES as readonly string[]).includes(v);

/** Wählbare Umkreise in km; Standard 25 km. */
export const NEAR_RADII = [10, 25, 50, 100] as const;
export type NearRadius = (typeof NEAR_RADII)[number];
export const DEFAULT_RADIUS: NearRadius = 25;
export const isNearRadius = (v: unknown): v is NearRadius => (NEAR_RADII as readonly number[]).includes(Number(v));

/** Höchstens so viele Häfen bzw. Gruppen gehen in die Abfrage der Umgebung (nächste zuerst). */
export const NEAR_MAX_PLACES = 150;

/**
 * Standort einer Person grob machen, bevor er das Gerät verlässt: auf 0,1° gerundet (≈ 11 km Nord-Süd). Genauer wird
 * nichts gesendet, gecacht oder gespeichert – und der Umkreis beginnt bei 10 km.
 */
export const roundCoord = (x: number): number => Math.round(x * 10) / 10;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Gültige, gerundete Koordinaten aus Anfrage-Parametern – sonst null. */
export function parseCenter(lat: unknown, lon: unknown): LatLon | null {
  if (lat === null || lon === null || lat === undefined || lon === undefined || lat === '' || lon === '') return null;
  const a = Number(lat);
  const o = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  return { lat: roundCoord(a), lon: roundCoord(o) };
}

const R_EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Entfernung zweier Punkte in km (Haversine). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rechteck um den Umkreis – für die Vorauswahl per Index bzw. einfachem Vergleich in SQL. */
export function boundingBox(c: LatLon, km: number): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const dLat = km / 111.2;
  const dLon = km / (111.2 * Math.max(0.01, Math.cos(rad(c.lat))));
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLon: c.lon - dLon, maxLon: c.lon + dLon };
}

/** Orte im Umkreis, nächste zuerst, höchstens `max`. */
export function withinRadius<T extends LatLon>(center: LatLon, km: number, places: T[], max = NEAR_MAX_PLACES): Array<T & { km: number }> {
  return places
    .map((p) => ({ ...p, km: distanceKm(center, p) }))
    .filter((p) => p.km <= km)
    .sort((a, b) => a.km - b.km)
    .slice(0, max);
}

/** Anzeige der Entfernung: unter 1 km „< 1 km“, sonst gerundet. */
export const fmtKm = (km: number): string => (km < 1 ? '< 1 km' : `${Math.round(km)} km`);
