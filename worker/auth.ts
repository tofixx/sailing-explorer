import type { Env } from './env';
import { removeCoverOf } from './covers';
import { randomCode, randomId, randomToken, sha256Hex } from './crypto';
import { HttpError, clientIp, json, rateLimit, readJson } from './http';
import { magicLinkMail, sendMail } from './mail';
import { subtractUserStmt } from './storage';
import { purgeUserReports } from './moderation';
import { deleteKeys, photoKeysForUser, shareFileKeys } from './photo-keys';
import { boatCleanup, userActivityCleanup } from './activity';
import { purgeUserGroups } from './groups';
import { TOKEN_RE, normalizeEmail, timingSafeEqual } from './validate';

const SECURE_COOKIE = '__Host-sx_session';
/** Nur für lokale Entwicklung über http:// im LAN (Handy-Test) – Secure-Cookies gingen dort nicht. */
const DEV_COOKIE = 'sx_session_dev';
const SESSION_DAYS = 180;
const LOGIN_TOKEN_MINUTES = 15;
const MAX_LINKS_PER_EMAIL = 3; // pro 15 Minuten
/** Falsche Codes pro Adresse und 24 h – danach nur noch der Link (Konzept 14.6). 10 Versuche bei 10⁶ Codes. */
const MAX_CODE_FAILURES = 10;
const CODE_RE = /^\d{6}$/;

/** Gespeicherter Prüfwert eines Codes – an seinen Link gebunden (token_hash als Salz). */
const codeHash = (tokenHash: string, code: string) => sha256Hex(`${tokenHash}:${code}`);

export interface User {
  id: string;
  email: string;
}

/** Private/lokale Hosts – nur dort sind Dev-Komfortfunktionen erlaubt. */
export function isDevHost(url: URL): boolean {
  const h = url.hostname;
  return h === 'localhost' || h === '127.0.0.1' || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
}

function cookieName(request: Request): string {
  const url = new URL(request.url);
  return url.protocol === 'http:' && isDevHost(url) ? DEV_COOKIE : SECURE_COOKIE;
}

function readCookie(request: Request): string | null {
  const name = cookieName(request);
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const name = cookieName(request);
  const secure = name === SECURE_COOKIE ? ' Secure;' : '';
  return `${name}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = readCookie(request);
  if (!token || !TOKEN_RE.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<User>();
  return row ?? null;
}

export async function requireUser(request: Request, env: Env): Promise<User> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Bitte zuerst anmelden.');
  return user;
}

async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<void> {
  if (!env.TURNSTILE_SECRET) return; // nicht konfiguriert (lokal) → übersprungen
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'captcha_required', 'Bitte die Sicherheitsprüfung abschließen.');
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const out = (await res.json()) as { success: boolean };
  if (!out.success) throw new HttpError(400, 'captcha_failed', 'Sicherheitsprüfung fehlgeschlagen – bitte erneut versuchen.');
}

/** POST /api/auth/request – verschickt einen Magic Link. Antwortet immer gleich (keine Konto-Enumeration). */
export async function requestLink(request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  const url = new URL(request.url);
  // Fail closed: ausserhalb lokaler Hosts nie ohne echten Mailversand oder ohne Bot-Schutz.
  if (!isDevHost(url) && (env.MAIL_PROVIDER === 'log' || !env.TURNSTILE_SECRET)) {
    throw new HttpError(503, 'auth_unconfigured', 'Anmeldung ist auf diesem Server noch nicht eingerichtet.');
  }
  await rateLimit(env.AUTH_LIMITER, `ip:${ip}`);
  const body = await readJson<{ email?: unknown; turnstile?: unknown }>(request);
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'invalid_email', 'Bitte eine gültige E-Mail-Adresse angeben.');
  await verifyTurnstile(env, body.turnstile, ip);

  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?')
    .bind(email, now - LOGIN_TOKEN_MINUTES * 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_EMAIL) {
    throw new HttpError(429, 'rate_limited', 'Es wurden bereits mehrere Links verschickt – bitte ins Postfach schauen oder später erneut versuchen.');
  }

  const token = randomToken();
  const code = randomCode();
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, created_at, expires_at, code_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(tokenHash, email, now, now + LOGIN_TOKEN_MINUTES * 60_000, await codeHash(tokenHash, code))
    .run();
  // Abgelaufene Tokens nebenbei aufräumen.
  await env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 86_400_000).run();

  // Der Link öffnet die App, die das Token per POST einlöst. So verbrauchen
  // Link-Scanner in Mailprogrammen (die nur GET machen) das Token nicht.
  const link = `${url.origin}/login#token=${token}`;
  await sendMail(env, magicLinkMail(env, email, link, code));

  // Nur auf lokalen/privaten Hosts und nur im Log-Modus: Link und Code direkt zurückgeben (Test ohne Mailserver).
  const dev = env.MAIL_PROVIDER === 'log' && isDevHost(url);
  return json({ ok: true, devLink: dev ? link : undefined, devCode: dev ? code : undefined });
}

/**
 * POST /api/auth/peek – nennt die E-Mail-Adresse eines gültigen, unbenutzten Links, ohne ihn einzulösen.
 * Der Client fragt damit "Als … anmelden?" – Schutz gegen untergeschobene Links (Login-CSRF).
 */
export async function peekLink(request: Request, env: Env): Promise<Response> {
  await rateLimit(env.AUTH_LIMITER, `verify:${clientIp(request)}`);
  const { token } = await readJson<{ token?: unknown }>(request);
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new HttpError(400, 'invalid_token', 'Der Link ist ungültig.');
  const row = await env.DB.prepare('SELECT email FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(await sha256Hex(token), Date.now())
    .first<{ email: string }>();
  if (!row) throw new HttpError(400, 'invalid_token', 'Der Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen anfordern.');
  return json({ email: row.email });
}

/** POST /api/auth/verify – löst einen Magic Link ein und setzt die Session. */
export async function verifyLink(request: Request, env: Env): Promise<Response> {
  await rateLimit(env.AUTH_LIMITER, `verify:${clientIp(request)}`);
  const { token } = await readJson<{ token?: unknown }>(request);
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new HttpError(400, 'invalid_token', 'Der Link ist ungültig.');
  const now = Date.now();
  const hash = await sha256Hex(token);

  // Atomar als benutzt markieren – nur der erste Aufruf gewinnt.
  const claimed = await env.DB.prepare(
    'UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email',
  )
    .bind(now, hash, now)
    .first<{ email: string }>();
  if (!claimed) throw new HttpError(400, 'invalid_token', 'Der Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen anfordern.');
  return signIn(request, env, claimed.email, now);
}

/**
 * POST /api/auth/code – `{ email, code }`: meldet mit dem Code aus der Anmeldemail an (Konzept 14.6). Gleiche Antwort
 * für unbekannte Adresse und falschen Code; höchstens MAX_CODE_FAILURES Fehlversuche pro Adresse und 24 h, danach
 * gilt nur noch der Link. Ein richtiger Code verbraucht seinen Link (und umgekehrt).
 */
export async function verifyCode(request: Request, env: Env): Promise<Response> {
  await rateLimit(env.AUTH_LIMITER, `verify:${clientIp(request)}`);
  const body = await readJson<{ email?: unknown; code?: unknown }>(request);
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
  const wrong = () => new HttpError(400, 'invalid_code', 'Der Code stimmt nicht oder ist abgelaufen. Bitte prüfen oder einen neuen anfordern.');
  if (!email || !CODE_RE.test(code)) throw wrong();
  const now = Date.now();
  const { results } = await env.DB.prepare(
    'SELECT token_hash, code_hash FROM login_tokens WHERE email = ? AND used_at IS NULL AND expires_at > ? AND code_hash IS NOT NULL ORDER BY created_at DESC LIMIT 5',
  )
    .bind(email, now)
    .all<{ token_hash: string; code_hash: string }>();
  // Ohne offenen Code gibt es nichts zu raten – gleiche Antwort wie ein falscher Code.
  if (!results.length) throw wrong();
  // Den Versuch VOR dem Vergleich atomar reservieren (eine Anweisung, D1 schreibt nacheinander): parallele Anfragen
  // können die Grenze so nicht überholen. Gezählt wird am neuesten offenen Link.
  const newest = results[0].token_hash;
  const reserved = await env.DB.prepare(
    `UPDATE login_tokens SET code_attempts = code_attempts + 1
     WHERE token_hash = ?1 AND (SELECT COALESCE(SUM(code_attempts), 0) FROM login_tokens WHERE email = ?2 AND created_at > ?3) < ?4
     RETURNING 1 AS ok`,
  )
    .bind(newest, email, now - 86_400_000, MAX_CODE_FAILURES)
    .first();
  if (!reserved) {
    // Grenze erreicht: offene Codes der Adresse verwerfen – es gilt nur noch der Link.
    await env.DB.prepare('UPDATE login_tokens SET code_hash = NULL WHERE email = ? AND used_at IS NULL').bind(email).run();
    throw new HttpError(429, 'code_locked', 'Zu viele falsche Codes. Bitte den Link aus der Mail nutzen oder morgen erneut versuchen.');
  }
  for (const r of results) {
    if (!timingSafeEqual(await codeHash(r.token_hash, code), r.code_hash)) continue;
    const claimed = await env.DB.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email')
      .bind(now, r.token_hash, now)
      .first<{ email: string }>();
    if (!claimed) break;
    // Erfolg zählt nicht als Fehlversuch
    await env.DB.prepare('UPDATE login_tokens SET code_attempts = MAX(0, code_attempts - 1) WHERE token_hash = ?').bind(newest).run();
    return signIn(request, env, claimed.email, now);
  }
  throw wrong();
}

/** Konto zur Adresse holen oder anlegen und eine Sitzung setzen – nach eingelöstem Link oder Code. */
async function signIn(request: Request, env: Env, email: string, now: number): Promise<Response> {
  let user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first<User>();
  if (!user) {
    user = { id: randomId(), email };
    await env.DB.prepare('INSERT INTO users (id, email, created_at, last_login) VALUES (?, ?, ?, ?)')
      .bind(user.id, user.email, now, now)
      .run();
  }
  return startSession(request, env, user, now);
}

/** Sitzung für ein bestehendes Konto setzen (Link, Code, Passkey) und die letzte Anmeldung vermerken. */
export async function startSession(request: Request, env: Env, user: User, now: number): Promise<Response> {
  await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id).run();
  const session = randomToken();
  const maxAge = SESSION_DAYS * 86_400;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(session), user.id, now, now + maxAge * 1000)
    .run();
  return json({ user }, { headers: { 'Set-Cookie': sessionCookie(request, session, maxAge) } });
}

export async function me(request: Request, env: Env): Promise<Response> {
  return json({ user: await currentUser(request, env) });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request);
  if (token && TOKEN_RE.test(token)) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(request, '', 0) } });
}

/** DELETE /api/account – löscht Konto, Sessions und alle Freigaben inkl. Dateien. */
export async function deleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await purgeUser(env, user);
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(request, '', 0) } });
}

/** Entfernt ein Konto vollständig (auch vom nächtlichen Aufräumen für inaktive Konten genutzt). */
export async function purgeUser(env: Env, user: User): Promise<void> {
  const { results } = await env.DB.prepare('SELECT id FROM shares WHERE user_id = ?').bind(user.id).all<{ id: string }>();
  await deleteKeys(env, [...results.flatMap((r) => shareFileKeys(r.id)), ...(await photoKeysForUser(env, user.id))]);
  // Vereine und Teams (Konzept 11.9): eigene Gruppen an den dienstältesten Admin übergeben bzw. löschen.
  const groupStmts = await purgeUserGroups(env, user.id);
  const { results: boats } = await env.DB.prepare('SELECT id FROM boats WHERE owner_id = ?').bind(user.id).all<{ id: string }>();
  // Titelbilder von Profil und eigenen Booten sofort (Gruppen: removeGroup bzw. Übergabe)
  await removeCoverOf(env, 'u', user.id);
  for (const b of boats) await removeCoverOf(env, 'b', b.id);
  await env.DB.batch([
    // Neuigkeiten: Aktivitäten des Kontos und seiner Törns, Folgen in beide Richtungen, Beiträge, Mitgliedschaften,
    // Anfragen, Boote in Gruppen – vor dem Löschen der Törns, Boote und des Kontos.
    ...userActivityCleanup(env, user.id),
    ...boats.flatMap((b) => boatCleanup(env, b.id)),
    ...groupStmts,
    // Speicher der Törns vom globalen Zähler abziehen, bevor sie gelöscht werden (Konzept 5.2).
    subtractUserStmt(env, user.id),
    // Kommentare & Meldungen (Phase D): Meldungen zu eigenen Inhalten zuerst (sie verweisen auf Kommentare),
    // dann eigene Kommentare und alle Kommentare auf eigenen Törns (fielen auch per ON DELETE CASCADE).
    ...purgeUserReports(env, user.id),
    env.DB.prepare('DELETE FROM comments WHERE user_id = ?1 OR share_id IN (SELECT id FROM shares WHERE user_id = ?1)').bind(user.id),
    env.DB.prepare('DELETE FROM comment_log WHERE user_id = ?').bind(user.id),
    // Fotos (Phase C): Dateien sind oben schon weg, Bytes zieht subtractUserStmt ab.
    env.DB.prepare('DELETE FROM photos WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM shares WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM login_tokens WHERE email = ?').bind(user.email),
    // Passkeys und offene Challenges ausdrücklich (nicht nur per Fremdschlüssel) – ein Löschpfad je Objekt
    env.DB.prepare('DELETE FROM passkeys WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').bind(user.id),
    // Explizit statt nur per ON DELETE CASCADE: Törns anderer Nutzer verlieren nur die Bootszuordnung.
    env.DB.prepare('UPDATE shares SET boat_id = NULL WHERE boat_id IN (SELECT id FROM boats WHERE owner_id = ?)').bind(user.id),
    env.DB.prepare('DELETE FROM boat_admins WHERE user_id = ? OR boat_id IN (SELECT id FROM boats WHERE owner_id = ?)').bind(user.id, user.id),
    // Einladungen und Crew-Einträge (fielen auch per ON DELETE CASCADE, hier ausdrücklich).
    env.DB.prepare('DELETE FROM invites WHERE inviter_id = ? OR invitee_id = ? OR boat_id IN (SELECT id FROM boats WHERE owner_id = ?)').bind(user.id, user.id, user.id),
    env.DB.prepare('DELETE FROM share_crew WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM boats WHERE owner_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(user.id),
    // Unterstützungen bleiben als Buchung erhalten (Frist: retention.ts), verlieren aber den Bezug zum Konto.
    env.DB.prepare('UPDATE supports SET user_id = NULL WHERE user_id = ?').bind(user.id),
    // Titelbilder übergebener Gruppen und fremder Boote behalten keine Konto-ID des gelöschten Kontos
    env.DB.prepare('UPDATE covers SET user_id = NULL WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
}
