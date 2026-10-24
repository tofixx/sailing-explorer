// Funktionale Tests: Entdecken – nur öffentliche Inhalte, Grenzen, Sortierung, Link-Vorschau (F-70 … F-74)
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, loginSupporter, startWorker, type Harness, type ShareOpts } from './worker-harness';

let h: Harness;
let n = 0;
const email = (tag = 'd') => `${tag}${++n}-${Date.now()}@example.org`;
const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string | undefined, body?: unknown) =>
  h.fetch(path, { method, cookie, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });

/**
 * Nutzer mit Profil (öffentlich, nur mit Link oder privat) – oder ganz ohne Profil. Als Unterstützer, damit alle drei
 * Stufen wählbar sind (E1 prüfen supporter.test.ts und visibility.test.ts).
 */
async function sailor(visibility: 'public' | 'unlisted' | 'private' | 'none' = 'public', displayName = 'Käpt’n Test') {
  const mail = email();
  const s = await loginSupporter(h, mail);
  const handle = uniq('crew');
  if (visibility !== 'none') {
    const res = await send('PUT', '/api/me/profile', s.cookie, { handle, displayName, bio: 'Ostsee', visibility });
    expect(res.status).toBe(200);
  }
  return { ...s, email: mail, handle };
}

async function newBoat(cookie: string, input: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const res = await send('POST', '/api/boats', cookie, { name: 'Seeschwalbe', visibility: 'public', ...input });
  expect(res.status).toBe(201);
  return ((await res.json()) as { boat: { id: string; name: string } }).boat;
}

/** listed: true = „Öffentlich“, false = „Nur mit Link“ (sofern keine Sichtbarkeit angegeben ist). */
async function newShare(cookie: string, o: ShareOpts & { listed?: boolean; boatId?: string; distNm?: number; startedAt?: number } = {}): Promise<{ id: string }> {
  const headers: Record<string, string> = { 'X-Share-Distance': String(o.distNm ?? 10) };
  o = { ...o, visibility: o.visibility ?? (o.listed === false ? 'unlisted' : 'public') };
  if (o.boatId) headers['X-Share-Boat'] = o.boatId;
  if (o.startedAt) headers['X-Share-Started'] = String(o.startedAt);
  const res = await createShare(h, cookie, { ...o, headers });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string } }).share;
}

interface Voyage { id: string; title: string; distNm: number; startedAt: number | null; createdAt: number; hasImage: boolean; boat: { id: string; name: string } | null; sailor: { handle: string; displayName: string } | null }
interface Boat { id: string; name: string; owner: { handle: string }; stats: { voyages: number; distNm: number } }
interface Person { handle: string; displayName: string; stats: { voyages: number; distNm: number; boats: number } }
interface Discover { voyages: Voyage[]; boats: Boat[]; people: Person[] }

async function discover(query = '?limit=24'): Promise<Discover> {
  const res = await h.fetch(`/api/discover${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Discover;
}

const voyageIds = (d: Discover) => d.voyages.map((v) => v.id);

// ---------------------------------------------------------------- F-71 Törns

describe('F-71 Entdecken: nur öffentliche Törns', () => {
  it('[F-71] öffentlich gelistete Törns eines öffentlichen Profils erscheinen mit Titel, Distanz, Datum und Segler', async () => {
    const s = await sailor('public', 'Anna Ostsee');
    const started = Date.UTC(2026, 5, 13, 8);
    const v = await newShare(s.cookie, { title: 'Stralsund → Prerow', listed: true, distNm: 23.4, startedAt: started });
    const got = (await discover()).voyages.find((x) => x.id === v.id);
    expect(got).toMatchObject({ title: 'Stralsund → Prerow', distNm: 23.4, startedAt: started, hasImage: false, boat: null, sailor: { handle: s.handle, displayName: 'Anna Ostsee' } });
  });

  it('[F-71] „Mit Link“, „Nur ich“ und nicht gelistete Törns erscheinen nie', async () => {
    const s = await sailor('public');
    const link = await newShare(s.cookie, { title: 'Nur mit Link', listed: false });
    const priv = await newShare(s.cookie, { title: 'Nur ich', visibility: 'private', listed: false });
    // gelistet, aber privat: darf trotzdem nicht erscheinen
    const privListed = await newShare(s.cookie, { title: 'Privat gelistet', visibility: 'private', listed: true });
    const ids = voyageIds(await discover());
    expect(ids).not.toContain(link.id);
    expect(ids).not.toContain(priv.id);
    expect(ids).not.toContain(privListed.id);
  });

  it('[F-82] öffentliche Törns erscheinen unabhängig vom Profil; ohne öffentliches Profil ohne Autor (sailor: null)', async () => {
    const priv = await sailor('private', 'Geheimname');
    const link = await sailor('unlisted', 'Linkname');
    const none = await sailor('none');
    const a = await newShare(priv.cookie, { listed: true });
    const b = await newShare(none.cookie, { listed: true });
    const c = await newShare(link.cookie, { listed: true });
    const res = await h.fetch('/api/discover?limit=24');
    const raw = await res.text();
    const d = JSON.parse(raw) as Discover;
    for (const v of [a, b, c]) expect(d.voyages.find((x) => x.id === v.id)?.sailor).toBeNull();
    expect(d.people.map((p) => p.handle)).not.toContain(priv.handle);
    expect(d.people.map((p) => p.handle)).not.toContain(link.handle);
    // weder Name noch Handle eines nicht öffentlichen Profils verraten
    for (const t of ['Geheimname', 'Linkname', priv.handle, link.handle]) expect(raw).not.toContain(t);
  });

  it('[F-71] Sichtbarkeit wirkt sofort: privat gestellter Törn verschwindet, privat gestelltes Profil verliert den Autor', async () => {
    const s = await sailor('public');
    const v = await newShare(s.cookie, { listed: true });
    const w = await newShare(s.cookie, { listed: true });
    expect(voyageIds(await discover())).toEqual(expect.arrayContaining([v.id, w.id]));
    expect((await send('PATCH', `/api/shares/${v.id}`, s.cookie, { visibility: 'private' })).status).toBe(200);
    expect(voyageIds(await discover())).not.toContain(v.id);
    await send('PUT', '/api/me/profile', s.cookie, { handle: s.handle, displayName: 'Käpt’n Test', bio: '', visibility: 'private' });
    const d = await discover();
    expect(d.voyages.find((x) => x.id === w.id)?.sailor).toBeNull();
    expect(d.people.map((p) => p.handle)).not.toContain(s.handle);
  });

  it('[F-71] privates oder „Nur mit Link“-Boot: kein Boot-Name am Törn; öffentliches Boot wird verlinkt', async () => {
    const s = await sailor('public');
    const secret = await newBoat(s.cookie, { name: 'Geheimboot', visibility: 'private' });
    const linkBoat = await newBoat(s.cookie, { name: 'Linkboot', visibility: 'unlisted' });
    const open = await newBoat(s.cookie, { name: 'Seeschwalbe', visibility: 'public' });
    const a = await newShare(s.cookie, { listed: true, boatId: secret.id });
    const b = await newShare(s.cookie, { listed: true, boatId: open.id });
    const c = await newShare(s.cookie, { listed: true, boatId: linkBoat.id });
    const res = await h.fetch('/api/discover?limit=24');
    const raw = await res.text();
    const d = JSON.parse(raw) as Discover;
    expect(d.voyages.find((v) => v.id === a.id)?.boat).toBeNull();
    expect(d.voyages.find((v) => v.id === b.id)?.boat).toEqual({ id: open.id, name: 'Seeschwalbe' });
    expect(d.voyages.find((v) => v.id === c.id)?.boat).toBeNull();
    expect(raw).not.toContain('Geheimboot');
    expect(raw).not.toContain(secret.id);
    expect(raw).not.toContain('Linkboot');
    expect(raw).not.toContain(linkBoat.id);
  });

  it('[F-71] Übersichtsbild wird nur als hasImage gemeldet', async () => {
    const s = await sailor('public');
    const v = await newShare(s.cookie, { listed: true });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
    const put = await h.fetch(`/api/shares/${v.id}/image`, { method: 'PUT', cookie: s.cookie, headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
    expect(put.status).toBe(204);
    expect((await discover()).voyages.find((x) => x.id === v.id)?.hasImage).toBe(true);
  });
});

// ---------------------------------------------------------------- F-72 Boote und Segler

describe('F-72 Entdecken: Boote und Segler', () => {
  it('[F-72] nur öffentliche Boote mit öffentlichem Eigner-Profil, mit Kennzahlen', async () => {
    const pub = await sailor('public');
    const priv = await sailor('private');
    const shown = await newBoat(pub.cookie, { name: 'Möwe', visibility: 'public' });
    const hiddenBoat = await newBoat(pub.cookie, { name: 'Versteck', visibility: 'private' });
    const linkBoat = await newBoat(pub.cookie, { name: 'Nur Link', visibility: 'unlisted' });
    const ownerPrivate = await newBoat(priv.cookie, { name: 'Anonym', visibility: 'public' });
    await newShare(pub.cookie, { listed: true, boatId: shown.id, distNm: 12 });
    await newShare(pub.cookie, { listed: false, boatId: shown.id, distNm: 99 });
    const d = await discover();
    const ids = d.boats.map((b) => b.id);
    expect(ids).toContain(shown.id);
    expect(ids).not.toContain(hiddenBoat.id);
    expect(ids).not.toContain(linkBoat.id);
    expect(ids).not.toContain(ownerPrivate.id);
    expect(d.boats.find((b) => b.id === shown.id)).toMatchObject({ name: 'Möwe', owner: { handle: pub.handle }, stats: { voyages: 1, distNm: 12 } });
  });

  it('[F-72] Segler: nur öffentliche Profile mit mindestens einem öffentlichen Törn oder Boot', async () => {
    const withVoyage = await sailor('public');
    await newShare(withVoyage.cookie, { listed: true, distNm: 5 });
    const withBoat = await sailor('public');
    await newBoat(withBoat.cookie, { visibility: 'public' });
    const empty = await sailor('public');
    const onlyLinks = await sailor('public');
    await newShare(onlyLinks.cookie, { listed: false });
    await newBoat(onlyLinks.cookie, { visibility: 'private' });
    const priv = await sailor('private');
    await newShare(priv.cookie, { listed: true });

    const d = await discover();
    const handles = d.people.map((p) => p.handle);
    expect(handles).toContain(withVoyage.handle);
    expect(handles).toContain(withBoat.handle);
    expect(handles).not.toContain(empty.handle);
    expect(handles).not.toContain(onlyLinks.handle);
    expect(handles).not.toContain(priv.handle);
    expect(d.people.find((p) => p.handle === withVoyage.handle)?.stats).toEqual({ voyages: 1, distNm: 5, boats: 0 });
    expect(d.people.find((p) => p.handle === withBoat.handle)?.stats).toEqual({ voyages: 0, distNm: 0, boats: 1 });
  });
});

// ---------------------------------------------------------------- F-73 keine privaten Daten

describe('F-73 Entdecken: keine privaten Daten', () => {
  it('[F-73] Antwort enthält keine E-Mail-Adressen und keine Nutzer-IDs; kurz öffentlich cachebar', async () => {
    const s = await sailor('public');
    await newShare(s.cookie, { listed: true });
    await newBoat(s.cookie, { visibility: 'public' });
    const res = await h.fetch('/api/discover');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const raw = await res.text();
    expect(raw).toContain(s.handle);
    expect(raw).not.toContain(s.email);
    expect(raw).not.toContain('@');
    expect(raw).not.toContain(s.user.id);
    expect(raw).not.toMatch(/"(email|user_?[iI]d|owner_?[iI]d|visibility|listed|view)"/);
  });

  it('[F-73] ohne Anmeldung abrufbar; Sitzung ändert nichts an der Auswahl', async () => {
    const s = await sailor('public');
    const own = await newShare(s.cookie, { title: 'Mein Link-Törn', listed: false });
    const anon = await (await h.fetch('/api/discover?limit=24')).text();
    const self = await (await h.fetch('/api/discover?limit=24', { cookie: s.cookie })).text();
    expect(self).not.toContain(own.id);
    expect(anon).not.toContain(own.id);
  });
});

// ---------------------------------------------------------------- F-74 Grenzen, Sortierung, Vorschau

describe('F-74 Entdecken: Grenzen, Sortierung, Link-Vorschau', () => {
  it('[F-74] neueste zuerst: Törns nach Startzeit (sonst Erstellzeit), Boote und Segler nach Erstellzeit', async () => {
    const s = await sailor('public');
    const old = await newShare(s.cookie, { listed: true, startedAt: Date.UTC(2020, 0, 1) });
    const recent = await newShare(s.cookie, { listed: true, startedAt: Date.now() - 60_000 });
    const d = await discover();
    const ids = voyageIds(d);
    if (ids.includes(old.id)) expect(ids.indexOf(recent.id)).toBeLessThan(ids.indexOf(old.id));
    const when = d.voyages.map((v) => v.startedAt ?? v.createdAt);
    expect(when).toEqual([...when].sort((a, b) => b - a));
    const boatsCreated = d.boats.map((b) => (b as unknown as { createdAt: number }).createdAt);
    expect(boatsCreated).toEqual([...boatsCreated].sort((a, b) => b - a));
    const peopleCreated = d.people.map((p) => (p as unknown as { createdAt: number }).createdAt);
    expect(peopleCreated).toEqual([...peopleCreated].sort((a, b) => b - a));
  });

  it('[F-74] Limit greift: Standard 12, höchstens 24, ungültige Werte fallen auf den Standard zurück', async () => {
    const s = await sailor('public');
    const db = await h.db();
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      await db
        .prepare(
          `INSERT INTO shares (id, user_id, title, summary, visibility, view, size_bytes, track_count, created_at, updated_at, listed, dist_nm, started_at)
           VALUES (?, ?, ?, '', 'public', '', 1, 1, ?, ?, 1, 1, ?)`,
        )
        .bind(`LimitTest${String(i).padStart(6, '0')}`, s.user.id, `Massentörn ${i}`, now, now, now - i * 1000)
        .run();
    }
    expect((await discover('')).voyages).toHaveLength(12);
    expect((await discover('?limit=2')).voyages).toHaveLength(2);
    expect((await discover('?limit=1000')).voyages).toHaveLength(24);
    expect((await discover('?limit=-5')).voyages).toHaveLength(12);
    expect((await discover('?limit=abc')).voyages).toHaveLength(12);
    for (const k of ['boats', 'people'] as const) expect((await discover('?limit=1'))[k].length).toBeLessThanOrEqual(1);
  });

  it('[F-74] nur GET; andere Methoden werden abgelehnt', async () => {
    const res = await h.fetch('/api/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(405);
  });

  it('[F-74] /entdecken liefert die App mit eigener Link-Vorschau und darf indexiert werden', async () => {
    const res = await h.fetch('/entdecken');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe('Entdecken · Sail Explorer');
    expect(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1]).toBe('Entdecken · Sail Explorer');
    expect(html).not.toContain('<meta name="robots" content="noindex">');
    expect((await h.fetch('/entdecken/')).status).toBe(200);
  });
});
