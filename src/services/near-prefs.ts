// Gewählter Stream-Modus, Umkreis und grober Standort – nur auf diesem Gerät (localStorage), nie auf dem Server (F-342).
import { DEFAULT_RADIUS, isNearRadius, isStreamMode, parseCenter, roundCoord, type LatLon, type NearRadius, type StreamMode } from '../domain/near';

const KEY = 'sx-near';

export interface NearPrefs {
  mode: StreamMode;
  radius: NearRadius;
  /** auf 0,1° gerundeter Standort, nur nach Klick auf „Meine Umgebung“ */
  geo: LatLon | null;
}

export function readNearPrefs(): NearPrefs {
  const fallback: NearPrefs = { mode: 'near', radius: DEFAULT_RADIUS, geo: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<{ mode: unknown; radius: unknown; geo: { lat?: unknown; lon?: unknown } | null }> | null;
    if (!raw) return fallback;
    return {
      mode: isStreamMode(raw.mode) ? raw.mode : fallback.mode,
      radius: isNearRadius(raw.radius) ? (Number(raw.radius) as NearRadius) : fallback.radius,
      geo: raw.geo ? parseCenter(raw.geo.lat, raw.geo.lon) : null,
    };
  } catch {
    return fallback;
  }
}

export function writeNearPrefs(p: NearPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ohne Speicher gilt die Wahl nur bis zum Neuladen
  }
}

/** Standort einmalig vom Browser holen (Dialog des Browsers) und sofort grob runden. */
export function locate(): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('Dein Browser kann keinen Standort bestimmen.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: roundCoord(pos.coords.latitude), lon: roundCoord(pos.coords.longitude) }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Standort nicht freigegeben.' : 'Standort nicht ermittelbar.')),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  });
}
