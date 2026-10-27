// Unterstützen und Aufbewahrung: reine Regeln (ohne DOM, ohne Netz) – genutzt von Worker und Oberfläche.

const DAY = 86_400_000;

// ---------------------------------------------------------------- Saison (Konzept 5.5)
// Inhalte und Unterstützung gelten je Saison = Kalenderjahr (UTC). Was ab November hochgeladen bzw. bezahlt wird,
// zählt schon zur nächsten Saison. Nach dem Saisonende bleibt der Januar als Schonfrist; im Dezember erinnert eine
// freundliche Mail daran, mit einer Unterstützung die Inhalte in die nächste Saison mitzunehmen.

/** Ab diesem Monat (0 = Januar) zählt Neues zur nächsten Saison: November. */
export const NEXT_SEASON_FROM_MONTH = 10;
/** Schonfrist nach dem Saisonende (Tage im Januar): gelöscht wird am 1. Februar. */
export const GRACE_DAYS = 31;
/** In diesem Monat (0 = Januar) kommt die Saison-Erinnerung: Dezember. */
export const SEASON_MAIL_MONTH = 11;

export const GRACE_MS = GRACE_DAYS * DAY;

/** Saison eines Zeitpunkts: das Kalenderjahr, ab November das folgende. */
export function seasonOf(t: number): number {
  const d = new Date(t);
  return d.getUTCFullYear() + (d.getUTCMonth() >= NEXT_SEASON_FROM_MONTH ? 1 : 0);
}

/** Ende einer Saison: 1. Januar des Folgejahres, 0 Uhr UTC. */
export const seasonEnd = (season: number): number => Date.UTC(season + 1, 0, 1);

/** Letzte Saison, die ein Unterstützer-Ende (exklusiv, 1. Januar) abdeckt. */
const lastSeason = (until: number): number => new Date(until - 1).getUTCFullYear();

/** So viele Tage vor dem Löschen kommt eine Erinnerungsmail. */
export const WARN_DAYS = 14;
/** Konten ohne Törns werden nach so vielen Tagen ohne Anmeldung gelöscht. */
export const INACTIVE_ACCOUNT_DAYS = 365;

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
 * Neues Ende des Unterstützer-Status nach einer Zahlung: eine Saison – die des Zahltags (ab November die nächste)
 * bzw. die auf eine laufende Unterstützung folgende. Endet immer am 1. Januar. (Gleiche Regel wie der Webhook.)
 */
export function extendSupport(currentUntil: number | null, paidAt: number): number {
  const next = currentUntil !== null && currentUntil > paidAt ? lastSeason(currentUntil) + 1 : 0;
  return seasonEnd(Math.max(seasonOf(paidAt), next));
}

/**
 * Wann ein Törn gelöscht wird: am 1. Februar nach seiner Saison – oder nach der letzten unterstützten Saison, wenn
 * die später endet. (Gleiche Regel wie EXPIRES_SQL im Worker.)
 */
export function shareExpiry(createdAt: number, supporterUntil: number | null): number {
  return Math.max(seasonEnd(seasonOf(createdAt)), supporterUntil ?? 0) + GRACE_MS;
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
