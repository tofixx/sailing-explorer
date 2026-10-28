import type { SupportTier } from '../domain/support';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { parseWeatherData, type WeatherData } from '../domain/weather';
import type { PhotoVisibility, Visibility } from '../domain/visibility';
import type { Placement } from '../domain/photo-place';
import type { Tier, TierLimits } from '../domain/limits';
import { readCapped } from './compress';
import type { CommentsMode, NotifyMode, ReportKind, ReportReason } from '../domain/comment-text';
import type { Approvers, GroupKind, GroupNotifyMode, GroupRole, JoinMode, StreamItem, SuggestionReason } from '../domain/groups';
import type { CoverKind, CoverRef } from '../domain/cover';
import type { HarborRef } from '../domain/harbors';
import type { ReactionKind, ReactionSubject, ReactionSummary } from '../domain/reactions';

export type { Visibility };

export interface User {
  id: string;
  email: string;
  /** Plattform-Admin (Konzept 18.1) – nur aus /api/auth/me */
  admin?: boolean;
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
  /** nur in der Einzelansicht (F-228): Profil des Eigentümers, falls sichtbar */
  sailor?: { handle: string; displayName: string } | null;
  /** nur in der Einzelansicht (F-228): Vereine/Teams, in denen der Törn erschienen ist und die der Betrachter sehen darf */
  groups?: Array<{ slug: string; name: string; kind: string }>;
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
  /** Grenze der aktuellen Stufe (kostenlos = sharesFree) */
  sharesMax: number;
  /** belegter Speicher (Tracks + Übersichtsbilder) und Obergrenze der aktuellen Stufe in Bytes */
  bytesUsed: number;
  bytesMax: number;
  // ---- Kontingente (Phase B)
  /** Boote als Eigner und Grenze der aktuellen Stufe */
  boatsUsed?: number;
  boatsMax?: number;
  /** Grenzen beider Stufen */
  limits?: Record<Tier, TierLimits>;
  /** Notbremse: neue Törns gerade pausiert */
  storagePaused?: boolean;
  // ---- Fotos (Phase C)
  /** Fotos im Konto */
  photosUsed?: number;
  /** Fotos pro Törn in der aktuellen Stufe (kostenlos 0) */
  photosMax?: number;
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
  /** Hafen (Konzept 12.2) – fehlt bei älteren Servern */
  harbor?: HarborRef | null;
  description: string;
  /** frei gewählter Eigner (Konzept 13.5); leer = Konto des Eigners – fehlt bei älteren Servern */
  ownerLabel?: string;
  createdAt: number;
  updatedAt: number;
  owner: { handle: string; displayName: string } | null;
  role: 'owner' | 'admin' | null;
}

export type BoatInput = Partial<Pick<Boat, 'name' | 'boatType' | 'lengthM' | 'sailNumber' | 'homePort' | 'description' | 'ownerLabel' | 'visibility'>> & {
  /** Hafen (Konzept 12.2): ID, null = keiner; hat Vorrang vor homePort */
  harborId?: string | null;
  /** neuen Schlüssel erzeugen – alte Schlüssel-Links sind danach sofort ungültig */
  rotateKey?: boolean;
};

/** Offene Einladung (nur für den Eigentümer des Ziels); das Token selbst gibt es nur beim Erzeugen. */
export interface PendingInvite {
  id: string;
  /** die selbst eingegebene Adresse; null bei Profilnamen und Einladungslinks */
  email: string | null;
  /** über den Profilnamen eingeladenes Konto */
  invitee: { handle: string; displayName: string } | null;
  usesLeft: number;
  createdAt: number;
  expiresAt: number;
}

export interface BoatAdmin {
  id: string;
  /** selbst gewählter Name oder Spaßname – nie die E-Mail-Adresse */
  displayName: string;
  /** nur bei öffentlichem Profil */
  handle: string | null;
  isSelf: boolean;
  createdAt: number;
}

export interface BoatAdmins {
  role: 'owner' | 'admin';
  admins: BoatAdmin[];
  invites: PendingInvite[];
}

export interface CrewMember {
  /** nur für den Eigentümer (zum Entfernen) */
  id: string | null;
  handle: string | null;
  displayName: string;
}

/** Crew eines Törns – für Besucher nur bei öffentlichen Törns, namentlich nur mit öffentlichem Profil (Konzept 10.6). */
export interface Crew {
  members: CrewMember[];
  /** Mitglieder ohne öffentliches Profil (nur gezählt) */
  others: number;
  /** angemeldetes Konto ist Eigentümer des Törns (sieht alle, verwaltet) */
  isOwner: boolean;
  /** angemeldetes Konto ist selbst in der Crew */
  isCrew: boolean;
  invites: PendingInvite[];
}

export type InviteKind = 'boat_admin' | 'crew' | 'group' | 'friend';

export interface InvitePeek {
  kind: InviteKind;
  /** nur bei Gruppen: Verein oder Team */
  groupKind?: GroupKind;
  target: string | null;
  inviter: string | null;
  /** an eine E-Mail-Adresse gebunden (welche, verrät der Server nicht) */
  bound: boolean;
  expiresAt: number;
  /** null: nicht angemeldet bzw. nicht an eine Adresse gebunden */
  emailMatches: boolean | null;
  isOwner: boolean;
  alreadyMember: boolean;
}

export interface InviteAccepted {
  kind: InviteKind;
  /** Boot: Bootsseite; Crew: Törn nur, wenn er öffentlich ist */
  path: string | null;
  target: string | null;
  already: boolean;
  /** Gruppe: Annahme wurde zur Beitrittsanfrage (Konzept 14.1) */
  requested?: boolean;
  groupKind?: GroupKind;
}

/** Empfänger einer Einladung: Adresse (neue wie bestehende Konten) oder Profilname eines bestehenden Kontos. */
export type InviteTo = { email: string } | { handle: string };

/** Offene Einladung an mich (Posteingang im Konto). */
export interface MyInvite {
  id: string;
  kind: InviteKind;
  target: string | null;
  /** nur bei Gruppen */
  groupKind?: 'club' | 'team';
  inviter: string;
  expiresAt: number;
}

export interface InviteCreated {
  invite: PendingInvite;
  /** Einladungslink – nur bei Crew-Links ohne Adresse und nur in dieser Antwort */
  link?: string;
  devLink?: string;
}

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
  /** Titelbild (Konzept 13.2) – null ohne, fehlt bei älteren Servern */
  cover?: CoverRef | null;
}

export interface DiscoverPerson {
  handle: string;
  displayName: string;
  bio: string;
  createdAt: number;
  stats: PageStats & { boats: number };
  cover?: CoverRef | null;
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

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  config: () => call<AppConfig>('/api/config'),
  me: () => call<{ user: User | null; admin?: boolean }>('/api/auth/me'),
  support: () => call<SupportStatus>('/api/me/support'),
  /** Stripe-Checkout für eine der Stufen (Betrag in Cent) anlegen; liefert die URL der Bezahlseite. */
  supportCheckout: (amount: number) => call<{ url: string }>('/api/support/checkout', jsonInit('POST', { amount })),
  requestLink: (email: string, turnstile: string | null) =>
    call<{ ok: true; devLink?: string; devCode?: string }>('/api/auth/request', jsonInit('POST', { email, turnstile })),
  /** Anmelden mit dem Code aus der Mail (Konzept 14.6) */
  verifyCode: (email: string, code: string) => call<{ user: User }>('/api/auth/code', jsonInit('POST', { email, code })),
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
    call<{ profile: Profile; boats: Boat[]; stats: PageStats; voyages: ShareMeta[]; crewVoyages?: ShareMeta[]; social?: FollowStats; home?: PublicHome } & PageMedia>(`/api/profiles/${encodeURIComponent(handle)}`, keyInit(key)),

  myBoats: () => call<{ boats: Boat[] }>('/api/boats'),
  createBoat: (b: BoatInput) => call<{ boat: Boat }>('/api/boats', jsonInit('POST', b)),
  updateBoat: (id: string, b: BoatInput) => call<{ boat: Boat }>(`/api/boats/${encodeURIComponent(id)}`, jsonInit('PATCH', b)),
  deleteBoat: (id: string) => call<void>(`/api/boats/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  boat: (id: string, key?: string | null) =>
    call<{ boat: Boat; stats: PageStats; voyages: ShareMeta[]; social?: FollowStats; clubs?: GroupRef[] } & PageMedia>(`/api/boats/${encodeURIComponent(id)}`, keyInit(key)),

  boatAdmins: (id: string) => call<BoatAdmins>(`/api/boats/${encodeURIComponent(id)}/admins`),
  inviteBoatAdmin: (id: string, to: InviteTo) => call<InviteCreated>(`/api/boats/${encodeURIComponent(id)}/invites`, jsonInit('POST', to)),
  /** userId 'me' = selbst verlassen */
  removeBoatAdmin: (id: string, userId: string) =>
    call<void>(`/api/boats/${encodeURIComponent(id)}/admins/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  crew: (shareId: string, key?: string | null) => call<Crew>(`/api/shares/${encodeURIComponent(shareId)}/crew`, keyInit(key)),
  /** to null = Einladungslink */
  inviteCrew: (shareId: string, to: InviteTo | null) =>
    call<InviteCreated>(`/api/shares/${encodeURIComponent(shareId)}/invites`, jsonInit('POST', to ?? {})),
  /** userId 'me' = sich selbst entfernen */
  removeCrew: (shareId: string, userId: string) =>
    call<void>(`/api/shares/${encodeURIComponent(shareId)}/crew/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  revokeInvite: (id: string) => call<void>(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  peekInvite: (token: string) => call<InvitePeek>('/api/invites/peek', jsonInit('POST', { token })),
  acceptInvite: (token: string) => call<InviteAccepted>('/api/invites/accept', jsonInit('POST', { token })),
  myInvites: () => call<{ invites: MyInvite[] }>('/api/me/invites'),
  acceptMyInvite: (id: string) => call<InviteAccepted>(`/api/me/invites/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  declineMyInvite: (id: string) => call<void>(`/api/me/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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

// ================================================================ Kommentare & Melden (Phase D)
// Eigener Block (Konzept 4, worker/comments.ts, worker/reports.ts). Ergänzt bestehende Typen per Declaration Merging.

export interface ShareMeta {
  /** Kommentare: on | off | hidden */
  commentsMode?: CommentsMode;
  /** nur für den Eigentümer: bis zur Prüfung ausgeblendet (Meldung) */
  hiddenAt?: number | null;
}
export interface Profile {
  hiddenAt?: number | null;
}
export interface Boat {
  hiddenAt?: number | null;
}

export interface CommentItem {
  id: string;
  body: string;
  createdAt: number;
  /** Anzeigename; Profil-Link nur bei öffentlichem Profil */
  author: { displayName: string; handle: string | null };
  isMine: boolean;
  canDelete: boolean;
  /** ausgeblendet (Meldung) – sehen nur Autor:in und Admins */
  hidden: boolean;
}

/** Warum nicht kommentiert werden kann: nicht angemeldet, abgeschaltet, gesperrt, ohne Profil. */
export type CommentBlock = 'login' | 'off' | 'suspended' | 'profile' | null;

export interface CommentList {
  mode: CommentsMode;
  comments: CommentItem[];
  canComment: boolean;
  block: CommentBlock;
  isOwner: boolean;
  limits: { maxLength: number; maxLinks: number };
}

export interface AccountSettings {
  notifyComments: NotifyMode;
  /** wöchentliche Sammelmail aus Vereinen und Teams (fehlt bei älteren Servern) */
  notifyGroups?: GroupNotifyMode;
  suspended: boolean;
  hasProfile: boolean;
  isAdmin: boolean;
}

export interface ReportInput {
  kind: ReportKind;
  /** bei Profilen der Profilname, sonst die ID */
  id: string;
  reason: ReportReason;
  note: string;
}

export interface AdminReport {
  /** eine der Meldungen – die Entscheidung gilt für alle offenen Meldungen zum selben Ziel */
  id: string;
  kind: ReportKind;
  targetId: string;
  count: number;
  reporters: number;
  firstAt: number;
  lastAt: number;
  reasons: Partial<Record<ReportReason, number>>;
  notes: Array<{ reason: ReportReason; note: string; createdAt: number }>;
  /** null: das Ziel gibt es nicht mehr */
  target: {
    title: string;
    text: string;
    path: string;
    /** Vorschaubild (nur bei Fotos) */
    imagePath?: string;
    visibility: Visibility;
    hiddenAt: number | null;
    owner: { id: string; displayName: string; suspended: boolean };
  } | null;
}

export type AdminAction = 'keep' | 'hide' | 'delete';

export const communityApi = {
  comments: (shareId: string, key?: string | null) => call<CommentList>(`/api/shares/${encodeURIComponent(shareId)}/comments`, keyInit(key)),
  postComment: (shareId: string, body: string, key?: string | null) =>
    call<{ comment: CommentItem }>(`/api/shares/${encodeURIComponent(shareId)}/comments`, {
      ...jsonInit('POST', { body }),
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Share-Key': key } : {}) },
    }),
  deleteComment: (id: string) => call<void>(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setCommentsMode: (shareId: string, commentsMode: CommentsMode) =>
    call<{ share: ShareMeta }>(`/api/shares/${encodeURIComponent(shareId)}`, jsonInit('PATCH', { commentsMode })),
  settings: () => call<AccountSettings>('/api/me/settings'),
  saveSettings: (s: { notifyComments?: NotifyMode; notifyGroups?: GroupNotifyMode }) => call<AccountSettings>('/api/me/settings', jsonInit('PATCH', s)),
  report: (r: ReportInput, key?: string | null) =>
    call<{ ok: true; already: boolean }>('/api/reports', {
      ...jsonInit('POST', r),
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Share-Key': key } : {}) },
    }),
  reportInfo: () => call<{ contact: string | null; reasons: ReportReason[] }>('/api/reports/info'),
  adminReports: () => call<{ reports: AdminReport[] }>('/api/admin/reports'),
  decideReport: (id: string, action: AdminAction) => call<{ ok: true }>(`/api/admin/reports/${encodeURIComponent(id)}`, jsonInit('POST', { action })),
  suspendUser: (userId: string, suspended: boolean) =>
    call<{ suspended: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/suspend`, jsonInit('POST', { suspended })),
};

// ---------------------------------------------------------------- Fotos (Phase C, Konzept 3 und 6.3)

/** Foto wie vom Server geliefert (worker/photos.ts, photoShape). */
export interface Photo {
  id: string;
  caption: string;
  /** Aufnahmezeit UTC (ms) nach Zeitversatz; null = unbekannt */
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
  placement: Placement;
  width: number;
  height: number;
  createdAt: number;
  /** min(Foto, Törn) */
  effectiveVisibility: Visibility;
  /** eigene Stufe – nur für den Eigentümer, sonst null */
  visibility: PhotoVisibility | null;
  bytes: number | null;
  /** per Meldung ausgeblendet (nur der Eigentümer erfährt es) */
  hidden: boolean;
}

/** Darf der Eigentümer gerade Fotos hinzufügen? (nur für Eigentümer, sonst null) */
export interface PhotoUploadState {
  allowed: boolean;
  /** supporter_required (E3) · quota (100 pro Törn) · storage_full · storage_paused */
  reason: 'supporter_required' | 'quota' | 'storage_full' | 'storage_paused' | null;
  supporter: boolean;
  used: number;
  max: number;
  bytesLeft: number;
  supportOffered?: boolean;
}

export interface PhotoList {
  photos: Photo[];
  upload: PhotoUploadState | null;
}

export interface PhotoMeta {
  caption: string;
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
  placement: Placement;
  visibility: PhotoVisibility;
}

export type PhotoPatch = Partial<Pick<PhotoMeta, 'caption' | 'visibility' | 'lat' | 'lon' | 'placement' | 'takenAt'>>;

/** Bilddaten eines Fotos (t = Vorschau, f = Vollbild). Bilder können keine Header setzen – der Schlüssel geht als ?k= mit. */
export const photoImageUrl = (id: string, size: 't' | 'f', key?: string | null): string =>
  `/api/photos/${encodeURIComponent(id)}?s=${size}${key ? `&k=${encodeURIComponent(key)}` : ''}`;

/**
 * Foto hochladen: Body = Vorschaubild ‖ Vollbild, Länge der Vorschau und Angaben als Header. Per XHR, weil nur so der
 * Upload-Fortschritt messbar ist (fetch kennt keinen Upload-Fortschritt).
 */
function uploadPhotoXhr(shareId: string, thumb: Blob, full: Blob, meta: PhotoMeta, onProgress?: (fraction: number) => void): Promise<{ photo: Photo }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/shares/${encodeURIComponent(shareId)}/photos`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Photo-Thumb-Length', String(thumb.size));
    xhr.setRequestHeader('X-Photo-Meta', encodeURIComponent(JSON.stringify(meta)));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'offline', 'Server nicht erreichbar.'));
    xhr.onload = () => {
      let body: { photo?: Photo; error?: string; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        return reject(new ApiError(xhr.status, 'no_backend', 'Fotos sind auf dieser Installation nicht verfügbar.'));
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.photo) resolve({ photo: body.photo });
      else reject(new ApiError(xhr.status, body.error || 'error', body.message || `Fehler ${xhr.status}`));
    };
    xhr.send(new Blob([thumb, full]));
  });
}

export const photoApi = {
  list: (shareId: string, key?: string | null) => call<PhotoList>(`/api/shares/${encodeURIComponent(shareId)}/photos`, keyInit(key)),
  upload: uploadPhotoXhr,
  update: (id: string, patch: PhotoPatch) => call<{ photo: Photo }>(`/api/photos/${encodeURIComponent(id)}`, jsonInit('PATCH', patch)),
  remove: (id: string) => call<void>(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ================================================================ Vereine, Teams, Folgen, Neuigkeiten (Konzept 11)

export type { StreamItem };

export interface GroupInfo extends Linkable {
  id: string;
  kind: GroupKind;
  slug: string;
  name: string;
  description: string;
  homePort: string;
  /** Hafen (Konzept 13.3) – fehlt bei älteren Servern */
  harbor?: HarborRef | null;
  joinMode: JoinMode;
  /** wer Anfragen bestätigt (Konzept 14.1) – fehlt bei älteren Servern */
  approveBy?: Approvers;
  role: GroupRole | null;
  /** nur für Eigner und Admins: bis zur Prüfung ausgeblendet */
  hiddenAt?: number | null;
  createdAt: number;
}

export interface GroupRef {
  slug: string;
  name: string;
  kind: GroupKind;
}

export interface GroupMember {
  /** nur für Eigner und Admins (zum Verwalten) */
  id: string | null;
  handle: string | null;
  displayName: string;
  role: GroupRole;
  isSelf: boolean;
}

export interface GroupBoat {
  id: string;
  name: string;
  boatType: string;
  lengthM: number | null;
  homePort: string;
  mine: boolean;
  canRemove: boolean;
  public: boolean;
}

export interface FollowStats {
  followers: number;
  /** nur bei Profilen */
  following?: number;
  isFollowing: boolean;
}

export interface GroupRequest {
  userId: string;
  displayName: string;
  handle: string | null;
  message: string;
  createdAt: number;
}

export interface GroupPageData {
  group: GroupInfo;
  parent: GroupRef | null;
  teams: GroupRef[];
  stats: { members: number; boats: number; voyages: number; distNm: number; seasonNm: number };
  members: GroupMember[];
  others: number;
  boats: GroupBoat[];
  social: FollowStats;
  membership: { role: GroupRole | null; requested: boolean; canRequest: boolean; canJoin?: boolean; canInvite?: boolean; canApprove?: boolean };
  /** Titelbild samt Ausschnitt und Galerie (Konzept 13) – fehlen bei älteren Servern */
  cover?: string | null;
  coverY?: number;
  photos?: GalleryPhoto[];
  requests?: GroupRequest[];
  invites?: PendingInvite[];
}

export interface MyGroup extends GroupInfo {
  members: number;
}

export interface StreamPage {
  items: StreamItem[];
  cursor: string | null;
  /** nur im persönlichen Stream */
  hasGroups?: boolean;
  /** nur im persönlichen Stream: Stand der Seite (ms) – bis hierhin gilt er nach dem Anzeigen als gelesen (F-222) */
  at?: number;
  /** nur im persönlichen Stream: Heimatverein und Heimathafen (Konzept 12.4) */
  home?: { club: { slug: string; name: string } | null; harbor: { slug: string; name: string } | null };
}

export interface Suggestion {
  handle: string;
  displayName: string;
  reason: SuggestionReason;
  reasonText: string;
}

export interface DiscoverGroup {
  /** fehlt bei älteren Servern */
  id?: string;
  /** Beitritt (Konzept 14.1) – fehlt bei älteren Servern */
  joinMode?: JoinMode;
  slug: string;
  name: string;
  kind: GroupKind;
  homePort: string;
  description: string;
  createdAt: number;
  members: number;
  cover?: CoverRef | null;
}

export interface DiscoverData {
  /** Vereine und Teams – fehlt bei älteren Servern */
  groups?: DiscoverGroup[];
}

export type GroupInput = Partial<Pick<GroupInfo, 'name' | 'slug' | 'description' | 'homePort' | 'visibility' | 'joinMode' | 'approveBy'>> & {
  kind?: GroupKind;
  /** Hafen (Konzept 13.3): ID, null = keiner; hat Vorrang vor homePort */
  harborId?: string | null;
  parentId?: string | null;
  rotateKey?: boolean;
};

export type FollowKind = 'user' | 'boat' | 'group' | 'harbor';

const gid = (id: string) => encodeURIComponent(id);

export const groupApi = {
  mine: () => call<{ groups: MyGroup[]; requests: Array<GroupRef & { createdAt: number }> }>('/api/groups'),
  create: (g: GroupInput) => call<{ group: GroupInfo }>('/api/groups', jsonInit('POST', g)),
  bySlug: (slug: string, key?: string | null) => call<GroupPageData>(`/api/groups/slug/${encodeURIComponent(slug)}`, keyInit(key)),
  get: (id: string, key?: string | null) => call<GroupPageData>(`/api/groups/${gid(id)}`, keyInit(key)),
  update: (id: string, g: GroupInput) => call<{ group: GroupInfo }>(`/api/groups/${gid(id)}`, jsonInit('PATCH', g)),
  remove: (id: string) => call<void>(`/api/groups/${gid(id)}`, { method: 'DELETE' }),
  setRole: (id: string, userId: string, role: 'admin' | 'member') => call<{ role: string }>(`/api/groups/${gid(id)}/members/${gid(userId)}`, jsonInit('PATCH', { role })),
  /** userId 'me' = austreten */
  removeMember: (id: string, userId: string) => call<void>(`/api/groups/${gid(id)}/members/${gid(userId)}`, { method: 'DELETE' }),
  invite: (id: string, email: string | null) => call<InviteCreated>(`/api/groups/${gid(id)}/invites`, jsonInit('POST', email ? { email } : {})),
  request: (id: string, message: string, key?: string | null) =>
    call<{ requested: boolean; already?: boolean; joined?: boolean }>(`/api/groups/${gid(id)}/requests`, {
      ...jsonInit('POST', { message }),
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Share-Key': key } : {}) },
    }),
  withdraw: (id: string) => call<void>(`/api/groups/${gid(id)}/requests/me`, { method: 'DELETE' }),
  decide: (id: string, userId: string, approve: boolean) => call<{ approved: boolean }>(`/api/groups/${gid(id)}/requests/${gid(userId)}`, jsonInit('POST', { approve })),
  addBoat: (id: string, boatId: string) => call<{ added: boolean }>(`/api/groups/${gid(id)}/boats`, jsonInit('POST', { boatId })),
  removeBoat: (id: string, boatId: string) => call<void>(`/api/groups/${gid(id)}/boats/${gid(boatId)}`, { method: 'DELETE' }),
  post: (id: string, body: string, link: string) => call<{ post: { id: string } }>(`/api/groups/${gid(id)}/posts`, jsonInit('POST', { body, link })),
  deletePost: (id: string) => call<void>(`/api/posts/${gid(id)}`, { method: 'DELETE' }),
  stream: (id: string, cursor?: string | null, key?: string | null) =>
    call<StreamPage>(`/api/groups/${gid(id)}/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, keyInit(key)),
  myStream: (cursor?: string | null) => call<StreamPage>(`/api/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  /** Community-Badge (F-221): neue Einträge seit dem Gelesen-Zeitpunkt, höchstens 99 (`more`: mehr) */
  unread: () => call<{ count: number; more: boolean }>('/api/stream/unread'),
  /** Stream bis `at` gelesen (F-222) */
  seen: (at?: number) => call<{ ok: true }>('/api/stream/seen', jsonInit('POST', { at })),
  suggestions: () => call<{ people: Suggestion[] }>('/api/me/suggestions'),
  follow: (kind: FollowKind, id: string, on: boolean) => call<FollowStats>(`/api/follows/${kind}/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' }),
};

// ================================================================ Verein, Hafen, Team und Reaktionen (Konzept 12)

export type { HarborRef, ReactionKind, ReactionSubject, ReactionSummary };

/** „Mein Verein“ und Heimathafen (eigene Sicht). */
export interface HomeInfo {
  club: { id: string; slug: string; name: string } | null;
  harbor: HarborRef | null;
  /** Hafen ausdrücklich gewählt (sonst aus den eigenen Booten) */
  harborExplicit: boolean;
  /** wählbare Vereine (nur GET) */
  clubs?: Array<{ id: string; slug: string; name: string }>;
}

/** Verein und Hafen auf einem öffentlichen Profil (nur, was öffentlich sein darf). */
export interface PublicHome {
  club: { slug: string; name: string } | null;
  harbor: { slug: string; name: string } | null;
}

export interface StreamFilters {
  harbors: Array<{ slug: string; name: string; boats: number }>;
  clubs: Array<{ slug: string; name: string; members: number }>;
}

export interface PublicStreamPage extends StreamPage {
  /** nur auf der ersten Seite */
  filters?: StreamFilters;
}

export type StreamFilter = { kind: 'harbor' | 'club'; slug: string } | null;

export interface HarborSearchHit extends HarborRef {
  boats: number;
}

export interface HarborPageData {
  harbor: HarborRef & { lat: number | null; lon: number | null; canEdit: boolean; hiddenAt?: number | null; createdAt: number };
  club: GroupRef | null;
  /** Vereine und Teams mit diesem Heimathafen (Konzept 13.3) – fehlt bei älteren Servern */
  groups?: GroupRef[];
  stats: { boats: number; voyages: number; distNm: number; seasonNm: number };
  boats: Array<{ id: string; name: string; boatType: string; lengthM: number | null; owner: { handle: string; displayName: string } | null }>;
  voyages: ShareMeta[];
  social: FollowStats;
  clubChoices: Array<{ id: string; slug: string; name: string }>;
  canClearClub: boolean;
}

export interface HarborPatch {
  name?: string;
  lat?: number | null;
  lon?: number | null;
  clubId?: string | null;
}

/** „Wer hat reagiert“ – Namen nur öffentlicher Profile, der Rest als Anzahl. */
export interface ReactionWho extends ReactionSummary {
  people: Array<{ handle: string; displayName: string; kind: ReactionKind }>;
  others: number;
}

const q = (params: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};

export const socialApi = {
  searchHarbors: (query: string) => call<{ harbors: HarborSearchHit[] }>(`/api/harbors${q({ q: query })}`),
  createHarbor: (name: string) => call<{ harbor: HarborRef; created: boolean }>('/api/harbors', jsonInit('POST', { name })),
  harbor: (slug: string) => call<HarborPageData>(`/api/harbors/slug/${encodeURIComponent(slug)}`),
  updateHarbor: (id: string, patch: HarborPatch) => call<{ harbor: HarborPageData['harbor'] }>(`/api/harbors/${encodeURIComponent(id)}`, jsonInit('PATCH', patch)),
  harborStream: (id: string, cursor?: string | null) => call<StreamPage>(`/api/harbors/${encodeURIComponent(id)}/stream${q({ cursor })}`),
  home: () => call<HomeInfo>('/api/me/home'),
  saveHome: (patch: { clubId?: string | null; harborId?: string | null }) => call<HomeInfo>('/api/me/home', jsonInit('PUT', patch)),
  publicStream: (cursor?: string | null, filter?: StreamFilter) =>
    call<PublicStreamPage>(`/api/stream/public${q({ cursor, harbor: filter?.kind === 'harbor' ? filter.slug : null, club: filter?.kind === 'club' ? filter.slug : null })}`),
  /** kind null = zurücknehmen; Schlüssel für „Nur mit Link“-Törns als X-Share-Key */
  react: (subject: ReactionSubject, id: string, kind: ReactionKind | null, key?: string | null) =>
    call<ReactionSummary>(`/api/reactions/${subject}/${encodeURIComponent(id)}`, {
      ...(kind ? jsonInit('PUT', { kind }) : { method: 'DELETE' }),
      headers: { ...(kind ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'X-Share-Key': key } : {}) },
    }),
  reactions: (subject: ReactionSubject, id: string, key?: string | null) => call<ReactionWho>(`/api/reactions/${subject}/${encodeURIComponent(id)}`, keyInit(key)),
};

// ================================================================ Titelbilder und Galerien (Konzept 13)

/** Foto eines öffentlichen Törns in der Galerie von Person, Boot oder Verein/Team. */
export interface GalleryPhoto {
  id: string;
  shareId: string;
  shareTitle: string;
  caption: string;
  takenAt: number | null;
  width: number;
  height: number;
}

/** Titelbild (Adresse inkl. Version, bei „Nur mit Link“ mit Schlüssel), sein Ausschnitt und Galerie einer Seite. */
export interface PageMedia {
  cover?: string | null;
  /** vertikale Fokus-Position in Prozent (src/domain/cover.ts) */
  coverY?: number;
  photos?: GalleryPhoto[];
}

export type { CoverKind, CoverRef };

export const coverApi = {
  put: (kind: CoverKind, id: string, image: Blob) =>
    call<{ cover: string; coverY: number }>(`/api/covers/${kind}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: image,
    }),
  /** nur den Ausschnitt ändern */
  focus: (kind: CoverKind, id: string, focusY: number) =>
    call<{ coverY: number }>(`/api/covers/${kind}/${encodeURIComponent(id)}`, jsonInit('PATCH', { focusY })),
  remove: (kind: CoverKind, id: string) => call<void>(`/api/covers/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ================================================================ Freunde einladen (Konzept 14.2)

export const friendApi = {
  /** ohne Adresse: Einladungslink (nur in dieser Antwort) */
  invite: (to: { email?: string; handle?: string }) => call<InviteCreated>('/api/invites', jsonInit('POST', to)),
};

// ================================================================ Passkeys (Konzept 14.7)

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Optionen kommen als JSON von @simplewebauthn/server; der Browser-Teil (@simplewebauthn/browser) nimmt sie direkt. */
export const passkeyApi = {
  loginOptions: () => call<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>('/api/auth/passkey/options', jsonInit('POST', {})),
  login: (challengeId: string, response: unknown) => call<{ user: User }>('/api/auth/passkey', jsonInit('POST', { challengeId, response })),
  list: () => call<{ passkeys: PasskeyInfo[] }>('/api/passkeys'),
  registerOptions: () => call<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>('/api/passkeys/options', jsonInit('POST', {})),
  register: (challengeId: string, response: unknown, name: string) => call<{ passkey: PasskeyInfo }>('/api/passkeys', jsonInit('POST', { challengeId, response, name })),
  remove: (id: string) => call<void>(`/api/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
