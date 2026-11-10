// Funktionale Tests: Wertung und Jahresbericht (Konzept 32, Phase 9) gegen den echten Worker (Miniflare) – Vorlagen als
// Baukasten (F-500), Vorlage je Eintrag (F-501), Vereinsliste mit Opt-in (F-503) und Gewichtung (F-504), Jahresbericht
// als CSV (F-505), Löschwege (F-506), Cache und Zugriff (F-507).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { BASE_TEMPLATE_ID, countsInClubList, type ScoringTemplate } from '../../src/domain/scoring';
import { LOG_STATES, type LogState } from '../../src/domain/logbook';
import type { Visibility } from '../../src/domain/visibility';
import { seasonOf } from '../../src/domain/support';
import type { ClubList, MyScoring } from '../../src/services/scoring-api';

const DAY = 86_400_000;
const ADMIN_ID = 'ScoringAdmin00000001';
const ADMIN_MAIL = 'wertung-admin@example.org';

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;
const harbors = { from: '', to: '' };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  admin = { ...(await login(h, ADMIN_MAIL)), email: ADMIN_MAIL };
  const p = await s.person();
  const mk = async (name: string, lat: number, lon: number) =>
    ((await (await s.send('POST', '/api/harbors', p.cookie, { name: s.uniq(name), lat, lon })).json()) as { harbor: { id: string } }).harbor.id;
  harbors.from = await mk('Potsdam', 52.39, 13.06);
  harbors.to = await mk('Werder', 52.38, 12.94);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const run = async (sql: string, ...args: unknown[]) => (await h.db()).prepare(sql).bind(...args).run();
const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};
const mine = async (p: Person) => json<MyScoring>(await s.send('GET', '/api/me/scoring', p.cookie));
const createTemplate = (p: Person, body: Record<string, unknown>) => s.send('POST', '/api/scoring/templates', p.cookie, body);
const template = async (p: Person, body: Record<string, unknown>) => (await json<{ template: ScoringTemplate }>(await createTemplate(p, body), 201)).template;
/** Fahrtenbuch-Eintrag (8 sm, vor 3 Tagen), optional in Gruppen gezeigt und mit Vorlage. */
const manual = async (p: Person, o: { templateId?: string; groups?: string[]; visibility?: Visibility; distNm?: number; log?: Record<string, unknown> } = {}) => {
  const res = await s.send('POST', '/api/shares/manual', p.cookie, {
    startedAt: Date.now() - 3 * DAY, fromHarbor: { harborId: harbors.from }, toHarbor: { harborId: harbors.to }, distNm: o.distNm ?? 8,
    visibility: o.visibility ?? 'public', ...(o.groups ? { groupIds: o.groups } : {}),
    log: { ...(o.log ?? {}), ...(o.templateId ? { templateId: o.templateId } : {}) },
  });
  return res;
};
const entry = async (p: Person, o: Parameters<typeof manual>[1] = {}) => (await json<{ share: { id: string } }>(await manual(p, o), 201)).share;
/** Saison der Testeinträge (vor 3 Tagen) – ohne Angabe wählt der Server `clubListSeason` */
const SEASON = seasonOf(Date.now() - 3 * DAY);
const clubList = (p: Person | undefined, groupId: string) => h.fetch(`/api/groups/${groupId}/scoring?saison=${SEASON}`, { cookie: p?.cookie });
const optIn = (p: Person, groupId: string, on = true) => s.send('PUT', `/api/groups/${groupId}/scoring`, p.cookie, { optIn: on });

/** Verein mit Eigner:in und Mitglied (öffentliches Profil). */
async function club() {
  const owner = await s.person({ profile: 'public', supporter: true });
  const member = await s.person({ profile: 'public', supporter: true });
  const g = await s.group(owner);
  await s.join(owner, g, member);
  return { owner, member, g };
}

describe('F-500 Wertungsvorlagen als geprüfter Baukasten', () => {
  it('[F-500] Vorschläge der Plattform pflegen nur Admins; zwei Vorschläge kommen mit der Migration', async () => {
    const p = await s.person();
    expect((await createTemplate(p, { name: 'Meine', rules: {} })).status).toBe(403);
    const t = await template(admin, { name: 'Nur Regatta', rules: { nmSail: 0, nmMotor: 0, regatta: 20, regattaPlace: 2 } });
    expect(t).toMatchObject({ groupId: null, name: 'Nur Regatta', rules: { regatta: 20, regattaPlace: 2, nmSail: 0, skipper: 1 } });
    const { templates, admin: isAdmin } = await mine(p);
    expect(isAdmin).toBe(false);
    expect(templates.map((x) => x.id)).toEqual(expect.arrayContaining([BASE_TEMPLATE_ID, 'fahrtenpreis', 'binnen', t.id]));
    expect(templates[0].id).toBe(BASE_TEMPLATE_ID);
    expect((await mine(admin)).admin).toBe(true);
    // ändern und löschen ebenso nur Admins
    expect((await s.send('PATCH', `/api/scoring/templates/${t.id}`, p.cookie, { name: 'X' })).status).toBe(403);
    expect((await s.send('DELETE', `/api/scoring/templates/${t.id}`, p.cookie)).status).toBe(403);
    expect((await s.send('DELETE', `/api/scoring/templates/${t.id}`, admin.cookie)).status).toBe(204);
  });

  it('[F-500] kein Formeltext: unbekannte Bausteine, Grenzen und Namen → 400', async () => {
    const bad = async (body: Record<string, unknown>, code: string) => expect(await s.errorOf(await createTemplate(admin, body))).toBe(code);
    await bad({ name: 'X', rules: { formula: 'nm * 2' } }, 'invalid_rules');
    await bad({ name: 'X', rules: { nmSail: 'eval(1)' } }, 'invalid_rules');
    await bad({ name: 'X', rules: { skipper: 11 } }, 'invalid_rules');
    await bad({ name: 'X', rules: { day: -1 } }, 'invalid_rules');
    await bad({ name: 'X', rules: { items: Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, points: 1 })) } }, 'invalid_rules');
    await bad({ name: 'X', rules: { items: [{ name: 'Training', points: 1 }, { name: 'training', points: 2 }] } }, 'invalid_rules');
    await bad({ name: '', rules: {} }, 'invalid_name');
    await bad({ name: 'x'.repeat(61), rules: {} }, 'invalid_name');
  });

  it('[F-413] [F-500] Vereine übernehmen, erweitern oder legen eigene an; nur Eigner:in und Admins; höchstens 10', async () => {
    const { owner, member, g } = await club();
    const outsider = await s.person();
    expect((await createTemplate(member, { groupId: g.id, name: 'X' })).status).toBe(403);
    expect((await createTemplate(outsider, { groupId: g.id, name: 'X' })).status).toBe(404);
    // übernehmen: Kopie mit Herkunft, Regeln wie der Vorschlag
    const copy = await template(owner, { groupId: g.id, sourceId: 'fahrtenpreis' });
    expect(copy).toMatchObject({ groupId: g.id, name: 'Fahrtenpreis klassisch', sourceName: 'Fahrtenpreis klassisch', listWeight: null, rules: { coastal: 1.2, cap: 500 } });
    // erweitern: eigener Posten, Faktor für die Vereinsliste
    const ext = await json<{ template: ScoringTemplate }>(
      await s.send('PATCH', `/api/scoring/templates/${copy.id}`, owner.cookie, { name: 'Fahrtenpreis SCM', rules: { ...copy.rules, items: [{ name: 'Arbeitsdienst', points: 10, cap: 30 }] }, listWeight: 1.5 }),
    );
    expect(ext.template).toMatchObject({ name: 'Fahrtenpreis SCM', listWeight: 1.5, rules: { items: [{ name: 'Arbeitsdienst', points: 10, cap: 30 }] } });
    expect(await s.errorOf(await s.send('PATCH', `/api/scoring/templates/${copy.id}`, owner.cookie, { listWeight: 50 }))).toBe('invalid_weight');
    // eigene ohne Vorlage: Standard „Nur Meilen“
    const own = await template(owner, { groupId: g.id, name: 'Eigene' });
    expect(own.rules).toMatchObject({ nmSail: 1, nmMotor: 1, day: 0 });
    // Vorlage eines fremden Vereins lässt sich nicht übernehmen
    const other = await club();
    expect((await createTemplate(other.owner, { groupId: other.g.id, sourceId: own.id })).status).toBe(404);
    // Mitglieder sehen die Vereinsvorlagen in ihrer Auswahl, Fremde nicht
    expect((await mine(member)).templates.map((t) => t.id)).toEqual(expect.arrayContaining([copy.id, own.id]));
    expect((await mine(outsider)).templates.map((t) => t.id)).not.toContain(own.id);
    // Grenze atomar: 10 je Verein
    for (let i = 2; i < 10; i++) await template(owner, { groupId: g.id, name: `V${i}` });
    expect(await s.errorOf(await createTemplate(owner, { groupId: g.id, name: 'Zu viel' }))).toBe('template_limit');
  });

  it('[F-500] nur Vereine (keine Teams) haben Vorlagen', async () => {
    const { owner, g } = await club();
    const team = await s.group(owner, { kind: 'team', parentId: g.id, name: 'Jollen' });
    expect((await createTemplate(owner, { groupId: team.id, name: 'X' })).status).toBe(404);
  });
});

describe('F-501 Vorlage je Eintrag', () => {
  it('[F-501] wählbar sind „Nur Meilen“, Vorschläge und Vorlagen der eigenen Vereine; sonst 400; zuletzt genutzte vorbelegt', async () => {
    const { owner, member, g } = await club();
    const t = await template(owner, { groupId: g.id, name: 'Vereinspreis' });
    const outsider = await s.person();
    expect(await s.errorOf(await manual(outsider, { templateId: t.id }))).toBe('invalid_template');
    expect(await s.errorOf(await manual(outsider, { templateId: 'gibtesnicht' }))).toBe('invalid_template');
    expect(await s.errorOf(await manual(outsider, { templateId: 'a b' }))).toBe('invalid_log');
    await entry(outsider, { templateId: 'fahrtenpreis' });
    await entry(outsider, { templateId: BASE_TEMPLATE_ID });
    const e = await entry(member, { templateId: t.id });
    expect((await mine(member)).lastTemplateId).toBe(t.id);
    // ändern prüft ebenso
    expect((await s.send('PATCH', `/api/shares/${e.id}`, outsider.cookie, { log: { templateId: t.id } })).status).toBe(404);
    // unverändert mitgesendet bleibt die Vorlage erlaubt, auch nach dem Austritt; wechseln zu ihr nicht mehr
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me`, member.cookie)).status).toBe(204);
    const kept = await s.send('PATCH', `/api/shares/${e.id}`, member.cookie, { log: { templateId: t.id, sailH: 2 } });
    expect(kept.status, await kept.clone().text()).toBe(200);
    const patch = await s.send('PATCH', `/api/shares/${e.id}`, member.cookie, { log: { templateId: 'binnen' } });
    expect(patch.status, await patch.clone().text()).toBe(200);
    expect(await s.errorOf(await s.send('PATCH', `/api/shares/${e.id}`, member.cookie, { log: { templateId: t.id } }))).toBe('invalid_template');
  });
});

describe('F-503 Vereinsliste mit Opt-in, nur dort gezeigte Einträge', () => {
  it('[F-503] Zugriff: Gäste 401, Fremde 404, Mitglieder ohne Opt-in 403; ganze Liste nur Eigner:in/Admins, Teilnehmende nur die eigene Summe (nie gecacht)', async () => {
    const { owner, member, g } = await club();
    const outsider = await s.person();
    expect((await clubList(undefined, g.id)).status).toBe(401);
    expect((await clubList(outsider, g.id)).status).toBe(404);
    expect(await s.errorOf(await clubList(member, g.id))).toBe('opt_in_required');
    const res = await clubList(owner, g.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await json<{ optIn: boolean }>(await optIn(member, g.id))).optIn).toBe(true);
    await optIn(owner, g.id);
    const own = await json<ClubList>(await clubList(member, g.id));
    expect(own).toMatchObject({ full: false, members: [expect.objectContaining({ me: true })] });
    expect((await json<ClubList>(await clubList(owner, g.id))).members).toHaveLength(2);
    expect((await mine(member)).clubs).toEqual([expect.objectContaining({ id: g.id, optIn: true, manage: false })]);
    // Opt-in nur als Mitglied, nur Vereine
    expect((await optIn(outsider, g.id)).status).toBe(404);
    expect(await s.errorOf(await s.send('PUT', `/api/groups/${g.id}/scoring`, member.cookie, { optIn: 'ja' }))).toBe('invalid_opt_in');
    // Gast sieht nichts, auch nicht nach dem Abruf eines Mitglieds
    expect((await clubList(undefined, g.id)).status).toBe(401);
    // Opt-out wirkt sofort: keine eigene Summe mehr, nicht mehr in der Liste
    expect((await json<{ optIn: boolean }>(await optIn(member, g.id, false))).optIn).toBe(false);
    expect(await s.errorOf(await clubList(member, g.id))).toBe('opt_in_required');
    expect((await json<ClubList>(await clubList(owner, g.id))).members.map((m) => m.me)).toEqual([true]);
  });

  it('[F-503] gesperrter bzw. ausgeblendeter Verein: Liste, Opt-in und Vorlagen → 404', async () => {
    const { owner, member, g } = await club();
    await optIn(member, g.id);
    await run('UPDATE groups SET locked_at = ? WHERE id = ?', Date.now(), g.id);
    expect((await clubList(owner, g.id)).status).toBe(404);
    expect((await clubList(member, g.id)).status).toBe(404);
    expect((await optIn(member, g.id)).status).toBe(404);
    expect((await createTemplate(owner, { groupId: g.id, name: 'X' })).status).toBe(404);
    expect((await mine(member)).clubs).toEqual([]);
    await run('UPDATE groups SET locked_at = NULL, hidden_at = ? WHERE id = ?', Date.now(), g.id);
    expect((await clubList(owner, g.id)).status).toBe(404);
  });

  it('[F-414] [F-503] zählt nur Einträge mit Vereinsvorlage mit Faktor, im Verein gezeigt, öffentlich, von Teilnehmenden', async () => {
    const { owner, member, g } = await club();
    const quiet = await s.person({ profile: 'private' });
    await s.join(owner, g, quiet);
    const t = await template(owner, { groupId: g.id, name: 'Preis', listWeight: 1 });
    const unlisted = await template(owner, { groupId: g.id, name: 'Nicht in der Liste' });
    await optIn(member, g.id);
    await entry(member, { templateId: t.id, groups: [g.id], distNm: 10 }); // zählt: 10
    await entry(member, { templateId: t.id, distNm: 7 }); // nicht im Verein gezeigt
    await entry(member, { templateId: t.id, groups: [g.id], distNm: 5, visibility: 'unlisted' }); // nicht öffentlich
    await entry(member, { templateId: unlisted.id, groups: [g.id], distNm: 5 }); // Vorlage ohne Faktor
    await entry(member, { templateId: 'fahrtenpreis', groups: [g.id], distNm: 5 }); // keine Vereinsvorlage
    const ex = await entry(member, { templateId: t.id, groups: [g.id], distNm: 6 });
    expect((await s.send('PATCH', `/api/shares/${ex.id}`, member.cookie, { logState: 'excluded' })).status).toBe(200);
    await entry(quiet, { templateId: t.id, groups: [g.id], distNm: 50 }); // ohne Opt-in
    const list = await json<ClubList>(await clubList(owner, g.id));
    expect(list.members.map((m) => m.name)).toEqual([expect.stringContaining('Name ')]);
    expect(list.members[0]).toMatchObject({ points: 10, entries: 1, handle: member.handle });
    expect(list.templates).toEqual([{ id: t.id, name: 'Preis', listWeight: 1 }]);
    // gesperrtes Konto fällt heraus
    await run('UPDATE users SET suspended_at = ? WHERE id = ?', Date.now(), member.user.id);
    expect((await json<ClubList>(await clubList(owner, g.id))).members).toEqual([]);
    await run('UPDATE users SET suspended_at = NULL WHERE id = ?', member.user.id);
    // ausgeblendeter Törn fällt heraus
    await run(`UPDATE shares SET hidden_at = ? WHERE user_id = ?`, Date.now(), member.user.id);
    expect((await json<ClubList>(await clubList(owner, g.id))).members[0]).toMatchObject({ points: 0, entries: 0 });
  });

  it('[F-503] Regel und SQL-Baustein sind gleich (countsInClubList = clubListSql)', async () => {
    const { owner, member, g } = await club();
    const t = await template(owner, { groupId: g.id, name: 'Preis', listWeight: 1 });
    const plain = await template(owner, { groupId: g.id, name: 'Ohne' });
    const e = await entry(member, { templateId: t.id, groups: [g.id] });
    const combos: Array<{ shownInClub: boolean; visibility: Visibility; hidden: boolean; locked: boolean; ownerSuspended: boolean; logState: LogState; optedIn: boolean; templateInList: boolean }> = [];
    for (const visibility of ['public', 'unlisted', 'private'] as Visibility[])
      for (const logState of LOG_STATES)
        for (const flag of ['none', 'shownInClub', 'hidden', 'locked', 'ownerSuspended', 'optedIn', 'templateInList'] as const) {
          const c = { shownInClub: true, visibility, hidden: false, locked: false, ownerSuspended: false, logState, optedIn: true, templateInList: true };
          if (flag === 'shownInClub' || flag === 'optedIn' || flag === 'templateInList') c[flag] = false;
          else if (flag !== 'none') c[flag] = true;
          combos.push(c);
        }
    for (const c of combos) {
      await run('UPDATE shares SET visibility = ?, hidden_at = ?, locked_at = ?, log_state = ?, log = ? WHERE id = ?',
        c.visibility, c.hidden ? 1 : null, c.locked ? 1 : null, c.logState, JSON.stringify({ templateId: c.templateInList ? t.id : plain.id }), e.id);
      await run('UPDATE users SET suspended_at = ? WHERE id = ?', c.ownerSuspended ? 1 : null, member.user.id);
      await run('UPDATE group_members SET scoring_opt_in_at = ? WHERE group_id = ? AND user_id = ?', c.optedIn ? 1 : null, g.id, member.user.id);
      await run('DELETE FROM share_groups WHERE share_id = ?', e.id);
      if (c.shownInClub) await run('INSERT INTO share_groups (share_id, group_id, created_at) VALUES (?, ?, ?)', e.id, g.id, 1);
      const { CLUB_LIST_FROM, clubListSql } = await import('../../worker/scoring-sql');
      const row = await (await h.db()).prepare(`SELECT 1 AS x FROM ${CLUB_LIST_FROM} WHERE s.id = ?2 AND ${clubListSql('?1')}`).bind(g.id, e.id).first();
      expect(!!row, JSON.stringify(c)).toBe(countsInClubList(c));
    }
    await run('UPDATE users SET suspended_at = NULL WHERE id = ?', member.user.id);
  });
});

describe('F-625 … F-631 Vorschlag „Fahrtensegeln – BSV“', () => {
  it('[F-625] [F-630] [F-626] Vorschlag kommt mit Migration 0047; Verein übernimmt ihn; Optimist zählt im Fahrtenbuch und in der Vereinsliste doppelt', async () => {
    const { owner, member, g } = await club();
    const bsv = (await mine(member)).templates.find((t) => t.id === 'bsvfahrten');
    expect(bsv).toMatchObject({ groupId: null, name: 'Fahrtensegeln – Brandenburger Seglerverband e. V.', rules: { unit: 'km', boatClass: 'optimist', classFactor: 2, upstream: 2, longFrom: 200 } });
    const copy = await template(owner, { groupId: g.id, sourceId: 'bsvfahrten', listWeight: 1 });
    expect(copy.rules).toEqual(bsv!.rules);
    await optIn(member, g.id);
    const opti = await s.boat(member, { name: 'Opti', boatClass: 'optimist' });
    // 10 sm binnen im Optimist, davon 2 sm gegen den Strom: 18,52 km × 2 + 3,704 km × 2 = 44,4
    const sh = await entry(member, { templateId: copy.id, groups: [g.id], distNm: 10, log: { area: 'inland', upstreamNm: 2 } });
    expect((await s.send('PATCH', `/api/shares/${sh.id}`, member.cookie, { boatId: opti.id })).status).toBe(200);
    const list = await json<ClubList>(await clubList(owner, g.id));
    expect(list.members[0]).toMatchObject({ points: 44.4, entries: 1 });
    const book = await json<{ entries: Array<{ id: string; boatClass: string | null; log: { upstreamNm?: number } }> }>(await s.send('GET', '/api/me/logbook', member.cookie));
    expect(book.entries.find((x) => x.id === sh.id)).toMatchObject({ boatClass: 'optimist', log: { upstreamNm: 2 } });
    // Jahresbericht: Revier mit Strecke gegen den Strom, Punkte wie in der Liste
    const csv = await (await s.send('GET', `/api/me/logbook.csv?saison=${SEASON}`, member.cookie)).text();
    expect(csv).toContain(';Binnen (2,0 sm gegen den Strom);;');
    expect(csv).toMatch(/;44,4\r\n/);
  });

  it('[F-631] Vorschlag wie jeder andere: nur Admins ändern oder löschen ihn', async () => {
    const p = await s.person();
    expect((await s.send('PATCH', '/api/scoring/templates/bsvfahrten', p.cookie, { name: 'X' })).status).toBe(403);
    expect((await s.send('DELETE', '/api/scoring/templates/bsvfahrten', p.cookie)).status).toBe(403);
  });
});

describe('F-504 Gewichtung je Vorlage', () => {
  it('[F-504] Punkte je Vorlage × Faktor des Vereins; Reihenfolge nach Punkten, ohne Platzziffern', async () => {
    const { owner, member, g } = await club();
    const a = await template(owner, { groupId: g.id, name: 'Meilen', listWeight: 1 });
    const b = await template(owner, { groupId: g.id, name: 'Training', rules: { nmSail: 0, nmMotor: 0, items: [{ name: 'Training', points: 5 }] }, listWeight: 2 });
    await optIn(member, g.id);
    await optIn(owner, g.id);
    await entry(member, { templateId: a.id, groups: [g.id], distNm: 10 });
    await entry(member, { templateId: b.id, groups: [g.id], log: { items: [{ name: 'training', n: 3 }] } });
    await entry(owner, { templateId: a.id, groups: [g.id], distNm: 12 });
    const list = await json<ClubList>(await clubList(owner, g.id));
    // Mitglied: 10 × 1 + (3 × 5) × 2 = 40; Eigner:in 12
    expect(list.members.map((m) => m.points)).toEqual([40, 12]);
    expect(list.members[0]).toMatchObject({ me: false, entries: 2 });
    expect(list.members[0]).not.toHaveProperty('rank');
    // das Mitglied sieht nur die eigene Summe
    expect((await json<ClubList>(await clubList(member, g.id))).members.map((m) => m.points)).toEqual([40]);
    // Faktor ändern wirkt beim nächsten Abruf
    await s.send('PATCH', `/api/scoring/templates/${b.id}`, owner.cookie, { listWeight: null });
    expect((await json<ClubList>(await clubList(member, g.id))).members[0].points).toBe(10);
  });
});

describe('F-505 Jahresbericht als CSV', () => {
  it('[F-418] [F-505] Spalten Revier, Posten, Vorlage, Punkte, Summen je Vorlage und Hinweis „Vereinshilfe“', async () => {
    const p = await s.person();
    await entry(p, { templateId: 'binnen', distNm: 10, log: { area: 'inland', locks: 2, items: [{ name: 'Training', n: 1 }] } });
    await entry(p, { distNm: 5 });
    const res = await h.fetch('/api/me/logbook.csv', { cookie: p.cookie });
    expect(res.status).toBe(200);
    const lines = (await res.text()).replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer;Revier;Posten;Vorlage;Punkte');
    // Binnen-Wanderfahrt: 10 sm + 1 Tag × 5 + 2 Schleusen × 1 + Training 5 = 22
    expect(lines.find((l) => l.includes('Binnen-Wanderfahrt') && !l.startsWith('Summe'))).toMatch(/;Binnen;Training;Binnen-Wanderfahrt;22,0$/);
    expect(lines.find((l) => l.includes(';Nur Meilen;') && !l.startsWith('Summe'))).toMatch(/;Nur Meilen;5,0$/);
    expect(lines).toContain('Summe;;;10,0;;;;;;;Binnen-Wanderfahrt;22,0');
    expect(lines).toContain('Summe;;;5,0;;;;;;;Nur Meilen;5,0');
    expect(lines.at(-1)).toMatch(/Vereinshilfe/);
    // nur „Nur Meilen“: der Meilennachweis wie bisher, ohne Punkte
    const plain = await s.person();
    await entry(plain, { distNm: 5, templateId: BASE_TEMPLATE_ID });
    const text = await (await h.fetch('/api/me/logbook.csv', { cookie: plain.cookie })).text();
    expect(text.replace(/^﻿/, '').split('\r\n')[0]).toBe('Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer');
    expect(text).not.toMatch(/Vereinshilfe/);
  });
});

describe('F-506 Löschwege', () => {
  it('[F-506] Vorlage gelöscht → Einträge rechnen mit „Nur Meilen“; Vorschlag gelöscht → Vereinskopien bleiben', async () => {
    const { owner, member, g } = await club();
    const global = await template(admin, { name: s.uniq('Vorschlag'), rules: { nmSail: 3, nmMotor: 3 } });
    const copy = await template(owner, { groupId: g.id, sourceId: global.id });
    const t = await template(owner, { groupId: g.id, name: 'Weg damit', rules: { nmSail: 2, nmMotor: 2 } });
    await entry(member, { templateId: t.id, distNm: 6 });
    // ein Eintrag mit „Binnen-Wanderfahrt“, damit der Bericht Punkte hat (F-505)
    await entry(member, { templateId: 'binnen', distNm: 7 });
    expect((await s.send('DELETE', `/api/scoring/templates/${t.id}`, owner.cookie)).status).toBe(204);
    const csv = await (await h.fetch('/api/me/logbook.csv', { cookie: member.cookie })).text();
    expect(csv).toMatch(/;Nur Meilen;6,0\r\n/);
    expect((await s.send('DELETE', `/api/scoring/templates/${global.id}`, admin.cookie)).status).toBe(204);
    const left = (await mine(owner)).templates.find((x) => x.id === copy.id);
    expect(left).toMatchObject({ rules: { nmSail: 3 }, sourceName: null });
  });

  it('[F-506] Verein gelöscht → seine Vorlagen fallen; Austritt → Opt-in fällt; Konto gelöscht → Mitgliedschaft samt Opt-in', async () => {
    const { owner, member, g } = await club();
    await template(owner, { groupId: g.id, name: 'Weg' });
    await optIn(member, g.id);
    // Austritt und erneuter Beitritt: nimmt nicht mehr teil
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me`, member.cookie)).status).toBe(204);
    await s.join(owner, g, member);
    expect((await mine(member)).clubs[0]).toMatchObject({ id: g.id, optIn: false });
    // Konto gelöscht
    await optIn(member, g.id);
    expect((await s.send('DELETE', '/api/account', member.cookie)).status).toBeLessThan(300);
    expect((await (await h.db()).prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?').bind(member.user.id).first<{ n: number }>())!.n).toBe(0);
    // Verein gelöscht
    expect((await s.send('DELETE', `/api/groups/${g.id}`, owner.cookie)).status).toBe(204);
    expect((await (await h.db()).prepare('SELECT COUNT(*) AS n FROM scoring_templates WHERE group_id = ?').bind(g.id).first<{ n: number }>())!.n).toBe(0);
  });

  it('[F-506] Konto der Eigner:in gelöscht ohne Nachfolge → Verein und Vorlagen fallen', async () => {
    const owner = await s.person();
    const g = await s.group(owner);
    await template(owner, { groupId: g.id, name: 'Weg' });
    expect((await s.send('DELETE', '/api/account', owner.cookie)).status).toBeLessThan(300);
    expect((await (await h.db()).prepare('SELECT COUNT(*) AS n FROM scoring_templates WHERE group_id = ?').bind(g.id).first<{ n: number }>())!.n).toBe(0);
  });

  it('[F-506] Konten zusammengeführt: Mitgliedschaft samt Opt-in wandert, bei doppelter gilt die des Zielkontos', async () => {
    const both = await club(); // `member` und (unten) `into` sind Mitglied
    const only = await club(); // nur `member`
    const into = await s.person();
    await s.join(both.owner, both.g, into);
    await optIn(both.member, both.g.id);
    await s.join(only.owner, only.g, both.member);
    await optIn(both.member, only.g.id);
    const res = await s.send('POST', `/api/admin/users/${both.member.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: both.member.user.id });
    expect(res.status, await res.clone().text()).toBe(200);
    const { results } = await (await h.db()).prepare('SELECT group_id FROM group_members WHERE user_id = ? AND scoring_opt_in_at IS NOT NULL').bind(into.user.id).all<{ group_id: string }>();
    expect(results.map((r) => r.group_id)).toEqual([only.g.id]);
  });

  it('[F-506] Altbestand: Einträge ohne Vorlage rechnen mit „Nur Meilen“', async () => {
    const p = await s.person();
    const e = await entry(p, { distNm: 6 });
    await run(`UPDATE shares SET log = '{}' WHERE id = ?`, e.id);
    await entry(p, { templateId: 'binnen', distNm: 7 });
    const csv = await (await h.fetch('/api/me/logbook.csv', { cookie: p.cookie })).text();
    expect(csv).toMatch(/;Nur Meilen;6,0\r\n/);
  });
});
