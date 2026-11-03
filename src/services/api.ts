import type { LogbookEntry } from '../domain/logbook-year';
import type { SupportTier } from '../domain/support';
import type { SeasonStats } from '../domain/season-stats';
import type { HeatData } from '../domain/heat';
import type { PollConfig, PollPeople, PollView } from '../domain/polls';
import type { ComposePostKind } from '../domain/posts';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { parseWeatherData, type WeatherData } from '../domain/weather';
import type { PhotoVisibility, Visibility } from '../domain/visibility';
import type { Placement } from '../domain/photo-place';
import type { Tier, TierLimits } from '../domain/limits';
import { readCapped } from './compress';
import type { CommentsMode, NotifyMode, ReportKind, ReportReason } from '../domain/comment-text';
import type { Audience, DayCard } from '../domain/large-groups';
import type { ShownDay } from './day-cards';
import type { Approvers, GroupKind, GroupNotifyMode, GroupRole, JoinMode, MembersVisible, ShareGroupChoice, StreamItem, SuggestionReason } from '../domain/groups';
import type { CoverKind, CoverRef } from '../domain/cover';
import type { HarborRef } from '../domain/harbors';
import type { ClaimKind, MyClaim } from '../domain/claims';
import type { MapStyleId } from '../domain/map-style';
import type { VoyageRole } from '../domain/crew-roles';
import type { ReactionKind, ReactionSubject, ReactionSummary } from '../domain/reactions';
import type { NotificationItem, NotificationKind, NotifyLevel, NotifyPrefs } from '../domain/notifications';
import type { DistSource, LatLon, LogState, Logbook, ShareSource } from '../domain/logbook';
import type { EventInput, EventView, RsvpStatus } from '../domain/events';
import { previewParam, type AttachableShare, type ChannelKind, type ComposeTarget, type GalleryQuota, type MyPost, type MyPostArea, type PostBy, type PostLink, type PostPhoto, type PostVisibility, type PreviewOptions, type ProfilePost, type ProfilePreview, type Reach } from '../domain/posts';

export type { Visibility };

export interface User {
  id: string;
  email: string;
  /** Profilname und Anzeigename der eigenen Seite (Konto-Menü, F-428) – null ohne Profil */
  handle?: string | null;
  displayName?: string | null;
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
  /** nur in der Einzelansicht (F-533): Boot, dessen Seite der Betrachter öffnen darf (sonst null) */
  boatPage?: { id: string; name: string } | null;
  /** nur in der Einzelansicht (F-228): Vereine/Teams, in denen der Törn erschienen ist und die der Betrachter sehen darf */
  groups?: Array<{ slug: string; name: string; kind: string }>;
  /** nur für die Eigentümer:in: Auswahl „In Gruppen zeigen“ (F-375) */
  groupIds?: string[];
  // ---- Fahrtenbuch (Konzept 19); fehlt bei älteren Servern
  source?: ShareSource;
  distSource?: DistSource;
  endedAt?: number | null;
  from?: LogHarbor | null;
  to?: LogHarbor | null;
  log?: Logbook;
  /** „Ins Fahrtenbuch“ (F-422) – fehlt bei älteren Servern */
  logState?: LogState;
  /** „Sichtbar bis“ (F-427) – nur für die Eigentümer:in */
  reach?: Reach;
}

/** Start- bzw. Zielhafen eines Törns (ausgeblendete Häfen: null) */
export interface LogHarbor {
  id: string;
  slug: string;
  name: string;
  lat: number | null;
  lon: number | null;
}

/** Hafen-Eingabe im Fahrtenbuch: vorhandener oder neuer, jeweils optional mit Position (L3) */
export type HarborInput = { harborId: string; lat?: number; lon?: number } | { name: string; lat?: number; lon?: number };

/** POST /api/shares/manual (F-300) */
export interface ManualShareInput {
  title?: string;
  startedAt: number;
  endedAt?: number | null;
  timed?: boolean;
  fromHarbor: HarborInput;
  toHarbor?: HarborInput | null;
  distNm?: number | null;
  boatId?: string | null;
  visibility: Visibility;
  ownerRole?: VoyageRole | null;
  log?: Logbook;
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
  /** Fahrtenbuch-Einträge der laufenden Saison und Grenze (L1); fehlt bei älteren Servern */
  logEntriesUsed?: number;
  logEntriesMax?: number;
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
  /** Bootsklasse (Konzept 34): ID aus BOAT_CLASSES, '' = nicht zugeordnet – fehlt bei älteren Servern */
  boatClass?: string;
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

export type BoatInput = Partial<Pick<Boat, 'name' | 'boatType' | 'boatClass' | 'lengthM' | 'sailNumber' | 'homePort' | 'description' | 'ownerLabel' | 'visibility'>> & {
  /** Hafen (Konzept 12.2): ID, null = keiner; hat Vorrang vor homePort */
  harborId?: string | null;
  /** Lage eines neuen Hafens zu homePort (Pflicht beim Anlegen, F-353) */
  homePortPos?: { lat: number; lon: number } | null;
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
  /** nur für Eigentümer und Skipper (zum Entfernen, Rolle setzen, Bestätigen) */
  id: string | null;
  handle: string | null;
  displayName: string;
  /** null: für Besucher bei nicht öffentlichem Profil (F-280) */
  role: VoyageRole | null;
  /** Bestätigung durch den Skipper – nur für Eigentümer und Skipper */
  confirmed: Confirmation | null;
}

/** Törn im Profil-Abschnitt „Mitgesegelt“ – mit der Rolle der Person an Bord. */
export type CrewVoyage = ShareMeta & { crewRole?: VoyageRole };

/** Bestätigung durch den Skipper (Konzept 15): Zeitpunkt und Name; `by` null = Konto gelöscht. */
export interface Confirmation {
  at: number;
  by: string | null;
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
  /** angemeldetes Konto ist Skipper (Eigentümer oder Crew) – darf bestätigen */
  isSkipper: boolean;
  /** Rolle des Eigentümers, null = nicht angegeben */
  ownerRole: VoyageRole | null;
  /** Bestätigung des Eigentümers (nur für Eigentümer und Skipper) */
  ownerConfirmed: Confirmation | null;
  /** eigene Rolle und Bestätigung als Crew-Mitglied */
  me: { role: VoyageRole; confirmed: Confirmation | null } | null;
  invites: PendingInvite[];
}

export type InviteKind = 'boat_admin' | 'crew' | 'group' | 'friend';

export interface InvitePeek {
  kind: InviteKind;
  /** nur bei Gruppen: Verein oder Team */
  groupKind?: GroupKind;
  target: string | null;
  inviter: string | null;
  /** an eine Adresse bzw. ein Konto geschickt, einmal nutzbar – annehmen darf trotzdem jedes Konto mit dem Link */
  bound: boolean;
  expiresAt: number;
  /** nur Crew: Rolle beim Annehmen */
  role?: VoyageRole;
  /** null: nicht angemeldet bzw. nicht an jemanden geschickt; false: weitergegebener Link (Hinweis vor dem Annehmen) */
  emailMatches: boolean | null;
  /** weitergegebener Link an eine Adresse: diese maskiert („a…@e….org“), sonst null */
  sentTo?: string | null;
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
  /** nur Crew */
  role?: VoyageRole;
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
  /** davon aufgezeichnet (F-303); fehlt bei älteren Servern */
  recordedNm?: number;
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
  /** Fahrtenbuch-Eintrag ohne GPX (Abzeichen) */
  logbook?: boolean;
  boat: { id: string; name: string } | null;
  /** null: Profil nicht öffentlich – Autor:in erscheint ohne Link als „Segler:in“ */
  sailor: { handle: string; displayName: string } | null;
}

export interface DiscoverBoat {
  id: string;
  name: string;
  boatType: string;
  /** Bootsklasse (Konzept 34) – fehlt bei älteren Servern */
  boatClass?: string;
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
  /** „In Gruppen zeigen“ (F-375): ersetzt die Auswahl */
  groupIds?: string[];
  /** „Sichtbar bis“ (F-427) */
  reach?: Reach;
  /** „Ins Fahrtenbuch“ (F-422): an (Vorschlag/bestätigt), bestätigen, ausschließen */
  logState?: LogState;
  /** neuen Schlüssel erzeugen – alte Schlüssel-Links sind danach sofort ungültig */
  rotateKey?: boolean;
  // Fahrtenbuch (F-301): Angaben und Häfen; Datum/Strecke nur bei Einträgen ohne GPX
  log?: Logbook;
  fromHarbor?: HarborInput | null;
  toHarbor?: HarborInput | null;
  startedAt?: number;
  endedAt?: number | null;
  timed?: boolean;
  distNm?: number | null;
};

export interface SharePayload {
  v: 1;
  tracks: Array<{ name: string; gpx: string }>;
  /** beim Teilen mitgespeicherte Wetterdaten (ältere Freigaben: fehlt) */
  weather?: WeatherData;
  /** Fahrtenbuch-Eintrag ohne GPX: Route aus den Hafenpositionen (tracks ist dann leer) */
  route?: LatLon[];
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
  /** Gruppen für „In Gruppen zeigen“ (F-373) */
  shareGroups: () => call<{ groups: ShareGroupChoice[] }>('/api/me/share-groups'),

  createShare: (
    gz: Uint8Array<ArrayBuffer>,
    meta: {
      title: string; summary: string; view: string; trackCount: number; visibility: Visibility; boatId: string | null; distNm: number; startedAt: number | null; endedAt?: number | null;
      /** „In Gruppen zeigen“ (F-373); fehlt bzw. null = Gruppen des Boots */
      groupIds?: string[] | null;
      /** „Sichtbar bis“ (F-427) */
      reach?: Reach;
    },
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
        ...(meta.startedAt && meta.endedAt ? { 'X-Share-Ended': String(meta.endedAt) } : {}),
        ...(meta.boatId ? { 'X-Share-Boat': meta.boatId } : {}),
        ...(meta.groupIds ? { 'X-Share-Groups': JSON.stringify(meta.groupIds) } : {}),
        ...(meta.reach ? { 'X-Share-Reach': meta.reach } : {}),
      },
      body: gz,
    }),

  /** Fahrtenbuch-Eintrag ohne GPX (F-300) */
  createManualShare: (input: ManualShareInput) => call<{ share: ShareMeta }>('/api/shares/manual', jsonInit('POST', input)),
  /** Fahrtenbuch nach Jahren (F-411): eigene Törns und Crew-Törns (M1); CSV unter /api/me/logbook.csv */
  myLogbook: () => call<{ entries: LogbookEntry[]; truncated?: boolean }>('/api/me/logbook'),

  myProfile: () => call<{ profile: Profile; exists: boolean }>('/api/me/profile'),
  saveProfile: (p: ProfileInput) => call<{ profile: Profile }>('/api/me/profile', jsonInit('PUT', p)),
  /** Profilseite; `preview` (nur eigene Seite, F-423): so, wie ein simulierter Betrachter sie sieht */
  profile: (handle: string, key?: string | null, preview?: ProfilePreview | null) =>
    call<ProfilePageData>(`/api/profiles/${encodeURIComponent(handle)}${preview ? `?as=${encodeURIComponent(previewParam(preview))}` : ''}`, keyInit(key)),

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
  /** to null = Einladungslink; role = Rolle beim Annehmen (Co-Skipper, Crew, Gast) */
  inviteCrew: (shareId: string, to: InviteTo | null, role: VoyageRole = 'crew') =>
    call<InviteCreated>(`/api/shares/${encodeURIComponent(shareId)}/invites`, jsonInit('POST', { ...(to ?? {}), role })),
  /** userId 'me' = eigene Rolle */
  setCrewRole: (shareId: string, userId: string, role: VoyageRole) =>
    call<{ role: VoyageRole }>(`/api/shares/${encodeURIComponent(shareId)}/crew/${encodeURIComponent(userId)}/role`, jsonInit('PUT', { role })),
  setOwnerRole: (shareId: string, role: VoyageRole | null) => call<{ role: VoyageRole | null }>(`/api/shares/${encodeURIComponent(shareId)}/role`, jsonInit('PUT', { role })),
  /** userIds 'all' = alle; owner = auch den Eigentümer */
  confirmCrew: (shareId: string, userIds: string[] | 'all', owner = false) =>
    call<{ confirmedAt: number }>(`/api/shares/${encodeURIComponent(shareId)}/confirm`, jsonInit('POST', { userIds, owner })),
  /** userId 'owner' = Bestätigung des Eigentümers */
  unconfirmCrew: (shareId: string, userId: string) =>
    call<void>(`/api/shares/${encodeURIComponent(shareId)}/confirm/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  /** userId 'me' = sich selbst entfernen */
  removeCrew: (shareId: string, userId: string) =>
    call<void>(`/api/shares/${encodeURIComponent(shareId)}/crew/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  revokeInvite: (id: string) => call<void>(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  peekInvite: (token: string) => call<InvitePeek>('/api/invites/peek', jsonInit('POST', { token })),
  acceptInvite: (token: string) => call<InviteAccepted>('/api/invites/accept', jsonInit('POST', { token })),
  myInvites: () => call<{ invites: MyInvite[] }>('/api/me/invites'),
  acceptMyInvite: (id: string) => call<InviteAccepted>(`/api/me/invites/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  declineMyInvite: (id: string) => call<void>(`/api/me/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Saison-Zahlen der Community für die Startseite der Gäste (F-431), gecacht 10 Minuten */
  discoverStats: () => call<SeasonStats>('/api/discover/stats'),
  /** Revier-Wärmekarte (Konzept 37, F-582): für alle gleich, gecacht 15 Minuten */
  discoverHeat: () => call<HeatData>('/api/discover/heat'),
  /** Raster des eigenen GPX-Törns (F-581) */
  putShareHeat: (id: string, cells: number[]) => call<void>(`/api/shares/${encodeURIComponent(id)}/heat`, jsonInit('PUT', { cells })),
  /** `near`: nur aus der Umgebung, nächste zuerst (F-344) */
  /** `boatClass`: Klasse oder Gruppe (F-537) */
  discover: (limit: number, query = '', near?: { center: NearCenter; r: number } | null, boatClass = '') =>
    call<DiscoverData>(
      `/api/discover?limit=${limit}${query ? `&q=${encodeURIComponent(query)}` : ''}${
        near ? `&r=${near.r}&${'harbor' in near.center ? `harbor=${encodeURIComponent(near.center.harbor)}` : `lat=${near.center.lat}&lon=${near.center.lon}`}` : ''
      }${boatClass ? `&klasse=${encodeURIComponent(boatClass)}` : ''}`,
    ),

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
  // Fahrtenbuch-Einträge haben keine Tracks, aber eine Route (1–50 Punkte)
  const route = p ? parseRoute((p as { route?: unknown }).route) : null;
  if (!p || p.v !== 1 || !Array.isArray(p.tracks) || p.tracks.length < (route ? 0 : 1) || p.tracks.length > 20) {
    throw new Error('Ungültiges Freigabe-Format');
  }
  for (const t of p.tracks) {
    if (!t || typeof t.name !== 'string' || typeof t.gpx !== 'string') throw new Error('Ungültiges Freigabe-Format');
  }
  // Ungültiges Wetter verwirft nur das Wetter, nicht die Freigabe – die App lädt dann selbst nach.
  const weather = p.weather === undefined ? null : parseWeatherData(p.weather);
  return { v: 1, tracks: p.tracks as SharePayload['tracks'], ...(weather ? { weather } : {}), ...(route ? { route } : {}) };
}

/** Route eines Fahrtenbuch-Eintrags: 1–50 gültige [lat, lon]-Paare, sonst null. */
function parseRoute(input: unknown): LatLon[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) return null;
  const ok = input.every((p) => Array.isArray(p) && p.length === 2 && Math.abs(Number(p[0])) <= 90 && Math.abs(Number(p[1])) <= 180 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
  return ok ? (input as LatLon[]) : null;
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
  /** Kanäle je Art (Konzept 17.6; fehlt bei älteren Servern) */
  notify?: NotifyPrefs;
  notifyComments: NotifyMode;
  /** wöchentliche Sammelmail aus Vereinen und Teams (fehlt bei älteren Servern) */
  notifyGroups?: GroupNotifyMode;
  /** Kartenstil als Profil-Standard (null: keiner; fehlt bei älteren Servern) */
  mapStyle?: MapStyleId | null;
  suspended: boolean;
  hasProfile: boolean;
  isAdmin: boolean;
}

export type SettingsPatch = { notifyComments?: NotifyMode; notifyGroups?: GroupNotifyMode; notify?: Partial<NotifyPrefs>; mapStyle?: MapStyleId | null };

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
  saveSettings: (s: SettingsPatch) => call<AccountSettings>('/api/me/settings', jsonInit('PATCH', s)),
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
  return sendPhotoXhr(`/api/shares/${encodeURIComponent(shareId)}/photos`, thumb, full, meta, onProgress);
}

/** Gemeinsamer Upload für Törn- und Galerie-Fotos (Konzept 31): gleiche Header, gleiche Fehler. */
function sendPhotoXhr<T>(url: string, thumb: Blob, full: Blob, meta: object, onProgress?: (fraction: number) => void): Promise<{ photo: T }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Photo-Thumb-Length', String(thumb.size));
    xhr.setRequestHeader('X-Photo-Meta', encodeURIComponent(JSON.stringify(meta)));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'offline', 'Server nicht erreichbar.'));
    xhr.onload = () => {
      let body: { photo?: T; error?: string; message?: string } = {};
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
export type { Audience, DayCard };

export interface GroupInfo extends Linkable {
  id: string;
  kind: GroupKind;
  slug: string;
  name: string;
  description: string;
  /** Webseite (F-540) – fehlt bei älteren Servern */
  webUrl?: string | null;
  homePort: string;
  /** Hafen (Konzept 13.3) – fehlt bei älteren Servern */
  harbor?: HarborRef | null;
  joinMode: JoinMode;
  /** wer Anfragen bestätigt (Konzept 14.1) – fehlt bei älteren Servern */
  approveBy?: Approvers;
  /** wer Beiträge schreibt (F-421) – fehlt bei älteren Servern */
  postBy?: PostBy;
  /** wer die Mitgliederliste sieht (F-440) – fehlt bei älteren Servern */
  membersVisible?: MembersVisible;
  /** Tageszusammenfassung großer Verläufe an (F-469) – fehlt bei älteren Servern */
  daySummary?: boolean;
  role: GroupRole | null;
  /** nur für Eigner und Admins: bis zur Prüfung ausgeblendet */
  hiddenAt?: number | null;
  /** verifizierte Vertretung (Konzept 20.4) – nur Vereine, fehlt bei älteren Servern */
  verified?: boolean;
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
  /** Spaßname dieser Gruppe statt Name (Profil nicht öffentlich, F-441) */
  alias?: boolean;
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
  /** eigene Stufe der Benachrichtigungen (F-449) – null: weder Mitglied noch Follower */
  notifyLevel?: NotifyLevel | null;
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
  /** Ort für die Karte im Hintergrund (Heimathafen mit Position, F-351) */
  place?: { lat: number; lon: number } | null;
  parent: GroupRef | null;
  teams: GroupRef[];
  stats: { members: number; boats: number; voyages: number; distNm: number; recordedNm?: number; seasonNm: number };
  members: GroupMember[];
  /** Liste verborgen (F-441): nur die Anzahl in `stats.members` */
  membersHidden?: boolean;
  boats: GroupBoat[];
  social: FollowStats;
  membership: { role: GroupRole | null; requested: boolean; canRequest: boolean; canJoin?: boolean; canInvite?: boolean; canApprove?: boolean; muted?: boolean };
  /** Titelbild samt Ausschnitt und Galerie (Konzept 13) – fehlen bei älteren Servern */
  cover?: string | null;
  coverY?: number;
  photos?: GalleryPhoto[];
  requests?: GroupRequest[];
  invites?: PendingInvite[];
}

export interface MyGroup extends GroupInfo {
  members: number;
  /** Neuigkeiten stumm geschaltet (F-346) */
  muted?: boolean;
  /** Stufe der Benachrichtigungen (F-449) */
  notifyLevel?: NotifyLevel;
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
  /** nur Gruppen- und Hafen-Stream: Tageskarten älterer Tage (F-466) */
  days?: ShownDay[];
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
  /** verifizierter Verein (Konzept 20.4) – fehlt bei älteren Servern */
  verified?: boolean;
}

/** Hafen auf /entdecken (F-332): öffentliche Boote und Vereine/Teams dort */
export interface DiscoverHarbor {
  slug: string;
  name: string;
  boats: number;
  groups: number;
  /** Entfernung zum Mittelpunkt (nur mit Umgebung, F-344) */
  km?: number;
}

export interface DiscoverData {
  /** Vereine und Teams – fehlt bei älteren Servern */
  groups?: DiscoverGroup[];
  /** Häfen und Suchschlüssel der Antwort ('' = ohne Suche, F-331) – fehlen bei älteren Servern */
  harbors?: DiscoverHarbor[];
  query?: string;
  /** Antwort gilt für die Umgebung (F-344) */
  near?: boolean;
  /** wirksamer Filter nach Bootsklasse (F-537), null = keiner */
  boatClass?: string | null;
}

/** Mitgliedschaften für die Beitreten-Knöpfe auf /entdecken (F-333): Slugs der Gruppen. */
export interface DiscoverMembership {
  member: string[];
  requested: string[];
}

export type GroupInput = Partial<Pick<GroupInfo, 'name' | 'slug' | 'description' | 'webUrl' | 'homePort' | 'visibility' | 'joinMode' | 'approveBy' | 'postBy' | 'membersVisible' | 'daySummary'>> & {
  kind?: GroupKind;
  /** Hafen (Konzept 13.3): ID, null = keiner; hat Vorrang vor homePort */
  harborId?: string | null;
  /** Lage eines neuen Hafens zu homePort (Pflicht beim Anlegen, F-353) */
  homePortPos?: { lat: number; lon: number } | null;
  parentId?: string | null;
  rotateKey?: boolean;
};

export type FollowKind = 'user' | 'boat' | 'group' | 'harbor';

const gid = (id: string) => encodeURIComponent(id);

export const groupApi = {
  mine: () => call<{ groups: MyGroup[]; requests: Array<GroupRef & { id?: string; createdAt: number }> }>('/api/groups'),
  /** Eigner übergibt an einen Admin (F-347) */
  transfer: (id: string, userId: string) => call<{ owner: string }>(`/api/groups/${gid(id)}/owner`, jsonInit('POST', { userId })),
  create: (g: GroupInput) => call<{ group: GroupInfo }>('/api/groups', jsonInit('POST', g)),
  bySlug: (slug: string, key?: string | null) => call<GroupPageData>(`/api/groups/slug/${encodeURIComponent(slug)}`, keyInit(key)),
  get: (id: string, key?: string | null) => call<GroupPageData>(`/api/groups/${gid(id)}`, keyInit(key)),
  update: (id: string, g: GroupInput) => call<{ group: GroupInfo }>(`/api/groups/${gid(id)}`, jsonInit('PATCH', g)),
  remove: (id: string) => call<void>(`/api/groups/${gid(id)}`, { method: 'DELETE' }),
  setRole: (id: string, userId: string, role: 'admin' | 'member') => call<{ role: string }>(`/api/groups/${gid(id)}/members/${gid(userId)}`, jsonInit('PATCH', { role })),
  /** userId 'me' = austreten; `follow`: danach weiter folgen (F-446) */
  removeMember: (id: string, userId: string, follow = false) => call<{ followed?: boolean } | void>(`/api/groups/${gid(id)}/members/${gid(userId)}${follow ? '?follow=1' : ''}`, { method: 'DELETE' }),
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
  deletePost: (id: string) => call<void>(`/api/posts/${gid(id)}`, { method: 'DELETE' }),
  /** `day`: die zusammengefassten Einträge dieses Tages („Alle anzeigen“, F-468) */
  stream: (id: string, cursor?: string | null, key?: string | null, day?: string | null) =>
    call<StreamPage>(`/api/groups/${gid(id)}/stream${q({ cursor, day })}`, keyInit(key)),
  myStream: (cursor?: string | null) => call<StreamPage>(`/api/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  /** Community-Badge (F-221): neue Einträge seit dem Gelesen-Zeitpunkt, höchstens 99 (`more`: mehr) */
  /** `joins` false: Beitritte nicht mitzählen (auf dem Gerät ausgeblendet, F-350) */
  unread: (joins = true) => call<{ count: number; more: boolean }>(`/api/stream/unread${joins ? '' : '?joins=0'}`),
  /** Stream bis `at` gelesen (F-222) */
  seen: (at?: number) => call<{ ok: true }>('/api/stream/seen', jsonInit('POST', { at })),
  suggestions: () => call<{ people: Suggestion[] }>('/api/me/suggestions'),
  follow: (kind: FollowKind, id: string, on: boolean) => call<FollowStats>(`/api/follows/${kind}/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' }),
  /** Stufe der Benachrichtigungen eines Verlaufs (F-449) */
  notifyLevel: (kind: FollowKind, id: string, level: NotifyLevel) => call<{ level: NotifyLevel }>(`/api/notify/${kind}/${encodeURIComponent(id)}`, jsonInit('PUT', { level })),
  /** alle Verläufe mit Stufe und die Voreinstellung (Konto → Benachrichtigungen) */
  channels: () => call<{ defaultLevel: NotifyLevel; channels: NotifyChannel[] }>('/api/me/channels'),
  defaultLevel: (level: NotifyLevel) => call<{ defaultLevel: NotifyLevel }>('/api/me/channels/default', jsonInit('PUT', { level })),
};

/** Ein Verlauf mit Stufe (F-449): `ref` für PUT /api/notify (Profil: Profilname, sonst ID), `level` null = Voreinstellung. */
export interface NotifyChannel {
  kind: FollowKind;
  ref: string;
  path: string | null;
  name: string;
  member: boolean;
  level: NotifyLevel | null;
}

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
  teams: Array<{ slug: string; name: string; members: number }>;
}

export interface PublicStreamPage extends StreamPage {
  /** nur auf der ersten Seite */
  filters?: StreamFilters;
}

/** Eingrenzung des öffentlichen Streams: Hafen oder öffentliche Gruppe (`club` = Verein oder Team); null = alles */
/** Umgebung (F-340): Mittelpunkt als gerundeter Standort oder Hafen mit Position */
export type NearCenter = { lat: number; lon: number } | { harbor: string };

export interface NearStreamPage extends StreamPage {
  /** nur auf der ersten Seite: Zahl der Orte im Umkreis und der Mittelpunkt-Hafen (null = Standort) */
  near?: { places: number; center: { slug: string; name: string } | null };
}

export type StreamFilter = { kind: 'harbor' | 'club'; slug: string } | null;

export interface HarborSearchHit extends HarborRef {
  boats: number;
  /** verifizierter Hafen (Konzept 20.4) – fehlt bei älteren Servern */
  verified?: boolean;
  /** Position (fehlt bei älteren Servern bzw. Häfen ohne Position) */
  lat?: number | null;
  lon?: number | null;
}

export interface HarborPageData {
  harbor: HarborRef & { lat: number | null; lon: number | null; webUrl?: string | null; canEdit: boolean; hiddenAt?: number | null; createdAt: number; verified?: boolean };
  club: GroupRef | null;
  /** Vereine und Teams mit diesem Heimathafen (Konzept 13.3) – fehlt bei älteren Servern */
  groups?: GroupRef[];
  stats: { boats: number; voyages: number; distNm: number; recordedNm?: number; seasonNm: number };
  boats: Array<{ id: string; name: string; boatType: string; lengthM: number | null; owner: { handle: string; displayName: string } | null }>;
  voyages: ShareMeta[];
  social: FollowStats;
  clubChoices: Array<{ id: string; slug: string; name: string }>;
  canClearClub: boolean;
  /** darf hier schreiben (B6, F-425) – fehlt bei älteren Servern */
  canPost?: boolean;
}

export interface HarborPatch {
  name?: string;
  lat?: number | null;
  lon?: number | null;
  /** Webseite (F-541): '' = entfernen */
  webUrl?: string;
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
  /** `pos`: Lage des neuen Hafens (Pflicht beim Anlegen, F-353) */
  createHarbor: (name: string, pos?: { lat: number; lon: number } | null) =>
    call<{ harbor: HarborRef; created: boolean }>('/api/harbors', jsonInit('POST', { name, ...(pos ? { lat: pos.lat, lon: pos.lon } : {}) })),
  harbor: (slug: string) => call<HarborPageData>(`/api/harbors/slug/${encodeURIComponent(slug)}`),
  updateHarbor: (id: string, patch: HarborPatch) => call<{ harbor: HarborPageData['harbor'] }>(`/api/harbors/${encodeURIComponent(id)}`, jsonInit('PATCH', patch)),
  harborStream: (id: string, cursor?: string | null, day?: string | null) => call<StreamPage>(`/api/harbors/${encodeURIComponent(id)}/stream${q({ cursor, day })}`),
  /** Neuigkeiten des Boots (F-425); Schlüssel bei „Nur mit Link“ */
  boatStream: (id: string, cursor?: string | null, key?: string | null) => call<StreamPage>(`/api/boats/${encodeURIComponent(id)}/stream${q({ cursor })}`, keyInit(key)),
  home: () => call<HomeInfo>('/api/me/home'),
  saveHome: (patch: { clubId?: string | null; harborId?: string | null }) => call<HomeInfo>('/api/me/home', jsonInit('PUT', patch)),
  nearStream: (cursor: string | null, center: NearCenter, r: number) =>
    call<NearStreamPage>(`/api/stream/near${q({ cursor, r: String(r), ...('harbor' in center ? { harbor: center.harbor } : { lat: String(center.lat), lon: String(center.lon) }) })}`),
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

/** Stand eines Antrags „Ich vertrete …“ für die angemeldete Person (Konzept 20, GET /api/claims/:kind/:id). */
export interface ClaimState {
  verified: boolean;
  /** die Person vertritt das Objekt schon verifiziert */
  representing: boolean;
  /** verdrängt – kein neuer Antrag möglich */
  blocked: boolean;
  claim: MyClaim | null;
  canClaim: boolean;
}

export interface ClaimRequest {
  kind: ClaimKind;
  id: string;
  role: string;
  reason: string;
  contact: string;
  evidenceUrl: string;
}

export const claimApi = {
  state: (kind: ClaimKind, id: string) => call<ClaimState>(`/api/claims/${kind}/${encodeURIComponent(id)}`),
  create: (req: ClaimRequest) => call<ClaimState>('/api/claims', jsonInit('POST', req)),
  withdraw: (id: string) => call<void>(`/api/claims/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

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

// ================================================================ Benachrichtigungen (Konzept 17)

export type { NotificationItem };

/** Was als gelesen gilt: bestimmte Einträge, eine Art, ein Gegenstand (Törn, Gruppe) oder alles. */
export type NotificationRead = { ids: string[] } | { kind: NotificationKind } | { subjectKind: 'share' | 'group'; subjectId: string } | { all: true };

export const notificationApi = {
  list: () => call<{ items: NotificationItem[]; unread: number }>('/api/notifications'),
  unread: () => call<{ unread: number }>('/api/notifications/count'),
  read: (what: NotificationRead) => call<{ unread: number }>('/api/notifications/read', jsonInit('POST', what)),
  /** öffentlicher VAPID-Schlüssel; null = Push hier nicht eingerichtet */
  pushKey: () => call<{ publicKey: string | null }>('/api/push/key'),
  subscribePush: (endpoint: string) => call<void>('/api/me/push', jsonInit('PUT', { endpoint })),
  unsubscribePush: (endpoint: string) => call<void>('/api/me/push', jsonInit('DELETE', { endpoint })),
};

// ================================================================ Beiträge als Grundtyp (Konzept 21)

/** Neuer Beitrag (Gruppe oder eigenes Profil): Text bzw. – mit `kind` – eine andere Art (Umfrage, Konzept 29) */
export interface PostInput {
  /** Art; fehlt = Text */
  kind?: ComposePostKind;
  /** Nutzlast einer Umfrage (`kind: 'poll'`) */
  poll?: PollConfig;
  /** Galerie (`kind: 'gallery'`, Konzept 31): gewählte Fotos – lädt der ComposeController nach dem Anlegen hoch, nie im JSON */
  gallery?: File[];
  /** Termin einer Veranstaltung (`kind: 'event'`, Konzept 30) – der Text ist der Titel */
  event?: EventFields;
  body: string;
  link: string;
  visibility: PostVisibility;
  /** „Sichtbar bis“ (F-409); fehlt = Standard des Verlaufs */
  reach?: Reach;
  /** angehängter eigener Törn (F-426) */
  shareId?: string | null;
}

/** Neuer Beitrag über den Plus-Knopf (F-405): Verlauf und Inhalt */
export type ChannelPostInput = PostInput & { channel: { kind: ChannelKind; id: string } };

/** „Wo steht es?“ und eigene Törns für das Formular (GET /api/me/compose) */
export interface ComposeData {
  targets: ComposeTarget[];
  preselect: string | null;
  shares: AttachableShare[];
  supporter: boolean;
  /** Galerie-Kontingent (Konzept 31) – fehlt bei älteren Servern */
  gallery?: GalleryQuota;
}

/** Neu angelegter Beitrag – mit Link zur Karte und Seite des Heimatverlaufs */
export interface CreatedPost {
  id: string;
  path: string;
  home: string | null;
}

/** Antwort der Profilseite – mit Beiträgen für Besucher (F-420) und der Vorschau „Ansehen als …“ (F-423) */
export type ProfilePageData = {
  profile: Profile;
  boats: Boat[];
  stats: PageStats;
  voyages: ShareMeta[];
  crewVoyages?: CrewVoyage[];
  social?: FollowStats;
  home?: PublicHome;
  posts?: ProfilePost[];
  previewOptions?: PreviewOptions;
  /** gesetzt in der Vorschau; `visible: false` = der Betrachter sähe die Seite gar nicht */
  preview?: ProfilePreview & { visible: boolean };
} & PageMedia;

export const postApi = {
  /** „Mein Verlauf“ (F-401) */
  mine: (area: MyPostArea, cursor?: string | null) =>
    call<{ items: MyPost[]; cursor: string | null }>(`/api/me/posts?area=${area}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  remove: (id: string) => call<void>(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Verläufe zum Schreiben (F-405); `ctx` = Verlauf der offenen Seite, z. B. `group:<id>` */
  compose: (ctx?: string | null) => call<ComposeData>(`/api/me/compose${q({ ctx })}`),
  /** Publikum eines Verlaufs je Stufe, gerundet (F-465) */
  audience: (ctx: string) => call<{ audience: Audience }>(`/api/me/compose/audience${q({ ctx })}`),
  /** Beitrag in einen beliebigen Verlauf (F-405, F-425) */
  createIn: (input: ChannelPostInput) => call<{ post: CreatedPost }>('/api/posts', jsonInit('POST', input)),
  /** Sichtbarkeit bzw. „Sichtbar bis“ ändern (F-409) */
  update: (id: string, patch: { visibility?: PostVisibility; reach?: Reach }) =>
    call<{ post: { id: string; visibility: PostVisibility; reach: Reach; path: string } }>(`/api/posts/${encodeURIComponent(id)}`, jsonInit('PATCH', patch)),
  /** Pins eines Verlaufs (F-403), z. B. `group:<id>` – nie gecacht */
  pins: (channel: string) => call<{ items: StreamItem[]; canManage: boolean }>(`/api/pins${q({ channel })}`),
  /** anpinnen bzw. lösen (F-403); Profil: `{ kind: 'user', id: '' }` */
  pin: (id: string, channel: { kind: ChannelKind; id: string }, pinned: boolean) =>
    call<{ pinned: boolean }>(`/api/posts/${encodeURIComponent(id)}/pin`, jsonInit('PUT', { channel, pinned })),
  /** Karte und Ziel von `/p/<id>` (F-406) */
  get: (id: string, key?: string | null) => call<{ item: StreamItem; link: PostLink }>(`/api/posts/${encodeURIComponent(id)}`, keyInit(key)),
  /** Umfrage (Konzept 29): abstimmen (`[]` = zurücknehmen), Schlüssel bei „Nur mit Link“ */
  vote: (id: string, choices: number[], key?: string | null) =>
    call<{ poll: PollView }>(`/api/posts/${encodeURIComponent(id)}/vote`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Share-Key': key } : {}) },
      body: JSON.stringify({ choices }),
    }),
  /** Umfrage vorzeitig beenden (nur Autor:in) */
  closePoll: (id: string) => call<{ poll: PollView }>(`/api/posts/${encodeURIComponent(id)}/close`, { method: 'POST' }),
  /** Stand einer Umfrage mit Namen je Antwort (nur namentlich und mit sichtbarem Ergebnis) */
  poll: (id: string, key?: string | null) => call<{ poll: PollView; people: PollPeople[] | null }>(`/api/posts/${encodeURIComponent(id)}/poll`, keyInit(key)),
  /** ein Foto zum eigenen Galerie-Beitrag (Konzept 31) – Fortschritt wie bei Törn-Fotos */
  uploadPhoto: (id: string, thumb: Blob, full: Blob, onProgress?: (fraction: number) => void) =>
    sendPhotoXhr<PostPhoto>(`/api/posts/${encodeURIComponent(id)}/photos`, thumb, full, { caption: '' }, onProgress),
};

/** Termin, Ort und Kapazität einer Veranstaltung; beim Anlegen mit Beschreibung (Konzept 30) */
export type EventFields = EventInput & { description?: string };

/** „Wer kommt?“ (F-483): Namen je Status, der Rest als Anzahl; `all` = Autor:in bzw. Verwalter sehen alle Anzeigenamen */
export interface RsvpList {
  people: Record<RsvpStatus, Array<{ displayName: string; handle: string | null }>>;
  others: Record<RsvpStatus, number>;
  all: boolean;
}

export const eventApi = {
  /** Zusage setzen bzw. ändern (F-481) – mit Schlüssel bei „Nur mit Link“ */
  rsvp: (id: string, status: RsvpStatus, key?: string | null) =>
    call<{ event: EventView }>(`/api/posts/${encodeURIComponent(id)}/rsvp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Share-Key': key } : {}) },
      body: JSON.stringify({ status }),
    }),
  who: (id: string, key?: string | null) => call<RsvpList>(`/api/posts/${encodeURIComponent(id)}/rsvps`, keyInit(key)),
  /** Termin, Ort, Kapazität ändern bzw. absagen (F-484) */
  update: (id: string, patch: EventInput | { cancel: true }) => call<{ event: EventView }>(`/api/posts/${encodeURIComponent(id)}/event`, jsonInit('PATCH', patch)),
};
