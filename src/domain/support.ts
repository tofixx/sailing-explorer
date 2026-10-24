// Unterstützen: reine Regeln für Kontingent und Payment-Links (ohne DOM, ohne Netz).

export interface QuotaStatus {
  supporter: boolean;
  sharesUsed: number;
  sharesFree: number;
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

/**
 * Personalisiert einen Stripe-Payment-Link: client_reference_id ordnet die Zahlung dem Konto zu
 * (der Webhook schaltet darüber frei), prefilled_email spart das Abtippen.
 */
export function supportUrl(link: string, user: { id: string; email: string }): string {
  const url = new URL(link);
  url.searchParams.set('client_reference_id', user.id);
  url.searchParams.set('prefilled_email', user.email);
  return url.toString();
}
