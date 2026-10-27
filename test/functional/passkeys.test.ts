// Funktionale Tests: Passkeys (Konzept 14.7, F-208) – Anlegen und Anmelden gegen den echten Worker mit einem kleinen
// Software-Authenticator (P-256, Attestation „none“), dazu Fehlerfälle: fremde Challenge, Wiederverwendung,
// falsche Signatur, fremde Domain, Verwaltung.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import { ORIGIN, login, startWorker, type Harness } from './worker-harness';

let h: Harness;
let n = 0;
const email = () => `pk${++n}-${Date.now()}@example.org`;
const RP_ID = new URL(ORIGIN).hostname;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string | undefined, body?: unknown) =>
  h.fetch(path, { method, cookie, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (v: number) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);

/** ECDSA-Signatur roh (r‖s, je 32 Byte) → DER, wie WebAuthn sie liefert. */
function derSignature(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
}

/** Minimaler Authenticator: ein Schlüsselpaar, ein Zähler. */
class SoftAuthenticator {
  credId = crypto.getRandomValues(new Uint8Array(16));
  counter = 0;
  keys!: CryptoKeyPair;

  async init() {
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    return this;
  }

  get id() {
    return isoBase64URL.fromBuffer(this.credId);
  }

  private clientData(type: string, challenge: string, origin: string) {
    return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  async register(options: { challenge: string }, origin = ORIGIN, rpId = RP_ID) {
    const jwk = await crypto.subtle.exportKey('jwk', this.keys.publicKey);
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, isoBase64URL.toBuffer(jwk.x!)], [-3, isoBase64URL.toBuffer(jwk.y!)]]));
    const authData = concat(await sha256(new TextEncoder().encode(rpId)), new Uint8Array([0x45]), u32(this.counter), new Uint8Array(16), new Uint8Array([0, this.credId.length]), this.credId, cose);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(this.clientData('webauthn.create', options.challenge, origin)),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  async sign(options: { challenge: string }, o: { origin?: string; key?: CryptoKey } = {}) {
    this.counter++;
    const authData = concat(await sha256(new TextEncoder().encode(RP_ID)), new Uint8Array([0x05]), u32(this.counter));
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, o.origin ?? ORIGIN);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, o.key ?? this.keys.privateKey, concat(authData, await sha256(clientDataJSON)) as Uint8Array<ArrayBuffer>));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(derSignature(raw)),
      },
      clientExtensionResults: {},
    };
  }
}

type Options = { options: { challenge: string }; challengeId: string };

async function addPasskey(cookie: string, auth: SoftAuthenticator) {
  const o = (await (await send('POST', '/api/passkeys/options', cookie, {})).json()) as Options;
  return send('POST', '/api/passkeys', cookie, { challengeId: o.challengeId, response: await auth.register(o.options), name: 'Testgerät' });
}

async function loginOptions() {
  return (await (await send('POST', '/api/auth/passkey/options', undefined, {})).json()) as Options;
}

describe('Passkeys (Konzept 14.7)', () => {
  it('[F-208] anlegen, auflisten, dann ohne Mail anmelden – Zähler steigt, Challenge gilt nur einmal', async () => {
    const mail = email();
    const me = await login(h, mail);
    const auth = await new SoftAuthenticator().init();
    const add = await addPasskey(me.cookie, auth);
    expect(add.status, await add.clone().text()).toBe(201);
    const list = (await (await send('GET', '/api/passkeys', me.cookie)).json()) as { passkeys: Array<{ id: string; name: string }> };
    expect(list.passkeys).toEqual([expect.objectContaining({ id: auth.id, name: 'Testgerät' })]);
    expect(JSON.stringify(list)).not.toContain('public');

    const o = await loginOptions();
    const res = await send('POST', '/api/auth/passkey', undefined, { challengeId: o.challengeId, response: await auth.sign(o.options) });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/sx_session/);
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe(mail);
    const row = await (await h.db()).prepare('SELECT counter, last_used_at FROM passkeys WHERE id = ?').bind(auth.id).first<{ counter: number; last_used_at: number }>();
    expect(row).toMatchObject({ counter: 1, last_used_at: expect.any(Number) });
    // dieselbe Challenge ein zweites Mal
    expect((await send('POST', '/api/auth/passkey', undefined, { challengeId: o.challengeId, response: await auth.sign(o.options) })).status).toBe(400);
  });

  it('[F-208] fail closed: falscher Schlüssel, fremde Origin, unbekannter Passkey, Müll → 400 passkey_failed', async () => {
    const me = await login(h, email());
    const auth = await new SoftAuthenticator().init();
    expect((await addPasskey(me.cookie, auth)).status).toBe(201);
    const other = await new SoftAuthenticator().init();

    let o = await loginOptions();
    const bad = await send('POST', '/api/auth/passkey', undefined, { challengeId: o.challengeId, response: await auth.sign(o.options, { key: other.keys.privateKey }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('passkey_failed');
    o = await loginOptions();
    expect((await send('POST', '/api/auth/passkey', undefined, { challengeId: o.challengeId, response: await auth.sign(o.options, { origin: 'https://evil.example' }) })).status).toBe(400);
    o = await loginOptions();
    expect((await send('POST', '/api/auth/passkey', undefined, { challengeId: o.challengeId, response: await other.sign(o.options) })).status).toBe(400);
    o = await loginOptions();
    expect((await send('POST', '/api/auth/passkey', undefined, { challengeId: o.challengeId, response: { id: 'x' } })).status).toBe(400);
    expect((await send('POST', '/api/auth/passkey', undefined, { challengeId: 'gibtesnicht', response: {} })).status).toBe(400);
  });

  it('[F-208] Anlegen nur angemeldet und nur mit eigener Challenge; Registrierung für fremde Domain scheitert', async () => {
    expect((await send('POST', '/api/passkeys/options', undefined, {})).status).toBe(401);
    const a = await login(h, email());
    const b = await login(h, email());
    const auth = await new SoftAuthenticator().init();
    const oa = (await (await send('POST', '/api/passkeys/options', a.cookie, {})).json()) as Options;
    // b versucht, a's Challenge zu nutzen
    expect((await send('POST', '/api/passkeys', b.cookie, { challengeId: oa.challengeId, response: await auth.register(oa.options) })).status).toBe(400);
    const ob = (await (await send('POST', '/api/passkeys/options', b.cookie, {})).json()) as Options;
    expect((await send('POST', '/api/passkeys', b.cookie, { challengeId: ob.challengeId, response: await auth.register(ob.options, ORIGIN, 'evil.example') })).status).toBe(400);
  });

  it('[F-208] entfernen nur eigene; danach kein Anmelden mehr; Konto löschen nimmt Passkeys mit', async () => {
    const a = await login(h, email());
    const b = await login(h, email());
    const auth = await new SoftAuthenticator().init();
    await addPasskey(a.cookie, auth);
    expect((await send('DELETE', `/api/passkeys/${auth.id}`, b.cookie)).status).toBe(404);
    expect((await send('DELETE', `/api/passkeys/${auth.id}`, a.cookie)).status).toBe(204);
    const o = await loginOptions();
    expect((await send('POST', '/api/auth/passkey', undefined, { challengeId: o.challengeId, response: await auth.sign(o.options) })).status).toBe(400);

    const auth2 = await new SoftAuthenticator().init();
    await addPasskey(b.cookie, auth2);
    expect((await send('DELETE', '/api/account', b.cookie)).status).toBe(200);
    expect(await (await h.db()).prepare('SELECT 1 AS x FROM passkeys WHERE id = ?').bind(auth2.id).first()).toBeNull();
  });
});
