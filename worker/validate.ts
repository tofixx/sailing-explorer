// Reine Validierungsfunktionen – ohne Worker-APIs, damit sie unit-testbar sind.
import { SUPPORT_TIERS } from '../src/domain/support';
import { isVisibility, type Visibility } from '../src/domain/visibility';
import { DEFAULT_FREE_SHARES, SHARE_IMAGE_BYTES, SHARE_UPLOAD_BYTES, STORAGE_HARD_BYTES, STORAGE_SOFT_BYTES, limitsFor } from '../src/domain/limits';
import {
  isCommentsMode, isNotifyMode, isReportKind, isReportReason,
  type CommentsMode, type NotifyMode, type ReportKind, type ReportReason,
} from '../src/domain/comment-text';

/**
 * Technische Obergrenzen einzelner Anfragen. Kontingente pro Konto (Törns, Speicher, Boote, Fotos) stehen je Stufe
 * in src/domain/limits.ts (limitsFor).
 */
export const LIMITS = {
  /** komprimierte Upload-Größe */
  uploadBytes: SHARE_UPLOAD_BYTES,
  tracksPerShare: 20,
  titleLength: 120,
  summaryLength: 200,
  viewLength: 200,
  emailLength: 254,
  /** Übersichtsbild einer Freigabe */
  imageBytes: SHARE_IMAGE_BYTES,
  nameLength: 80,
  bioLength: 500,
} as const;

export const SHARE_ID_RE = /^[A-Za-z0-9]{12,32}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

export type { Visibility };

/** Steuerzeichen, Zero-Width- und Bidi-Override-Zeichen (Spoofing in Titeln). */
function isInvisible(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/** Entfernt Steuerzeichen, normalisiert Leerraum und kürzt. */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFC')
    .replace(/./gsu, (ch) => (isInvisible(ch.codePointAt(0) ?? 0) ? ' ' : ch))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (email.length > LIMITS.emailLength) return null;
  // Bewusst schlicht: genau ein @, Domain mit Punkt, keine Leerzeichen/Steuerzeichen.
  if (!/^[^\s@<>()[\]\\,;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) return null;
  return email;
}

/** Sichtbarkeit von Törns, Booten und Profilen: public | unlisted | private (Konzept 1.1). Alles andere → null. */
export function parseVisibility(input: unknown): Visibility | null {
  return isVisibility(input) ? input : null;
}

/** Ansichtszustand ist ein Querystring-Fragment wie "m=wind&l=s,w" – nur bekannte Zeichen. */
export function cleanView(input: unknown): string {
  const s = cleanText(input, LIMITS.viewLength);
  return /^[a-z0-9=&,._-]*$/i.test(s) ? s : '';
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 18 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08;
}

/** Der entpackte Payload muss mit diesem Präfix beginnen (Format-Version 1). */
export const PAYLOAD_PREFIX = '{"v":1,';

/** Nur same-origin-Mutationen erlauben (zusätzlich zu SameSite=Lax). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export const BOAT_ID_RE = SHARE_ID_RE;

// ---------------------------------------------------------------- Einladungen

/** Arten von Einladungen (Konzept 10): Boots-Admin oder Crew auf einem Törn. */
export const INVITE_KINDS = ['boat_admin', 'crew'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export function parseInviteKind(input: unknown): InviteKind | null {
  return typeof input === 'string' && (INVITE_KINDS as readonly string[]).includes(input) ? (input as InviteKind) : null;
}

// ---------------------------------------------------------------- Unterstützen

/** Kostenlose Freigaben pro Konto aus der Konfiguration (Standard 3, nie über der Unterstützer-Grenze). */
export function parseFreeShares(input: unknown, fallback = DEFAULT_FREE_SHARES): number {
  const n = typeof input === 'string' && /^\d{1,4}$/.test(input.trim()) ? Number(input.trim()) : fallback;
  return Math.min(n, limitsFor('supporter').shares);
}

/** Schwellen der Notbremse (Konzept 5.2) aus den Worker-Variablen; soft nie über hard. */
export function storageThresholds(vars: { STORAGE_SOFT_BYTES?: string; STORAGE_HARD_BYTES?: string }): { soft: number; hard: number } {
  const hard = parseByteSize(vars.STORAGE_HARD_BYTES, STORAGE_HARD_BYTES);
  return { soft: Math.min(parseByteSize(vars.STORAGE_SOFT_BYTES, STORAGE_SOFT_BYTES), hard), hard };
}

/** Byte-Angabe aus einer Worker-Variable (nur Ziffern, z. B. Schwellen der Notbremse); sonst der Standard. */
export function parseByteSize(input: unknown, fallback: number): number {
  return typeof input === 'string' && /^\d{1,16}$/.test(input.trim()) ? Number(input.trim()) : fallback;
}

/** Betrag (Cent) nur aus den festen Slider-Stufen – keine frei wählbaren Summen. */
export function parseSupportAmount(input: unknown): number | null {
  return typeof input === 'number' && SUPPORT_TIERS.some((t) => t.amount === input) ? input : null;
}

/** Zerlegt den Stripe-Signature-Header „t=…,v1=…,v1=…“ (unbekannte Schemata wie v0 werden ignoriert). */
export function parseStripeSignature(header: string | null): { timestamp: number; signatures: string[] } | null {
  if (!header || header.length > 2048) return null;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) signatures.push(v);
  }
  return Number.isFinite(timestamp) && signatures.length ? { timestamp, signatures } : null;
}

/** Vergleich in konstanter Laufzeit (bei gleicher Länge) – gegen Timing-Angriffe auf Signaturen. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Reservierte Profilnamen (Routen, Verwechslungsgefahr). */
const RESERVED = new Set(['admin', 'api', 'app', 'login', 'logout', 'me', 'settings', 'support', 'help', 'sailing', 'wollow', 'root', 'system', 'null', 'undefined']);

/** Profilname: 3–30 Zeichen a–z, 0–9, Bindestrich; nicht am Rand, nicht reserviert. */
export function normalizeHandle(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const h = input.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(h) || h.includes('--') || RESERVED.has(h)) return null;
  return h;
}

// ---------------------------------------------------------------- Kommentare & Melden (Phase D)

/** Kommentare am Törn: on | off | hidden (Konzept 4.1). */
export const parseCommentsMode = (input: unknown): CommentsMode | null => (isCommentsMode(input) ? input : null);
/** Mail-Benachrichtigung über neue Kommentare: off | daily. */
export const parseNotifyMode = (input: unknown): NotifyMode | null => (isNotifyMode(input) ? input : null);
/** Meldbare Objekte (Fotos folgen mit Phase C). */
export const parseReportKind = (input: unknown): ReportKind | null => (isReportKind(input) ? input : null);
export const parseReportReason = (input: unknown): ReportReason | null => (isReportReason(input) ? input : null);
export const COMMENT_ID_RE = SHARE_ID_RE;

/** Konto-IDs aus ADMIN_USER_IDS (kommagetrennt). Ungültige Einträge werden ignoriert; leer = niemand (fail closed). */
export function adminIds(env: { ADMIN_USER_IDS?: string }): Set<string> {
  return new Set(
    (env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => SHARE_ID_RE.test(s)),
  );
}

export const isAdmin = (env: { ADMIN_USER_IDS?: string }, userId: string | null | undefined): boolean => !!userId && adminIds(env).has(userId);
