// Funktionale Tests: Sichtbarkeit von Mitgliedschaften und Gruppeninhalten, Folgen und Mitgliedschaft getrennt,
// automatische Einträge und Benachrichtigungs-Stufen (Konzept 24, F-440 … F-449).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type GroupOut, type Person, type StreamOut } from './social-helpers';
import { canSeeMembers, canSeeMembership, type GroupRole } from '../../src/domain/groups';
import { isMemberSql, membersVisibleSql } from '../../worker/member-sql';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface Page {
  group: { membersVisible: string };
  stats: { members: number; boats: number };
  members: Array<{ id: string | null; handle: string | null; displayName: string; alias?: boolean; role: string }>;
  membersHidden?: boolean;
  boats: Array<{ name: string }>;
  social: { notifyLevel?: string | null; isFollowing: boolean };
  membership: { role: string | null };
}

const ok = async <T>(res: Response): Promise<T> => {
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return (await res.json()) as T;
};
const page = async (g: { id: string }, p?: Person) => ok<Page>(await s.send('GET', `/api/groups/${g.id}`, p?.cookie));
const groupStream = async (g: { id: string }, p?: Person) => s.send('GET', `/api/groups/${g.id}/stream`, p?.cookie);
const kinds = (o: StreamOut) => o.items.map((i) => i.kind);
const bell = async (p: Person) => (await ok<{ items: Array<{ kind: string; href: string }> }>(await s.send('GET', '/api/notifications', p.cookie))).items;
const setLevel = async (p: Person, kind: string, id: string, level: string) => s.send('PUT', `/api/notify/${kind}/${id}`, p.cookie, { level });
const write = (p: Person, g: { id: string }, body: Record<string, unknown>) => s.send('POST', `/api/groups/${g.id}/posts`, p.cookie, body);

/** Gruppe mit Eigner (öffentliches Profil), Mitglied mit öffentlichem und mit privatem Profil. */
async function setup(o: Record<string, unknown> = {}) {
  const owner = await s.person({ profile: 'public', supporter: true });
  const g = await s.group(owner, o);
  const pub = await s.person({ profile: 'public' });
  const priv = await s.person({ profile: 'private' });
  await s.join(owner, g, pub);
  await s.join(owner, g, priv);
  const stranger = await s.person({ profile: 'public' });
  return { owner, g, pub, priv, stranger };
}

// ---------------------------------------------------------------- Domain und SQL gleich

describe('F-441 Regeln: Domain und SQL-Baustein stimmen überein', () => {
  it('[F-441] [F-443] canSeeMembers/canSeeMembership = membersVisibleSql/isMemberSql für alle Kombinationen', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const member = await s.person();
    await s.join(owner, g, member);
    const db = await s.db();
    const cases: Array<{ viewer: Person | null; role: GroupRole | null }> = [
      { viewer: owner, role: 'owner' },
      { viewer: member, role: 'member' },
      { viewer: await s.person(), role: null },
      { viewer: null, role: null },
    ];
    for (const setting of ['members', 'public', 'unbekannt']) {
      await db.prepare('UPDATE groups SET members_visible = ? WHERE id = ?').bind(setting, g.id).run();
      for (const locked of [false, true]) {
        await db.prepare('UPDATE groups SET locked_at = ? WHERE id = ?').bind(locked ? Date.now() : null, g.id).run();
        for (const c of cases) {
          const role = locked ? null : c.role; // gesperrte Gruppe: niemand hat eine Rolle (Konzept 18.2)
          const row = await db
            .prepare(`SELECT ${isMemberSql('?1', '?2')} AS member, ${membersVisibleSql('g', '?2')} AS list FROM groups g WHERE g.id = ?1`)
            .bind(g.id, c.viewer?.user.id ?? '')
            .first<{ member: number; list: number }>();
          const what = `${setting}/${locked ? 'gesperrt' : 'offen'}/${c.role}`;
          expect(!!row!.member, what).toBe(canSeeMembership(role));
          expect(!!row!.list, what).toBe(canSeeMembers(setting, role));
        }
      }
    }
    await db.prepare('UPDATE groups SET locked_at = NULL, members_visible = ? WHERE id = ?').bind('members', g.id).run();
  });
});

// ---------------------------------------------------------------- F-440, F-441 Mitgliederliste

describe('F-440 Einstellung „Wer sieht die Mitgliederliste“', () => {
  it('[F-440] Standard „Nur Mitglieder“; nur der Eigner ändert; Unbekanntes 400', async () => {
    const { owner, g, pub } = await setup();
    expect((g as GroupOut & { membersVisible?: string }).membersVisible).toBe('members');
    const admin = await s.person();
    await s.join(owner, g, admin);
    // Admin ernennen und prüfen, dass er die Einstellung nicht ändern darf
    await s.send('PATCH', `/api/groups/${g.id}/members/${admin.user.id}`, owner.cookie, { role: 'admin' });
    expect((await s.send('PATCH', `/api/groups/${g.id}`, admin.cookie, { membersVisible: 'public' })).status).toBe(403);
    expect((await s.send('PATCH', `/api/groups/${g.id}`, pub.cookie, { membersVisible: 'public' })).status).toBe(403);
    expect(await s.errorOf(await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { membersVisible: 'alle' }))).toBe('invalid_members_visible');
    const res = await ok<{ group: { membersVisible: string } }>(await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { membersVisible: 'public' }));
    expect(res.group.membersVisible).toBe('public');
    expect((await page(g)).group.membersVisible).toBe('public');
  });
});

describe('F-441 Mitgliederliste je Betrachter', () => {
  it('[F-441] nur Mitglieder: Gast und Nicht-Mitglied sehen nur die Anzahl; Mitglied Namen bzw. Spaßname; Eigner alle Anzeigenamen; nie E-Mails', async () => {
    const { owner, g, pub, priv, stranger } = await setup();
    for (const viewer of [undefined, stranger]) {
      const d = await page(g, viewer);
      expect(d.membersHidden).toBe(true);
      expect(d.members).toEqual([]);
      expect(d.stats.members).toBe(3);
      expect(JSON.stringify(d)).not.toContain(pub.handle!);
    }
    const asMember = await page(g, pub);
    expect(asMember.membersHidden).toBe(false);
    expect(asMember.members).toHaveLength(3);
    const anon = asMember.members.find((m) => m.alias)!;
    expect(anon.handle).toBeNull();
    expect(anon.displayName).not.toContain(priv.handle!);
    expect(asMember.members.every((m) => m.id === null)).toBe(true);
    const asOwner = await page(g, owner);
    expect(asOwner.members.find((m) => m.id === priv.user.id)?.displayName).toBe(`Name ${priv.handle}`);
    for (const d of [asMember, asOwner]) for (const p of [owner, pub, priv]) expect(JSON.stringify(d)).not.toContain(p.email);
  });

  it('[F-441] öffentliche Liste: Gäste sehen Namen nur mit öffentlichem Profil, sonst den Spaßnamen dieser Gruppe – je Gruppe ein anderer', async () => {
    const { owner, g, pub, priv } = await setup();
    const g2 = await s.group(owner);
    await s.join(owner, g2, priv);
    for (const x of [g, g2]) await ok(await s.send('PATCH', `/api/groups/${x.id}`, owner.cookie, { membersVisible: 'public' }));
    const d = await page(g);
    expect(d.membersHidden).toBe(false);
    expect(d.members.filter((m) => m.handle).map((m) => m.handle).sort()).toEqual([owner.handle, pub.handle].sort());
    const alias1 = d.members.find((m) => m.alias)!.displayName;
    const alias2 = (await page(g2)).members.find((m) => m.alias)!.displayName;
    expect(alias1).not.toBe(alias2);
    expect(JSON.stringify(d)).not.toContain(`Name ${priv.handle}`);
    expect(JSON.stringify(d)).not.toContain(priv.user.id);
  });
});

// ---------------------------------------------------------------- F-442 Boote

describe('F-442 Boote der Gruppe folgen der Mitgliederliste', () => {
  it('[F-442] Gruppenseite, „Verein des Boots“ und Boots-Einträge im Stream: Gäste nur bei öffentlicher Liste, Mitglieder immer', async () => {
    const { owner, g, pub, stranger } = await setup();
    const boat = await s.boat(pub, { name: 'Kormoran' });
    expect((await s.send('POST', `/api/groups/${g.id}/boats`, pub.cookie, { boatId: boat.id })).status).toBe(201);
    const boatPage = async (p?: Person) => (await ok<{ clubs: Array<{ slug: string }> }>(await s.send('GET', `/api/boats/${boat.id}`, p?.cookie))).clubs;
    const boatItems = async (p?: Person) => (await ok<StreamOut>(await groupStream(g, p))).items.filter((i) => i.kind === 'boat');

    expect((await page(g)).boats).toEqual([]);
    expect((await page(g)).stats.boats).toBe(1);
    expect((await page(g, stranger)).boats).toEqual([]);
    expect((await page(g, owner)).boats.map((b) => b.name)).toEqual(['Kormoran']);
    expect(await boatPage()).toEqual([]);
    expect(await boatPage(stranger)).toEqual([]);
    expect((await boatPage(owner)).map((c) => c.slug)).toEqual([g.slug]);
    expect(await boatItems()).toEqual([]);
    expect(await boatItems(owner)).toHaveLength(1);

    await ok(await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { membersVisible: 'public' }));
    expect((await page(g)).boats.map((b) => b.name)).toEqual(['Kormoran']);
    expect((await boatPage(stranger)).map((c) => c.slug)).toEqual([g.slug]);
    // der Gruppen-Stream für Nicht-Mitglieder kommt bis zu 60 s aus dem öffentlichen Cache (Konzept 24.5) – Mitglieder ungecacht
    expect(await boatItems(pub)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- F-443 Beitritte

describe('F-443 Beitrittsmeldungen nur für Mitglieder derselben Gruppe', () => {
  it('[F-443] Gast, Nicht-Mitglied, Follower und Mitglieder des Vereins eines Teams nie; Mitglieder ja – Gruppen-, persönlicher und Community-Stream, RSS, Zähler', async () => {
    const { owner, g, pub, stranger } = await setup();
    const follower = await s.person({ profile: 'public' });
    expect((await s.send('PUT', `/api/follows/group/${g.id}`, follower.cookie)).status).toBe(200);
    const team = await s.group(owner, { kind: 'team', parentId: g.id });
    const teamJoiner = await s.person({ profile: 'public' });
    await s.join(owner, team, teamJoiner);

    // Gruppen-Stream: Gast, Nicht-Mitglied, Follower nicht; Mitglied ja
    for (const v of [undefined, stranger, follower]) expect(kinds(await ok<StreamOut>(await groupStream(g, v)))).not.toContain('member');
    expect(kinds(await ok<StreamOut>(await groupStream(g, pub)))).toContain('member');
    // persönlicher Stream: Follower ohne, Mitglied mit Beitritten; Vereinsmitglied sieht Team-Beitritte nicht
    expect(kinds(await ok<StreamOut>(await s.send('GET', '/api/stream', follower.cookie)))).not.toContain('member');
    const own = await ok<StreamOut>(await s.send('GET', '/api/stream', pub.cookie));
    expect(own.items.filter((i) => i.kind === 'member' && i.group?.slug === g.slug).length).toBeGreaterThan(0);
    expect(own.items.some((i) => i.kind === 'member' && i.group?.slug === team.slug)).toBe(false);
    // Community „Alles“ und RSS: nie
    expect(kinds(await ok<StreamOut>(await s.send('GET', `/api/stream/public?club=${g.slug}`, undefined)))).not.toContain('member');
    expect(kinds(await ok<StreamOut>(await s.send('GET', '/api/stream/public', undefined)))).not.toContain('member');
    expect(await (await h.fetch(`/g/${g.slug}/feed.xml`)).text()).not.toContain('beigetreten');
  });

  it('[F-443] Cache-Leck: der öffentliche 60-s-Cache enthält nie Beitritte – auch nicht, nachdem ein Mitglied gelesen hat', async () => {
    const { g, pub } = await setup();
    const guest1 = await groupStream(g);
    expect(guest1.headers.get('Cache-Control')).toContain('public');
    expect(kinds((await guest1.json()) as StreamOut)).not.toContain('member');
    const member = await groupStream(g, pub);
    expect(member.headers.get('Cache-Control')).toBe('private, no-store');
    expect(member.headers.get('X-Stream-Cache')).toBeNull();
    expect(kinds((await member.json()) as StreamOut)).toContain('member');
    const guest2 = await groupStream(g);
    expect(kinds((await guest2.json()) as StreamOut)).not.toContain('member');
  });
});

// ---------------------------------------------------------------- F-444 Mitglied von

describe('F-444 „Mitglied von“ im Profil', () => {
  it('[F-444] Verein im Profil nur für Mitglieder desselben Vereins und die Person selbst; Vorschau „als Mitglied“', async () => {
    const { owner, g, pub, stranger } = await setup();
    expect((await s.send('PUT', '/api/me/home', pub.cookie, { clubId: g.id })).status).toBe(200);
    const club = async (p?: Person, q = '') => (await ok<{ home: { club: { slug: string } | null } }>(await s.send('GET', `/api/profiles/${pub.handle}${q}`, p?.cookie))).home.club;
    expect(await club()).toBeNull();
    expect(await club(stranger)).toBeNull();
    expect((await club(owner))?.slug).toBe(g.slug);
    expect((await club(pub))?.slug).toBe(g.slug);
    expect(await club(pub, '?as=public')).toBeNull();
    expect((await club(pub, `?as=group:${g.id}`))?.slug).toBe(g.slug);
  });
});

// ---------------------------------------------------------------- F-445 Standard „Nur Mitglieder“

describe('F-445 Standard „Nur Mitglieder“ beim Schreiben in Gruppen', () => {
  it('[F-445] ohne Angabe: Gruppe „Nur Mitglieder“ (Gäste sehen ihn nicht), Profil öffentlich; „Öffentlich“ bleibt wählbar', async () => {
    const { owner, g } = await setup();
    const res = await ok<{ post: { id: string; visibility?: string } }>(await write(owner, g, { body: 'Ohne Angabe' }));
    const row = await (await s.db()).prepare('SELECT visibility, reach FROM posts WHERE id = ?').bind(res.post.id).first<{ visibility: string; reach: string }>();
    expect(row).toEqual({ visibility: 'members', reach: 'here' });
    const guestPosts = (await ok<StreamOut>(await groupStream(g))).items.filter((i) => i.post).map((i) => i.post!.id);
    expect(guestPosts).not.toContain(res.post.id);
    const pubPost = await ok<{ post: { id: string } }>(await write(owner, g, { body: 'Bewusst öffentlich', visibility: 'public' }));
    expect((await (await s.db()).prepare('SELECT visibility FROM posts WHERE id = ?').bind(pubPost.post.id).first<{ visibility: string }>())?.visibility).toBe('public');
    const prof = await ok<{ post: { id: string } }>(await s.send('POST', '/api/me/posts', owner.cookie, { body: 'Im Profil' }));
    expect((await (await s.db()).prepare('SELECT visibility FROM posts WHERE id = ?').bind(prof.post.id).first<{ visibility: string }>())?.visibility).toBe('public');
  });
});

// ---------------------------------------------------------------- F-446 Folgen und Mitgliedschaft

describe('F-446 Folgen ist keine Vorstufe der Mitgliedschaft', () => {
  const follows = async (p: Person, g: { id: string }) =>
    (await (await s.db()).prepare(`SELECT notify_level FROM follows WHERE user_id = ? AND target_kind = 'group' AND target_id = ?`).bind(p.user.id, g.id).first<{ notify_level: string | null }>()) ?? undefined;
  const memberLevel = async (p: Person, g: { id: string }) =>
    (await (await s.db()).prepare('SELECT notify_level FROM group_members WHERE user_id = ? AND group_id = ?').bind(p.user.id, g.id).first<{ notify_level: string | null }>())?.notify_level;

  it('[F-446] Folgen (Standard „Nur Direktes“) → Anfrage: folgt weiter → Beitritt: Follow fällt weg, gewählte Stufe geht mit; Mitglieder folgen nicht', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    const fan = await s.person({ profile: 'public' });
    expect((await s.send('PUT', `/api/follows/group/${g.id}`, fan.cookie)).status).toBe(200);
    expect((await page(g, fan)).social.notifyLevel).toBe('direct');
    expect((await setLevel(fan, 'group', g.id, 'all')).status).toBe(200);
    expect((await s.send('POST', `/api/groups/${g.id}/requests`, fan.cookie, { message: '' })).status).toBe(201);
    expect(await follows(fan, g)).toEqual({ notify_level: 'all' });
    expect((await s.send('POST', `/api/groups/${g.id}/requests/${fan.user.id}`, owner.cookie, { approve: true })).status).toBeLessThan(300);
    expect(await follows(fan, g)).toBeUndefined();
    expect(await memberLevel(fan, g)).toBe('all');
    const d = await page(g, fan);
    expect(d.membership.role).toBe('member');
    expect(d.social).toMatchObject({ isFollowing: false, notifyLevel: 'all' });
    expect(await s.errorOf(await s.send('PUT', `/api/follows/group/${g.id}`, fan.cookie))).toBe('already_member');
  });

  it('[F-446] Austreten: mit „Weiter folgen“ Folgen mit „Nur Direktes“, ohne nichts; geschlossene Gruppe nie', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const g = await s.group(owner);
    const a = await s.person();
    const b = await s.person();
    for (const p of [a, b]) await s.join(owner, g, p);
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me?follow=1`, a.cookie)).status).toBe(204);
    expect(await follows(a, g)).toEqual({ notify_level: null });
    expect((await page(g, a)).social).toMatchObject({ isFollowing: true, notifyLevel: 'direct' });
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me`, b.cookie)).status).toBe(204);
    expect(await follows(b, g)).toBeUndefined();
    const closed = await s.group(owner, { visibility: 'private' });
    const c = await s.person();
    await s.join(owner, closed, c);
    expect((await s.send('DELETE', `/api/groups/${closed.id}/members/me?follow=1`, c.cookie)).status).toBe(204);
    expect(await follows(c, closed)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- F-447 / F-448 automatische Einträge

describe('F-447 F-448 Automatische Einträge', () => {
  it('[F-447] Zähler ohne automatische Einträge (?joins=0): Beitritt und Boot zählen nicht, Beiträge schon', async () => {
    const { owner, g, pub } = await setup();
    await s.send('GET', '/api/stream/unread', pub.cookie); // ab jetzt zählen
    await (await s.db()).prepare('UPDATE users SET stream_seen_at = ? WHERE id = ?').bind(Date.now(), pub.user.id).run();
    const newbie = await s.person({ profile: 'public' });
    await s.join(owner, g, newbie);
    const boat = await s.boat(owner, { name: 'Basstölpel' });
    await s.send('POST', `/api/groups/${g.id}/boats`, owner.cookie, { boatId: boat.id });
    const count = async (q: string) => (await ok<{ count: number }>(await s.send('GET', `/api/stream/unread${q}`, pub.cookie))).count;
    expect(await count('')).toBe(2);
    expect(await count('?joins=0')).toBe(0);
    await write(owner, g, { body: 'Echter Beitrag' });
    expect(await count('?joins=0')).toBe(1);
  });

  it('[F-448] Beitritt, Boot und Austritt benachrichtigen nie – auch nicht bei „Alle Beiträge“; Beitrittsanfragen an Verwalter schon', async () => {
    const { owner, g, pub } = await setup();
    for (const p of [owner, pub]) await setLevel(p, 'group', g.id, 'all');
    const before = { owner: (await bell(owner)).length, pub: (await bell(pub)).length };
    const newbie = await s.person({ profile: 'public' });
    await s.join(owner, g, newbie);
    const boat = await s.boat(newbie, { name: 'Lumme' });
    await s.send('POST', `/api/groups/${g.id}/boats`, newbie.cookie, { boatId: boat.id });
    await s.send('DELETE', `/api/groups/${g.id}/members/me`, newbie.cookie);
    expect((await bell(owner)).length).toBe(before.owner);
    expect((await bell(pub)).length).toBe(before.pub);
    const asker = await s.person({ profile: 'public' });
    await s.send('POST', `/api/groups/${g.id}/requests`, asker.cookie, { message: '' });
    expect((await bell(owner)).filter((n) => n.kind === 'request')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- F-449 Stufen

describe('F-449 Benachrichtigungs-Stufen je Verlauf', () => {
  it('[F-449] Text-Beitrag nur „Alle Beiträge“; Pin ab „Wichtiges“ (ohne Doppel); „Nur Direktes“ und „Stumm“ nichts; stumm auch nicht im Stream', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner);
    const people = { all: await s.person(), important: await s.person(), direct: await s.person(), muted: await s.person() };
    for (const [level, p] of Object.entries(people)) {
      await s.join(owner, g, p);
      expect((await setLevel(p, 'group', g.id, level)).status).toBe(200);
    }
    const posted = await ok<{ post: { id: string } }>(await write(owner, g, { body: 'Training', visibility: 'members' }));
    const postBells = async (p: Person) => (await bell(p)).filter((n) => n.kind === 'post');
    expect(await postBells(people.all)).toHaveLength(1);
    for (const p of [people.important, people.direct, people.muted]) expect(await postBells(p)).toEqual([]);
    // Anpinnen = wichtig: „Wichtiges“ bekommt ihn jetzt, „Alle“ nicht doppelt
    expect((await s.send('PUT', `/api/posts/${posted.post.id}/pin`, owner.cookie, { channel: { kind: 'group', id: g.id }, pinned: true })).status).toBe(200);
    expect(await postBells(people.important)).toHaveLength(1);
    expect(await postBells(people.all)).toHaveLength(1);
    for (const p of [people.direct, people.muted]) expect(await postBells(p)).toEqual([]);
    // Stumm: auch nicht im persönlichen Stream (F-346)
    const ids = async (p: Person) => (await ok<StreamOut>(await s.send('GET', '/api/stream', p.cookie))).items.filter((i) => i.post).map((i) => i.post!.id);
    expect(await ids(people.direct)).toContain(posted.post.id);
    expect(await ids(people.muted)).not.toContain(posted.post.id);
  });

  it('[F-449] Anfragen (direkt) erreichen Verwalter bis „Nur Direktes“, nicht bei „Stumm“; Voreinstellung und Übersicht getrennt nach Mitgliedschaft und Folgen', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const g = await s.group(owner);
    expect((await setLevel(owner, 'group', g.id, 'direct')).status).toBe(200);
    await s.send('POST', `/api/groups/${g.id}/requests`, (await s.person()).cookie, { message: '' });
    expect((await bell(owner)).filter((n) => n.kind === 'request')).toHaveLength(1);
    const g2 = await s.group(owner);
    await setLevel(owner, 'group', g2.id, 'muted');
    await s.send('POST', `/api/groups/${g2.id}/requests`, (await s.person()).cookie, { message: '' });
    expect((await bell(owner)).filter((n) => n.kind === 'request')).toHaveLength(1);

    // Voreinstellung: nur all | important | direct; Übersicht trennt Mitgliedschaften und Folgen
    expect((await s.send('PUT', '/api/me/channels/default', owner.cookie, { level: 'muted' })).status).toBe(400);
    expect((await s.send('PUT', '/api/me/channels/default', owner.cookie, { level: 'all' })).status).toBe(200);
    const boatOwner = await s.person({ profile: 'public' });
    const boat = await s.boat(boatOwner);
    await s.send('PUT', `/api/follows/boat/${boat.id}`, owner.cookie);
    const ch = await ok<{ defaultLevel: string; channels: Array<{ kind: string; ref: string; member: boolean; level: string | null }> }>(await s.send('GET', '/api/me/channels', owner.cookie));
    expect(ch.defaultLevel).toBe('all');
    expect(ch.channels.filter((c) => c.member).map((c) => c.ref).sort()).toEqual([g.id, g2.id].sort());
    expect(ch.channels.filter((c) => !c.member)).toEqual([expect.objectContaining({ kind: 'boat', ref: boat.id, level: 'direct' })]);
    // nur, wo man Mitglied ist oder folgt; unbekannte Stufe 400
    expect((await setLevel(owner, 'harbor', 'Hrb000000000000001', 'all')).status).toBe(404);
    expect(await s.errorOf(await setLevel(owner, 'group', g.id, 'laut'))).toBe('invalid_level');
    // Einstellungen der Kanäle erhalten die Voreinstellung
    await s.send('PATCH', '/api/me/settings', owner.cookie, { notify: { comment: 'mail' } });
    expect((await ok<{ defaultLevel: string }>(await s.send('GET', '/api/me/channels', owner.cookie))).defaultLevel).toBe('all');
  });

  it('[F-449] Migration: stumm → „Stumm“, eingeschaltete neue Beiträge → Voreinstellung „Alle Beiträge“', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    const db = await s.db();
    await db.prepare('UPDATE group_members SET notify_level = NULL, muted_at = ? WHERE group_id = ?').bind(Date.now(), g.id).run();
    await db.prepare(`UPDATE users SET notify_prefs = '{"post":"push"}' WHERE id = ?`).bind(owner.user.id).run();
    // dieselben Anweisungen wie in 0032 (ohne ALTER)
    await db.prepare(`UPDATE group_members SET notify_level = 'muted' WHERE muted_at IS NOT NULL AND group_id = ?`).bind(g.id).run();
    await db
      .prepare(`UPDATE users SET notify_prefs = json_set(notify_prefs, '$.level', 'all') WHERE notify_prefs IS NOT NULL AND json_valid(notify_prefs) AND json_extract(notify_prefs, '$.post') IN ('none', 'mail', 'push') AND id = ?`)
      .bind(owner.user.id)
      .run();
    expect((await page(g, owner)).social.notifyLevel).toBe('muted');
    expect((await ok<{ defaultLevel: string }>(await s.send('GET', '/api/me/channels', owner.cookie))).defaultLevel).toBe('all');
  });
});
