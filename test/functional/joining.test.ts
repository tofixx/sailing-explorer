// Funktionale Tests: Beitreten und Einladen (Konzept 14, F-200 … F-205) – drei Beitrittsstufen, wer bestätigt,
// Einladungen durch Mitglieder, Freunde einladen. Echter Worker in workerd (Miniflare).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social } from './social-helpers';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

type Page = { membership: { role: string | null; canJoin?: boolean; canRequest: boolean; canApprove?: boolean }; requests?: Array<{ userId: string }>; group: { approveBy: string } };
const page = async (slug: string, cookie?: string) => (await (await s.send('GET', `/api/groups/slug/${slug}`, cookie)).json()) as Page;
const role = async (groupId: string, userId: string) =>
  (await (await s.db()).prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).first<{ role: string }>())?.role ?? null;
const tokenOf = (link: string) => /#token=([A-Za-z0-9_-]+)$/.exec(link)![1];

/** Einladungslink von `who` für die Gruppe, angenommen von `guest`. */
async function inviteAndAccept(groupId: string, who: { cookie: string }, guest: { cookie: string }) {
  const inv = await s.send('POST', `/api/groups/${groupId}/invites`, who.cookie, {});
  expect(inv.status, await inv.clone().text()).toBe(201);
  const body = (await inv.json()) as { link: string; needsApproval: boolean };
  const acc = await s.send('POST', '/api/invites/accept', guest.cookie, { token: tokenOf(body.link) });
  expect(acc.status, await acc.clone().text()).toBe(200);
  return { needsApproval: body.needsApproval, result: (await acc.json()) as { requested: boolean; already: boolean } };
}

describe('Beitrittsstufen (Konzept 14.1)', () => {
  it('F-200: offen – direkt Mitglied; auf Anfrage – Anfrage; nur Einladung – 403', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const guest = await s.person({ profile: 'public' });
    const open = await s.group(owner, { joinMode: 'open' });
    const req = await s.group(owner, { joinMode: 'request' });
    const inv = await s.group(owner, { joinMode: 'invite' });

    expect((await page(open.slug, guest.cookie)).membership).toMatchObject({ canJoin: true, canRequest: false });
    const j = await s.send('POST', `/api/groups/${open.id}/requests`, guest.cookie, { message: '' });
    expect(j.status).toBe(201);
    expect(await j.json()).toMatchObject({ joined: true });
    expect(await role(open.id, guest.user.id)).toBe('member');

    const r = await s.send('POST', `/api/groups/${req.id}/requests`, guest.cookie, { message: 'Hallo' });
    expect(await r.json()).toMatchObject({ requested: true });
    expect(await role(req.id, guest.user.id)).toBeNull();

    expect((await s.send('POST', `/api/groups/${inv.id}/requests`, guest.cookie, { message: '' })).status).toBe(403);
    expect((await s.send('PATCH', `/api/groups/${req.id}`, owner.cookie, { joinMode: 'quatsch' })).status).toBe(400);
  });
});

describe('Einladen durch Mitglieder und wer bestätigt (Konzept 14.1)', () => {
  it('F-201: einfaches Mitglied lädt ein → Annahme wird zur Anfrage; Admin-Einladung nimmt direkt auf; offen immer direkt', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const [g1, g2, g3] = [await s.person(), await s.person(), await s.person()];
    const g = await s.group(owner, { joinMode: 'request' });
    await s.join(owner, g, member);

    const a = await inviteAndAccept(g.id, member, g1);
    expect(a.needsApproval).toBe(true);
    expect(a.result.requested).toBe(true);
    expect(await role(g.id, g1.user.id)).toBeNull();
    const reqs = (await page(g.slug, owner.cookie)).requests ?? [];
    expect(reqs.map((r) => r.userId)).toContain(g1.user.id);

    const b = await inviteAndAccept(g.id, owner, g2);
    expect(b.needsApproval).toBe(false);
    expect(await role(g.id, g2.user.id)).toBe('member');

    const open = await s.group(owner, { joinMode: 'open' });
    await s.join(owner, open, member);
    const c = await inviteAndAccept(open.id, member, g3);
    expect(c.needsApproval).toBe(false);
    expect(await role(open.id, g3.user.id)).toBe('member');
  });

  it('F-202: der Eigner legt fest, wer bestätigt – alle Mitglieder, Admins oder nur er selbst', async () => {
    const owner = await s.person({ profile: 'public' });
    const admin = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    await s.join(owner, g, admin);
    await s.join(owner, g, member);
    await s.send('PATCH', `/api/groups/${g.id}/members/${admin.user.id}`, owner.cookie, { role: 'admin' });

    // Nur der Eigner darf die Regel ändern
    expect((await s.send('PATCH', `/api/groups/${g.id}`, admin.cookie, { approveBy: 'members' })).status).toBe(403);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { approveBy: 'nobody' })).status).toBe(400);

    // Standard: Admins bestätigen, Mitglieder nicht
    const p1 = await s.person();
    await s.send('POST', `/api/groups/${g.id}/requests`, p1.cookie, { message: '' });
    expect((await page(g.slug, member.cookie)).membership.canApprove).toBe(false);
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${p1.user.id}`, member.cookie, { approve: true })).status).toBe(403);
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${p1.user.id}`, admin.cookie, { approve: true })).status).toBe(200);

    // Alle Mitglieder
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { approveBy: 'members' })).status).toBe(200);
    expect((await page(g.slug)).group.approveBy).toBe('members');
    const p2 = await s.person();
    await s.send('POST', `/api/groups/${g.id}/requests`, p2.cookie, { message: '' });
    const mp = await page(g.slug, member.cookie);
    expect(mp.membership.canApprove).toBe(true);
    expect((mp.requests ?? []).map((r) => r.userId)).toContain(p2.user.id);
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${p2.user.id}`, member.cookie, { approve: true })).status).toBe(200);
    // … und Einladungen einfacher Mitglieder nehmen jetzt direkt auf
    const p3 = await s.person();
    expect((await inviteAndAccept(g.id, member, p3)).result.requested).toBe(false);
    expect(await role(g.id, p3.user.id)).toBe('member');

    // Nur der Eigner
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { approveBy: 'owner' })).status).toBe(200);
    const p4 = await s.person();
    await s.send('POST', `/api/groups/${g.id}/requests`, p4.cookie, { message: '' });
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${p4.user.id}`, admin.cookie, { approve: true })).status).toBe(403);
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${p4.user.id}`, owner.cookie, { approve: true })).status).toBe(200);
  });
});

describe('Review-Befunde: „Offen“, Eigner-Regeln, Grenzen (Konzept 14.1)', () => {
  it('F-200: „Offen“ wirkt nur bei öffentlichen Gruppen – geschlossen bzw. „Nur mit Link“ wird zur Anfrage, auch per Mitglieds-Einladung', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const member = await s.person({ profile: 'public' });
    const guest = await s.person();
    const g = await s.group(owner, { joinMode: 'open', visibility: 'unlisted' });
    await s.join(owner, g, member);
    const p = (await (await s.send('GET', `/api/groups/${g.id}`, guest.cookie, undefined, { 'X-Share-Key': g.shareKey! })).json()) as Page;
    expect(p.membership).toMatchObject({ canJoin: false, canRequest: true });
    const r = await s.send('POST', `/api/groups/${g.id}/requests`, guest.cookie, { message: '' }, { 'X-Share-Key': g.shareKey! });
    expect(await r.json()).toMatchObject({ requested: true });
    expect(await role(g.id, guest.user.id)).toBeNull();
    const other = await s.person();
    const a = await inviteAndAccept(g.id, member, other);
    expect(a.needsApproval).toBe(true);
    expect(a.result.requested).toBe(true);
    expect(await role(g.id, other.user.id)).toBeNull();
  });

  it('F-200: Beitrittsstufe ändert nur der Eigner; Mitglieds-Einladung in „Nur auf Einladung“ wird zur Anfrage', async () => {
    const owner = await s.person({ profile: 'public' });
    const admin = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const g = await s.group(owner, { joinMode: 'invite' });
    await s.join(owner, g, admin);
    await s.join(owner, g, member);
    await s.send('PATCH', `/api/groups/${g.id}/members/${admin.user.id}`, owner.cookie, { role: 'admin' });
    expect((await s.send('PATCH', `/api/groups/${g.id}`, admin.cookie, { joinMode: 'open' })).status).toBe(403);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, admin.cookie, { description: 'Admins dürfen das' })).status).toBe(200);
    const guest = await s.person();
    const a = await inviteAndAccept(g.id, member, guest);
    expect(a.result.requested).toBe(true);
    expect(await role(g.id, guest.user.id)).toBeNull();
  });

  it('F-201: besteht schon eine Anfrage, verbraucht die Einladung keine Nutzung', async () => {
    const owner = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const guest = await s.person();
    const g = await s.group(owner, { joinMode: 'request' });
    await s.join(owner, g, member);
    await s.send('POST', `/api/groups/${g.id}/requests`, guest.cookie, { message: 'Hallo' });
    const inv = (await (await s.send('POST', `/api/groups/${g.id}/invites`, member.cookie, {})).json()) as { link: string; invite: { id: string } };
    const acc = await s.send('POST', '/api/invites/accept', guest.cookie, { token: tokenOf(inv.link) });
    expect(await acc.json()).toMatchObject({ requested: true, already: true });
    const uses = await (await s.db()).prepare('SELECT uses FROM invites WHERE id = ?').bind(inv.invite.id).first<{ uses: number }>();
    expect(uses?.uses).toBe(0);
  });
});

describe('Freunde einladen (Konzept 14.2)', () => {
  it('F-203: Einladungslink ohne Ziel – wer annimmt, folgt und wird gefolgt; eigene Einladung nicht; zweimal ist „already“', async () => {
    const a = await s.person({ profile: 'public' });
    const b = await s.person({ profile: 'public' });
    const res = await s.send('POST', '/api/invites', a.cookie, {});
    expect(res.status, await res.clone().text()).toBe(201);
    const { link } = (await res.json()) as { link: string };
    const token = tokenOf(link);

    const peek = (await (await s.send('POST', '/api/invites/peek', b.cookie, { token })).json()) as { kind: string; target: string | null; inviter: string };
    expect(peek).toMatchObject({ kind: 'friend', target: null, inviter: `Name ${a.handle}` });

    expect((await s.send('POST', '/api/invites/accept', a.cookie, { token })).status).toBe(409);
    const acc = await s.send('POST', '/api/invites/accept', b.cookie, { token });
    expect(acc.status, await acc.clone().text()).toBe(200);
    expect(await acc.json()).toMatchObject({ kind: 'friend', path: `/u/${a.handle}`, already: false });
    const db = await s.db();
    const f = await db
      .prepare(`SELECT COUNT(*) AS n FROM follows WHERE target_kind = 'user' AND ((user_id = ?1 AND target_id = ?2) OR (user_id = ?2 AND target_id = ?1))`)
      .bind(a.user.id, b.user.id)
      .first<{ n: number }>();
    expect(f?.n).toBe(2);
    expect(await (await s.send('POST', '/api/invites/accept', b.cookie, { token })).json()).toMatchObject({ already: true });
  });

  it('F-204: per Adresse gebunden, keine Doppel-Einladung; Zurückziehen nur durch die einladende Person', async () => {
    const a = await s.person({ profile: 'public' });
    const mail = s.email('friend');
    expect((await s.send('POST', '/api/invites', a.cookie, { email: mail })).status).toBe(201);
    expect((await s.send('POST', '/api/invites', a.cookie, { email: mail })).status).toBe(409);
    expect((await s.send('POST', '/api/invites', a.cookie, { email: a.email })).status).toBe(409);
    const row = await (await s.db()).prepare(`SELECT id FROM invites WHERE kind = 'friend' AND inviter_id = ? AND email = ?`).bind(a.user.id, mail).first<{ id: string }>();
    const other = await s.person();
    expect((await s.send('DELETE', `/api/invites/${row!.id}`, other.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/invites/${row!.id}`, a.cookie)).status).toBe(204);
    expect((await s.send('POST', '/api/invites', a.cookie, { email: mail })).status).toBe(201);
    expect((await s.send('POST', '/api/invites', undefined, {})).status).toBe(401);
  });

  it('F-205: öffentliche Gruppen in Entdecken tragen ID und Beitrittsstufe (Willkommens-Karte)', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { joinMode: 'open' });
    const d = (await (await s.send('GET', '/api/discover', undefined)).json()) as { groups: Array<{ id: string; slug: string; joinMode: string }> };
    expect(d.groups.find((x) => x.slug === g.slug)).toMatchObject({ id: g.id, joinMode: 'open' });
  });
});
