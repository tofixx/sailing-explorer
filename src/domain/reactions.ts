// Reaktionen (Konzept 12.5, F-179/F-180): feste kleine Auswahl, eine pro Person und Gegenstand. Rein, ohne DOM und
// Netz – Worker (Prüfen, Zählen) und Oberfläche (Texte, Icons, Umschalten) nutzen dieselben Regeln.

export const REACTION_KINDS = ['like', 'mast', 'tack'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** Anzeige: Text und Icon-Name (src/components/icons.ts). */
export const REACTIONS: ReadonlyArray<{ kind: ReactionKind; label: string; icon: 'heart' | 'mast' | 'tack' }> = [
  { kind: 'like', label: 'Gefällt mir', icon: 'heart' },
  { kind: 'mast', label: 'Mast- und Schotbruch', icon: 'mast' },
  { kind: 'tack', label: 'Starker Schlag', icon: 'tack' },
];

export const REACTION_LABEL: Record<ReactionKind, string> = { like: 'Gefällt mir', mast: 'Mast- und Schotbruch', tack: 'Starker Schlag' };

/** Gegenstände: Törn, Beitrag, Foto oder eine Aktivität (Mitglied, Boot, Hafen, Meilenstein). */
export const REACTION_SUBJECTS = ['share', 'post', 'photo', 'activity'] as const;
export type ReactionSubject = (typeof REACTION_SUBJECTS)[number];

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

export const isReactionKind = oneOf(REACTION_KINDS);
export const isReactionSubject = oneOf(REACTION_SUBJECTS);

/** Grenzen (Konzept 12.8). */
export const REACTION_LIMITS = {
  /** Änderungen (setzen, ändern, zurücknehmen) je Konto und Tag */
  perDay: 300,
  /** Namen in „Wer hat reagiert“ */
  who: 50,
} as const;

/** Zähler je Art und die eigene Reaktion. */
export interface ReactionSummary {
  counts: Record<ReactionKind, number>;
  mine: ReactionKind | null;
}

export const emptyReactions = (): ReactionSummary => ({ counts: { like: 0, mast: 0, tack: 0 }, mine: null });

/** Aus Zeilen „Art, Anzahl, eigene?“ eine Zusammenfassung bauen (unbekannte Arten werden ignoriert). */
export function summarizeReactions(rows: Array<{ kind: string; n: number; mine?: number | boolean | null }>): ReactionSummary {
  const out: ReactionSummary = { counts: { like: 0, mast: 0, tack: 0 }, mine: null };
  for (const r of rows) {
    if (!isReactionKind(r.kind)) continue;
    out.counts[r.kind] += Number(r.n) || 0;
    if (r.mine) out.mine = r.kind;
  }
  return out;
}

export const reactionTotal = (s: ReactionSummary): number => REACTION_KINDS.reduce((n, k) => n + (s.counts[k] ?? 0), 0);

/**
 * Was ein Klick auf `kind` bewirkt: dieselbe Art noch einmal nimmt zurück (null), eine andere ersetzt.
 * Liefert zugleich die neue Zusammenfassung für die sofortige Anzeige (optimistisch).
 */
export function toggleReaction(s: ReactionSummary, kind: ReactionKind): { next: ReactionKind | null; summary: ReactionSummary } {
  const counts = { ...s.counts };
  if (s.mine) counts[s.mine] = Math.max(0, counts[s.mine] - 1);
  const next = s.mine === kind ? null : kind;
  if (next) counts[next] += 1;
  return { next, summary: { counts, mine: next } };
}

/** Kurztext für Screenreader und Titel: „3 Reaktionen“. */
export function reactionCountText(s: ReactionSummary): string {
  const n = reactionTotal(s);
  return n === 1 ? '1 Reaktion' : `${n} Reaktionen`;
}
