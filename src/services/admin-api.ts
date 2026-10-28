// API des Admin-Bereichs (Konzept 18) – eigenes Modul, damit es nur mit der Admin-Seite nachgeladen wird.
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

/** Aktion aus der Admin-Seite (Event `sx-admin-act`), ausgeführt vom AdminController. */
export type AdminOp = { kind: AdminKind; id: string } & (
  | { type: 'lock'; reason: string }
  | { type: 'unlock' }
  | { type: 'rename'; patch: Record<string, string> }
  | { type: 'owner'; userId: string }
  | { type: 'remove'; confirm: string }
  | { type: 'mergeHarbor'; into: string }
  | { type: 'mergeUsers'; into: string; confirm: string }
  | { type: 'grantSupport'; seasons: number; note: string }
  | { type: 'revokeSupport' }
);

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
  grantSupport: (id: string, seasons: number, note: string) =>
    call<{ supporterUntil: number }>(`/api/admin/users/${enc(id)}/support`, jsonInit('POST', { seasons, note })),
  revokeSupport: (id: string) => call<{ supporterUntil: number | null }>(`/api/admin/users/${enc(id)}/support`, { method: 'DELETE' }),
  log: (q: string, page: number) => call<{ entries: AdminLogEntry[]; page: number; more: boolean }>(`/api/admin/log?${new URLSearchParams({ q, page: String(page) })}`),
};

/** Führt eine Aktion der Admin-Seite aus. */
export function runAdminOp(op: AdminOp): Promise<unknown> {
  switch (op.type) {
    case 'lock':
      return adminApi.lock(op.kind, op.id, op.reason);
    case 'unlock':
      return adminApi.unlock(op.kind, op.id);
    case 'rename':
      return adminApi.rename(op.kind, op.id, op.patch);
    case 'owner':
      return adminApi.owner(op.kind, op.id, op.userId);
    case 'remove':
      return adminApi.remove(op.kind, op.id, op.confirm);
    case 'mergeHarbor':
      return adminApi.mergeHarbor(op.id, op.into);
    case 'mergeUsers':
      return adminApi.mergeUsers(op.id, op.into, op.confirm);
    case 'grantSupport':
      return adminApi.grantSupport(op.id, op.seasons, op.note);
    case 'revokeSupport':
      return adminApi.revokeSupport(op.id);
  }
}
