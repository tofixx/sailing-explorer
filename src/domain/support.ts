// Unterstützen und Aufbewahrung: reine Regeln (ohne DOM, ohne Netz) – genutzt von Worker und Oberfläche.

const DAY = 86_400_000;

/** Kostenlose Törns bleiben so lange gespeichert (ab Upload). */
export const FREE_RETENTION_DAYS = 90;
/** Eine Unterstützung gilt so lange; jede weitere Zahlung verlängert um diesen Zeitraum. */
export const SUPPORT_DAYS = 365;
/** So viele Tage vor dem Löschen kommt eine Erinnerungsmail. */
export const WARN_DAYS = 14;
/** Konten ohne Törns werden nach so vielen Tagen ohne Anmeldung gelöscht. */
export const INACTIVE_ACCOUNT_DAYS = 365;

export const FREE_RETENTION_MS = FREE_RETENTION_DAYS * DAY;
export const SUPPORT_MS = SUPPORT_DAYS * DAY;
export const WARN_MS = WARN_DAYS * DAY;
export const INACTIVE_ACCOUNT_MS = INACTIVE_ACCOUNT_DAYS * DAY;

/** Stufen des Unterstützen-Sliders (Betrag in Cent). */
export interface SupportTier {
  amount: number;
  label: string;
  icon: 'coffee' | 'beer' | 'round' | 'crate' | 'anchor';
}

export const SUPPORT_TIERS: SupportTier[] = [
  { amount: 300, label: 'Kaffee', icon: 'coffee' },
  { amount: 500, label: 'Bier', icon: 'beer' },
  { amount: 1000, label: 'Runde', icon: 'round' },
  { amount: 2000, label: 'Kiste', icon: 'crate' },
  { amount: 5000, label: 'Skipper-Dank', icon: 'anchor' },
];

export const tierFor = (amount: number): SupportTier | undefined => SUPPORT_TIERS.find((t) => t.amount === amount);

export const formatEuro = (cents: number) =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 });

/**
 * Neues Ende des Unterstützer-Status nach einer Zahlung: verlängert ein laufendes Ende,
 * sonst ab dem Zahltag.
 */
export function extendSupport(currentUntil: number | null, paidAt: number): number {
  return Math.max(currentUntil ?? 0, paidAt) + SUPPORT_MS;
}

/**
 * Wann ein Törn gelöscht wird: 3 Monate nach Upload – oder 3 Monate nach Ende der
 * Unterstützung, wenn diese später endet. (Gleiche Regel wie EXPIRES_SQL im Worker.)
 */
export function shareExpiry(createdAt: number, supporterUntil: number | null): number {
  return Math.max(createdAt, supporterUntil ?? 0) + FREE_RETENTION_MS;
}

export interface QuotaStatus {
  supporter: boolean;
  sharesUsed: number;
  sharesFree: number;
  /** Ende des Unterstützer-Status (ms) oder null */
  supporterUntil?: number | null;
}

/** Ist das kostenlose Kontingent ausgeschöpft? Dann braucht der nächste Törn eine Unterstützung. */
export function needsSupport(s: QuotaStatus | null): boolean {
  return !!s && !s.supporter && s.sharesUsed >= s.sharesFree;
}

/** „2 von 3 kostenlos genutzt“ – für Unterstützer leer (für sie gibt es kein knappes Kontingent). */
export function quotaText(s: QuotaStatus | null): string {
  if (!s || s.supporter) return '';
  return `${Math.min(s.sharesUsed, s.sharesFree)} von ${s.sharesFree} kostenlosen Freigaben genutzt`;
}
