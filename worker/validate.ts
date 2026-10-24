// Reine Validierungsfunktionen – ohne Worker-APIs, damit sie unit-testbar sind.

export const LIMITS = {
  /** komprimierte Upload-Größe */
  uploadBytes: 12 * 1024 * 1024,
  tracksPerShare: 20,
  titleLength: 120,
  summaryLength: 200,
  viewLength: 200,
  emailLength: 254,
  sharesPerUser: 500,
  /** Speicher pro Konto (komprimiert) */
  bytesPerUser: 200 * 1024 * 1024,
  boatsPerUser: 50,
  /** Übersichtsbild einer Freigabe */
  imageBytes: 1.5 * 1024 * 1024,
  nameLength: 80,
  bioLength: 500,
} as const;

export const SHARE_ID_RE = /^[A-Za-z0-9]{12,32}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

export type Visibility = 'unlisted' | 'private';

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

export function parseVisibility(input: unknown): Visibility | null {
  return input === 'unlisted' || input === 'private' ? input : null;
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

/** Sichtbarkeit von Profilen und Booten. */
export function parsePublicVisibility(input: unknown): 'public' | 'private' | null {
  return input === 'public' || input === 'private' ? input : null;
}

// ---------------------------------------------------------------- Unterstützen

/** Kostenlose Freigaben pro Konto aus der Konfiguration (Standard 3, nie über dem Gesamtlimit). */
export function parseFreeShares(input: unknown, fallback = 3): number {
  const n = typeof input === 'string' && /^\d{1,4}$/.test(input.trim()) ? Number(input.trim()) : fallback;
  return Math.min(n, LIMITS.sharesPerUser);
}

/** Öffentlicher Payment-Link: nur https, ohne Zugangsdaten und ohne eigenen Querystring. */
export function parseSupportLink(input: unknown): string | null {
  if (typeof input !== 'string' || !input) return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
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
