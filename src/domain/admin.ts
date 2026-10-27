// Admin-Bereich (Konzept 15): reine Regeln ohne DOM und Netz – genutzt von Worker und Admin-Oberfläche.
const DAY = 86_400_000;

/** Objektarten der Admin-Übersicht (Pfad /api/admin/list/:art) und ihre Ziel-Art in `locks` und `admin_log`. */
export const ADMIN_KINDS = ['users', 'boats', 'groups', 'harbors', 'shares'] as const;
export type AdminKind = (typeof ADMIN_KINDS)[number];
export const isAdminKind = (k: unknown): k is AdminKind => typeof k === 'string' && (ADMIN_KINDS as readonly string[]).includes(k);

export type LockKind = 'user' | 'boat' | 'group' | 'harbor' | 'share';
export const LOCK_KIND: Record<AdminKind, LockKind> = { users: 'user', boats: 'boat', groups: 'group', harbors: 'harbor', shares: 'share' };

export const ADMIN_KIND_LABEL: Record<AdminKind, string> = { users: 'Konten', boats: 'Boote', groups: 'Gruppen', harbors: 'Häfen', shares: 'Törns' };

/** Filter der Übersicht (Konzept 15.5); `suspended` nur bei Konten. */
export const ADMIN_FILTERS = ['all', 'locked', 'hidden', 'suspended', 'private', 'ownerless'] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];

/** Welche Filter je Art Sinn ergeben (Häfen sind immer öffentlich, Konten haben keine Eigner). */
export const FILTERS_FOR: Record<AdminKind, readonly AdminFilter[]> = {
  users: ['all', 'locked', 'hidden', 'suspended', 'private'],
  boats: ['all', 'locked', 'hidden', 'private', 'ownerless'],
  groups: ['all', 'locked', 'hidden', 'private', 'ownerless'],
  harbors: ['all', 'locked', 'hidden', 'ownerless'],
  shares: ['all', 'locked', 'hidden', 'private'],
};

export const ADMIN_FILTER_LABEL: Record<AdminFilter, string> = {
  all: 'Alle',
  locked: 'Gesperrt',
  hidden: 'Ausgeblendet',
  suspended: 'Suspendiert',
  private: 'Nicht öffentlich',
  ownerless: 'Ohne Eigner',
};

export function parseAdminFilter(kind: AdminKind, input: unknown): AdminFilter | null {
  const f = input === null || input === undefined || input === '' ? 'all' : input;
  return typeof f === 'string' && FILTERS_FOR[kind].includes(f as AdminFilter) ? (f as AdminFilter) : null;
}

export const ADMIN_LIMITS = {
  /** Einträge je Seite in Übersicht und Protokoll */
  page: 50,
  /** höchste Seitennummer (gegen teure OFFSETs) */
  maxPage: 200,
  queryMax: 80,
  reasonMax: 500,
  detailMax: 500,
  /** endgültige Löschungen abgelaufener Sperren je Nacht (Free-Tier-Budget) */
  expirePerNight: 20,
} as const;

/** Sperrfrist (Konzept 15.4): 180 Tage, jede Verlängerung wieder 180 Tage ab dann. */
export const LOCK_MS = 180 * DAY;
/** Ablauf in so vielen Tagen wird in der Übersicht hervorgehoben. */
export const LOCK_WARN_MS = 14 * DAY;
export const lockUntil = (now: number) => now + LOCK_MS;

/** Fristen des Admin-Protokolls (Konzept 15.10): Einblicke 180 Tage, Aktionen 2 Jahre. */
export const LOG_VIEW_MS = 180 * DAY;
export const LOG_ACTION_MS = 2 * 365 * DAY;

/** Seite aus dem Query-Parameter: 1 … maxPage, sonst 1. */
export function parsePage(input: unknown): number {
  const n = typeof input === 'string' && /^\d{1,4}$/.test(input) ? Number(input) : 1;
  return Math.min(Math.max(n, 1), ADMIN_LIMITS.maxPage);
}

/** Restlaufzeit einer Sperre in ganzen Tagen (aufgerundet, nie negativ). */
export const lockDaysLeft = (until: number, now = Date.now()) => Math.max(0, Math.ceil((until - now) / DAY));
