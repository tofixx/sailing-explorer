// Unterstützen („Kaffee/Bier ausgeben“): Kontingent kostenloser Freigaben, Status, Stripe-Checkout und -Webhook.
// Bewusst ohne Stripe-SDK – Checkout ist ein Form-POST, die Signaturprüfung HMAC-SHA256 mit WebCrypto.
import type { Env } from './env';
import { isDevHost, requireUser } from './auth';
import { randomId } from './crypto';
import { clearExpiryNotifications } from './notifications';
import { HttpError, clientIp, json, rateLimit, readBodyCapped, readJson } from './http';
import { SHARE_ID_RE, parseFreeShares, storageThresholds, parseStripeSignature, parseSupportAmount, timingSafeEqual } from './validate';
import { SUPPORT_TIERS, formatEuro, seasonOf, tierFor, type SupportTier } from '../src/domain/support';
import { boatLimitMessage, brakeBlocks, brakeLevel, limitsFor, quotaVerdict, tierOf, type Tier, type TierLimits } from '../src/domain/limits';
import { fmtMB } from '../src/domain/format';
import { LOG_LIMITS, seasonRange } from '../src/domain/logbook';
import { STORAGE_COUNTER, USER_BYTES_SQL } from './storage';
import { VISIBILITY_LABEL, canChooseVisibility, type Visibility } from '../src/domain/visibility';

/** Maximales Alter einer Webhook-Signatur (Schutz gegen Wiedereinspielen). */
const SIGNATURE_TOLERANCE_S = 5 * 60;
/** Checkout-Events sind wenige kB groß. */
const MAX_WEBHOOK_BYTES = 256 * 1024;
/** Kennung in den Metadaten – Webhooks fremder Checkouts desselben Stripe-Kontos werden ignoriert. */
const METADATA_APP = 'sail-explorer';
const STRIPE_API = 'https://api.stripe.com';

/**
 * Unterstützen ist nur aktiv, wenn Checkout-Schlüssel und Webhook-Secret gesetzt sind.
 * Fail closed: ohne Webhook könnte eine Zahlung nie freischalten, also kein Angebot.
 */
export const supportConfigured = (env: Env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

/** Öffentliche Konfiguration für /api/config: die Slider-Stufen oder null. */
export function supportConfig(env: Env): { tiers: SupportTier[] } | null {
  return supportConfigured(env) ? { tiers: SUPPORT_TIERS } : null;
}

export const freeShares = (env: Env) => parseFreeShares(env.FREE_SHARES);

export interface SupportStatus {
  supporter: boolean;
  /** Ende des Unterstützer-Status (ms) – auch wenn abgelaufen; null = nie unterstützt */
  supporterUntil: number | null;
  /** Törns mit GPX – Fahrtenbuch-Einträge ohne GPX zählen getrennt (L1) */
  sharesUsed: number;
  /** Fahrtenbuch-Einträge mit Abfahrt in der laufenden Saison und ihre Grenze – für alle Stufen gleich (L1) */
  logEntriesUsed: number;
  logEntriesMax: number;
  /** kostenlose Törns (FREE_SHARES) */
  sharesFree: number;
  /** Grenzen der aktuellen Stufe (kostenlos bzw. Unterstützer), siehe limits */
  sharesMax: number;
  /** Speicher in Bytes: Track-Payloads + Übersichtsbilder + Fotos */
  bytesUsed: number;
  bytesMax: number;
  /** Boote als Eigner */
  boatsUsed: number;
  boatsMax: number;
  /** Fotos im Konto (alle Törns) */
  photosUsed: number;
  /** Fotos pro Törn in der aktuellen Stufe (kostenlos 0, E3) */
  photosMax: number;
  /** Grenzen beider Stufen – für „Als Unterstützer bis zu …“ */
  limits: Record<Tier, TierLimits>;
  /** Notbremse: neue Törns für dieses Konto gerade pausiert (Konzept 5.2) */
  storagePaused: boolean;
}

export async function supportStatus(env: Env, userId: string, now = Date.now()): Promise<SupportStatus> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM shares WHERE user_id = ?1 AND source = 'gpx') AS n,
       (SELECT COUNT(*) FROM shares WHERE user_id = ?1 AND source = 'manual' AND started_at >= ?3 AND started_at < ?4) AS logs,
       ${USER_BYTES_SQL} AS bytes,
       (SELECT COUNT(*) FROM boats WHERE owner_id = ?1) AS boats,
       (SELECT COUNT(*) FROM photos WHERE user_id = ?1) AS photos,
       (SELECT MAX(valid_until) FROM supports WHERE user_id = ?1) AS until,
       (SELECT value FROM counters WHERE name = ?2) AS total`,
  )
    .bind(userId, STORAGE_COUNTER, ...seasonRange(seasonOf(now)))
    .first<{ n: number; logs: number; bytes: number; boats: number; photos: number; until: number | null; total: number | null }>();
  const until = row?.until ?? null;
  const supporter = until !== null && until > now;
  const free = freeShares(env);
  const limits = { free: limitsFor('free', free), supporter: limitsFor('supporter') };
  const current = limits[tierOf(supporter)];
  const { soft, hard } = storageThresholds(env);
  return {
    supporter,
    supporterUntil: until,
    sharesUsed: row?.n ?? 0,
    sharesFree: free,
    logEntriesUsed: row?.logs ?? 0,
    logEntriesMax: LOG_LIMITS.perSeason,
    sharesMax: current.shares,
    bytesUsed: row?.bytes ?? 0,
    bytesMax: current.bytes,
    boatsUsed: row?.boats ?? 0,
    boatsMax: current.boats,
    photosUsed: row?.photos ?? 0,
    photosMax: current.photosPerShare,
    limits,
    storagePaused: brakeBlocks(brakeLevel(row?.total ?? null, soft, hard), supporter),
  };
}

/**
 * Kontingent vor dem Upload: ab der (FREE_SHARES + 1)-ten Freigabe braucht es den Unterstützer-Status, ab der
 * 101. geht es auch für Unterstützer nicht weiter. Bestehende Freigaben bleiben unangetastet – auch wenn jemand
 * schon mehr hat (z. B. nach Ende der Unterstützung).
 */
export function checkShareQuota(env: Env, s: SupportStatus): void {
  const v = quotaVerdict(s.supporter, s.sharesUsed, 1, (l) => l.shares, s.sharesFree);
  if (v === 'ok') return;
  const max = s.limits.supporter.shares;
  if (v === 'quota') throw new HttpError(409, 'quota', `Maximal ${max} Törns pro Konto – bitte einen älteren löschen.`);
  const free = s.sharesFree === 1 ? 'einen Törn' : `${s.sharesFree} Törns`;
  throw new HttpError(
    402,
    'supporter_required',
    supportConfigured(env)
      ? `Kostenlos kannst du ${free} speichern. Für weitere Törns unterstütze Sail Explorer mit einem Kaffee oder Bier – oder lösche einen älteren Törn.`
      : `Kostenlos kannst du ${free} speichern. Lösche einen älteren Törn unter „Konto & Freigaben“, um Platz zu schaffen.`,
  );
}

/**
 * Speicher vor dem Upload: Wie viele Bytes dürfen noch dazukommen? Ist das Konto schon voll, 402 (Unterstützung
 * würde helfen) bzw. 409. Liefert den Rest für die Obergrenze beim Einlesen.
 */
export function checkStorageQuota(env: Env, s: SupportStatus, adding = 1): number {
  const v = quotaVerdict(s.supporter, s.bytesUsed, adding, (l) => l.bytes, s.sharesFree);
  if (v === 'ok') return s.bytesMax - s.bytesUsed;
  throw storageQuotaError(env, s, v);
}

export function storageQuotaError(env: Env, s: SupportStatus, v: 'supporter_required' | 'quota'): HttpError {
  if (v === 'quota') {
    return new HttpError(409, 'quota', `Speicher voll: Höchstens ${fmtMB(s.limits.supporter.bytes)} pro Konto – bitte ältere Törns löschen.`);
  }
  return new HttpError(
    402,
    'supporter_required',
    `Kostenlos stehen dir ${fmtMB(s.limits.free.bytes)} Speicher zur Verfügung.` +
      (supportConfigured(env) ? ` Als Unterstützer sind es ${fmtMB(s.limits.supporter.bytes)} – oder lösche einen älteren Törn.` : ' Lösche einen älteren Törn, um Platz zu schaffen.'),
  );
}

/** Boote als Eigner: kostenlos 3, Unterstützer 20 (402 bzw. 409). Bestehende Boote bleiben. */
export async function checkBoatQuota(env: Env, userId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM boats WHERE owner_id = ?1) AS n, (SELECT MAX(valid_until) FROM supports WHERE user_id = ?1) AS until`,
  )
    .bind(userId)
    .first<{ n: number; until: number | null }>();
  const supporter = row?.until != null && row.until > Date.now();
  const v = quotaVerdict(supporter, row?.n ?? 0, 1, (l) => l.boats);
  if (v === 'ok') return;
  throw new HttpError(v === 'quota' ? 409 : 402, v, boatLimitMessage(v, supportConfigured(env)));
}

/** Läuft der Unterstützer-Status gerade? (Eine Abfrage, ohne die Zählungen aus supportStatus.) */
export async function isSupporter(env: Env, userId: string, now = Date.now()): Promise<boolean> {
  const row = await env.DB.prepare('SELECT MAX(valid_until) AS until FROM supports WHERE user_id = ?').bind(userId).first<{ until: number | null }>();
  return row?.until != null && row.until > now;
}

/** 402 für „Nur mit Link“/„Nur ich“ ohne laufenden Unterstützer-Status (E1). */
export function visibilityRequiresSupport(env: Env): HttpError {
  return new HttpError(
    402,
    'supporter_required',
    `„${VISIBILITY_LABEL.unlisted}“ und „${VISIBILITY_LABEL.private}“ gibt es nur für Unterstützer – kostenlos ist alles öffentlich.` +
      (supportConfigured(env) ? ' Unterstütze Sail Explorer mit einem Kaffee oder Bier, um die Sichtbarkeit selbst zu wählen.' : ''),
  );
}

/**
 * E1/E4: „Nur mit Link“ und „Nur ich“ nur mit laufendem Unterstützer-Status; eine schon gesetzte Stufe darf bleiben,
 * auf „Öffentlich“ geht immer. Sonst 402 supporter_required. Den Status fragt sie nur ab, wenn es darauf ankommt.
 */
export async function checkVisibilityChoice(env: Env, userId: string, next: Visibility, current?: Visibility): Promise<void> {
  if (canChooseVisibility(next, false, current)) return;
  if (!canChooseVisibility(next, await isSupporter(env, userId), current)) throw visibilityRequiresSupport(env);
}

/** GET /api/me/support – Unterstützer-Status, genutzte Törns, Speicher und Boote samt Grenzen beider Stufen. */
export async function getSupport(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json(await supportStatus(env, user.id));
}

// ---------------------------------------------------------------- Stripe-Checkout

/** Basis-URL der Stripe-API. Überschreiben nur auf lokale Adressen (Tests mit Stub-Server) – nie anderswohin mit dem Schlüssel. */
function stripeBase(env: Env): string {
  if (!env.STRIPE_API_BASE) return STRIPE_API;
  const url = new URL(env.STRIPE_API_BASE);
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new HttpError(500, 'stripe_base', 'STRIPE_API_BASE ist nur lokal erlaubt.');
  return url.origin;
}

/**
 * POST /api/support/checkout { amount } – legt eine Stripe-Checkout-Session über eine der festen Stufen an
 * und liefert deren URL. Freigeschaltet wird erst durch den signierten Webhook.
 */
export async function createCheckout(request: Request, env: Env): Promise<Response> {
  if (!supportConfigured(env)) throw new HttpError(503, 'support_unconfigured', 'Unterstützen ist auf diesem Server nicht eingerichtet.');
  const user = await requireUser(request, env);
  await rateLimit(env.UPLOAD_LIMITER, `checkout:${clientIp(request)}`);
  const { amount: raw } = await readJson<{ amount?: unknown }>(request);
  const amount = parseSupportAmount(raw);
  const tier = amount === null ? undefined : tierFor(amount);
  if (amount === null || !tier) throw new HttpError(400, 'invalid_amount', 'Bitte einen der angebotenen Beträge wählen.');

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': `${env.APP_NAME} unterstützen – ${tier.label}`,
    'line_items[0][price_data][product_data][description]': `Unterstützer-Status für die Saison ${seasonOf(Date.now())} (${formatEuro(amount)})`,
    client_reference_id: user.id,
    customer_email: user.email,
    'metadata[app]': METADATA_APP,
    'metadata[user_id]': user.id,
    locale: 'de',
    submit_type: 'donate',
    success_url: `${origin}/?support=success`,
    cancel_url: `${origin}/?support=cancel`,
  });
  const res = await fetch(`${stripeBase(env)}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) {
    console.error('stripe checkout failed', res.status, await res.text());
    throw new HttpError(502, 'checkout_failed', 'Die Bezahlseite konnte nicht geöffnet werden – bitte später erneut versuchen.');
  }
  const session = (await res.json()) as { url?: unknown };
  // Nur auf Stripes eigene Checkout-Seite weiterleiten (bzw. den lokalen Stub in Tests).
  const url = typeof session.url === 'string' && URL.canParse(session.url) ? new URL(session.url) : null;
  const allowed = url && (url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' || (env.STRIPE_API_BASE && isDevHost(url)));
  if (!url || !allowed) throw new HttpError(502, 'checkout_failed', 'Die Bezahlseite konnte nicht geöffnet werden.');
  return json({ url: url.href });
}

// ---------------------------------------------------------------- Stripe-Webhook

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Prüft den Stripe-Signature-Header gegen den rohen Body (HMAC-SHA256 über „t.body“). */
export async function verifyStripeSignature(secret: string, header: string | null, body: string, nowMs = Date.now()): Promise<boolean> {
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  if (Math.abs(nowMs / 1000 - parsed.timestamp) > SIGNATURE_TOLERANCE_S) return false;
  const expected = await hmacHex(secret, `${parsed.timestamp}.${body}`);
  // Alle Kandidaten prüfen (kein frühes Ende), Vergleich in konstanter Laufzeit.
  let ok = false;
  for (const sig of parsed.signatures) ok = timingSafeEqual(sig, expected) || ok;
  return ok;
}

interface CheckoutSession {
  id?: unknown;
  client_reference_id?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  metadata?: { app?: unknown } | null;
}

/**
 * POST /api/webhooks/stripe – verlängert nach bezahltem Checkout den Unterstützer-Status um eine Saison.
 * Ausnahme von der Origin-Prüfung (Stripe sendet keinen Origin); geschützt durch die Signatur.
 * Ereignisse, die nicht zu uns passen, werden mit 200 quittiert und ignoriert (sonst wiederholt Stripe sie).
 */
export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'support_unconfigured', 'Unterstützen ist auf diesem Server nicht eingerichtet.');
  const raw = new TextDecoder().decode(await readBodyCapped(request, MAX_WEBHOOK_BYTES));
  if (!(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get('Stripe-Signature'), raw))) {
    throw new HttpError(400, 'invalid_signature', 'Ungültige Signatur.');
  }
  let event: { type?: unknown; data?: { object?: CheckoutSession } };
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }

  const ignored = (reason: string) => json({ received: true, ignored: reason });
  // Sofort bezahlt → completed (payment_status=paid); verzögerte Zahlarten (z. B. SEPA) → async_payment_succeeded.
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return ignored('event');
  const session = event.data?.object ?? {};
  if (session.metadata?.app !== METADATA_APP) return ignored('app');
  if (session.payment_status !== 'paid') return ignored('unpaid');
  if (typeof session.id !== 'string' || !/^cs_[A-Za-z0-9_]{1,250}$/.test(session.id)) return ignored('session');
  const userId = session.client_reference_id;
  if (typeof userId !== 'string' || !SHARE_ID_RE.test(userId)) return ignored('user');
  const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<{ id: string }>();
  if (!user) return ignored('user');

  const amount = Number.isSafeInteger(session.amount_total) ? Math.max(0, session.amount_total as number) : 0;
  const currency = typeof session.currency === 'string' && /^[a-z]{3}$/.test(session.currency) ? session.currency : '';
  const now = Date.now();
  // Eine Saison: die des Zahltags oder die auf eine laufende Unterstützung folgende (wie extendSupport() in
  // src/domain/support.ts) – in einer Anweisung, damit parallele Webhooks sich nicht überholen. Idempotent: dieselbe
  // Session zählt nur einmal.
  const cur = '(SELECT COALESCE(MAX(valid_until), 0) FROM supports WHERE user_id = ?6)';
  const next = `CASE WHEN ${cur} > ?7 THEN CAST(strftime('%Y', (${cur} - 1) / 1000, 'unixepoch') AS INTEGER) + 1 ELSE 0 END`;
  await env.DB.prepare(
    `INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until)
     VALUES (?1, ?6, 'stripe', ?2, ?3, ?4, ?7,
       CAST(ROUND((julianday(printf('%04d-01-01', MAX(?5, ${next}) + 1)) - 2440587.5) * 86400000) AS INTEGER))
     ON CONFLICT(provider_ref) DO NOTHING`,
  )
    .bind(randomId(), session.id, amount, currency, seasonOf(now), user.id, now)
    .run();
  // Ablauf verschoben → Löschwarnungen in der Glocke sind überholt (Konzept 17.9.3)
  await clearExpiryNotifications(env, user.id);
  return json({ received: true });
}
