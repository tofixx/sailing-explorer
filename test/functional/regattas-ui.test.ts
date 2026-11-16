// @vitest-environment happy-dom
// Funktionale Tests der Regatta-Oberfläche (F-645 … F-654, Konzept 42): Übersicht in Verein/Klassenvereinigung,
// Abschnitt „Regatten“ im eigenen Fahrtenbuch, Art „Klassenvereinigung“ beim Gründen.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-group-regattas';
import '../../src/components/sx-logbook-page';
import '../../src/components/sx-group-page';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
let cleanups: Array<() => void> = [];
function listen(name: string) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  document.addEventListener(name, fn);
  cleanups.push(() => document.removeEventListener(name, fn));
  return got;
}
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
  document.body.innerHTML = '';
});

describe('sx-group-regattas', () => {
  it('[F-650] je Regatta die Ergebnisse mit Namen, Platz und Details; Saisonwahl meldet das Event', async () => {
    const seasons = listen('sx-group-regattas-season');
    const el = await mount('sx-group-regattas', {
      seasons: [2026, 2025],
      data: {
        season: 2026, kind: 'club', truncated: false,
        regattas: [{ name: 'Havelpokal', startedAt: Date.UTC(2026, 5, 1), organizer: 'PYC', results: [
          { path: '/s/S1', startedAt: 0, regatta: { name: 'Havelpokal', place: 1, starters: 20, races: 5 }, person: { name: 'Anna', handle: 'anna' }, role: 'skipper', boat: 'Möwe', boatClass: 'pirat' },
        ] }],
      },
    });
    expect(text(el)).toContain('Havelpokal');
    expect(text(el)).toContain('PYC');
    expect(text(el)).toContain('Platz 1 von 20');
    expect(text(el)).toContain('5 Wettfahrten');
    expect(text(el)).toContain('Pirat');
    expect(el.shadowRoot.querySelector('a[href="/u/anna"]')).not.toBeNull();
    const select = el.shadowRoot.querySelector('select')!;
    select.value = '2025';
    select.dispatchEvent(new Event('change'));
    expect(seasons).toEqual([{ season: 2025 }]);
  });

  it('[F-650] ohne Regatten: Hinweis, wie ein Ergebnis hineinkommt (Klassenvereinigung)', async () => {
    const el = await mount('sx-group-regattas', { seasons: [2026], data: { season: 2026, kind: 'class', truncated: false, regattas: [] } });
    expect(text(el)).toContain('in dieser Klassenvereinigung zeigt');
  });
});

describe('sx-logbook-page: Regatten', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'S1', own: true, path: '/s/S1', title: 'Havelpokal', startedAt: Date.UTC(2026, 5, 1), endedAt: null, timed: false, source: 'manual', distNm: 8,
    distSource: 'stated', from: null, to: null, role: 'skipper', roleConfirmed: false, boat: 'Möwe', boatClass: null, logState: 'confirmed',
    log: { regatta: { name: 'Havelpokal', place: 2, starters: 15 } }, ...over,
  });

  it('[F-647] Abschnitt „Regatten“ mit Ergebnis und CSV-Link der Saison; [F-648] ohne Regatten kein Abschnitt', async () => {
    const el = await mount('sx-logbook-page', { signedIn: true, season: 2026, entries: [entry(), entry({ id: 'S2', log: {} })] });
    expect(text(el)).toContain('Regatten 2026');
    expect(text(el)).toContain('Platz 2 von 15');
    expect(el.shadowRoot.querySelector('a[href^="/api/me/regattas.csv?saison=2026&stand="]')).not.toBeNull();
    const none = await mount('sx-logbook-page', { signedIn: true, season: 2026, entries: [entry({ log: {} })] });
    expect(none.shadowRoot.querySelector('.regattas')).toBeNull();
  });
});

describe('sx-group-page: Klassenvereinigung gründen', () => {
  it('[F-645] Art „Klassenvereinigung“ zeigt die Bootsklassen-Auswahl', async () => {
    const el = await mount('sx-group-page', { mode: 'create', signedIn: true, draft: { kind: 'class' } });
    expect(text(el)).toContain('Klassenvereinigung');
    expect(el.shadowRoot.querySelector('option[value="pirat"]')).not.toBeNull();
  });
});
