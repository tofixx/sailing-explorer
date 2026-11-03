// Funktionale Tests: Push bei Änderung und Absage von Veranstaltungen (Konzept 30.3, F-484, F-485) – Push-Dienste per
// outboundService gefälscht wie in notifications-channels.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';

const H = 3_600_000;
const FCM = 'https://fcm.googleapis.com/fcm/send/';
let h: Harness;
let s: ReturnType<typeof social>;
let pushes: string[] = [];

const b64u = (b: ArrayBuffer) => Buffer.from(b).toString('base64url');

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const d = ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d!;
  h = await startWorker(
    { APP_ORIGIN: 'https://sail.example', VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: d },
    {
      outbound: async (req) => {
        pushes.push(req.url);
        return new Response(null, { status: 201 });
      },
    },
  );
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

/** Mitglied mit Push für „Veranstaltungen“ auf einem Gerät. */
async function pushMember(): Promise<{ p: Person; ep: string }> {
  const p = await s.person({ profile: 'public' });
  const ep = `${FCM}ev-${p.user.id}`;
  expect((await s.send('PUT', '/api/me/push', p.cookie, { endpoint: ep })).status).toBe(204);
  expect((await s.send('PATCH', '/api/me/settings', p.cookie, { notify: { event: 'push' } })).status).toBe(200);
  return { p, ep };
}

describe('F-484 Push bei Änderung und Absage', () => {
  it('[F-484] Änderung weckt einmal (neue Zeile), weitere Änderungen nicht; nach ungelesener Erinnerung und bei Absage wieder', async () => {
    const owner = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: s.uniq('Pushverein') });
    const { p, ep } = await pushMember();
    await s.join(owner, club, p);
    const start = Date.now() + 10 * H;
    const create = await s.send('POST', '/api/posts', owner.cookie, {
      channel: { kind: 'group', id: club.id }, kind: 'event', body: 'Ansegeln', visibility: 'public',
      event: { type: 'sail', startsAt: start, endsAt: start + 2 * H, place: 'Steg B' },
    });
    expect(create.status, await create.clone().text()).toBe(201);
    const id = ((await create.json()) as { post: { id: string } }).post.id;
    expect((await s.send('PUT', `/api/posts/${id}/rsvp`, p.cookie, { status: 'yes' })).status).toBe(200);
    const change = (place: string) => s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, { type: 'sail', startsAt: start, endsAt: start + 2 * H, place, capacity: null });

    pushes = [];
    expect((await change('Steg C')).status).toBe(200);
    expect(pushes).toEqual([ep]);
    expect((await change('Steg D')).status).toBe(200);
    expect(pushes).toEqual([ep]);

    // gelesen, dann Erinnerung im Nachtlauf (ohne Push) – die nächste Änderung weckt wieder
    await (await s.db()).prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ?`).bind(Date.now(), p.user.id).run();
    expect((await h.scheduled()).outcome).toBe('ok');
    expect(pushes).toEqual([ep]);
    expect((await change('Steg E')).status).toBe(200);
    expect(pushes).toEqual([ep, ep]);

    // Absage weckt immer, auch bei ungelesener Änderung
    expect((await s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, { cancel: true })).status).toBe(200);
    expect(pushes).toEqual([ep, ep, ep]);
  });
});
