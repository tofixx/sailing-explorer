// Einladen über den Profilnamen (F-593): Freunde (`POST /api/invites`) und Gruppen (`POST /api/groups/:id/invites`)
// nehmen `{ handle }` – seit `sx-invite-box` auch in der Oberfläche. Nicht öffentliche, ausgeblendete, gesperrte und
// unbekannte Profile sind nicht unterscheidbar; Sperre und Rate-Grenze greifen vor dem Nachschlagen.
// Echter Worker in workerd (Miniflare).
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
}, 60_000);

const run = async (sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).run();
const body = async (r: Response) => ({ status: r.status, ...((await r.json()) as { error?: string; message?: string }) });

describe('F-593 Einladen über den Profilnamen', () => {
  it('[F-593] nicht öffentlich, ausgeblendet, gesperrt und unbekannt geben dieselbe 404 – bei Freunden und Gruppen', async () => {
    const priv = await s.person({ profile: 'private' });
    const unlisted = await s.person({ profile: 'unlisted' });
    const hidden = await s.person({ profile: 'public' });
    const suspended = await s.person({ profile: 'public' });
    await run('UPDATE profiles SET hidden_at = ? WHERE user_id = ?', Date.now(), hidden.user.id);
    await run('UPDATE users SET suspended_at = ? WHERE id = ?', Date.now(), suspended.user.id);

    let unknown: Awaited<ReturnType<typeof body>> | null = null;
    // je Fall ein eigenes einladendes Konto – die Rate-Grenze (5/min) zählt auch Fehlversuche (F-593)
    for (const handle of ['gibt-es-nicht-xyz', priv.handle, unlisted.handle, hidden.handle, suspended.handle]) {
      const a = await s.person({ profile: 'public', supporter: true });
      const g = await s.group(a, { joinMode: 'request' });
      const f = await body(await s.send('POST', '/api/invites', a.cookie, { handle }));
      unknown ??= f;
      expect(f).toEqual(unknown);
      expect(await body(await s.send('POST', `/api/groups/${g.id}/invites`, a.cookie, { handle: `@${handle}` }))).toEqual(unknown);
      const n = await (await s.db()).prepare('SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ?').bind(a.user.id).first<{ n: number }>();
      expect(n?.n).toBe(0);
    }
    expect(unknown).toMatchObject({ status: 404, error: 'profile_not_found' });
  });

  it('[F-593] eigener Profilname: own_object; schon Mitglied: already_member; zweimal: already_invited', async () => {
    const a = await s.person({ profile: 'public' });
    const owner = await s.person({ profile: 'public', supporter: true });
    const b = await s.person({ profile: 'public' });
    const m = await s.person({ profile: 'public' });
    const g = await s.group(owner, { joinMode: 'open' });
    expect((await s.send('POST', `/api/groups/${g.id}/requests`, m.cookie, { message: '' })).status).toBe(201);

    // Freunde (drei Anfragen von a)
    expect(await body(await s.send('POST', '/api/invites', a.cookie, { handle: a.handle }))).toMatchObject({ status: 409, error: 'own_object' });
    const friend = await s.send('POST', '/api/invites', a.cookie, { handle: b.handle });
    expect(friend.status, await friend.clone().text()).toBe(201);
    const fj = (await friend.json()) as { link?: string; invite: unknown };
    expect(fj.link).toBeUndefined(); // gebunden: kein Link, der Name statt einer Adresse
    expect(fj.invite).toMatchObject({ email: null, invitee: { handle: b.handle } });
    expect(await body(await s.send('POST', '/api/invites', a.cookie, { handle: b.handle }))).toMatchObject({ status: 409, error: 'already_invited' });

    // Gruppe (vier Anfragen des Eigners)
    expect(await body(await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, { handle: owner.handle }))).toMatchObject({ status: 409, error: 'own_object' });
    expect(await body(await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, { handle: m.handle }))).toMatchObject({ status: 409, error: 'already_member' });
    expect((await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, { handle: b.handle })).status).toBe(201);
    expect(await body(await s.send('POST', `/api/groups/${g.id}/invites`, owner.cookie, { handle: b.handle }))).toMatchObject({ status: 409, error: 'already_invited' });
  });

  it('[F-593] Rate-Grenze vor dem Nachschlagen: auch erfolglose Profilnamen zählen, der sechste Versuch je Minute ist 429', async () => {
    const a = await s.person({ profile: 'public' });
    const got: number[] = [];
    for (let i = 0; i < 6; i++) got.push((await s.send('POST', '/api/invites', a.cookie, { handle: `gibt-es-nicht-${i}` })).status);
    expect(got).toEqual([404, 404, 404, 404, 404, 429]);
  });

  it('[F-593] gesperrtes Konto lädt nicht ein – auch nicht zum Ausprobieren von Profilnamen (Sperre vor dem Nachschlagen)', async () => {
    const a = await s.person({ profile: 'public', supporter: true });
    const g = await s.group(a, { joinMode: 'request' });
    const b = await s.person({ profile: 'public' });
    await run('UPDATE users SET suspended_at = ? WHERE id = ?', Date.now(), a.user.id);
    for (const handle of [b.handle, 'gibt-es-nicht-xyz']) {
      const f = await s.send('POST', '/api/invites', a.cookie, { handle });
      const gr = await s.send('POST', `/api/groups/${g.id}/invites`, a.cookie, { handle });
      expect([f.status, gr.status]).toEqual([403, 403]);
    }
  });
});
