import type { SupportTier } from '../domain/support';
import { parseWeatherData, type WeatherData } from '../domain/weather';
import type { Visibility } from '../domain/visibility';
import { readCapped } from './compress';

export type { Visibility };

export interface User {
  id: string;
  email: string;
}

/** Sichtbarkeit samt Schlüssel und Teilen-Pfad – Schlüssel und Link nur für Eigentümer (bzw. Boots-Admins), sonst null. */
export interface Linkable {
  visibility: Visibility;
  /** Schlüssel für „Nur mit Link“ (Altbestand: null) */
  shareKey?: string | null;
  /** Pfad zum Teilen, z. B. "/s/<id>" oder "/s/<id>/<key>" */
  link?: string | null;
}

export interface ShareMeta extends Linkable {
  id: string;
  title: string;
  summary: string;
  view: string;
  sizeBytes: number;
  trackCount: number;
  distNm: number;
  startedAt: number | null;
  hasImage: boolean;
  /** Löschtermin (ms) – nur für den Eigentümer gesetzt, sonst null */
  expiresAt?: number | null;
  createdAt: number;
  updatedAt: number;
  boat: { id: string; name: string } | null;
  isOwner: boolean;
}

/** Unterstützen-Konfiguration aus /api/config (null = auf diesem Server nicht eingerichtet). */
export interface SupportConfig {
  /** Stufen des Sliders, Beträge in Cent */
  tiers: SupportTier[];
}

export interface AppConfig {
  turnstileSiteKey: string;
  sharing: boolean;
  support?: SupportConfig | null;
  freeShares?: number;
}

/** Unterstützer-Status und Kontingent des angemeldeten Kontos. */
export interface SupportStatus {
  supporter: boolean;
  /** Ende des Unterstützer-Status (ms), auch wenn abgelaufen; null = nie unterstützt */
  supporterUntil: number | null;
  sharesUsed: number;
  sharesFree: number;
  sharesMax: number;
  /** belegter Speicher und Obergrenze in Bytes */
  bytesUsed: number;
  bytesMax: number;
}

export interface Profile extends Linkable {
  handle: string;
  displayName: string;
  bio: string;
  isSelf: boolean;
}

export interface Boat extends Linkable {
  id: string;
  name: string;
  boatType: string;
  lengthM: number | null;
  sailNumber: string;
  homePort: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  owner: { handle: string; displayName: string } | null;
  role: 'owner' | 'admin' | null;
}

export type BoatInput = Partial<Pick<Boat, 'name' | 'boatType' | 'lengthM' | 'sailNumber' | 'homePort' | 'description' | 'visibility'>> & {
  /** neuen Schlüssel erzeugen – alte Schlüssel-Links sind danach sofort ungültig */
  rotateKey?: boolean;
};

export type ProfileInput = Pick<Profile, 'handle' | 'displayName' | 'bio' | 'visibility'> & { rotateKey?: boolean };

export interface PageStats {
  voyages: number;
  distNm: number;
}

/** Entdecken: nur öffentliche Inhalte (siehe worker/discover.ts). */
export interface DiscoverVoyage {
  id: string;
  title: string;
  summary: string;
  distNm: number;
  startedAt: number | null;
  createdAt: number;
  trackCount: number;
  hasImage: boolean;
  boat: { id: string; name: string } | null;
  /** null: Profil nicht öffentlich – Autor:in erscheint ohne Link als „Segler:in“ */
  sailor: { handle: string; displayName: string } | null;
}

export interface DiscoverBoat {
  id: string;
  name: string;
  boatType: string;
  lengthM: number | null;
  homePort: string;
  createdAt: number;
  owner: { handle: string; displayName: string };
  stats: PageStats;
}

export interface DiscoverPerson {
  handle: string;
  displayName: string;
  bio: string;
  createdAt: number;
  stats: PageStats & { boats: number };
}

export interface DiscoverData {
  voyages: DiscoverVoyage[];
  boats: DiscoverBoat[];
  people: DiscoverPerson[];
}

export type SharePatch = Partial<Pick<ShareMeta, 'title' | 'visibility' | 'view'>> & {
  boatId?: string | null;
  /** neuen Schlüssel erzeugen – alte Schlüssel-Links sind danach sofort ungültig */
  rotateKey?: boolean;
};

export interface SharePayload {
  v: 1;
  tracks: Array<{ name: string; gpx: string }>;
  /** beim Teilen mitgespeicherte Wetterdaten (ältere Freigaben: fehlt) */
  weather?: WeatherData;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Lesezugriff auf ein „Nur mit Link“-Objekt: Schlüssel (aus /s/:id/:key usw.) als Header. */
const keyInit = (key?: string | null): RequestInit => (key ? { headers: { 'X-Share-Key': key } } : {});

/** Übersichtsbild einer Freigabe. Bilder können keine Header setzen – der Schlüssel geht als ?k= mit. */
export const shareImageUrl = (id: string, key?: string | null): string =>
  `/api/shares/${encodeURIComponent(id)}/image${key ? `?k=${encodeURIComponent(key)}` : ''}`;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'offline', 'Server nicht erreichbar.');
  }
  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get('Content-Type') || '').includes('application/json');
  // Ohne Backend (z. B. statisches Hosting) liefert /api/* die index.html.
  if (!isJson) throw new ApiError(res.status, 'no_backend', 'Teilen ist auf dieser Installation nicht verfügbar.');
  const body = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, body.error || 'error', body.message || `Fehler ${res.status}`);
  return body;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  config: () => call<AppConfig>('/api/config'),
  me: () => call<{ user: User | null }>('/api/auth/me'),
  support: () => call<SupportStatus>('/api/me/support'),
  /** Stripe-Checkout für eine der Stufen (Betrag in Cent) anlegen; liefert die URL der Bezahlseite. */
  supportCheckout: (amount: number) => call<{ url: string }>('/api/support/checkout', jsonInit('POST', { amount })),
  requestLink: (email: string, turnstile: string | null) =>
    call<{ ok: true; devLink?: string }>('/api/auth/request', jsonInit('POST', { email, turnstile })),
  peek: (token: string) => call<{ email: string }>('/api/auth/peek', jsonInit('POST', { token })),
  verify: (token: string) => call<{ user: User }>('/api/auth/verify', jsonInit('POST', { token })),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  deleteAccount: () => call<{ ok: true }>('/api/account', { method: 'DELETE' }),

  listShares: () => call<{ shares: ShareMeta[] }>('/api/shares'),
  shareMeta: (id: string, key?: string | null) => call<{ share: ShareMeta }>(`/api/shares/${encodeURIComponent(id)}`, keyInit(key)),
  updateShare: (id: string, patch: SharePatch) =>
    call<{ share: ShareMeta }>(`/api/shares/${encodeURIComponent(id)}`, jsonInit('PATCH', patch)),
  putShareImage: (id: string, image: Blob) =>
    call<void>(`/api/shares/${encodeURIComponent(id)}/image`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: image }),
  deleteShare: (id: string) => call<void>(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createShare: (
    gz: Uint8Array<ArrayBuffer>,
    meta: { title: string; summary: string; view: string; trackCount: number; visibility: Visibility; boatId: string | null; distNm: number; startedAt: number | null },
  ) =>
    call<{ share: ShareMeta }>('/api/shares', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/gzip',
        'X-Share-Title': encodeURIComponent(meta.title),
        'X-Share-Summary': encodeURIComponent(meta.summary),
        'X-Share-View': encodeURIComponent(meta.view),
        'X-Share-Tracks': String(meta.trackCount),
        'X-Share-Visibility': meta.visibility,
        'X-Share-Distance': meta.distNm.toFixed(2),
        ...(meta.startedAt ? { 'X-Share-Started': String(meta.startedAt) } : {}),
        ...(meta.boatId ? { 'X-Share-Boat': meta.boatId } : {}),
      },
      body: gz,
    }),

  myProfile: () => call<{ profile: Profile; exists: boolean }>('/api/me/profile'),
  saveProfile: (p: ProfileInput) => call<{ profile: Profile }>('/api/me/profile', jsonInit('PUT', p)),
  profile: (handle: string, key?: string | null) =>
    call<{ profile: Profile; boats: Boat[]; stats: PageStats; voyages: ShareMeta[] }>(`/api/profiles/${encodeURIComponent(handle)}`, keyInit(key)),

  myBoats: () => call<{ boats: Boat[] }>('/api/boats'),
  createBoat: (b: BoatInput) => call<{ boat: Boat }>('/api/boats', jsonInit('POST', b)),
  updateBoat: (id: string, b: BoatInput) => call<{ boat: Boat }>(`/api/boats/${encodeURIComponent(id)}`, jsonInit('PATCH', b)),
  deleteBoat: (id: string) => call<void>(`/api/boats/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  boat: (id: string, key?: string | null) =>
    call<{ boat: Boat; stats: PageStats; voyages: ShareMeta[] }>(`/api/boats/${encodeURIComponent(id)}`, keyInit(key)),

  discover: (limit: number) => call<DiscoverData>(`/api/discover?limit=${limit}`),

  /** Lädt den Payload; der Browser entpackt gzip, wir begrenzen die Größe. */
  async shareData(id: string, key?: string | null): Promise<SharePayload> {
    const res = await fetch(`/api/shares/${encodeURIComponent(id)}/data`, { credentials: 'same-origin', ...keyInit(key) });
    if (!res.ok || !res.body) throw new ApiError(res.status, 'not_found', 'Diese Freigabe gibt es nicht (mehr).');
    const parsed = JSON.parse(await readCapped(res.body)) as unknown;
    return validatePayload(parsed);
  },
};

/** Fremde Daten: Struktur prüfen, bevor sie weiterverarbeitet werden. */
export function validatePayload(input: unknown): SharePayload {
  const p = input as Partial<SharePayload> | null;
  if (!p || p.v !== 1 || !Array.isArray(p.tracks) || p.tracks.length < 1 || p.tracks.length > 20) {
    throw new Error('Ungültiges Freigabe-Format');
  }
  for (const t of p.tracks) {
    if (!t || typeof t.name !== 'string' || typeof t.gpx !== 'string') throw new Error('Ungültiges Freigabe-Format');
  }
  // Ungültiges Wetter verwirft nur das Wetter, nicht die Freigabe – die App lädt dann selbst nach.
  const weather = p.weather === undefined ? null : parseWeatherData(p.weather);
  return { v: 1, tracks: p.tracks as SharePayload['tracks'], ...(weather ? { weather } : {}) };
}
