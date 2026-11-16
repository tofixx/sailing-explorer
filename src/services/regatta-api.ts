// API der Regatten (Konzept 42, F-645 … F-654) – eigenes Modul neben api.ts, wie scoring-api.ts.
import { call } from './api';
import type { ClubRegatta } from '../domain/regatta';
import type { GroupKind } from '../domain/groups';

export interface GroupRegattas {
  season: number;
  kind: GroupKind;
  regattas: ClubRegatta[];
  truncated: boolean;
}

export const regattaApi = {
  /** Regatta-Übersicht eines Vereins bzw. einer Klassenvereinigung – nur Mitglieder (sonst 404). */
  group: (id: string, season?: number | null) =>
    call<GroupRegattas>(`/api/groups/${encodeURIComponent(id)}/regattas${season ? `?saison=${season}` : ''}`),
};
