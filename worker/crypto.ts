const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Kurze, URL-taugliche ID. 18 Zeichen aus 56 Symbolen ≈ 104 Bit Zufall. */
export function randomId(length = 18): string {
  const out: string[] = [];
  // Rejection sampling, damit alle Zeichen gleich wahrscheinlich sind.
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit) out.push(ALPHABET[b % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** 6-stelliger Anmeldecode, gleichverteilt (Verwerfen statt Modulo-Verzerrung). */
export function randomCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4_294_000_000) return String(buf[0] % 1_000_000).padStart(6, '0');
  }
}

/** 256-Bit-Geheimnis als base64url (für Session- und Login-Tokens). */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
