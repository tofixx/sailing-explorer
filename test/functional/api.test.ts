// Funktionale Tests der Worker-API (F-31 … F-39): echter Worker-Code in workerd (Miniflare)
// mit echten lokalen D1-/R2-Bindings, Anfragen laufen durch den fetch-Handler.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  SAMPLE_GPX,
  bodyText,
  createShare,
  grantSupport,
  gzip,
  login,
  loginSupporter,
  payloadJson,
  startWorker,
  type Harness,
} from './worker-harness';

let h: Harness;
let mailCounter = 0;
const freshEmail = (tag = 'u') => `${tag}${++mailCounter}-${Date.now()}@example.org`;

const jsonPost = (body: unknown, extra: Record<string, unknown> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  ...extra,
});

async function requestToken(email: string, ip?: string): Promise<string> {
  const res = await h.fetch('/api/auth/request', jsonPost({ email }, { ip }));
  expect(res.status).toBe(200);
  const { devLink } = (await res.json()) as { devLink: string };
  return /#token=([A-Za-z0-9_-]+)/.exec(devLink)![1];
}

const verify = (token: string, ip?: string) => h.fetch('/api/auth/verify', jsonPost({ token }, { ip }));

async function newShare(cookie: string, opts: Parameters<typeof createShare>[2] = {}) {
  const res = await createShare(h, cookie, opts);
  expect(res.status).toBe(201);
  return ((await res.json()) as {
    share: { id: string; title: string; visibility: string; view: string; summary: string; isOwner: boolean; trackCount: number; shareKey: string | null; link: string | null };
  }).share;
}

beforeAll(async () => {
  h = await startWorker();
}, 60_000);

afterAll(async () => {
  await h?.dispose();
});

// ---------------------------------------------------------------- Anmeldung

describe('F-32 Anmeldung per Magic Link', () => {
  it('[F-32] Link anfordern → Token einlösen meldet an (Session-Cookie, /api/auth/me kennt den Nutzer)', async () => {
    const email = freshEmail();
    const token = await requestToken(email);
    const res = await verify(token);
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string; email: string } };
    expect(user.email).toBe(email);
    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const me = await h.fetch('/api/auth/me', { cookie: setCookie.split(';')[0] });
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);
  });

  it('[F-32] der Link zeigt auf /login#token=… (App löst per POST ein, GET-Scanner verbrauchen ihn nicht)', async () => {
    const res = await h.fetch('/api/auth/request', jsonPost({ email: freshEmail() }));
    const { devLink } = (await res.json()) as { devLink: string };
    expect(devLink).toMatch(new RegExp(`^${ORIGIN}/login#token=[A-Za-z0-9_-]{40,64}$`));
  });

  it('[F-32] Vorabprüfung (peek) nennt die Adresse, ohne den Link zu verbrauchen', async () => {
    const email = freshEmail();
    const token = await requestToken(email);
    const peek = await h.fetch('/api/auth/peek', jsonPost({ token }));
    expect(peek.status).toBe(200);
    expect(await peek.json()).toEqual({ email });
    expect(peek.headers.get('Set-Cookie')).toBeNull();
    expect((await verify(token)).status).toBe(200);
    // danach ist der Link verbraucht – auch für peek
    expect((await h.fetch('/api/auth/peek', jsonPost({ token }))).status).toBe(400);
  });

  it('[F-32] Token ist nur einmal gültig', async () => {
    const token = await requestToken(freshEmail());
    expect((await verify(token)).status).toBe(200);
    const again = await verify(token);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe('invalid_token');
  });

  it('[F-32] Token läuft nach 15 Minuten ab', async () => {
    const email = freshEmail();
    const token = await requestToken(email);
    const db = await h.db();
    const row = await db.prepare('SELECT created_at, expires_at FROM login_tokens WHERE email = ?').bind(email).first<{ created_at: number; expires_at: number }>();
    expect(row!.expires_at - row!.created_at).toBe(15 * 60_000);
    await db.prepare('UPDATE login_tokens SET expires_at = ? WHERE email = ?').bind(Date.now() - 1, email).run();
    expect((await verify(token)).status).toBe(400);
  });

  it('[F-32] unbekannte/kaputte Tokens werden abgelehnt', async () => {
    expect((await verify('x'.repeat(43))).status).toBe(400);
    expect((await verify('../../etc')).status).toBe(400);
  });

  it('[F-32] Antwort verrät nicht, ob ein Konto existiert', async () => {
    const existing = freshEmail('known');
    await login(h, existing);
    const a = await h.fetch('/api/auth/request', jsonPost({ email: existing }));
    const b = await h.fetch('/api/auth/request', jsonPost({ email: freshEmail('unknown') }));
    expect(a.status).toBe(b.status);
    const ja = (await a.json()) as Record<string, unknown>;
    const jb = (await b.json()) as Record<string, unknown>;
    expect(Object.keys(ja).sort()).toEqual(Object.keys(jb).sort());
    expect(ja.ok).toBe(true);
    expect(jb.ok).toBe(true);
  });

  it('[F-32] ungültige E-Mail-Adressen werden mit 400 abgelehnt', async () => {
    const res = await h.fetch('/api/auth/request', jsonPost({ email: 'kein-at' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_email');
  });

  it('[F-32] Begrenzung pro Adresse: max. 3 Links in 15 Minuten', async () => {
    const email = freshEmail('limit');
    for (let i = 0; i < 3; i++) expect((await h.fetch('/api/auth/request', jsonPost({ email }))).status).toBe(200);
    const res = await h.fetch('/api/auth/request', jsonPost({ email: email.toUpperCase() }));
    expect(res.status).toBe(429);
  });

  it('[F-32] Begrenzung pro IP (AUTH_LIMITER)', async () => {
    const ip = '10.99.99.99';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await h.fetch('/api/auth/request', jsonPost({ email: freshEmail('ip') }, { ip }))).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses).toContain(429);
    // andere IP ist nicht betroffen
    expect((await h.fetch('/api/auth/request', jsonPost({ email: freshEmail('ip') }))).status).toBe(200);
  });

  it('[F-32] erneute Anmeldung derselben Adresse landet im selben Konto', async () => {
    const email = freshEmail();
    const a = await login(h, email);
    const b = await login(h, email.toUpperCase());
    expect(b.user.id).toBe(a.user.id);
  });
});

// ---------------------------------------------------------------- CSRF / Grundschutz

describe('Same-Origin-Schutz für Mutationen (F-31 … F-38)', () => {
  it('[F-31] POST ohne Origin wird mit 403 abgelehnt (CSRF)', async () => {
    const { cookie } = await login(h, freshEmail());
    const body = await gzip(payloadJson());
    const res = await h.fetch('/api/shares', { method: 'POST', cookie, origin: null, headers: { 'Content-Type': 'application/gzip' }, body });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden_origin');
  });

  it('[F-38] fremde Origin darf nicht löschen/ändern (403)', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie);
    const del = await h.fetch(`/api/shares/${share.id}`, { method: 'DELETE', cookie, origin: 'https://evil.example' });
    expect(del.status).toBe(403);
    const acc = await h.fetch('/api/account', { method: 'DELETE', cookie, origin: 'https://evil.example' });
    expect(acc.status).toBe(403);
    expect((await h.fetch(`/api/shares/${share.id}`)).status).toBe(200);
  });

  it('[F-31] Sec-Fetch-Site: same-origin ohne Origin-Header wird akzeptiert', async () => {
    const res = await h.fetch('/api/auth/request', { ...jsonPost({ email: freshEmail() }), origin: null, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' } });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------- Teilen

describe('F-31 Teilen setzt Anmeldung voraus', () => {
  it('[F-31] ohne Anmeldung → 401, nichts wird gespeichert', async () => {
    const before = await (await h.r2()).list({ prefix: 'shares/' });
    const res = await createShare(h, undefined);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('unauthenticated');
    const after = await (await h.r2()).list({ prefix: 'shares/' });
    expect(after.objects.length).toBe(before.objects.length);
  });

  it('[F-31] Freigabe wird in D1 (Metadaten) und R2 (Daten) persistiert', async () => {
    const { cookie, user } = await login(h, freshEmail());
    const share = await newShare(cookie);
    const row = await (await h.db()).prepare('SELECT user_id FROM shares WHERE id = ?').bind(share.id).first<{ user_id: string }>();
    expect(row!.user_id).toBe(user.id);
    expect(await (await h.r2()).head(`shares/${share.id}`)).not.toBeNull();
  });
});

describe('F-33 Freigabe anlegen', () => {
  it('[F-33] erzeugt eine öffentliche Freigabe mit Titel und Ansicht und liefert die ID und den Link /s/<id>', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie, { title: 'Stralsund → Prerow', view: 'm=wind&l=s,w', visibility: 'public', summary: '28,4 sm · 13.06.2026' });
    expect(share.id).toMatch(/^[A-Za-z0-9]{12,32}$/);
    expect(share).toMatchObject({ title: 'Stralsund → Prerow', visibility: 'public', view: 'm=wind&l=s,w', summary: '28,4 sm · 13.06.2026', isOwner: true, trackCount: 1 });
    expect(share).toMatchObject({ shareKey: null, link: `/s/${share.id}` });
    expect(share).not.toHaveProperty('listed');
    const page = await h.fetch(`/s/${share.id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toMatch(/text\/html/);
  });

  it('[F-33] Sichtbarkeit „Nur ich“ (private) wird übernommen (Unterstützer)', async () => {
    const { cookie } = await loginSupporter(h, freshEmail());
    expect((await newShare(cookie, { visibility: 'private' })).visibility).toBe('private');
  });

  it('[F-33] ohne Ansicht/Titel/Sichtbarkeit: leere Ansicht, Standardtitel, öffentlich; unbekannte Sichtbarkeit → 400', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie, { title: '', view: '', visibility: '' });
    expect(share.title).toBe('Törn');
    expect(share.view).toBe('');
    expect(share.visibility).toBe('public');
    const bad = await createShare(h, cookie, { visibility: 'listed' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_visibility');
  });

  it('[F-33] Titel wird bereinigt, ungültige Ansicht verworfen', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie, { title: 'Törn‮evil\u0000 ' + 'x'.repeat(300), view: 'm=<script>' });
    expect(share.title).not.toMatch(/[\u0000‮]/);
    expect(share.title.length).toBeLessThanOrEqual(120);
    expect(share.view).toBe('');
  });

  it('[F-33] ungültiger Payload (kein gzip) wird mit 400 abgelehnt', async () => {
    const { cookie } = await login(h, freshEmail());
    const res = await createShare(h, cookie, { body: new TextEncoder().encode(payloadJson() + ' '.repeat(40)) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_payload');
  });

  it('[F-33] gzip mit falschem Format (nicht {"v":1,…}) wird abgelehnt', async () => {
    const { cookie } = await login(h, freshEmail());
    for (const text of ['{"v":2,"tracks":[]}', '<html>' + 'x'.repeat(100), '[1,2,3]']) {
      const res = await createShare(h, cookie, { body: await gzip(text) });
      expect(res.status).toBe(400);
    }
  });

  it('[F-33] kaputtes gzip (korrekte Magic Bytes, Datenmüll) wird abgelehnt', async () => {
    const { cookie } = await login(h, freshEmail());
    const junk = new Uint8Array(64).map((_, i) => (i < 3 ? [0x1f, 0x8b, 0x08][i] : (i * 37) & 0xff));
    const res = await createShare(h, cookie, { body: junk });
    expect(res.status).toBe(400);
  });

  it('[F-33] zu große Uploads werden abgelehnt (413)', async () => {
    const { cookie } = await login(h, freshEmail());
    // Als Stream (chunked, ohne Content-Length), damit der Worker den Body liest und die echte Größe prüft;
    // mit Content-Length > Limit bricht er sofort ab (dann setzt die Verbindung beim Senden zurück).
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 13) c.enqueue(chunk);
        else c.close();
      },
    });
    const res = await h.fetch('/api/shares', {
      method: 'POST',
      cookie,
      headers: { 'Content-Type': 'application/gzip' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('too_large');
  });
});

describe('F-34 Geteilte Links öffnen ohne Anmeldung', () => {
  it('[F-34] Metadaten und Daten einer „Alle mit dem Link“-Freigabe sind anonym abrufbar (Roundtrip)', async () => {
    const { cookie } = await login(h, freshEmail());
    const tracks = [
      { name: 'Etappe 1', gpx: SAMPLE_GPX },
      { name: 'Etappe 2 <b>', gpx: SAMPLE_GPX.replace('Mini', 'Zwei') },
    ];
    const share = await newShare(cookie, { tracks, view: 'm=gust&l=d' });

    const meta = await h.fetch(`/api/shares/${share.id}`);
    expect(meta.status).toBe(200);
    const m = ((await meta.json()) as { share: { title: string; view: string; isOwner: boolean; trackCount: number } }).share;
    expect(m).toMatchObject({ view: 'm=gust&l=d', isOwner: false, trackCount: 2 });

    const data = await h.fetch(`/api/shares/${share.id}/data`);
    expect(data.status).toBe(200);
    expect(data.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(data.headers.get('ETag')).toBeTruthy();
    expect(JSON.parse(await bodyText(data))).toEqual({ v: 1, tracks });
  });

  it('[F-34] Daten werden per ETag revalidiert (304 ohne Body), aber nur solange sichtbar', async () => {
    const { cookie } = await loginSupporter(h, freshEmail());
    const share = await newShare(cookie);
    const first = await h.fetch(`/api/shares/${share.id}/data`);
    const etag = first.headers.get('ETag')!;
    await first.arrayBuffer();
    const again = await h.fetch(`/api/shares/${share.id}/data`, { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    await h.fetch(`/api/shares/${share.id}`, { method: 'PATCH', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'private' }) });
    expect((await h.fetch(`/api/shares/${share.id}/data`, { headers: { 'If-None-Match': etag } })).status).toBe(404);
  });

  it('[F-34] Besitzer erhält isOwner=true', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie);
    const meta = await h.fetch(`/api/shares/${share.id}`, { cookie });
    expect(((await meta.json()) as { share: { isOwner: boolean } }).share.isOwner).toBe(true);
  });

  it('[F-34] „Nur ich“-Freigabe ist für den Besitzer abrufbar', async () => {
    const { cookie } = await loginSupporter(h, freshEmail());
    const share = await newShare(cookie, { visibility: 'private' });
    expect((await h.fetch(`/api/shares/${share.id}`, { cookie })).status).toBe(200);
    const data = await h.fetch(`/api/shares/${share.id}/data`, { cookie });
    expect(data.status).toBe(200);
    expect(JSON.parse(await bodyText(data)).v).toBe(1);
  });
});

describe('F-35 Private Freigaben', () => {
  it('[F-35] privat ist für Anonyme und andere Nutzer nicht von unbekannt unterscheidbar (404, gleicher Body)', async () => {
    const owner = await loginSupporter(h, freshEmail());
    const other = await login(h, freshEmail());
    const share = await newShare(owner.cookie, { visibility: 'private' });
    const unknown = 'ABCDEFGHJKLMNPQRST';

    const bodies: string[] = [];
    for (const [path, cookie] of [
      [`/api/shares/${share.id}`, undefined],
      [`/api/shares/${share.id}`, other.cookie],
      [`/api/shares/${unknown}`, undefined],
      [`/api/shares/${share.id}/data`, undefined],
      [`/api/shares/${share.id}/data`, other.cookie],
      [`/api/shares/${unknown}/data`, other.cookie],
    ] as const) {
      const res = await h.fetch(path, { cookie });
      expect(res.status, path).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('[F-35] gelöschte Freigabe → 404 wie unbekannt', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie);
    expect((await h.fetch(`/api/shares/${share.id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await h.fetch(`/api/shares/${share.id}`)).status).toBe(404);
    expect((await h.fetch(`/api/shares/${share.id}/data`)).status).toBe(404);
  });

  it('[F-35] von „Öffentlich“ auf „Nur ich“ umgestellt → sofort 404 für andere', async () => {
    const { cookie } = await loginSupporter(h, freshEmail());
    const share = await newShare(cookie);
    expect((await h.fetch(`/api/shares/${share.id}/data`)).status).toBe(200);
    await h.fetch(`/api/shares/${share.id}`, { method: 'PATCH', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'private' }) });
    expect((await h.fetch(`/api/shares/${share.id}/data`)).status).toBe(404);
  });
});

describe('F-36 Meine Tracks', () => {
  const patch = (id: string, cookie: string, body: unknown) =>
    h.fetch(`/api/shares/${id}`, { method: 'PATCH', cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('[F-36] listet nur eigene Freigaben, neueste zuerst', async () => {
    const a = await loginSupporter(h, freshEmail());
    const b = await login(h, freshEmail());
    const s1 = await newShare(a.cookie, { title: 'Erste' });
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await newShare(a.cookie, { title: 'Zweite', visibility: 'private' });
    await newShare(b.cookie, { title: 'Fremd' });
    const res = await h.fetch('/api/shares', { cookie: a.cookie });
    expect(res.status).toBe(200);
    const { shares } = (await res.json()) as { shares: Array<{ id: string; title: string; isOwner: boolean }> };
    expect(shares.map((s) => s.id)).toEqual([s2.id, s1.id]);
    expect(shares.every((s) => s.isOwner)).toBe(true);
  });

  it('[F-36] Liste ohne Anmeldung → 401', async () => {
    expect((await h.fetch('/api/shares')).status).toBe(401);
  });

  it('[F-36] umbenennen und Sichtbarkeit ändern', async () => {
    const { cookie } = await loginSupporter(h, freshEmail());
    const share = await newShare(cookie, { title: 'Alt' });
    const res = await patch(share.id, cookie, { title: '  Neu  ', visibility: 'private' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { share: { title: string; visibility: string } }).share).toMatchObject({ title: 'Neu', visibility: 'private' });
    const meta = await h.fetch(`/api/shares/${share.id}`, { cookie });
    expect(((await meta.json()) as { share: { title: string; visibility: string } }).share).toMatchObject({ title: 'Neu', visibility: 'private' });
  });

  it('[F-36] leerer Titel und unbekannte Sichtbarkeit werden abgelehnt', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie);
    expect((await patch(share.id, cookie, { title: '   ' })).status).toBe(400);
    expect((await patch(share.id, cookie, { visibility: 'listed' })).status).toBe(400);
    expect((await patch(share.id, cookie, { visibility: null })).status).toBe(400);
  });

  it('[F-36] löschen entfernt Metadaten und Datei', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie);
    const res = await h.fetch(`/api/shares/${share.id}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(204);
    expect(await (await h.r2()).head(`shares/${share.id}`)).toBeNull();
    const { shares } = (await (await h.fetch('/api/shares', { cookie })).json()) as { shares: unknown[] };
    expect(shares).toHaveLength(0);
  });
});

describe('F-37 Konto', () => {
  it('[F-37] Abmelden beendet die Session serverseitig', async () => {
    const { cookie } = await login(h, freshEmail());
    const out = await h.fetch('/api/auth/logout', { method: 'POST', cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
    const me = await h.fetch('/api/auth/me', { cookie });
    expect(((await me.json()) as { user: unknown }).user).toBeNull();
    expect((await createShare(h, cookie)).status).toBe(401);
  });

  it('[F-37] Konto löschen entfernt Nutzer, alle Sessions, Freigaben und Dateien', async () => {
    const email = freshEmail();
    const first = await login(h, email);
    const second = await login(h, email); // zweites Gerät
    await grantSupport(h, first.user.id);
    const s1 = await newShare(first.cookie);
    const s2 = await newShare(first.cookie, { visibility: 'private' });
    const other = await login(h, freshEmail());
    const foreign = await newShare(other.cookie);

    const res = await h.fetch('/api/account', { method: 'DELETE', cookie: first.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);

    const db = await h.db();
    const uid = first.user.id;
    expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first()).toBeNull();
    expect((await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(uid).first<{ n: number }>())!.n).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').bind(uid).first<{ n: number }>())!.n).toBe(0);
    const r2 = await h.r2();
    expect(await r2.head(`shares/${s1.id}`)).toBeNull();
    expect(await r2.head(`shares/${s2.id}`)).toBeNull();
    expect((await h.fetch(`/api/shares/${s1.id}`)).status).toBe(404);

    // auch die Session des zweiten Geräts ist ungültig
    const me = await h.fetch('/api/auth/me', { cookie: second.cookie });
    expect(((await me.json()) as { user: unknown }).user).toBeNull();
    // fremde Daten bleiben
    expect(await r2.head(`shares/${foreign.id}`)).not.toBeNull();
  });

  it('[F-37] Konto löschen ohne Anmeldung → 401', async () => {
    expect((await h.fetch('/api/account', { method: 'DELETE' })).status).toBe(401);
  });
});

describe('F-38 Fremde Freigaben', () => {
  it('[F-38] andere Nutzer können fremde Freigaben weder ändern noch löschen (404, unverändert)', async () => {
    const owner = await login(h, freshEmail());
    const other = await login(h, freshEmail());
    const share = await newShare(owner.cookie, { title: 'Original' });

    const p = await h.fetch(`/api/shares/${share.id}`, { method: 'PATCH', cookie: other.cookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Gekapert', visibility: 'private' }) });
    expect(p.status).toBe(404);
    const d = await h.fetch(`/api/shares/${share.id}`, { method: 'DELETE', cookie: other.cookie });
    expect(d.status).toBe(404);

    const meta = await h.fetch(`/api/shares/${share.id}`);
    expect(((await meta.json()) as { share: { title: string; visibility: string } }).share).toMatchObject({ title: 'Original', visibility: 'public' });
    expect(await (await h.r2()).head(`shares/${share.id}`)).not.toBeNull();
  });

  it('[F-38] anonym ändern/löschen → 401', async () => {
    const owner = await login(h, freshEmail());
    const share = await newShare(owner.cookie);
    expect((await h.fetch(`/api/shares/${share.id}`, { method: 'DELETE' })).status).toBe(401);
    expect((await h.fetch(`/api/shares/${share.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"title":"x"}' })).status).toBe(401);
  });
});

describe('F-39 Link-Vorschau /s/:id', () => {
  const head = async (res: Response) => {
    const html = await res.text();
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    const ogTitle = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
    const ogDesc = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1];
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
    return { html, title, ogTitle, ogDesc, desc };
  };

  it('[F-39] öffentliche Freigabe: Titel und Kurzinfo in title/og:title/og:description, indexierbar (E2, F-84)', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie, { title: 'Prerow → Rostock', summary: '31,2 sm · 14.06.2026' });
    const res = await h.fetch(`/s/${share.id}`);
    expect(res.status).toBe(200);
    const m = await head(res);
    expect(m.title).toBe('Prerow → Rostock · Sail Explorer');
    expect(m.ogTitle).toBe('Prerow → Rostock · Sail Explorer');
    expect(m.ogDesc).toBe('31,2 sm · 14.06.2026');
    expect(m.desc).toBe('31,2 sm · 14.06.2026');
    expect(m.html).not.toContain('noindex');
    expect(res.headers.get('Content-Security-Policy')).toMatch(/script-src 'self'/);
  });

  it('[F-39] private Freigabe bleibt neutral (kein Titel, keine Kurzinfo)', async () => {
    const { cookie } = await loginSupporter(h, freshEmail());
    const share = await newShare(cookie, { title: 'Geheimer Törn', summary: 'Geheim 12 sm', visibility: 'private' });
    const res = await h.fetch(`/s/${share.id}`, { cookie }); // auch für den Besitzer (Crawler hätten kein Cookie)
    const m = await head(res);
    expect(m.html).not.toContain('Geheim');
    expect(m.title).toBe('Sail Explorer');
    expect(m.ogTitle).toBe('Sail Explorer');
  });

  it('[F-39] unbekannte Freigabe sieht aus wie eine private', async () => {
    const { cookie } = await loginSupporter(h, freshEmail());
    const priv = await newShare(cookie, { title: 'P', summary: 'S', visibility: 'private' });
    const a = await head(await h.fetch(`/s/${priv.id}`));
    const b = await head(await h.fetch('/s/ABCDEFGHJKLMNPQRST'));
    expect({ t: a.title, o: a.ogTitle, d: a.ogDesc }).toEqual({ t: b.title, o: b.ogTitle, d: b.ogDesc });
  });

  it('[F-39] Titel mit HTML-Sonderzeichen wird nicht als Markup eingefügt', async () => {
    const { cookie } = await login(h, freshEmail());
    const share = await newShare(cookie, { title: '<script>alert(1)</script>', summary: '"><img src=x>' });
    const m = await head(await h.fetch(`/s/${share.id}`));
    // im Elementtext escaped, in Attributen kann der Wert nicht aus den Anführungszeichen ausbrechen
    expect(m.title).toBe('&lt;script&gt;alert(1)&lt;/script&gt; · Sail Explorer');
    expect(m.ogDesc).toBe('&quot;><img src=x>');
    expect(m.desc).toBe('&quot;><img src=x>');
    expect(m.html.match(/<script/g) ?? []).toHaveLength(1); // nur innerhalb des og:title-Attributs
    expect(m.ogTitle).toBe('<script>alert(1)</script> · Sail Explorer');
  });
});

describe('API allgemein', () => {
  it('[F-40] /api/config meldet Teilen als verfügbar (Client erkennt Backend)', async () => {
    const res = await h.fetch('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sharing: true, turnstileSiteKey: expect.any(String) });
  });

  it('[F-35] unbekannte API-Pfade → 404 JSON, falsche Methode → 405', async () => {
    const a = await h.fetch('/api/nope');
    expect(a.status).toBe(404);
    expect(a.headers.get('Content-Type')).toMatch(/application\/json/);
    expect((await h.fetch('/api/config', { method: 'POST' })).status).toBe(405);
  });
});
