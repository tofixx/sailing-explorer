// Funktionale Tests: Mitgliedschaft stumm schalten, Gruppe übergeben, „Meine Gruppen“ (F-346 … F-348).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';

const DAY = 86_400_000;
let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const postIds = (o: StreamOut) => o.items.filter((i) => i.post).map((i) => i.post!.id);
const stream = async (p: Person) => (await (await s.send('GET', '/api/stream', p.cookie)).json()) as StreamOut;
const post = async (owner: Person, g: { id: string }, body: string) =>
  ((await (await s.send('POST', `/api/groups/${g.id}/posts`, owner.cookie, { body })).json()) as { post: { id: string } }).post.id;
const mine = async (p: Person) =>
  (await (await s.send('GET', '/api/groups', p.cookie)).json()) as { groups: Array<{ slug: string; role: string; muted: boolean }>; requests: Array<{ id: string; slug: string }> };
const membership = async (g: { id: string }, p: Person) =>
  ((await (await s.send('GET', `/api/groups/${g.id}`, p.cookie)).json()) as { membership: { role: string | null; muted: boolean } }).membership;

describe('F-346 Neuigkeiten einer Gruppe stumm schalten', () => {
  it('[F-346] stumm: keine Beiträge im persönlichen Stream und keine Wochenmail – Mitglied bleibt man; laut wieder alles', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { name: 'Stummclub' });
    const reader = await s.person();
    await s.join(owner, g, reader);
    const p1 = await post(owner, g, 'Erster Beitrag');
    expect(postIds(await stream(reader))).toContain(p1);

    const res = await s.send('PUT', `/api/groups/${g.id}/mute`, reader.cookie, { muted: true });
    expect(res.status).toBe(200);
    expect(await membership(g, reader)).toMatchObject({ role: 'member', muted: true });
    expect((await mine(reader)).groups.find((x) => x.slug === g.slug)?.muted).toBe(true);
    expect(postIds(await stream(reader))).not.toContain(p1);

    // Wochenmail: stumme Gruppe zählt nicht
    await s.send('PATCH', '/api/me/settings', reader.cookie, { notifyGroups: 'weekly' });
    await post(owner, g, 'Zweiter Beitrag');
    await (await s.db()).prepare('UPDATE users SET groups_mailed_at = ? WHERE id = ?').bind(Date.now() - 8 * DAY, reader.user.id).run();
    const before = h.logs.length;
    await h.scheduled();
    expect(h.logs.slice(before).filter((l) => l.includes(`an ${reader.email}:`) && l.includes('Stummclub'))).toHaveLength(0);

    await s.send('PUT', `/api/groups/${g.id}/mute`, reader.cookie, { muted: false });
    expect(postIds(await stream(reader))).toContain(p1);
    // nur Mitglieder, nur true/false
    expect((await s.send('PUT', `/api/groups/${g.id}/mute`, (await s.person()).cookie, { muted: true })).status).toBe(403);
    expect((await s.send('PUT', `/api/groups/${g.id}/mute`, reader.cookie, { muted: 'ja' })).status).toBe(400);
  });
});

describe('F-347 Gruppe übergeben', () => {
  it('[F-347] Eigner übergibt nur an einen Admin; danach ist er Admin und kann austreten', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { name: 'Übergabeclub' });
    const adm = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    await s.join(owner, g, adm);
    await s.join(owner, g, member);
    await s.send('PATCH', `/api/groups/${g.id}/members/${adm.user.id}`, owner.cookie, { role: 'admin' });

    expect(await s.errorOf(await s.send('DELETE', `/api/groups/${g.id}/members/me`, owner.cookie))).toBe('owner_cannot_leave');
    expect(await s.errorOf(await s.send('POST', `/api/groups/${g.id}/owner`, owner.cookie, { userId: member.user.id }))).toBe('not_admin');
    expect((await s.send('POST', `/api/groups/${g.id}/owner`, adm.cookie, { userId: adm.user.id })).status).toBe(403);
    const res = await s.send('POST', `/api/groups/${g.id}/owner`, owner.cookie, { userId: adm.user.id });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await membership(g, adm)).toMatchObject({ role: 'owner' });
    expect(await membership(g, owner)).toMatchObject({ role: 'admin' });
    const row = await (await s.db()).prepare('SELECT owner_id FROM groups WHERE id = ?').bind(g.id).first<{ owner_id: string }>();
    expect(row?.owner_id).toBe(adm.user.id);
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me`, owner.cookie)).status).toBe(204);
  });
});

describe('F-348 Meine Gruppen', () => {
  it('[F-348] Liste mit Rolle und „stumm“, offene Anfragen mit Gruppen-ID zum Zurückziehen', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { name: 'Anfrageclub', joinMode: 'request' });
    const p = await s.person();
    expect((await s.send('POST', `/api/groups/${g.id}/requests`, p.cookie, { message: '' })).status).toBeLessThan(300);
    const out = await mine(p);
    expect(out.requests).toEqual([expect.objectContaining({ id: g.id, slug: g.slug })]);
    expect((await s.send('DELETE', `/api/groups/${g.id}/requests/me`, p.cookie)).status).toBeLessThan(300);
    expect((await mine(p)).requests).toHaveLength(0);
    expect((await mine(owner)).groups.find((x) => x.slug === g.slug)).toMatchObject({ role: 'owner', muted: false });
  });
});
