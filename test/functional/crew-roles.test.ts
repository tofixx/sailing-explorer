// Funktionale Tests: Rollen am Törn und Bestätigung durch den Skipper (F-275 … F-280, Konzept Abschnitt 15).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, startWorker, type Harness } from './worker-harness';
import { canSetCrewRole, voyageRole } from '../../src/domain/crew-roles';
import { inviteWhat } from '../../src/domain/invite-text';

let h: Harness;
let n = 0;
const email = () => `r${++n}-${Date.now()}@example.org`;
const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string | undefined, body?: unknown) =>
  h.fetch(path, { method, cookie, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
const getJson = async <T>(res: Response) => (await res.json()) as T;
const tokenOf = (link: string) => /#token=([A-Za-z0-9_-]+)$/.exec(link)![1];

interface Person { cookie: string; user: { id: string; email: string }; email: string }
async function person(profile: 'public' | null = 'public'): Promise<Person> {
  const mail = email();
  const s = await login(h, mail);
  if (profile) {
    const handle = uniq('rolle');
    expect((await send('PUT', '/api/me/profile', s.cookie, { handle, displayName: `Name ${handle}`, bio: '', visibility: 'public' })).status).toBe(200);
  }
  return { ...s, email: mail };
}
async function newShare(cookie: string): Promise<string> {
  const res = await createShare(h, cookie, { visibility: 'public', title: 'Havel-Törn' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { share: { id: string } }).share.id;
}
/** Lädt per Link ein (optional mit Rolle) und lässt `mate` annehmen. */
async function join(owner: Person, shareId: string, mate: Person, role?: string) {
  const res = await send('POST', `/api/shares/${shareId}/invites`, owner.cookie, role ? { role } : {});
  expect(res.status, await res.clone().text()).toBe(201);
  const { link } = await getJson<{ link: string }>(res);
  expect((await send('POST', '/api/invites/accept', mate.cookie, { token: tokenOf(link) })).status).toBe(200);
}

interface Conf { at: number; by: string | null }
interface CrewOut {
  members: Array<{ id: string | null; displayName: string; role: string; confirmed: Conf | null }>;
  others: number;
  isSkipper: boolean;
  ownerRole: string | null;
  ownerConfirmed: Conf | null;
  me: { role: string; confirmed: Conf | null } | null;
}
const crew = async (shareId: string, p?: Person) => getJson<CrewOut>(await h.fetch(`/api/shares/${shareId}/crew`, { cookie: p?.cookie }));
const roleOf = async (shareId: string, userId: string) =>
  (await (await h.db()).prepare('SELECT role, confirmed_at, confirmed_by FROM share_crew WHERE share_id = ? AND user_id = ?').bind(shareId, userId).first<{ role: string; confirmed_at: number | null; confirmed_by: string | null }>())!;
const setRole = (p: Person, shareId: string, who: string, role: unknown) => send('PUT', `/api/shares/${shareId}/crew/${who}/role`, p.cookie, { role });
const setOwnerRole = (p: Person, shareId: string, role: unknown) => send('PUT', `/api/shares/${shareId}/role`, p.cookie, { role });
const confirm = (p: Person, shareId: string, userIds: string[] | 'all', owner = false) => send('POST', `/api/shares/${shareId}/confirm`, p.cookie, { userIds, owner });

describe('F-275 Rollen am Törn', () => {
  it('[F-275] Regeln: Eigentümer setzt alles, Crew nur die eigene Rolle und nie Skipper; Unbekanntes gilt als Crew', () => {
    expect(canSetCrewRole({ isOwner: true, isSelf: false }, 'skipper')).toBe(true);
    expect(canSetCrewRole({ isOwner: false, isSelf: true }, 'guest')).toBe(true);
    expect(canSetCrewRole({ isOwner: false, isSelf: true }, 'skipper')).toBe(false);
    expect(canSetCrewRole({ isOwner: false, isSelf: false }, 'crew')).toBe(false);
    expect(voyageRole('kapitaen')).toBe('crew');
    expect(inviteWhat({ kind: 'crew', target: 'Havel', role: 'guest' })).toBe('ein, als Gast in die Crew des Törns „Havel“');
  });

  it('[F-275] Einladung mit Rolle: Peek und Mail nennen sie, Annehmen setzt sie; Skipper lässt sich nicht vorgeben', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    expect((await send('POST', `/api/shares/${id}/invites`, owner.cookie, { role: 'skipper' })).status).toBe(400);
    const guest = await person();
    const res = await send('POST', `/api/shares/${id}/invites`, owner.cookie, { role: 'guest' });
    const { link } = await getJson<{ link: string }>(res);
    expect((await getJson<{ role: string }>(await send('POST', '/api/invites/peek', guest.cookie, { token: tokenOf(link) }))).role).toBe('guest');
    expect((await send('POST', '/api/invites/accept', guest.cookie, { token: tokenOf(link) })).status).toBe(200);
    expect((await roleOf(id, guest.user.id)).role).toBe('guest');

    const mailed = email();
    expect((await send('POST', `/api/shares/${id}/invites`, owner.cookie, { email: mailed, role: 'co' })).status).toBe(201);
    expect(h.logs.find((l) => l.includes(`an ${mailed}:`))).toContain('als Co-Skipper:in in die Crew');
  });

  it('[F-275] Eigentümer setzt Rollen, Crew die eigene; Fremde 404, Crew nie Skipper (403), unbekannte Rolle 400', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const a = await person();
    const b = await person();
    await join(owner, id, a);
    await join(owner, id, b);
    expect((await setRole(owner, id, a.user.id, 'co')).status).toBe(200);
    expect((await roleOf(id, a.user.id)).role).toBe('co');
    expect((await setRole(a, id, 'me', 'guest')).status).toBe(200);
    expect((await roleOf(id, a.user.id)).role).toBe('guest');
    expect((await setRole(a, id, 'me', 'skipper')).status).toBe(403);
    expect((await setRole(a, id, b.user.id, 'co')).status).toBe(404);
    expect((await setRole(owner, id, a.user.id, 'kapitaen')).status).toBe(400);
    const stranger = await person();
    expect((await setRole(stranger, id, 'me', 'crew')).status).toBe(404);
    expect((await setOwnerRole(a, id, 'skipper')).status).toBe(404);
  });

  it('[F-275] Höchstens ein Skipper – Crew oder Eigentümer (409 skipper_taken)', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const a = await person();
    const b = await person();
    await join(owner, id, a);
    await join(owner, id, b);
    expect((await setRole(owner, id, a.user.id, 'skipper')).status).toBe(200);
    const taken = await setRole(owner, id, b.user.id, 'skipper');
    expect(taken.status).toBe(409);
    expect((await getJson<{ error: string }>(taken)).error).toBe('skipper_taken');
    expect((await setOwnerRole(owner, id, 'skipper')).status).toBe(409);
    expect((await setRole(a, id, 'me', 'co')).status).toBe(200); // Skipper tritt selbst zurück
    expect((await setOwnerRole(owner, id, 'skipper')).status).toBe(200);
    expect((await setRole(owner, id, b.user.id, 'skipper')).status).toBe(409);
    expect((await crew(id, owner)).ownerRole).toBe('skipper');
  });
});

describe('F-276 Bestätigung durch den Skipper', () => {
  it('[F-276] Skipper bestätigt alle; Crew sieht ihre Bestätigung, Besucher nie; neue Rolle hebt sie auf', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const a = await person();
    const b = await person();
    await join(owner, id, a, 'co');
    await join(owner, id, b);
    expect((await confirm(owner, id, 'all')).status).toBe(403); // ohne Rolle kein Skipper
    await setOwnerRole(owner, id, 'skipper');
    expect((await confirm(a, id, [b.user.id])).status).toBe(403); // nur der Skipper
    expect((await confirm(owner, id, 'all')).status).toBe(200);
    expect((await roleOf(id, a.user.id)).confirmed_by).toBe(owner.user.id);
    const mine = await crew(id, a);
    expect(mine.me).toMatchObject({ role: 'co', confirmed: { by: expect.stringContaining('Name ') } });
    expect(mine.members.every((m) => m.confirmed === null)).toBe(true);
    const visitor = await crew(id);
    expect(visitor.members.map((m) => m.role).sort()).toEqual(['co', 'crew']);
    expect(visitor.members.every((m) => m.id === null && m.confirmed === null)).toBe(true);
    expect(visitor.ownerConfirmed).toBeNull();

    await setRole(a, id, 'me', 'guest');
    expect((await roleOf(id, a.user.id)).confirmed_at).toBeNull();
    expect((await roleOf(id, b.user.id)).confirmed_at).not.toBeNull();
    expect((await send('DELETE', `/api/shares/${id}/confirm/${b.user.id}`, owner.cookie)).status).toBe(204);
    expect((await roleOf(id, b.user.id)).confirmed_at).toBeNull();
  });

  it('[F-276] Crew-Skipper bestätigt die Eigentümer:in; anderes Boot oder neuer Skipper hebt alle Bestätigungen auf', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const skip = await person();
    const mate = await person();
    await join(owner, id, skip);
    await join(owner, id, mate);
    await setOwnerRole(owner, id, 'co');
    await setRole(owner, id, skip.user.id, 'skipper');
    expect((await crew(id, skip)).isSkipper).toBe(true);
    expect((await confirm(skip, id, 'all', true)).status).toBe(200);
    expect((await crew(id, owner)).ownerConfirmed).not.toBeNull();
    expect((await roleOf(id, skip.user.id)).confirmed_at).toBeNull(); // nie sich selbst

    const boat = await getJson<{ boat: { id: string } }>(await send('POST', '/api/boats', owner.cookie, { name: 'Möwe', visibility: 'public' }));
    expect((await send('PATCH', `/api/shares/${id}`, owner.cookie, { boatId: boat.boat.id })).status).toBe(200);
    expect((await roleOf(id, mate.user.id)).confirmed_at).toBeNull();
    expect((await crew(id, owner)).ownerConfirmed).toBeNull();

    await confirm(skip, id, 'all', true);
    await setRole(owner, id, skip.user.id, 'crew');
    expect((await roleOf(id, mate.user.id)).confirmed_at).toBeNull();
  });
});

describe('F-279 Löschen von Rollen und Bestätigungen', () => {
  it('[F-279] Skipper verlässt die Crew → Bestätigungen fallen; Konto des Skippers gelöscht → Bestätigung bleibt ohne Konto-ID', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const skip = await person();
    const mate = await person();
    await join(owner, id, skip);
    await join(owner, id, mate);
    await setRole(owner, id, skip.user.id, 'skipper');
    await confirm(skip, id, 'all');
    expect((await send('DELETE', `/api/shares/${id}/crew/me`, skip.cookie)).status).toBe(204);
    expect((await roleOf(id, mate.user.id)).confirmed_at).toBeNull();

    const id2 = await newShare(owner.cookie);
    const skip2 = await person();
    await join(owner, id2, skip2);
    await join(owner, id2, mate);
    await setRole(owner, id2, skip2.user.id, 'skipper');
    await setOwnerRole(owner, id2, 'co');
    await confirm(skip2, id2, 'all', true);
    expect((await send('DELETE', '/api/account', skip2.cookie)).status).toBe(200);
    const after = await roleOf(id2, mate.user.id);
    expect(after.confirmed_at).not.toBeNull();
    expect(after.confirmed_by).toBeNull();
    const shareRow = await (await h.db()).prepare('SELECT role_confirmed_at, role_confirmed_by FROM shares WHERE id = ?').bind(id2).first<{ role_confirmed_at: number; role_confirmed_by: string | null }>();
    expect(shareRow).toMatchObject({ role_confirmed_by: null });
    expect(shareRow!.role_confirmed_at).toBeGreaterThan(0);
    expect((await crew(id2, mate)).me?.confirmed).toMatchObject({ by: null });
  });

  it('[F-279] Boot löschen hebt die Bestätigungen seiner Törns auf', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const mate = await person();
    await join(owner, id, mate);
    const boat = await getJson<{ boat: { id: string } }>(await send('POST', '/api/boats', owner.cookie, { name: 'Lütte', visibility: 'public' }));
    expect((await send('PATCH', `/api/shares/${id}`, owner.cookie, { boatId: boat.boat.id })).status).toBe(200);
    await setOwnerRole(owner, id, 'skipper');
    await confirm(owner, id, 'all');
    expect((await roleOf(id, mate.user.id)).confirmed_at).not.toBeNull();
    expect((await send('DELETE', `/api/boats/${boat.boat.id}`, owner.cookie)).status).toBe(204);
    expect((await roleOf(id, mate.user.id)).confirmed_at).toBeNull();
  });
});

describe('F-276 Grenzen der neuen Endpunkte', () => {
  it('[F-276] ungültige Liste → 400; ausgeblendeter Törn → 404; ohne Rolle wird die Eigentümer:in nicht bestätigt', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const skip = await person();
    await join(owner, id, skip);
    await setRole(owner, id, skip.user.id, 'skipper');
    expect((await confirm(skip, id, 5 as unknown as string[])).status).toBe(400);
    expect((await confirm(skip, id, 'all', true)).status).toBe(200);
    expect((await crew(id, owner)).ownerConfirmed).toBeNull(); // owner_role NULL: nichts zu bestätigen
    await (await h.db()).prepare('UPDATE shares SET hidden_at = ? WHERE id = ?').bind(Date.now(), id).run();
    expect((await setRole(skip, id, 'me', 'co')).status).toBe(404);
    expect((await confirm(skip, id, 'all')).status).toBe(404);
  });

  it('[F-276] Crew-Skipper sieht private Mitglieder nur mit Spaßnamen, die Eigentümer:in mit Anzeigenamen', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const skip = await person();
    const shy = await login(h, email());
    await (await h.db()).prepare(`INSERT INTO profiles (user_id, handle, display_name, bio, visibility, created_at, updated_at) VALUES (?, ?, 'Geheimer Name', '', 'private', 0, 0)`)
      .bind(shy.user.id, uniq('shy')).run();
    await join(owner, id, skip);
    await join(owner, id, { ...shy, email: shy.user.email });
    await setRole(owner, id, skip.user.id, 'skipper');
    const bySkipper = (await crew(id, skip)).members.find((m) => m.id === shy.user.id)!;
    expect(bySkipper.displayName).not.toBe('Geheimer Name');
    expect((await crew(id, owner)).members.find((m) => m.id === shy.user.id)!.displayName).toBe('Geheimer Name');
  });
});

describe('F-280 Rollen öffentlich nur neben Namen', () => {
  it('[F-280] Besucher sehen Rollen nur bei Mitgliedern mit öffentlichem Profil; „Mitgesegelt“ nennt die Rolle', async () => {
    const owner = await person();
    const id = await newShare(owner.cookie);
    const named = await person();
    const hidden = await person(null);
    await join(owner, id, named, 'guest');
    await join(owner, id, hidden, 'co');
    const visitor = await crew(id);
    expect(visitor.members).toEqual([expect.objectContaining({ id: null, role: 'guest' })]);
    expect(visitor.others).toBe(1);
    const handle = (await (await h.db()).prepare('SELECT handle FROM profiles WHERE user_id = ?').bind(named.user.id).first<{ handle: string }>())!.handle;
    const page = await getJson<{ crewVoyages: Array<{ id: string; crewRole: string }> }>(await h.fetch(`/api/profiles/${handle}`));
    expect(page.crewVoyages.find((v) => v.id === id)?.crewRole).toBe('guest');
  });
});
