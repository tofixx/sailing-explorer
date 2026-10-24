// Unterstützen („Kaffee/Bier ausgeben“): Kontingent kostenloser Freigaben, Status und Stripe-Webhook.
// Bewusst ohne Stripe-SDK – die Signaturprüfung ist HMAC-SHA256 mit WebCrypto.
import type { Env } from './env';
import { requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, json, readBodyCapped } from './http';
import { LIMITS, SHARE_ID_RE, parseFreeShares, parseStripeSignature, parseSupportLink, timingSafeEqual } from './validate';

/** Maximales Alter einer Webhook-Signatur (Schutz gegen Wiedereinspielen). */
const SIGNATURE_TOLERANCE_S = 5 * 60;
/** Checkout-Events sind wenige kB groß. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface SupportLinks {
  coffee: string | null;
  beer: string | null;
}

/**
 * Öffentliche Payment-Links – nur, wenn auch der Webhook eingerichtet ist.
 * Fail closed: ohne Webhook-Secret könnte eine Zahlung nie freischalten, also keine Knöpfe.
 */
export function supportLinks(env: Env): SupportLinks | null {
  if (!env.STRIPE_WEBHOOK_SECRET) return null;
  const links = { coffee: parseSupportLink(env.SUPPORT_LINK_COFFEE), beer: parseSupportLink(env.SUPPORT_LINK_BEER) };
  return links.coffee || links.beer ? links : null;
}

export const freeShares = (env: Env) => parseFreeShares(env.FREE_SHARES);

export interface SupportStatus {
  supporter: boolean;
  sharesUsed: number;
  sharesFree: number;
  sharesMax: number;
}

export async function supportStatus(env: Env, userId: string): Promise<SupportStatus & { bytesUsed: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes,
       EXISTS (SELECT 1 FROM supports WHERE user_id = ?) AS supporter
     FROM shares WHERE user_id = ?`,
  )
    .bind(userId, userId)
    .first<{ n: number; bytes: number; supporter: number }>();
  return {
    supporter: !!row?.supporter,
    sharesUsed: row?.n ?? 0,
    sharesFree: freeShares(env),
    sharesMax: LIMITS.sharesPerUser,
    bytesUsed: row?.bytes ?? 0,
  };
}

/**
 * Kontingent vor dem Upload: ab der (FREE_SHARES + 1)-ten Freigabe braucht es den Unterstützer-Status.
 * Bestehende Freigaben bleiben unangetastet – auch wenn jemand schon mehr hat.
 */
export function checkShareQuota(env: Env, s: SupportStatus): void {
  if (s.sharesUsed >= s.sharesMax) throw new HttpError(409, 'quota', 'Maximale Anzahl an Freigaben erreicht.');
  if (s.supporter || s.sharesUsed < s.sharesFree) return;
  const free = s.sharesFree === 1 ? 'einen Törn' : `${s.sharesFree} Törns`;
  throw new HttpError(
    402,
    'supporter_required',
    supportLinks(env)
      ? `Kostenlos kannst du ${free} speichern. Für weitere Törns unterstütze Sail Explorer einmal mit einem Kaffee oder Bier – oder lösche einen älteren Törn.`
      : `Kostenlos kannst du ${free} speichern. Lösche einen älteren Törn unter „Konto & Freigaben“, um Platz zu schaffen.`,
  );
}

/** GET /api/me/support – Unterstützer-Status und genutzte Freigaben. */
export async function getSupport(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const s = await supportStatus(env, user.id);
  return json({ supporter: s.supporter, sharesUsed: s.sharesUsed, sharesFree: s.sharesFree, sharesMax: s.sharesMax } satisfies SupportStatus);
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
}

/**
 * POST /api/webhooks/stripe – schaltet nach bezahltem Checkout (Payment Link) frei.
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
  if (session.payment_status !== 'paid') return ignored('unpaid');
  if (typeof session.id !== 'string' || !/^cs_[A-Za-z0-9_]{1,250}$/.test(session.id)) return ignored('session');
  const userId = session.client_reference_id;
  if (typeof userId !== 'string' || !SHARE_ID_RE.test(userId)) return ignored('user');
  const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<{ id: string }>();
  if (!user) return ignored('user');

  const amount = Number.isSafeInteger(session.amount_total) ? Math.max(0, session.amount_total as number) : 0;
  const currency = typeof session.currency === 'string' && /^[a-z]{3}$/.test(session.currency) ? session.currency : '';
  // Idempotent: dieselbe Checkout-Session (Wiederholung durch Stripe) zählt nur einmal.
  await env.DB.prepare(
    `INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at)
     VALUES (?, ?, 'stripe', ?, ?, ?, ?) ON CONFLICT(provider_ref) DO NOTHING`,
  )
    .bind(randomId(), user.id, session.id, amount, currency, Date.now())
    .run();
  return json({ received: true });
}
