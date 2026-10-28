// Verifizierte Vertretung von Vereinen und Häfen (Konzept 20, F-360 ff.): Arten, Status, Grenzen, Feldprüfung und
// Texte. Rein, ohne DOM und Netz – Worker (Antrag, Entscheidung, Aufräumen) und Oberfläche nutzen dieselben Regeln.
const DAY = 86_400_000;

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

/** Was sich verifizieren lässt: Vereine (Gruppen der Art `club`) und Häfen. Teams, Boote, Profile nicht (20.1). */
export const CLAIM_KINDS = ['group', 'harbor'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const isClaimKind = oneOf(CLAIM_KINDS);

/** `expired`: offen ohne Entscheidung abgelaufen, `withdrawn`: zurückgezogen – beide zählen weiter zur Grenze (20.7, 20.8). */
export const CLAIM_STATUSES = ['open', 'accepted', 'rejected', 'expired', 'withdrawn'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const isClaimStatus = oneOf(CLAIM_STATUSES);

/** Was beim Annehmen mit der bisherigen Eigner:in eines Vereins geschieht (20.3); Standard `admin`. */
export const PREVIOUS_ACTIONS = ['admin', 'member', 'remove'] as const;
export type PreviousAction = (typeof PREVIOUS_ACTIONS)[number];
export const isPreviousAction = oneOf(PREVIOUS_ACTIONS);
/** Folge für die verdrängte Person, als Satzende in Glocke und Mail (Häfen haben keine Rolle danach). */
export function transferConsequence(kind: ClaimKind, action: unknown): string {
  if (kind === 'harbor') return 'du kannst ihn nicht mehr bearbeiten';
  return action === 'member' ? 'du bist jetzt einfaches Mitglied' : action === 'remove' ? 'du bist nicht mehr Mitglied' : 'du bleibst Admin';
}
export const PREVIOUS_ACTION_LABEL: Record<PreviousAction, string> = {
  admin: 'bleibt Admin',
  member: 'wird einfaches Mitglied',
  remove: 'verlässt den Verein',
};

export const CLAIM_LIMITS = {
  roleMin: 3,
  roleMax: 80,
  reasonMin: 20,
  reasonMax: 1000,
  contactMin: 5,
  contactMax: 200,
  evidenceMax: 300,
  noteMin: 10,
  noteMax: 500,
  /** offene Anträge je Konto */
  openPerUser: 3,
  /** Anträge je Konto im Fenster (auch zurückgezogene und abgelehnte) */
  perWindow: 5,
  windowMs: 30 * DAY,
  /** nach Ablehnung erneut auf dasselbe Objekt frühestens nach */
  retryMs: 30 * DAY,
  /** offene Anträge je Objekt */
  openPerTarget: 10,
  /** Angaben angenommener Anträge werden nach dieser Frist geleert (Widerspruchsfrist) */
  keepDetailsMs: 30 * DAY,
  /** abgelehnte und abgelaufene Anträge werden nach dieser Frist gelöscht (Wartefrist) */
  keepRejectedMs: 30 * DAY,
  /** offene Anträge laufen nach dieser Frist ohne Entscheidung ab */
  openMaxMs: 180 * DAY,
} as const;

export interface ClaimInput {
  role: string;
  reason: string;
  contact: string;
  evidenceUrl: string;
}

/** Steuerzeichen raus, Leerraum zusammenfassen (Zeilenumbrüche in der Begründung bleiben). */
function clean(v: unknown, multiline = false): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ');
  return (multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ')).trim();
}

/** Nur `https://`-Adressen mit Host, ohne Zugangsdaten. */
export function parseEvidenceUrl(v: unknown): string | null {
  const s = clean(v);
  if (!s) return '';
  if (s.length > CLAIM_LIMITS.evidenceMax) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Prüft die Felder des Antrags (F-360). Fehler als Feldname, sonst die bereinigten Werte. */
export function parseClaimInput(raw: Record<string, unknown>): ClaimInput | { error: keyof ClaimInput } {
  const L = CLAIM_LIMITS;
  const role = clean(raw.role);
  const reason = clean(raw.reason, true);
  const contact = clean(raw.contact);
  const evidenceUrl = parseEvidenceUrl(raw.evidenceUrl);
  if (role.length < L.roleMin || role.length > L.roleMax) return { error: 'role' };
  if (reason.length < L.reasonMin || reason.length > L.reasonMax) return { error: 'reason' };
  if (contact.length < L.contactMin || contact.length > L.contactMax) return { error: 'contact' };
  if (evidenceUrl === null) return { error: 'evidenceUrl' };
  return { role, reason, contact, evidenceUrl };
}

export const CLAIM_FIELD_ERROR: Record<keyof ClaimInput, string> = {
  role: `Funktion: ${CLAIM_LIMITS.roleMin}–${CLAIM_LIMITS.roleMax} Zeichen, z. B. „1. Vorsitzende“ oder „Hafenmeister“.`,
  reason: `Begründung: ${CLAIM_LIMITS.reasonMin}–${CLAIM_LIMITS.reasonMax} Zeichen.`,
  contact: `Kontakt: ${CLAIM_LIMITS.contactMin}–${CLAIM_LIMITS.contactMax} Zeichen – Telefon oder Mail-Adresse des Vereins bzw. Hafens.`,
  evidenceUrl: `Beleg-Link: eine https://-Adresse mit höchstens ${CLAIM_LIMITS.evidenceMax} Zeichen – oder leer lassen.`,
};

/** Begründung der Moderation (Ablehnen, Entziehen): Pflicht, 10–500 Zeichen. */
export function parseDecisionNote(v: unknown): string | null {
  const s = clean(v, true);
  return s.length >= CLAIM_LIMITS.noteMin && s.length <= CLAIM_LIMITS.noteMax ? s : null;
}

/** Abzeichen (F-366): Text und Erklärung je Art. */
export const VERIFIED_LABEL = 'Verifiziert';
export const verifiedHint = (kind: ClaimKind): string =>
  `Von Sail Explorer bestätigt: wird ${kind === 'group' ? 'vom Verein' : 'vom Hafen'} selbst verwaltet.`;

export const CLAIM_KIND_LABEL: Record<ClaimKind, string> = { group: 'Verein', harbor: 'Hafen' };

/** Stand des eigenen Antrags, wie ihn die Seite zeigt. */
export interface MyClaim {
  id: string;
  status: ClaimStatus;
  createdAt: number;
  decidedAt: number | null;
  /** Begründung der Moderation (nur bei Ablehnung) */
  note: string;
}

/** Satz für die Glocke und Mails (`claim_result`). */
export function claimResultText(status: ClaimStatus, title: string): string {
  const t = `„${title}“`;
  switch (status) {
    case 'accepted':
      return `Dein Antrag für ${t} wurde angenommen – du verwaltest ihn jetzt, verifiziert`;
    case 'rejected':
      return `Dein Antrag für ${t} wurde abgelehnt`;
    case 'expired':
      return `Dein Antrag für ${t} ist ohne Entscheidung abgelaufen`;
    default:
      return `Dein Antrag für ${t} ist in Prüfung`;
  }
}
