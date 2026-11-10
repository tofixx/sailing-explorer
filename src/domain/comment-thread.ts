// Verläufe mit Kommentaren und ihre Glocke (Konzept 40, F-635 … F-644). Rein, ohne DOM und Netz – Worker (Abfragen,
// Benachrichtigen) und Oberfläche nutzen dieselbe Regel; `subscribedSql` (worker/comment-thread-sql.ts) ist ihr
// SQL-Gegenstück, ein Test hält beide gleich.

/** Ein Verlauf: Törn (`shares`, auch Fahrtenbuch und Törn-Beiträge) oder Beitrag ohne Törn (`posts`). */
export const THREAD_KINDS = ['share', 'post'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];
export const isThreadKind = (k: unknown): k is ThreadKind => k === 'share' || k === 'post';

/** Zeile der Glocke: `on` benachrichtigen, `off` stumm (bleibt gemerkt). */
export type SubscriptionState = 'on' | 'off';
export const isSubscriptionState = (s: unknown): s is SubscriptionState => s === 'on' || s === 'off';

/**
 * Bekommt jemand Benachrichtigungen zu neuen Kommentaren im Verlauf? Eine Zeile entscheidet (an bzw. stumm); ohne
 * Zeile nur die Eigentümer:in bzw. Autor:in. Der erste eigene Kommentar legt `on` nur an, wenn es noch keine Zeile
 * gibt – wer stumm geschaltet hat, bleibt stumm.
 */
export function isSubscribed(state: SubscriptionState | null | undefined, isOwner: boolean): boolean {
  return state ? state === 'on' : isOwner;
}
