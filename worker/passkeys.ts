// Passkeys (Konzept 14.7): Anmelden per Fingerabdruck, Face ID oder Geräte-PIN – ohne Mail und ohne Passwort.
// WebAuthn-Prüfung (CBOR, COSE, Signaturen) übernimmt @simplewebauthn/server; hier nur Ablauf, Speicherung und Rechte.
// Gespeichert werden der öffentliche Schlüssel und der Zähler; Challenges sind einmalig und 5 Minuten gültig.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { Env } from './env';
import { requireUser, startSession } from './auth';
import { passkeyAddedMail, sendMail } from './mail';
import { randomId } from './crypto';
import { HttpError, clientIp, json, rateLimit, readJson } from './http';
import { assertActive } from './moderation';
import { cleanText } from './validate';

const CHALLENGE_MS = 5 * 60_000;
/** Passkeys pro Konto – genug für Handy, Laptop, Tablet und einen Sicherheitsschlüssel. */
export const MAX_PASSKEYS = 10;

const FAILED = () => new HttpError(400, 'passkey_failed', 'Der Passkey konnte nicht bestätigt werden. Bitte erneut versuchen oder per Mail anmelden.');

interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

/**
 * Relying Party: die Hauptdomain (CANONICAL_HOST) – Alias-Hosts leiten ohnehin dorthin um, und so binden sich Passkeys
 * nie an einen anderen Host derselben Datenbank (z. B. workers.dev). Ohne Hauptdomain (Vorschau, lokal) der Host der
 * Anfrage. Die Herkunft wird exakt verglichen – Subdomains anderer Dienste kommen damit nicht durch.
 */
function rp(request: Request, env: Env) {
  const host = env.CANONICAL_HOST?.trim().toLowerCase();
  if (host) return { id: host, origin: `https://${host}` };
  const url = new URL(request.url);
  return { id: url.hostname, origin: url.origin };
}

async function newChallenge(env: Env, challenge: string, kind: 'register' | 'login', userId: string | null): Promise<string> {
  const id = randomId();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO webauthn_challenges (id, challenge, kind, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').bind(id, challenge, kind, userId, now + CHALLENGE_MS),
  ]);
  return id;
}

/** Challenge einmalig einlösen (atomar gelöscht) – sonst null. */
async function takeChallenge(env: Env, id: unknown, kind: 'register' | 'login'): Promise<{ challenge: string; user_id: string | null } | null> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
  return env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ? AND kind = ? AND expires_at > ? RETURNING challenge, user_id')
    .bind(id, kind, Date.now())
    .first<{ challenge: string; user_id: string | null }>();
}

const shape = (p: PasskeyRow) => ({ id: p.id, name: p.name, createdAt: p.created_at, lastUsedAt: p.last_used_at });

// ---------------------------------------------------------------- Registrieren (angemeldet)

/** POST /api/passkeys/options – Optionen zum Anlegen eines Passkeys für das angemeldete Konto. */
export async function registerOptions(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const { results } = await env.DB.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').bind(user.id).all<Pick<PasskeyRow, 'id' | 'transports'>>();
  if (results.length >= MAX_PASSKEYS) throw new HttpError(409, 'quota', `Höchstens ${MAX_PASSKEYS} Passkeys pro Konto – lösche zuerst einen alten.`);
  const { id: rpID } = rp(request, env);
  const options = await generateRegistrationOptions({
    rpName: env.APP_NAME,
    rpID,
    userName: user.email,
    userID: new Uint8Array(new TextEncoder().encode(user.id)),
    attestationType: 'none',
    excludeCredentials: results.map((p) => ({ id: p.id, transports: p.transports ? p.transports.split(',') : undefined })),
    // Fingerabdruck, Face ID oder Geräte-PIN sind Pflicht (Konzept 14.7)
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return json({ options, challengeId: await newChallenge(env, options.challenge, 'register', user.id) });
}

/** POST /api/passkeys – `{ challengeId, response, name? }`: Passkey prüfen und speichern. */
export async function registerVerify(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson<{ challengeId?: unknown; response?: unknown; name?: unknown }>(request);
  const ch = await takeChallenge(env, body.challengeId, 'register');
  if (!ch || ch.user_id !== user.id) throw FAILED();
  const { id: rpID, origin } = rp(request, env);
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    throw FAILED();
  }
  if (!result.verified) throw FAILED();
  const c = result.registrationInfo.credential;
  const row: PasskeyRow = {
    id: c.id,
    user_id: user.id,
    public_key: isoBase64URL.fromBuffer(c.publicKey),
    counter: c.counter,
    transports: (c.transports ?? []).join(','),
    name: cleanText(body.name, 60) || 'Passkey',
    created_at: Date.now(),
    last_used_at: null,
  };
  // Atomar: nur unter der Grenze pro Konto und nur mit neuer Credential-ID (fremde IDs lassen sich nicht übernehmen).
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO passkeys (id, user_id, public_key, counter, transports, name, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE (SELECT COUNT(*) FROM passkeys WHERE user_id = ?2) < ?8`,
  )
    .bind(row.id, row.user_id, row.public_key, row.counter, row.transports, row.name, row.created_at, MAX_PASSKEYS)
    .run();
  if (!ins.meta.changes) throw new HttpError(409, 'passkey_rejected', `Dieser Passkey lässt sich nicht anlegen (schon vorhanden oder schon ${MAX_PASSKEYS} Passkeys).`);
  // Hinweis per Mail: wer eine fremde Sitzung nutzt, hinterlegt so nicht unbemerkt einen dauerhaften Zugang.
  try {
    await sendMail(env, passkeyAddedMail(env, user.email, new URL(request.url).origin, row.name));
  } catch (err) {
    console.error('passkey mail failed', err);
  }
  return json({ passkey: shape(row) }, { status: 201 });
}

/** GET /api/passkeys – eigene Passkeys (ohne Schlüssel). */
export async function listPasskeys(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at').bind(user.id).all<PasskeyRow>();
  return json({ passkeys: results.map(shape) });
}

/** DELETE /api/passkeys/:id – eigenen Passkey entfernen (fremde verhalten sich wie unbekannt). */
export async function deletePasskey(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const res = await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Diesen Passkey gibt es nicht (mehr).');
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- Anmelden (ohne Konto-Angabe)

/** POST /api/auth/passkey/options – Optionen zum Anmelden; der Browser bietet die passenden Passkeys selbst an. */
export async function loginOptions(request: Request, env: Env): Promise<Response> {
  await rateLimit(env.AUTH_LIMITER, `passkey:${clientIp(request)}`);
  const options = await generateAuthenticationOptions({ rpID: rp(request, env).id, userVerification: 'required' });
  return json({ options, challengeId: await newChallenge(env, options.challenge, 'login', null) });
}

/** POST /api/auth/passkey – `{ challengeId, response }`: Passkey prüfen und eine Sitzung setzen. */
export async function loginVerify(request: Request, env: Env): Promise<Response> {
  await rateLimit(env.AUTH_LIMITER, `verify:${clientIp(request)}`);
  const body = await readJson<{ challengeId?: unknown; response?: unknown }>(request);
  const ch = await takeChallenge(env, body.challengeId, 'login');
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!ch || typeof response?.id !== 'string') throw FAILED();
  const pk = await env.DB.prepare(
    'SELECT p.*, u.email FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.id = ?',
  )
    .bind(response.id)
    .first<PasskeyRow & { email: string }>();
  if (!pk) throw FAILED();
  const { id: rpID, origin } = rp(request, env);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: pk.id, publicKey: isoBase64URL.toBuffer(pk.public_key), counter: pk.counter, transports: pk.transports ? pk.transports.split(',') : undefined },
      requireUserVerification: true,
    });
  } catch {
    throw FAILED();
  }
  if (!result.verified) throw FAILED();
  const now = Date.now();
  await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').bind(result.authenticationInfo.newCounter, now, pk.id).run();
  // Über die Konto-ID, nicht die Adresse: ein gerade gelöschtes Konto entsteht so nicht neu.
  return startSession(request, env, { id: pk.user_id, email: pk.email }, now);
}
