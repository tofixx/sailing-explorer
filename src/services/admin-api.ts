// API des Admin-Bereichs (Konzept 15) – eigenes Modul, damit es nur mit der Admin-Seite nachgeladen wird.
import { call, jsonInit } from './api';
import type { Visibility } from '../domain/visibility';
import type { AdminFilter, AdminKind } from '../domain/admin';

export interface AdminItem {
  id: string;
  name: string;
  /** Konten: Mail-Adresse, Boote: Hafen, Gruppen: Art, Törns: Strecke */
  sub: string;
  visibility: Visibility | null;
  createdAt: number;
  path: string | null;
  handle: string | null;
  owner: { id: string; handle: string | null; displayName: string } | null;
  lock: { until: number; reason: string; since: number | null; viaUser: string | null } | null;
  hidden: boolean;
  suspended: boolean;
  counts: Record<string, number>;
}

export interface AdminLogEntry {
  id: string;
  adminId: string | null;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  detail: string;
  createdAt: number;
}

export interface AdminDetail {
  item: AdminItem;
  extra: Record<string, number | string | null>;
  isAdmin: boolean;
  log: AdminLogEntry[];
}

export interface MergePreview {
  from: { id: string; name: string; suspended: boolean };
  into: { id: string; name: string; suspended: boolean };
  counts: Record<string, number>;
  profile: 'keep' | 'take' | 'none';
}

const enc = encodeURIComponent;
const one = (kind: AdminKind, id: string) => `/api/admin/${kind}/${enc(id)}`;

export const adminApi = {
  list: (kind: AdminKind, o: { q?: string; filter?: AdminFilter; page?: number }) =>
    call<{ items: AdminItem[]; page: number; more: boolean }>(
      `/api/admin/list/${kind}?${new URLSearchParams({ q: o.q ?? '', filter: o.filter ?? 'all', page: String(o.page ?? 1) })}`,
    ),
  detail: (kind: AdminKind, id: string) => call<AdminDetail>(one(kind, id)),
  lock: (kind: AdminKind, id: string, reason: string) => call<{ action: 'lock' | 'extend' }>(`${one(kind, id)}/lock`, jsonInit('PUT', { reason })),
  unlock: (kind: AdminKind, id: string) => call<{ ok: true }>(`${one(kind, id)}/lock`, { method: 'DELETE' }),
  rename: (kind: AdminKind, id: string, patch: Record<string, string>) => call<{ item: AdminItem }>(one(kind, id), jsonInit('PATCH', patch)),
  owner: (kind: AdminKind, id: string, userId: string) => call<{ item: AdminItem }>(`${one(kind, id)}/owner`, jsonInit('POST', { userId })),
  remove: (kind: AdminKind, id: string, confirm: string) => call<void>(one(kind, id), jsonInit('DELETE', { confirm })),
  mergeHarbor: (id: string, into: string) => call<{ moved: Record<string, number> }>(`/api/admin/harbors/${enc(id)}/merge`, jsonInit('POST', { into })),
  mergePreview: (id: string, into: string) => call<MergePreview>(`/api/admin/users/${enc(id)}/merge?into=${enc(into)}`),
  mergeUsers: (id: string, into: string, confirm: string) => call<{ ok: true }>(`/api/admin/users/${enc(id)}/merge`, jsonInit('POST', { into, confirm })),
  log: (q: string, page: number) => call<{ entries: AdminLogEntry[]; page: number; more: boolean }>(`/api/admin/log?${new URLSearchParams({ q, page: String(page) })}`),
};
