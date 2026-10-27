// Funktionale Tests: Kanäle je Art (F-256), Web Push (F-257) und Live per WebSocket (F-258) – Konzept 17.6 bis 17.8.
// Echter Worker in workerd (Miniflare) mit Durable Object; Push-Dienste per outboundService gefälscht.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';

const DAY = 86_400_000;
const FCM = 'https://fcm.googleapis.com/fcm/send/';
let h: Harness;
let s: ReturnType<typeof social>;
let pushes: Array<{ url: string; auth: string; body: string }> = [];
let pushStatus = 201;
let publicKey = '';

const b64u = (b: ArrayBuffer) => Buffer.from(b).toString('base64url');

beforeAll(async () => {
  // VAPID-Schlüsselpaar wie `scripts/vapid-keys.mjs`
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const d = ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d!;
  h = await startWorker(
    { APP_ORIGIN: 'https://sail.example', VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: d },
    {
      outbound: async (req) => {
        pushes.push({ url: req.url, auth: req.headers.get('Authorization') ?? '', body: await req.text() });
        return new Response(null, { status: pushStatus });
      },
    },
  );
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const settings = async (p: Person) => (await (await s.send('GET', '/api/me/settings', p.cookie)).json()) as { notify: Record<string, string>; notifyComments: string };
const setNotify = (p: Person, notify: unknown) => s.send('PATCH', '/api/me/settings', p.cookie, { notify });
const comment = async (p: Person, shareId: string, body = 'Schöner Törn!') => {
  const res = await s.send('POST', `/api/shares/${shareId}/comments`, p.cookie, { body });
  expect(res.status, await res.clone().text()).toBe(201);
};
const follow = async (p: Person, handle: string) => expect((await s.send('PUT', `/api/follows/user/${handle}`, p.cookie)).status).toBe(200);
const backdate = async (p: Person) => (await s.db()).prepare('UPDATE users SET comments_mailed_at = ? WHERE id = ?').bind(Date.now() - DAY, p.user.id).run();
const mails = (to: string) => h.logs.filter((l) => l.includes(`[mail:log] an ${to}:`));
const digests = (to: string) => mails(to).filter((l) => l.includes('Benachrichtigung'));

// ---------------------------------------------------------------- F-256 Kanäle

describe('F-256 Kanäle je Art: keine, Mail oder Push; Hinweise des Betreibers nicht abschaltbar', () => {
  it('[F-256] Standard und Ändern; Unbekanntes → 400; notifyComments bleibt als Kurzform', async () => {
    const p = await s.person();
    expect((await settings(p)).notify).toEqual({ comment: 'none', reaction: 'none', follow: 'none', invite: 'mail', request: 'none' });
    expect((await setNotify(p, { follow: 'push', comment: 'mail' })).status).toBe(200);
    expect((await settings(p)).notify).toMatchObject({ follow: 'push', comment: 'mail' });
    expect((await settings(p)).notifyComments).toBe('daily');
    for (const bad of [{ follow: 'sms' }, { expiry: 'none' }, { passkey: 'none' }, {}, ['mail'], 'mail']) {
      expect((await setNotify(p, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await s.send('PATCH', '/api/me/settings', p.cookie, { notifyComments: 'off' })).status).toBe(200);
    expect((await settings(p)).notify.comment).toBe('none');
  });

  it('[F-256] Sammelmail über alle Arten mit „Mail“: nur Ungelesenes, ohne Namen; Arten ohne „Mail“ fehlen', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner, { title: 'Rund Rügen' });
    await setNotify(owner, { follow: 'mail', comment: 'none' });
    await backdate(owner);
    const fan = await s.person({ profile: 'public' });
    await follow(fan, owner.handle!);
    await comment(fan, share.id); // Kommentare: keine Mail
    await h.scheduled();
    const got = digests(owner.email);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('1 neue Person folgt dir');
    expect(got[0]).not.toContain('Rund Rügen');
    expect(got[0]).not.toContain(fan.handle!);
    expect(got[0]).toContain('https://sail.example/?konto=einstellungen');
  });

  it('[F-256] Einladung per Profilname: Mail nur bei „Mail“; in der Glocke immer', async () => {
    const from = await s.person({ profile: 'public' });
    const quiet = await s.person({ profile: 'public' });
    await setNotify(quiet, { invite: 'none' });
    expect((await s.send('POST', '/api/invites', from.cookie, { handle: quiet.handle })).status).toBe(201);
    expect(mails(quiet.email).filter((m) => m.includes('lädt dich'))).toHaveLength(0);
    expect(((await (await s.send('GET', '/api/notifications', quiet.cookie)).json()) as { items: Array<{ kind: string }> }).items[0].kind).toBe('invite');
    const loud = await s.person({ profile: 'public' });
    expect((await s.send('POST', '/api/invites', from.cookie, { handle: loud.handle })).status).toBe(201);
    expect(mails(loud.email).filter((m) => m.includes('lädt dich'))).toHaveLength(1);
  });

  it('[F-256] neuer Passkey erscheint als Hinweis in der Glocke ohne Namen und lässt sich nicht abbestellen', async () => {
    const p = await s.person();
    // Der Passkey-Weg selbst ist in passkeys.test.ts geprüft; hier nur die Zeile, die er schreibt.
    await (await s.db())
      .prepare(`INSERT INTO notifications (id, user_id, kind, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, 'passkey', 'user', ?, ?, ?)`)
      .bind(`pk${Date.now()}`, p.user.id, p.user.id, Date.now(), Date.now())
      .run();
    const { items } = (await (await s.send('GET', '/api/notifications', p.cookie)).json()) as { items: Array<{ kind: string; href: string; actor: unknown; text: string }> };
    expect(items[0]).toMatchObject({ kind: 'passkey', href: '/?konto=einstellungen', actor: null });
    expect(items[0].text).toMatch(/Neuer Passkey/);
  });
});

// ---------------------------------------------------------------- F-257 Push

describe('F-257 Web Push: leere Weckrufe mit VAPID an gewählte Arten', () => {
  it('[F-257] Schlüssel öffentlich; Abo nur angemeldet und nur bei bekannten Push-Diensten', async () => {
    expect(await (await s.send('GET', '/api/push/key', undefined)).json()).toEqual({ publicKey });
    const p = await s.person();
    expect((await s.send('PUT', '/api/me/push', undefined, { endpoint: `${FCM}x` })).status).toBe(401);
    for (const endpoint of ['https://evil.example/push', 'http://fcm.googleapis.com/x', 'javascript:alert(1)', 42]) {
      expect((await s.send('PUT', '/api/me/push', p.cookie, { endpoint })).status, String(endpoint)).toBe(400);
    }
    for (const endpoint of ['https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=1', 'https://updates.push.services.mozilla.com/wpush/v2/x']) {
      expect((await s.send('PUT', '/api/me/push', p.cookie, { endpoint })).status, endpoint).toBe(204);
    }
  });

  it('[F-257] Push nur für Arten auf „Push“, ohne Inhalt, mit VAPID-Signatur; 410 entfernt das Abo; höchstens 10 Geräte', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    const ep = `${FCM}owner-${Date.now()}`;
    expect((await s.send('PUT', '/api/me/push', owner.cookie, { endpoint: ep })).status).toBe(204);
    await setNotify(owner, { follow: 'push' });
    pushes = [];
    const fan = await s.person({ profile: 'public' });
    await comment(fan, share.id); // Kommentare: kein Push
    expect(pushes).toHaveLength(0);
    await follow(fan, owner.handle!);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].url).toBe(ep);
    expect(pushes[0].body).toBe('');
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(pushes[0].auth)!;
    expect(m[4]).toBe(publicKey);
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    const key = await crypto.subtle.importKey('raw', Buffer.from(publicKey, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(m[3], 'base64url'), new TextEncoder().encode(`${m[1]}.${m[2]}`))).toBe(true);

    pushStatus = 410;
    await follow(await s.person({ profile: 'public' }), owner.handle!);
    pushStatus = 201;
    expect(await (await s.db()).prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(owner.user.id).first<{ n: number }>().then((r) => r?.n)).toBe(0);

    for (let i = 0; i < 12; i++) await s.send('PUT', '/api/me/push', owner.cookie, { endpoint: `${FCM}dev${i}-${Date.now()}` });
    expect(await (await s.db()).prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(owner.user.id).first<{ n: number }>().then((r) => r?.n)).toBe(10);
  });

  it('[F-257] Abmelden nur eigene Abos; Konto löschen entfernt sie; nach einem Jahr ohne Zustellung nächtlich weg', async () => {
    const a = await s.person();
    const b = await s.person();
    const ep = `${FCM}a-${Date.now()}`;
    await s.send('PUT', '/api/me/push', a.cookie, { endpoint: ep });
    await s.send('DELETE', '/api/me/push', b.cookie, { endpoint: ep });
    const db = await s.db();
    const n = (id: string) => db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(id).first<{ n: number }>().then((r) => r?.n);
    expect(await n(a.user.id)).toBe(1);
    expect((await s.send('DELETE', '/api/me/push', a.cookie, { endpoint: ep })).status).toBe(204);
    expect(await n(a.user.id)).toBe(0);

    await s.send('PUT', '/api/me/push', a.cookie, { endpoint: ep });
    expect((await s.send('DELETE', '/api/account', a.cookie)).status).toBe(200);
    expect(await n(a.user.id)).toBe(0);

    const old = `${FCM}old-${Date.now()}`;
    await s.send('PUT', '/api/me/push', b.cookie, { endpoint: old });
    await db.prepare('UPDATE push_subscriptions SET created_at = ? WHERE endpoint = ?').bind(Date.now() - 400 * DAY, old).run();
    await h.scheduled();
    expect(await n(b.user.id)).toBe(0);
  });
});

// ---------------------------------------------------------------- F-258 Live

/** WebSocket über Miniflare öffnen; sammelt eingehende Nachrichten. */
async function live(p: Person | null, origin: string | null = 'http://localhost') {
  const headers: Record<string, string> = { Upgrade: 'websocket' };
  if (origin) headers.Origin = origin;
  const res = await h.fetch('/api/notifications/live', { cookie: p?.cookie, headers });
  const ws = (res as Response & { webSocket: (WebSocket & { accept(): void }) | null }).webSocket;
  const got: string[] = [];
  if (ws) {
    ws.accept();
    ws.addEventListener('message', (e) => got.push(String(e.data)));
  }
  return { res, ws, got };
}
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return cond();
};

describe('F-258 Live per WebSocket: „geändert“ an offene Seiten des Kontos', () => {
  it('[F-258] nur angemeldet, nur von der eigenen Seite, nur per Upgrade', async () => {
    const p = await s.person();
    expect((await live(null)).res.status).toBe(401);
    expect((await live(p, 'https://evil.example')).res.status).toBe(403);
    expect((await live(p, null)).res.status).toBe(403);
    expect((await h.fetch('/api/notifications/live', { cookie: p.cookie })).status).toBe(426);
    const ok = await live(p);
    expect(ok.res.status).toBe(101);
    ok.ws!.close();
  });

  it('[F-258] neue Benachrichtigung und Gelesen-Markieren melden „changed“ – nur an das betroffene Konto, ohne Inhalt', async () => {
    const owner = await s.person({ profile: 'public' });
    const other = await s.person();
    const share = await s.share(owner);
    const a = await live(owner);
    const b = await live(owner); // zweiter Tab
    const x = await live(other);
    await comment(await s.person({ profile: 'public' }), share.id);
    expect(await until(() => a.got.length > 0 && b.got.length > 0)).toBe(true);
    expect(a.got).toEqual(['changed']);
    expect(x.got).toEqual([]);
    a.got.length = 0;
    await s.send('POST', '/api/notifications/read', owner.cookie, { all: true });
    expect(await until(() => a.got.length > 0)).toBe(true);
    // „ping“ hält die Verbindung, Antwort kommt vom Durable Object ohne Aufwachen
    a.ws!.send('ping');
    expect(await until(() => a.got.includes('pong'))).toBe(true);
    for (const c of [a, b, x]) c.ws!.close();
  });
});
