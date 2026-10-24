// Unit-Tests der reinen Zugriffsregeln (worker/access.ts) – Konzept 1–2, F-90 … F-93.
import { describe, expect, it } from 'vitest';
import { canView, newShareKey, nextShareKey, requestKey } from '../worker/access';
import { SHARE_KEY_RE } from '../src/domain/visibility';

const KEY = 'AbCdEfGhJkLmNpQrStUv23';
const anon = (key: string | null = null) => ({ manager: false, key });

describe('canView', () => {
  it('Verwalter sehen alles, auch ohne Schlüssel', () => {
    for (const visibility of ['public', 'unlisted', 'private'] as const) {
      expect(canView({ visibility, shareKey: KEY }, { manager: true, key: null })).toBe(true);
    }
  });

  it('öffentlich: immer, ein (auch falscher) Schlüssel wird ignoriert', () => {
    expect(canView({ visibility: 'public', shareKey: null }, anon())).toBe(true);
    expect(canView({ visibility: 'public', shareKey: KEY }, anon('falsch'))).toBe(true);
  });

  it('privat: nie für andere, auch nicht mit dem gespeicherten Schlüssel', () => {
    expect(canView({ visibility: 'private', shareKey: KEY }, anon(KEY))).toBe(false);
    expect(canView({ visibility: 'private', shareKey: null }, anon(), true)).toBe(false);
  });

  it('nur mit Link: genau der gespeicherte Schlüssel', () => {
    const obj = { visibility: 'unlisted', shareKey: KEY } as const;
    expect(canView(obj, anon(KEY))).toBe(true);
    expect(canView(obj, anon())).toBe(false);
    expect(canView(obj, anon(KEY.slice(1)))).toBe(false);
    expect(canView(obj, anon(KEY.toLowerCase()))).toBe(false);
    expect(canView(obj, anon('!'))).toBe(false);
  });

  it('Altbestand ohne Schlüssel: nur bei Törns (legacyWithoutKey) erreichbar, sonst fail closed', () => {
    const legacy = { visibility: 'unlisted', shareKey: null } as const;
    expect(canView(legacy, anon(), true)).toBe(true);
    expect(canView(legacy, anon(KEY), true)).toBe(true);
    expect(canView(legacy, anon())).toBe(false);
    expect(canView(legacy, anon(KEY))).toBe(false);
  });
});

describe('nextShareKey', () => {
  const make = () => 'NEW';
  it('neu „Nur mit Link“ bekommt einen Schlüssel, öffentlich und privat nicht', () => {
    expect(nextShareKey(null, 'unlisted', null, false, true, make)).toBe('NEW');
    expect(nextShareKey(null, 'public', null, false, true, make)).toBeNull();
    expect(nextShareKey(null, 'private', null, false, true, make)).toBeNull();
  });

  it('Wechsel auf „Nur mit Link“ nutzt einen vorhandenen Schlüssel weiter', () => {
    expect(nextShareKey('private', 'unlisted', KEY, false, true, make)).toBe(KEY);
    expect(nextShareKey('public', 'unlisted', null, false, true, make)).toBe('NEW');
    expect(nextShareKey('unlisted', 'private', KEY, false, true, make)).toBe(KEY);
    expect(nextShareKey('unlisted', 'public', KEY, false, true, make)).toBe(KEY);
  });

  it('Altbestand bleibt ohne Schlüssel, solange er „Nur mit Link“ bleibt (nur Törns)', () => {
    expect(nextShareKey('unlisted', 'unlisted', null, false, true, make)).toBeNull();
    expect(nextShareKey('unlisted', 'unlisted', null, false, false, make)).toBe('NEW');
  });

  it('rotate erzeugt immer einen neuen Schlüssel', () => {
    for (const v of ['public', 'unlisted', 'private'] as const) expect(nextShareKey(v, v, KEY, true, true, make)).toBe('NEW');
  });

  it('newShareKey: 22 Zeichen (≈ 128 Bit) in Schlüssel-Form, zufällig', () => {
    const a = newShareKey();
    expect(a).toHaveLength(22);
    expect(SHARE_KEY_RE.test(a)).toBe(true);
    expect(newShareKey()).not.toBe(a);
  });
});

describe('requestKey', () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
  it('liest X-Share-Key; ?k= nur, wenn erlaubt (Bilder)', () => {
    expect(requestKey(req('https://x/api/shares/a', { 'X-Share-Key': KEY }))).toBe(KEY);
    expect(requestKey(req(`https://x/api/shares/a?k=${KEY}`))).toBeNull();
    expect(requestKey(req(`https://x/api/shares/a/image?k=${KEY}`), true)).toBe(KEY);
    expect(requestKey(req('https://x/api/shares/a'))).toBeNull();
  });
  it('kaputte Form zählt als falscher (aber mitgeschickter) Schlüssel', () => {
    expect(requestKey(req('https://x/', { 'X-Share-Key': '<script>' }))).toBe('!');
    expect(requestKey(req('https://x/?k=kurz'), true)).toBe('!');
  });
});
