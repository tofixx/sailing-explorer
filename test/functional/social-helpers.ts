// Gemeinsame Helfer für die Tests zu Vereinen, Teams, Folgen und Neuigkeiten (Konzept 11).
import { expect } from 'vitest';
import { createShare, login, loginSupporter, type Harness } from './worker-harness';

const DAY = 86_400_000;

export interface Person {
  cookie: string;
  user: { id: string; email: string };
  email: string;
  handle?: string;
}

export interface GroupOut {
  id: string;
  slug: string;
  name: string;
  kind: 'club' | 'team';
  visibility: string;
  shareKey: string | null;
  link: string | null;
  role: string | null;
  joinMode: string;
}

let n = 0;

export function social(h: Harness) {
  const email = (tag = 'g') => `${tag}${++n}-${Date.now()}@example.org`;
  const uniq = (base: string) => `${base}-${(++n).toString(36)}${Date.now().toString(36).slice(-4)}`;
  const send = (method: string, path: string, cookie: string | undefined, body?: unknown, headers: Record<string, string> = {}) =>
    h.fetch(path, {
      method,
      cookie,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  const db = () => h.db();
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

  async function person(o: { profile?: 'public' | 'unlisted' | 'private' | null; supporter?: boolean } = {}): Promise<Person> {
    const mail = email();
    const s = o.supporter || (o.profile && o.profile !== 'public') ? await loginSupporter(h, mail) : await login(h, mail);
    // Konto älter als 24 h (wie in den Moderationstests)
    await (await db()).prepare('UPDATE users SET created_at = created_at - ? WHERE id = ?').bind(2 * DAY, s.user.id).run();
    if (o.profile === null || o.profile === undefined) return { ...s, email: mail };
    const handle = uniq('seg');
    const res = await send('PUT', '/api/me/profile', s.cookie, { handle, displayName: `Name ${handle}`, bio: '', visibility: o.profile });
    expect(res.status, await res.clone().text()).toBe(200);
    return { ...s, email: mail, handle };
  }

  async function group(owner: Person, o: Record<string, unknown> = {}): Promise<GroupOut> {
    const res = await send('POST', '/api/groups', owner.cookie, { kind: 'club', name: 'Segelclub Möwe', slug: uniq('sc'), ...o });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { group: GroupOut }).group;
  }

  /** Mitglied per Einladungslink. */
  async function join(admin: Person, g: { id: string }, who: Person): Promise<void> {
    const inv = await send('POST', `/api/groups/${g.id}/invites`, admin.cookie, {});
    expect(inv.status, await inv.clone().text()).toBe(201);
    const { link } = (await inv.json()) as { link: string };
    const token = /#token=([A-Za-z0-9_-]+)$/.exec(link)![1];
    const acc = await send('POST', '/api/invites/accept', who.cookie, { token });
    expect(acc.status, await acc.clone().text()).toBe(200);
  }

  async function boat(owner: Person, o: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
    const res = await send('POST', '/api/boats', owner.cookie, { name: 'Seeschwalbe', visibility: 'public', ...o });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { boat: { id: string; name: string } }).boat;
  }

  async function share(owner: Person, o: { visibility?: string; title?: string; boatId?: string; distNm?: number; startedAt?: number } = {}) {
    const headers: Record<string, string> = {};
    if (o.boatId) headers['X-Share-Boat'] = o.boatId;
    if (o.distNm !== undefined) headers['X-Share-Distance'] = String(o.distNm);
    if (o.startedAt !== undefined) headers['X-Share-Started'] = String(o.startedAt);
    const res = await createShare(h, owner.cookie, { visibility: o.visibility ?? 'public', title: o.title ?? 'Ostsee-Törn', headers });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { share: { id: string; shareKey: string | null } }).share;
  }

  return { email, uniq, send, db, errorOf, person, group, join, boat, share };
}

export interface StreamOut {
  items: Array<{
    id: string;
    kind: string;
    createdAt: number;
    actor: { handle: string; displayName: string } | null;
    group: { slug: string; name: string; kind: string } | null;
    voyage?: { id: string; title: string; boat: { id: string; name: string } | null };
    photos?: { count: number; thumbs: string[] };
    post?: { id: string; body: string; link: string | null; canDelete: boolean };
    boat?: { id: string; name: string };
    milestone?: { nm: number; year: number; subject: string; name: string; path: string };
  }>;
  cursor: string | null;
  hasGroups?: boolean;
}
