// Funktionale Tests: Vereine und Teams (F-150 … F-157, F-168, Konzept 11.1) – anlegen, Rollen, Sichtbarkeit,
// Unterstützer-Grenzen, Einladungen, Beitrittsanfragen, Boote, Gruppenseite, Moderation.
// Echter Worker in workerd (Miniflare) mit lokalen D1-/R2-Bindings – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type GroupOut, type Person } from './social-helpers';
import { GROUP_LIMITS } from '../../src/domain/limits';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface PageOut {
  group: GroupOut & { hiddenAt: number | null };
  parent: { slug: string } | null;
  teams: Array<{ slug: string }>;
  stats: { members: number; boats: number; voyages: number; distNm: number; seasonNm: number };
  members: Array<{ id: string | null; handle: string | null; displayName: string; role: string }>;
  others: number;
  boats: Array<{ id: string; name: string; mine: boolean; canRemove: boolean }>;
  social: { followers: number; isFollowing: boolean };
  membership: { role: string | null; requested: boolean; canRequest: boolean };
  requests?: Array<{ userId: string; displayName: string }>;
  invites?: Array<{ id: string; email: string | null }>;
}

const page = async (g: { id: string }, p?: Person, key?: string | null) => {
  const res = await h.fetch(`/api/groups/${g.id}`, { cookie: p?.cookie, headers: key ? { 'X-Share-Key': key } : undefined });
  return res;
};
const pageJson = async (g: { id: string }, p?: Person) => {
  const res = await page(g, p);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as PageOut;
};

// ---------------------------------------------------------------- F-150 Anlegen

describe('F-150 Gruppen anlegen', () => {
  it('[F-150] Verein anlegen: Eigner, Standard öffentlich und „Auf Anfrage“, Seite per Slug, Slug normalisiert', async () => {
    const owner = await s.person({ profile: 'public' });
    const slug = s.uniq('Seglerverein');
    const g = await s.group(owner, { name: '  Seglerverein   Kiel  ', slug: slug.toUpperCase(), homePort: 'Kiel', description: 'Wir segeln.' });
    expect(g).toMatchObject({ kind: 'club', name: 'Seglerverein Kiel', slug: slug.toLowerCase(), visibility: 'public', joinMode: 'request', role: 'owner' });
    const bySlug = await h.fetch(`/api/groups/slug/${slug.toLowerCase()}`);
    expect(bySlug.status).toBe(200);
    const d = (await bySlug.json()) as PageOut;
    expect(d.group.id).toBe(g.id);
    expect(d.stats.members).toBe(1);
    expect(d.members).toEqual([expect.objectContaining({ handle: owner.handle, role: 'owner', id: null })]);
    const mine = (await (await s.send('GET', '/api/groups', owner.cookie)).json()) as { groups: Array<{ id: string; role: string; members: number }> };
    expect(mine.groups).toEqual([expect.objectContaining({ id: g.id, role: 'owner', members: 1 })]);
  });

  it('[F-150] ungültige, reservierte und vergebene Adressen, unbekannte Art, ohne Anmeldung', async () => {
    const a = await s.person({ supporter: true });
    for (const slug of ['ab', 'neu', 'feed', '-abc', 'a--b', 'Ümlaut', 'x'.repeat(31)]) {
      const res = await s.send('POST', '/api/groups', a.cookie, { kind: 'club', name: 'X', slug });
      expect(res.status, slug).toBe(400);
      expect(await s.errorOf(res)).toBe('invalid_slug');
    }
    expect((await s.send('POST', '/api/groups', a.cookie, { kind: 'verein', name: 'X', slug: s.uniq('x') })).status).toBe(400);
    expect((await s.send('POST', '/api/groups', a.cookie, { kind: 'club', name: '', slug: s.uniq('x') })).status).toBe(400);
    const g = await s.group(a);
    const dup = await s.send('POST', '/api/groups', a.cookie, { kind: 'team', name: 'Y', slug: g.slug });
    expect(dup.status).toBe(409);
    expect(await s.errorOf(dup)).toBe('slug_taken');
    expect((await s.send('POST', '/api/groups', undefined, { kind: 'club', name: 'X', slug: s.uniq('x') })).status).toBe(401);
    expect((await h.fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', origin: 'https://evil.example' })).status).toBe(403);
  });

  it('[F-150] Team im Verein nur als Eigner/Admin des Vereins; Seite zeigt Verein und Teams; Löschen des Vereins lässt Teams bestehen', async () => {
    const owner = await s.person({ supporter: true, profile: 'public' });
    const club = await s.group(owner);
    const stranger = await s.person({ supporter: true });
    const bad = await s.send('POST', '/api/groups', stranger.cookie, { kind: 'team', name: 'Fremdes Team', slug: s.uniq('t'), parentId: club.id });
    expect(bad.status).toBe(400);
    expect(await s.errorOf(bad)).toBe('invalid_parent');
    // Vereine haben keinen Verein
    expect((await s.send('POST', '/api/groups', owner.cookie, { kind: 'club', name: 'C', slug: s.uniq('c'), parentId: club.id })).status).toBe(400);
    const team = await s.group(owner, { kind: 'team', name: 'Regattateam', parentId: club.id });
    const d = await pageJson(team);
    expect(d.parent).toMatchObject({ slug: club.slug });
    expect((await pageJson(club)).teams.map((t) => t.slug)).toEqual([team.slug]);
    expect((await s.send('DELETE', `/api/groups/${club.id}`, owner.cookie)).status).toBe(204);
    expect((await pageJson(team)).parent).toBeNull();
    expect((await page(club)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- F-152 Sichtbarkeit, F-168 Grenzen

describe('F-152/F-168 Sichtbarkeit und Grenzen', () => {
  it('[F-168] kostenlos genau eine Gruppe, nur öffentlich (402); Unterstützer bis 10 (dann 409)', async () => {
    const free = await s.person();
    const closed = await s.send('POST', '/api/groups', free.cookie, { kind: 'club', name: 'Geheim', slug: s.uniq('g'), visibility: 'private' });
    expect(closed.status).toBe(402);
    expect(await s.errorOf(closed)).toBe('supporter_required');
    await s.group(free);
    const second = await s.send('POST', '/api/groups', free.cookie, { kind: 'team', name: 'Zweite', slug: s.uniq('g') });
    expect(second.status).toBe(402);
    expect(await s.errorOf(second)).toBe('supporter_required');

    const sup = await s.person({ supporter: true });
    for (let i = 0; i < GROUP_LIMITS.owned.supporter; i++) await s.group(sup, { visibility: i % 2 ? 'private' : 'unlisted' });
    const eleventh = await s.send('POST', '/api/groups', sup.cookie, { kind: 'club', name: 'Elf', slug: s.uniq('g') });
    expect(eleventh.status).toBe(409);
    expect(await s.errorOf(eleventh)).toBe('quota');
  });

  it('[F-152] geschlossen: für Fremde 404 (wie unbekannt), für Mitglieder sichtbar; „Nur mit Link“ nur mit Schlüssel', async () => {
    const owner = await s.person({ supporter: true });
    const closed = await s.group(owner, { visibility: 'private' });
    const stranger = await s.person();
    const unknown = await h.fetch('/api/groups/AAAAAAAAAAAAAAAAAA');
    const hidden = await page(closed, stranger);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await unknown.text());
    expect((await h.fetch(`/api/groups/slug/${closed.slug}`)).status).toBe(404);
    await s.join(owner, closed, stranger);
    expect((await page(closed, stranger)).status).toBe(200);

    const linked = await s.group(owner, { visibility: 'unlisted' });
    expect(linked.shareKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(linked.link).toBe(`/g/${linked.slug}/${linked.shareKey}`);
    expect((await page(linked)).status).toBe(404);
    expect((await page(linked, undefined, 'falsch0000000000000000')).status).toBe(404);
    const ok = await page(linked, undefined, linked.shareKey);
    expect(ok.status).toBe(200);
    const d = (await ok.json()) as PageOut;
    expect(d.group.shareKey).toBeNull(); // Schlüssel nur für Verwalter
  });

  it('[F-152] Sichtbarkeit ändert nur der Eigner; nach Ende der Unterstützung bleibt die Stufe (E4), neu setzen geht nicht', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner, { visibility: 'unlisted' });
    const admin = await s.person();
    await s.join(owner, g, admin);
    expect((await s.send('PATCH', `/api/groups/${g.id}/members/${admin.user.id}`, owner.cookie, { role: 'admin' })).status).toBe(200);
    const byAdmin = await s.send('PATCH', `/api/groups/${g.id}`, admin.cookie, { visibility: 'public' });
    expect(byAdmin.status).toBe(403);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, admin.cookie, { name: 'Neuer Name', description: 'Admin darf das' })).status).toBe(200);
    // Unterstützung beendet
    await (await s.db()).prepare('UPDATE supports SET valid_until = ? WHERE user_id = ?').bind(Date.now() - 1000, owner.user.id).run();
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { name: 'Bleibt nur mit Link', visibility: 'unlisted' })).status).toBe(200);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { visibility: 'private' })).status).toBe(402);
    const pub = await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { visibility: 'public' });
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as { group: GroupOut }).group.visibility).toBe('public');
  });

  it('[F-152] „Link erneuern“: alter Schlüssel sofort 404', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner, { visibility: 'unlisted' });
    const res = await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { rotateKey: true });
    const next = ((await res.json()) as { group: GroupOut }).group;
    expect(next.shareKey).not.toBe(g.shareKey);
    expect((await page(g, undefined, g.shareKey)).status).toBe(404);
    expect((await page(g, undefined, next.shareKey)).status).toBe(200);
  });
});

// ---------------------------------------------------------------- F-151 Rollen

describe('F-151 Rollen und Rechte', () => {
  it('[F-151] Admins ernennt nur der Eigner; Admins entfernen Mitglieder, aber keine Admins; Austreten; Eigner kann nicht austreten', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const [a, b, c] = [await s.person(), await s.person(), await s.person()];
    for (const p of [a, b, c]) await s.join(owner, g, p);
    expect((await s.send('PATCH', `/api/groups/${g.id}/members/${a.user.id}`, b.cookie, { role: 'admin' })).status).toBe(403);
    expect((await s.send('PATCH', `/api/groups/${g.id}/members/${a.user.id}`, owner.cookie, { role: 'boss' })).status).toBe(400);
    expect((await s.send('PATCH', `/api/groups/${g.id}/members/${a.user.id}`, owner.cookie, { role: 'admin' })).status).toBe(200);
    expect((await s.send('PATCH', `/api/groups/${g.id}/members/${b.user.id}`, owner.cookie, { role: 'admin' })).status).toBe(200);
    // Admin entfernt keinen Admin, aber ein Mitglied
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/${b.user.id}`, a.cookie)).status).toBe(403);
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/${c.user.id}`, a.cookie)).status).toBe(204);
    // Mitglied kann nur sich selbst entfernen; der Eigner nicht austreten
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me`, b.cookie)).status).toBe(204);
    const leave = await s.send('DELETE', `/api/groups/${g.id}/members/me`, owner.cookie);
    expect(leave.status).toBe(400);
    expect(await s.errorOf(leave)).toBe('owner_cannot_leave');
    // Mitglieder bearbeiten nicht, Fremde auch nicht; nur der Eigner löscht
    const m = await s.person();
    await s.join(owner, g, m);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, m.cookie, { name: 'X' })).status).toBe(403);
    expect((await s.send('DELETE', `/api/groups/${g.id}`, a.cookie)).status).toBe(403);
    expect((await s.send('DELETE', `/api/groups/${g.id}`, (await s.person()).cookie)).status).toBe(403);
  });

  it('[F-156] Mitglieder: namentlich nur mit öffentlichem Profil, sonst gezählt; Verwalter sehen alle Anzeigenamen und IDs, nie E-Mails', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    const pub = await s.person({ profile: 'public' });
    const priv = await s.person({ profile: 'private' });
    const none = await s.person();
    for (const p of [pub, priv, none]) await s.join(owner, g, p);
    const visitor = await pageJson(g);
    expect(visitor.members.map((m) => m.handle).sort()).toEqual([owner.handle, pub.handle].sort());
    expect(visitor.members.every((m) => m.id === null)).toBe(true);
    expect(visitor.others).toBe(2);
    expect(visitor.requests).toBeUndefined();
    const managed = await pageJson(g, owner);
    expect(managed.members).toHaveLength(4);
    expect(managed.members.find((m) => m.id === priv.user.id)?.handle).toBeNull();
    expect(managed.members.find((m) => m.id === priv.user.id)?.displayName).toMatch(/^Name seg-/);
    const raw = JSON.stringify(managed);
    for (const p of [owner, pub, priv, none]) expect(raw).not.toContain(p.email);
  });
});

// ---------------------------------------------------------------- F-153 Einladungen

describe('F-153 Einladungen in Gruppen', () => {
  it('[F-153] Einladung per Mail (gebunden) und per Link; Peek nennt die Gruppe; schon Mitglied verbraucht nichts', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { name: 'SC Möwe' });
    const invited = await s.person();
    const mailRes = await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, { email: invited.email });
    expect(mailRes.status, await mailRes.clone().text()).toBe(201);
    const { devLink } = (await mailRes.json()) as { devLink: string };
    expect(h.logs.find((l) => l.includes(`an ${invited.email}:`) && l.includes('Einladung in „SC Möwe“'))).toBeDefined();
    const token = /#token=([A-Za-z0-9_-]+)$/.exec(devLink)![1];
    const peek = (await (await s.send('POST', '/api/invites/peek', invited.cookie, { token })).json()) as Record<string, unknown>;
    expect(peek).toMatchObject({ kind: 'group', target: 'SC Möwe', groupKind: 'club', bound: true, emailMatches: true, alreadyMember: false });
    // Weitergegeben (F-131): ein anderes Konto sieht die Adresse nur maskiert und dürfte annehmen
    const other = (await (await s.send('POST', '/api/invites/peek', (await s.person()).cookie, { token })).json()) as Record<string, unknown>;
    expect(other).toMatchObject({ emailMatches: false, sentTo: `${invited.email[0]}…@e….org` });
    const acc = await s.send('POST', '/api/invites/accept', invited.cookie, { token });
    expect(await acc.json()).toMatchObject({ kind: 'group', path: `/g/${g.slug}`, already: false });
    expect((await pageJson(g, invited)).membership.role).toBe('member');

    // Einladungslink: mehrfach nutzbar; ein Mitglied verbraucht nichts
    const linkRes = await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, {});
    const out = (await linkRes.json()) as { link: string; invite: { usesLeft: number } };
    expect(out.invite.usesLeft).toBe(GROUP_LIMITS.linkUses);
    const t2 = /#token=([A-Za-z0-9_-]+)$/.exec(out.link)![1];
    expect(await (await s.send('POST', '/api/invites/accept', invited.cookie, { token: t2 })).json()).toMatchObject({ already: true });
    const own = await s.send('POST', '/api/invites/accept', owner.cookie, { token: t2 });
    expect(own.status).toBe(409);
  });

  it('[F-153] Mitglieder laden ein (Annahme wird zur Anfrage, Konzept 14.1), Eigner und Admins ziehen zurück; Fremde 404; zurückgezogen ist ungültig', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const member = await s.person();
    await s.join(owner, g, member);
    const byMember = await s.send('POST', `/api/groups/${g.id}/invites`, member.cookie, {});
    expect(byMember.status).toBe(201);
    expect(((await byMember.json()) as { needsApproval: boolean }).needsApproval).toBe(true);
    expect((await s.send('POST', `/api/groups/${g.id}/invites`, (await s.person()).cookie, {})).status).toBe(404);
    await s.send('PATCH', `/api/groups/${g.id}/members/${member.user.id}`, owner.cookie, { role: 'admin' });
    const res = await s.send('POST', `/api/groups/${g.id}/invites`, member.cookie, {});
    expect(res.status).toBe(201);
    const { invite, link } = (await res.json()) as { invite: { id: string }; link: string };
    expect((await pageJson(g, owner)).invites?.map((i) => i.id)).toContain(invite.id);
    expect((await s.send('DELETE', `/api/invites/${invite.id}`, (await s.person()).cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/invites/${invite.id}`, owner.cookie)).status).toBe(204);
    const token = /#token=([A-Za-z0-9_-]+)$/.exec(link)![1];
    expect((await s.send('POST', '/api/invites/accept', (await s.person()).cookie, { token })).status).toBe(400);
  });

  it('[F-153] höchstens 500 Mitglieder – Einladen und Annehmen werden abgelehnt (409 quota)', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const res = await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, {});
    const token = /#token=([A-Za-z0-9_-]+)$/.exec(((await res.json()) as { link: string }).link)![1];
    // Gruppe künstlich füllen
    const db = await s.db();
    const now = Date.now();
    for (let i = 0; i < GROUP_LIMITS.members - 1; i += 50) {
      const values = Array.from({ length: Math.min(50, GROUP_LIMITS.members - 1 - i) }, (_, k) => `('U${g.id.slice(0, 8)}${String(i + k).padStart(5, '0')}', 'f${g.id}${i + k}@x.org', ${now})`).join(',');
      await db.prepare(`INSERT INTO users (id, email, created_at) VALUES ${values}`).all();
      await db.prepare(`INSERT OR IGNORE INTO group_members (group_id, user_id, role, created_at) SELECT ?, id, 'member', ? FROM users WHERE id LIKE ?`).bind(g.id, now, `U${g.id.slice(0, 8)}%`).run();
    }
    expect((await pageJson(g, owner)).stats.members).toBe(GROUP_LIMITS.members);
    const acc = await s.send('POST', '/api/invites/accept', (await s.person()).cookie, { token });
    expect(acc.status).toBe(409);
    expect(await s.errorOf(acc)).toBe('quota');
    expect((await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, {})).status).toBe(409);
  });
});

// ---------------------------------------------------------------- F-154 Anfragen

describe('F-154 Beitrittsanfragen', () => {
  it('[F-154] anfragen, doppelt zählt einmal, Admin sieht die Anfrage und nimmt an; Ablehnen; Zurückziehen', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const a = await s.person({ profile: 'private' });
    const r1 = await s.send('POST', `/api/groups/${g.id}/requests`, a.cookie, { message: 'Hallo!' });
    expect(r1.status).toBe(201);
    expect((await s.send('POST', `/api/groups/${g.id}/requests`, a.cookie, {})).status).toBe(200);
    expect((await pageJson(g, a)).membership).toMatchObject({ role: null, requested: true, canRequest: false });
    const managed = await pageJson(g, owner);
    expect(managed.requests).toEqual([expect.objectContaining({ userId: a.user.id, displayName: expect.stringMatching(/^Name /) })]);
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${a.user.id}`, a.cookie, { approve: true })).status).toBe(403);
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${a.user.id}`, owner.cookie, { approve: true })).status).toBe(200);
    expect((await pageJson(g, a)).membership.role).toBe('member');
    expect((await s.send('POST', `/api/groups/${g.id}/requests`, a.cookie, {})).status).toBe(409);

    const b = await s.person();
    await s.send('POST', `/api/groups/${g.id}/requests`, b.cookie, {});
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${b.user.id}`, owner.cookie, { approve: false })).status).toBe(200);
    expect((await pageJson(g, b)).membership).toMatchObject({ role: null, requested: false });
    await s.send('POST', `/api/groups/${g.id}/requests`, b.cookie, {});
    expect((await s.send('DELETE', `/api/groups/${g.id}/requests/me`, b.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/groups/${g.id}/requests/me`, b.cookie)).status).toBe(404);
  });

  it('[F-154] „Nur auf Einladung“ → 403 invite_only; geschlossene Gruppen → 404; gesperrte Konten → 403 suspended', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner, { joinMode: 'invite' });
    const a = await s.person();
    const r = await s.send('POST', `/api/groups/${g.id}/requests`, a.cookie, {});
    expect(r.status).toBe(403);
    expect(await s.errorOf(r)).toBe('invite_only');
    const closed = await s.group(owner, { visibility: 'private' });
    expect((await s.send('POST', `/api/groups/${closed.id}/requests`, a.cookie, {})).status).toBe(404);
    const open = await s.group(owner);
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), a.user.id).run();
    const sus = await s.send('POST', `/api/groups/${open.id}/requests`, a.cookie, {});
    expect(sus.status).toBe(403);
    expect(await s.errorOf(sus)).toBe('suspended');
    expect((await s.send('POST', '/api/groups', a.cookie, { kind: 'club', name: 'X', slug: s.uniq('x') })).status).toBe(403);
  });

  it('[F-154] höchstens 20 Anfragen pro Konto und Tag (429)', async () => {
    const a = await s.person();
    const owners = [await s.person({ supporter: true }), await s.person({ supporter: true }), await s.person({ supporter: true })];
    const groups: GroupOut[] = [];
    for (let i = 0; i < GROUP_LIMITS.requestsPerDay + 1; i++) groups.push(await s.group(owners[i % 3]));
    for (let i = 0; i < GROUP_LIMITS.requestsPerDay; i++) expect((await s.send('POST', `/api/groups/${groups[i].id}/requests`, a.cookie, {})).status).toBe(201);
    const over = await s.send('POST', `/api/groups/${groups[GROUP_LIMITS.requestsPerDay].id}/requests`, a.cookie, {});
    expect(over.status).toBe(429);
  });
});

// ---------------------------------------------------------------- F-155 Boote

describe('F-155 Boote in Gruppen', () => {
  it('[F-155] Mitglieder ordnen verwaltete Boote zu (auch in mehrere Gruppen); fremde Boote 400; Nicht-Mitglieder 403; Entfernen', async () => {
    const owner = await s.person();
    const g1 = await s.group(owner);
    const sailor = await s.person();
    const g2 = await s.group(sailor);
    await s.join(owner, g1, sailor);
    const boat = await s.boat(sailor, { name: 'Albatros' });
    const foreign = await s.boat(owner, { name: 'Fremdboot' });
    expect((await s.send('POST', `/api/groups/${g1.id}/boats`, sailor.cookie, { boatId: boat.id })).status).toBe(201);
    expect((await s.send('POST', `/api/groups/${g1.id}/boats`, sailor.cookie, { boatId: boat.id })).status).toBe(200);
    expect((await s.send('POST', `/api/groups/${g2.id}/boats`, sailor.cookie, { boatId: boat.id })).status).toBe(201);
    expect((await s.send('POST', `/api/groups/${g1.id}/boats`, sailor.cookie, { boatId: foreign.id })).status).toBe(400);
    expect((await s.send('POST', `/api/groups/${g2.id}/boats`, owner.cookie, { boatId: foreign.id })).status).toBe(403);
    const d = await pageJson(g1);
    expect(d.boats.map((b) => b.name)).toEqual(['Albatros']);
    expect(d.stats.boats).toBe(1);
    // Ein Mitglied ohne Bootsrechte entfernt nicht; Gruppen-Eigner schon
    const other = await s.person();
    await s.join(owner, g1, other);
    expect((await s.send('DELETE', `/api/groups/${g1.id}/boats/${boat.id}`, other.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/groups/${g1.id}/boats/${boat.id}`, owner.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/groups/${g2.id}/boats/${boat.id}`, sailor.cookie)).status).toBe(204);
  });

  it('[F-155/F-156] nicht öffentliche Boote nennt die Seite nur ihren Verwaltern; Kennzahlen nur aus öffentlichen Törns', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner);
    const priv = await s.boat(owner, { name: 'Privatboot', visibility: 'private' });
    await s.send('POST', `/api/groups/${g.id}/boats`, owner.cookie, { boatId: priv.id });
    expect((await pageJson(g)).boats).toEqual([]);
    expect((await pageJson(g, owner)).boats).toEqual([expect.objectContaining({ name: 'Privatboot', mine: true })]);
    await s.share(owner, { distNm: 12, boatId: priv.id });
    await s.share(owner, { distNm: 30, visibility: 'private' });
    const st = (await pageJson(g)).stats;
    expect(st).toMatchObject({ voyages: 1, distNm: 12, boats: 0 });
  });
});

// ---------------------------------------------------------------- F-156 Vorschau, F-157 Moderation

describe('F-156/F-157 Seite, Vorschau, Moderation', () => {
  it('[F-156] /g/<slug> liefert Vorschau-Metadaten für öffentliche Gruppen; geschlossene neutral und noindex', async () => {
    const owner = await s.person({ supporter: true });
    const g = await s.group(owner, { name: 'Yachtclub <Nord>', homePort: 'Laboe' });
    const html = await (await h.fetch(`/g/${g.slug}`)).text();
    expect(html).toContain('<title>Yachtclub &lt;Nord&gt; · Sail Explorer</title>');
    expect(html).toContain('Heimathafen Laboe');
    expect(html).not.toContain('noindex');
    const closed = await s.group(owner, { visibility: 'private', name: 'Geheimbund' });
    const c = await (await h.fetch(`/g/${closed.slug}`)).text();
    expect(c).not.toContain('Geheimbund');
    expect(c).toContain('noindex');
  });

  it('[F-157] Gruppen melden: 3 Meldungen blenden aus (404 für andere, Verwalter sehen hiddenAt); eigene Gruppe nicht meldbar', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const own = await s.send('POST', '/api/reports', owner.cookie, { kind: 'group', id: g.id, reason: 'spam' });
    expect(own.status).toBe(400);
    for (let i = 0; i < 3; i++) {
      const r = await s.send('POST', '/api/reports', (await s.person()).cookie, { kind: 'group', id: g.id, reason: 'spam' });
      expect(r.status, await r.clone().text()).toBe(201);
    }
    expect((await page(g)).status).toBe(404);
    expect((await pageJson(g, owner)).group.hiddenAt).toBeGreaterThan(0);
    const disc = (await (await h.fetch('/api/discover')).json()) as { groups: Array<{ slug: string }> };
    expect(disc.groups.map((x) => x.slug)).not.toContain(g.slug);
  });

  it('[F-157] /entdecken listet öffentliche Gruppen, nicht geschlossene und nicht die gesperrter Eigner', async () => {
    const a = await s.person({ supporter: true });
    const pub = await s.group(a);
    const closed = await s.group(a, { visibility: 'private' });
    const b = await s.person();
    const susp = await s.group(b);
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), b.user.id).run();
    const disc = (await (await h.fetch('/api/discover?limit=24')).json()) as { groups: Array<{ slug: string; members: number }> };
    const slugs = disc.groups.map((x) => x.slug);
    expect(slugs).toContain(pub.slug);
    expect(slugs).not.toContain(closed.slug);
    expect(slugs).not.toContain(susp.slug);
  });
});
