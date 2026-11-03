// Funktionale Tests: öffentlicher Community-Stream ohne automatische Einträge (F-550) – Alles, Filter, Umgebung, Seiten.
// Eigener Worker: der 60-s-Cache von /api/stream/public ist je Worker, so sieht dieser Test nur seine eigenen Daten.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';
import { ACTIVITY_KINDS, AUTOMATIC_KINDS, STREAM_POST_KINDS, STREAM_SCAN, isAutomaticKind } from '../../src/domain/groups';
import { PUBLIC_TARGETS_SQL, RECENT_POSTS_SQL } from '../../worker/stream-sql';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker({ APP_ORIGIN: 'https://segeln.example' });
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const get = async (path: string, p?: Person) => {
  const res = await s.send('GET', path, p?.cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as StreamOut;
};

/** Alle Seiten eines Streams (höchstens 20) – erste Seite einzeln zurück. */
async function walk(path: string) {
  const first = await get(path);
  const items = [...first.items];
  let cursor = first.cursor;
  for (let n = 0; cursor && n < 20; n++) {
    const next = await get(`${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`);
    items.push(...next.items);
    cursor = next.cursor;
  }
  return { first, items };
}

describe('F-550 Öffentlicher Stream ohne automatische Einträge', () => {
  it('[F-550] Alles, Hafen-/Vereinsfilter und Umgebung: keine Beitritte, Boote, Meilensteine; Seiten nicht leer trotz vieler neuerer automatischer Einträge', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const hres = await s.send('POST', '/api/harbors', owner.cookie, { name: s.uniq('Ohneauto-Hafen'), lat: -30, lon: 100 });
    const { harbor } = (await hres.json()) as { harbor: { id: string; slug: string } };
    const club = await s.group(owner, { name: 'Ohneauto-Verein', harborId: harbor.id });
    const newbie = await s.person({ profile: 'public' });
    await s.join(owner, club, newbie); // Beitritt (member)
    const boat = await s.boat(owner, { harborId: harbor.id, name: 'Austernfischer' });
    await s.send('POST', `/api/groups/${club.id}/boats`, owner.cookie, { boatId: boat.id }); // Boot in der Gruppe (boat)
    const voyage = await s.share(owner, { boatId: boat.id });
    const pres = await s.send('POST', `/api/groups/${club.id}/posts`, owner.cookie, { visibility: 'public', body: 'Ohne Automatik' });
    const postId = ((await pres.json()) as { post: { id: string } }).post.id;

    // Mehr automatische Einträge (und eine unbekannte Art), als eine Abfrage liest – alle neuer als Törn und Beitrag
    const db = await s.db();
    const base = Date.now() + 1_000;
    const rows = Array.from({ length: STREAM_SCAN + 5 }, (_, i) => ({ id: `aOhneAuto${String(i).padStart(3, '0')}`, kind: i === 0 ? 'zukunft' : 'member', at: base + i }));
    for (const r of rows) {
      await db.prepare('INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, group_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(r.id, r.kind, newbie.user.id, 'group', club.id, club.id, r.at, r.at).run();
      for (const [k, id] of [['group', club.id], ['harbor', harbor.id]])
        await db.prepare('INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES (?, ?, ?, ?)').bind(r.id, k, id, r.at).run();
    }

    // Gegenprobe: im Gruppen-Verlauf (für Mitglieder) bleiben automatische Einträge (F-447, F-350)
    expect((await get(`/api/groups/${club.id}/stream`, owner)).items.some((i) => isAutomaticKind(i.kind))).toBe(true);

    const paths = {
      all: '/api/stream/public',
      club: `/api/stream/public?club=${club.slug}`,
      harbor: `/api/stream/public?harbor=${harbor.slug}`,
      near: '/api/stream/near?lat=-30&lon=100.1',
    };
    for (const [name, path] of Object.entries(paths)) {
      const { first, items } = await walk(path);
      expect(items.filter((i) => isAutomaticKind(i.kind)).map((i) => i.kind), name).toEqual([]);
      // erste Seite trägt den Inhalt – keine leere Seite mit Cursor vor lauter automatischen Einträgen
      expect(first.items.length, name).toBeGreaterThan(0);
      const ids = first.items.map((i) => i.post?.id ?? i.voyage?.id);
      if (name !== 'harbor') expect(ids, name).toContain(postId);
      if (name !== 'club') expect(ids, name).toContain(voyage.id);
      expect(new Set(items.map((i) => i.id)).size, name).toBe(items.length);
    }
    // angemeldet dieselben Einträge (Cache ohne Betrachter)
    const signed = await get(paths.all, owner);
    expect(signed.items.map((i) => i.id)).toEqual((await get(paths.all)).items.map((i) => i.id));
  });

  it('[F-550] Beiträge und automatische Arten teilen ACTIVITY_KINDS lückenlos und überschneidungsfrei', () => {
    expect(STREAM_POST_KINDS.filter((k) => (AUTOMATIC_KINDS as readonly string[]).includes(k))).toEqual([]);
    expect([...STREAM_POST_KINDS, ...AUTOMATIC_KINDS].sort()).toEqual([...ACTIVITY_KINDS].sort());
    expect(STREAM_POST_KINDS.some((k) => isAutomaticKind(k))).toBe(false);
  });

  it('[F-550] die Abfragen ohne automatische Einträge nutzen ihren Index (kein SCAN, keine Sortierung im Speicher)', async () => {
    const db = await s.db();
    const plan = async (sql: string, ...args: unknown[]) =>
      (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()).results.map((r) => r.detail).join('\n');
    const near = await plan(PUBLIC_TARGETS_SQL, '[["harbor","x"]]', Date.now(), '~', STREAM_SCAN);
    expect(near).toMatch(/SEARCH t USING (COVERING )?INDEX (activity_target_feed|sqlite_autoindex_activity_target_1)/);
    expect(near).toMatch(/SEARCH a USING INDEX sqlite_autoindex_activity_1/);
    expect(near).not.toMatch(/SCAN t\b/);
    const recent = await plan(RECENT_POSTS_SQL, Date.now(), '~', STREAM_SCAN);
    expect(recent).toMatch(/(SCAN|SEARCH) activity USING INDEX activity_recent/);
    expect(recent).not.toMatch(/TEMP B-TREE/);
  });
});
