// Web Push (Konzept 17.7, F-257): leere Weckrufe mit VAPID-Signatur – ohne Inhalt, ohne Verschlüsselung. Der Service
// Worker (public/sw.js) holt den Text danach selbst mit der Sitzung von /api/notifications. So erfahren die
// Push-Dienste (Google, Mozilla, Apple, Microsoft) nichts über Inhalte, nur dass es etwas gibt.
// Ohne VAPID-Schlüssel (Vorschau, lokale Entwicklung ohne .dev.vars) ist Push aus: Schlüssel-Abfrage liefert null.
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { requireUser } from './auth';
import { NOTIFICATION_LIMITS, type ChoosableKind } from '../src/domain/notifications';


/** Nur bekannte Push-Dienste – der Worker schickt sonst Anfragen an beliebige Adressen. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];

export function validEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname)) ? u.href : null;
  } catch {
    return null;
  }
}

const b64u = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Öffentlicher Schlüssel (65 Byte, unkomprimiert, base64url) – null, wenn Push nicht eingerichtet ist. */
export const pushKey = (env: Env): string | null => (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? env.VAPID_PUBLIC_KEY : null);

async function signingKey(env: Env): Promise<CryptoKey> {
  const pub = fromB64u(env.VAPID_PUBLIC_KEY!);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY!, ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** VAPID-JWT (RFC 8292) für den Push-Dienst des Abos, 12 h gültig. */
export async function vapidAuth(env: Env, endpoint: string, now = Date.now()): Promise<string> {
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.APP_ORIGIN || 'https://segeln-potsdam.de' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Weckruf an die Geräte der Empfänger, die für diese Art „Push“ gewählt haben – parallel, das JWT je Push-Dienst nur
 * einmal signiert, höchstens NOTIFICATION_LIMITS.pushPerEvent Geräte je Ereignis (Subrequest-Grenze im Free Tier, Latenz
 * der auslösenden Anfrage). Ungültige Abos (403 nach Schlüsselwechsel, 404, 410) werden gelöscht. Fehler bleiben im
 * Log – die auslösende Aktion scheitert nie. Die Standard-Kanäle sind nie „push“, daher genügt json_extract.
 */
export async function sendPush(env: Env, userIds: string[], kind: ChoosableKind): Promise<number> {
  if (!pushKey(env) || !userIds.length) return 0;
  const { results } = await env.DB.prepare(
    `SELECT s.endpoint FROM push_subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.user_id IN (${userIds.map(() => '?').join(', ')}) AND u.suspended_at IS NULL AND u.locked_at IS NULL
       AND json_extract(u.notify_prefs, '$.' || ?) = 'push'
     ORDER BY s.created_at DESC LIMIT ?`,
  )
    .bind(...userIds, kind, NOTIFICATION_LIMITS.pushPerEvent)
    .all<{ endpoint: string }>();
  const auth = new Map<string, Promise<string>>();
  const authFor = (endpoint: string) => {
    const aud = new URL(endpoint).origin;
    if (!auth.has(aud)) auth.set(aud, vapidAuth(env, endpoint));
    return auth.get(aud)!;
  };
  const outcomes = await Promise.allSettled(
    results.map(async ({ endpoint }) => {
      const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: await authFor(endpoint), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' } });
      if (!res.ok) console.error('push failed', res.status);
      return { endpoint, gone: [403, 404, 410].includes(res.status), ok: res.ok };
    }),
  );
  const done = outcomes.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : (console.error('push failed', o.reason), [])));
  const stmts = done.flatMap((d) =>
    d.gone ? [env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(d.endpoint)]
    : d.ok ? [env.DB.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?').bind(Date.now(), d.endpoint)]
    : [],
  );
  if (stmts.length) await env.DB.batch(stmts);
  return done.filter((d) => d.ok).length;
}

/** GET /api/push/key – öffentlicher VAPID-Schlüssel oder null (Push nicht eingerichtet). */
export const getPushKey = async (_r: Request, env: Env): Promise<Response> =>
  json({ publicKey: pushKey(env) }, { headers: { 'Cache-Control': 'public, max-age=300' } });

/** PUT /api/me/push `{ endpoint }` – dieses Gerät abonnieren (gehört danach diesem Konto). */
export async function putPush(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!pushKey(env)) throw new HttpError(503, 'push_unconfigured', 'Push-Benachrichtigungen sind hier nicht eingerichtet.');
  const endpoint = validEndpoint((await readJson<{ endpoint?: unknown }>(request)).endpoint);
  if (!endpoint) throw new HttpError(400, 'invalid_endpoint', 'Unbekannter Push-Dienst.');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = ?2, created_at = ?3, last_ok_at = NULL`,
    ).bind(endpoint, user.id, now),
    // höchstens NOTIFICATION_LIMITS.pushPerUser Geräte – die ältesten fallen heraus
    env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint NOT IN
         (SELECT endpoint FROM push_subscriptions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2)`,
    ).bind(user.id, NOTIFICATION_LIMITS.pushPerUser),
  ]);
  return new Response(null, { status: 204 });
}

/** DELETE /api/me/push `{ endpoint }` – Abo dieses Geräts entfernen (nur eigene). */
export async function deletePush(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const endpoint = validEndpoint((await readJson<{ endpoint?: unknown }>(request)).endpoint);
  if (endpoint) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, user.id).run();
  return new Response(null, { status: 204 });
}
