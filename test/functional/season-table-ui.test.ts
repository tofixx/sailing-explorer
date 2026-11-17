// @vitest-environment happy-dom
// Funktionale Tests der Jahresansicht im Profil (F-665 … F-669, Konzept 43): Tabelle je Saison, Fahrten der gewählten
// Saison, Schalter „anderen zeigen“ nur für sich selbst, Abschnitt auf der Profilseite.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-season-table';
import '../../src/components/sx-profile-page';

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

const row = (o: Record<string, unknown> = {}) => ({
  path: '/s/S1', title: 'Havel', startedAt: Date.UTC(2026, 5, 1), distNm: 12, recorded: true, role: 'skipper', boat: 'Möwe', own: true, regatta: null, ...o,
});

describe('sx-season-table', () => {
  it('[F-665] Saisons mit Summen, Fahrten der neuesten Saison; Klick wählt eine andere Saison', async () => {
    const el = await mount('sx-season-table', {
      rows: [row(), row({ title: 'Pokal', startedAt: Date.UTC(2026, 6, 1), regatta: { name: 'Havelpokal', place: 2, starters: 10 } }), row({ title: 'Alt', startedAt: Date.UTC(2025, 5, 1), recorded: false })],
    });
    expect(text(el)).toContain('Fahrten 2026');
    expect(text(el)).toContain('Platz 2 von 10');
    expect(text(el)).not.toContain('Alt ');
    [...el.shadowRoot.querySelectorAll<HTMLButtonElement>('button.season')].find((b) => b.textContent?.trim() === '2025')!.click();
    await el.updateComplete;
    expect(text(el)).toContain('Fahrten 2025');
    expect(el.shadowRoot.querySelector('input[type=checkbox]')).toBeNull(); // fremde Ansicht: kein Schalter
  });

  it('[F-667] eigene Ansicht: Schalter meldet sx-season-table-mode; Hinweis bei privatem Profil', async () => {
    const modes = listen('sx-season-table-mode');
    const el = await mount('sx-season-table', { rows: [row()], self: true, mode: 'public', profilePrivate: true });
    expect(text(el)).toContain('Dein Profil ist nicht öffentlich');
    const box = el.shadowRoot.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(modes).toEqual([{ mode: 'private' }]);
  });
});

describe('sx-profile-page: Jahresansicht', () => {
  it('[F-666] Abschnitt nur mit geladenen Daten', async () => {
    const data = (seasons: unknown) => ({
      kind: 'profile', profile: { handle: 'anna', displayName: 'Anna', bio: '', visibility: 'public', shareKey: null, link: '/u/anna', isSelf: false },
      boats: [], stats: { voyages: 1, distNm: 12 }, voyages: [], seasons,
    });
    const el = await mount('sx-profile-page', { data: data({ mode: 'public', self: false, rows: [row()], truncated: false }) });
    expect(el.shadowRoot.querySelector('sx-season-table')).not.toBeNull();
    const none = await mount('sx-profile-page', { data: data(null) });
    expect(none.shadowRoot.querySelector('sx-season-table')).toBeNull();
  });
});
