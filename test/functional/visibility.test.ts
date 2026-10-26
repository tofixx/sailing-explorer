// Funktionale Tests Phase A: drei Sichtbarkeitsstufen, Unterstützer-Regel (E1/E4), Teilen-Schlüssel,
// Altbestand, Link-Vorschau mit Schlüssel und robots (F-80 … F-86, F-90 … F-93, F-124).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, loginSupporter, randomIp, startWorker, type Harness } from './worker-harness';

let h: Harness;
let n = 0;
const email = (tag = 'v') => `${tag}${++n}-${Date.now()}@example.org`;
const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;
const UNKNOWN_SHARE = 'ABCDEFGHJKLMNPQRST';
const WRONG_KEY = 'WrongKeyWrongKeyWrong2';

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

type Vis = 'public' | 'unlisted' | 'private';
interface Share { id: string; visibility: Vis; shareKey: string | null; link: string | null; title: string; isOwner: boolean }
interface Boat { id: string; visibility: Vis; shareKey: string | null; link: string | null; role: string | null }
interface Profile { handle: string; visibility: Vis; shareKey: string | null; link: string | null; isSelf: boolean }

const send = (method: string, path: string, cookie: string | undefined, body?: unknown, headers: Record<string, string> = {}) =>
  h.fetch(path, {
    method,
    cookie,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const getJson = async <T>(res: Response) => (await res.json()) as T;
const withKey = (key: string | null | undefined): Record<string, string> => (key ? { 'X-Share-Key': key } : {});

async function newShare(cookie: string, visibility?: Vis, title = 'Törn'): Promise<Share> {
  const res = await createShare(h, cookie, { visibility: visibility ?? '', title });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await getJson<{ share: Share }>(res)).share;
}
const patchShare = (id: string, cookie: string, body: unknown) => send('PATCH', `/api/shares/${id}`, cookie, body);
const getShare = (id: string, o: { cookie?: string; key?: string | null } = {}) => h.fetch(`/api/shares/${id}`, { cookie: o.cookie, headers: withKey(o.key) });

async function newBoat(cookie: string, input: Record<string, unknown> = {}): Promise<Response> {
  return send('POST', '/api/boats', cookie, { name: 'Seeschwalbe', ...input });
}
const putProfile = (cookie: string, body: Record<string, unknown>) => send('PUT', '/api/me/profile', cookie, { displayName: 'Käpt’n Test', bio: 'Ostsee', ...body });

async function expire(userId: string) {
  await (await h.db()).prepare('UPDATE supports SET valid_until = ? WHERE user_id = ?').bind(Date.now() - 1000, userId).run();
}

/** Seite holen und die Vorschau-Felder auslesen. */
async function page(path: string) {
  const html = await (await h.fetch(path)).text();
  return {
    html,
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
    ogImage: /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1],
    noindex: html.includes('<meta name="robots" content="noindex">'),
  };
}

// ---------------------------------------------------------------- F-124 / E1: kostenlos ist öffentlich

describe('F-124 Sichtbarkeit nur für Unterstützer (E1)', () => {
  it('[F-124] kostenlos: neue Törns sind öffentlich; „Nur mit Link“/„Nur ich“ → 402 supporter_required, nichts gespeichert', async () => {
    const { cookie } = await login(h, email());
    expect((await newShare(cookie)).visibility).toBe('public');
    for (const v of ['unlisted', 'private'] as const) {
      const res = await createShare(h, cookie, { visibility: v });
      expect(res.status, v).toBe(402);
      const body = await getJson<{ error: string; message: string }>(res);
      expect(body.error).toBe('supporter_required');
      expect(body.message).toContain('Unterstützer');
    }
    expect((await getJson<{ shares: unknown[] }>(await h.fetch('/api/shares', { cookie }))).shares).toHaveLength(1);
  });

  it('[F-124] kostenlos: PATCH auf „Nur mit Link“ oder „Nur ich“ → 402, Törn bleibt öffentlich', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    for (const v of ['unlisted', 'private']) expect((await patchShare(s.id, cookie, { visibility: v })).status, v).toBe(402);
    expect((await patchShare(s.id, cookie, { visibility: 'public', title: 'Neu' })).status).toBe(200);
    expect((await getJson<{ share: Share }>(await getShare(s.id))).share).toMatchObject({ visibility: 'public', title: 'Neu' });
  });

  it('[F-124] kostenlos: Boote neu öffentlich, nicht öffentliche Stufen → 402 (anlegen und ändern)', async () => {
    const { cookie } = await login(h, email());
    const ok = await newBoat(cookie);
    expect(ok.status).toBe(201);
    const boat = (await getJson<{ boat: Boat }>(ok)).boat;
    expect(boat).toMatchObject({ visibility: 'public', shareKey: null, link: `/b/${boat.id}` });
    for (const v of ['unlisted', 'private']) {
      expect((await newBoat(cookie, { visibility: v })).status, v).toBe(402);
      expect((await send('PATCH', `/api/boats/${boat.id}`, cookie, { visibility: v })).status, v).toBe(402);
    }
    expect((await getJson<{ boats: Boat[] }>(await h.fetch('/api/boats', { cookie }))).boats).toHaveLength(1);
  });

  it('[F-124] kostenlos: Profil neu öffentlich, nicht öffentliche Stufen → 402', async () => {
    const { cookie } = await login(h, email());
    const handle = uniq('free');
    for (const v of ['unlisted', 'private']) expect((await putProfile(cookie, { handle, visibility: v })).status, v).toBe(402);
    expect((await send('GET', '/api/me/profile', cookie).then((r) => getJson<{ exists: boolean }>(r))).exists).toBe(false);
    const res = await putProfile(cookie, { handle });
    expect((await getJson<{ profile: Profile }>(res)).profile).toMatchObject({ visibility: 'public', shareKey: null, link: `/u/${handle}` });
    expect((await putProfile(cookie, { handle, visibility: 'private' })).status).toBe(402);
  });

  it('[F-80] Unterstützer können alle drei Stufen für Törns, Boote und Profile setzen', async () => {
    const { cookie } = await loginSupporter(h, email());
    for (const v of ['public', 'unlisted', 'private'] as const) {
      expect((await newShare(cookie, v)).visibility).toBe(v);
      expect((await getJson<{ boat: Boat }>(await newBoat(cookie, { visibility: v }))).boat.visibility).toBe(v);
    }
    const handle = uniq('sup');
    for (const v of ['private', 'unlisted', 'public'] as const) {
      expect((await getJson<{ profile: Profile }>(await putProfile(cookie, { handle, visibility: v }))).profile.visibility).toBe(v);
    }
  });

  it('[F-124] abgelaufener Unterstützer: Bestehendes bleibt (auch beim Ändern), neu setzen → 402, „Öffentlich“ geht immer', async () => {
    const { cookie, user } = await loginSupporter(h, email());
    const link = await newShare(cookie, 'unlisted');
    const priv = await newShare(cookie, 'private');
    const boat = (await getJson<{ boat: Boat }>(await newBoat(cookie, { visibility: 'private' }))).boat;
    const handle = uniq('ex');
    expect((await putProfile(cookie, { handle, visibility: 'unlisted' })).status).toBe(200);
    await expire(user.id);

    // bleibt, wie es ist (E4): andere Felder ändern, gleiche Stufe erneut senden, Link erneuern
    expect((await patchShare(link.id, cookie, { title: 'Umbenannt', visibility: 'unlisted' })).status).toBe(200);
    expect((await patchShare(link.id, cookie, { rotateKey: true })).status).toBe(200);
    expect((await send('PATCH', `/api/boats/${boat.id}`, cookie, { description: 'neu', visibility: 'private' })).status).toBe(200);
    const kept = await putProfile(cookie, { handle, bio: 'neu' }); // ohne visibility: bisherige bleibt
    expect((await getJson<{ profile: Profile }>(kept)).profile.visibility).toBe('unlisted');
    expect((await getJson<{ share: Share }>(await getShare(priv.id, { cookie }))).share.visibility).toBe('private');

    // neu setzen geht nicht mehr
    expect((await patchShare(link.id, cookie, { visibility: 'private' })).status).toBe(402);
    expect((await patchShare(priv.id, cookie, { visibility: 'unlisted' })).status).toBe(402);
    expect((await send('PATCH', `/api/boats/${boat.id}`, cookie, { visibility: 'unlisted' })).status).toBe(402);
    expect((await putProfile(cookie, { handle, visibility: 'private' })).status).toBe(402);
    expect((await createShare(h, cookie, { visibility: 'unlisted' })).status).toBe(402);

    // auf „Öffentlich“ geht immer – zurück dann nicht mehr
    expect((await patchShare(priv.id, cookie, { visibility: 'public' })).status).toBe(200);
    expect((await patchShare(priv.id, cookie, { visibility: 'private' })).status).toBe(402);
    expect((await send('PATCH', `/api/boats/${boat.id}`, cookie, { visibility: 'public' })).status).toBe(200);
    expect((await putProfile(cookie, { handle, visibility: 'public' })).status).toBe(200);
  });

  it('[F-124] Boote: es zählt der Status des Eigners, nicht der des Admins', async () => {
    const owner = await login(h, email());
    const admin = await loginSupporter(h, email());
    const boat = (await getJson<{ boat: Boat }>(await newBoat(owner.cookie))).boat;
    await (await h.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(boat.id, admin.user.id, Date.now()).run();
    expect((await send('PATCH', `/api/boats/${boat.id}`, admin.cookie, { visibility: 'unlisted' })).status).toBe(402);
  });
});

// ---------------------------------------------------------------- F-90 … F-93 Schlüssel

describe('F-90 … F-93 Teilen-Schlüssel', () => {
  it('[F-90] „Nur mit Link“: Schlüssel (22 Zeichen) und Link /s/<id>/<key> nur für den Eigentümer', async () => {
    const { cookie } = await loginSupporter(h, email());
    const s = await newShare(cookie, 'unlisted');
    expect(s.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(s.link).toBe(`/s/${s.id}/${s.shareKey}`);
    const mine = (await getJson<{ shares: Share[] }>(await h.fetch('/api/shares', { cookie }))).shares[0];
    expect(mine).toMatchObject({ shareKey: s.shareKey, link: s.link });
    // Betrachter mit Schlüssel: kein Schlüssel, kein Link in der Antwort
    const other = await login(h, email());
    for (const c of [undefined, other.cookie]) {
      const seen = (await getJson<{ share: Share }>(await getShare(s.id, { cookie: c, key: s.shareKey }))).share;
      expect(seen).toMatchObject({ isOwner: false, shareKey: null, link: null });
    }
    // „Nur ich“ hat (noch) keinen Schlüssel; öffentlich: Link ohne Schlüssel
    const p = await newShare(cookie, 'private');
    expect(p).toMatchObject({ shareKey: null, link: `/s/${p.id}` });
  });

  it('[F-93] ohne, mit falschem oder kaputtem Schlüssel: dieselbe 404 wie eine unbekannte ID (Metadaten und Daten)', async () => {
    const owner = await loginSupporter(h, email());
    const other = await login(h, email());
    const s = await newShare(owner.cookie, 'unlisted');
    const bodies = new Set<string>();
    for (const [path, key, cookie] of [
      [`/api/shares/${s.id}`, null, undefined],
      [`/api/shares/${s.id}`, WRONG_KEY, undefined],
      [`/api/shares/${s.id}`, WRONG_KEY, other.cookie],
      [`/api/shares/${s.id}`, '<script>', undefined],
      [`/api/shares/${s.id}`, s.shareKey!.slice(0, 21), undefined],
      [`/api/shares/${s.id}/data`, null, undefined],
      [`/api/shares/${s.id}/data`, WRONG_KEY, other.cookie],
      [`/api/shares/${UNKNOWN_SHARE}`, null, undefined],
      [`/api/shares/${UNKNOWN_SHARE}`, s.shareKey, undefined],
      [`/api/shares/${UNKNOWN_SHARE}/data`, null, undefined],
    ] as const) {
      const res = await h.fetch(path, { cookie, headers: withKey(key) });
      expect(res.status, `${path} ${key}`).toBe(404);
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
    // mit Schlüssel: Metadaten und Daten
    expect((await getShare(s.id, { key: s.shareKey })).status).toBe(200);
    const data = await h.fetch(`/api/shares/${s.id}/data`, { headers: withKey(s.shareKey) });
    expect(data.status).toBe(200);
    expect(data.headers.get('Vary')).toContain('X-Share-Key');
    // Eigentümer braucht keinen Schlüssel
    expect((await getShare(s.id, { cookie: owner.cookie })).status).toBe(200);
    // ein Schlüssel öffnet nur sein eigenes Objekt
    const s2 = await newShare(owner.cookie, 'unlisted');
    expect((await getShare(s2.id, { key: s.shareKey })).status).toBe(404);
  });

  it('[F-92] rotateKey: neuer Schlüssel, der alte ist sofort 404', async () => {
    const { cookie } = await loginSupporter(h, email());
    const s = await newShare(cookie, 'unlisted');
    const res = await patchShare(s.id, cookie, { rotateKey: true });
    expect(res.status).toBe(200);
    const after = (await getJson<{ share: Share }>(res)).share;
    expect(after.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(after.shareKey).not.toBe(s.shareKey);
    expect(after.link).toBe(`/s/${s.id}/${after.shareKey}`);
    expect((await getShare(s.id, { key: s.shareKey })).status).toBe(404);
    expect((await getShare(s.id, { key: after.shareKey })).status).toBe(200);
    // rotateKey nur mit true; anderes wird ignoriert
    const same = (await getJson<{ share: Share }>(await patchShare(s.id, cookie, { rotateKey: 'yes' }))).share;
    expect(same.shareKey).toBe(after.shareKey);
  });

  it('[F-90] Zustandswechsel: Schlüssel bleibt über „Nur ich“ und „Öffentlich“ erhalten, „Nur ich“ ist für alle 404', async () => {
    const { cookie } = await loginSupporter(h, email());
    const pub = await newShare(cookie, 'public');
    expect(pub.shareKey).toBeNull();
    // öffentlich → nur mit Link: Schlüssel entsteht, /s/<id> allein ist jetzt 404
    const link = (await getJson<{ share: Share }>(await patchShare(pub.id, cookie, { visibility: 'unlisted' }))).share;
    expect(link.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect((await getShare(pub.id)).status).toBe(404);
    // → privat: Schlüssel bleibt gespeichert, öffnet aber nichts
    const priv = (await getJson<{ share: Share }>(await patchShare(pub.id, cookie, { visibility: 'private' }))).share;
    expect(priv.shareKey).toBe(link.shareKey);
    expect((await getShare(pub.id, { key: link.shareKey })).status).toBe(404);
    // → wieder nur mit Link: derselbe Schlüssel gilt wieder
    await patchShare(pub.id, cookie, { visibility: 'unlisted' });
    expect((await getShare(pub.id, { key: link.shareKey })).status).toBe(200);
    // → öffentlich: alter Schlüssel-Link funktioniert weiter, ohne Schlüssel sowieso
    await patchShare(pub.id, cookie, { visibility: 'public' });
    expect((await getShare(pub.id, { key: link.shareKey })).status).toBe(200);
    expect((await getShare(pub.id)).status).toBe(200);
  });

  it('[F-90] öffentliche Törns ignorieren jeden (auch falschen) Schlüssel', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    expect((await getShare(s.id, { key: WRONG_KEY })).status).toBe(200);
    expect((await getShare(s.id, { key: 'kaputt!' })).status).toBe(200);
    expect((await h.fetch(`/api/shares/${s.id}/data`, { headers: withKey(WRONG_KEY) })).status).toBe(200);
  });

  it('[F-93] Fehlversuche mit Schlüssel sind pro IP begrenzt (LINK_LIMITER), Aufrufe ohne Schlüssel nicht', async () => {
    const owner = await loginSupporter(h, email());
    const s = await newShare(owner.cookie, 'unlisted');
    const ip = randomIp();
    const plain: number[] = [];
    for (let i = 0; i < 35; i++) plain.push((await h.fetch(`/api/shares/${UNKNOWN_SHARE}`, { ip })).status);
    expect(new Set(plain)).toEqual(new Set([404]));
    const keyed: number[] = [];
    for (let i = 0; i < 35; i++) keyed.push((await h.fetch(`/api/shares/${s.id}`, { ip, headers: withKey(WRONG_KEY) })).status);
    expect(keyed.slice(0, 30)).toEqual(new Array(30).fill(404));
    expect(keyed).toContain(429);
    // Erfolge kosten nichts – und andere IPs sind nicht betroffen
    expect((await h.fetch(`/api/shares/${s.id}`, { headers: withKey(s.shareKey) })).status).toBe(200);
  });
});

// ---------------------------------------------------------------- F-91 Altbestand

describe('F-91 Altbestand „Nur mit Link“ ohne Schlüssel', () => {
  /** Freigabe wie vor 0006: unlisted, share_key NULL. */
  async function legacyShare(cookie: string): Promise<Share> {
    const s = await newShare(cookie, 'public', 'Alter Törn');
    await (await h.db()).prepare("UPDATE shares SET visibility = 'unlisted', share_key = NULL, listed = 0 WHERE id = ?").bind(s.id).run();
    return s;
  }

  it('[F-91] bleibt über /s/<id> und die API ohne Schlüssel erreichbar; Eigentümer-Link ohne Schlüssel', async () => {
    const { cookie } = await login(h, email());
    const s = await legacyShare(cookie);
    expect((await getShare(s.id)).status).toBe(200);
    expect((await h.fetch(`/api/shares/${s.id}/data`)).status).toBe(200);
    const own = (await getJson<{ share: Share }>(await getShare(s.id, { cookie }))).share;
    expect(own).toMatchObject({ visibility: 'unlisted', shareKey: null, link: `/s/${s.id}` });
    const p = await page(`/s/${s.id}`);
    expect(p.title).toBe('Alter Törn · Sail Explorer');
    expect(p.noindex).toBe(true);
    // nicht gelistet
    expect((await getJson<{ voyages: Array<{ id: string }> }>(await h.fetch('/api/discover?limit=24'))).voyages.map((v) => v.id)).not.toContain(s.id);
  });

  it('[F-91] kostenloses Konto behält den Altbestand: andere Felder und dieselbe Stufe ändern geht, der Schlüssel bleibt NULL', async () => {
    const { cookie } = await login(h, email());
    const s = await legacyShare(cookie);
    const res = await patchShare(s.id, cookie, { title: 'Neu', visibility: 'unlisted' });
    expect(res.status).toBe(200);
    expect((await getJson<{ share: Share }>(res)).share).toMatchObject({ visibility: 'unlisted', shareKey: null });
    expect((await getShare(s.id)).status).toBe(200);
  });

  it('[F-91] „Link erneuern“ gibt dem Altbestand einen Schlüssel – danach ist /s/<id> allein 404', async () => {
    const { cookie } = await login(h, email());
    const s = await legacyShare(cookie);
    const after = (await getJson<{ share: Share }>(await patchShare(s.id, cookie, { rotateKey: true }))).share;
    expect(after.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect((await getShare(s.id)).status).toBe(404);
    expect((await getShare(s.id, { key: after.shareKey })).status).toBe(200);
    expect((await page(`/s/${s.id}`)).title).toBe('Sail Explorer');
  });

  it('[F-91] Wechsel der Sichtbarkeit (über „Nur ich“ zurück) gibt dem Altbestand einen Schlüssel', async () => {
    const { cookie } = await loginSupporter(h, email());
    const s = await legacyShare(cookie);
    await patchShare(s.id, cookie, { visibility: 'private' });
    const back = (await getJson<{ share: Share }>(await patchShare(s.id, cookie, { visibility: 'unlisted' }))).share;
    expect(back.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect((await getShare(s.id)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- Boote und Profile mit Schlüssel

describe('F-90 Boote und Profile „Nur mit Link“', () => {
  it('[F-90] Boot „Nur mit Link“: nur mit X-Share-Key; Admins sehen Schlüssel und Link; listet nur öffentliche Törns', async () => {
    const owner = await loginSupporter(h, email());
    const boat = (await getJson<{ boat: Boat }>(await newBoat(owner.cookie, { visibility: 'unlisted' }))).boat;
    expect(boat.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(boat.link).toBe(`/b/${boat.id}/${boat.shareKey}`);
    const pub = await createShare(h, owner.cookie, { headers: { 'X-Share-Boat': boat.id } }).then((r) => getJson<{ share: Share }>(r));
    const link = await createShare(h, owner.cookie, { visibility: 'unlisted', headers: { 'X-Share-Boat': boat.id } }).then((r) => getJson<{ share: Share }>(r));

    const unknown = await h.fetch('/api/boats/ABCDEFGHJKLMNPQRST');
    const without = await h.fetch(`/api/boats/${boat.id}`);
    const wrong = await h.fetch(`/api/boats/${boat.id}`, { headers: withKey(WRONG_KEY) });
    expect([unknown.status, without.status, wrong.status]).toEqual([404, 404, 404]);
    expect(new Set([await unknown.text(), await without.text(), await wrong.text()]).size).toBe(1);

    const seen = await getJson<{ boat: Boat; voyages: Share[]; stats: { voyages: number } }>(await h.fetch(`/api/boats/${boat.id}`, { headers: withKey(boat.shareKey) }));
    expect(seen.boat).toMatchObject({ role: null, shareKey: null, link: null });
    // der Boots-Schlüssel öffnet keine „Nur mit Link“-Törns des Bootes
    expect(seen.voyages.map((v) => v.id)).toEqual([pub.share.id]);
    expect(seen.stats.voyages).toBe(1);
    expect((await getShare(link.share.id, { key: boat.shareKey })).status).toBe(404);

    const admin = await login(h, email());
    await (await h.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(boat.id, admin.user.id, Date.now()).run();
    const asAdmin = (await getJson<{ boat: Boat }>(await h.fetch(`/api/boats/${boat.id}`, { cookie: admin.cookie }))).boat;
    expect(asAdmin).toMatchObject({ role: 'admin', shareKey: boat.shareKey, link: boat.link });

    // Link erneuern (auch durch den Admin – die Stufe ändert sich nicht)
    const rotated = (await getJson<{ boat: Boat }>(await send('PATCH', `/api/boats/${boat.id}`, admin.cookie, { rotateKey: true }))).boat;
    expect(rotated.shareKey).not.toBe(boat.shareKey);
    expect((await h.fetch(`/api/boats/${boat.id}`, { headers: withKey(boat.shareKey) })).status).toBe(404);
    expect((await h.fetch(`/api/boats/${boat.id}`, { headers: withKey(rotated.shareKey) })).status).toBe(200);
  });

  it('[F-90] Profil „Nur mit Link“: nur mit X-Share-Key; listet nur öffentliche Törns und öffentliche Boote', async () => {
    const s = await loginSupporter(h, email());
    const handle = uniq('link');
    const profile = (await getJson<{ profile: Profile }>(await putProfile(s.cookie, { handle, visibility: 'unlisted' }))).profile;
    expect(profile.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(profile.link).toBe(`/u/${handle}/${profile.shareKey}`);
    await newBoat(s.cookie, { name: 'Offen', visibility: 'public' });
    await newBoat(s.cookie, { name: 'Linkboot', visibility: 'unlisted' });
    const pub = await newShare(s.cookie, 'public');
    await newShare(s.cookie, 'unlisted');

    const a = await h.fetch(`/api/profiles/${handle}`);
    const b = await h.fetch(`/api/profiles/${handle}`, { headers: withKey(WRONG_KEY) });
    const c = await h.fetch(`/api/profiles/${uniq('niemand')}`);
    expect([a.status, b.status, c.status]).toEqual([404, 404, 404]);
    expect(new Set([await a.text(), await b.text(), await c.text()]).size).toBe(1);

    const seen = await getJson<{ profile: Profile; voyages: Share[]; boats: Array<{ name: string }> }>(
      await h.fetch(`/api/profiles/${handle}`, { headers: withKey(profile.shareKey) }),
    );
    expect(seen.profile).toMatchObject({ isSelf: false, shareKey: null, link: null, visibility: 'unlisted' });
    expect(seen.voyages.map((v) => v.id)).toEqual([pub.id]);
    expect(seen.boats.map((x) => x.name)).toEqual(['Offen']);

    // Link erneuern per PUT
    const rotated = (await getJson<{ profile: Profile }>(await putProfile(s.cookie, { handle, rotateKey: true }))).profile;
    expect(rotated.shareKey).not.toBe(profile.shareKey);
    expect(rotated.visibility).toBe('unlisted');
    expect((await h.fetch(`/api/profiles/${handle}`, { headers: withKey(profile.shareKey) })).status).toBe(404);
  });

  it('[F-86] bestehende private Profile werden durch ein PUT ohne Sichtbarkeit nicht öffentlich', async () => {
    const { cookie } = await login(h, email());
    const handle = uniq('alt');
    await putProfile(cookie, { handle });
    await (await h.db()).prepare("UPDATE profiles SET visibility = 'private' WHERE handle = ?").bind(handle).run();
    const res = await putProfile(cookie, { handle, bio: 'geändert' });
    expect(res.status).toBe(200);
    expect((await getJson<{ profile: Profile }>(res)).profile.visibility).toBe('private');
    expect((await h.fetch(`/api/profiles/${handle}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- F-84 / F-85 Seiten

describe('F-84/F-85 Link-Vorschau mit Schlüssel und robots', () => {
  it('[F-85] /s/:id/:key: volle Vorschau nur mit gültigem Schlüssel, immer noindex; /s/:id allein neutral', async () => {
    const { cookie } = await loginSupporter(h, email());
    const s = await newShare(cookie, 'unlisted', 'Geheimtörn');
    const ok = await page(`/s/${s.id}/${s.shareKey}`);
    expect(ok.title).toBe('Geheimtörn · Sail Explorer');
    expect(ok.noindex).toBe(true);
    for (const path of [`/s/${s.id}`, `/s/${s.id}/${WRONG_KEY}`, `/s/${s.id}/kurz`, `/s/${UNKNOWN_SHARE}/${s.shareKey}`]) {
      const p = await page(path);
      expect(p.title, path).toBe('Sail Explorer');
      expect(p.html, path).not.toContain('Geheimtörn');
      expect(p.noindex, path).toBe(true);
    }
    const priv = await newShare(cookie, 'private', 'Privattörn');
    expect((await page(`/s/${priv.id}/${s.shareKey}`)).title).toBe('Sail Explorer');
  });

  it('[F-85] /b/:id/:key und /u/:handle/:key: Vorschau nur mit gültigem Schlüssel, noindex', async () => {
    const { cookie } = await loginSupporter(h, email());
    const boat = (await getJson<{ boat: Boat }>(await newBoat(cookie, { name: 'Linkboot', visibility: 'unlisted' }))).boat;
    expect((await page(`/b/${boat.id}/${boat.shareKey}`)).title).toBe('Linkboot · Sail Explorer');
    expect((await page(`/b/${boat.id}/${boat.shareKey}`)).noindex).toBe(true);
    expect((await page(`/b/${boat.id}`)).title).toBe('Sail Explorer');
    expect((await page(`/b/${boat.id}/${WRONG_KEY}`)).title).toBe('Sail Explorer');

    const handle = uniq('vorschau');
    const profile = (await getJson<{ profile: Profile }>(await putProfile(cookie, { handle, displayName: 'Linkperson', visibility: 'unlisted' }))).profile;
    const ok = await page(`/u/${handle}/${profile.shareKey}`);
    expect(ok.title).toBe('Linkperson · Sail Explorer');
    expect(ok.noindex).toBe(true);
    expect((await page(`/u/${handle}`)).title).toBe('Sail Explorer');
    expect((await page(`/u/${handle}/${WRONG_KEY}`)).html).not.toContain('Linkperson');
  });

  it('[F-84] öffentliche Törns, Boote, Profile und /entdecken: index; mit Schlüssel im Pfad: noindex', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie, 'public', 'Offener Törn');
    const boat = (await getJson<{ boat: Boat }>(await newBoat(cookie, { name: 'Offenes Boot' }))).boat;
    const handle = uniq('offen');
    await putProfile(cookie, { handle });
    for (const path of [`/s/${s.id}`, `/b/${boat.id}`, `/u/${handle}`, '/entdecken']) expect((await page(path)).noindex, path).toBe(false);
    for (const path of [`/s/${s.id}/${WRONG_KEY}`, `/b/${boat.id}/${WRONG_KEY}`, `/u/${handle}/${WRONG_KEY}`]) {
      const p = await page(path);
      expect(p.noindex, path).toBe(true);
      expect(p.title, path).not.toBe('Sail Explorer'); // öffentlich: Vorschau trotzdem
    }
  });

  it('[F-84] alle /api/*-Antworten tragen X-Robots-Tag: noindex (JSON, Daten, Bild, 204, Fehler)', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    const responses = [
      await h.fetch('/api/config'),
      await h.fetch('/api/discover'),
      await getShare(s.id),
      await h.fetch(`/api/shares/${s.id}/data`),
      await h.fetch('/api/nope'),
      await getShare(UNKNOWN_SHARE),
      await h.fetch('/api/shares'),
      await send('DELETE', `/api/shares/${s.id}`, cookie),
    ];
    for (const r of responses) expect(r.headers.get('X-Robots-Tag'), r.url).toBe('noindex');
    expect(responses.at(-1)!.status).toBe(204);
    expect((await h.fetch(`/s/${UNKNOWN_SHARE}`)).headers.get('X-Robots-Tag')).toBeNull();
  });
});
