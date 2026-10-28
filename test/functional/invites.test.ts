// Funktionale Tests: Einladungen – Boots-Admins per E-Mail und Crew auf einem Törn (F-130 … F-141, Konzept Abschnitt 10).
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, loginSupporter, startWorker, type Harness } from './worker-harness';
import { funnyName } from '../../src/domain/names';

let h: Harness;
let n = 0;
const email = (tag = 'i') => `${tag}${++n}-${Date.now()}@example.org`;
const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string | undefined, body?: unknown, extra: { origin?: string | null } = {}) =>
  h.fetch(path, { method, cookie, ...extra, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
const getJson = async <T>(res: Response) => (await res.json()) as T;
const tokenOf = (link: string) => /#token=([A-Za-z0-9_-]+)$/.exec(link)![1];

interface Person { cookie: string; user: { id: string; email: string }; email: string; handle?: string }

async function person(o: { profile?: 'public' | 'unlisted' | 'private' | null; supporter?: boolean } = {}): Promise<Person> {
  const mail = email();
  const s = o.supporter || (o.profile && o.profile !== 'public') ? await loginSupporter(h, mail) : await login(h, mail);
  if (o.profile === null || o.profile === undefined) return { ...s, email: mail };
  const handle = uniq('crew');
  const res = await send('PUT', '/api/me/profile', s.cookie, { handle, displayName: `Name ${handle}`, bio: '', visibility: o.profile });
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...s, email: mail, handle };
}

async function newBoat(cookie: string, name = 'Seeschwalbe'): Promise<{ id: string }> {
  const res = await send('POST', '/api/boats', cookie, { name, visibility: 'public' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { boat: { id: string } }).boat;
}

async function newShare(cookie: string, visibility = 'public', title = 'Ostsee-Törn'): Promise<{ id: string; shareKey: string | null }> {
  const res = await createShare(h, cookie, { visibility, title });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string; shareKey: string | null } }).share;
}

interface InviteOut { invite: { id: string; email: string | null; usesLeft: number; expiresAt: number }; link?: string; devLink?: string }
async function inviteAdmin(owner: Person, boatId: string, to: string): Promise<InviteOut> {
  const res = await send('POST', `/api/boats/${boatId}/invites`, owner.cookie, { email: to });
  expect(res.status, await res.clone().text()).toBe(201);
  return getJson<InviteOut>(res);
}
async function inviteCrew(owner: Person, shareId: string, to?: string): Promise<InviteOut> {
  const res = await send('POST', `/api/shares/${shareId}/invites`, owner.cookie, to ? { email: to } : {});
  expect(res.status, await res.clone().text()).toBe(201);
  return getJson<InviteOut>(res);
}
const accept = (p: Person | undefined, token: string) => send('POST', '/api/invites/accept', p?.cookie, { token });
const peek = (p: Person | undefined, token: string) => send('POST', '/api/invites/peek', p?.cookie, { token });

interface CrewOut { members: Array<{ id: string | null; handle: string | null; displayName: string }>; others: number; isOwner: boolean; isCrew: boolean; invites: Array<{ id: string; email: string | null }> }
const crewOf = async (shareId: string, p?: Person, key?: string | null) =>
  h.fetch(`/api/shares/${shareId}/crew`, { cookie: p?.cookie, headers: key ? { 'X-Share-Key': key } : undefined });

// ---------------------------------------------------------------- F-130 Boots-Admins einladen

describe('F-130 Boots-Admins per E-Mail einladen', () => {
  it('[F-130] Eigner lädt ein → Mail mit Link /einladung#token=…, Eingeladener sieht die Einladung, nimmt an und verwaltet das Boot', async () => {
    const owner = await person({ profile: 'public' });
    const boat = await newBoat(owner.cookie, 'Albatros');
    const admin = await person();
    const out = await inviteAdmin(owner, boat.id, admin.email.toUpperCase());
    expect(out.invite).toMatchObject({ email: admin.email, usesLeft: 1 });
    expect(out.invite.expiresAt - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(out.invite.expiresAt - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
    expect(out.devLink).toMatch(/^http:\/\/localhost\/einladung#token=[A-Za-z0-9_-]{40,64}$/);
    const mail = h.logs.find((l) => l.includes(`an ${admin.email}:`) && l.includes('Albatros'));
    expect(mail).toBeDefined();
    expect(mail).toContain('Einladung als Admin');
    expect(mail).toContain(`Name ${owner.handle}`);
    expect(mail).toContain(out.devLink);

    const token = tokenOf(out.devLink!);
    const pk = await getJson<Record<string, unknown>>(await peek(admin, token));
    expect(pk).toMatchObject({ kind: 'boat_admin', target: 'Albatros', inviter: `Name ${owner.handle}`, bound: true, emailMatches: true, isOwner: false, alreadyMember: false });
    expect(JSON.stringify(pk)).not.toContain('@'); // keine Adresse, auch nicht maskiert

    const res = await accept(admin, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'boat_admin', path: `/b/${boat.id}`, target: 'Albatros', already: false });

    const mine = await getJson<{ boats: Array<{ id: string; role: string }> }>(await send('GET', '/api/boats', admin.cookie));
    expect(mine.boats.find((b) => b.id === boat.id)?.role).toBe('admin');
    expect((await send('PATCH', `/api/boats/${boat.id}`, admin.cookie, { homePort: 'Stralsund' })).status).toBe(200);
    // Admins dürfen eigene Törns dem Boot zuordnen (F-43)
    expect((await createShare(h, admin.cookie, { headers: { 'X-Share-Boat': boat.id } })).status).toBe(201);
  });

  it('[F-130] Token liegt nur gehasht in D1 und funktioniert nur einmal', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const admin = await person();
    const token = tokenOf((await inviteAdmin(owner, boat.id, admin.email)).devLink!);
    const db = await h.db();
    expect(await db.prepare('SELECT 1 FROM invites WHERE token_hash = ?').bind(token).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM invites WHERE token_hash LIKE ? AND length(token_hash) = 64").bind('%').first()).not.toBeNull();
    expect((await accept(admin, token)).status).toBe(200);
    // Zweites Mal: schon Admin, aber die Einladung ist aufgebraucht
    const again = await accept(admin, token);
    expect(again.status).toBe(400);
    expect((await getJson<{ error: string }>(again)).error).toBe('invalid_invite');
  });

  it('[F-130] Liste: Admins mit Namen (sonst Spaßname), nie mit Adresse; offene Einladungen nur für den Eigner', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const a = await person({ profile: 'public' });
    const b = await person(); // ohne Profil
    const pending = email();
    expect((await accept(a, tokenOf((await inviteAdmin(owner, boat.id, a.email)).devLink!))).status).toBe(200);
    expect((await accept(b, tokenOf((await inviteAdmin(owner, boat.id, b.email)).devLink!))).status).toBe(200);
    await inviteAdmin(owner, boat.id, pending);

    const res = await send('GET', `/api/boats/${boat.id}/admins`, owner.cookie);
    const raw = await res.clone().text();
    const asOwner = await getJson<{ role: string; admins: Array<Record<string, unknown>>; invites: Array<Record<string, unknown>> }>(res);
    expect(asOwner.role).toBe('owner');
    expect(asOwner.admins).toEqual([
      { id: a.user.id, displayName: `Name ${a.handle}`, handle: a.handle, isSelf: false, createdAt: expect.any(Number) },
      { id: b.user.id, displayName: funnyName(b.user.id), handle: null, isSelf: false, createdAt: expect.any(Number) },
    ]);
    expect(raw).not.toContain(a.email);
    expect(raw).not.toContain(b.email);
    // Die offene Einladung zeigt nur die Adresse, die der Eigner selbst eingegeben hat.
    expect(asOwner.invites).toEqual([expect.objectContaining({ email: pending, usesLeft: 1 })]);

    const asAdmin = await getJson<{ role: string; admins: Array<Record<string, unknown>>; invites: unknown[] }>(await send('GET', `/api/boats/${boat.id}/admins`, a.cookie));
    expect(asAdmin.role).toBe('admin');
    expect(asAdmin.admins[0]).toMatchObject({ isSelf: true });
    expect(asAdmin.invites).toEqual([]);

    const stranger = await person();
    expect((await send('GET', `/api/boats/${boat.id}/admins`, stranger.cookie)).status).toBe(404);
    expect((await send('GET', `/api/boats/${boat.id}/admins`, undefined)).status).toBe(401);
  });
});

// ---------------------------------------------------------------- F-131 Prüfungen

describe('F-131 Prüfungen beim Einladen und Annehmen', () => {
  it('[F-131] gebundene Einladung nur für das Konto mit genau dieser Adresse (403), Peek sagt emailMatches=false', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const token = tokenOf((await inviteAdmin(owner, boat.id, email())).devLink!);
    const other = await person();
    expect(await getJson<Record<string, unknown>>(await peek(other, token))).toMatchObject({ emailMatches: false });
    const res = await accept(other, token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'invite_wrong_account' });
    // Ohne Anmeldung: Peek geht (emailMatches null), Annehmen nicht
    expect(await getJson<Record<string, unknown>>(await peek(undefined, token))).toMatchObject({ emailMatches: null, alreadyMember: false });
    expect((await accept(undefined, token)).status).toBe(401);
  });

  it('[F-131] nur der Eigner lädt ein: Admin 403, Fremde und Unbekanntes 404, fremde Origin 403', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const admin = await person();
    await accept(admin, tokenOf((await inviteAdmin(owner, boat.id, admin.email)).devLink!));
    expect((await send('POST', `/api/boats/${boat.id}/invites`, admin.cookie, { email: email() })).status).toBe(403);
    const stranger = await person();
    expect((await send('POST', `/api/boats/${boat.id}/invites`, stranger.cookie, { email: email() })).status).toBe(404);
    expect((await send('POST', '/api/boats/AAAAAAAAAAAAAAAAAA/invites', owner.cookie, { email: email() })).status).toBe(404);
    expect((await send('POST', `/api/boats/${boat.id}/invites`, owner.cookie, { email: email() }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('POST', `/api/boats/${boat.id}/invites`, undefined, { email: email() })).status).toBe(401);
  });

  it('[F-131] ungültige Adresse 400, eigene Adresse 409, doppelte Einladung 409; Adressen bestehender Admins lassen sich nicht abfragen', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const bad = await send('POST', `/api/boats/${boat.id}/invites`, owner.cookie, { email: 'kein-mail' });
    expect(bad.status).toBe(400);
    expect((await send('POST', `/api/boats/${boat.id}/invites`, owner.cookie, { email: owner.email })).status).toBe(409);
    const admin = await person();
    await accept(admin, tokenOf((await inviteAdmin(owner, boat.id, admin.email)).devLink!));
    // Kein already_member beim Einladen (sonst ließe sich prüfen, welche Adresse zu einem Admin gehört) –
    // beim Annehmen verbraucht ein bestehender Admin die Einladung nicht.
    const again = await inviteAdmin(owner, boat.id, admin.email);
    expect(await getJson(await accept(admin, tokenOf(again.devLink!)))).toMatchObject({ already: true });
    const to = email();
    await inviteAdmin(owner, boat.id, to);
    expect(await getJson(await send('POST', `/api/boats/${boat.id}/invites`, owner.cookie, { email: to }))).toMatchObject({ error: 'already_invited' });
  });

  it('[F-131] kaputte, unbekannte und abgelaufene Tokens: 400 invalid_invite', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const admin = await person();
    const token = tokenOf((await inviteAdmin(owner, boat.id, admin.email)).devLink!);
    for (const t of ['x', 'A'.repeat(43), 123, null]) {
      const res = await peek(admin, t as string);
      expect(res.status, String(t)).toBe(400);
    }
    await (await h.db()).prepare('UPDATE invites SET expires_at = ? WHERE boat_id = ?').bind(Date.now() - 1, boat.id).run();
    expect((await peek(admin, token)).status).toBe(400);
    expect((await accept(admin, token)).status).toBe(400);
  });

  it('[F-131] Eigner kann seine eigene Einladung nicht annehmen (409 own_object)', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const { link } = await inviteCrew(owner, share.id);
    expect(await getJson(await peek(owner, tokenOf(link!)))).toMatchObject({ isOwner: true });
    expect(await getJson(await accept(owner, tokenOf(link!)))).toMatchObject({ error: 'own_object' });
  });
});

// ---------------------------------------------------------------- F-132 Entfernen, Verlassen, Zurückziehen

describe('F-132 Admins entfernen, Boot verlassen, Einladung zurückziehen', () => {
  async function boatWithAdmins(k: number) {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const admins: Person[] = [];
    for (let i = 0; i < k; i++) {
      const a = await person();
      expect((await accept(a, tokenOf((await inviteAdmin(owner, boat.id, a.email)).devLink!))).status).toBe(200);
      admins.push(a);
    }
    return { owner, boat, admins };
  }

  it('[F-132] Eigner entfernt einen Admin – danach 404 beim Bearbeiten', async () => {
    const { owner, boat, admins: [a] } = await boatWithAdmins(1);
    expect((await send('DELETE', `/api/boats/${boat.id}/admins/${a.user.id}`, owner.cookie)).status).toBe(204);
    expect((await send('PATCH', `/api/boats/${boat.id}`, a.cookie, { name: 'X' })).status).toBe(404);
    expect((await send('DELETE', `/api/boats/${boat.id}/admins/${a.user.id}`, owner.cookie)).status).toBe(404);
  });

  it('[F-132] Admin verlässt das Boot (me), darf aber keine anderen entfernen; Eigner kann nicht verlassen', async () => {
    const { owner, boat, admins: [a, b] } = await boatWithAdmins(2);
    expect((await send('DELETE', `/api/boats/${boat.id}/admins/${b.user.id}`, a.cookie)).status).toBe(403);
    expect((await send('DELETE', `/api/boats/${boat.id}/admins/me`, a.cookie)).status).toBe(204);
    expect((await send('GET', `/api/boats/${boat.id}/admins`, a.cookie)).status).toBe(404);
    expect(await getJson(await send('DELETE', `/api/boats/${boat.id}/admins/me`, owner.cookie))).toMatchObject({ error: 'owner_cannot_leave' });
    const stranger = await person();
    expect((await send('DELETE', `/api/boats/${boat.id}/admins/${b.user.id}`, stranger.cookie)).status).toBe(404);
  });

  it('[F-132] Eigner zieht eine Einladung zurück – der Link ist sofort ungültig; Fremde bekommen 404', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const a = await person();
    const out = await inviteAdmin(owner, boat.id, a.email);
    const stranger = await person();
    expect((await send('DELETE', `/api/invites/${out.invite.id}`, stranger.cookie)).status).toBe(404);
    expect((await send('DELETE', `/api/invites/${out.invite.id}`, owner.cookie)).status).toBe(204);
    expect((await accept(a, tokenOf(out.devLink!))).status).toBe(400);
    // Danach darf neu eingeladen werden
    await inviteAdmin(owner, boat.id, a.email);
  });
});

// ---------------------------------------------------------------- F-133 Crew einladen

describe('F-133 Crew per Link oder E-Mail', () => {
  it('[F-133] Einladungslink: mehrere Personen mit Profil treten bei, der Link steht nur in der Antwort', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie, 'public', 'Rügen rund');
    const out = await inviteCrew(owner, share.id);
    expect(out.link).toMatch(/^http:\/\/localhost\/einladung#token=/);
    expect(out.invite).toMatchObject({ email: null, usesLeft: 30 });
    expect(h.logs.some((l) => l.includes(out.link!))).toBe(false); // keine Mail
    const token = tokenOf(out.link!);
    const a = await person({ profile: 'public' });
    const b = await person({ profile: 'public' });
    expect(await getJson(await peek(a, token))).toMatchObject({ kind: 'crew', target: 'Rügen rund', bound: false, emailMatches: null });
    expect(await getJson(await accept(a, token))).toMatchObject({ kind: 'crew', path: `/s/${share.id}`, already: false });
    expect((await accept(b, token)).status).toBe(200);
    // Schon dabei: verbraucht keine Nutzung
    expect(await getJson(await accept(a, token))).toMatchObject({ already: true });
    const crew = await getJson<CrewOut>(await crewOf(share.id, owner));
    expect(crew.members.map((m) => m.id)).toEqual([a.user.id, b.user.id]);
    expect(crew.invites).toEqual([expect.objectContaining({ id: out.invite.id, usesLeft: 28 })]);
  });

  it('[F-133] per E-Mail: gebunden an die Adresse, Mail nennt den Törn', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie, 'public', 'Hiddensee');
    const mate = await person({ profile: 'public' });
    const out = await inviteCrew(owner, share.id, mate.email);
    expect(out.link).toBeUndefined();
    expect(out.devLink).toMatch(/einladung#token=/);
    expect(h.logs.find((l) => l.includes(`an ${mate.email}:`) && l.includes('Einladung'))).toContain('Crew von „Hiddensee“');
    expect((await accept(mate, tokenOf(out.devLink!))).status).toBe(200);
  });

  it('[F-140] ohne Profil: Beitritt geht; Eigentümer sieht den Spaßnamen, Besucher den Spaßnamen ohne Link (F-134)', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const { link } = await inviteCrew(owner, share.id);
    const noProfile = await person();
    expect(await getJson(await accept(noProfile, tokenOf(link!)))).toMatchObject({ already: false });
    expect((await getJson<CrewOut>(await crewOf(share.id, owner))).members).toEqual([{ id: noProfile.user.id, handle: null, displayName: funnyName(noProfile.user.id), role: 'crew', confirmed: null }]);
    expect(await getJson(await crewOf(share.id))).toMatchObject({ members: [{ id: null, handle: null, displayName: funnyName(noProfile.user.id), role: 'crew', confirmed: null }], others: 0 });
  });

  it('[F-133] nur der Eigentümer lädt ein; fremde und private Törns 404; eigene Adresse 409', async () => {
    const owner = await person({ profile: 'public', supporter: true });
    const share = await newShare(owner.cookie, 'private');
    const stranger = await person({ profile: 'public' });
    expect((await send('POST', `/api/shares/${share.id}/invites`, stranger.cookie, {})).status).toBe(404);
    expect((await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { email: owner.email })).status).toBe(409);
    expect((await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { email: 'x@' })).status).toBe(400);
    // Auf einem privaten Törn darf eingeladen werden – angezeigt wird die Crew erst, wenn er öffentlich ist.
    const { link } = await inviteCrew(owner, share.id);
    expect(await getJson(await accept(stranger, tokenOf(link!)))).toMatchObject({ path: null, already: false });
  });
});

// ---------------------------------------------------------------- F-134 Sichtbarkeit der Crew

describe('F-134 Crew nur auf öffentlichen Törns', () => {
  async function shareWithCrew(visibility: 'public' | 'unlisted') {
    const owner = await person({ profile: 'public', supporter: true });
    const share = await newShare(owner.cookie, visibility, 'Crew-Törn');
    const pub = await person({ profile: 'public' });
    const priv = await person({ profile: 'private' });
    const token = tokenOf((await inviteCrew(owner, share.id)).link!);
    for (const p of [pub, priv]) expect((await accept(p, token)).status).toBe(200);
    return { owner, share, pub, priv };
  }

  it('[F-134] öffentlicher Törn: Besucher sehen alle Mitglieder – mit öffentlichem Profil verlinkt, sonst nur den Spaßnamen ohne Link; ohne IDs', async () => {
    const { share, pub, priv } = await shareWithCrew('public');
    const crew = await getJson<CrewOut>(await crewOf(share.id));
    expect(crew).toEqual({ members: [{ id: null, handle: pub.handle, displayName: `Name ${pub.handle}`, role: 'crew', confirmed: null }, { id: null, handle: null, displayName: funnyName(priv.user.id), role: 'crew', confirmed: null }], others: 0, isOwner: false, isCrew: false, isSkipper: false, ownerRole: null, ownerConfirmed: null, me: null, invites: [] });
    expect(JSON.stringify(crew)).not.toContain(priv.handle!);
    expect(JSON.stringify(crew)).not.toContain(priv.user.id);
    // Das Mitglied selbst erfährt, dass es dabei ist (für „Mich entfernen“)
    expect(await getJson(await crewOf(share.id, priv))).toMatchObject({ isCrew: true });
  });

  it('[F-134] „Nur mit Link“: Besucher mit Schlüssel sehen keine Crew, der Eigentümer alle (auch private Profile mit Namen)', async () => {
    const { owner, share, pub, priv } = await shareWithCrew('unlisted');
    expect(await getJson(await crewOf(share.id, undefined, share.shareKey))).toEqual({ members: [], others: 0, isOwner: false, isCrew: false, isSkipper: false, ownerRole: null, ownerConfirmed: null, me: null, invites: [] });
    expect((await crewOf(share.id)).status).toBe(404); // ohne Schlüssel wie die Freigabe selbst
    const own = await getJson<CrewOut>(await crewOf(share.id, owner));
    expect(own.members).toEqual([
      { id: pub.user.id, handle: pub.handle, displayName: `Name ${pub.handle}`, role: 'crew', confirmed: null },
      { id: priv.user.id, handle: null, displayName: `Name ${priv.handle}`, role: 'crew', confirmed: null },
    ]);
  });

  it('[F-134] Profilseite „Mitgesegelt“ listet nur öffentliche Crew-Törns, nicht in den Kennzahlen; Wechsel auf „Nur mit Link“ blendet aus', async () => {
    const { owner, share, pub } = await shareWithCrew('public');
    type ProfileOut = { stats: { voyages: number }; voyages: unknown[]; crewVoyages: Array<{ id: string; title: string; shareKey: unknown; link: unknown }> };
    const page = await getJson<ProfileOut>(await h.fetch(`/api/profiles/${pub.handle}`));
    expect(page.crewVoyages.map((v) => v.id)).toEqual([share.id]);
    expect(page.crewVoyages[0]).toMatchObject({ title: 'Crew-Törn', shareKey: null, link: null });
    expect(page.stats.voyages).toBe(0);
    expect((await send('PATCH', `/api/shares/${share.id}`, owner.cookie, { visibility: 'unlisted' })).status).toBe(200);
    expect((await getJson<ProfileOut>(await h.fetch(`/api/profiles/${pub.handle}`))).crewVoyages).toEqual([]);
    expect((await getJson<CrewOut>(await crewOf(share.id, undefined, (await getJson<{ share: { shareKey: string } }>(await send('GET', `/api/shares/${share.id}`, owner.cookie))).share.shareKey))).members).toEqual([]);
  });

  it('[F-134] Crew-Sein öffnet keinen nicht öffentlichen Törn', async () => {
    const { share, pub } = await shareWithCrew('unlisted');
    expect((await h.fetch(`/api/shares/${share.id}`, { cookie: pub.cookie })).status).toBe(404);
    expect((await h.fetch(`/api/shares/${share.id}/data`, { cookie: pub.cookie })).status).toBe(404);
  });
});

// ---------------------------------------------------------------- F-135 Crew entfernen

describe('F-135 Crew entfernen', () => {
  it('[F-135] Mitglied entfernt sich selbst (me), Eigentümer entfernt andere, Fremde bekommen 404', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const token = tokenOf((await inviteCrew(owner, share.id)).link!);
    const a = await person({ profile: 'public' });
    const b = await person({ profile: 'public' });
    await accept(a, token);
    await accept(b, token);
    expect((await send('DELETE', `/api/shares/${share.id}/crew/${b.user.id}`, a.cookie)).status).toBe(404);
    expect((await send('DELETE', `/api/shares/${share.id}/crew/me`, a.cookie)).status).toBe(204);
    expect((await send('DELETE', `/api/shares/${share.id}/crew/me`, a.cookie)).status).toBe(404);
    expect((await send('DELETE', `/api/shares/${share.id}/crew/${b.user.id}`, owner.cookie)).status).toBe(204);
    expect((await getJson<CrewOut>(await crewOf(share.id))).members).toEqual([]);
    expect((await getJson<{ crewVoyages: unknown[] }>(await h.fetch(`/api/profiles/${a.handle}`))).crewVoyages).toEqual([]);
  });
});

// ---------------------------------------------------------------- F-136 Grenzen

describe('F-136 Missbrauchsgrenzen', () => {
  async function fillInvites(inviterId: string, k: number, o: { boatId?: string; shareId?: string; email?: boolean; inviter?: string } = {}) {
    const db = await h.db();
    for (let i = 0; i < k; i++) {
      await db
        .prepare('INSERT INTO invites (id, token_hash, kind, boat_id, share_id, inviter_id, email, max_uses, uses, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)')
        .bind(uniq('inv').replace(/-/g, ''), uniq('hash'), o.boatId ? 'boat_admin' : 'crew', o.boatId ?? null, o.shareId ?? null, inviterId, o.email ? email() : null, Date.now(), Date.now() + 86_400_000)
        .run();
    }
  }

  it('[F-136] höchstens 20 Einladungen pro Konto in 24 h', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const other = await newShare(owner.cookie);
    await fillInvites(owner.user.id, 20, { shareId: other.id });
    const res = await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, {});
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'invite_quota' });
  });

  it('[F-136] höchstens 10 Admins je Boot (offene Einladungen zählen mit)', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const helper = await person();
    await fillInvites(helper.user.id, 10, { boatId: boat.id, email: true });
    expect(await getJson(await send('POST', `/api/boats/${boat.id}/invites`, owner.cookie, { email: email() }))).toMatchObject({ error: 'quota' });
  });

  it('[F-136] höchstens 10 offene Einladungen je Törn; Einladungslink endet bei der Crew-Obergrenze', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const helper = await person();
    await fillInvites(helper.user.id, 10, { shareId: share.id });
    expect(await getJson(await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, {}))).toMatchObject({ error: 'quota' });

    const share2 = await newShare(owner.cookie);
    const db = await h.db();
    const mate = await person({ profile: 'public' });
    for (let i = 0; i < 29; i++) await db.prepare('INSERT INTO share_crew (share_id, user_id, created_at) VALUES (?, ?, ?)').bind(share2.id, (await person()).user.id, Date.now()).run();
    const out = await inviteCrew(owner, share2.id);
    expect(out.invite.usesLeft).toBe(1);
    expect((await accept(mate, tokenOf(out.link!))).status).toBe(200);
    expect(await getJson(await send('POST', `/api/shares/${share2.id}/invites`, owner.cookie, {}))).toMatchObject({ error: 'quota' });
  }, 60_000);

  it('[F-136] höchstens 50 Einladungsmails pro Tag für den ganzen Server; Einladungslinks gehen weiter', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const filler = await person();
    const fillerShare = await newShare(filler.cookie);
    const { n: sent } = (await (await h.db()).prepare('SELECT COUNT(*) AS n FROM invites WHERE email IS NOT NULL AND created_at > ?').bind(Date.now() - 86_400_000).first<{ n: number }>())!;
    await fillInvites(filler.user.id, Math.max(0, 50 - sent), { shareId: fillerShare.id, email: true });
    const res = await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { email: email() });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'mail_budget' });
    expect((await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, {})).status).toBe(201);
    // Aufräumen, damit spätere Tests wieder Mails verschicken können
    await (await h.db()).prepare('DELETE FROM invites WHERE inviter_id = ?').bind(filler.user.id).run();
  });

  it('[F-136] der nächtliche Lauf löscht abgelaufene und aufgebrauchte Einladungen', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    const a = await person();
    const used = await inviteAdmin(owner, boat.id, a.email);
    await accept(a, tokenOf(used.devLink!));
    const expired = await inviteAdmin(owner, boat.id, email());
    const open = await inviteAdmin(owner, boat.id, email());
    const db = await h.db();
    await db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, expired.invite.id).run();
    await h.scheduled();
    const ids = (await db.prepare('SELECT id FROM invites WHERE boat_id = ?').bind(boat.id).all<{ id: string }>()).results.map((r) => r.id);
    expect(ids).toEqual([open.invite.id]);
  });
});

// ---------------------------------------------------------------- F-137 Löschen

describe('F-137 Löschen nimmt Einladungen und Mitgliedschaften mit', () => {
  it('[F-137] Törn löschen entfernt Crew und Einladungen', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const mate = await person({ profile: 'public' });
    await accept(mate, tokenOf((await inviteCrew(owner, share.id)).link!));
    await inviteCrew(owner, share.id);
    expect((await send('DELETE', `/api/shares/${share.id}`, owner.cookie)).status).toBe(204);
    const db = await h.db();
    expect(await db.prepare('SELECT 1 FROM share_crew WHERE share_id = ?').bind(share.id).first()).toBeNull();
    expect(await db.prepare('SELECT 1 FROM invites WHERE share_id = ?').bind(share.id).first()).toBeNull();
  });

  it('[F-137] Boot löschen entfernt Admins und Einladungen', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie);
    await inviteAdmin(owner, boat.id, email());
    expect((await send('DELETE', `/api/boats/${boat.id}`, owner.cookie)).status).toBe(204);
    expect(await (await h.db()).prepare('SELECT 1 FROM invites WHERE boat_id = ?').bind(boat.id).first()).toBeNull();
  });

  it('[F-137] Konto löschen entfernt eigene Crew-Mitgliedschaften, Admin-Rollen und verschickte Einladungen', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const boat = await newBoat(owner.cookie);
    const mate = await person({ profile: 'public' });
    await accept(mate, tokenOf((await inviteCrew(owner, share.id)).link!));
    await accept(mate, tokenOf((await inviteAdmin(owner, boat.id, mate.email)).devLink!));
    const mateShare = await newShare(mate.cookie);
    await inviteCrew(mate, mateShare.id);
    expect((await send('DELETE', '/api/account', mate.cookie)).status).toBe(200);
    const db = await h.db();
    expect(await db.prepare('SELECT 1 FROM share_crew WHERE user_id = ?').bind(mate.user.id).first()).toBeNull();
    expect(await db.prepare('SELECT 1 FROM boat_admins WHERE user_id = ?').bind(mate.user.id).first()).toBeNull();
    expect(await db.prepare('SELECT 1 FROM invites WHERE inviter_id = ?').bind(mate.user.id).first()).toBeNull();
    expect((await getJson<CrewOut>(await crewOf(share.id, owner))).members).toEqual([]);
  });
});

// ---------------------------------------------------------------- F-140 Keine Adressen an andere

describe('F-140 E-Mail-Adressen erreichen nie andere Konten', () => {
  it('[F-140] Admin-Liste, Crew, Peek, Fehler, Profil- und Bootsseite enthalten keine fremde Adresse', async () => {
    const owner = await person({ profile: 'public' });
    const boat = await newBoat(owner.cookie);
    const share = await newShare(owner.cookie);
    const admin = await person();
    const mate = await person({ profile: 'public' });
    const stranger = await person();
    const adminToken = tokenOf((await inviteAdmin(owner, boat.id, admin.email)).devLink!);
    const crewToken = tokenOf((await inviteCrew(owner, share.id)).link!);
    const wrong = await accept(stranger, adminToken); // falsches Konto
    expect(wrong.status).toBe(403);
    const bodies = [
      await wrong.text(),
      await (await peek(stranger, adminToken)).text(),
      await (await peek(undefined, adminToken)).text(),
    ];
    await accept(admin, adminToken);
    await accept(mate, crewToken);
    const nameless = await person();
    await accept(nameless, crewToken);
    for (const [path, who] of [
      [`/api/boats/${boat.id}/admins`, owner], [`/api/boats/${boat.id}/admins`, admin],
      [`/api/shares/${share.id}/crew`, owner], [`/api/shares/${share.id}/crew`, mate], [`/api/shares/${share.id}/crew`, undefined],
      [`/api/boats/${boat.id}`, admin], [`/api/profiles/${mate.handle}`, undefined], [`/api/profiles/${owner.handle}`, admin],
    ] as Array<[string, Person | undefined]>) {
      bodies.push(await (await h.fetch(path, { cookie: who?.cookie })).text());
    }
    // Der Eigner sieht nur die Adressen, die er selbst für offene Einladungen eingegeben hat – hier sind alle angenommen.
    for (const body of bodies) {
      for (const p of [owner, admin, mate, stranger, nameless]) expect(body).not.toContain(p.email);
      expect(body).not.toMatch(/…@/);
    }
  });

  it('[F-140] Vorschlag für ein neues Profil: Spaßname als Anzeigename, nichts aus der Adresse', async () => {
    const p = await person();
    const r = await getJson<{ profile: { displayName: string; handle: string }; exists: boolean }>(await send('GET', '/api/me/profile', p.cookie));
    expect(r.exists).toBe(false);
    expect(r.profile.displayName).toBe(funnyName(p.user.id));
    expect(r.profile.displayName).not.toContain(p.email.split('@')[0]);
  });

  it('[F-140] Einladungsmail nennt den Einladenden mit Spaßnamen, wenn er keinen Namen gesetzt hat – nie mit Adresse', async () => {
    const owner = await person();
    const boat = await newBoat(owner.cookie, 'Kutter');
    const to = email();
    await inviteAdmin(owner, boat.id, to);
    const mail = h.logs.find((l) => l.includes(`an ${to}:`))!;
    expect(mail).toContain(funnyName(owner.user.id));
    expect(mail).not.toContain(owner.email);
  });
});

// ---------------------------------------------------------------- F-141 Bestehende Konten: Profilname und Posteingang

describe('F-141 Bestehende Konten einladen: per Profilname oder per E-Mail, Posteingang im Konto', () => {
  type MyInvites = { invites: Array<{ id: string; kind: string; target: string; inviter: string }> };
  const inbox = async (p: Person) => getJson<MyInvites>(await send('GET', '/api/me/invites', p.cookie));

  it('[F-141] per Profilname: Mail an die Adresse des Kontos (die der Einladende nie sieht), Annehmen im Konto', async () => {
    const owner = await person({ profile: 'public' });
    const boat = await newBoat(owner.cookie, 'Möwenschiss');
    const mate = await person({ profile: 'public' });
    const res = await send('POST', `/api/boats/${boat.id}/invites`, owner.cookie, { handle: `@${mate.handle}` });
    expect(res.status).toBe(201);
    const raw = await res.clone().text();
    expect(raw).not.toContain(mate.email);
    expect((await getJson<InviteOut & { invite: { invitee: unknown } }>(res)).invite).toMatchObject({ email: null, invitee: { handle: mate.handle, displayName: `Name ${mate.handle}` } });
    expect(h.logs.some((l) => l.includes(`an ${mate.email}:`) && l.includes('Möwenschiss'))).toBe(true);
    // Eigner sieht die offene Einladung mit Namen, ohne Adresse
    const list = await (await send('GET', `/api/boats/${boat.id}/admins`, owner.cookie)).text();
    expect(list).toContain(`Name ${mate.handle}`);
    expect(list).not.toContain(mate.email);

    const mine = await inbox(mate);
    expect(mine.invites).toEqual([expect.objectContaining({ kind: 'boat_admin', target: 'Möwenschiss', inviter: `Name ${owner.handle}` })]);
    expect(JSON.stringify(mine)).not.toContain(owner.email);
    expect(await getJson(await send('POST', `/api/me/invites/${mine.invites[0].id}/accept`, mate.cookie))).toMatchObject({ kind: 'boat_admin', already: false });
    expect((await inbox(mate)).invites).toEqual([]);
    expect((await getJson<{ boats: Array<{ id: string; role: string }> }>(await send('GET', '/api/boats', mate.cookie))).boats.find((b) => b.id === boat.id)?.role).toBe('admin');
  });

  it('[F-141] per E-Mail an ein bestehendes Konto: erscheint dort im Posteingang; neue Adressen gehen wie bisher', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie, 'public', 'Bestandstörn');
    const existing = await person();
    await inviteCrew(owner, share.id, existing.email);
    const fresh = email();
    const outFresh = await inviteCrew(owner, share.id, fresh);
    expect((await inbox(existing)).invites).toEqual([expect.objectContaining({ kind: 'crew', target: 'Bestandstörn' })]);
    // Neue Adresse: Konto entsteht erst bei der Anmeldung, dann ist die Einladung im Posteingang und per Link annehmbar
    const newcomer = { ...(await login(h, fresh)), email: fresh };
    expect((await inbox(newcomer)).invites).toHaveLength(1);
    expect((await accept(newcomer, tokenOf(outFresh.devLink!))).status).toBe(200);
  });

  it('[F-141] Ablehnen löscht die Einladung (auch beim Einladenden); fremde Einladungen lassen sich weder annehmen noch ablehnen', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const a = await person({ profile: 'public' });
    const b = await person({ profile: 'public' });
    await inviteCrew(owner, share.id, a.email);
    const [inv] = (await inbox(a)).invites;
    expect((await send('POST', `/api/me/invites/${inv.id}/accept`, b.cookie)).status).toBe(404);
    expect((await send('DELETE', `/api/me/invites/${inv.id}`, b.cookie)).status).toBe(404);
    expect((await send('DELETE', `/api/me/invites/${inv.id}`, a.cookie)).status).toBe(204);
    expect((await getJson<CrewOut>(await crewOf(share.id, owner))).invites).toEqual([]);
  });

  it('[F-141] über den Profilnamen gebunden: der Link gilt nur für dieses Konto', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const mate = await person({ profile: 'public' });
    const res = await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { handle: mate.handle });
    const token = tokenOf((await getJson<InviteOut>(res)).devLink!);
    const other = await person({ profile: 'public' });
    expect(await getJson(await peek(other, token))).toMatchObject({ bound: true, emailMatches: false });
    expect(await getJson(await accept(other, token))).toMatchObject({ error: 'invite_wrong_account' });
    expect(await getJson(await peek(mate, token))).toMatchObject({ bound: true, emailMatches: true });
    expect((await accept(mate, token)).status).toBe(200);
  });

  it('[F-141] Profilname: nur öffentliche Profile (privat und unbekannt gleich 404), nicht sich selbst, nicht doppelt, nicht wer schon dabei ist', async () => {
    const owner = await person({ profile: 'public' });
    const share = await newShare(owner.cookie);
    const hidden = await person({ profile: 'private' });
    const r1 = await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { handle: hidden.handle });
    const r2 = await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { handle: 'gibt-es-nicht-xyz' });
    expect([r1.status, r2.status]).toEqual([404, 404]);
    expect(await r1.json()).toEqual(await r2.json());
    expect(await getJson(await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { handle: owner.handle }))).toMatchObject({ error: 'own_object' });
    const mate = await person({ profile: 'public' });
    await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { handle: mate.handle });
    expect(await getJson(await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { handle: mate.handle }))).toMatchObject({ error: 'already_invited' });
    const [inv] = (await inbox(mate)).invites;
    await send('POST', `/api/me/invites/${inv.id}/accept`, mate.cookie);
    const again = await send('POST', `/api/shares/${share.id}/invites`, owner.cookie, { handle: mate.handle });
    expect(await getJson(again)).toMatchObject({ error: 'already_member' });
  });
});
