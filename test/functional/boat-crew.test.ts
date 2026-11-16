// Funktionale Tests: Stammcrew eines Boots (F-270 … F-274, Konzept 41).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { canInviteToCrew, canPostOnBoat, cleanCrewTitle, crewRights } from '../../src/domain/boat-crew';
import { boatChoices } from '../../src/services/boat-crew-api';

const ADMIN_ID = 'BoatCrewAdminAAAAA';
const ADMIN_MAIL = 'stammcrew-admin@example.org';
const DAY = 86_400_000;

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  admin = { ...(await login(h, ADMIN_MAIL)), email: ADMIN_MAIL };
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const tokenOf = (link: string) => /#token=([A-Za-z0-9_-]+)$/.exec(link)![1];
const one = async <T>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const isCrew = async (boatId: string, userId: string) => !!(await one('SELECT 1 AS x FROM boat_crew WHERE boat_id = ? AND user_id = ?', boatId, userId));

interface CrewOut {
  standing: string | null;
  rights: { post: boolean; invite: boolean; assign: string };
  canInvite: boolean;
  canPost: boolean;
  members: Array<{ id: string | null; handle: string | null; displayName: string; title: string; isSelf: boolean }>;
  others: number;
}
const crewOf = async (boatId: string, p?: Person) => (await s.send('GET', `/api/boats/${boatId}/crew`, p?.cookie));

/** Lädt per Link zur Stammcrew ein und lässt `who` annehmen. */
async function joinCrew(inviter: Person, boatId: string, who: Person) {
  const res = await s.send('POST', `/api/boats/${boatId}/crew/invites`, inviter.cookie, {});
  expect(res.status, await res.clone().text()).toBe(201);
  const { link } = (await res.json()) as { link: string };
  const acc = await s.send('POST', '/api/invites/accept', who.cookie, { token: tokenOf(link) });
  expect(acc.status, await acc.clone().text()).toBe(200);
}
const rights = (p: Person, boatId: string, body: unknown) => s.send('PUT', `/api/boats/${boatId}/crew-rights`, p.cookie, body);

describe('F-270 Stammcrew: einladen, Liste, Titel, austreten', () => {
  it('[F-270] Regeln: Schalter, Titel, Auswahl der Boote', () => {
    expect(crewRights({ crew_post: 1, crew_invite: 0, crew_assign: 'unbekannt' })).toEqual({ post: true, invite: false, assign: 'crew' });
    expect(canPostOnBoat('crew', { post: false })).toBe(false);
    expect(canPostOnBoat('admin', { post: false })).toBe(true);
    expect(canInviteToCrew('crew', { invite: true })).toBe(true);
    expect(canInviteToCrew(null, { invite: true })).toBe(false);
    expect(cleanCrewTitle('  Vor\u0007schoterin ')).toBe('Vor schoterin');
    expect(cleanCrewTitle('x'.repeat(41))).toBeNull();
    expect(boatChoices({ boats: [{ id: 'A', name: 'a' }], assignable: [{ id: 'A', name: 'a' }, { id: 'B', name: 'b' }] }).map((b) => b.id)).toEqual(['A', 'B']);
  });

  it('[F-270] Eigner lädt per Link ein; Stammcrew ist kein Verwalter; Besucher sehen nur öffentliche Profile', async () => {
    const owner = await s.person({ profile: 'public' });
    const boat = await s.boat(owner, { name: 'Lütte Deern' });
    const named = await s.person({ profile: 'public' });
    const shy = await s.person();
    await joinCrew(owner, boat.id, named);
    await joinCrew(owner, boat.id, shy);
    expect(await isCrew(boat.id, named.user.id)).toBe(true);
    // Stammcrew verwaltet nichts: Boot bearbeiten 404, Admins-Liste 404
    expect((await s.send('PATCH', `/api/boats/${boat.id}`, named.cookie, { name: 'Gekapert' })).status).toBe(404);
    expect((await s.send('GET', `/api/boats/${boat.id}/admins`, named.cookie)).status).toBe(404);
    // Besucher: ein Name, eine Person als Anzahl, keine IDs
    const visitor = (await (await crewOf(boat.id)).json()) as CrewOut;
    expect(visitor.members).toHaveLength(1);
    expect(visitor.members[0]).toMatchObject({ id: null, handle: expect.any(String) });
    expect(visitor.others).toBe(1);
    expect(visitor.standing).toBeNull();
    // Eigner: alle mit IDs
    const mine = (await (await crewOf(boat.id, owner)).json()) as CrewOut;
    expect(mine.members.map((m) => m.id).sort()).toEqual([named.user.id, shy.user.id].sort());
    expect(mine.standing).toBe('owner');
    // Peek nennt die Art
    const res = await s.send('POST', `/api/boats/${boat.id}/crew/invites`, owner.cookie, {});
    const { link } = (await res.json()) as { link: string };
    expect(((await (await s.send('POST', '/api/invites/peek', undefined, { token: tokenOf(link) })).json()) as { kind: string }).kind).toBe('boat_member');
  });

  it('[F-270] Stammcrew lädt nur mit Schalter ein; Fremde nie; Verwalter verbrauchen beim Annehmen nichts', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const crew = await s.person();
    await joinCrew(owner, boat.id, crew);
    expect((await s.send('POST', `/api/boats/${boat.id}/crew/invites`, crew.cookie, {})).status).toBe(403);
    expect((await rights(owner, boat.id, { invite: true })).status).toBe(200);
    const friend = await s.person();
    await joinCrew(crew, boat.id, friend);
    expect(await isCrew(boat.id, friend.user.id)).toBe(true);
    const stranger = await s.person();
    expect((await s.send('POST', `/api/boats/${boat.id}/crew/invites`, stranger.cookie, {})).status).toBe(404);
    // der Eigner nimmt eine Stammcrew-Einladung an: schon dabei, nichts verbraucht
    const res = await s.send('POST', `/api/boats/${boat.id}/crew/invites`, crew.cookie, {});
    const { link } = (await res.json()) as { link: string };
    expect(((await (await s.send('POST', '/api/invites/accept', owner.cookie, { token: tokenOf(link) })).json()) as { already: boolean }).already).toBe(true);
    expect(await isCrew(boat.id, owner.user.id)).toBe(false);
  });

  it('[F-270] Titel: Verwalter für alle, Stammcrew nur für sich; austreten und entfernen', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const a = await s.person();
    const b = await s.person();
    await joinCrew(owner, boat.id, a);
    await joinCrew(owner, boat.id, b);
    expect((await s.send('PATCH', `/api/boats/${boat.id}/crew/${a.user.id}`, owner.cookie, { title: 'Vorschoterin' })).status).toBe(200);
    expect((await s.send('PATCH', `/api/boats/${boat.id}/crew/me`, b.cookie, { title: 'Smut' })).status).toBe(200);
    expect((await s.send('PATCH', `/api/boats/${boat.id}/crew/${a.user.id}`, b.cookie, { title: 'x' })).status).toBe(403);
    expect((await s.send('PATCH', `/api/boats/${boat.id}/crew/me`, b.cookie, { title: 'x'.repeat(41) })).status).toBe(400);
    expect(await one<{ title: string }>('SELECT title FROM boat_crew WHERE boat_id = ? AND user_id = ?', boat.id, a.user.id)).toEqual({ title: 'Vorschoterin' });
    expect((await s.send('DELETE', `/api/boats/${boat.id}/crew/${a.user.id}`, b.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/boats/${boat.id}/crew/me`, b.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/boats/${boat.id}/crew/${a.user.id}`, owner.cookie)).status).toBe(204);
    expect(await one('SELECT 1 AS x FROM boat_crew WHERE boat_id = ?', boat.id)).toBeNull();
  });

  it('[F-270] Schalter stellt nur der Eigner; Admins nicht (403), Stammcrew nicht (403), unbekannte Stufe 400', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const crew = await s.person();
    await joinCrew(owner, boat.id, crew);
    await (await s.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(boat.id, admin.user.id, Date.now()).run();
    expect((await rights(admin, boat.id, { post: true })).status).toBe(403);
    expect((await rights(crew, boat.id, { post: true })).status).toBe(403);
    expect((await rights(owner, boat.id, { assign: 'alle' })).status).toBe(400);
    expect((await rights(owner, boat.id, { post: true, assign: 'clubs' })).status).toBe(200);
    expect(await one('SELECT crew_post, crew_invite, crew_assign FROM boats WHERE id = ?', boat.id)).toEqual({ crew_post: 1, crew_invite: 0, crew_assign: 'clubs' });
  });
});

describe('F-271 Beiträge am Boot', () => {
  it('[F-271] Stammcrew schreibt nur mit Schalter; der Verlauf bietet das Boot dann zum Schreiben an', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const crew = await s.person();
    await joinCrew(owner, boat.id, crew);
    const post = () => s.send('POST', '/api/posts', crew.cookie, { channel: { kind: 'boat', id: boat.id }, kind: 'text', body: 'Kranen am Samstag', visibility: 'public' });
    expect((await post()).status).toBe(403);
    expect((await rights(owner, boat.id, { post: true })).status).toBe(200);
    const res = await post();
    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await (await crewOf(boat.id, crew)).json()) as CrewOut).canPost).toBe(true);
  });
});

describe('F-271 Stammcrew wird benachrichtigt wie Verwalter', () => {
  it('[F-271] Beitrag am Boot: die Stammcrew gehört zum Publikum wie Boots-Admins (gleiche Voreinstellung)', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const crew = await s.person();
    const boatAdmin = await s.person();
    await joinCrew(owner, boat.id, crew);
    await (await s.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(boat.id, boatAdmin.user.id, Date.now()).run();
    const stranger = await s.person();
    const res = await s.send('POST', '/api/posts', owner.cookie, { channel: { kind: 'boat', id: boat.id }, kind: 'text', body: 'Saisonstart am Samstag', visibility: 'public' });
    expect(res.status, await res.clone().text()).toBe(201);
    const { post } = (await res.json()) as { post: { id: string } };
    const notes = async (p: Person) => (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND subject_id = ?`, p.user.id, post.id))!.n;
    expect(await notes(crew)).toBe(await notes(boatAdmin));
    expect(await notes(stranger)).toBe(0);
  });
});

describe('F-272 Törns dem Boot zuordnen', () => {
  it('[F-272] Stammcrew ordnet zu; Vereinsmitglieder ab „clubs“; Folgende ab „anyone“ (Konto ≥ 7 Tage); sonst 400', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner, { visibility: 'public' });
    const crew = await s.person();
    await joinCrew(owner, boat.id, crew);
    const sh = await s.share(crew);
    const assign = (p: Person, id: string) => s.send('PATCH', `/api/shares/${id}`, p.cookie, { boatId: boat.id });
    expect((await assign(crew, sh.id)).status).toBe(200);
    expect(((await (await s.send('GET', '/api/boats', crew.cookie)).json()) as { assignable: Array<{ id: string }> }).assignable.map((b) => b.id)).toContain(boat.id);

    // Vereinsmitglied
    const club = await s.group(owner);
    expect((await s.send('POST', `/api/groups/${club.id}/boats`, owner.cookie, { boatId: boat.id })).status).toBeLessThan(300);
    const member = await s.person();
    await s.join(owner, club, member);
    const mShare = await s.share(member);
    expect((await assign(member, mShare.id)).status).toBe(400);
    await rights(owner, boat.id, { assign: 'clubs' });
    expect((await assign(member, mShare.id)).status).toBe(200);

    // Folgende (Charter): Konto muss mindestens 7 Tage alt sein
    const guest = await s.person();
    expect((await s.send('PUT', `/api/follows/boat/${boat.id}`, guest.cookie)).status).toBeLessThan(300);
    const gShare = await s.share(guest);
    await rights(owner, boat.id, { assign: 'anyone' });
    await (await s.db()).prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(Date.now(), guest.user.id).run();
    expect((await assign(guest, gShare.id)).status).toBe(400);
    await (await s.db()).prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(Date.now() - 8 * DAY, guest.user.id).run();
    expect((await assign(guest, gShare.id)).status).toBe(200);

    // enger gestellt: bestehende Zuordnung bleibt, Speichern anderer Felder klappt weiter
    await rights(owner, boat.id, { assign: 'crew' });
    expect((await s.send('PATCH', `/api/shares/${gShare.id}`, guest.cookie, { boatId: boat.id, title: 'Charterwoche' })).status).toBe(200);
  });
});

describe('F-273 Stammcrew sieht ihr Boot', () => {
  it('[F-273] „Nur ich“: Stammcrew sieht Bootsseite und Verlauf, Fremde 404 – auch nach dem Abruf der Stammcrew', async () => {
    const owner = await s.person({ supporter: true });
    const boat = await s.boat(owner, { visibility: 'private' });
    const crew = await s.person();
    await joinCrew(owner, boat.id, crew);
    expect((await s.send('GET', `/api/boats/${boat.id}`, crew.cookie)).status).toBe(200);
    expect((await s.send('GET', `/api/boats/${boat.id}/stream`, crew.cookie)).status).toBe(200);
    expect((await s.send('GET', `/api/boats/${boat.id}/stream`, undefined)).status).toBe(404);
    expect((await s.send('GET', `/api/boats/${boat.id}`, undefined)).status).toBe(404);
    expect((await crewOf(boat.id)).status).toBe(404);
  });
});

describe('F-274 Zuordnung lösen', () => {
  it('[F-274] Eigner und Admins lösen fremde Zuordnungen, die Stammcrew nicht; der Törn bleibt', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const crew = await s.person();
    await joinCrew(owner, boat.id, crew);
    const sh = await s.share(crew);
    expect((await s.send('PATCH', `/api/shares/${sh.id}`, crew.cookie, { boatId: boat.id })).status).toBe(200);
    expect((await s.send('DELETE', `/api/boats/${boat.id}/shares/${sh.id}`, crew.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/boats/${boat.id}/shares/${sh.id}`, owner.cookie)).status).toBe(204);
    expect(await one('SELECT boat_id FROM shares WHERE id = ?', sh.id)).toEqual({ boat_id: null });
    expect((await s.send('DELETE', `/api/boats/${boat.id}/shares/${sh.id}`, owner.cookie)).status).toBe(404);
  });
});

describe('F-270 Löschwege der Stammcrew', () => {
  it('[F-270] Boot löschen, Konto der Stammcrew löschen, Konto des Eigners löschen', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const crew = await s.person();
    await joinCrew(owner, boat.id, crew);
    expect((await s.send('DELETE', `/api/boats/${boat.id}`, owner.cookie)).status).toBe(204);
    expect(await one('SELECT 1 AS x FROM boat_crew WHERE boat_id = ?', boat.id)).toBeNull();

    const boat2 = await s.boat(owner);
    await joinCrew(owner, boat2.id, crew);
    expect((await s.send('DELETE', '/api/account', crew.cookie)).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM boat_crew WHERE user_id = ?', crew.user.id)).toBeNull();

    const other = await s.person();
    await joinCrew(owner, boat2.id, other);
    expect((await s.send('DELETE', '/api/account', owner.cookie)).status).toBe(200);
    expect(await one('SELECT 1 AS x FROM boat_crew WHERE boat_id = ?', boat2.id)).toBeNull();
  });

  it('[F-270] Konten zusammenführen und Eigner-Wechsel durch die Moderation', async () => {
    const owner = await s.person();
    const boat = await s.boat(owner);
    const from = await s.person();
    const into = await s.person();
    await joinCrew(owner, boat.id, from);
    await joinCrew(owner, boat.id, into);
    const merged = await s.send('POST', `/api/admin/users/${from.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: from.user.id });
    expect(merged.status, await merged.clone().text()).toBe(200);
    expect(await isCrew(boat.id, into.user.id)).toBe(true);
    expect(await one('SELECT 1 AS x FROM boat_crew WHERE user_id = ?', from.user.id)).toBeNull();

    // Stammcrew wird Eigner: kein doppelter Eintrag
    const moved = await s.send('POST', `/api/admin/boats/${boat.id}/owner`, admin.cookie, { userId: into.user.id });
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(await isCrew(boat.id, into.user.id)).toBe(false);
  });
});
