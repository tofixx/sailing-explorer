import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { randomId, randomToken, sha256Hex } from '../worker/crypto';
import { CONTENT_SECURITY_POLICY, PAGE_HEADERS } from '../worker/security';
import { SHARE_ID_RE, TOKEN_RE, cleanText, cleanView, isGzip, isSameOrigin, maskEmail, normalizeEmail, normalizeHandle, parseInviteKind, parseVisibility } from '../worker/validate';

describe('Validierung', () => {
  it('cleanText entfernt Steuer- und Bidi-Zeichen und kürzt', () => {
    expect(cleanText('  Hallo\u0000\nWelt  ', 50)).toBe('Hallo Welt');
    expect(cleanText('abc‮evil', 50)).toBe('abc evil');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
    expect(cleanText(42, 10)).toBe('');
  });

  it('normalizeEmail', () => {
    expect(normalizeEmail(' Tobias@Example.ORG ')).toBe('tobias@example.org');
    expect(normalizeEmail('kein-at')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('a b@c.de')).toBeNull();
    expect(normalizeEmail('"x"<a@b.de>')).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@b.de`)).toBeNull();
  });

  it('Sichtbarkeit und Ansicht', () => {
    expect(parseVisibility('private')).toBe('private');
    expect(parseVisibility('unlisted')).toBe('unlisted');
    expect(parseVisibility('public')).toBe('public');
    expect(parseVisibility('Public')).toBeNull();
    expect(parseVisibility('')).toBeNull();
    expect(parseVisibility(undefined)).toBeNull();
    expect(cleanView('m=wind&l=s,w')).toBe('m=wind&l=s,w');
    expect(cleanView('m=<script>')).toBe('');
  });

  it('gzip-Erkennung', () => {
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 0x08, ...new Array(20).fill(0)]))).toBe(true);
    expect(isGzip(new TextEncoder().encode('{"v":1,"tracks":[]} padding padding'))).toBe(false);
  });

  it('Same-Origin-Prüfung', () => {
    const req = (h: Record<string, string>) => new Request('https://sailing.wollow.ski/api/shares', { method: 'POST', headers: h });
    expect(isSameOrigin(req({ Origin: 'https://sailing.wollow.ski' }))).toBe(true);
    expect(isSameOrigin(req({ Origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOrigin(req({ 'Sec-Fetch-Site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(req({}))).toBe(false);
  });
});

describe('Krypto', () => {
  it('IDs und Tokens haben genug Entropie und passendes Format', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(SHARE_ID_RE);
    expect(randomToken()).toMatch(TOKEN_RE);
  });
  it('sha256Hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('Security-Header', () => {
  it('public/_headers stimmt mit worker/security.ts überein', () => {
    const file = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    for (const [k, v] of Object.entries(PAGE_HEADERS)) expect(file).toContain(`  ${k}: ${v}\n`);
  });
  it('CSP erlaubt keine Inline-Skripte und kein eval', () => {
    const script = CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });
});

describe('Profile & Boote – Validierung', () => {
  it('[F-41] Profilnamen: Format, Länge, reservierte Namen', () => {
    expect(normalizeHandle(' Tobias-Test ')).toBe('tobias-test');
    expect(normalizeHandle('ab')).toBeNull();
    expect(normalizeHandle('-tobias')).toBeNull();
    expect(normalizeHandle('to--bias')).toBeNull();
    expect(normalizeHandle('tobias_1')).toBeNull();
    expect(normalizeHandle('admin')).toBeNull();
    expect(normalizeHandle('a'.repeat(31))).toBeNull();
  });
  it('[F-80] Sichtbarkeit von Profil/Boot: dieselben drei Stufen wie Törns', () => {
    for (const v of ['public', 'unlisted', 'private']) expect(parseVisibility(v)).toBe(v);
    expect(parseVisibility('listed')).toBeNull();
  });
});

describe('Einladungen: reine Hilfen', () => {
  it('[F-131] maskEmail zeigt nur ersten Buchstaben und Domain', () => {
    expect(maskEmail('anna@example.org')).toBe('a…@example.org');
    expect(maskEmail('x@y.de')).toBe('x…@y.de');
    expect(maskEmail('kaputt')).toBe('…');
  });

  it('[F-130] parseInviteKind kennt nur boat_admin und crew', () => {
    expect(parseInviteKind('boat_admin')).toBe('boat_admin');
    expect(parseInviteKind('crew')).toBe('crew');
    for (const v of ['owner', '', null, 1, 'CREW']) expect(parseInviteKind(v)).toBeNull();
  });
});
