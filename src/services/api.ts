import { readCapped } from './compress';

export interface User {
  id: string;
  email: string;
}

export interface ShareMeta {
  id: string;
  title: string;
  summary: string;
  visibility: 'unlisted' | 'private';
  /** auf Profil- und Bootsseiten gelistet */
  listed: boolean;
  view: string;
  sizeBytes: number;
  trackCount: number;
  distNm: number;
  startedAt: number | null;
  hasImage: boolean;
  createdAt: number;
  updatedAt: number;
  boat: { id: string; name: string } | null;
  isOwner: boolean;
}

export type PublicVisibility = 'public' | 'private';

/** Öffentliche Payment-Links fürs Unterstützen (null = auf diesem Server nicht eingerichtet). */
export interface SupportLinks {
  coffee: string | null;
  beer: string | null;
}

export interface AppConfig {
  turnstileSiteKey: string;
  sharing: boolean;
  support?: SupportLinks | null;
  freeShares?: number;
}

/** Unterstützer-Status und Kontingent des angemeldeten Kontos. */
export interface SupportStatus {
  supporter: boolean;
  sharesUsed: number;
  sharesFree: number;
  sharesMax: number;
}

export interface Profile {
  handle: string;
  displayName: string;
  bio: string;
  visibility: PublicVisibility;
  isSelf: boolean;
}

export interface Boat {
  id: string;
  name: string;
  boatType: string;
  lengthM: number | null;
  sailNumber: string;
  homePort: string;
  description: string;
  visibility: PublicVisibility;
  createdAt: number;
  updatedAt: number;
  owner: { handle: string; displayName: string } | null;
  role: 'owner' | 'admin' | null;
}

export type BoatInput = Partial<Pick<Boat, 'name' | 'boatType' | 'lengthM' | 'sailNumber' | 'homePort' | 'description' | 'visibility'>>;

export interface PageStats {
  voyages: number;
  distNm: number;
}

export type SharePatch = Partial<Pick<ShareMeta, 'title' | 'visibility' | 'view' | 'listed'>> & { boatId?: string | null };

export interface SharePayload {
  v: 1;
  tracks: Array<{ name: string; gpx: string }>;
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
  requestLink: (email: string, turnstile: string | null) =>
    call<{ ok: true; devLink?: string }>('/api/auth/request', jsonInit('POST', { email, turnstile })),
  peek: (token: string) => call<{ email: string }>('/api/auth/peek', jsonInit('POST', { token })),
  verify: (token: string) => call<{ user: User }>('/api/auth/verify', jsonInit('POST', { token })),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  deleteAccount: () => call<{ ok: true }>('/api/account', { method: 'DELETE' }),

  listShares: () => call<{ shares: ShareMeta[] }>('/api/shares'),
  shareMeta: (id: string) => call<{ share: ShareMeta }>(`/api/shares/${encodeURIComponent(id)}`),
  updateShare: (id: string, patch: SharePatch) =>
    call<{ share: ShareMeta }>(`/api/shares/${encodeURIComponent(id)}`, jsonInit('PATCH', patch)),
  putShareImage: (id: string, image: Blob) =>
    call<void>(`/api/shares/${encodeURIComponent(id)}/image`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: image }),
  deleteShare: (id: string) => call<void>(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createShare: (
    gz: Uint8Array<ArrayBuffer>,
    meta: { title: string; summary: string; view: string; trackCount: number; visibility: string; listed: boolean; boatId: string | null; distNm: number; startedAt: number | null },
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
        'X-Share-Listed': meta.listed ? '1' : '0',
        'X-Share-Distance': meta.distNm.toFixed(2),
        ...(meta.startedAt ? { 'X-Share-Started': String(meta.startedAt) } : {}),
        ...(meta.boatId ? { 'X-Share-Boat': meta.boatId } : {}),
      },
      body: gz,
    }),

  myProfile: () => call<{ profile: Profile; exists: boolean }>('/api/me/profile'),
  saveProfile: (p: Pick<Profile, 'handle' | 'displayName' | 'bio' | 'visibility'>) => call<{ profile: Profile }>('/api/me/profile', jsonInit('PUT', p)),
  profile: (handle: string) =>
    call<{ profile: Profile; boats: Boat[]; stats: PageStats; voyages: ShareMeta[] }>(`/api/profiles/${encodeURIComponent(handle)}`),

  myBoats: () => call<{ boats: Boat[] }>('/api/boats'),
  createBoat: (b: BoatInput) => call<{ boat: Boat }>('/api/boats', jsonInit('POST', b)),
  updateBoat: (id: string, b: BoatInput) => call<{ boat: Boat }>(`/api/boats/${encodeURIComponent(id)}`, jsonInit('PATCH', b)),
  deleteBoat: (id: string) => call<void>(`/api/boats/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  boat: (id: string) => call<{ boat: Boat; stats: PageStats; voyages: ShareMeta[] }>(`/api/boats/${encodeURIComponent(id)}`),

  /** Lädt den Payload; der Browser entpackt gzip, wir begrenzen die Größe. */
  async shareData(id: string): Promise<SharePayload> {
    const res = await fetch(`/api/shares/${encodeURIComponent(id)}/data`, { credentials: 'same-origin' });
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
  return p as SharePayload;
}
