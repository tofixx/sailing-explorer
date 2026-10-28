// Gewählter Stream-Modus, Umkreis und grober Standort – nur auf diesem Gerät (localStorage), nie auf dem Server (F-342).
import { DEFAULT_RADIUS, isNearRadius, isStreamMode, parseCenter, roundCoord, type LatLon, type NearRadius, type StreamMode } from '../domain/near';
import type { NearCenter } from './api';

const KEY = 'sx-near';

export interface NearPrefs {
  mode: StreamMode;
  radius: NearRadius;
  /** auf 0,1° gerundeter Standort, nur nach Klick auf „Meine Umgebung“ */
  geo: LatLon | null;
  /** Beitrittsmeldungen im Stream zeigen (F-350), Standard ja */
  joins: boolean;
}

export function readNearPrefs(): NearPrefs {
  const fallback: NearPrefs = { mode: 'near', radius: DEFAULT_RADIUS, geo: null, joins: true };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<{ mode: unknown; radius: unknown; geo: { lat?: unknown; lon?: unknown } | null; joins: unknown }> | null;
    if (!raw) return fallback;
    return {
      mode: isStreamMode(raw.mode) ? raw.mode : fallback.mode,
      radius: isNearRadius(raw.radius) ? (Number(raw.radius) as NearRadius) : fallback.radius,
      geo: raw.geo ? parseCenter(raw.geo.lat, raw.geo.lon) : null,
      joins: raw.joins !== false,
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

/**
 * Gerätestandort einmal vom Browser (Dialog des Browsers). `precise`: genau (Hafen-Position, F-345), sonst grob für
 * die Umgebung einer Person.
 */
export function currentPosition(precise = false): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('Dein Browser kann keinen Standort bestimmen.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Standort nicht freigegeben.' : 'Standort nicht ermittelbar.')),
      precise ? { enableHighAccuracy: true, timeout: 15_000 } : { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  });
}

/** Standort für die Umgebung (F-342): sofort grob gerundet. */
export async function locate(): Promise<LatLon> {
  const p = await currentPosition();
  return { lat: roundCoord(p.lat), lon: roundCoord(p.lon) };
}

/** Mittelpunkt der Umgebung (F-343, F-344): Standort dieses Geräts, sonst der Heimathafen – für Startseite und Entdecken. */
export function nearCenter(home: { slug: string; name: string } | null): { center: NearCenter; label: string; source: 'geo' | 'harbor' } | null {
  const geo = readNearPrefs().geo;
  if (geo) return { center: geo, label: 'deinen Standort', source: 'geo' };
  return home ? { center: { harbor: home.slug }, label: home.name, source: 'harbor' } : null;
}
