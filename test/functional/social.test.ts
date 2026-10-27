// Funktionale Tests: Verein, Hafen, Team und Reaktionen (F-170 … F-181, Konzept 12). Echter Worker in workerd
// (Miniflare) – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';
import { HARBOR_LIMITS } from '../../src/domain/harbors';
import { REACTION_LIMITS } from '../../src/domain/reactions';

const DAY = 86_400_000;
let h: Harness;
let s: ReturnType<typeof social>;

const ADMIN_ID = 'AdminUserAAAAAAAAAA';
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID, APP_ORIGIN: 'https://segeln.example' });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'admin-social@example.org', Date.now() - 10 * DAY).run();
  admin = { ...(await login(h, 'admin-social@example.org')), email: 'admin-social@example.org' };
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

type Item = StreamOut['items'][number] & { harbor?: { slug: string; name: string }; reactions?: { subject: string; id: string; counts: Record<string, number>; mine: string | null } };
type Page = { items: Item[]; cursor: string | null; hasGroups?: boolean; home?: { club: { slug: string } | null; harbor: { slug: string } | null }; filters?: { harbors: Array<{ slug: string }>; clubs: Array<{ slug: string }> } };
interface HarborOut {
  id: string;
  slug: string;
  name: string;
}

const stream = async (p: Person) => {
  const res = await s.send('GET', '/api/stream', p.cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Page;
};
const voyageIds = (o: Page) => o.items.filter((i) => i.voyage).map((i) => i.voyage!.id);
const postIds = (o: Page) => o.items.filter((i) => i.post).map((i) => i.post!.id);

async function harbor(p: Person, name: string): Promise<{ res: Response; harbor: HarborOut; created: boolean }> {
  const res = await s.send('POST', '/api/harbors', p.cookie, { name });
  const body = (await res.clone().json()) as { harbor: HarborOut; created: boolean };
  return { res, ...body };
}
const team = (owner: Person, club: { id: string }, o: Record<string, unknown> = {}) => s.group(owner, { kind: 'team', name: 'Regattacrew', parentId: club.id, ...o });
const post = async (admin: Person, g: { id: string }, body = 'Hallo Hafen') => {
  const res = await s.send('POST', `/api/groups/${g.id}/posts`, admin.cookie, { body });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { post: { id: string } }).post;
};

// ---------------------------------------------------------------- F-170 Mein Verein

describe('F-170 Mein Verein', () => {
  it('[F-170] nur Vereine, in denen man Mitglied ist; Profil zeigt ihn nur öffentlich; Austritt leert die Wahl', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const club = await s.group(owner, { name: 'Potsdamer Yacht Club' });
    const closed = await s.group(owner, { name: 'Geheimbund', visibility: 'private' });
    const t = await team(owner, club);
    const me = await s.person({ profile: 'public' });
    await s.join(owner, club, me);
    await s.join(owner, closed, me);
    await s.join(owner, t, me);
    const stranger = await s.group(owner, { name: 'Anderer Verein' });

    expect((await s.send('PUT', '/api/me/home', undefined, { clubId: club.id })).status).toBe(401);
    for (const bad of [stranger.id, t.id, 'Unbekannt123456789', 42]) {
      const res = await s.send('PUT', '/api/me/home', me.cookie, { clubId: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(await s.errorOf(res)).toBe('invalid_club');
    }
    const ok = await s.send('PUT', '/api/me/home', me.cookie, { clubId: club.id });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as { club: { slug: string } }).club.slug).toBe(club.slug);
    const mine = (await (await s.send('GET', '/api/me/home', me.cookie)).json()) as { club: { id: string }; clubs: Array<{ id: string }> };
    expect(mine.club.id).toBe(club.id);
    expect(mine.clubs.map((c) => c.id).sort()).toEqual([club.id, closed.id].sort());

    const prof = (await (await h.fetch(`/api/profiles/${me.handle}`)).json()) as { home: { club: { slug: string; name: string } | null } };
    expect(prof.home.club).toEqual({ slug: club.slug, name: 'Potsdamer Yacht Club' });
    // geschlossener Verein: Wahl gilt, aber das Profil verrät ihn nicht
    await s.send('PUT', '/api/me/home', me.cookie, { clubId: closed.id });
    const prof2 = (await (await h.fetch(`/api/profiles/${me.handle}`)).json()) as { home: { club: unknown } };
    expect(prof2.home.club).toBeNull();
    expect(JSON.stringify(prof2)).not.toContain('Geheimbund');
    // Austritt leert die Wahl
    expect((await s.send('DELETE', `/api/groups/${closed.id}/members/me`, me.cookie)).status).toBe(204);
    const after = (await (await s.send('GET', '/api/me/home', me.cookie)).json()) as { club: unknown };
    expect(after.club).toBeNull();
    // leeren geht immer
    await s.send('PUT', '/api/me/home', me.cookie, { clubId: club.id });
    const cleared = await s.send('PUT', '/api/me/home', me.cookie, { clubId: null });
    expect(((await cleared.json()) as { club: unknown }).club).toBeNull();
  });
});

// ---------------------------------------------------------------- F-171 … F-174 Häfen

describe('F-171 … F-174 Häfen', () => {
  it('[F-171] anlegen mit Dubletten-Erkennung, Autovervollständigung, ohne Anmeldung 401, gesperrt 403, leer 400', async () => {
    const a = await s.person();
    const name = `Hafen ${s.uniq('Werder')}`;
    const first = await harbor(a, name);
    expect(first.res.status).toBe(201);
    expect(first.created).toBe(true);
    expect(first.harbor.slug).toMatch(/^[a-z0-9-]+$/);
    const again = await harbor(a, `  ${name.toUpperCase().replace(' ', '-')} `);
    expect(again.res.status).toBe(200);
    expect(again.harbor.id).toBe(first.harbor.id);
    const q = name.slice(6, 14).toLowerCase();
    const found = (await (await h.fetch(`/api/harbors?q=${encodeURIComponent(q)}`)).json()) as { harbors: HarborOut[] };
    expect(found.harbors.map((x) => x.id)).toContain(first.harbor.id);
    expect(((await (await h.fetch('/api/harbors?q=a')).json()) as { harbors: unknown[] }).harbors).toEqual([]);
    expect((await s.send('POST', '/api/harbors', undefined, { name: 'Gast' })).status).toBe(401);
    expect((await s.send('POST', '/api/harbors', a.cookie, { name: ' ... ' })).status).toBe(400);
    const sus = await s.person();
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), sus.user.id).run();
    expect((await harbor(sus, `Neu ${s.uniq('x')}`)).res.status).toBe(403);
    // vorhandenen Hafen bekommen auch gesperrte Konten (nichts Neues entsteht)
    expect((await harbor(sus, name)).res.status).toBe(200);
  });

  it('[F-171] höchstens 10 neue Häfen pro Konto und Tag (429 harbor_quota)', async () => {
    const a = await s.person();
    for (let i = 0; i < HARBOR_LIMITS.perDay; i++) expect((await harbor(a, `Quote ${s.uniq('q')}`)).res.status).toBe(201);
    const over = await harbor(a, `Quote ${s.uniq('q')}`);
    expect(over.res.status).toBe(429);
    expect(await s.errorOf(over.res)).toBe('harbor_quota');
  });

  it('[F-172] Boote wählen einen Hafen (ID oder Text); homePort ist der Hafenname; Bootsseite zeigt Hafen und Vereine', async () => {
    const owner = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: 'SC Hafenblick' });
    const { harbor: hb } = await harbor(owner, `Marina ${s.uniq('m')}`);
    const boat = await s.boat(owner, { harborId: hb.id });
    const got = (await (await h.fetch(`/api/boats/${boat.id}`)).json()) as { boat: { homePort: string; harbor: HarborOut }; clubs: Array<{ slug: string }> };
    expect(got.boat.harbor).toEqual({ id: hb.id, slug: hb.slug, name: hb.name });
    expect(got.boat.homePort).toBe(hb.name);
    expect(got.clubs).toEqual([]);
    await s.send('POST', `/api/groups/${club.id}/boats`, owner.cookie, { boatId: boat.id });
    const withClub = (await (await h.fetch(`/api/boats/${boat.id}`)).json()) as { clubs: Array<{ slug: string; name: string }> };
    expect(withClub.clubs).toEqual([{ slug: club.slug, name: 'SC Hafenblick', kind: 'club' }]);
    // Text (alte Clients): vorhandener Hafen per Normalisierung
    const viaText = await s.send('PATCH', `/api/boats/${boat.id}`, owner.cookie, { homePort: hb.name.toUpperCase() });
    expect(((await viaText.json()) as { boat: { harbor: HarborOut } }).boat.harbor.id).toBe(hb.id);
    // leeren
    const none = await s.send('PATCH', `/api/boats/${boat.id}`, owner.cookie, { harborId: null });
    const nb = ((await none.json()) as { boat: { harbor: unknown; homePort: string } }).boat;
    expect(nb.harbor).toBeNull();
    expect(nb.homePort).toBe('');
    // unbekannter bzw. ausgeblendeter Hafen
    expect((await s.send('PATCH', `/api/boats/${boat.id}`, owner.cookie, { harborId: 'Unbekannt123456789' })).status).toBe(400);
    await (await s.db()).prepare('UPDATE harbors SET hidden_at = ? WHERE id = ?').bind(Date.now(), hb.id).run();
    const hidden = await s.send('PATCH', `/api/boats/${boat.id}`, owner.cookie, { harborId: hb.id });
    expect(await s.errorOf(hidden)).toBe('invalid_harbor');
  });

  it('[F-173] Hafenseite: nur öffentliche Boote und Törns; Folgen; ausgeblendet 404; Vorschau', async () => {
    const a = await s.person({ profile: 'public', supporter: true });
    const { harbor: hb } = await harbor(a, `Yachthafen ${s.uniq('y')}`);
    const pub = await s.boat(a, { name: 'Öffentlich', harborId: hb.id });
    const priv = await s.boat(a, { name: 'Privatboot', visibility: 'private', harborId: hb.id });
    const v1 = await s.share(a, { boatId: pub.id, title: 'Sichtbar' });
    const v2 = await s.share(a, { boatId: pub.id, title: 'Geheim', visibility: 'private' });
    const v3 = await s.share(a, { boatId: priv.id, title: 'Privates Boot' });
    const res = await h.fetch(`/api/harbors/slug/${hb.slug}`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { boats: Array<{ id: string }>; voyages: Array<{ id: string }>; stats: { boats: number; voyages: number }; social: { followers: number } };
    expect(page.boats.map((b) => b.id)).toEqual([pub.id]);
    expect(page.voyages.map((v) => v.id)).toEqual([v1.id]);
    expect(page.stats).toMatchObject({ boats: 1, voyages: 1 });
    const raw = JSON.stringify(page);
    for (const leak of [priv.id, v2.id, v3.id, 'Privatboot', a.email, a.user.id]) expect(raw).not.toContain(leak);
    // Hafen-Stream: Törn des öffentlichen Boots, „Neues Boot im Hafen“ nur für das öffentliche Boot
    const st = (await (await h.fetch(`/api/harbors/${hb.id}/stream`)).json()) as Page;
    expect(voyageIds(st)).toEqual([v1.id]);
    expect(st.items.filter((i) => i.kind === 'harbor').map((i) => i.boat!.id)).toEqual([pub.id]);
    expect(st.items.find((i) => i.kind === 'harbor')?.harbor).toEqual({ slug: hb.slug, name: hb.name });
    // Folgen
    const b = await s.person();
    const f = await s.send('PUT', `/api/follows/harbor/${hb.id}`, b.cookie);
    expect(await f.json()).toEqual({ followers: 1, isFollowing: true });
    // Vorschau
    expect(await (await h.fetch(`/h/${hb.slug}`)).text()).toContain(`Hafen ${hb.name} · Sail Explorer`);
    // ausgeblendet: 404 (Seite, Stream, Folgen); die Moderation sieht ihn
    await (await s.db()).prepare('UPDATE harbors SET hidden_at = ? WHERE id = ?').bind(Date.now(), hb.id).run();
    expect((await h.fetch(`/api/harbors/slug/${hb.slug}`)).status).toBe(404);
    expect((await h.fetch(`/api/harbors/${hb.id}/stream`)).status).toBe(404);
    expect((await s.send('PUT', `/api/follows/harbor/${hb.id}`, a.cookie)).status).toBe(404);
    expect(await (await h.fetch(`/h/${hb.slug}`)).text()).toContain('noindex');
    expect((await h.fetch('/api/harbors/slug/gibt-es-nicht')).status).toBe(404);
  });

  it('[F-171] bearbeiten: Name und Position nur Anleger:in; Verein nur dessen Verwalter, nicht fremden überschreiben', async () => {
    const creator = await s.person();
    const other = await s.person();
    const { harbor: hb } = await harbor(creator, `Steg ${s.uniq('s')}`);
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, other.cookie, { name: 'Umbenannt' })).status).toBe(403);
    const pos = await s.send('PATCH', `/api/harbors/${hb.id}`, creator.cookie, { lat: 52.4, lon: 13.05 });
    expect(pos.status, await pos.clone().text()).toBe(200);
    expect(((await pos.json()) as { harbor: { lat: number; lon: number } }).harbor).toMatchObject({ lat: 52.4, lon: 13.05 });
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, creator.cookie, { lat: 95, lon: 0 })).status).toBe(400);
    const clubA = await s.group(other, { name: 'Verein A' });
    const ownerB = await s.person();
    const clubB = await s.group(ownerB, { name: 'Verein B' });
    // fremder Verein, den man nicht verwaltet
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, other.cookie, { clubId: clubB.id })).status).toBe(400);
    const set = await s.send('PATCH', `/api/harbors/${hb.id}`, other.cookie, { clubId: clubA.id });
    expect(set.status, await set.clone().text()).toBe(200);
    const page = (await (await h.fetch(`/api/harbors/slug/${hb.slug}`)).json()) as { club: { slug: string } };
    expect(page.club.slug).toBe(clubA.slug);
    // schon vergeben: andere Verwalter überschreiben nicht
    const taken = await s.send('PATCH', `/api/harbors/${hb.id}`, ownerB.cookie, { clubId: clubB.id });
    expect(await s.errorOf(taken)).toBe('club_taken');
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, ownerB.cookie, { clubId: null })).status).toBe(403);
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, other.cookie, { clubId: null })).status).toBe(200);
  });

  it('[F-174] Heimathafen: ausdrücklich oder aus den Booten; Profil nur ausdrücklich oder von öffentlichem Boot', async () => {
    const me = await s.person({ profile: 'public', supporter: true });
    const { harbor: h1 } = await harbor(me, `Privathafen ${s.uniq('p')}`);
    await s.boat(me, { visibility: 'private', harborId: h1.id });
    const home = (await (await s.send('GET', '/api/me/home', me.cookie)).json()) as { harbor: HarborOut; harborExplicit: boolean };
    expect(home.harbor.id).toBe(h1.id);
    expect(home.harborExplicit).toBe(false);
    // vom privaten Boot: nicht auf dem Profil
    const p1 = (await (await h.fetch(`/api/profiles/${me.handle}`)).json()) as { home: { harbor: unknown } };
    expect(p1.home.harbor).toBeNull();
    const { harbor: h2 } = await harbor(me, `Wahlhafen ${s.uniq('w')}`);
    const put = await s.send('PUT', '/api/me/home', me.cookie, { harborId: h2.id });
    expect(((await put.json()) as { harbor: HarborOut; harborExplicit: boolean }).harborExplicit).toBe(true);
    const p2 = (await (await h.fetch(`/api/profiles/${me.handle}`)).json()) as { home: { harbor: { slug: string } } };
    expect(p2.home.harbor.slug).toBe(h2.slug);
    expect((await s.send('PUT', '/api/me/home', me.cookie, { harborId: 'Unbekannt123456789' })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- F-176/F-177 Stream-Zusammensetzung

describe('F-176/F-177 Stream-Zusammensetzung', () => {
  it('[F-176] Heimathafen: öffentliche Törns öffentlicher Boote im Hafen erscheinen; private Törns und private Boote nicht', async () => {
    const me = await s.person();
    const { harbor: hb } = await harbor(me, `Stadthafen ${s.uniq('h')}`);
    await s.boat(me, { harborId: hb.id }); // Heimathafen aus dem eigenen Boot
    const neighbour = await s.person({ supporter: true });
    const nb = await s.boat(neighbour, { harborId: hb.id });
    const secretBoat = await s.boat(neighbour, { visibility: 'private', harborId: hb.id });
    const pub = await s.share(neighbour, { boatId: nb.id, title: 'Nachbartörn' });
    const priv = await s.share(neighbour, { boatId: nb.id, visibility: 'private' });
    const viaPrivateBoat = await s.share(neighbour, { boatId: secretBoat.id });
    const st = await stream(me);
    expect(voyageIds(st)).toContain(pub.id);
    expect(voyageIds(st)).not.toContain(priv.id);
    expect(voyageIds(st)).not.toContain(viaPrivateBoat.id);
    expect(st.home?.harbor?.slug).toBe(hb.slug);
    expect(st.items.some((i) => i.kind === 'harbor' && i.boat?.id === nb.id)).toBe(true);
    expect(st.items.some((i) => i.kind === 'harbor' && i.boat?.id === secretBoat.id)).toBe(false);
    // Törn wird privat → verschwindet beim Lesen
    await s.send('PATCH', `/api/shares/${pub.id}`, neighbour.cookie, { visibility: 'private' });
    expect(voyageIds(await stream(me))).not.toContain(pub.id);
  });

  it('[F-176] Teammitglieder: öffentliche Törns aller Mitglieder meiner Teams, nie private', async () => {
    const owner = await s.person({ supporter: true });
    const club = await s.group(owner);
    const t = await team(owner, club);
    const me = await s.person();
    const mate = await s.person({ supporter: true });
    await s.join(owner, t, me);
    await s.join(owner, t, mate);
    const outsider = await s.person();
    const pub = await s.share(mate, { title: 'Teamtörn' });
    const priv = await s.share(mate, { visibility: 'private' });
    const linked = await s.share(mate, { visibility: 'unlisted' });
    const other = await s.share(outsider);
    const ids = voyageIds(await stream(me));
    expect(ids).toContain(pub.id);
    for (const no of [priv.id, linked.id, other.id]) expect(ids).not.toContain(no);
  });

  it('[F-176] Heimatverein: Neuigkeiten aus seinen Teams – aus geschlossenen Teams nur als Mitglied', async () => {
    const owner = await s.person({ supporter: true });
    const club = await s.group(owner, { name: 'Heimatclub' });
    const openTeam = await team(owner, club, { name: 'Jugend' });
    const closedTeam = await team(owner, club, { name: 'Vorstand', visibility: 'private' });
    const me = await s.person();
    await s.join(owner, club, me);
    const p1 = await post(owner, openTeam, 'Training am Samstag');
    const p2 = await post(owner, closedTeam, 'Vertraulich');
    // ohne Heimatverein: Teams des Vereins nicht im Stream (nur der Verein selbst)
    expect(postIds(await stream(me))).not.toContain(p1.id);
    await s.send('PUT', '/api/me/home', me.cookie, { clubId: club.id });
    const st = await stream(me);
    expect(postIds(st)).toContain(p1.id);
    expect(postIds(st)).not.toContain(p2.id);
    expect(JSON.stringify(st)).not.toContain('Vertraulich');
    expect(st.home?.club?.slug).toBe(club.slug);
  });

  it('[F-177] die Stream-Abfrage nutzt den Index von activity_target (Schlüsselliste als äußere Schleife)', async () => {
    const db = await s.db();
    const { PERSONAL_SQL } = await import('../../worker/stream-sql');
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${PERSONAL_SQL}`).bind('[["user","x"]]', Date.now(), '~', 60).all<{ detail: string }>();
    const details = plan.results.map((r) => r.detail).join('\n');
    expect(details).toMatch(/SEARCH t USING (COVERING )?INDEX (activity_target_feed|sqlite_autoindex_activity_target_1)/);
    expect(details).not.toMatch(/SCAN t\b/);
  });

  it('[F-177] viele Quellen zugleich (Gruppen, Boote, Folgen, Teams, Hafen, Teammitglieder) – ohne UNION-Grenze', async () => {
    const me = await s.person({ supporter: true });
    const db = await s.db();
    const now = Date.now();
    // 800 Folgen + Gruppen + Boot + Hafen + Team: wird zu einer Schlüsselliste
    for (let i = 0; i < 800; i += 100) {
      const values = Array.from({ length: 100 }, (_, k) => `('${me.user.id}', 'user', 'U${String(i + k).padStart(17, '0')}', ${now})`).join(',');
      await db.prepare(`INSERT INTO follows (user_id, target_kind, target_id, created_at) VALUES ${values}`).all();
    }
    const club = await s.group(me);
    await team(me, club);
    const { harbor: hb } = await harbor(me, `Vielhafen ${s.uniq('v')}`);
    await s.boat(me, { harborId: hb.id });
    const own = await s.share(me, { title: 'Eigener' });
    const st = await stream(me);
    expect(voyageIds(st)).toContain(own.id);
  });

  it('[F-176] keine Konto-IDs und E-Mail-Adressen im Stream; ohne Anmeldung 401', async () => {
    const me = await s.person();
    const other = await s.person({ profile: 'public' });
    const owner = await s.person({ supporter: true });
    const club = await s.group(owner);
    const t = await team(owner, club);
    await s.join(owner, t, me);
    await s.join(owner, t, other);
    await s.share(other);
    const raw = JSON.stringify(await stream(me));
    for (const leak of [other.user.id, other.email, owner.user.id]) expect(raw).not.toContain(leak);
    expect((await s.send('GET', '/api/stream', undefined)).status).toBe(401);
  });
});

// ---------------------------------------------------------------- F-178 Öffentlicher Community-Stream

describe('F-178 öffentlicher Community-Stream', () => {
  it('[F-178] für Gäste: nur Öffentliches, Filter auf der ersten Seite, gecacht; Hafen- und Vereinsfilter', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const club = await s.group(owner, { name: 'Offener Verein' });
    const closed = await s.group(owner, { name: 'Geschlossen', visibility: 'private' });
    const pPub = await post(owner, club, 'Öffentlicher Beitrag');
    const pPriv = await post(owner, closed, 'Interner Beitrag');
    const { harbor: hb } = await harbor(owner, `Filterhafen ${s.uniq('f')}`);
    const boat = await s.boat(owner, { harborId: hb.id });
    const v = await s.share(owner, { boatId: boat.id });
    const priv = await s.share(owner, { visibility: 'private' });

    const res = await h.fetch('/api/stream/public');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    const body = (await res.json()) as Page;
    expect(postIds(body)).toContain(pPub.id);
    expect(postIds(body)).not.toContain(pPriv.id);
    expect(voyageIds(body)).toContain(v.id);
    expect(voyageIds(body)).not.toContain(priv.id);
    expect(JSON.stringify(body)).not.toContain('Interner Beitrag');
    expect(body.filters?.harbors.map((x) => x.slug)).toContain(hb.slug);
    expect(body.filters?.clubs.map((x) => x.slug)).toContain(club.slug);
    expect(body.filters?.clubs.map((x) => x.slug)).not.toContain(closed.slug);

    const byHarbor = (await (await h.fetch(`/api/stream/public?harbor=${hb.slug}`)).json()) as Page;
    expect(voyageIds(byHarbor)).toEqual([v.id]);
    const byClub = (await (await h.fetch(`/api/stream/public?club=${club.slug}`)).json()) as Page;
    expect(postIds(byClub)).toEqual([pPub.id]);
    expect((await h.fetch(`/api/stream/public?club=${closed.slug}`)).status).toBe(404);
    expect((await h.fetch('/api/stream/public?harbor=gibt-es-nicht')).status).toBe(404);
    expect((await h.fetch('/api/stream/public?cursor=kaputt')).status).toBe(400);
    // angemeldet: dieselben Einträge, aber nie in fremde Caches
    const signed = await s.send('GET', '/api/stream/public', owner.cookie);
    expect(signed.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

// ---------------------------------------------------------------- F-179 … F-181 Reaktionen

const react = (p: Person | undefined, subject: string, id: string, kind: string | null, headers: Record<string, string> = {}) =>
  kind === null ? s.send('DELETE', `/api/reactions/${subject}/${id}`, p?.cookie, undefined, headers) : s.send('PUT', `/api/reactions/${subject}/${id}`, p?.cookie, { kind }, headers);

describe('F-179/F-180 Reaktionen', () => {
  it('[F-179] setzen, ersetzen, zurücknehmen – eine pro Person; Zähler; Stream trägt Zähler und eigene', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner, { title: 'Reaktionstörn' });
    const a = await s.person({ profile: 'public' });
    const b = await s.person();
    const r1 = await react(a, 'share', share.id, 'like');
    expect(r1.status, await r1.clone().text()).toBe(200);
    expect(await r1.json()).toEqual({ counts: { like: 1, mast: 0, tack: 0 }, mine: 'like' });
    await react(b, 'share', share.id, 'like');
    const r2 = await react(a, 'share', share.id, 'mast');
    expect(await r2.json()).toEqual({ counts: { like: 1, mast: 1, tack: 0 }, mine: 'mast' });
    const n = await (await s.db()).prepare(`SELECT COUNT(*) AS n FROM reactions WHERE subject_kind = 'share' AND subject_id = ?`).bind(share.id).first<{ n: number }>();
    expect(n?.n).toBe(2);
    const st = await stream(owner);
    const item = st.items.find((i) => i.voyage?.id === share.id)!;
    expect(item.reactions).toEqual({ subject: 'share', id: share.id, counts: { like: 1, mast: 1, tack: 0 }, mine: null });
    const r3 = await react(a, 'share', share.id, null);
    expect(await r3.json()).toEqual({ counts: { like: 1, mast: 0, tack: 0 }, mine: null });
    expect((await react(a, 'share', share.id, 'boo')).status).toBe(400);
    expect((await react(undefined, 'share', share.id, 'like')).status).toBe(401);
    expect((await s.send('PUT', `/api/reactions/comment/${share.id}`, a.cookie, { kind: 'like' })).status).toBe(404);
  });

  it('[F-179] nur auf Sichtbares: private Törns 404, „Nur mit Link“ nur mit Schlüssel, Beiträge geschlossener Gruppen nur Mitglieder', async () => {
    const owner = await s.person({ supporter: true });
    const priv = await s.share(owner, { visibility: 'private' });
    const linked = await s.share(owner, { visibility: 'unlisted' });
    const a = await s.person();
    expect((await react(a, 'share', priv.id, 'like')).status).toBe(404);
    expect((await react(a, 'share', linked.id, 'like')).status).toBe(404);
    expect((await react(a, 'share', linked.id, 'like', { 'X-Share-Key': linked.shareKey! })).status).toBe(200);
    expect((await s.send('GET', `/api/reactions/share/${priv.id}`, a.cookie)).status).toBe(404);
    const closed = await s.group(owner, { visibility: 'private' });
    const p = await post(owner, closed, 'Intern');
    expect((await react(a, 'post', p.id, 'tack')).status).toBe(404);
    await s.join(owner, closed, a);
    expect((await react(a, 'post', p.id, 'tack')).status).toBe(200);
    // Aktivität: Mitglied-Beitritt in der geschlossenen Gruppe – Fremde 404, Mitglieder ja
    const act = (await (await s.send('GET', `/api/groups/${closed.id}/stream`, a.cookie)).json()) as Page;
    const member = act.items.find((i) => i.kind === 'member')!;
    expect(member.reactions?.subject).toBe('activity');
    const stranger = await s.person();
    expect((await react(stranger, 'activity', member.id, 'like')).status).toBe(404);
    expect((await react(a, 'activity', member.id, 'like')).status).toBe(200);
    expect((await react(a, 'photo', 'Unbekannt123456789', 'like')).status).toBe(404);
    // gesperrt
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), stranger.user.id).run();
    const pub = await s.share(owner);
    expect((await react(stranger, 'share', pub.id, 'like')).status).toBe(403);
  });

  it('[F-180] „wer hat reagiert“: Namen nur öffentlicher Profile, Rest als Anzahl, keine IDs; gesperrte zählen nicht', async () => {
    const owner = await s.person();
    const share = await s.share(owner);
    const named = await s.person({ profile: 'public' });
    const hiddenProfile = await s.person({ profile: 'private', supporter: true });
    const noProfile = await s.person();
    const suspended = await s.person({ profile: 'public' });
    for (const p of [named, hiddenProfile, noProfile, suspended]) expect((await react(p, 'share', share.id, 'like')).status).toBe(200);
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), suspended.user.id).run();
    const res = await h.fetch(`/api/reactions/share/${share.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: { like: number }; people: Array<{ handle: string; kind: string }>; others: number };
    expect(body.counts.like).toBe(3);
    expect(body.people).toEqual([{ handle: named.handle, displayName: `Name ${named.handle}`, kind: 'like' }]);
    expect(body.others).toBe(2);
    const raw = JSON.stringify(body);
    for (const p of [named, hiddenProfile, noProfile, suspended]) {
      expect(raw).not.toContain(p.user.id);
      expect(raw).not.toContain(p.email);
    }
    expect(raw).not.toContain(suspended.handle!);
  });

  it('[F-179] höchstens 300 Änderungen pro Konto und Tag (429 reaction_quota)', async () => {
    const owner = await s.person();
    const share = await s.share(owner);
    const a = await s.person();
    const db = await s.db();
    const now = Date.now();
    for (let i = 0; i < REACTION_LIMITS.perDay; i += 100) {
      const values = Array.from({ length: 100 }, () => `('${a.user.id}', ${now - 1000})`).join(',');
      await db.prepare(`INSERT INTO reaction_log (user_id, created_at) VALUES ${values}`).all();
    }
    const res = await react(a, 'share', share.id, 'like');
    expect(res.status).toBe(429);
    expect(await s.errorOf(res)).toBe('reaction_quota');
    // nach 24 h zählt es nicht mehr
    await db.prepare('UPDATE reaction_log SET created_at = ? WHERE user_id = ?').bind(now - 2 * DAY, a.user.id).run();
    expect((await react(a, 'share', share.id, 'like')).status).toBe(200);
  });

  it('[F-179] gecachter Gruppen-Stream: eigene Reaktion kommt nachträglich dazu, der Cache bleibt neutral', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const p = await post(owner, g, 'Cache-Test');
    const a = await s.person();
    await react(a, 'post', p.id, 'tack');
    const guest = (await (await h.fetch(`/api/groups/${g.id}/stream`)).json()) as Page;
    expect(guest.items.find((i) => i.post?.id === p.id)?.reactions).toMatchObject({ counts: { tack: 1 }, mine: null });
    const mine = (await (await s.send('GET', `/api/groups/${g.id}/stream`, a.cookie)).json()) as Page;
    expect(mine.items.find((i) => i.post?.id === p.id)?.reactions?.mine).toBe('tack');
    const again = await h.fetch(`/api/groups/${g.id}/stream`);
    expect(again.headers.get('X-Stream-Cache')).toBe('hit');
    expect(((await again.json()) as Page).items.find((i) => i.post?.id === p.id)?.reactions?.mine).toBeNull();
  });
});

describe('F-183 Rechtliches in Mails', () => {
  it('[F-183] jede Mail nennt Impressum und Datenschutz unter der konfigurierten Adresse (APP_ORIGIN)', async () => {
    const before = h.logs.length;
    await s.person();
    const mail = h.logs.slice(before).find((l) => l.includes('[mail:log]'));
    expect(mail).toBeDefined();
    expect(mail).toContain('Impressum: https://segeln.example/impressum');
    expect(mail).toContain('Datenschutz: https://segeln.example/datenschutz');
  });
});

describe('F-181 Reaktionen aufräumen', () => {
  it('[F-181] Törn und Beitrag löschen entfernt Reaktionen darauf; Konto löschen eigene und die auf eigene Inhalte', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const a = await s.person();
    const share = await s.share(owner);
    const p = await post(owner, g, 'Weg damit');
    const keep = await s.share(a);
    await react(a, 'share', share.id, 'like');
    await react(a, 'post', p.id, 'like');
    await react(owner, 'share', keep.id, 'mast');
    const db = await s.db();
    const count = async (id: string) => (await db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE subject_id = ?').bind(id).first<{ n: number }>())?.n ?? 0;
    expect(await count(share.id)).toBe(1);
    expect((await s.send('DELETE', `/api/shares/${share.id}`, owner.cookie)).status).toBe(204);
    expect(await count(share.id)).toBe(0);
    expect((await s.send('DELETE', `/api/posts/${p.id}`, owner.cookie)).status).toBe(204);
    expect(await count(p.id)).toBe(0);
    // Konto von a löschen: seine Reaktionen und die auf seine Törns verschwinden
    await react(owner, 'share', keep.id, 'mast');
    expect(await count(keep.id)).toBe(1);
    expect((await s.send('DELETE', '/api/account', a.cookie)).status).toBe(200);
    expect(await count(keep.id)).toBe(0);
    const left = await db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE user_id = ?').bind(a.user.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('[F-181] nächtlich: Reaktionen ohne Gegenstand und alte Zähler', async () => {
    const db = await s.db();
    const now = Date.now();
    const u = await s.person();
    await db.prepare(`INSERT INTO reactions (subject_kind, subject_id, user_id, kind, created_at) VALUES ('activity', 'GoneActivityAAAAAA', ?, 'like', ?)`).bind(u.user.id, now).run();
    await db.prepare('INSERT INTO reaction_log (user_id, created_at) VALUES (?, ?)').bind(u.user.id, now - 2 * DAY).run();
    await h.scheduled();
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM reactions WHERE subject_id = 'GoneActivityAAAAAA'`).first<{ n: number }>())?.n).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM reaction_log WHERE user_id = ? AND created_at < ?').bind(u.user.id, now - DAY).first<{ n: number }>())?.n).toBe(0);
  });

  it('[F-171] Moderation: Hafen melden und löschen – Boote verlieren die Zuordnung, Heimatwahl fällt', async () => {
    const creator = await s.person();
    const { harbor: hb } = await harbor(creator, `Spamhafen ${s.uniq('x')}`);
    const boat = await s.boat(creator, { harborId: hb.id });
    await s.send('PUT', '/api/me/home', creator.cookie, { harborId: hb.id });
    const reporter = await s.person();
    expect((await s.send('POST', '/api/reports', creator.cookie, { kind: 'harbor', id: hb.id, reason: 'spam', note: '' })).status).toBe(400); // eigener
    const rep = await s.send('POST', '/api/reports', reporter.cookie, { kind: 'harbor', id: hb.id, reason: 'spam', note: '' });
    expect(rep.status, await rep.clone().text()).toBe(201);
    const { reports } = (await (await s.send('GET', '/api/admin/reports', admin.cookie)).json()) as { reports: Array<{ id: string; kind: string; targetId: string; target: { path: string } }> };
    const r = reports.find((x) => x.kind === 'harbor' && x.targetId === hb.id)!;
    expect(r.target.path).toBe(`/h/${hb.slug}`);
    expect((await s.send('POST', `/api/admin/reports/${r.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect((await h.fetch(`/api/harbors/slug/${hb.slug}`)).status).toBe(404);
    const after = (await (await s.send('GET', `/api/boats/${boat.id}`, creator.cookie)).json()) as { boat: { harbor: unknown; homePort: string } };
    expect(after.boat).toMatchObject({ harbor: null, homePort: '' });
    const home = (await (await s.send('GET', '/api/me/home', creator.cookie)).json()) as { harbor: unknown };
    expect(home.harbor).toBeNull();
  });
});
