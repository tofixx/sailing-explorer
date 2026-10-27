// @vitest-environment happy-dom
// „Ansicht konfigurieren“ (F-218): Popover mit Vorschau je Set, Übernehmen fragt angemeldet „Nur jetzt“ oder „Als Standard
// im Profil“, Gäste nur lokal. Controller (F-219): Vorrang Sitzung > Profil > Gerät, Speichern im Profil, Vorschau verwerfen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-map-style';
import type { SxMapStyle } from '../../src/components/sx-map-style';
import { MapStyleController } from '../../src/controllers/map-style';
import { Store, initialState } from '../../src/services/store';
import { MAP_STYLE_IDS } from '../../src/domain/map-style';

type LitEl = SxMapStyle & { shadowRoot: ShadowRoot };

HTMLDialogElement.prototype.show ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

async function mount(props: Partial<SxMapStyle> = {}): Promise<LitEl> {
  const el = document.createElement('sx-map-style') as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const buttons = (el: LitEl) => [...el.shadowRoot.querySelectorAll('button')];
const byText = (el: LitEl, t: string) => buttons(el).find((b) => b.textContent!.includes(t));

function events(el: LitEl) {
  const got: Array<[string, unknown]> = [];
  for (const name of ['sx-map-style-preview', 'sx-map-style-apply', 'sx-map-style-cancel']) {
    el.addEventListener(name, (e) => got.push([name, (e as CustomEvent).detail]));
  }
  return got;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('F-218 Ansicht konfigurieren', () => {
  it('[F-218] Knopf öffnet ein Popover mit allen Sets, je mit Vorschau (Verlauf, Wind- und Wellen-Symbole)', async () => {
    const el = await mount({ current: 'contrast' });
    const toggle = byText(el, 'Ansicht konfigurieren')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await el.updateComplete;
    expect(el.open).toBe(true);
    expect(el.shadowRoot.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    const opts = [...el.shadowRoot.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(opts.map((o) => o.value)).toEqual(MAP_STYLE_IDS);
    expect(opts.find((o) => o.checked)!.value).toBe('contrast');
    const previews = el.shadowRoot.querySelectorAll('.preview');
    expect(previews.length).toBe(4);
    for (const p of previews) {
      expect(p.querySelector('.bar')!.getAttribute('style')).toContain('linear-gradient');
      expect(p.querySelectorAll('svg').length).toBe(4);
    }
    expect(el.shadowRoot.textContent).toContain('Farbenblind-freundlich');
  });

  it('[F-218] Auswahl meldet eine Vorschau; Abbrechen und Escape verwerfen sie', async () => {
    const el = await mount();
    const got = events(el);
    el.open = true;
    await el.updateComplete;
    const cb = el.shadowRoot.querySelector<HTMLInputElement>('input[value=colorblind]')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(got).toEqual([['sx-map-style-preview', { id: 'colorblind' }]]);
    byText(el, 'Abbrechen')!.click();
    expect(got.at(-1)![0]).toBe('sx-map-style-cancel');
    expect(el.open).toBe(false);

    el.open = true;
    await el.updateComplete;
    el.shadowRoot.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(got.at(-1)![0]).toBe('sx-map-style-cancel');
    expect(el.open).toBe(false);
  });

  it('[F-218] Klick neben das Popover verwirft die Vorschau; während des Speicherns bleibt es offen', async () => {
    const el = await mount({ signedIn: true });
    const got = events(el);
    el.open = true;
    await el.updateComplete;
    el.shadowRoot.querySelector('dialog')!.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(el.open).toBe(true); // im Popover
    el.busy = true;
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(el.open).toBe(true);
    el.busy = false;
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(el.open).toBe(false);
    expect(got.at(-1)![0]).toBe('sx-map-style-cancel');
  });

  it('[F-218] Gast: nur „Übernehmen“ (gilt auf diesem Gerät), mit Hinweis auf das Profil', async () => {
    const el = await mount({ signedIn: false });
    const got = events(el);
    el.open = true;
    await el.updateComplete;
    expect(byText(el, 'Als Standard')).toBeUndefined();
    expect(byText(el, 'Übernehmen')!.disabled).toBe(true); // unverändert
    el.shadowRoot.querySelector<HTMLInputElement>('input[value=subtle]')!.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Gilt auf diesem Gerät');
    byText(el, 'Übernehmen')!.click();
    expect(got.at(-1)).toEqual(['sx-map-style-apply', { id: 'subtle', scope: 'now' }]);
  });

  it('[F-218] angemeldet: „Nur jetzt“ oder „Als Standard speichern“; der Profil-Standard ist markiert', async () => {
    const el = await mount({ signedIn: true, current: 'classic', profileStyle: 'contrast' });
    const got = events(el);
    el.open = true;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('input[value=contrast]')!.closest('label')!.textContent).toContain('Profil-Standard');
    expect(byText(el, 'Nur jetzt')!.disabled).toBe(true);
    expect(byText(el, 'Als Standard speichern')!.disabled).toBe(false);
    el.shadowRoot.querySelector<HTMLInputElement>('input[value=contrast]')!.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(byText(el, 'Nur jetzt')!.disabled).toBe(false);
    // Standard ist es schon – „Als Standard“ holt ihn aber zurück, solange „Nur jetzt“ etwas anderes zeigt
    expect(byText(el, 'Als Standard speichern')!.disabled).toBe(false);
    el.current = 'contrast';
    await el.updateComplete;
    expect(byText(el, 'Als Standard speichern')!.disabled).toBe(true);
    el.current = 'classic';
    await el.updateComplete;
    byText(el, 'Nur jetzt')!.click();
    expect(got.at(-1)).toEqual(['sx-map-style-apply', { id: 'contrast', scope: 'now' }]);
    el.shadowRoot.querySelector<HTMLInputElement>('input[value=colorblind]')!.dispatchEvent(new Event('change'));
    await el.updateComplete;
    byText(el, 'Als Standard speichern')!.click();
    expect(got.at(-1)).toEqual(['sx-map-style-apply', { id: 'colorblind', scope: 'profile' }]);
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

describe('F-219 Kartenstil: Vorrang und Speichern', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('[F-219] Gast: „Nur jetzt“ merkt sich das Gerät (localStorage) und gilt nach dem Neuladen weiter', async () => {
    server(null);
    const { store, c } = setup();
    expect(store.get().mapStyle).toBe('classic');
    await c.choose('colorblind', 'now');
    expect(store.get().mapStyle).toBe('colorblind');
    expect(localStorage.getItem('sx-map-style')).toBe('colorblind');
    expect(sessionStorage.getItem('sx-map-style')).toBeNull();
    sessionStorage.clear(); // neuer Tab
    expect(setup().store.get().mapStyle).toBe('colorblind');
  });

  it('[F-219] angemeldet: Profil-Standard gilt nach der Anmeldung (auch vor der Gerätewahl), „Nur jetzt“ nur in diesem Tab', async () => {
    localStorage.setItem('sx-map-style', 'subtle');
    const srv = server('contrast');
    const { store, picker, c } = setup();
    expect(store.get().mapStyle).toBe('subtle');
    store.set({ user: USER });
    await flush();
    await flush();
    expect(store.get().mapStyle).toBe('contrast');
    expect(picker.profileStyle).toBe('contrast');
    expect(picker.signedIn).toBe(true);

    await c.choose('colorblind', 'now');
    expect(store.get().mapStyle).toBe('colorblind');
    expect(srv.patches).toEqual([]);
    expect(localStorage.getItem('sx-map-style')).toBe('subtle'); // Gerätewahl bleibt unberührt

    sessionStorage.clear(); // neuer Tab: wieder der Profil-Standard
    const again = setup();
    again.store.set({ user: USER });
    await flush();
    await flush();
    expect(again.store.get().mapStyle).toBe('contrast');
  });

  it('[F-219] Gast wählt, meldet sich im selben Tab an: dann gilt der Profil-Standard', async () => {
    server('subtle');
    const { store, c } = setup();
    await c.choose('colorblind', 'now');
    expect(store.get().mapStyle).toBe('colorblind');
    store.set({ user: USER });
    await flush();
    await flush();
    expect(store.get().mapStyle).toBe('subtle');
  });

  it('[F-219] offenes Popover: das Laden des Profils überschreibt die Vorschau nicht; Wechsel der Törn-Ansicht verwirft sie', async () => {
    server('subtle');
    const { store, picker, c } = setup();
    picker.open = true;
    c.preview('contrast');
    store.set({ user: USER });
    await flush();
    await flush();
    expect(store.get().mapStyle).toBe('contrast');
    expect(picker.current).toBe('subtle');
    store.set({ home: true });
    expect(picker.open).toBe(false);
    expect(store.get().mapStyle).toBe('subtle');
  });

  it('[F-219] „Als Standard speichern“ schreibt ins Profil, hebt „Nur jetzt“ auf und schließt das Popover', async () => {
    const srv = server(null);
    const { store, picker, toast, c } = setup();
    store.set({ user: USER });
    await flush();
    await c.choose('contrast', 'now');
    picker.open = true;
    await c.choose('colorblind', 'profile');
    expect(srv.patches).toEqual([{ mapStyle: 'colorblind' }]);
    expect(sessionStorage.getItem('sx-map-style')).toBeNull();
    expect(store.get().mapStyle).toBe('colorblind');
    expect(picker.open).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('allen Geräten'));
  });

  it('[F-219] Vorschau ändert nur die Anzeige; Abbrechen stellt den geltenden Stil wieder her; Abmelden vergisst das Profil', async () => {
    server('subtle');
    const { store, c } = setup();
    store.set({ user: USER });
    await flush();
    await flush();
    c.preview('colorblind');
    expect(store.get().mapStyle).toBe('colorblind');
    c.cancel();
    expect(store.get().mapStyle).toBe('subtle');
    store.set({ user: null });
    await flush();
    expect(store.get().mapStyle).toBe('classic');
  });

  it('[F-219] Fehler beim Speichern bleibt im Popover sichtbar, nichts ändert sich', async () => {
    server(null);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x', message: 'Kaputt' }), { status: 500, headers: { 'Content-Type': 'application/json' } })));
    const { store, picker, c } = setup();
    store.set({ user: USER });
    await flush();
    picker.open = true;
    await c.choose('contrast', 'profile');
    expect(picker.error).toBeTruthy();
    expect(picker.open).toBe(true);
    expect(store.get().mapStyle).toBe('classic');
  });
});
