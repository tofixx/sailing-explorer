// Funktionale Tests: Fahrtenbuch nach Jahren (Konzept 27) gegen den echten Worker (Miniflare) – Liste (F-411), Crew-
// Ausnahme M1 (F-456), Meilennachweis als CSV (F-457), Zusatzangaben an GPX- und Fahrtenbuch-Törns (F-412, F-461), Reiter
// „Fahrtenbuch“ in „Mein Verlauf“ entfällt (F-459).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { crewLogState, type LogbookEntry } from '../../src/domain/logbook-year';
import { LOG_STATES, type LogState } from '../../src/domain/logbook';
import type { Visibility } from '../../src/domain/visibility';

const DAY = 86_400_000;
let h: Harness;
let s: ReturnType<typeof social>;
const harbors = { from: '', to: '' };

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
  const p = await s.person();
  const mk = async (name: string, lat: number, lon: number) =>
    ((await (await s.send('POST', '/api/harbors', p.cookie, { name: s.uniq(name), lat, lon })).json()) as { harbor: { id: string } }).harbor.id;
  harbors.from = await mk('Potsdam', 52.39, 13.06);
  harbors.to = await mk('Werder', 52.38, 12.94);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const logbook = async (p?: Person) => {
  const res = await h.fetch('/api/me/logbook', { cookie: p?.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { entries: LogbookEntry[] }).entries;
};
const run = async (sql: string, ...args: unknown[]) => (await h.db()).prepare(sql).bind(...args).run();
/** GPX-Törn mit Zeiten (Abfahrt `daysAgo` Tage zurück, 3 h) */
const gpx = (p: Person, o: { visibility?: Visibility; title?: string; daysAgo?: number; distNm?: number } = {}) => {
  const startedAt = Date.now() - (o.daysAgo ?? 2) * DAY;
  return s.share(p, { visibility: o.visibility ?? 'public', title: o.title ?? 'Havel-Törn', startedAt, distNm: o.distNm ?? 6 });
};
const manual = async (p: Person, o: Record<string, unknown> = {}) => {
  const res = await s.send('POST', '/api/shares/manual', p.cookie, {
    startedAt: Date.now() - 3 * DAY, fromHarbor: { harborId: harbors.from }, toHarbor: { harborId: harbors.to }, distNm: 8, ...o,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { share: { id: string } }).share;
};
const addCrew = (shareId: string, p: Person, role = 'crew', confirmed = false) =>
  run('INSERT INTO share_crew (share_id, user_id, created_at, role, confirmed_at) VALUES (?, ?, ?, ?, ?)', shareId, p.user.id, Date.now(), role, confirmed ? Date.now() : null);

describe('F-411 Fahrtenbuch nach Jahren', () => {
  it('[F-411] nur angemeldet, nie gecacht; alle eigenen Törns jeder Sichtbarkeit und jedes Stands, gesperrte nicht', async () => {
    expect((await h.fetch('/api/me/logbook')).status).toBe(401);
    const p = await s.person({ supporter: true });
    const pub = await gpx(p);
    const priv = await gpx(p, { visibility: 'private', title: 'Nur ich' });
    const link = await gpx(p, { visibility: 'unlisted', title: 'Mit Link' });
    const log = await manual(p, { log: { notes: 'geheim', berth: 'Steg B', sailH: 2 } });
    const locked = await gpx(p, { title: 'Gesperrt' });
    await run('UPDATE shares SET locked_at = ? WHERE id = ?', Date.now(), locked.id);
    expect((await s.send('PATCH', `/api/shares/${pub.id}`, p.cookie, { logState: 'excluded' })).status).toBe(200);
    const res = await h.fetch('/api/me/logbook', { cookie: p.cookie });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const entries = ((await res.json()) as { entries: LogbookEntry[] }).entries;
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect([...byId.keys()].sort()).toEqual([pub.id, priv.id, link.id, log.id].sort());
    expect(byId.get(pub.id)).toMatchObject({ own: true, logState: 'excluded', source: 'gpx', distSource: 'track', path: `/s/${pub.id}` });
    expect(byId.get(link.id)!.path).toBe(`/s/${link.id}/${link.shareKey}`);
    // Liste ohne Freitexte (Notizen, Liegeplatz) – die stehen am Törn
    expect(byId.get(log.id)).toMatchObject({ source: 'manual', logState: 'confirmed', distNm: 8, log: { sailH: 2 } });
    expect(byId.get(log.id)!.log).not.toHaveProperty('notes');
    expect(byId.get(log.id)!.from?.slug).toBeTruthy();
    // neueste zuerst
    expect(entries.map((e) => e.startedAt)).toEqual([...entries.map((e) => e.startedAt)].sort((a, b) => b - a));
  });

  it('[F-411] Löschen: ein gelöschter Törn verschwindet; fremde sehen nichts davon', async () => {
    const p = await s.person();
    const other = await s.person();
    const a = await gpx(p);
    expect((await logbook(p)).map((e) => e.id)).toEqual([a.id]);
    expect(await logbook(other)).toEqual([]);
    expect((await s.send('DELETE', `/api/shares/${a.id}`, p.cookie)).status).toBe(204);
    expect(await logbook(p)).toEqual([]);
  });
});

describe('F-456 Crew-Törns anderer (Ausnahme M1)', () => {
  it('[F-456] bestätigt: auch nicht öffentlich, nur Eckdaten; unbestätigt nur öffentlich als Vorschlag', async () => {
    const owner = await s.person({ supporter: true });
    const mate = await s.person();
    const boat = await s.boat(owner, { name: 'Möwe', visibility: 'private' });
    const priv = await gpx(owner, { visibility: 'private', title: 'Geheimer Törn' });
    const pub = await gpx(owner, { title: 'Öffentlicher Törn' });
    await run('UPDATE shares SET boat_id = ?, log = ? WHERE id = ?', boat.id, JSON.stringify({ notes: 'privat', sailH: 3 }), priv.id);
    await addCrew(priv.id, mate, 'co', true);
    await addCrew(pub.id, mate);
    const list = await logbook(mate);
    const p = list.find((e) => e.id === priv.id)!;
    expect(p).toMatchObject({ own: false, path: null, title: null, logState: 'confirmed', role: 'co', roleConfirmed: true, boat: 'Möwe', log: {}, distNm: 6 });
    expect(list.find((e) => e.id === pub.id)).toMatchObject({ own: false, path: `/s/${pub.id}`, title: 'Öffentlicher Törn', logState: 'suggested', role: 'crew', roleConfirmed: false });
    // unbestätigt, öffentlicher Törn, privates Boot: Bootsname nicht (F-82); bestätigt war man an Bord (M1)
    await run('UPDATE shares SET boat_id = ? WHERE id = ?', boat.id, pub.id);
    expect((await logbook(mate)).find((e) => e.id === pub.id)?.boat).toBeNull();
    await run('UPDATE share_crew SET confirmed_at = ? WHERE share_id = ?', Date.now(), pub.id);
    expect((await logbook(mate)).find((e) => e.id === pub.id)?.boat).toBe('Möwe');
    // gesperrtes Boot nennt niemand
    await run('UPDATE boats SET locked_at = ? WHERE id = ?', Date.now(), boat.id);
    expect((await logbook(mate)).find((e) => e.id === priv.id)?.boat).toBeNull();
    // Crew-Eintrag ohne GPX mit Uhrzeiten: Dauer auch ohne die Angaben der Eigentümer:in (`log.timed`)
    const m = await manual(owner, { startedAt: Date.now() - 3 * DAY, endedAt: Date.now() - 3 * DAY + 4 * 3_600_000, timed: true });
    await addCrew(m.id, mate, 'crew', true);
    expect((await logbook(mate)).find((e) => e.id === m.id)).toMatchObject({ timed: true, log: {} });
    await run('UPDATE share_crew SET confirmed_at = NULL WHERE share_id = ?', pub.id);
    // unbestätigt und nicht öffentlich: nicht im Fahrtenbuch
    await run('UPDATE share_crew SET confirmed_at = NULL WHERE share_id = ?', priv.id);
    expect((await logbook(mate)).map((e) => e.id).sort()).toEqual([pub.id, m.id].sort());
  });

  it('[F-456] Domain-Regel und SQL-Baustein stimmen überein (Sichtbarkeit × Bestätigung × Stand × Ausblenden/Sperre/Konto gesperrt)', async () => {
    const owner = await s.person({ supporter: true });
    const mate = await s.person();
    const sh = await gpx(owner);
    await addCrew(sh.id, mate);
    for (const visibility of ['public', 'unlisted', 'private'] as const)
      for (const confirmed of [false, true])
        for (const ownerState of LOG_STATES)
          for (const [hidden, locked, ownerSuspended] of [[false, false, false], [true, false, false], [false, true, false], [false, false, true]]) {
            await run('UPDATE shares SET visibility = ?, log_state = ?, hidden_at = ?, locked_at = ? WHERE id = ?', visibility, ownerState, hidden ? 1 : null, locked ? 1 : null, sh.id);
            await run('UPDATE share_crew SET confirmed_at = ? WHERE share_id = ?', confirmed ? 1 : null, sh.id);
            await run('UPDATE users SET suspended_at = ? WHERE id = ?', ownerSuspended ? 1 : null, owner.user.id);
            const want: LogState | null = crewLogState({ confirmed, visibility, hidden, locked, ownerSuspended, ownerState });
            const got = (await logbook(mate)).find((e) => e.id === sh.id)?.logState ?? null;
            expect(got, JSON.stringify({ visibility, confirmed, ownerState, hidden, locked, ownerSuspended })).toBe(want);
          }
  }, 60_000);

  it('[F-456] Löschwege: Crew verlassen, Bestätigung fällt (anderes Boot), Törn bzw. Konto der Eigentümer:in gelöscht', async () => {
    const owner = await s.person({ supporter: true });
    const mate = await s.person();
    const boat = await s.boat(owner, { name: 'Kranich' });
    const priv = await gpx(owner, { visibility: 'private' });
    const pub = await gpx(owner);
    const gone = await gpx(owner);
    for (const id of [priv.id, pub.id, gone.id]) await addCrew(id, mate, 'crew', true);
    // anderes Boot: Bestätigungen fallen (Konzept 15) – der private Törn verschwindet, der öffentliche wird Vorschlag
    expect((await s.send('PATCH', `/api/shares/${priv.id}`, owner.cookie, { boatId: boat.id })).status).toBe(200);
    expect((await s.send('PATCH', `/api/shares/${pub.id}`, owner.cookie, { boatId: boat.id })).status).toBe(200);
    let list = await logbook(mate);
    expect(list.find((e) => e.id === priv.id)).toBeUndefined();
    expect(list.find((e) => e.id === pub.id)?.logState).toBe('suggested');
    // Crew verlassen
    expect((await s.send('DELETE', `/api/shares/${pub.id}/crew/me`, mate.cookie)).status).toBe(204);
    list = await logbook(mate);
    expect(list.map((e) => e.id)).toEqual([gone.id]);
    // Konto der Eigentümer:in gelöscht: Törns samt Crew-Zeilen weg
    expect((await s.send('DELETE', '/api/account', owner.cookie)).status).toBe(200);
    expect(await logbook(mate)).toEqual([]);
  });
});

describe('F-457 Meilennachweis als CSV', () => {
  it('[F-457] nur angemeldet; Datei mit Kopf, Saison- und Stand-Filter, nie gecacht', async () => {
    expect((await h.fetch('/api/me/logbook.csv')).status).toBe(401);
    const p = await s.person();
    const a = await manual(p, { distNm: 12.5 });
    const b = await gpx(p, { distNm: 4 });
    expect((await s.send('PATCH', `/api/shares/${b.id}`, p.cookie, { logState: 'excluded' })).status).toBe(200);
    const res = await h.fetch('/api/me/logbook.csv', { cookie: p.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="meilennachweis.csv"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    // BOM bleibt in der Datei (Excel erkennt so UTF-8)
    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(';12,5;Angabe;');
    // nur Ausgeschlossene, andere Saison
    const ex = new TextDecoder().decode(await (await h.fetch('/api/me/logbook.csv?stand=excluded', { cookie: p.cookie })).arrayBuffer());
    expect(ex.trimEnd().split('\r\n')).toHaveLength(2);
    expect(ex).toContain(';4,0;aufgezeichnet;');
    const season = new Date().getUTCFullYear() + (new Date().getUTCMonth() >= 10 ? 1 : 0);
    const old = await h.fetch(`/api/me/logbook.csv?saison=${season - 3}`, { cookie: p.cookie });
    expect(old.headers.get('Content-Disposition')).toContain(`meilennachweis-${season - 3}.csv`);
    expect(new TextDecoder().decode(await old.arrayBuffer()).trimEnd().split('\r\n')).toHaveLength(1);
    expect(a.id).toBeTruthy();
  });
});

describe('F-610 Segellebenslauf als CSV', () => {
  it('[F-610] saison=alle: Datei segellebenslauf.csv mit Saison als erster Spalte über alle Jahre, Stand-Filter und Crew-Regeln wie die Seite', async () => {
    const p = await s.person();
    const owner = await s.person();
    const now = await manual(p, { distNm: 7 });
    const old = await manual(p, { distNm: 5, startedAt: Date.UTC(2023, 6, 1, 10) });
    const crewShare = await gpx(owner, { distNm: 20 });
    await addCrew(crewShare.id, p, 'crew', true);
    const skip = await manual(p, { distNm: 99, startedAt: Date.UTC(2024, 6, 1, 10) });
    expect((await s.send('PATCH', `/api/shares/${skip.id}`, p.cookie, { logState: 'excluded' })).status).toBe(200);
    expect((await h.fetch('/api/me/logbook.csv?saison=alle')).status).toBe(401);
    const res = await h.fetch('/api/me/logbook.csv?saison=alle', { cookie: p.cookie });
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="segellebenslauf.csv"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const lines = new TextDecoder().decode(await res.arrayBuffer()).trimEnd().split('\r\n');
    expect(lines[0]).toContain('Saison;Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer');
    // ausgeschlossen (99 sm) fehlt, älteste zuerst, Saison vorn
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^2023;01\.07\.2023;.*;5,0;/);
    expect(lines[2]).toMatch(/^\d{4};.*;7,0;/);
    expect(lines[3]).toContain(';20,0;aufgezeichnet;Crew (bestätigt)');
    expect(lines.join('')).not.toContain('99,0');
    // mit Filter „Ausgeschlossen“ nur der eine; ohne `saison=alle` bleibt die Datei ohne Saison-Spalte
    const ex = new TextDecoder().decode(await (await h.fetch('/api/me/logbook.csv?saison=alle&stand=excluded', { cookie: p.cookie })).arrayBuffer());
    expect(ex.trimEnd().split('\r\n')[1]).toMatch(/^2024;/);
    const plain = new TextDecoder().decode(await (await h.fetch('/api/me/logbook.csv', { cookie: p.cookie })).arrayBuffer());
    expect(plain).toContain('Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer');
    expect(plain).not.toContain('Saison');
    expect(old.id).toBeTruthy();
    expect(now.id).toBeTruthy();
  });
});

describe('F-412 / F-461 Zusatzangaben an GPX- und Fahrtenbuch-Törns', () => {
  it('[F-461] GPX-Törn: Häfen und Zusatzangaben per PATCH, Datum und Strecke nicht (409); erscheinen im Fahrtenbuch', async () => {
    const p = await s.person();
    const g = await gpx(p);
    const log = { area: 'coastal', tidal: true, sailH: 2.5, engineH: 0.5, nightH: 1, locks: 4, items: [{ name: 'Überführung', n: 1, note: 'nach Kiel' }], regatta: { name: 'Kieler Woche', place: 3, starters: 40 } };
    const res = await s.send('PATCH', `/api/shares/${g.id}`, p.cookie, { log, fromHarbor: { harborId: harbors.from }, toHarbor: { harborId: harbors.to } });
    expect(res.status, await res.clone().text()).toBe(200);
    const { share } = (await res.json()) as { share: { log: Record<string, unknown>; from: { slug: string } | null } };
    // Schleusen gibt es an der Küste nicht (B10)
    expect(share.log).toEqual({ area: 'coastal', tidal: true, sailH: 2.5, engineH: 0.5, nightH: 1, items: [{ name: 'Überführung', n: 1, note: 'nach Kiel' }], regatta: { name: 'Kieler Woche', place: 3, starters: 40 } });
    expect(share.from?.slug).toBeTruthy();
    expect((await s.send('PATCH', `/api/shares/${g.id}`, p.cookie, { distNm: 99 })).status).toBe(409);
    const e = (await logbook(p)).find((x) => x.id === g.id)!;
    expect(e.log).toMatchObject({ area: 'coastal', sailH: 2.5, items: [{ name: 'Überführung', n: 1 }] });
    expect(e.to?.slug).toBeTruthy();
    expect((await s.send('PATCH', `/api/shares/${g.id}`, p.cookie, { log: { items: [{ name: 'x', n: 5000 }] } })).status).toBe(400);
  });

  it('[F-412] Fahrtenbuch-Eintrag ohne GPX nimmt Zusatzangaben beim Anlegen; Ablauf und Konto löschen sie mit dem Törn', async () => {
    const p = await s.person();
    const m = await manual(p, { log: { area: 'inland', locks: 2, bridges: 5, mast: 2, daysAboard: 2 } });
    expect((await logbook(p)).find((e) => e.id === m.id)?.log).toEqual({ area: 'inland', locks: 2, bridges: 5, mast: 2, daysAboard: 2 });
    expect((await s.send('DELETE', '/api/account', p.cookie)).status).toBe(200);
    expect(await (await h.db()).prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(m.id).first()).toBeNull();
  });
});

describe('F-459 ein Einstieg', () => {
  it('[F-459] „Mein Verlauf“ kennt keinen Bereich „Fahrtenbuch“ mehr (400)', async () => {
    const p = await s.person();
    expect((await s.send('GET', '/api/me/posts?area=logbook', p.cookie)).status).toBe(400);
    expect((await s.send('GET', '/api/me/posts?area=all', p.cookie)).status).toBe(200);
  });
});
