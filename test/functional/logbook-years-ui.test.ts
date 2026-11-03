// @vitest-environment happy-dom
// Fahrtenbuch nach Jahren in der Oberfläche (Konzept 27): Verwaltungsseite mit Saison, Filter und Summen (F-411, F-418,
// F-455), Crew-Zeilen (F-456), Export und Druck (F-457, F-458), Adresse und Einstieg (F-459), Zusatzangaben im Formular
// mit Revier und Vorschlägen aus dem Track (F-412, F-460, F-461), Ablauf im Controller.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-logbook-page';
import '../../src/components/sx-logbook-form';
import '../../src/components/sx-logbook-panel';
import { parseRoute } from '../../src/services/url-state';
import { LogbookPageController } from '../../src/controllers/logbook-page';
import type { SxLogbookPage } from '../../src/components/sx-logbook-page';
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

const entry = (o: Partial<LogbookEntry>): LogbookEntry => ({
  id: 'A', own: true, path: '/s/A', title: 'Havel', startedAt: Date.UTC(2026, 5, 13, 10), endedAt: null, timed: false, source: 'gpx',
  distNm: 10, distSource: 'track', from: { slug: 'potsdam', name: 'Potsdam' }, to: { slug: 'werder', name: 'Werder' },
  role: 'skipper', roleConfirmed: false, boat: 'Möwe', logState: 'suggested', log: {}, ...o,
});
const entries = [
  entry({}),
  entry({ id: 'B', title: 'Ohne GPX', source: 'manual', distSource: 'stated', distNm: 5, logState: 'confirmed', log: { area: 'inland', locks: 2, items: [{ name: 'Training', n: 1 }] } }),
  entry({ id: 'C', title: 'Test', distNm: 99, logState: 'excluded' }),
  entry({ id: 'D', own: false, path: null, title: null, role: 'crew', roleConfirmed: true, logState: 'confirmed', distNm: 20 }),
  entry({ id: 'E', startedAt: Date.UTC(2025, 6, 1), distNm: 3 }),
];

describe('Verwaltungsseite „Mein Fahrtenbuch“', () => {
  it('[F-411] [F-455] Saison-Reiter, Filter mit Mehrfachauswahl, Summen nur über die gefilterten Einträge (ausgeschlossene nie)', async () => {
    const el = await mount('sx-logbook-page', { entries, season: 2026, states: ['confirmed', 'suggested'] });
    const tabs = [...el.shadowRoot.querySelectorAll('[role="tab"]')].map((b) => [b.textContent!.trim(), b.getAttribute('aria-selected')]);
    expect(tabs).toEqual([['2026', 'true'], ['2025', 'false']]);
    expect(el.shadowRoot.querySelector('.seasons')!.hasAttribute('data-scroll-x')).toBe(true);
    expect([...el.shadowRoot.querySelectorAll('li')].map((li) => li.getAttribute('data-id'))).toEqual(['A', 'B', 'D']);
    const sums = text(el.shadowRoot.querySelector('.totals')!);
    expect(sums).toContain('Törns3');
    expect(sums).toContain('35,0 sm');
    expect(sums).toContain('Als Skipper:in');
    expect(sums).toContain('Schleusen2');
    expect(sums).toContain('Training1');
    const seasons = events(el, 'sx-logbook-season');
    const filters = events(el, 'sx-logbook-filter');
    button(el.shadowRoot, /^ *2025/)!.click();
    button(el.shadowRoot, /Vorschläge/)!.click();
    button(el.shadowRoot, /Ausgeschlossen/)!.click();
    expect(seasons).toEqual([{ season: 2025 }]);
    expect(filters).toEqual([{ states: ['confirmed'] }, { states: ['confirmed', 'suggested', 'excluded'] }]);
    // „nur bestätigte“: Summen ändern sich mit dem Filter; der letzte Stand bleibt gewählt
    el.states = ['confirmed'];
    await el.updateComplete;
    expect(text(el.shadowRoot.querySelector('.totals')!)).toContain('25,0 sm');
    button(el.shadowRoot, /Bestätigt/)!.click();
    expect(filters).toHaveLength(2);
    el.states = ['excluded'];
    await el.updateComplete;
    expect(text(el.shadowRoot.querySelector('.totals')!)).toContain('Törns0');
  });

  it('[F-456] Crew-Zeilen ohne Link und Werkzeuge; eigene: bestätigen, ausschließen, wieder aufnehmen, bearbeiten', async () => {
    const el = await mount('sx-logbook-page', { entries, season: 2026, states: ['confirmed', 'suggested', 'excluded'] });
    const crew = el.shadowRoot.querySelector('li[data-id="D"]')!;
    expect(crew.querySelector('a')).toBeNull();
    expect(crew.querySelector('button')).toBeNull();
    expect(text(crew)).toContain('Potsdam → Werder');
    expect(text(crew)).toContain('Crew (bestätigt)');
    const states = events(el, 'sx-logbook-state');
    const edits = events(el, 'sx-logbook-edit-entry');
    button(el.shadowRoot.querySelector('li[data-id="A"]')!, /Bestätigen/)!.click();
    button(el.shadowRoot.querySelector('li[data-id="B"]')!, /Ausschließen/)!.click();
    button(el.shadowRoot.querySelector('li[data-id="C"]')!, /Wieder aufnehmen/)!.click();
    button(el.shadowRoot.querySelector('li[data-id="B"]')!, /Bearbeiten/)!.click();
    expect(states).toEqual([{ id: 'A', logState: 'confirmed' }, { id: 'B', logState: 'excluded' }, { id: 'C', logState: 'suggested' }]);
    expect(edits).toEqual([{ id: 'B' }]);
    expect(el.shadowRoot.querySelector('li[data-id="A"] a')!.getAttribute('href')).toBe('/s/A');
  });

  it('[F-457] [F-458] CSV mit Saison und Filter, Drucken über den Browser; Druckzeile nennt Saison und Filter', async () => {
    const el = await mount('sx-logbook-page', { entries, season: 2026, states: ['confirmed'] });
    const print = events(el, 'sx-logbook-print');
    const csv = el.shadowRoot.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(csv.getAttribute('href')).toBe('/api/me/logbook.csv?saison=2026&stand=confirmed');
    button(el.shadowRoot, /Drucken/)!.click();
    expect(print).toHaveLength(1);
    expect(text(el.shadowRoot.querySelector('.print-only')!)).toContain('Saison 2026 · Bestätigt');
  });

  it('[F-418] Gäste sehen „Anmelden“; leer mit „Eintrag hinzufügen“ ohne Export', async () => {
    const guest = await mount('sx-logbook-page', { signedIn: false });
    const logins = events(guest, 'sx-login');
    button(guest.shadowRoot, /Anmelden/)!.click();
    expect(logins).toHaveLength(1);
    const empty = await mount('sx-logbook-page', { entries: [] });
    const starts = events(empty, 'sx-logbook-start');
    button(empty.shadowRoot, /Eintrag hinzufügen/)!.click();
    expect(starts).toHaveLength(1);
    expect(empty.shadowRoot.querySelector('a[download]')).toBeNull();
  });

  it('[F-459] Adresse /konto/fahrtenbuch; die alte Adresse des Reiters führt dorthin', () => {
    expect(parseRoute({ pathname: '/konto/fahrtenbuch', search: '?saison=2025', hash: '' })).toEqual({ kind: 'logbook' });
    expect(parseRoute({ pathname: '/u/anna', search: '?bereich=fahrtenbuch', hash: '' })).toEqual({ kind: 'logbook', legacy: true });
    expect(parseRoute({ pathname: '/u/anna', search: '', hash: '' })).toEqual({ kind: 'profile', handle: 'anna' });
  });

  it('[F-411] Controller: lädt nach der Anmeldung, wählt die neueste Saison mit Einträgen, merkt Saison und Filter in der Adresse', async () => {
    history.replaceState(null, '', '/konto/fahrtenbuch?stand=excluded');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/me/logbook') return new Response(JSON.stringify({ entries }), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ share: { id: 'A' } }), { headers: { 'Content-Type': 'application/json' } });
    }));
    const page = (await mount('sx-logbook-page', {})) as unknown as SxLogbookPage;
    let signedIn = false;
    let then: (() => void) | null = null;
    const edited: unknown[] = [];
    const c = new LogbookPageController({
      page, toast: () => {}, ready: async () => {}, signedIn: () => signedIn,
      requireLogin: (_r, t) => (then = t), edit: (s) => edited.push(s),
    });
    await c.open();
    expect(page.signedIn).toBe(false);
    expect(calls).toEqual([]);
    signedIn = true;
    then!();
    await vi.waitFor(() => expect(page.entries).toHaveLength(5));
    // im November wäre die laufende Saison schon die nächste – gewählt wird die neueste mit Einträgen
    expect(page.season).toBe(2026);
    expect(page.states).toEqual(['excluded']);
    expect(location.search).toBe('?stand=excluded&saison=2026');
    c.setFilter(['confirmed', 'suggested']);
    c.setSeason(2025);
    expect(location.search).toBe('?saison=2025');
    page.dispatchEvent(new CustomEvent('sx-logbook-state', { detail: { id: 'A', logState: 'confirmed' } }));
    await vi.waitFor(() => expect(calls).toContain('PATCH /api/shares/A'));
    page.dispatchEvent(new CustomEvent('sx-logbook-edit-entry', { detail: { id: 'A' } }));
    await vi.waitFor(() => expect(edited).toEqual([{ id: 'A' }]));
    // Drucken (F-458): der Controller ruft den Druckdialog
    const print = vi.fn();
    vi.stubGlobal('print', print);
    page.dispatchEvent(new CustomEvent('sx-logbook-print'));
    expect(print).toHaveBeenCalledOnce();
  });
});

const gpxShare = (o: Record<string, unknown> = {}) => ({
  id: 'GpxShareId23456789', title: 'Ostsee', visibility: 'public', isOwner: true, distNm: 14, startedAt: Date.UTC(2026, 5, 13, 10), endedAt: Date.UTC(2026, 5, 13, 16),
  source: 'gpx', distSource: 'track', boat: null, from: null, to: null, log: {}, ...o,
});

describe('Zusatzangaben im Fahrtenbuch-Formular', () => {
  it('[F-461] [F-460] GPX-Törn: nur Häfen und Angaben; Vorschlag aus dem Track erst per „Übernehmen“', async () => {
    const el = await mount('sx-logbook-form', { share: gpxShare(), suggestion: { sailH: 4.2, engineH: 1.1, nightH: 0, daysAboard: 1 }, open: true });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[name="date"]')).toBeNull();
    expect(el.shadowRoot.querySelector('[name="dist"]')).toBeNull();
    expect(el.shadowRoot.querySelector('sx-visibility-picker')).toBeNull();
    expect(el.shadowRoot.querySelector('h2')!.textContent).toBe('Fahrtenbuch-Angaben');
    const sail = () => el.shadowRoot.querySelector<HTMLInputElement>('[name="sailH"]')!.value;
    expect(sail()).toBe('');
    expect(text(el.shadowRoot.querySelector('.suggest')!)).toContain('4,2 h unter Segel · 1,1 h Motor · 1 Tag an Bord');
    button(el.shadowRoot, /Übernehmen/)!.click();
    await el.updateComplete;
    expect(sail()).toBe('4,2');
    expect(el.shadowRoot.querySelector<HTMLInputElement>('[name="engineH"]')!.value).toBe('1,1');
    const saves = events(el, 'sx-logbook-save');
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saves).toEqual([{ id: 'GpxShareId23456789', patch: { log: { sailH: 4.2, engineH: 1.1, daysAboard: 1, templateId: 'meilen' }, fromHarbor: null, toHarbor: null } }]);
  });

  it('[F-412] Revier schaltet die Felder um; Regatta und Posten (höchstens zehn) werden mitgespeichert', async () => {
    const el = await mount('sx-logbook-form', { share: gpxShare(), open: true });
    await el.updateComplete;
    const has = (name: string) => !!el.shadowRoot.querySelector(`[name="${name}"]`);
    expect([has('locks'), has('nightH'), has('tidal')]).toEqual([false, false, false]);
    const radios = [...el.shadowRoot.querySelectorAll<HTMLInputElement>('input[name="area"]')];
    expect(radios.map((r) => r.parentElement!.textContent!.trim())).toEqual(['keine Angabe', 'Binnen', 'Küste', 'Offshore']);
    radios[1].click();
    await el.updateComplete;
    expect([has('locks'), has('bridges'), has('mast'), has('nightH')]).toEqual([true, true, true, false]);
    radios[2].click();
    await el.updateComplete;
    expect([has('locks'), has('nightH'), has('tidal')]).toEqual([false, true, true]);
    el.shadowRoot.querySelector<HTMLInputElement>('[name="nightH"]')!.value = '2';
    el.shadowRoot.querySelector<HTMLInputElement>('[name="tidal"]')!.checked = true;
    el.shadowRoot.querySelector<HTMLInputElement>('[name="regattaName"]')!.value = 'Kieler Woche';
    button(el.shadowRoot, /Posten$/)!.click();
    await el.updateComplete;
    const name = el.shadowRoot.querySelector<HTMLInputElement>('#lf-in-0')!;
    name.value = 'Überführung';
    name.dispatchEvent(new Event('input'));
    await el.updateComplete;
    const saves = events(el, 'sx-logbook-save');
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect((saves[0] as { patch: { log: unknown } }).patch.log).toEqual({
      area: 'coastal', tidal: true, nightH: 2, regatta: { name: 'Kieler Woche' }, items: [{ name: 'Überführung', n: 1 }],
      // Vorlage ist Pflicht (F-501): ohne geladene Vorlagen „Nur Meilen“
      templateId: 'meilen',
    });
    for (let i = 1; i < 10; i++) button(el.shadowRoot, /Posten$/)!.click();
    await el.updateComplete;
    expect(button(el.shadowRoot, /Posten$/)).toBeUndefined();
  });

  it('[F-412] Panel zeigt die Zusatzangaben', async () => {
    const el = await mount('sx-logbook-panel', {
      share: gpxShare({ log: { area: 'inland', sailH: 3, locks: 2, bridges: 1, daysAboard: 2, regatta: { name: 'Havelpokal', place: 2, starters: 9 }, items: [{ name: 'Training', n: 1, note: 'Jugend' }] } }),
    });
    const t = text(el.shadowRoot);
    for (const s of ['Binnen', '3,0 h', '2 Schleusen · 1 Brücken', 'Havelpokal – Platz 2 von 9', 'Training', 'Jugend']) expect(t).toContain(s);
  });
});
