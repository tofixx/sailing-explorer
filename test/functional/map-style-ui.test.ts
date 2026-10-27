// @vitest-environment happy-dom
// Kartenstil-Menü (F-218): Zahnrad über der Karte, Menü mit den Stilen, ein Klick wendet sofort an; angemeldet
// „als Standard setzen“ und „Standard entfernen“. Controller (F-219): Vorrang Ansicht > Profil, nichts lokal gespeichert.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-map-style';
import type { SxMapStyle } from '../../src/components/sx-map-style';
import { MapStyleController } from '../../src/controllers/map-style';
import { Store, initialState } from '../../src/services/store';
import { MAP_STYLE_IDS } from '../../src/domain/map-style';

type LitEl = SxMapStyle & { shadowRoot: ShadowRoot };

async function mount(props: Partial<SxMapStyle> = {}): Promise<LitEl> {
  const el = document.createElement('sx-map-style') as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const items = (el: LitEl) => [...el.shadowRoot.querySelectorAll<HTMLButtonElement>('.item')];
const byText = (el: LitEl, t: string) => [...el.shadowRoot.querySelectorAll('button')].find((b) => b.textContent!.includes(t));
const menu = (el: LitEl) => el.shadowRoot.querySelector<HTMLElement>('#ms')!;

function applied(el: LitEl) {
  const got: unknown[] = [];
  el.addEventListener('sx-map-style-apply', (e) => got.push((e as CustomEvent).detail));
  return got;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('F-218 Kartenstil-Menü', () => {
  it('[F-218] Zahnrad öffnet ein Menü mit allen Stilen, der geltende ist markiert, je mit Farbverlauf', async () => {
    const el = await mount({ current: 'contrast' });
    const gear = el.shadowRoot.querySelector<HTMLButtonElement>('.toggle')!;
    expect(gear.getAttribute('aria-label')).toBe('Ansicht konfigurieren');
    expect(menu(el).hidden).toBe(true);
    gear.click();
    await el.updateComplete;
    expect(el.open).toBe(true);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect(menu(el).hidden).toBe(false);
    expect(items(el).map((b) => b.textContent!.trim().split(/\s/)[0])).toEqual(['Klassisch', 'Kontrast', 'Farbenblind-freundlich', 'Dezent']);
    expect(items(el).length).toBe(MAP_STYLE_IDS.length);
    expect(items(el).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent!.trim())).toEqual(['Kontrast']);
    for (const b of items(el)) expect(b.querySelector('.bar')!.getAttribute('style')).toContain('linear-gradient');
  });

  it('[F-218] ein Klick auf einen Stil wendet ihn sofort an (ohne weiteren Knopf); der geltende schließt nur', async () => {
    const el = await mount({ current: 'classic', open: true });
    const got = applied(el);
    items(el)[2].click();
    expect(got).toEqual([{ id: 'colorblind', scope: 'now' }]);
    items(el)[0].click();
    expect(got.length).toBe(1);
    expect(el.open).toBe(false);
    expect(byText(el, 'Nur jetzt')).toBeUndefined();
  });

  it('[F-218] Fokus: beim Öffnen auf den geltenden Stil, beim Schließen zurück aufs Zahnrad; Tab hinaus schließt', async () => {
    const el = await mount({ current: 'subtle' });
    const gear = el.shadowRoot.querySelector<HTMLButtonElement>('.toggle')!;
    gear.click();
    await el.updateComplete;
    expect(el.shadowRoot.activeElement).toBe(items(el)[3]);
    menu(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot.activeElement).toBe(gear);
    el.open = true;
    await el.updateComplete;
    const outside = document.createElement('button');
    document.body.append(outside);
    items(el)[3].dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: outside }));
    expect(el.open).toBe(false);
  });

  it('[F-218] während gespeichert wird, sind die Stile gesperrt', async () => {
    const el = await mount({ open: true, busy: true });
    expect(items(el).every((b) => b.disabled)).toBe(true);
  });

  it('[F-218] Escape oder ein Klick daneben schließt; während gespeichert wird, bleibt es offen', async () => {
    const el = await mount({ open: true });
    menu(el).dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(el.open).toBe(true);
    el.busy = true;
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(el.open).toBe(true);
    el.busy = false;
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(el.open).toBe(false);
    el.open = true;
    await el.updateComplete;
    menu(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(el.open).toBe(false);
  });

  it('[F-218] Gast: kein „als Standard“, Hinweis auf die Anmeldung', async () => {
    const el = await mount({ open: true, signedIn: false });
    expect(byText(el, 'Standard')).toBeUndefined();
    expect(menu(el).textContent).toContain('Gilt bis zum Neuladen');
  });

  it('[F-218] angemeldet: den geltenden Stil als Standard setzen; Standard markiert und entfernbar', async () => {
    const el = await mount({ open: true, signedIn: true, current: 'subtle', profileStyle: null });
    const got = applied(el);
    expect(byText(el, 'Standard entfernen')).toBeUndefined();
    byText(el, '„Dezent“ als Standard setzen')!.click();
    expect(got.at(-1)).toEqual({ id: 'subtle', scope: 'profile' });

    Object.assign(el, { profileStyle: 'subtle' });
    await el.updateComplete;
    expect(byText(el, '„Dezent“ ist dein Standard')!.disabled).toBe(true);
    expect(items(el)[3].textContent).toContain('Standard');
    byText(el, 'Standard entfernen')!.click();
    expect(got.at(-1)).toEqual({ id: 'subtle', scope: 'reset' });
  });
});

// ---------------------------------------------------------------- Controller

const USER = { id: 'U1234567890abcdefg', email: 'skipper@example.org' };

function server(initial: string | null) {
  const state = { mapStyle: initial, patches: [] as unknown[] };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/me/settings') return new Response('nope', { status: 404 });
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { mapStyle: string };
        state.patches.push(body);
        state.mapStyle = body.mapStyle;
      }
      return json({ notifyComments: 'off', mapStyle: state.mapStyle, suspended: false, hasProfile: true, isAdmin: false });
    }),
  );
  return state;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const store = new Store({ ...initialState });
  const picker = {} as SxMapStyle;
  const toast = vi.fn();
  const c = new MapStyleController(store, { picker, toast });
  return { store, picker, toast, c };
}

async function signIn(store: Store) {
  store.set({ user: USER });
  await flush();
  await flush();
}

describe('F-219 Kartenstil: Vorrang und Standard', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('[F-219] Auswahl gilt sofort und nur für diese Ansicht: nichts lokal gespeichert, neu geöffnet wieder der Standard', async () => {
    server(null);
    const { store, picker, c } = setup();
    expect(store.get().mapStyle).toBe('classic');
    picker.open = true;
    await c.choose('colorblind', 'now');
    expect(store.get().mapStyle).toBe('colorblind');
    expect(picker.open).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(setup().store.get().mapStyle).toBe('classic');
  });

  it('[F-219] angemeldet: Profil-Standard gilt nach der Anmeldung; eine Auswahl schreibt nicht ins Profil und ist neu geöffnet weg', async () => {
    const srv = server('contrast');
    const { store, picker, c } = setup();
    await signIn(store);
    expect(store.get().mapStyle).toBe('contrast');
    expect(picker.profileStyle).toBe('contrast');
    expect(picker.signedIn).toBe(true);
    await c.choose('colorblind', 'now');
    expect(store.get().mapStyle).toBe('colorblind');
    expect(srv.patches).toEqual([]);

    const again = setup();
    await signIn(again.store);
    expect(again.store.get().mapStyle).toBe('contrast');
  });

  it('[F-219] als Standard setzen schreibt ins Profil und gilt nach dem neuen Öffnen', async () => {
    const srv = server(null);
    const { store, picker, toast, c } = setup();
    await signIn(store);
    await c.choose('subtle', 'now');
    picker.open = true;
    await c.choose('subtle', 'profile');
    expect(srv.patches).toEqual([{ mapStyle: 'subtle' }]);
    expect(store.get().mapStyle).toBe('subtle');
    expect(picker.profileStyle).toBe('subtle');
    expect(picker.open).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('allen Geräten'));
    const again = setup();
    await signIn(again.store);
    expect(again.store.get().mapStyle).toBe('subtle');
  });

  it('[F-219] Standard entfernen: Profil null, die Ansicht bleibt, neu geöffnet gilt „Klassisch“', async () => {
    const srv = server('subtle');
    const { store, picker, c } = setup();
    await signIn(store);
    await c.choose('subtle', 'reset');
    expect(srv.patches).toEqual([{ mapStyle: null }]);
    expect(picker.profileStyle).toBeNull();
    expect(store.get().mapStyle).toBe('subtle');
    const again = setup();
    await signIn(again.store);
    expect(again.store.get().mapStyle).toBe('classic');
  });

  it('[F-219] Abmelden vergisst das Profil; Wechsel der Törn-Ansicht schließt das Menü', async () => {
    server('subtle');
    const { store, picker } = setup();
    await signIn(store);
    expect(store.get().mapStyle).toBe('subtle');
    picker.open = true;
    store.set({ home: true });
    expect(picker.open).toBe(false);
    store.set({ user: null });
    await flush();
    expect(store.get().mapStyle).toBe('classic');
  });

  it('[F-219] wird während des Speicherns ein anderer Stil gewählt, bleibt er nach der Antwort', async () => {
    server(null);
    const { store, c } = setup();
    await signIn(store);
    const saving = c.choose('subtle', 'reset');
    await c.choose('contrast', 'now');
    await saving;
    expect(store.get().mapStyle).toBe('contrast');
  });

  it('[F-219] ist beim Start schon jemand angemeldet, lädt der Controller das Profil sofort', async () => {
    server('colorblind');
    const store = new Store({ ...initialState, user: USER });
    const picker = {} as SxMapStyle;
    new MapStyleController(store, { picker, toast: vi.fn() });
    expect(picker.signedIn).toBe(true);
    await flush();
    await flush();
    expect(store.get().mapStyle).toBe('colorblind');
  });

  it('[F-219] Fehler beim Speichern bleibt im Menü sichtbar, nichts ändert sich', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x', message: 'Kaputt' }), { status: 500, headers: { 'Content-Type': 'application/json' } })));
    const { store, picker, c } = setup();
    await signIn(store);
    picker.open = true;
    await c.choose('contrast', 'profile');
    expect(picker.error).toBeTruthy();
    expect(picker.open).toBe(true);
    expect(store.get().mapStyle).toBe('classic');
  });
});
