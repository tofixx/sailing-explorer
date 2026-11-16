// API der Stammcrew (Konzept 41, F-270 … F-274) – eigenes Modul neben api.ts, wie scoring-api.ts.
import { call, jsonInit, type Boat, type InviteCreated, type InviteTo, type PendingInvite } from './api';
import type { AssignMode, BoatStanding, CrewRights } from '../domain/boat-crew';

export interface BoatCrewMember {
  /** nur für Verwalter und die Person selbst */
  id: string | null;
  /** Profil-Link nur bei öffentlichem Profil */
  handle: string | null;
  displayName: string;
  title: string;
  isSelf: boolean;
}

export interface BoatCrew {
  standing: BoatStanding;
  rights: CrewRights;
  canInvite: boolean;
  canPost: boolean;
  members: BoatCrewMember[];
  /** Mitglieder ohne öffentliches Profil (nur gezählt) */
  others: number;
  /** offene Einladungen – nur für Eigner und Admins */
  invites: PendingInvite[];
}

/** Boot zur Auswahl beim Teilen und im Fahrtenbuch: verwaltete und zuordenbare (F-272). */
export type BoatChoice = Pick<Boat, 'id' | 'name'>;

/** Verwaltete Boote zuerst, dann die, denen man nur zuordnen darf – ohne Doppel. */
export const boatChoices = (r: { boats: BoatChoice[]; assignable?: BoatChoice[] }): BoatChoice[] => {
  const seen = new Set(r.boats.map((b) => b.id));
  return [...r.boats, ...(r.assignable ?? []).filter((b) => !seen.has(b.id))];
};

const base = (id: string) => `/api/boats/${encodeURIComponent(id)}`;

export const boatCrewApi = {
  crew: (id: string, key?: string | null) => call<BoatCrew>(`${base(id)}/crew`, key ? { headers: { 'X-Share-Key': key } } : {}),
  /** to null = Einladungslink */
  invite: (id: string, to: InviteTo | null) => call<InviteCreated>(`${base(id)}/crew/invites`, jsonInit('POST', to ?? {})),
  rights: (id: string, patch: Partial<{ post: boolean; invite: boolean; assign: AssignMode }>) => call<{ rights: CrewRights }>(`${base(id)}/crew-rights`, jsonInit('PUT', patch)),
  /** userId 'me' = eigener Titel */
  title: (id: string, userId: string, title: string) => call<{ title: string }>(`${base(id)}/crew/${encodeURIComponent(userId)}`, jsonInit('PATCH', { title })),
  /** userId 'me' = austreten */
  remove: (id: string, userId: string) => call<void>(`${base(id)}/crew/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  unassign: (id: string, shareId: string) => call<void>(`${base(id)}/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' }),
};
