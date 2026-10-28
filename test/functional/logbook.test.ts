// Funktionale Tests: Fahrtenbuch – Törns ohne GPX (Konzept 19, F-300 … F-311) gegen den echten Worker (Miniflare).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { manualExpiry } from '../../src/domain/logbook';
import { shareExpiry } from '../../src/domain/support';

const DAY = 86_400_000;
const ADMIN_ID = 'AdminLogbookAAAAAA1';
let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  const owner = await s.person();
  const mk = async (name: string, pos: { lat: number; lon: number }) =>
    ((await (await s.send('POST', '/api/harbors', owner.cookie, { name: port(name), ...pos })).json()) as { harbor: { id: string } }).harbor.id;
  shared.from = await mk('Potsdam', POTSDAM);
  shared.to = await mk('Werder', WERDER);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface LogShare {
  id: string;
  title: string;
  summary: string;
  source: string;
  distSource: string;
  distNm: number;
  startedAt: number;
  endedAt: number | null;
  sizeBytes: number;
  trackCount: number;
  expiresAt: number | null;
  from: { slug: string; name: string; lat: number | null; lon: number | null } | null;
  to: { slug: string; name: string; lat: number | null; lon: number | null } | null;
  log: Record<string, unknown>;
}

let n = 0;
/** Eindeutiger Hafenname je Test (Häfen sind global) */
const port = (base: string) => `${base} ${++n}${Date.now().toString(36).slice(-4)}`;
/** Potsdam und Werder (Havel): ≈ 4,6 sm Luftlinie */
const POTSDAM = { lat: 52.39, lon: 13.06 };
const WERDER = { lat: 52.38, lon: 12.94 };
const recent = (daysAgo = 1) => Date.now() - daysAgo * DAY;

/** Gemeinsame Häfen (neue Häfen sind auf 10 je Konto und Tag begrenzt) */
const shared = { from: '', to: '' };

function entry(o: Record<string, unknown> = {}) {
  return {
    startedAt: recent(),
    fromHarbor: { harborId: shared.from },
    toHarbor: { harborId: shared.to },
    distNm: 8,
    ...o,
  };
}

async function manual(p: Person, o: Record<string, unknown> = {}, status = 201): Promise<LogShare> {
  const res = await s.send('POST', '/api/shares/manual', p.cookie, entry(o));
  expect(res.status, await res.clone().text()).toBe(status);
  return ((await res.json()) as { share: LogShare }).share;
}

const errorOf = async (res: Response) => ((await res.json()) as { error: string; message: string });

describe('F-300 Fahrtenbuch-Eintrag ohne GPX', () => {
  it('[F-300] legt einen Törn mit source manual, Häfen, Route in R2 und Titel-Vorschlag an', async () => {
    const p = await s.person({ profile: 'public' });
    const share = await manual(p, { fromHarbor: { name: port('Potsdam'), ...POTSDAM }, toHarbor: { name: port('Werder'), ...WERDER }, log: { notes: 'Schöner Tag' } });
    expect(share).toMatchObject({ source: 'manual', distSource: 'stated', distNm: 8, trackCount: 0 });
    expect(share.title).toMatch(/^Potsdam \S+ → Werder \S+$/);
    expect(share.summary).toMatch(/8,0 sm · .* · Fahrtenbuch/);
    expect(share.from).toMatchObject({ lat: POTSDAM.lat, lon: POTSDAM.lon });
    expect(share.log).toEqual({ notes: 'Schöner Tag' });
    // Payload im bestehenden Format: gzip, beginnt mit {"v":1, und enthält die Route
    const data = await h.fetch(`/api/shares/${share.id}/data`, { cookie: p.cookie });
    expect(data.status).toBe(200);
    const payload = JSON.parse(await data.text()) as { v: number; tracks: unknown[]; route: number[][] };
    expect(payload).toEqual({ v: 1, tracks: [], route: [[POTSDAM.lat, POTSDAM.lon], [WERDER.lat, WERDER.lon]] });
    expect(share.sizeBytes).toBeGreaterThan(0);
  });

  it('[F-300] ohne Strecke zählt die Linie zwischen den Häfen (dist_source route); Rundtörn mit einem Punkt', async () => {
    const p = await s.person();
    const routed = await manual(p, { distNm: undefined });
    expect(routed.distSource).toBe('route');
    expect(routed.distNm).toBeGreaterThan(4);
    expect(routed.distNm).toBeLessThan(5.5);
    const home = port('Heimathafen');
    const round = await manual(p, { fromHarbor: { name: home, ...POTSDAM }, toHarbor: null, distNm: 12 });
    expect(round.title).toBe(`Rundtörn ab ${home}`);
    expect(round.to?.slug).toBe(round.from?.slug);
    const payload = JSON.parse(await (await h.fetch(`/api/shares/${round.id}/data`, { cookie: p.cookie })).text()) as { route: number[][] };
    expect(payload.route).toHaveLength(1);
  });

  it('[F-300] nur angemeldet (L5); ohne Position beider Häfen 400', async () => {
    expect((await s.send('POST', '/api/shares/manual', undefined, entry())).status).toBe(401);
    const p = await s.person();
    const res = await s.send('POST', '/api/shares/manual', p.cookie, entry({ fromHarbor: { name: port('Ohne') }, toHarbor: null }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe('harbor_position');
  });

  it('[F-300] kostenlos nur öffentlich (E1); zählt nicht zu den 3 kostenlosen Törns', async () => {
    const p = await s.person();
    expect((await s.send('POST', '/api/shares/manual', p.cookie, entry({ visibility: 'private' }))).status).toBe(402);
    for (let i = 0; i < 4; i++) await manual(p);
    // die 3 kostenlosen GPX-Törns sind weiter frei
    expect((await createShare(h, p.cookie)).status).toBe(201);
    const sup = (await (await s.send('GET', '/api/me/support', p.cookie)).json()) as { sharesUsed: number; logEntriesUsed: number; logEntriesMax: number };
    expect(sup).toMatchObject({ sharesUsed: 1, logEntriesUsed: 4, logEntriesMax: 100 });
  });
});

describe('F-301 Fahrtenbuch-Angaben', () => {
  it('[F-301] prüft Felder: Wind, Seegang, Motorstunden, Längen; bereinigt Texte', async () => {
    const p = await s.person();
    const ok = await manual(p, { log: { engineH: 1.26, wind: { bft: 4, dir: 'W' }, sea: 'slight', sails: '  Groß 1. Reff,\nFock ', berth: 'Steg B' } });
    expect(ok.log).toEqual({ engineH: 1.3, wind: { bft: 4, dir: 'W' }, sea: 'slight', sails: 'Groß 1. Reff, Fock', berth: 'Steg B' });
    for (const bad of [{ wind: { bft: 13 } }, { sea: 'tsunami' }, { engineH: -1 }, { sails: 'x'.repeat(121) }, { notes: 'x'.repeat(2001) }, { wind: { bft: 3, dir: 'NNW' } }]) {
      const res = await s.send('POST', '/api/shares/manual', p.cookie, entry({ log: bad }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect((await errorOf(res)).error).toBe('invalid_log');
    }
  });

  it('[F-301] PATCH: Angaben und Häfen auch an GPX-Törns; Datum und Strecke nur bei Einträgen ohne GPX', async () => {
    const p = await s.person();
    const gpx = ((await (await createShare(h, p.cookie)).json()) as { share: LogShare }).share;
    const res = await s.send('PATCH', `/api/shares/${gpx.id}`, p.cookie, { log: { engineH: 2 }, fromHarbor: { name: port('Hafen') } });
    expect(res.status, await res.clone().text()).toBe(200);
    const patched = ((await res.json()) as { share: LogShare }).share;
    expect(patched.log).toEqual({ engineH: 2 });
    expect(patched.from?.name).toMatch(/^Hafen /);
    expect(patched.source).toBe('gpx');
    expect((await s.send('PATCH', `/api/shares/${gpx.id}`, p.cookie, { distNm: 500 })).status).toBe(409);

    const m = await manual(p);
    const moved = ((await (await s.send('PATCH', `/api/shares/${m.id}`, p.cookie, { distNm: 9.5, toHarbor: { name: port('Caputh'), lat: 52.35, lon: 13.0 } })).json()) as { share: LogShare }).share;
    expect(moved).toMatchObject({ distNm: 9.5, distSource: 'stated' });
    expect(moved.to?.lat).toBe(52.35);
    const payload = JSON.parse(await (await h.fetch(`/api/shares/${m.id}/data`, { cookie: p.cookie })).text()) as { route: number[][] };
    expect(payload.route[1]).toEqual([52.35, 13.0]);
    // Speicherzähler folgt der neuen Payload-Größe
    const row = await (await h.db()).prepare('SELECT size_bytes FROM shares WHERE id = ?').bind(m.id).first<{ size_bytes: number }>();
    expect(row?.size_bytes).toBe(moved.sizeBytes);
  });

  it('[F-301] fremde Törns: 404', async () => {
    const a = await s.person();
    const b = await s.person();
    const m = await manual(a);
    expect((await s.send('PATCH', `/api/shares/${m.id}`, b.cookie, { log: { notes: 'fremd' } })).status).toBe(404);
  });
});

describe('F-303 Herkunft der Distanz und „davon aufgezeichnet“', () => {
  it('[F-303] Boot, Profil und Gruppe nennen aufgezeichnete Seemeilen getrennt', async () => {
    const p = await s.person({ profile: 'public' });
    const b = await s.boat(p);
    const g = await s.group(p);
    await s.share(p, { boatId: b.id, distNm: 20 });
    await manual(p, { boatId: b.id, distNm: 10 });
    const boat = (await (await s.send('GET', `/api/boats/${b.id}`, p.cookie)).json()) as { stats: { distNm: number; recordedNm: number } };
    expect(boat.stats).toMatchObject({ distNm: 30, recordedNm: 20 });
    const prof = (await (await s.send('GET', `/api/profiles/${p.handle}`, undefined)).json()) as { stats: { distNm: number; recordedNm: number } };
    expect(prof.stats).toMatchObject({ distNm: 30, recordedNm: 20 });
    const grp = (await (await s.send('GET', `/api/groups/slug/${g.slug}`, p.cookie)).json()) as { stats: { distNm: number; recordedNm: number } };
    expect(grp.stats).toMatchObject({ distNm: 30, recordedNm: 20 });
  });
});

describe('F-304 Plausibilität', () => {
  const bad = async (p: Person, o: Record<string, unknown>, code = 'implausible_distance') => {
    const res = await s.send('POST', '/api/shares/manual', p.cookie, entry(o));
    expect(res.status, JSON.stringify(o)).toBe(400);
    expect((await errorOf(res)).error).toBe(code);
  };

  it('[F-304] Strecke ≥ Linie zwischen den Häfen, ≤ 2.000 sm, ≤ 120 sm je Tag ohne Uhrzeiten, ≤ 15 kn mit Uhrzeiten, ≤ 30 Tage', async () => {
    const p = await s.person();
    await bad(p, { distNm: 2 }); // Luftlinie ≈ 4,6 sm
    await bad(p, { distNm: 2001, startedAt: recent(40), endedAt: recent(20) });
    await bad(p, { distNm: 130 });
    const t = recent(2);
    await bad(p, { distNm: 50, startedAt: t, endedAt: t + 3 * 3_600_000, timed: true }); // 16,7 kn
    await bad(p, { distNm: 100, startedAt: recent(40), endedAt: recent(5) });
    await manual(p, { distNm: 40, startedAt: t, endedAt: t + 3 * 3_600_000, timed: true }); // 13,3 kn
    await manual(p, { distNm: 230, startedAt: recent(3), endedAt: recent(2) }); // zwei Kalendertage
  });

  it('[F-304] Abfahrt nicht in der Zukunft und höchstens 5 Jahre zurück; 20 neue Einträge je Tag', async () => {
    const p = await s.person();
    await bad(p, { startedAt: Date.now() + 3 * DAY }, 'invalid_date');
    await bad(p, { startedAt: Date.now() - 6 * 365 * DAY }, 'invalid_date');
    const db = await h.db();
    // 20 Einträge „heute“ direkt anlegen, damit der Test schnell bleibt
    for (let i = 0; i < 20; i++) {
      await db.prepare("INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at, source, started_at) VALUES (?, ?, 'x', 0, 0, ?, ?, 'manual', ?)")
        .bind(`daily${n}x${i}${Math.random().toString(36).slice(2, 8)}`, p.user.id, Date.now(), Date.now(), recent(400)).run();
    }
    const res = await s.send('POST', '/api/shares/manual', p.cookie, entry());
    expect(res.status).toBe(429);
    expect((await errorOf(res)).error).toBe('log_quota');
  });
});

describe('F-305 Kontingent je Saison der Abfahrt', () => {
  it('[F-305] 100 Einträge je Saison der Abfahrt, für alle Stufen; andere Saison und Löschen geben Platz', async () => {
    const p = await s.person({ supporter: true });
    const db = await h.db();
    const season = new Date(recent(30)).getUTCFullYear() + (new Date(recent(30)).getUTCMonth() >= 10 ? 1 : 0);
    const startInSeason = Date.UTC(season - 1, 10, 15);
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `quota${n}x${i}${Math.random().toString(36).slice(2, 8)}`;
      ids.push(id);
      // Anlegen „vor zwei Tagen“, damit das Tageslimit nicht greift
      await db.prepare("INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at, source, started_at) VALUES (?, ?, 'x', 0, 0, ?, ?, 'manual', ?)")
        .bind(id, p.user.id, recent(2), recent(2), startInSeason).run();
    }
    const full = await s.send('POST', '/api/shares/manual', p.cookie, entry({ startedAt: recent(30) }));
    expect(full.status).toBe(409);
    expect((await errorOf(full)).message).toBe(`100 Fahrtenbuch-Einträge für ${season} erreicht – bitte einen älteren löschen.`);
    // andere Saison: frei
    await manual(p, { startedAt: Date.UTC(season - 2, 5, 1) });
    // Löschen gibt den Platz frei
    await db.prepare('DELETE FROM shares WHERE id = ?').bind(ids[0]).run();
    await manual(p, { startedAt: recent(30) });
  });
});

describe('F-306 Aufbewahrung manueller Einträge (L2)', () => {
  it('[F-306] EXPIRES_SQL rechnet wie manualExpiry bzw. shareExpiry – je nach source', async () => {
    const { EXPIRES_SQL } = await import('../../worker/expiry-sql');
    const db = await h.db();
    const owner = await login(h, `exp${Date.now()}@example.org`);
    const times = [Date.UTC(2026, 0, 1), Date.UTC(2026, 9, 31, 23, 59), Date.UTC(2026, 10, 1), Date.UTC(2027, 11, 31, 23)];
    for (const t of times) {
      for (const source of ['manual', 'gpx']) {
        const id = `exp${source}${t}${Math.random().toString(36).slice(2, 8)}`;
        await db.prepare('INSERT INTO shares (id, user_id, title, size_bytes, track_count, created_at, updated_at, source) VALUES (?, ?, ?, 0, 0, ?, ?, ?)').bind(id, owner.user.id, 'x', t, t, source).run();
        const row = await db.prepare(`SELECT ${EXPIRES_SQL} AS e FROM shares s WHERE s.id = ?`).bind(id).first<{ e: number }>();
        expect(row?.e, `${source} ${new Date(t).toISOString()}`).toBe(source === 'manual' ? manualExpiry(t, null) : shareExpiry(t, null));
      }
    }
    // angelegt 2026 → gelöscht 1.2.2028
    expect(manualExpiry(Date.UTC(2026, 5, 1), null)).toBe(Date.UTC(2028, 1, 1));
  });

  it('[F-306] der nächtliche Lauf löscht abgelaufene Einträge samt Payload und Zähleranteil', async () => {
    const p = await s.person();
    const m = await manual(p);
    const db = await h.db();
    await db.prepare('UPDATE shares SET created_at = ? WHERE id = ?').bind(Date.UTC(new Date().getUTCFullYear() - 3, 5, 1), m.id).run();
    await h.scheduled();
    expect(await db.prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(m.id).first()).toBeNull();
    expect(await (await h.r2()).head(`shares/${m.id}`)).toBeNull();
  });
});

describe('F-307 Hafenposition (L3)', () => {
  it('[F-307] neuer Hafen: Anleger:in setzt die Position beim Anlegen (POST /api/harbors und Fahrtenbuch)', async () => {
    const p = await s.person();
    const res = await s.send('POST', '/api/harbors', p.cookie, { name: port('Kladow'), lat: 52.45, lon: 13.14 });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { harbor: { lat: number } }).harbor.lat).toBe(52.45);
  });

  it('[F-307] fremder Hafen ohne Position: nur Anleger:in; Altbestand ohne Anleger:in – wer zuerst setzt, wird Anleger:in', async () => {
    const a = await s.person();
    const b = await s.person();
    const name = port('Ketzin');
    expect((await s.send('POST', '/api/harbors', a.cookie, { name })).status).toBe(201);
    const res = await s.send('POST', '/api/shares/manual', b.cookie, entry({ fromHarbor: { name, ...POTSDAM } }));
    expect(res.status).toBe(403);

    const db = await h.db();
    const legacy = port('Altbestand');
    const created = (await (await s.send('POST', '/api/harbors', a.cookie, { name: legacy })).json()) as { harbor: { id: string } };
    await db.prepare('UPDATE harbors SET created_by = NULL WHERE id = ?').bind(created.harbor.id).run();
    await manual(b, { fromHarbor: { harborId: created.harbor.id, ...POTSDAM } });
    const row = await db.prepare('SELECT created_by, lat FROM harbors WHERE id = ?').bind(created.harbor.id).first<{ created_by: string; lat: number }>();
    expect(row).toEqual({ created_by: b.user.id, lat: POTSDAM.lat });
    // PATCH wie F-171: jetzt nur noch b
    expect((await s.send('PATCH', `/api/harbors/${created.harbor.id}`, a.cookie, { lat: 1, lon: 1 })).status).toBe(403);
    expect((await s.send('PATCH', `/api/harbors/${created.harbor.id}`, b.cookie, { lat: 52.4, lon: 13.1 })).status).toBe(200);
  });

  it('[F-307] PATCH auf Altbestand ohne Anleger:in und Position macht zur Anleger:in', async () => {
    const a = await s.person();
    const db = await h.db();
    const created = (await (await s.send('POST', '/api/harbors', a.cookie, { name: port('Alt') })).json()) as { harbor: { id: string } };
    await db.prepare('UPDATE harbors SET created_by = NULL WHERE id = ?').bind(created.harbor.id).run();
    const b = await s.person();
    expect((await s.send('PATCH', `/api/harbors/${created.harbor.id}`, b.cookie, { name: 'Umbenannt' })).status).toBe(403);
    expect((await s.send('PATCH', `/api/harbors/${created.harbor.id}`, b.cookie, { lat: 52.4, lon: 13.1 })).status).toBe(200);
    expect((await db.prepare('SELECT created_by FROM harbors WHERE id = ?').bind(created.harbor.id).first<{ created_by: string }>())?.created_by).toBe(b.user.id);
  });
});

describe('F-308 Stream: Nachträge gebündelt, Meilensteine zählen mit', () => {
  const activity = async (userId: string) =>
    (await h.db()).prepare('SELECT kind, subject_id, data FROM activity WHERE actor_id = ? ORDER BY created_at').bind(userId).all<{ kind: string; subject_id: string; data: string }>();

  it('[F-308] frischer Eintrag = voyage; Nachträge > 14 Tage = ein Bündel je Tag; gelöschte fallen beim Lesen weg', async () => {
    const p = await s.person({ profile: 'public' });
    const g = await s.group(p);
    const fresh = await manual(p);
    const old1 = await manual(p, { startedAt: recent(40) });
    const old2 = await manual(p, { startedAt: recent(50) });
    const { results } = await activity(p.user.id);
    expect(results.filter((r) => r.kind === 'voyage').map((r) => r.subject_id)).toEqual([fresh.id]);
    const bundles = results.filter((r) => r.kind === 'logbook');
    expect(bundles).toHaveLength(1);
    expect(JSON.parse(bundles[0].data)).toEqual({ ids: [old1.id, old2.id] });

    const stream = async () =>
      ((await (await s.send('GET', `/api/groups/${g.id}/stream`, p.cookie)).json()) as { items: Array<{ kind: string; logbook?: { count: number }; voyage?: { logbook?: boolean } }> }).items;
    const before = await stream();
    expect(before.find((i) => i.kind === 'logbook')?.logbook?.count).toBe(2);
    expect(before.find((i) => i.kind === 'voyage')?.voyage?.logbook).toBe(true);
    await s.send('DELETE', `/api/shares/${old1.id}`, p.cookie);
    expect((await stream()).find((i) => i.kind === 'logbook')?.logbook?.count).toBe(1);
    await s.send('DELETE', `/api/shares/${old2.id}`, p.cookie);
    expect((await stream()).some((i) => i.kind === 'logbook')).toBe(false);
  });

  it('[F-308] Meilensteine zählen Fahrtenbuch-Meilen mit (L4)', async () => {
    const p = await s.person({ profile: 'public' });
    await s.share(p, { distNm: 60, startedAt: recent(1) });
    await manual(p, { distNm: 50, startedAt: recent(2) });
    const { results } = await activity(p.user.id);
    expect(results.some((r) => r.kind === 'milestone' && JSON.parse(r.data).nm === 100)).toBe(true);
  });
});

describe('F-309 Keine Medien an Fahrtenbuch-Einträgen (L6)', () => {
  it('[F-309] Foto-Upload und Übersichtsbild → 409 no_media_manual', async () => {
    const p = await s.person({ supporter: true });
    const m = await manual(p);
    const img = await h.fetch(`/api/shares/${m.id}/image`, { method: 'PUT', cookie: p.cookie, headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) });
    expect(img.status).toBe(409);
    expect((await errorOf(img)).error).toBe('no_media_manual');
    const photo = await h.fetch(`/api/shares/${m.id}/photos`, { method: 'POST', cookie: p.cookie, headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(10) });
    expect(photo.status).toBe(409);
  });
});

describe('F-310 Löschen: keine neuen Pfade', () => {
  it('[F-310] Einzeln löschen und Konto löschen entfernen Zeile, Payload, Zähleranteil und Bündel', async () => {
    const p = await s.person({ profile: 'public' });
    const db = await h.db();
    const counter = async () => (await db.prepare("SELECT value FROM counters WHERE name = 'storage_bytes'").first<{ value: number }>())?.value ?? 0;
    const before = await counter();
    const m = await manual(p);
    expect(await counter()).toBe(before + m.sizeBytes);
    await s.send('DELETE', `/api/shares/${m.id}`, p.cookie);
    expect(await counter()).toBe(before);
    expect(await (await h.r2()).head(`shares/${m.id}`)).toBeNull();

    const old = await manual(p, { startedAt: recent(40) });
    expect((await s.send('DELETE', '/api/account', p.cookie)).status).toBe(200);
    expect(await db.prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(old.id).first()).toBeNull();
    expect(await (await h.r2()).head(`shares/${old.id}`)).toBeNull();
    expect(await db.prepare("SELECT 1 AS x FROM activity WHERE kind = 'logbook' AND actor_id = ?").bind(p.user.id).first()).toBeNull();
  });

  it('[F-310] Hafen gelöscht oder zusammengeführt: Törns verlieren bzw. wechseln den Hafen', async () => {
    const p = await s.person();
    // eigene Häfen – die gemeinsamen bleiben für die anderen Tests
    const m = await manual(p, { fromHarbor: { name: port('Merge A'), ...POTSDAM }, toHarbor: { name: port('Merge B'), ...WERDER } });
    const db = await h.db();
    const ids = await db.prepare('SELECT from_harbor_id AS f, to_harbor_id AS t FROM shares WHERE id = ?').bind(m.id).first<{ f: string; t: string }>();
    await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'logbook-admin@example.org', Date.now() - 10 * DAY).run();
    const admin = await login(h, 'logbook-admin@example.org');
    expect((await s.send('POST', `/api/admin/harbors/${ids!.t}/merge`, admin.cookie, { into: ids!.f })).status).toBe(200);
    expect((await db.prepare('SELECT to_harbor_id AS t FROM shares WHERE id = ?').bind(m.id).first<{ t: string }>())?.t).toBe(ids!.f);
    await db.prepare('DELETE FROM harbors WHERE id = ?').bind(ids!.f).run();
    expect(await db.prepare('SELECT from_harbor_id AS f, to_harbor_id AS t FROM shares WHERE id = ?').bind(m.id).first()).toEqual({ f: null, t: null });
  });
});

describe('F-311 GPX-Plausibilität (L8)', () => {
  it('[F-311] Server lehnt > 2.000 sm, > 60 Tage und > 30 kn im Mittel ab', async () => {
    const p = await s.person({ supporter: true });
    const t = Date.parse('2026-06-13T10:00:00Z');
    const up = (headers: Record<string, string>) => createShare(h, p.cookie, { headers });
    expect((await up({ 'X-Share-Distance': '2001' })).status).toBe(400);
    expect((await up({ 'X-Share-Distance': '10', 'X-Share-Started': String(t), 'X-Share-Ended': String(t + 61 * DAY) })).status).toBe(400);
    expect((await up({ 'X-Share-Distance': '100', 'X-Share-Started': String(t), 'X-Share-Ended': String(t + 3 * 3_600_000) })).status).toBe(400);
    const ok = await up({ 'X-Share-Distance': '80', 'X-Share-Started': String(t), 'X-Share-Ended': String(t + 3 * 3_600_000) });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { share: LogShare }).share.endedAt).toBe(t + 3 * 3_600_000);
  });
});

describe('Review-Befunde', () => {
  it('[F-308] Nachtrag erst privat, dann öffentlich: ins Bündel, nie einzeln; erneutes Umschalten fügt nichts doppelt hinzu', async () => {
    const p = await s.person({ profile: 'public', supporter: true });
    const m = await manual(p, { startedAt: recent(40), visibility: 'private' });
    for (const v of ['public', 'private', 'public']) expect((await s.send('PATCH', `/api/shares/${m.id}`, p.cookie, { visibility: v })).status).toBe(200);
    const { results } = await (await h.db()).prepare('SELECT kind, data FROM activity WHERE actor_id = ?').bind(p.user.id).all<{ kind: string; data: string }>();
    expect(results.map((r) => r.kind)).toEqual(['logbook']);
    expect(JSON.parse(results[0].data)).toEqual({ ids: [m.id] });
  });

  it('[F-307] gesperrte Häfen bekommen auch über das Fahrtenbuch keine Position', async () => {
    const a = await s.person();
    const created = (await (await s.send('POST', '/api/harbors', a.cookie, { name: port('Gesperrt') })).json()) as { harbor: { id: string } };
    await (await h.db()).prepare("INSERT INTO locks (target_kind, target_id, locked_at, until, locked_by) VALUES ('harbor', ?, ?, ?, 'x')").bind(created.harbor.id, Date.now(), Date.now() + DAY).run();
    const res = await s.send('POST', '/api/shares/manual', a.cookie, entry({ fromHarbor: { harborId: created.harbor.id, ...POTSDAM } }));
    expect(res.status).toBe(409);
    expect((await (await h.db()).prepare('SELECT lat FROM harbors WHERE id = ?').bind(created.harbor.id).first<{ lat: number | null }>())?.lat).toBeNull();
  });

  it('[F-310] Moderation löscht einen Eintrag samt Payload und Zähleranteil', async () => {
    const p = await s.person({ profile: 'public' });
    const m = await manual(p);
    const db = await h.db();
    const counter = async () => (await db.prepare("SELECT value FROM counters WHERE name = 'storage_bytes'").first<{ value: number }>())?.value ?? 0;
    const before = await counter();
    const reporter = await s.person();
    expect((await s.send('POST', '/api/reports', reporter.cookie, { kind: 'share', id: m.id, reason: 'abuse', note: '' })).status).toBe(201);
    await db.prepare('INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'logbook-admin@example.org', Date.now() - 10 * DAY).run();
    const admin = await login(h, 'logbook-admin@example.org');
    const list = (await (await s.send('GET', '/api/admin/reports', admin.cookie)).json()) as { reports: Array<{ id: string; targetId: string }> };
    const r = list.reports.find((x) => x.targetId === m.id)!;
    expect((await s.send('POST', `/api/admin/reports/${r.id}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect(await db.prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(m.id).first()).toBeNull();
    expect(await (await h.r2()).head(`shares/${m.id}`)).toBeNull();
    expect(await counter()).toBe(before - m.sizeBytes);
  });

  it('[F-301] PATCH: neue Route verschiebt den Speicherzähler um die Differenz; timed nur über das eigene Feld', async () => {
    const p = await s.person();
    const db = await h.db();
    const counter = async () => (await db.prepare("SELECT value FROM counters WHERE name = 'storage_bytes'").first<{ value: number }>())?.value ?? 0;
    const m = await manual(p);
    const before = await counter();
    const moved = ((await (await s.send('PATCH', `/api/shares/${m.id}`, p.cookie, { toHarbor: { name: port('Ferch'), lat: 52.3212, lon: 12.9345 } })).json()) as { share: LogShare }).share;
    expect(await counter()).toBe(before + moved.sizeBytes - m.sizeBytes);
    const res = await s.send('PATCH', `/api/shares/${m.id}`, p.cookie, { log: { timed: true, notes: 'x' } });
    expect(((await res.json()) as { share: LogShare }).share.log).toEqual({ notes: 'x' });
    // öffentliche Listen ohne Fahrtenbuch-Angaben
    expect(((await (await s.send('GET', `/api/shares/${m.id}`, p.cookie)).json()) as { share: LogShare }).share.log).toEqual({ notes: 'x' });
  });
});
