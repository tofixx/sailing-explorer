// Funktionale Tests: kostenloses Kontingent, Unterstützen per Stripe-Checkout und -Webhook, Fail-closed (F-60 … F-62).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
// Die Stripe-API wird durch einen lokalen HTTP-Stub (127.0.0.1) ersetzt, dessen Origin als STRIPE_API_BASE dient.
//   h:     voll eingerichtet (Secret-Key + Webhook-Secret, Stub als Stripe-API)
//   h0:    ohne Konfiguration (wie wrangler.jsonc ohne Secrets)
//   hHalf: nur der Secret-Key, kein Webhook-Secret → Unterstützen bleibt aus
//   hEvil: STRIPE_API_BASE zeigt auf einen fremden Host → wird abgelehnt
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createShare, grantSupport, login, startWorker, stripeSignature, type Harness } from './worker-harness';
import { parseFreeShares, parseStripeSignature, timingSafeEqual } from '../../worker/validate';
import { SUPPORT_TIERS } from '../../src/domain/support';

const SECRET = 'whsec_test_0123456789abcdef';
const KEY = 'sk_test_0123456789abcdef';
const DAY = 86_400_000;
const YEAR = 365 * DAY;

let h: Harness;
let h0: Harness;
let hHalf: Harness;
let hEvil: Harness;
let n = 0;
const email = (tag = 's') => `${tag}${++n}-${Date.now()}@example.org`;
const sessionId = () => `cs_test_${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------- Stripe-Stub

interface StubRequest {
  method: string;
  path: string;
  auth: string | undefined;
  contentType: string | undefined;
  form: URLSearchParams;
}
let stub: Server;
let stubOrigin: string;
const stubRequests: StubRequest[] = [];
/** Antwort des Stubs für den nächsten Aufruf (Standard: Session mit Checkout-URL auf dem Stub). */
let stubReply: ((req: StubRequest) => { status: number; body: unknown }) | null = null;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

beforeAll(async () => {
  stub = createServer(async (req, res) => {
    const r: StubRequest = {
      method: req.method ?? '',
      path: req.url ?? '',
      auth: req.headers.authorization,
      contentType: req.headers['content-type'],
      form: new URLSearchParams(await readBody(req)),
    };
    stubRequests.push(r);
    const reply = stubReply ? stubReply(r) : { status: 200, body: { id: 'cs_test_stub', object: 'checkout.session', url: `${stubOrigin}/pay/cs_test_stub` } };
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubOrigin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

  [h, h0, hHalf, hEvil] = await Promise.all([
    startWorker({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: stubOrigin }),
    startWorker(),
    startWorker({ STRIPE_SECRET_KEY: KEY }),
    startWorker({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: 'https://evil.example' }),
  ]);
}, 120_000);
afterAll(async () => {
  await Promise.all([h?.dispose(), h0?.dispose(), hHalf?.dispose(), hEvil?.dispose()]);
  await new Promise<void>((resolve) => (stub ? stub.close(() => resolve()) : resolve()));
});
beforeEach(() => {
  stubRequests.length = 0;
  stubReply = null;
});

type Json = Record<string, unknown>;
const body = async (res: Response) => (await res.json()) as Json;

async function shares(hh: Harness, cookie: string, count: number) {
  for (let i = 0; i < count; i++) expect((await createShare(hh, cookie, { title: `Törn ${i + 1}` })).status).toBe(201);
}

function checkoutEvent(userId: unknown, session: Json = {}, type = 'checkout.session.completed') {
  return JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type,
    data: {
      object: {
        id: sessionId(),
        object: 'checkout.session',
        client_reference_id: userId,
        payment_status: 'paid',
        amount_total: 500,
        currency: 'eur',
        metadata: { app: 'sail-explorer', user_id: userId },
        ...session,
      },
    },
  });
}

/** Webhook wie von Stripe: ohne Origin, ohne Cookie, mit Signatur (Standard: gültig). */
async function webhook(hh: Harness, payload: string, signature?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const sig = signature === undefined ? await stripeSignature(SECRET, payload) : signature;
  if (sig !== null) headers['Stripe-Signature'] = sig;
  return hh.fetch('/api/webhooks/stripe', { method: 'POST', origin: null, headers, body: payload });
}

async function supportRows(hh: Harness, userId: string) {
  return (await (await hh.db()).prepare('SELECT provider, provider_ref, amount, currency FROM supports WHERE user_id = ?').bind(userId).all<Json>()).results;
}

async function status(hh: Harness, cookie: string) {
  return body(await hh.fetch('/api/me/support', { cookie }));
}

function checkout(hh: Harness, cookie: string | undefined, amount: unknown, origin?: string) {
  return hh.fetch('/api/support/checkout', {
    method: 'POST',
    cookie,
    origin,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
}

// ---------------------------------------------------------------- Konfiguration

describe('F-62 Konfiguration für /api/config', () => {
  it('[F-62] voll eingerichtet: die Slider-Stufen, aber keine Secrets', async () => {
    const cfg = await body(await h.fetch('/api/config'));
    expect(cfg).toMatchObject({ sharing: true, freeShares: 3, support: { tiers: SUPPORT_TIERS } });
    const text = JSON.stringify(cfg);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(stubOrigin);
  });

  it('[F-62] ohne Secrets oder nur mit Secret-Key (ohne Webhook-Secret) → support: null', async () => {
    expect(await body(await h0.fetch('/api/config'))).toMatchObject({ support: null, freeShares: 3 });
    expect(await body(await hHalf.fetch('/api/config'))).toMatchObject({ support: null });
  });
});

// ---------------------------------------------------------------- Kontingent

describe('F-60 Kostenloses Kontingent', () => {
  it('[F-60] drei Freigaben sind kostenlos, die vierte wird mit 402 supporter_required abgelehnt (nichts gespeichert)', async () => {
    const { cookie, user } = await login(h, email());
    await shares(h, cookie, 3);
    const res = await createShare(h, cookie);
    expect(res.status).toBe(402);
    const b = await body(res);
    expect(b.error).toBe('supporter_required');
    expect(b.message).toMatch(/3 Törns/);
    expect(b.message).toMatch(/Kaffee oder Bier/);
    const count = await (await h.db()).prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').bind(user.id).first<{ n: number }>();
    expect(count!.n).toBe(3);
  });

  it('[F-60] das Kontingent wird vor dem Einlesen des Uploads geprüft (402 auch bei ungültigem Body)', async () => {
    const { cookie } = await login(h, email());
    await shares(h, cookie, 3);
    const res = await createShare(h, cookie, { body: new TextEncoder().encode('kein gzip'.repeat(10)) as Uint8Array<ArrayBuffer> });
    expect(res.status).toBe(402);
  });

  it('[F-60] /api/me/support nennt Status, Ende und Speicher; ohne Anmeldung 401', async () => {
    const { cookie } = await login(h, email());
    await shares(h, cookie, 2);
    const res = await h.fetch('/api/me/support', { cookie });
    expect(res.status).toBe(200);
    const s = await body(res);
    expect(s).toMatchObject({ supporter: false, supporterUntil: null, sharesUsed: 2, sharesFree: 3, sharesMax: 100, bytesMax: 200 * 1024 * 1024 });
    expect(s.bytesUsed).toBeGreaterThan(0);
    expect((await h.fetch('/api/me/support')).status).toBe(401);
  });

  it('[F-60] Löschen einer Freigabe schafft wieder Platz', async () => {
    const { cookie } = await login(h, email());
    await shares(h, cookie, 3);
    const { shares: list } = (await (await h.fetch('/api/shares', { cookie })).json()) as { shares: Array<{ id: string }> };
    expect((await h.fetch(`/api/shares/${list[0].id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await createShare(h, cookie)).status).toBe(201);
  });

  it('[F-60] abgelaufene Unterstützung: bestehende Freigaben bleiben (ändern geht), nur neue werden abgelehnt', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    await shares(h, cookie, 5);
    // Unterstützung läuft ab
    await (await h.db()).prepare('UPDATE supports SET valid_until = ? WHERE user_id = ?').bind(Date.now() - 1000, user.id).run();
    const s = await status(h, cookie);
    expect(s.supporter).toBe(false);
    expect(s.supporterUntil).toBeLessThan(Date.now());
    const { shares: list } = (await (await h.fetch('/api/shares', { cookie })).json()) as { shares: Array<{ id: string }> };
    expect(list).toHaveLength(5);
    const patch = await h.fetch(`/api/shares/${list[0].id}`, { method: 'PATCH', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Neu' }) });
    expect(patch.status).toBe(200);
    expect((await h.fetch(`/api/shares/${list[4].id}/data`)).status).toBe(200);
    expect((await createShare(h, cookie)).status).toBe(402);
  });

  it('[F-60] auch Unterstützer haben höchstens 100 Törns (409 quota)', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    const db = await h.db();
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      await db
        .prepare('INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at) VALUES (?, ?, ?, 10, 1, ?, ?)')
        .bind(`cap${user.id.slice(0, 10)}${String(i).padStart(3, '0')}`, user.id, `Törn ${i}`, now, now)
        .run();
    }
    expect(await status(h, cookie)).toMatchObject({ supporter: true, sharesUsed: 100, sharesMax: 100 });
    const res = await createShare(h, cookie);
    expect(res.status).toBe(409);
    const b = await body(res);
    expect(b.error).toBe('quota');
    expect(b.message).toMatch(/Maximal 100 Törns/);
  });
});

// ---------------------------------------------------------------- Stripe-Checkout

describe('F-61 Stripe-Checkout', () => {
  it('[F-61] ohne Anmeldung 401, fremder Origin 403 – Stripe wird nicht aufgerufen', async () => {
    expect((await checkout(h, undefined, 500)).status).toBe(401);
    const { cookie } = await login(h, email());
    const res = await checkout(h, cookie, 500, 'https://evil.example');
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe('forbidden_origin');
    expect(stubRequests).toHaveLength(0);
  });

  it('[F-61] nur die festen Stufen sind erlaubt (400 invalid_amount)', async () => {
    const { cookie } = await login(h, email());
    for (const amount of [499, '500', 0, -500, 5.5, 1_000_000, null, undefined]) {
      const res = await checkout(h, cookie, amount);
      expect(res.status, String(amount)).toBe(400);
      expect((await body(res)).error, String(amount)).toBe('invalid_amount');
    }
    expect(stubRequests).toHaveLength(0);
  });

  it('[F-62] nicht eingerichtet (ohne Secrets oder ohne Webhook-Secret) → 503 support_unconfigured', async () => {
    for (const hh of [h0, hHalf]) {
      const { cookie } = await login(hh, email());
      const res = await checkout(hh, cookie, 500);
      expect(res.status).toBe(503);
      expect((await body(res)).error).toBe('support_unconfigured');
    }
  });

  it('[F-61] legt eine Checkout-Session an: Form-POST mit Betrag, eur, Konto, Metadaten und Bearer-Key', async () => {
    const { cookie, user } = await login(h, email());
    const res = await checkout(h, cookie, 1000);
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ url: `${stubOrigin}/pay/cs_test_stub` });

    expect(stubRequests).toHaveLength(1);
    const r = stubRequests[0];
    expect(r.method).toBe('POST');
    expect(r.path).toBe('/v1/checkout/sessions');
    expect(r.auth).toBe(`Bearer ${KEY}`);
    expect(r.contentType).toMatch(/^application\/x-www-form-urlencoded/);
    const f = Object.fromEntries(r.form);
    expect(f).toMatchObject({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': '1000',
      client_reference_id: user.id,
      customer_email: user.email,
      'metadata[app]': 'sail-explorer',
      'metadata[user_id]': user.id,
      success_url: 'http://localhost/?support=success',
      cancel_url: 'http://localhost/?support=cancel',
    });
    expect(f['line_items[0][price_data][product_data][name]']).toMatch(/Runde/);
  });

  it('[F-61] Stripe-Fehler oder fremde Weiterleitungs-URL → 502 checkout_failed', async () => {
    const { cookie } = await login(h, email());
    stubReply = () => ({ status: 500, body: { error: { message: 'boom' } } });
    let res = await checkout(h, cookie, 300);
    expect(res.status).toBe(502);
    expect((await body(res)).error).toBe('checkout_failed');

    stubReply = () => ({ status: 200, body: { id: 'cs_test_x', url: 'https://evil.example/pay' } });
    res = await checkout(h, cookie, 300);
    expect(res.status).toBe(502);

    stubReply = () => ({ status: 200, body: { id: 'cs_test_x', url: 'javascript:alert(1)' } });
    res = await checkout(h, cookie, 300);
    expect(res.status).toBe(502);
  });

  it('[F-61] STRIPE_API_BASE auf einem fremden Host wird abgelehnt (der Schlüssel verlässt den Worker nicht)', async () => {
    const { cookie } = await login(hEvil, email());
    const res = await checkout(hEvil, cookie, 500);
    expect(res.status).toBe(500);
    expect((await body(res)).error).toBe('stripe_base');
  });
});

// ---------------------------------------------------------------- Stripe-Webhook

describe('F-61 Unterstützen per Stripe-Webhook', () => {
  it('[F-61] bezahlte Session schaltet für 365 Tage frei – danach ist die 4. Freigabe erlaubt', async () => {
    const { cookie, user } = await login(h, email());
    await shares(h, cookie, 3);
    expect((await createShare(h, cookie)).status).toBe(402);

    const before = Date.now();
    const res = await webhook(h, checkoutEvent(user.id));
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    const s = await status(h, cookie);
    expect(s).toMatchObject({ supporter: true, sharesUsed: 3 });
    expect(s.supporterUntil).toBeGreaterThanOrEqual(before + YEAR);
    expect(s.supporterUntil).toBeLessThanOrEqual(after + YEAR);
    expect((await createShare(h, cookie)).status).toBe(201);
    expect(await supportRows(h, user.id)).toEqual([{ provider: 'stripe', provider_ref: expect.stringMatching(/^cs_test_/), amount: 500, currency: 'eur' }]);
  });

  it('[F-61] eine zweite Zahlung verlängert ab dem laufenden Ende, nicht ab heute', async () => {
    const { cookie, user } = await login(h, email());
    expect((await webhook(h, checkoutEvent(user.id))).status).toBe(200);
    const first = (await status(h, cookie)).supporterUntil as number;
    expect((await webhook(h, checkoutEvent(user.id, { amount_total: 300 }))).status).toBe(200);
    const second = (await status(h, cookie)).supporterUntil as number;
    expect(second).toBe(first + YEAR);
    expect(await supportRows(h, user.id)).toHaveLength(2);
  });

  it('[F-61] nach abgelaufener Unterstützung zählt eine neue Zahlung ab heute', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id, Date.now() - 30 * DAY);
    const before = Date.now();
    expect((await webhook(h, checkoutEvent(user.id))).status).toBe(200);
    const until = (await status(h, cookie)).supporterUntil as number;
    expect(until).toBeGreaterThanOrEqual(before + YEAR);
    expect(until).toBeLessThan(before + YEAR + 60_000);
  });

  it('[F-61] doppelt zugestellter Webhook ist idempotent (eine Unterstützung, Ende unverändert)', async () => {
    const { cookie, user } = await login(h, email());
    const payload = checkoutEvent(user.id);
    expect((await webhook(h, payload)).status).toBe(200);
    const until = (await status(h, cookie)).supporterUntil;
    expect((await webhook(h, payload)).status).toBe(200);
    // auch als neues Ereignis mit derselben Session (z. B. async_payment_succeeded nach completed)
    const replay = JSON.parse(payload) as { id: string; type: string };
    replay.id = 'evt_other';
    replay.type = 'checkout.session.async_payment_succeeded';
    expect((await webhook(h, JSON.stringify(replay))).status).toBe(200);
    expect(await supportRows(h, user.id)).toHaveLength(1);
    expect((await status(h, cookie)).supporterUntil).toBe(until);
  });

  it('[F-61] Sessions anderer Anwendungen (metadata.app) werden quittiert, aber ignoriert', async () => {
    const { user } = await login(h, email());
    for (const metadata of [{ app: 'other-app' }, {}, null]) {
      const res = await webhook(h, checkoutEvent(user.id, { metadata }));
      expect(res.status).toBe(200);
      expect((await body(res)).ignored).toBe('app');
    }
    expect(await supportRows(h, user.id)).toHaveLength(0);
  });

  it('[F-61] verzögerte Zahlarten: async_payment_succeeded schaltet frei, completed mit unpaid noch nicht', async () => {
    const { user } = await login(h, email());
    const unpaid = await webhook(h, checkoutEvent(user.id, { payment_status: 'unpaid' }));
    expect(unpaid.status).toBe(200);
    expect((await body(unpaid)).ignored).toBe('unpaid');
    expect(await supportRows(h, user.id)).toHaveLength(0);
    expect((await webhook(h, checkoutEvent(user.id, {}, 'checkout.session.async_payment_succeeded'))).status).toBe(200);
    expect(await supportRows(h, user.id)).toHaveLength(1);
  });

  it('[F-61] falsche, fehlende, veraltete oder manipulierte Signatur → 400, nichts freigeschaltet', async () => {
    const { user } = await login(h, email());
    const payload = checkoutEvent(user.id);
    const now = Math.floor(Date.now() / 1000);
    const cases: Array<[string, string | null, string?]> = [
      ['falsches Secret', await stripeSignature('whsec_falsch', payload)],
      ['fehlt', null],
      ['Müll', 't=abc,v1=xyz'],
      ['älter als 5 min', await stripeSignature(SECRET, payload, now - 6 * 60)],
      ['aus der Zukunft', await stripeSignature(SECRET, payload, now + 6 * 60)],
      ['Body verändert', await stripeSignature(SECRET, payload), payload.replace('"amount_total":500', '"amount_total":1')],
    ];
    for (const [label, sig, sent] of cases) {
      const res = await webhook(h, sent ?? payload, sig);
      expect(res.status, label).toBe(400);
      expect((await body(res)).error, label).toBe('invalid_signature');
    }
    expect(await supportRows(h, user.id)).toHaveLength(0);
  });

  it('[F-61] Signatur innerhalb der Toleranz (4 min alt) und mehrere v1-Werte (Secret-Rotation) werden akzeptiert', async () => {
    const { user } = await login(h, email());
    const payload = checkoutEvent(user.id);
    const t = Math.floor(Date.now() / 1000) - 4 * 60;
    const good = (await stripeSignature(SECRET, payload, t)).split(',')[1];
    const res = await webhook(h, payload, `t=${t},v1=${'0'.repeat(64)},${good},v0=ignored`);
    expect(res.status).toBe(200);
    expect(await supportRows(h, user.id)).toHaveLength(1);
  });

  it('[F-61] unbekannte, fehlende oder ungültige client_reference_id wird quittiert, aber ignoriert', async () => {
    const before = await (await h.db()).prepare('SELECT COUNT(*) AS n FROM supports').first<{ n: number }>();
    for (const ref of ['ABCDEFGHJKLMNPQRST', undefined, null, '../../etc', "x' OR 1=1 --", 42]) {
      const res = await webhook(h, checkoutEvent(ref));
      expect(res.status, String(ref)).toBe(200);
      expect((await body(res)).ignored, String(ref)).toBe('user');
    }
    const after = await (await h.db()).prepare('SELECT COUNT(*) AS n FROM supports').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it('[F-61] andere Ereignisse werden quittiert und ignoriert', async () => {
    const { user } = await login(h, email());
    const res = await webhook(h, checkoutEvent(user.id, {}, 'payment_intent.succeeded'));
    expect(res.status).toBe(200);
    expect((await body(res)).ignored).toBe('event');
    expect(await supportRows(h, user.id)).toHaveLength(0);
  });

  it('[F-61] nur die Webhook-Route ist von der Origin-Prüfung ausgenommen', async () => {
    const { cookie } = await login(h, email());
    expect((await createShare(h, cookie, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    const other = await h.fetch('/api/webhooks/stripe-x', { method: 'POST', origin: null, headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(other.status).toBe(403);
    expect((await h.fetch('/api/webhooks/stripe')).status).toBe(405);
  });

  it('[F-37] Konto löschen: die Unterstützung bleibt als Buchung, aber ohne Bezug zum Konto', async () => {
    const { cookie, user } = await login(h, email());
    const payload = checkoutEvent(user.id);
    const ref = (JSON.parse(payload) as { data: { object: { id: string } } }).data.object.id;
    expect((await webhook(h, payload)).status).toBe(200);
    expect((await h.fetch('/api/account', { method: 'DELETE', cookie })).status).toBe(200);
    const row = await (await h.db()).prepare('SELECT user_id FROM supports WHERE provider_ref = ?').bind(ref).first<{ user_id: string | null }>();
    expect(row).toEqual({ user_id: null });
  });
});

// ---------------------------------------------------------------- Ohne Konfiguration

describe('F-62 Ohne Konfiguration: fail closed', () => {
  it('[F-62] Webhook ohne Secret → 503, auch mit „gültiger“ Signatur nichts freigeschaltet', async () => {
    const { user } = await login(h0, email());
    const res = await webhook(h0, checkoutEvent(user.id));
    expect(res.status).toBe(503);
    expect((await body(res)).error).toBe('support_unconfigured');
    expect(await supportRows(h0, user.id)).toHaveLength(0);
  });

  it('[F-62] die 4. Freigabe wird mit verständlicher Meldung abgelehnt (ohne Hinweis auf Zahlung)', async () => {
    const { cookie } = await login(h0, email());
    await shares(h0, cookie, 3);
    const res = await createShare(h0, cookie);
    expect(res.status).toBe(402);
    const b = await body(res);
    expect(b.error).toBe('supporter_required');
    expect(b.message).toMatch(/Lösche einen älteren Törn/);
    expect(b.message).not.toMatch(/Kaffee|Bier/);
  });
});

// ---------------------------------------------------------------- reine Prüffunktionen

describe('F-61 Signatur- und Konfigurationsprüfung (validate.ts)', () => {
  it('[F-61] Stripe-Signature-Header wird robust zerlegt', () => {
    const v1 = 'a'.repeat(64);
    expect(parseStripeSignature(`t=1700000000,v1=${v1},v0=${'b'.repeat(64)}`)).toEqual({ timestamp: 1700000000, signatures: [v1] });
    expect(parseStripeSignature(null)).toBeNull();
    expect(parseStripeSignature(`v1=${v1}`)).toBeNull();
    expect(parseStripeSignature('t=1700000000')).toBeNull();
    expect(parseStripeSignature(`t=1700000000,v1=${'g'.repeat(64)}`)).toBeNull();
  });

  it('[F-61] Vergleich in konstanter Laufzeit liefert korrekte Ergebnisse', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('[F-62] kostenloses Kontingent mit Standard 3, höchstens 100', () => {
    expect(parseFreeShares(undefined)).toBe(3);
    expect(parseFreeShares('5')).toBe(5);
    expect(parseFreeShares('-1')).toBe(3);
    expect(parseFreeShares('9999')).toBe(100);
    expect(parseFreeShares('drei')).toBe(3);
  });
});
