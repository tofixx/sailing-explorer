// API der Jahresansicht im Profil (Konzept 43, F-665 … F-669) – eigenes Modul neben api.ts.
import { call, jsonInit } from './api';
import type { SeasonRow, SeasonTableMode } from '../domain/season-table';

export interface SeasonTableData {
  mode: SeasonTableMode;
  self: boolean;
  rows: SeasonRow[];
  truncated: boolean;
}

export const seasonTableApi = {
  /** Für sich selbst immer; für andere nur, wenn freigegeben (sonst 404). `asOthers`: Vorschau der eigenen Seite – die Sicht der anderen (F-423) */
  get: (handle: string, key?: string | null, asOthers = false) =>
    call<SeasonTableData>(`/api/profiles/${encodeURIComponent(handle)}/seasons${asOthers ? '?as=andere' : ''}`, key ? { headers: { 'X-Share-Key': key } } : {}),
  setMode: (mode: SeasonTableMode) => call<{ mode: SeasonTableMode }>('/api/me/season-table', jsonInit('PUT', { mode })),
};
