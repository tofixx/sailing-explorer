// Funktionale Tests: Profile, Boote, Eigentum, Sichtbarkeit, Profil-/Bootsseiten, Link-Vorschau (F-41 … F-46)
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, grantSupport, login, loginSupporter, startWorker, type Harness, type ShareOpts } from './worker-harness';

let h: Harness;
let n = 0;
const email = (tag = 'p') => `${tag}${++n}-${Date.now()}@example.org`;
const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string | undefined, body?: unknown) =>
  h.fetch(path, { method, cookie, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });

interface ProfileIn { handle: string; displayName: string; bio?: string; visibility?: 'public' | 'unlisted' | 'private' }
async function putProfile(cookie: string, p: ProfileIn) {
  return send('PUT', '/api/me/profile', cookie, { bio: '', ...p });
}

interface Boat { id: string; name: string; visibility: string; role: string | null; owner: { handle: string; displayName: string } | null }
async function newBoat(cookie: string, input: Record<string, unknown> = {}): Promise<Boat> {
  const res = await send('POST', '/api/boats', cookie, { name: 'Seeschwalbe', visibility: 'public', ...input });
  expect(res.status).toBe(201);
  return ((await res.json()) as { boat: Boat }).boat;
}

interface Share { id: string; visibility: string; shareKey: string | null; boat: { id: string; name: string } | null; distNm: number; startedAt: number | null; isOwner: boolean }
/** listed: true = „Öffentlich“ (Standard), false = „Nur mit Link“ – sofern keine Sichtbarkeit angegeben ist. */
async function newShare(cookie: string, o: ShareOpts & { listed?: boolean; boatId?: string; distNm?: number; startedAt?: number } = {}): Promise<Share> {
  const headers: Record<string, string> = { 'X-Share-Distance': String(o.distNm ?? 10) };
  o = { ...o, visibility: o.visibility ?? (o.listed === false ? 'unlisted' : 'public') };
  if (o.boatId) headers['X-Share-Boat'] = o.boatId;
  if (o.startedAt) headers['X-Share-Started'] = String(o.startedAt);
  const res = await createShare(h, cookie, { ...o, headers });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: Share }).share;
}

/** Nutzer mit Profil; als Unterstützer, damit alle drei Stufen wählbar sind (E1 prüft visibility.test.ts). */
async function sailor(visibility: 'public' | 'unlisted' | 'private' = 'public') {
  const mail = email();
  const s = await loginSupporter(h, mail);
  const handle = uniq('crew');
  const res = await putProfile(s.cookie, { handle, displayName: 'Käpt’n Test', bio: 'Ostsee', visibility });
  expect(res.status).toBe(200);
  return { ...s, email: mail, handle };
}

const getJson = async <T>(res: Response) => (await res.json()) as T;

// ---------------------------------------------------------------- F-41 Profil

describe('F-41 Profil', () => {
  it('[F-41] Profil anlegen mit Profiladresse, Anzeigename und Bio; standardmäßig öffentlich (F-80)', async () => {
    const { cookie } = await login(h, email());
    const handle = uniq('anna');
    const res = await putProfile(cookie, { handle, displayName: 'Anna', bio: 'Jollen und Ostsee' });
    expect(res.status).toBe(200);
    expect((await getJson<{ profile: unknown }>(res)).profile).toEqual({
      handle, displayName: 'Anna', bio: 'Jollen und Ostsee', visibility: 'public', shareKey: null, link: `/u/${handle}`, isSelf: true,
    });
    const mine = await getJson<{ profile: { handle: string }; exists: boolean }>(await send('GET', '/api/me/profile', cookie));
    expect(mine).toMatchObject({ exists: true, profile: { handle } });
  });

  it('[F-41] ohne Profil gibt es einen Vorschlag (exists=false, Standard „Öffentlich“), gespeichert ist noch nichts', async () => {
    const { cookie } = await login(h, email());
    const r = await getJson<{ profile: { handle: string; visibility: string }; exists: boolean }>(await send('GET', '/api/me/profile', cookie));
    expect(r.exists).toBe(false);
    expect(r.profile.visibility).toBe('public');
    expect((await h.fetch(`/api/profiles/${r.profile.handle}`)).status).toBe(404);
  });

  // Kommentar in worker/profiles.ts: „aus dem lokalen Teil der E-Mail, aber nicht identisch damit“ –
  // der Code schlägt beim ersten Versuch aber genau den lokalen Teil vor.
  it('[F-41] Namensvorschlag verrät die E-Mail-Adresse nicht', async () => {
    const local = uniq('skipper');
    const { cookie } = await login(h, `${local}@example.org`);
    const r = await getJson<{ profile: { handle: string } }>(await send('GET', '/api/me/profile', cookie));
    expect(r.profile.handle).not.toBe(local);
  });

  it('[F-41] Profil ändern und öffentlich schalten', async () => {
    const { cookie } = await login(h, email());
    const handle = uniq('ben');
    await putProfile(cookie, { handle, displayName: 'Ben' });
    const res = await putProfile(cookie, { handle, displayName: 'Ben B.', bio: 'neu', visibility: 'public' });
    expect((await getJson<{ profile: unknown }>(res)).profile).toMatchObject({ displayName: 'Ben B.', bio: 'neu', visibility: 'public' });
    expect((await h.fetch(`/api/profiles/${handle}`)).status).toBe(200);
  });

  it('[F-41] reservierte Namen werden abgelehnt', async () => {
    const { cookie } = await login(h, email());
    for (const handle of ['admin', 'api', 'login', 'me', 'settings', 'Support']) {
      const res = await putProfile(cookie, { handle, displayName: 'X' });
      expect(res.status, handle).toBe(400);
      expect((await getJson<{ error: string }>(res)).error).toBe('invalid_handle');
    }
  });

  it('[F-41] ungültige Namen (Länge, Zeichen, Bindestrich am Rand/doppelt) werden abgelehnt', async () => {
    const { cookie } = await login(h, email());
    for (const handle of ['ab', 'a'.repeat(31), '-anna', 'anna-', 'an--na', 'an na', 'änna', 'an_na', '../x']) {
      expect((await putProfile(cookie, { handle, displayName: 'X' })).status, handle).toBe(400);
    }
  });

  it('[F-41] vergebene Namen werden abgelehnt (auch in anderer Schreibweise)', async () => {
    const a = await login(h, email());
    const b = await login(h, email());
    const handle = uniq('taken');
    expect((await putProfile(a.cookie, { handle, displayName: 'A' })).status).toBe(200);
    const res = await putProfile(b.cookie, { handle: handle.toUpperCase(), displayName: 'B' });
    expect(res.status).toBe(409);
    expect((await getJson<{ error: string }>(res)).error).toBe('handle_taken');
    // der eigene Name darf natürlich erneut gespeichert werden
    expect((await putProfile(a.cookie, { handle, displayName: 'A2' })).status).toBe(200);
  });

  it('[F-41] Anzeigename ist Pflicht', async () => {
    const { cookie } = await login(h, email());
    expect((await putProfile(cookie, { handle: uniq('leer'), displayName: '   ' })).status).toBe(400);
  });

  it('[F-41] Profil anlegen erfordert Anmeldung', async () => {
    expect((await putProfile('', { handle: uniq('anon'), displayName: 'X' })).status).toBe(401);
    expect((await h.fetch('/api/me/profile')).status).toBe(401);
  });

  it('[F-41] die E-Mail-Adresse erscheint nie in /api/profiles/* (auch nicht für den Inhaber)', async () => {
    const s = await sailor('public');
    const boat = await newBoat(s.cookie, { visibility: 'public' });
    await newShare(s.cookie, { listed: true, boatId: boat.id });
    for (const cookie of [undefined, s.cookie]) {
      const body = await (await h.fetch(`/api/profiles/${s.handle}`, { cookie })).text();
      expect(body).not.toContain(s.email);
      expect(body).not.toContain('@example.org');
    }
  });
});

// ---------------------------------------------------------------- F-42 Boote

describe('F-42 Boote', () => {
  it('[F-42] Boot anlegen mit allen Feldern; Anlegender ist Eigner', async () => {
    const s = await sailor();
    const res = await send('POST', '/api/boats', s.cookie, {
      name: 'Seeschwalbe', boatType: 'Hallberg-Rassy 31', lengthM: 9.42, sailNumber: 'GER 1234', homePort: 'Stralsund', description: 'Familienboot', visibility: 'private',
    });
    expect(res.status).toBe(201);
    const { boat } = await getJson<{ boat: Record<string, unknown> }>(res);
    expect(boat).toMatchObject({ name: 'Seeschwalbe', boatType: 'Hallberg-Rassy 31', lengthM: 9.42, sailNumber: 'GER 1234', homePort: 'Stralsund', description: 'Familienboot', visibility: 'private', role: 'owner' });
    const mine = await getJson<{ boats: Boat[] }>(await send('GET', '/api/boats', s.cookie));
    expect(mine.boats.map((b) => b.id)).toEqual([boat.id]);
  });

  it('[F-42] Heimathafen und übrige Angaben sind optional, Name ist Pflicht', async () => {
    const s = await sailor();
    const ok = await send('POST', '/api/boats', s.cookie, { name: 'Nur Name' });
    expect(ok.status).toBe(201);
    expect((await getJson<{ boat: Record<string, unknown> }>(ok)).boat).toMatchObject({ homePort: '', lengthM: null, visibility: 'public' });
    expect((await send('POST', '/api/boats', s.cookie, { boatType: 'ohne Namen' })).status).toBe(400);
  });

  it('[F-42] unplausible Länge und unbekannte Sichtbarkeit werden abgelehnt', async () => {
    const s = await sailor();
    expect((await send('POST', '/api/boats', s.cookie, { name: 'X', lengthM: 0.5 })).status).toBe(400);
    expect((await send('POST', '/api/boats', s.cookie, { name: 'X', lengthM: 500 })).status).toBe(400);
    expect((await send('POST', '/api/boats', s.cookie, { name: 'X', visibility: 'listed' })).status).toBe(400);
    expect((await send('POST', '/api/boats', s.cookie, { name: 'X', visibility: null })).status).toBe(400);
  });

  it('[F-42] Eigner darf bearbeiten', async () => {
    const s = await sailor();
    const b = await newBoat(s.cookie);
    const res = await send('PATCH', `/api/boats/${b.id}`, s.cookie, { name: 'Neuer Name', homePort: 'Rostock' });
    expect(res.status).toBe(200);
    expect((await getJson<{ boat: Record<string, unknown> }>(res)).boat).toMatchObject({ name: 'Neuer Name', homePort: 'Rostock' });
  });

  it('[F-42] ein anderer Nutzer darf ein fremdes Boot weder ändern noch löschen (404, unverändert)', async () => {
    const owner = await sailor();
    const other = await sailor();
    const b = await newBoat(owner.cookie, { name: 'Original', visibility: 'public' });
    expect((await send('PATCH', `/api/boats/${b.id}`, other.cookie, { name: 'Gekapert', visibility: 'private' })).status).toBe(404);
    expect((await send('DELETE', `/api/boats/${b.id}`, other.cookie)).status).toBe(404);
    const now = await getJson<{ boat: Boat }>(await h.fetch(`/api/boats/${b.id}`));
    expect(now.boat).toMatchObject({ name: 'Original', visibility: 'public', role: null });
    expect((await getJson<{ boats: Boat[] }>(await send('GET', '/api/boats', other.cookie))).boats).toEqual([]);
  });

  it('[F-42] anonym: Boot anlegen/ändern/löschen → 401', async () => {
    const owner = await sailor();
    const b = await newBoat(owner.cookie);
    expect((await send('POST', '/api/boats', undefined, { name: 'X' })).status).toBe(401);
    expect((await send('PATCH', `/api/boats/${b.id}`, undefined, { name: 'X' })).status).toBe(401);
    expect((await send('DELETE', `/api/boats/${b.id}`, undefined)).status).toBe(401);
  });

  it('[F-42] Admins (im Modell vorgesehen) dürfen bearbeiten, aber nicht löschen', async () => {
    const owner = await sailor();
    const admin = await sailor();
    const b = await newBoat(owner.cookie, { visibility: 'private' });
    // Admin-Verwaltung hat (noch) keine API – direkt im Modell eintragen
    await (await h.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(b.id, admin.user.id, Date.now()).run();
    const list = await getJson<{ boats: Boat[] }>(await send('GET', '/api/boats', admin.cookie));
    expect(list.boats.map((x) => [x.id, x.role])).toEqual([[b.id, 'admin']]);
    expect((await h.fetch(`/api/boats/${b.id}`, { cookie: admin.cookie })).status).toBe(200); // privat, aber verwaltet
    expect((await send('PATCH', `/api/boats/${b.id}`, admin.cookie, { description: 'vom Admin' })).status).toBe(200);
    expect((await send('DELETE', `/api/boats/${b.id}`, admin.cookie)).status).toBe(404);
    expect((await h.fetch(`/api/boats/${b.id}`, { cookie: owner.cookie })).status).toBe(200);
  });

  it('[F-42] Boot löschen (Eigner) lässt die Törns bestehen, nur die Zuordnung fällt weg', async () => {
    const s = await sailor();
    const b = await newBoat(s.cookie);
    const share = await newShare(s.cookie, { boatId: b.id, listed: true });
    expect(share.boat).toEqual({ id: b.id, name: 'Seeschwalbe' });
    expect((await send('DELETE', `/api/boats/${b.id}`, s.cookie)).status).toBe(204);
    expect((await h.fetch(`/api/boats/${b.id}`, { cookie: s.cookie })).status).toBe(404);
    const meta = await getJson<{ share: Share }>(await h.fetch(`/api/shares/${share.id}`, { cookie: s.cookie }));
    expect(meta.share.boat).toBeNull();
    expect(await (await h.r2()).head(`shares/${share.id}`)).not.toBeNull();
    expect((await h.fetch(`/api/shares/${share.id}/data`)).status).toBe(200);
  });

  it('[F-42] die E-Mail-Adresse erscheint nie in /api/boats/*', async () => {
    const s = await sailor('public');
    const b = await newBoat(s.cookie, { visibility: 'public' });
    await newShare(s.cookie, { boatId: b.id, listed: true });
    for (const [path, cookie] of [[`/api/boats/${b.id}`, undefined], [`/api/boats/${b.id}`, s.cookie], ['/api/boats', s.cookie]] as const) {
      const body = await (await h.fetch(path, { cookie })).text();
      expect(body, path).not.toContain(s.email);
      expect(body, path).not.toContain('@example.org');
    }
  });

  it('[F-42] Eigner wird auf der Bootsseite nur genannt, wenn sein Profil öffentlich ist', async () => {
    const pub = await sailor('public');
    const priv = await sailor('private');
    const b1 = await newBoat(pub.cookie, { visibility: 'public' });
    const b2 = await newBoat(priv.cookie, { visibility: 'public' });
    expect((await getJson<{ boat: Boat }>(await h.fetch(`/api/boats/${b1.id}`))).boat.owner).toEqual({ handle: pub.handle, displayName: 'Käpt’n Test' });
    expect((await getJson<{ boat: Boat }>(await h.fetch(`/api/boats/${b2.id}`))).boat.owner).toBeNull();
  });
});

// ---------------------------------------------------------------- F-43 Eigentum und Boot-Zuordnung

describe('F-43 Eigentum und Boot-Zuordnung', () => {
  it('[F-43] Freigabe gehört dem Hochladenden und kann einem eigenen Boot zugeordnet werden', async () => {
    const s = await sailor();
    const b = await newBoat(s.cookie);
    const share = await newShare(s.cookie, { boatId: b.id });
    expect(share).toMatchObject({ isOwner: true, boat: { id: b.id } });
    const row = await (await h.db()).prepare('SELECT user_id, boat_id FROM shares WHERE id = ?').bind(share.id).first<{ user_id: string; boat_id: string }>();
    expect(row).toEqual({ user_id: s.user.id, boat_id: b.id });
  });

  it('[F-43] Zuordnung zu einem fremden Boot wird beim Anlegen abgelehnt (400, nichts gespeichert)', async () => {
    const owner = await sailor();
    const other = await sailor();
    const b = await newBoat(owner.cookie, { visibility: 'public' });
    const res = await createShare(h, other.cookie, { headers: { 'X-Share-Boat': b.id } });
    expect(res.status).toBe(400);
    expect((await getJson<{ error: string }>(res)).error).toBe('invalid_boat');
    expect((await getJson<{ shares: unknown[] }>(await h.fetch('/api/shares', { cookie: other.cookie }))).shares).toEqual([]);
  });

  it('[F-43] Zuordnung zu einem fremden Boot wird beim Ändern abgelehnt', async () => {
    const owner = await sailor();
    const other = await sailor();
    const b = await newBoat(owner.cookie, { visibility: 'public' });
    const share = await newShare(other.cookie);
    expect((await send('PATCH', `/api/shares/${share.id}`, other.cookie, { boatId: b.id })).status).toBe(400);
    expect((await getJson<{ share: Share }>(await h.fetch(`/api/shares/${share.id}`, { cookie: other.cookie }))).share.boat).toBeNull();
  });

  it('[F-43] unbekannte/kaputte Boot-IDs werden abgelehnt; Zuordnung lässt sich wieder entfernen', async () => {
    const s = await sailor();
    expect((await createShare(h, s.cookie, { headers: { 'X-Share-Boat': 'ABCDEFGHJKLMNPQRST' } })).status).toBe(400);
    expect((await createShare(h, s.cookie, { headers: { 'X-Share-Boat': '../x' } })).status).toBe(400);
    const b = await newBoat(s.cookie);
    const share = await newShare(s.cookie, { boatId: b.id });
    const res = await send('PATCH', `/api/shares/${share.id}`, s.cookie, { boatId: null });
    expect((await getJson<{ share: Share }>(res)).share.boat).toBeNull();
  });

  it('[F-43] Admins dürfen Freigaben dem verwalteten Boot zuordnen', async () => {
    const owner = await sailor();
    const admin = await sailor();
    const b = await newBoat(owner.cookie);
    await (await h.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(b.id, admin.user.id, Date.now()).run();
    const share = await newShare(admin.cookie, { boatId: b.id });
    expect(share.boat?.id).toBe(b.id);
  });

  it('[F-43] Distanz und Startzeit werden übernommen, aber plausibilisiert', async () => {
    const s = await sailor();
    const t = Date.parse('2026-06-13T10:00:00Z');
    const ok = await newShare(s.cookie, { distNm: 28.4, startedAt: t });
    expect(ok).toMatchObject({ distNm: 28.4, startedAt: t });
    // unplausible Distanz: abgelehnt (F-311); Start in der Zukunft: verworfen
    expect((await createShare(h, s.cookie, { headers: { 'X-Share-Distance': '1e12' } })).status).toBe(400);
    const res = await createShare(h, s.cookie, { headers: { 'X-Share-Distance': '12', 'X-Share-Started': String(Date.now() + 10 * 86_400_000) } });
    const bad = (await getJson<{ share: Share }>(res)).share;
    expect(bad.startedAt).toBeNull();
    const neg = (await getJson<{ share: Share }>(await createShare(h, s.cookie, { headers: { 'X-Share-Distance': '-5' } }))).share;
    expect(neg.distNm).toBe(0);
  });
});

// ---------------------------------------------------------------- F-44 Sichtbarkeit

describe('F-44 Sichtbarkeit „Öffentlich“ / „Mit Link“ / „Nur ich“', () => {
  it('[F-83] nur „Öffentlich“ (visibility=public) erscheint auf Profil- und Bootsseite', async () => {
    const s = await sailor('public');
    const b = await newBoat(s.cookie, { visibility: 'public' });
    const pub = await newShare(s.cookie, { title: 'Öffentlich', visibility: 'public', boatId: b.id });
    const link = await newShare(s.cookie, { title: 'Mit Link', visibility: 'unlisted', boatId: b.id });
    const priv = await newShare(s.cookie, { title: 'Nur ich', visibility: 'private', boatId: b.id });
    expect([pub.visibility, link.visibility, priv.visibility]).toEqual(['public', 'unlisted', 'private']);
    expect(pub).not.toHaveProperty('listed');

    const prof = await getJson<{ voyages: Share[] }>(await h.fetch(`/api/profiles/${s.handle}`));
    expect(prof.voyages.map((v) => v.id)).toEqual([pub.id]);
    const boat = await getJson<{ voyages: Share[] }>(await h.fetch(`/api/boats/${b.id}`));
    expect(boat.voyages.map((v) => v.id)).toEqual([pub.id]);
    // auch der Inhaber sieht auf der öffentlichen Seite nur die öffentlichen Törns
    const own = await getJson<{ voyages: Share[] }>(await h.fetch(`/api/profiles/${s.handle}`, { cookie: s.cookie }));
    expect(own.voyages.map((v) => v.id)).toEqual([pub.id]);
  });

  it('[F-44] „Mit Link“ ist mit dem Schlüssel abrufbar, „Nur ich“ nicht (404)', async () => {
    const s = await sailor();
    const link = await newShare(s.cookie, { visibility: 'unlisted' });
    const priv = await newShare(s.cookie, { visibility: 'private' });
    expect((await h.fetch(`/api/shares/${link.id}`, { headers: { 'X-Share-Key': link.shareKey! } })).status).toBe(200);
    expect((await h.fetch(`/api/shares/${link.id}`)).status).toBe(404);
    expect((await h.fetch(`/api/shares/${priv.id}`)).status).toBe(404);
  });

  it('[F-44] Wechsel der Sichtbarkeit per PATCH wirkt sofort auf die Listen', async () => {
    const s = await sailor('public');
    const share = await newShare(s.cookie, { listed: false });
    const voyages = async () => (await getJson<{ voyages: Share[] }>(await h.fetch(`/api/profiles/${s.handle}`))).voyages.map((v) => v.id);
    expect(await voyages()).toEqual([]);
    await send('PATCH', `/api/shares/${share.id}`, s.cookie, { visibility: 'public' });
    expect(await voyages()).toEqual([share.id]);
    await send('PATCH', `/api/shares/${share.id}`, s.cookie, { visibility: 'private' });
    expect(await voyages()).toEqual([]);
  });

  it('[F-44] privates Boot einer öffentlichen Freigabe wird anderen nicht gezeigt', async () => {
    const s = await sailor('public');
    const b = await newBoat(s.cookie, { name: 'Geheimboot', visibility: 'private' });
    const share = await newShare(s.cookie, { listed: true, boatId: b.id });
    const anon = await getJson<{ share: Share }>(await h.fetch(`/api/shares/${share.id}`));
    expect(anon.share.boat).toBeNull();
    const prof = await (await h.fetch(`/api/profiles/${s.handle}`)).text();
    expect(prof).not.toContain('Geheimboot');
    const own = await getJson<{ share: Share }>(await h.fetch(`/api/shares/${share.id}`, { cookie: s.cookie }));
    expect(own.share.boat).toEqual({ id: b.id, name: 'Geheimboot' });
  });
});

// ---------------------------------------------------------------- F-45 Profil- und Bootsseiten

describe('F-45 Profil- und Bootsseiten', () => {
  it('[F-45] Profilseite: Kennzahlen (Seemeilen, Törns), öffentliche Törns und öffentliche Boote', async () => {
    const s = await sailor('public');
    await grantSupport(h, s.user.id); // vier Freigaben – mehr als das kostenlose Kontingent (F-60)
    const pubBoat = await newBoat(s.cookie, { name: 'Alpha', visibility: 'public' });
    await newBoat(s.cookie, { name: 'Beta privat', visibility: 'private' });
    await newShare(s.cookie, { listed: true, distNm: 20.5, boatId: pubBoat.id });
    await newShare(s.cookie, { listed: true, distNm: 10 });
    await newShare(s.cookie, { listed: false, distNm: 100 }); // „Mit Link“ zählt nicht
    await newShare(s.cookie, { visibility: 'private', listed: true, distNm: 100 }); // „Nur ich“ zählt nicht
    const res = await h.fetch(`/api/profiles/${s.handle}`);
    expect(res.status).toBe(200);
    const p = await getJson<{ profile: Record<string, unknown>; stats: { voyages: number; distNm: number }; boats: Boat[]; voyages: Share[] }>(res);
    expect(p.profile).toMatchObject({ handle: s.handle, displayName: 'Käpt’n Test', bio: 'Ostsee', visibility: 'public', isSelf: false });
    expect(p.stats).toEqual({ voyages: 2, distNm: 30.5, recordedNm: 30.5 });
    expect(p.voyages).toHaveLength(2);
    expect(p.voyages.every((v) => v.isOwner === false)).toBe(true);
    expect(p.boats.map((b) => b.name)).toEqual(['Alpha']);
  });

  it('[F-45] Inhaber sieht auf seiner Profilseite auch die privaten Boote', async () => {
    const s = await sailor('public');
    await newBoat(s.cookie, { name: 'Alpha', visibility: 'public' });
    await newBoat(s.cookie, { name: 'Beta', visibility: 'private' });
    const p = await getJson<{ profile: { isSelf: boolean }; boats: Boat[] }>(await h.fetch(`/api/profiles/${s.handle}`, { cookie: s.cookie }));
    expect(p.profile.isSelf).toBe(true);
    expect(p.boats.map((b) => b.name)).toEqual(['Alpha', 'Beta']);
  });

  it('[F-45] Profiladresse unabhängig von Groß-/Kleinschreibung', async () => {
    const s = await sailor('public');
    expect((await h.fetch(`/api/profiles/${s.handle.toUpperCase()}`)).status).toBe(200);
  });

  it('[F-45] Bootsseite: Kennzahlen und öffentliche Törns – auch von anderen Nutzern (Admins)', async () => {
    const owner = await sailor('public');
    const admin = await sailor('public');
    const b = await newBoat(owner.cookie, { visibility: 'public' });
    await (await h.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(b.id, admin.user.id, Date.now()).run();
    await newShare(owner.cookie, { listed: true, boatId: b.id, distNm: 12 });
    await newShare(admin.cookie, { listed: true, boatId: b.id, distNm: 8 });
    await newShare(owner.cookie, { listed: false, boatId: b.id, distNm: 99 });
    const r = await getJson<{ boat: Boat; stats: { voyages: number; distNm: number }; voyages: Share[] }>(await h.fetch(`/api/boats/${b.id}`));
    expect(r.stats).toEqual({ voyages: 2, distNm: 20, recordedNm: 20 });
    expect(r.voyages).toHaveLength(2);
    expect(r.boat.role).toBeNull();
  });

  it('[F-45] private Profile sind für andere 404 – wie unbekannte', async () => {
    const s = await sailor('private');
    const other = await sailor('public');
    const a = await h.fetch(`/api/profiles/${s.handle}`);
    const b = await h.fetch(`/api/profiles/${s.handle}`, { cookie: other.cookie });
    const c = await h.fetch(`/api/profiles/${uniq('gibtsnicht')}`);
    expect([a.status, b.status, c.status]).toEqual([404, 404, 404]);
    expect(new Set([await a.text(), await b.text(), await c.text()]).size).toBe(1);
    // Inhaber sieht seine private Seite
    expect((await h.fetch(`/api/profiles/${s.handle}`, { cookie: s.cookie })).status).toBe(200);
  });

  it('[F-45] private Boote sind für andere 404 – wie unbekannte', async () => {
    const s = await sailor();
    const other = await sailor();
    const b = await newBoat(s.cookie, { visibility: 'private' });
    const a = await h.fetch(`/api/boats/${b.id}`);
    const o = await h.fetch(`/api/boats/${b.id}`, { cookie: other.cookie });
    const u = await h.fetch('/api/boats/ABCDEFGHJKLMNPQRST');
    expect([a.status, o.status, u.status]).toEqual([404, 404, 404]);
    expect(new Set([await a.text(), await o.text(), await u.text()]).size).toBe(1);
    expect((await h.fetch(`/api/boats/${b.id}`, { cookie: s.cookie })).status).toBe(200);
  });

  it('[F-45] öffentliche Törns eines privaten Profils werden nicht über die Profilseite verbreitet', async () => {
    const s = await sailor('private');
    await newShare(s.cookie, { listed: true });
    expect((await h.fetch(`/api/profiles/${s.handle}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- F-46 Link-Vorschau

describe('F-46 Link-Vorschau /u/ und /b/', () => {
  const head = async (path: string) => {
    const res = await h.fetch(path);
    const html = await res.text();
    return {
      status: res.status,
      html,
      title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
      ogTitle: /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1],
      ogDesc: /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1],
      noindex: html.includes('<meta name="robots" content="noindex">'),
    };
  };

  it('[F-46] öffentliches Profil: Name und Bio in der Vorschau, darf indexiert werden', async () => {
    const s = await sailor('public');
    const m = await head(`/u/${s.handle}`);
    expect(m.status).toBe(200);
    expect(m.title).toBe('Käpt’n Test · Sail Explorer');
    expect(m.ogTitle).toBe('Käpt’n Test · Sail Explorer');
    expect(m.ogDesc).toBe('Ostsee');
    expect(m.noindex).toBe(false);
    expect(m.html).not.toContain(s.email);
  });

  it('[F-46] /u/ ist unabhängig von Groß-/Kleinschreibung', async () => {
    const s = await sailor('public');
    expect((await head(`/u/${s.handle.toUpperCase()}`)).title).toBe('Käpt’n Test · Sail Explorer');
  });

  it('[F-46] privates/unbekanntes Profil: Fallback-Titel, noindex', async () => {
    const s = await sailor('private');
    for (const path of [`/u/${s.handle}`, `/u/${uniq('niemand')}`]) {
      const m = await head(path);
      expect(m.title, path).toBe('Sail Explorer');
      expect(m.ogTitle, path).toBe('Sail Explorer');
      expect(m.html, path).not.toContain('Käpt’n Test');
      expect(m.noindex, path).toBe(true);
    }
  });

  it('[F-46] öffentliches Boot: Name, Typ und Heimathafen in der Vorschau, darf indexiert werden', async () => {
    const s = await sailor('public');
    const b = await newBoat(s.cookie, { name: 'Seeschwalbe', boatType: 'Folkeboot', homePort: 'Stralsund', visibility: 'public' });
    const m = await head(`/b/${b.id}`);
    expect(m.title).toBe('Seeschwalbe · Sail Explorer');
    expect(m.ogDesc).toBe('Folkeboot · Heimathafen Stralsund');
    expect(m.noindex).toBe(false);
  });

  it('[F-46] privates/unbekanntes Boot: Fallback-Titel, noindex', async () => {
    const s = await sailor('public');
    const b = await newBoat(s.cookie, { name: 'Geheimboot', visibility: 'private' });
    for (const path of [`/b/${b.id}`, '/b/ABCDEFGHJKLMNPQRST']) {
      const m = await head(path);
      expect(m.title, path).toBe('Sail Explorer');
      expect(m.html, path).not.toContain('Geheimboot');
      expect(m.noindex, path).toBe(true);
    }
  });

  it('[F-84] öffentliche Törns sind indexierbar (E2), dieselbe Seite mit Schlüssel im Pfad nie', async () => {
    const s = await sailor('public');
    const share = await newShare(s.cookie, { title: 'Öffentlicher Törn' });
    const m = await head(`/s/${share.id}`);
    expect(m.title).toBe('Öffentlicher Törn · Sail Explorer');
    expect(m.noindex).toBe(false);
    // öffentliche Objekte ignorieren einen (auch falschen) Schlüssel – Vorschau ja, Index nein
    const k = await head(`/s/${share.id}/${'Q'.repeat(22)}`);
    expect(k.title).toBe('Öffentlicher Törn · Sail Explorer');
    expect(k.noindex).toBe(true);
  });

  it('[F-46] Vorschau-Text mit Sonderzeichen bricht nicht aus dem Attribut aus', async () => {
    const { cookie } = await login(h, email());
    const handle = uniq('xss');
    await putProfile(cookie, { handle, displayName: '"><script>x</script>', bio: '"><img src=x>', visibility: 'public' });
    const m = await head(`/u/${handle}`);
    expect(m.ogDesc).toBe('&quot;><img src=x>');
    expect(m.title).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(m.html.match(/<script/g) ?? []).toHaveLength(1); // nur innerhalb des og:title-Attributs
  });
});

// ---------------------------------------------------------------- F-37 erweitert

describe('F-37 Konto löschen (Profile/Boote)', () => {
  it('[F-37] Konto löschen entfernt auch Profil und Boote; fremde Törns auf diesen Booten bleiben (ohne Boot)', async () => {
    const s = await sailor('public');
    const b = await newBoat(s.cookie, { visibility: 'public' });
    const admin = await sailor('public');
    await (await h.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(b.id, admin.user.id, Date.now()).run();
    const foreign = await newShare(admin.cookie, { listed: true, boatId: b.id });
    const own = await newShare(s.cookie, { listed: true, boatId: b.id });

    expect((await send('DELETE', '/api/account', s.cookie)).status).toBe(200);
    const db = await h.db();
    expect(await db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').bind(s.user.id).first()).toBeNull();
    expect(await db.prepare('SELECT 1 FROM boats WHERE owner_id = ?').bind(s.user.id).first()).toBeNull();
    expect(await db.prepare('SELECT 1 FROM boat_admins WHERE boat_id = ?').bind(b.id).first()).toBeNull();
    expect((await h.fetch(`/api/profiles/${s.handle}`)).status).toBe(404);
    expect((await h.fetch(`/api/boats/${b.id}`)).status).toBe(404);
    expect((await h.fetch(`/api/shares/${own.id}`)).status).toBe(404);
    const f = await getJson<{ share: Share }>(await h.fetch(`/api/shares/${foreign.id}`));
    expect(f.share.boat).toBeNull();
    // Profilname ist wieder frei
    const n2 = await login(h, email());
    expect((await putProfile(n2.cookie, { handle: s.handle, displayName: 'Neu' })).status).toBe(200);
  });
});
