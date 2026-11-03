// @vitest-environment happy-dom
// Bootsklasse in der Oberfläche (Konzept 34): Auswahl im Bootsformular (F-536) und Filter auf /entdecken (F-539) –
// Komponenten und Controller, Netz gefälscht.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-discover';
import '../../src/components/sx-account-dialog';
import type { SxDiscover } from '../../src/components/sx-discover';
import { DiscoverController } from '../../src/controllers/discover';
import { Store, initialState } from '../../src/services/store';
import { SUPPORT_TIERS } from '../../src/domain/support';
import { BOAT_CLASSES } from '../../src/domain/boat-class';
import type { DiscoverData } from '../../src/services/api';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const data = (o: Partial<DiscoverData> = {}): DiscoverData => ({ voyages: [], boats: [], people: [], ...o });

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
  vi.unstubAllGlobals();
});

describe('F-539 Bootsklasse auf /entdecken', () => {
  it('[F-539] Auswahl „Alle Bootsklassen“ mit Gruppen („Alle Jollen“) und allen Klassen; Wahl meldet sx-discover-class', async () => {
    const got = listen('sx-discover-class');
    const el = await mount('sx-discover', { variant: 'page', data: data() });
    const select = el.shadowRoot.querySelector<HTMLSelectElement>('select[aria-label="Bootsklasse"]')!;
    expect(select.options[0]).toMatchObject({ value: '', text: 'Alle Bootsklassen' });
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['jollen', 'kielboote', 'yachten', ...BOAT_CLASSES.map((c) => c.id)]));
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Jollen', 'Kielboote', 'Yachten und Mehrrumpf']);
    select.value = 'folkeboot';
    select.dispatchEvent(new Event('change'));
    expect(got).toEqual([{ boatClass: 'folkeboot' }]);
  });

  it('[F-539] gewählte Klasse steht in der Auswahl; ohne Treffer ein Hinweis statt leerer Abschnitte', async () => {
    const el = await mount('sx-discover', { variant: 'page', boatClass: 'jollen', data: data({ boatClass: 'jollen', harbors: [], groups: [] }) });
    expect(el.shadowRoot.querySelector<HTMLSelectElement>('select[aria-label="Bootsklasse"]')!.value).toBe('jollen');
    expect(text(el)).toContain('Keine öffentlichen Boote dieser Klasse.');
    expect(el.shadowRoot.querySelectorAll('section')).toHaveLength(0);
  });

  it('[F-539] Bootskarte nennt den freien Typ, ohne ihn die Klasse', async () => {
    const boat = { id: 'B1', name: 'Möwe', boatType: '', boatClass: 'h-boot', lengthM: null, homePort: '', createdAt: 0, owner: { handle: 'a', displayName: 'A' }, stats: { voyages: 0, distNm: 0 } };
    const el = await mount('sx-discover', { variant: 'page', data: data({ boats: [boat, { ...boat, id: 'B2', boatType: 'Eigenbau' }] }) });
    expect(el.shadowRoot.querySelector('a[href="/b/B1"]')!.textContent).toContain('H-Boot');
    expect(el.shadowRoot.querySelector('a[href="/b/B2"]')!.textContent).toContain('Eigenbau');
    expect(el.shadowRoot.querySelector('a[href="/b/B2"]')!.textContent).not.toContain('H-Boot');
  });

  it('[F-539] Controller: ?klasse= aus der Adresse, Wahl lädt sofort und steht in der Adresse, Unbekanntes filtert nicht', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(data()), { headers: { 'Content-Type': 'application/json' } });
    });
    history.replaceState(null, '', '/entdecken?klasse=folkeboot');
    const page = document.createElement('sx-discover') as SxDiscover;
    document.body.append(page);
    const c = new DiscoverController(new Store({ ...initialState, user: null, backend: true } as typeof initialState), page);
    await c.open();
    expect(urls).toEqual(['/api/discover?limit=24&klasse=folkeboot']);
    expect(page.boatClass).toBe('folkeboot');
    await c.setBoatClass('jollen');
    expect(urls.at(-1)).toBe('/api/discover?limit=24&klasse=jollen');
    expect(location.search).toBe('?klasse=jollen');
    await c.setBoatClass('');
    expect(urls.at(-1)).toBe('/api/discover?limit=24');
    expect(location.search).toBe('');
    history.replaceState(null, '', '/entdecken?klasse=quatsch');
    await c.open();
    expect(urls.at(-1)).toBe('/api/discover?limit=24');
    expect(page.boatClass).toBe('');
  });
});

describe('F-536 Bootsklasse im Bootsformular', () => {
  const USER = { id: 'U1234567890abcdefg', email: 'skipper@example.org' };
  const boat = (o: Record<string, unknown> = {}) => ({
    id: 'BoatId1234567890', name: 'Möwe', boatType: 'Folkeboot', boatClass: 'folkeboot', lengthM: null, sailNumber: '', homePort: '', description: '',
    visibility: 'public', shareKey: null, link: '/b/BoatId1234567890', createdAt: 0, updatedAt: 0, owner: null, role: 'owner', ...o,
  });
  const status = { supporter: true, supporterUntil: null, sharesUsed: 0, sharesFree: 3, sharesMax: 100, bytesUsed: 0, bytesMax: 1 };
  async function edit(b: ReturnType<typeof boat>) {
    const el = await mount('sx-account-dialog', { open: true, tab: 'boats', user: USER, shares: [], boats: [b], loading: false, error: '', supportStatus: status, supportTiers: SUPPORT_TIERS });
    [...el.shadowRoot.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === `Bearbeiten: ${b.name}`)!.click();
    await el.updateComplete;
    return el;
  }

  it('[F-536] aus dem Typ abgeleitete Klasse steht auf „Automatisch“ (folgt dem Typ), eine abweichende als Wahl', async () => {
    const auto = await edit(boat());
    const sel = auto.shadowRoot.querySelector<HTMLSelectElement>('select[name="boatClass"]')!;
    expect(sel.value).toBe('');
    expect(sel.options[0].text).toBe('Automatisch: Folkeboot');
    document.body.innerHTML = '';
    const chosen = await edit(boat({ boatType: 'Eigenbau', boatClass: 'drachen' }));
    // Vorauswahl per selected-Attribut (happy-dom wertet es in optgroup nicht für .value aus)
    expect(chosen.shadowRoot.querySelector<HTMLOptionElement>('select[name="boatClass"] option[selected]')!.value).toBe('drachen');
  });

  it('[F-536] Speichern sendet die Wahl als boatClass (leer = automatisch)', async () => {
    const saves = listen('sx-boat-save');
    const el = await edit(boat());
    const sel = el.shadowRoot.querySelector<HTMLSelectElement>('select[name="boatClass"]')!;
    sel.value = 'sonstige';
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saves).toEqual([{ id: 'BoatId1234567890', input: expect.objectContaining({ boatType: 'Folkeboot', boatClass: 'sonstige' }) }]);
  });
});
