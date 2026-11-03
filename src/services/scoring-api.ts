// API der Wertung (Konzept 32) – eigenes Modul neben api.ts, damit parallele Branches dort nicht kollidieren.
import { call, jsonInit } from './api';
import type { ScoringRules, ScoringTemplate } from '../domain/scoring';

/** Eigener Verein mit Teilnahme an der Vereinsliste und Recht, Vorlagen zu pflegen. */
export interface ScoringClub {
  id: string;
  slug: string;
  name: string;
  optIn: boolean;
  manage: boolean;
}

export interface MyScoring {
  /** wählbar: „Nur Meilen“, Vorschläge der Plattform, Vorlagen der eigenen Vereine */
  templates: ScoringTemplate[];
  lastTemplateId: string | null;
  clubs: ScoringClub[];
  /** Plattform-Admin: pflegt die Vorschläge */
  admin: boolean;
}

export interface ClubListMember {
  name: string;
  /** nur mit öffentlichem Profil */
  handle: string | null;
  me: boolean;
  points: number;
  entries: number;
  byTemplate: Array<{ template: string; points: number; count: number }>;
}

export interface ClubList {
  season: number;
  templates: Array<{ id: string; name: string; listWeight: number }>;
  members: ClubListMember[];
  truncated: boolean;
}

export interface TemplateInput {
  groupId?: string | null;
  name?: string;
  rules?: ScoringRules;
  sourceId?: string;
  listWeight?: number | null;
}

const tpl = (id: string) => `/api/scoring/templates/${encodeURIComponent(id)}`;
const grp = (id: string) => `/api/groups/${encodeURIComponent(id)}/scoring`;

export const scoringApi = {
  mine: () => call<MyScoring>('/api/me/scoring'),
  create: (input: TemplateInput) => call<{ template: ScoringTemplate }>('/api/scoring/templates', jsonInit('POST', input)),
  update: (id: string, patch: Omit<TemplateInput, 'groupId' | 'sourceId'>) => call<{ template: ScoringTemplate }>(tpl(id), jsonInit('PATCH', patch)),
  remove: (id: string) => call<void>(tpl(id), { method: 'DELETE' }),
  optIn: (groupId: string, optIn: boolean) => call<{ optIn: boolean }>(grp(groupId), jsonInit('PUT', { optIn })),
  clubList: (groupId: string, season: number) => call<ClubList>(`${grp(groupId)}?saison=${season}`),
};
