// Moderation 3, 6, 8 (Roadmap, Konzept 35; REQUIREMENTS „Moderation: Hinweise für Admins und Begründung an
// Betroffene“, F-570 … F-575): reine Regeln für den Zähler offener Meldungen, die Begründungsmail nach einer
// Meldungs-Entscheidung (DSA Art. 17) und den Vorschlag „Sperren statt Löschen“ in der Meldungsansicht.
import { REPORT_REASON_LABEL, type ReportKind } from './comment-text';
import type { AdminKind } from './admin';

/** `cover`: nur das Titelbild entfernt, Profil/Boot/Gruppe wieder sichtbar (F-564) */
export type ReportDecision = 'keep' | 'hide' | 'delete' | 'cover';

export const REPORT_NOTICE_LIMITS = {
  /** Begründungsmails je Konto in 24 h, wenn nur „Spam“ gemeldet wurde (DSA Art. 17 Abs. 2: Spam in Massen) */
  spamPerOwnerPerDay: 3,
  /** Begründungsmails insgesamt in 24 h (Mail-Budget); darüber wird entschieden, aber nicht gemailt */
  perDay: 30,
} as const;

/**
 * Gründe, bei denen der Beleg zählt: In der Meldungsansicht ist „Sperren“ dann die vorgeschlagene Entscheidung statt
 * „Löschen“ (Konzept 35.1 „Beweissicherung“). Als Zeichenketten, damit künftige Gründe (z. B. `minors`) ohne Typfehler
 * dazukommen.
 */
export const EVIDENCE_REASONS: readonly string[] = ['illegal', 'minors'];

/** Soll „Sperren“ statt „Löschen“ vorgeschlagen werden? */
export const suggestLock = (reasons: Partial<Record<string, number>>): boolean => EVIDENCE_REASONS.some((r) => (reasons[r] ?? 0) > 0);

/**
 * Was „Sperren“ aus der Meldungsansicht trifft (Konzept 18.2): Törn, Boot, Gruppe und Hafen sich selbst, ein Profil
 * das Konto. Kommentare, Fotos und Beiträge lassen sich nicht einzeln sperren – dort sichert die Sperre des Kontos der
 * Autor:in den Beleg (solange Törn bzw. Gruppe bestehen, F-575). Ohne Eigentümer:in → null.
 */
export function reportLockTarget(kind: ReportKind, targetId: string, ownerId: string | null | undefined): { kind: AdminKind; id: string; account: boolean } | null {
  switch (kind) {
    case 'share':
      return { kind: 'shares', id: targetId, account: false };
    case 'boat':
      return { kind: 'boats', id: targetId, account: false };
    case 'group':
      return { kind: 'groups', id: targetId, account: false };
    case 'harbor':
      return { kind: 'harbors', id: targetId, account: false };
    case 'profile':
      return { kind: 'users', id: targetId, account: true };
    default:
      return ownerId ? { kind: 'users', id: ownerId, account: true } : null;
  }
}

/** Gründe in der Mail an Betroffene – in der dritten Person (die Liste der Meldenden spricht in der ersten). */
const NOTICE_REASON: Partial<Record<string, string>> = {
  spam: 'Spam oder Werbung',
  abuse: 'beleidigend oder belästigend',
  illegal: 'rechtswidriger Inhalt',
  depicted: 'Recht am eigenen Bild: eine abgebildete Person möchte nicht gezeigt werden',
  minors: 'Schutz von Kindern: ein Kind ist abgebildet',
  other: 'sonstiger Grund',
};

/** Gründe der Meldungen für die Mail, häufigster zuerst, ohne Anzahl und ohne Anmerkungen (die verrieten Meldende). */
export function noticeReasons(counts: Partial<Record<string, number>>): string[] {
  return Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]))
    .map(([r]) => NOTICE_REASON[r] ?? (REPORT_REASON_LABEL as Partial<Record<string, string>>)[r] ?? 'sonstiger Grund')
    .filter((v, i, all) => all.indexOf(v) === i);
}

/**
 * Gründe, nach denen die Entscheidung auf Recht gestützt ist (DSA Art. 17 Abs. 3 lit. d/e): rechtswidrig bzw. Rechte
 * Dritter verletzt. Alle anderen Gründe: Verstoß gegen die Regeln der Plattform.
 */
const LEGAL_REASONS: readonly string[] = ['illegal', 'minors', 'depicted'];

/** Grundlage der Entscheidung für die Begründungsmail: Recht (Gesetz) oder Regeln der Plattform. */
export const decisionGround = (reasons: Partial<Record<string, number>>): 'law' | 'rules' =>
  LEGAL_REASONS.some((r) => (reasons[r] ?? 0) > 0) ? 'law' : 'rules';

/**
 * Bekommt die Eigentümer:in eine Begründung? Ausblenden, Löschen und „Nur Titelbild entfernen“ immer (DSA Art. 17), „Behalten“ nur, wenn der
 * Inhalt bis dahin ausgeblendet oder sein Titelbild zurückgehalten war (er ist dann wieder sichtbar); nicht an die entscheidende Person selbst. Nur
 * Spam-Meldungen: höchstens `spamPerOwnerPerDay` Mails je Konto und Tag; insgesamt höchstens `perDay` in 24 h.
 */
export function shouldNotify(m: { decision: ReportDecision; wasHidden: boolean; reasons: Partial<Record<string, number>>; sentToday: number; sentTotal: number; selfDecided: boolean }): boolean {
  if (m.selfDecided) return false;
  if (m.decision === 'keep' && !m.wasHidden) return false;
  if (m.sentTotal >= REPORT_NOTICE_LIMITS.perDay) return false;
  const onlySpam = Object.entries(m.reasons).every(([r, n]) => r === 'spam' || !n);
  return !(onlySpam && m.sentToday >= REPORT_NOTICE_LIMITS.spamPerOwnerPerDay);
}

/** Zähler am Konto-Knopf: ab 100 „99+“, 0 → leer. */
export const reportBadge = (n: number | null | undefined): string => (!n || n < 1 ? '' : n > 99 ? '99+' : String(n));

/** „1 offene Meldung“ / „3 offene Meldungen“ zum Zähler (leer bei 0). */
export const openReportsLabel = (badge: string): string => (!badge ? '' : `${badge} offene ${badge === '1' ? 'Meldung' : 'Meldungen'}`);
