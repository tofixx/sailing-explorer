// Kommentartext (Konzept 4.1): reiner Text, Auto-Links nur für http(s), keine HTML-Auswertung.
// Rein, ohne DOM – genutzt vom Worker (Prüfen) und von der Oberfläche (Darstellung, Zeichenzähler).

/** Höchstlänge in Zeichen (Codepoints) nach dem Bereinigen. */
export const COMMENT_MAX = 1000;
/** Höchstens so viele Links pro Kommentar (sonst 400). */
export const COMMENT_MAX_LINKS = 2;
/** Höchstens so viele Leerzeilen hintereinander. */
const MAX_BLANK_LINES = 3;

/** Steuerzeichen (außer Zeilenumbruch), Zero-Width- und Bidi-Override-Zeichen (Spoofing). */
function isInvisible(cp: number): boolean {
  return (
    (cp < 0x20 && cp !== 0x0a) ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

/**
 * Bereinigt einen Kommentar: NFC, Zeilenumbrüche vereinheitlicht, unsichtbare Zeichen und Tabs zu Leerzeichen,
 * Leerraum je Zeile zusammengefasst, höchstens 3 Leerzeilen am Stück, außen getrimmt. Kürzt nicht –
 * zu lange Texte lehnt der Server ab (der Zähler in der Oberfläche zeigt die Grenze vorher).
 */
export function cleanComment(input: unknown): string {
  if (typeof input !== 'string') return '';
  const lines = input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/./gsu, (ch) => (ch !== '\n' && isInvisible(ch.codePointAt(0) ?? 0) ? ' ' : ch))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim());
  const out: string[] = [];
  let blank = 0;
  for (const l of lines) {
    blank = l ? 0 : blank + 1;
    if (blank <= MAX_BLANK_LINES) out.push(l);
  }
  return out.join('\n').trim();
}

/** Länge in Codepoints (Emojis zählen als ein Zeichen, wie im Zähler der Oberfläche). */
export const commentLength = (s: string): number => [...s].length;

export type CommentPart = { text: string; href?: undefined } | { text: string; href: string };

// http(s)-URL bis zum nächsten Leerraum; abschließende Satzzeichen gehören nicht dazu.
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}»“”'"]+$/;

/** Zerlegt den Text in Textstücke und Links. Links nur mit gültiger http(s)-URL samt Host. */
export function linkify(text: string): CommentPart[] {
  const parts: CommentPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    const trail = TRAILING.exec(raw);
    // Klammer am Ende nur abschneiden, wenn sie nicht zur URL gehört (Wikipedia-Links mit „(…)“).
    if (trail) raw = raw.slice(0, raw.length - trail[0].length) + (trail[0].startsWith(')') && raw.includes('(') ? ')' : '');
    let href: string | null = null;
    try {
      const u = new URL(raw);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) href = u.href;
    } catch {
      href = null;
    }
    if (!href) continue;
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Anzahl der Links, die die Oberfläche klickbar machen würde. */
export const countLinks = (text: string): number => linkify(text).filter((p) => p.href).length;

export type CommentProblem = 'empty' | 'too_long' | 'too_many_links';

/** Prüft einen bereinigten Kommentar; null = in Ordnung. */
export function commentProblem(clean: string): CommentProblem | null {
  if (!clean) return 'empty';
  if (commentLength(clean) > COMMENT_MAX) return 'too_long';
  if (countLinks(clean) > COMMENT_MAX_LINKS) return 'too_many_links';
  return null;
}

// ---------------------------------------------------------------- Melden

export const REPORT_KINDS = ['share', 'comment', 'photo', 'profile', 'boat', 'group', 'post', 'harbor'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_REASONS = ['spam', 'abuse', 'illegal', 'depicted', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  spam: 'Spam oder Werbung',
  abuse: 'Beleidigend oder belästigend',
  illegal: 'Rechtswidriger Inhalt',
  depicted: 'Ich bin abgebildet bzw. genannt und möchte das nicht',
  other: 'Sonstiges',
};

/** Höchstlänge der Anmerkung zu einer Meldung. */
export const REPORT_NOTE_MAX = 500;

/** Bezeichnung der Art in Dialogen und der Admin-Liste. */
export const REPORT_KIND_LABEL: Record<ReportKind, string> = { share: 'Törn', comment: 'Kommentar', photo: 'Foto', profile: 'Profil', boat: 'Boot', group: 'Gruppe', post: 'Beitrag', harbor: 'Hafen' };

// ---------------------------------------------------------------- Einstellungen

export const COMMENTS_MODES = ['on', 'off', 'hidden'] as const;
export type CommentsMode = (typeof COMMENTS_MODES)[number];

export const COMMENTS_MODE_LABEL: Record<CommentsMode, string> = {
  on: 'Kommentare an',
  off: 'Keine neuen Kommentare',
  hidden: 'Kommentare ausblenden',
};

export const NOTIFY_MODES = ['off', 'daily'] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

export const isReportKind = oneOf(REPORT_KINDS);
export const isReportReason = oneOf(REPORT_REASONS);
export const isCommentsMode = oneOf(COMMENTS_MODES);
export const isNotifyMode = oneOf(NOTIFY_MODES);
