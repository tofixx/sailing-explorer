// Funktionale Tests: kostenloses Kontingent, Unterstützen per Stripe-Webhook, Fail-closed (F-60 … F-62).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
// h: Unterstützen eingerichtet (Payment-Links + Webhook-Secret), h0: ohne Konfiguration (wie wrangler.jsonc ohne Secrets).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, grantSupport, login, startWorker, stripeSignature, type Harness } from './worker-harness';
import { parseFreeShares, parseStripeSignature, parseSupportLink, timingSafeEqual } from '../../worker/validate';

const SECRET = 'whsec_test_0123456789abcdef';
const COFFEE = 'https://buy.stripe.com/test_coffee';
const BEER = 'https://buy.stripe.com/test_beer';

let h: Harness;
let h0: Harness;
let n = 0;
const email = (tag = 's') => `${tag}${++n}-${Date.now()}@example.org`;
const sessionId = () => `cs_test_${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  [h, h0] = await Promise.all([
    startWorker({ STRIPE_WEBHOOK_SECRET: SECRET, SUPPORT_LINK_COFFEE: COFFEE, SUPPORT_LINK_BEER: BEER }),
    startWorker(),
  ]);
}, 90_000);
afterAll(async () => {
  await Promise.all([h?.dispose(), h0?.dispose()]);
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
    data: { object: { id: sessionId(), object: 'checkout.session', client_reference_id: userId, payment_status: 'paid', amount_total: 500, currency: 'eur', ...session } },
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

  it('[F-60] /api/me/support nennt Status und genutzte Freigaben; ohne Anmeldung 401', async () => {
    const { cookie } = await login(h, email());
    await shares(h, cookie, 2);
    const res = await h.fetch('/api/me/support', { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ supporter: false, sharesUsed: 2, sharesFree: 3, sharesMax: 500 });
    expect((await h.fetch('/api/me/support')).status).toBe(401);
  });

  it('[F-60] Löschen einer Freigabe schafft wieder Platz', async () => {
    const { cookie } = await login(h, email());
    await shares(h, cookie, 3);
    const { shares: list } = (await (await h.fetch('/api/shares', { cookie })).json()) as { shares: Array<{ id: string }> };
    expect((await h.fetch(`/api/shares/${list[0].id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await createShare(h, cookie)).status).toBe(201);
  });

  it('[F-60] wer schon mehr Freigaben hat, behält sie (ändern geht), nur neue werden abgelehnt', async () => {
    const { cookie, user } = await login(h, email());
    await grantSupport(h, user.id);
    await shares(h, cookie, 5);
    // Unterstützung entfällt (z. B. Altbestand vor Einführung des Kontingents)
    await (await h.db()).prepare('DELETE FROM supports WHERE user_id = ?').bind(user.id).run();
    const { shares: list } = (await (await h.fetch('/api/shares', { cookie })).json()) as { shares: Array<{ id: string }> };
    expect(list).toHaveLength(5);
    const patch = await h.fetch(`/api/shares/${list[0].id}`, { method: 'PATCH', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Neu' }) });
    expect(patch.status).toBe(200);
    expect((await h.fetch(`/api/shares/${list[4].id}/data`)).status).toBe(200);
    expect((await createShare(h, cookie)).status).toBe(402);
  });

  it('[F-60] /api/config nennt kostenloses Kontingent und (nur öffentliche) Payment-Links', async () => {
    const cfg = await body(await h.fetch('/api/config'));
    expect(cfg).toMatchObject({ sharing: true, freeShares: 3, support: { coffee: COFFEE, beer: BEER } });
    expect(JSON.stringify(cfg)).not.toContain(SECRET);
  });
});

// ---------------------------------------------------------------- Stripe-Webhook

describe('F-61 Unterstützen per Stripe-Webhook', () => {
  it('[F-61] gültig signierter checkout.session.completed schaltet frei – danach ist die 4. Freigabe erlaubt', async () => {
    const { cookie, user } = await login(h, email());
    await shares(h, cookie, 3);
    expect((await createShare(h, cookie)).status).toBe(402);

    const res = await webhook(h, checkoutEvent(user.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    expect(await body(await h.fetch('/api/me/support', { cookie }))).toMatchObject({ supporter: true, sharesUsed: 3 });
    expect((await createShare(h, cookie)).status).toBe(201);
    expect(await supportRows(h, user.id)).toEqual([{ provider: 'stripe', provider_ref: expect.stringMatching(/^cs_test_/), amount: 500, currency: 'eur' }]);
  });

  it('[F-61] verzögerte Zahlarten: async_payment_succeeded schaltet frei, completed mit unpaid noch nicht', async () => {
    const { user } = await login(h, email());
    expect((await webhook(h, checkoutEvent(user.id, { payment_status: 'unpaid' }))).status).toBe(200);
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

  it('[F-61] doppelt zugestellter Webhook ist idempotent (eine Unterstützung pro Checkout-Session)', async () => {
    const { user } = await login(h, email());
    const payload = checkoutEvent(user.id);
    expect((await webhook(h, payload)).status).toBe(200);
    expect((await webhook(h, payload)).status).toBe(200);
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
    // Webhook ohne Origin: ok (oben). Andere Mutationen ohne Origin bleiben gesperrt.
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
  it('[F-62] /api/config meldet Unterstützen als nicht eingerichtet', async () => {
    expect(await body(await h0.fetch('/api/config'))).toMatchObject({ support: null, freeShares: 3 });
  });

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

  it('[F-62] Payment-Links nur als https ohne Querystring; kostenloses Kontingent mit Standard 3', () => {
    expect(parseSupportLink(COFFEE)).toBe(COFFEE);
    expect(parseSupportLink('')).toBeNull();
    expect(parseSupportLink('http://buy.stripe.com/x')).toBeNull();
    expect(parseSupportLink('javascript:alert(1)')).toBeNull();
    expect(parseSupportLink('https://buy.stripe.com/x?client_reference_id=evil')).toBeNull();
    expect(parseFreeShares(undefined)).toBe(3);
    expect(parseFreeShares('5')).toBe(5);
    expect(parseFreeShares('-1')).toBe(3);
    expect(parseFreeShares('9999')).toBe(500);
    expect(parseFreeShares('drei')).toBe(3);
  });
});
