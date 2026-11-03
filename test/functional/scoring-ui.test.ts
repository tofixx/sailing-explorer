// @vitest-environment happy-dom
// Wertung in der Oberfläche (Konzept 32): Seite `/konto/wertung` mit Teilnahme, Vereinsliste und Vorlagen (F-500, F-503,
// F-507), Vorlagen-Formular (F-500), Vorlage im Fahrtenbuch-Formular (F-501), Punkte im Fahrtenbuch (F-505), Ablauf im
// Controller.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-scoring-page';
import '../../src/components/sx-scoring-editor';
import '../../src/components/sx-logbook-form';
import '../../src/components/sx-logbook-page';
import '../../src/components/sx-account-menu';
import { parseRoute } from '../../src/services/url-state';
import { ScoringPageController } from '../../src/controllers/scoring-page';
import type { SxScoringPage } from '../../src/components/sx-scoring-page';
import { BASE_RULES, BASE_TEMPLATE, type ScoringTemplate } from '../../src/domain/scoring';
import type { ClubList, MyScoring } from '../../src/services/scoring-api';
import type { LogbookEntry } from '../../src/domain/logbook-year';

type El = HTMLElement & Record<string, unknown> & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };

async function mount(tag: string, props: Record<string, unknown>): Promise<El> {
  const el = document.createElement(tag) as El;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (root: ShadowRoot | Element) => (root.textContent ?? '').replace(/\s+/g, ' ');
const button = (root: ParentNode, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
function events(el: HTMLElement, name: string) {
  const got: unknown[] = [];
  el.addEventListener(name, (e) => got.push((e as CustomEvent).detail));
  return got;
}
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const tpl = (o: Partial<ScoringTemplate>): ScoringTemplate => ({
  id: 'preis', name: 'Fahrtenpreis', rules: { ...BASE_RULES, day: 5 }, groupId: 'C1', groupName: 'SC Möwe', sourceName: null, listWeight: 1, ...o,
});
const global = tpl({ id: 'fahrtenpreis', name: 'Fahrtenpreis klassisch', groupId: null, groupName: null, listWeight: null });
const data = (o: Partial<MyScoring> = {}): MyScoring => ({
  templates: [BASE_TEMPLATE, global, tpl({})],
  lastTemplateId: 'preis',
  clubs: [{ id: 'C1', slug: 'moewe', name: 'SC Möwe', optIn: false, manage: false }],
  admin: false,
  ...o,
});
const list: ClubList = {
  season: 2026,
  templates: [{ id: 'preis', name: 'Fahrtenpreis', listWeight: 1 }],
  members: [
    { name: 'Anna', handle: 'anna', me: false, points: 40, entries: 2, byTemplate: [{ template: 'Fahrtenpreis', points: 40, count: 2 }] },
    { name: 'Ben', handle: null, me: true, points: 12, entries: 1, byTemplate: [] },
  ],
  truncated: false,
};

describe('Seite „Wertung“', () => {
  it('[F-507] Adresse /konto/wertung; ein Einstieg im Konto-Menü', async () => {
    expect(parseRoute({ pathname: '/konto/wertung', search: '', hash: '' })).toEqual({ kind: 'scoring' });
    const menu = await mount('sx-account-menu', { user: { id: 'u', email: 'a@b.de', handle: 'anna', displayName: 'Anna' } });
    const links = [...menu.shadowRoot.querySelectorAll('a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toContainEqual(['Wertung', '/konto/wertung']);
    expect(links.filter(([, href]) => href === '/konto/wertung')).toHaveLength(1);
  });

  it('[F-503] Teilnahme mit Hinweis, wer was sieht; Liste nur mit Opt-in oder als Admin; ohne Platzziffern', async () => {
    const el = await mount('sx-scoring-page', { data: data(), seasons: [2027, 2026, 2025], season: 2026 });
    expect(text(el.shadowRoot)).toContain('keine offizielle Wertung');
    expect(text(el.shadowRoot)).toContain('deinen Namen und deine Punktesumme');
    expect(button(el.shadowRoot, /Vereinsliste zeigen/)).toBeUndefined();
    const optins = events(el, 'sx-scoring-optin');
    const box = el.shadowRoot.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(optins).toEqual([{ groupId: 'C1', optIn: true }]);
    el.data = data({ clubs: [{ id: 'C1', slug: 'moewe', name: 'SC Möwe', optIn: true, manage: false }] });
    await el.updateComplete;
    const lists = events(el, 'sx-scoring-list');
    button(el.shadowRoot, /Vereinsliste zeigen/)!.click();
    expect(lists).toEqual([{ groupId: 'C1', season: 2026 }]);
    el.lists = { C1: list };
    await el.updateComplete;
    const rows = [...el.shadowRoot.querySelectorAll('ul[aria-label^="Vereinsliste"] li')];
    expect(rows.map((r) => text(r))).toEqual([expect.stringContaining('Anna'), expect.stringContaining('Ben (du)')]);
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('/u/anna');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(rows[1].classList.contains('me')).toBe(true);
    expect(el.shadowRoot.querySelector('ol')).toBeNull();
    // Vorlagen pflegen nur Eigner/Admins
    expect(button(el.shadowRoot, /Eigene Vorlage/)).toBeUndefined();
  });

  it('[F-500] Eigner/Admins: Vorschlag übernehmen, eigene anlegen, bearbeiten, löschen; Vorschläge der Plattform nur Admins', async () => {
    const el = await mount('sx-scoring-page', { data: data({ clubs: [{ id: 'C1', slug: 'moewe', name: 'SC Möwe', optIn: false, manage: true }] }), seasons: [2026], season: 2026 });
    const adopt = events(el, 'sx-scoring-adopt');
    const edit = events(el, 'sx-scoring-edit');
    const del = events(el, 'sx-scoring-delete');
    button(el.shadowRoot, /Übernehmen/)!.click();
    expect(adopt).toEqual([{ groupId: 'C1', sourceId: 'fahrtenpreis' }]);
    button(el.shadowRoot, /Eigene Vorlage/)!.click();
    button(el.shadowRoot, /^Bearbeiten: Fahrtenpreis (?!klassisch)/)!.click();
    button(el.shadowRoot, /^Löschen: Fahrtenpreis (?!klassisch)/)!.click();
    expect(edit).toEqual([{ template: null, groupId: 'C1' }, { template: expect.objectContaining({ id: 'preis' }), groupId: 'C1' }]);
    expect(del).toEqual([{ template: expect.objectContaining({ id: 'preis' }) }]);
    // Vorschläge: ohne Admin keine Werkzeuge
    expect(button(el.shadowRoot, /Neuer Vorschlag/)).toBeUndefined();
    expect(button(el.shadowRoot, /Bearbeiten: Fahrtenpreis klassisch/)).toBeUndefined();
    el.data = data({ admin: true });
    await el.updateComplete;
    expect(button(el.shadowRoot, /Neuer Vorschlag/)).toBeDefined();
    expect(button(el.shadowRoot, /Bearbeiten: Fahrtenpreis klassisch/)).toBeDefined();
    // „Nur Meilen“ ist eingebaut
    expect(button(el.shadowRoot, /Bearbeiten: Nur Meilen/)).toBeUndefined();
  });

  it('[F-500] Formular: feste Bausteine, Posten, Faktor nur für Vereine; prüft wie der Server', async () => {
    const el = await mount('sx-scoring-editor', { open: true, template: null, groupId: 'C1' });
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('fieldset').length).toBeGreaterThanOrEqual(7);
    expect(el.shadowRoot.querySelector('textarea')).toBeNull();
    const saves = events(el, 'sx-scoring-save');
    const set = (name: string, v: string) => (el.shadowRoot.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = v);
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await el.updateComplete;
    expect(text(el.shadowRoot.querySelector('[role="alert"]')!)).toMatch(/Namen/);
    set('name', 'Vereinspreis');
    set('day', '11000');
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await el.updateComplete;
    expect(text(el.shadowRoot.querySelector('[role="alert"]')!)).toMatch(/Tag an Bord/);
    set('day', '5');
    const inList = [...el.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
    inList.checked = true;
    inList.dispatchEvent(new Event('change'));
    await el.updateComplete;
    set('weight', '1,5');
    button(el.shadowRoot, /Posten$/)!.click();
    await el.updateComplete;
    const item = el.shadowRoot.querySelector<HTMLInputElement>('.item input')!;
    item.value = 'Training';
    item.dispatchEvent(new Event('input'));
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saves).toEqual([
      { id: null, groupId: 'C1', name: 'Vereinspreis', rules: expect.objectContaining({ day: 5, nmSail: 1, items: [{ name: 'Training', points: 1, cap: 0 }] }), listWeight: 1.5 },
    ]);
    // Vorschlag der Plattform: kein Faktor
    const g = await mount('sx-scoring-editor', { open: true, template: global, groupId: null });
    await g.updateComplete;
    expect(g.shadowRoot.querySelector('[name="weight"]')).toBeNull();
    expect(text(g.shadowRoot)).not.toContain('Vereinsliste');
  });
});

describe('Vorlage im Fahrtenbuch (F-501, F-505)', () => {
  it('[F-501] Fahrtenbuch-Formular: Vorlage Pflicht, vorbelegt mit der zuletzt genutzten, wird gespeichert', async () => {
    const share = { id: 'GpxShareId23456789', title: 'Ostsee', visibility: 'public', isOwner: true, distNm: 14, startedAt: Date.UTC(2026, 5, 13), endedAt: null, source: 'gpx', distSource: 'track', boat: null, from: null, to: null, log: {} };
    const el = await mount('sx-logbook-form', { share, open: true, templates: data().templates, lastTemplateId: 'preis' });
    await el.updateComplete;
    const select = el.shadowRoot.querySelector<HTMLSelectElement>('select[name="templateId"]')!;
    expect(select.required).toBe(true);
    expect([...select.options].map((o) => o.textContent)).toEqual(['Nur Meilen', 'Fahrtenpreis klassisch', 'Fahrtenpreis (SC Möwe)']);
    expect(select.value).toBe('preis');
    const saves = events(el, 'sx-logbook-save');
    select.value = 'fahrtenpreis';
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect((saves[0] as { patch: { log: { templateId: string } } }).patch.log.templateId).toBe('fahrtenpreis');
    // eigene Vorlage des Eintrags geht vor; nicht mehr wählbare → „Nur Meilen“
    el.open = false;
    await el.updateComplete;
    Object.assign(el, { share: { ...share, log: { templateId: 'weg' } }, lastTemplateId: 'auchweg', open: true });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector<HTMLSelectElement>('select[name="templateId"]')!.value).toBe('meilen');
  });

  it('[F-505] Fahrtenbuch: Punkte je Eintrag und je Vorlage, Hinweis „Vereinshilfe“, Druckzeile „Jahresbericht“', async () => {
    const e = (o: Partial<LogbookEntry>): LogbookEntry => ({
      id: 'A', own: true, path: '/s/A', title: 'Havel', startedAt: Date.UTC(2026, 5, 13, 10), endedAt: null, timed: false, source: 'manual',
      distNm: 10, distSource: 'stated', from: null, to: null, role: null, roleConfirmed: false, boat: null, logState: 'confirmed', log: {}, ...o,
    });
    const el = await mount('sx-logbook-page', {
      entries: [e({ log: { templateId: 'preis' } }), e({ id: 'B', distNm: 4 }), e({ id: 'C', logState: 'excluded', distNm: 99 })],
      season: 2026, states: ['confirmed', 'suggested', 'excluded'], templates: data().templates,
    });
    const rows = [...el.shadowRoot.querySelectorAll('li')].map((li) => text(li));
    expect(rows[0]).toContain('15,0 Punkte · Fahrtenpreis (SC Möwe)');
    expect(rows[1]).toContain('4,0 Punkte · Nur Meilen');
    expect(rows[2]).not.toContain('Punkte');
    const pts = text(el.shadowRoot.querySelector('[aria-label="Punkte je Vorlage"]')!);
    expect(pts).toContain('Fahrtenpreis (SC Möwe)15,0');
    expect(pts).toContain('Nur Meilen4,0');
    expect(text(el.shadowRoot)).toContain('keine offizielle Wertung');
    expect(el.shadowRoot.querySelector('a[href="/konto/wertung"]')).not.toBeNull();
    expect(text(el.shadowRoot.querySelector('.print-only')!)).toContain('Jahresbericht Saison 2026');
  });
});

describe('Ablauf (ScoringPageController)', () => {
  it('[F-503] [F-500] lädt nach der Anmeldung, schaltet Teilnahme, lädt die Liste, übernimmt, löscht nur nach Rückfrage', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const body = url === '/api/me/scoring' ? data() : url.startsWith('/api/groups/C1/scoring?') ? list : url.includes('templates') ? { template: tpl({}) } : { optIn: true };
      return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }));
    const page = (await mount('sx-scoring-page', {})) as unknown as SxScoringPage;
    let signedIn = false;
    let then: (() => void) | null = null;
    const answers = [false, true];
    const c = new ScoringPageController({
      page, toast: () => {}, ready: async () => {}, signedIn: () => signedIn, requireLogin: (_r, t) => (then = t), ask: async () => answers.shift()!,
    });
    await c.open();
    expect(page.signedIn).toBe(false);
    expect(calls).toEqual([]);
    signedIn = true;
    then!();
    await vi.waitFor(() => expect(page.data?.clubs).toHaveLength(1));
    expect(page.seasons).toHaveLength(3);
    await c.optIn('C1', true);
    expect(calls).toContain('PUT /api/groups/C1/scoring');
    await c.list('C1', 2026);
    expect(page.lists.C1.members).toHaveLength(2);
    await c.adopt('C1', 'fahrtenpreis');
    expect(calls).toContain('POST /api/scoring/templates');
    await c.remove(tpl({}));
    expect(calls.filter((x) => x.startsWith('DELETE'))).toEqual([]);
    await c.remove(tpl({}));
    expect(calls).toContain('DELETE /api/scoring/templates/preis');
  });
});
