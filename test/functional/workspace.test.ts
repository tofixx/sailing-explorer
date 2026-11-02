// @vitest-environment happy-dom
// Törn-Arbeitsbereich (Konzept 22, F-432 … F-438): genau ein Törn – Entwurf, eigener gespeicherter oder fremde Ansicht.
// Wie app.test.ts mit echtem Store, Parser und API-Client; ersetzt werden nur Karte, IndexedDB, Netzwerk und
// BroadcastChannel. Die Komponenten-Tests am Ende registrieren die Lit-Komponenten.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T0, genPoints, gpxDoc, makeTrack, meteoResponse, P } from './helpers';
import '../../src/components/sx-compose';
import '../../src/components/sx-confirm';
import '../../src/components/sx-track-list';

type WsTrack = { id: string; name: string; gpx: string; hidden: boolean };
const h = vi.hoisted(() => ({ ws: { data: null as null | { tracks: WsTrack[]; weather?: unknown; savedAt: number } } }));

vi.mock('../../src/map/map-view', async () => {
  const { vi: v } = await import('vitest');
  return {
    MapView: class {
      render = v.fn();
      fit = v.fn();
      setLayers = v.fn();
      showHover = v.fn();
      trackOf = v.fn(() => null);
      focus = v.fn();
      showPlace = v.fn();
      photos = { set: v.fn(), highlight: v.fn(), focus: v.fn(), startPlacing: v.fn(), stopPlacing: v.fn(), callbacks: {} };
    },
  };
});

vi.mock('../../src/services/workspace', () => ({
  workspace: {
    load: async () => h.ws.data,
    save: async (tracks: WsTrack[], weather: unknown = null) => {
      h.ws.data = tracks.length ? { tracks: structuredClone(tracks), weather: structuredClone(weather), savedAt: Date.now() } : null;
    },
  },
}));

const { App } = await import('../../src/app');
const { toernLabel, resumableDraft } = await import('../../src/controllers/workspace');

class FakeChannel {
  addEventListener() {}
  postMessage() {}
  close() {}
}

const leg = (name: string, start = T0) => gpxDoc(genPoints({ start, n: 31, dt: 60 }), name);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** fremder Törn „Ostsee“ (öffentlich) und eigener „Havel“ */
const SHARES: Record<string, { meta: Record<string, unknown>; tracks: Array<{ name: string; gpx: string }> }> = {
  Fremd00000000001: { meta: { id: 'Fremd00000000001', title: 'Ostsee', summary: '', view: '', visibility: 'public', isOwner: false }, tracks: [{ name: 'Ostsee', gpx: leg('Ostsee', T0 + 3 * 86_400_000) }] },
  Eigen00000000001: { meta: { id: 'Eigen00000000001', title: 'Havel', summary: '', view: '', visibility: 'unlisted', isOwner: true, link: '/s/Eigen00000000001/Key0001abcdefghijkmnpq' }, tracks: [{ name: 'Havel', gpx: leg('Havel') }] },
};

let user: { id: string; email: string } | null;
async function router(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  if (url.includes('open-meteo.com')) return json(meteoResponse(url, { wind: 10, gust: 14, dir: 250, wave: 0.4, wdir: 240, wper: 4 }));
  if (url === '/api/config') return json({ turnstileSiteKey: '', sharing: true, support: null, freeShares: 3 });
  if (url === '/api/auth/me') return json({ user });
  if (url === '/api/auth/logout' && method === 'POST') {
    user = null;
    return json({ ok: true });
  }
  if (url === '/api/shares' && method === 'POST') {
    const meta = { id: 'Neu0000000000001', title: 'Gespeichert', summary: '', view: '', visibility: 'public', isOwner: true, link: '/s/Neu0000000000001' };
    return json({ share: meta }, 201);
  }
  const m = /^\/api\/shares\/([^/]+)(\/data)?$/.exec(url);
  if (m && SHARES[m[1]]) return m[2] ? json({ v: 1, tracks: SHARES[m[1]].tracks }) : json({ share: SHARES[m[1]].meta });
  return new Response('not found', { status: 404 });
}

const BODY = readFileSync(resolve('index.html'), 'utf8')
  .replace(/^[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

let app: InstanceType<typeof App>;
let toast: ReturnType<typeof vi.fn>;
let listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const origAdd = document.addEventListener.bind(document);

beforeEach(() => {
  h.ws.data = null;
  user = null;
  vi.stubGlobal('fetch', vi.fn(router));
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  document.body.innerHTML = BODY;
  toast = vi.fn();
  (document.querySelector('sx-toast') as unknown as { show: unknown }).show = toast;
  listeners = [];
  document.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    listeners.push([type, fn]);
    origAdd(type, fn, opts);
  }) as typeof document.addEventListener;
});

afterEach(() => {
  for (const [t, fn] of listeners) document.removeEventListener(t, fn);
  document.addEventListener = origAdd as typeof document.addEventListener;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function startApp(path = '/') {
  history.replaceState(null, '', path);
  app = new App();
  await app.start();
  await settled();
}
const state = () => (app as unknown as { store: { get(): import('../../src/services/store').State } }).store.get();
const el = <T = Record<string, unknown>>(sel: string) => document.querySelector(sel) as unknown as T;
const emit = (name: string, detail?: unknown) => document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
const toasts = () => toast.mock.calls.map((c) => String(c[0]));
const file = (name: string, text: string) => new File([text], name);
const settled = () => vi.waitFor(() => expect(state().loading).toBeNull(), { timeout: 5000 });
const names = () => state().tracks.map((t) => t.name);
const confirmDlg = () => el<{ open: boolean; text: string }>('sx-confirm');
const topbar = () => el<{ toern: { title: string; status: string } | null; draft: string | null }>('sx-topbar');
/** Entwurf aus einem früheren Besuch im Browser */
const storeDraft = (...n: string[]) => (h.ws.data = { tracks: n.map((name, i) => ({ id: `d${i}`, name, gpx: leg(name, T0 + i * 86_400_000), hidden: false })), savedAt: 1 });
const drop = (f: File) => {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [f], types: ['Files'] } });
  document.dispatchEvent(ev);
};

describe('Törn-Arbeitsbereich (Konzept 22)', () => {
  it('[F-433] Kopfzeile: Titel und Zustand des offenen Törns; × schließt ihn, ein Entwurf bleibt im Browser', async () => {
    await startApp();
    emit('sx-files', [file('a.gpx', leg('Havelrunde'))]);
    await vi.waitFor(() => expect(names()).toEqual(['Havelrunde']));
    await settled();
    expect(topbar().toern).toMatchObject({ title: 'Havelrunde', status: 'Entwurf · nur dieses Gerät' });

    emit('sx-toern-close');
    expect(state().tracks).toEqual([]);
    expect(state().home).toBe(true);
    expect(location.pathname).toBe('/');
    expect(topbar().toern).toBeNull();
    // Entwurf bleibt erhalten und lässt sich über „+ Neu“ fortsetzen
    expect(h.ws.data?.tracks.map((t) => t.name)).toEqual(['Havelrunde']);
    expect(topbar().draft).toBe('Havelrunde');
  });

  it('[F-433] Zustand je Art: eigener gespeicherter Törn mit Sichtbarkeit, fremder Törn und Link als „Ansicht“', () => {
    const share = (isOwner: boolean, visibility: 'public' | 'unlisted' | 'private') => ({ kind: 'share' as const, share: { title: 'Havel', visibility, isOwner } as never });
    expect(toernLabel({ mode: share(true, 'private'), tracks: [] })).toMatchObject({ title: 'Havel', status: 'Gespeichert · Nur ich', tone: 'saved' });
    expect(toernLabel({ mode: share(true, 'unlisted'), tracks: [] })?.status).toBe('Gespeichert · Nur mit Link');
    expect(toernLabel({ mode: share(false, 'public'), tracks: [] })).toMatchObject({ status: 'Ansicht', tone: 'view' });
    expect(toernLabel({ mode: { kind: 'link', title: 'Beispiel' }, tracks: [] })).toMatchObject({ title: 'Beispiel', status: 'Ansicht' });
    expect(toernLabel({ mode: { kind: 'local' }, tracks: [] })).toBeNull();
    const t = makeTrack([P(52.4, 13, 0), P(52.41, 13, 60_000)], { name: '' });
    expect(toernLabel({ mode: { kind: 'local' }, tracks: [t] })?.title).toBe('Neuer Törn');
  });

  it('[F-434] „+ Neu → Törn (GPX)“ aus einem fremden Törn beginnt einen neuen Törn und mischt nicht', async () => {
    await startApp('/s/Fremd00000000001');
    expect(names()).toEqual(['Ostsee']);
    emit('sx-files', [file('b.gpx', leg('Wannsee'))]);
    await vi.waitFor(() => expect(names()).toEqual(['Wannsee']));
    expect(state().mode.kind).toBe('local');
    expect(location.pathname).toBe('/');
    expect(confirmDlg().open).toBe(false);
  });

  it('[F-434] liegt ein Entwurf vor, fragt der Dialog: „Abbrechen“ lässt ihn stehen, „Verwerfen“ beginnt neu', async () => {
    storeDraft('Entwurf A', 'Entwurf B');
    await startApp();
    expect(names()).toEqual(['Entwurf A', 'Entwurf B']);
    expect(toasts()).toContain('Entwurf wiederhergestellt: 2 Tracks');

    emit('sx-files', [file('c.gpx', leg('Neu'))]);
    await vi.waitFor(() => expect(confirmDlg().open).toBe(true));
    expect(confirmDlg().text).toBe('Entwurf „Entwurf A“ verwerfen und neuen Törn beginnen?');
    emit('sx-confirm-cancel');
    expect(confirmDlg().open).toBe(false);
    expect(names()).toEqual(['Entwurf A', 'Entwurf B']);
    expect(state().loading).toBeNull();

    emit('sx-files', [file('c.gpx', leg('Neu'))]);
    await vi.waitFor(() => expect(confirmDlg().open).toBe(true));
    emit('sx-confirm-ok');
    await vi.waitFor(() => expect(names()).toEqual(['Neu']));
    await settled();
    expect(h.ws.data?.tracks.map((t) => t.name)).toEqual(['Neu']);
  });

  it('[F-435] „GPX hinzufügen“ hängt an den offenen Entwurf an (eigene Farbe), Ablegen auf ihm ebenso', async () => {
    await startApp();
    emit('sx-files', [file('a.gpx', leg('A'))]);
    await vi.waitFor(() => expect(names()).toEqual(['A']));
    expect(el<{ addable: boolean; readonly: boolean }>('sx-track-list')).toMatchObject({ addable: true, readonly: false });
    emit('sx-files-add', [file('b.gpx', leg('B', T0 + 86_400_000))]);
    await vi.waitFor(() => expect(names()).toEqual(['A', 'B']));
    expect(new Set(state().tracks.map((t) => t.color)).size).toBe(2);
    drop(file('c.gpx', leg('C', T0 + 2 * 86_400_000)));
    await vi.waitFor(() => expect(names()).toEqual(['A', 'B', 'C']));
    expect(confirmDlg().open).toBe(false);
    await settled();
    expect(h.ws.data?.tracks).toHaveLength(3);
  });

  it('[F-435] in gespeicherten und fremden Törns gibt es kein „GPX hinzufügen“; Ablegen dort beginnt einen neuen Törn', async () => {
    await startApp('/s/Eigen00000000001/Key0001abcdefghijkmnpq');
    expect(el<{ addable: boolean; readonly: boolean }>('sx-track-list')).toMatchObject({ addable: false, readonly: true });
    drop(file('c.gpx', leg('Neu')));
    await vi.waitFor(() => expect(names()).toEqual(['Neu']));
    expect(state().mode.kind).toBe('local');
  });

  it('[F-436] Wechsel in einen fremden Törn mischt nicht; der Entwurf bleibt und lässt sich über „+ Neu“ fortsetzen', async () => {
    storeDraft('Mein Entwurf');
    await startApp('/s/Fremd00000000001');
    expect(names()).toEqual(['Ostsee']);
    expect(state().mode.kind).toBe('share');
    await vi.waitFor(() => expect(topbar().draft).toBe('Mein Entwurf'));
    expect(h.ws.data?.tracks.map((t) => t.name)).toEqual(['Mein Entwurf']);

    emit('sx-compose-open', { kind: 'draft' });
    await vi.waitFor(() => expect(names()).toEqual(['Mein Entwurf']));
    expect(state().mode.kind).toBe('local');
    expect(location.pathname).toBe('/');
    // offen: kein zweiter Einstieg „Entwurf fortsetzen“
    expect(topbar().draft).toBeNull();
  });

  it('[F-06] Beispiele sind eine Ansicht und überschreiben keinen Entwurf', async () => {
    storeDraft('Mein Entwurf');
    await startApp();
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(leg('Stralsund → Prerow')));
    emit('sx-sample', '20260613_Stralsund_Prerow');
    await vi.waitFor(() => expect(state().mode.kind).toBe('link'));
    await settled();
    expect(location.search).toBe('?track=20260613_Stralsund_Prerow');
    expect(confirmDlg().open).toBe(false);
    expect(h.ws.data?.tracks.map((t) => t.name)).toEqual(['Mein Entwurf']);
  });

  it('[F-437] Speichern macht den Entwurf zum eigenen Törn: Adresse /s/<id>, Entwurfsplatz leer', async () => {
    user = { id: 'u1', email: 'a@example.org' };
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    emit('sx-files', [file('a.gpx', leg('A'))]);
    await vi.waitFor(() => expect(names()).toEqual(['A']));
    await settled();
    emit('sx-share-submit', { title: 'Gespeichert', visibility: 'public', includeView: false, boatId: null });
    await vi.waitFor(() => expect(state().mode.kind).toBe('share'));
    expect(location.pathname).toBe('/s/Neu0000000000001');
    expect(h.ws.data).toBeNull();
    expect(topbar().toern).toMatchObject({ title: 'Gespeichert', status: 'Gespeichert · Öffentlich' });
    expect(topbar().draft).toBeNull();
  });

  it('[F-438] Abmelden leert Arbeitsbereich und Entwurf – auch einen Gast-Entwurf von vor der Anmeldung', async () => {
    storeDraft('Gast-Entwurf');
    user = { id: 'u1', email: 'a@example.org' };
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    expect(names()).toEqual(['Gast-Entwurf']);
    emit('sx-logout');
    await vi.waitFor(() => expect(state().user).toBeNull());
    expect(state().tracks).toEqual([]);
    expect(state().draft).toBeNull();
    expect(h.ws.data).toBeNull();
    expect(topbar().toern).toBeNull();
    expect(toasts()).toContain('Abgemeldet');
  });

  it('[F-438] Abmelden im gespeicherten Törn: kein „Entwurf“, Adresse wieder /', async () => {
    user = { id: 'u1', email: 'a@example.org' };
    await startApp('/s/Eigen00000000001/Key0001abcdefghijkmnpq');
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    expect(topbar().toern?.status).toBe('Gespeichert · Nur mit Link');
    emit('sx-logout');
    await vi.waitFor(() => expect(state().user).toBeNull());
    expect(state().tracks).toEqual([]);
    expect(state().mode.kind).toBe('local');
    expect(topbar().toern).toBeNull();
    expect(location.pathname).toBe('/');
  });
});

// ---------------------------------------------------------------- Komponenten

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;
async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const e = document.createElement(tag) as LitEl;
  Object.assign(e, props);
  document.body.append(e);
  await e.updateComplete;
  return e;
}
function caught(name: string) {
  const got: unknown[] = [];
  origAdd(name, (e) => got.push((e as CustomEvent).detail));
  return got;
}

describe('Komponenten des Arbeitsbereichs', () => {
  it('[F-436] „+ Neu“ zeigt „Entwurf fortsetzen: „…““ nur mit Entwurf und meldet die Art „draft“', async () => {
    const opens = caught('sx-compose-open');
    const plain = await mount('sx-compose', { open: true });
    expect(plain.shadowRoot.textContent).not.toContain('Entwurf fortsetzen');
    const c = await mount('sx-compose', { open: true, draft: 'Havel' });
    const item = [...c.shadowRoot.querySelectorAll('button.item')].find((b) => /Entwurf fortsetzen/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(item.textContent).toContain('„Havel“');
    item.click();
    expect(opens.at(-1)).toEqual({ kind: 'draft' });
    expect(resumableDraft({ mode: { kind: 'local' }, tracks: [makeTrack([P(1, 1, 0)])], draft: { title: 'X', count: 1 } })).toBeNull();
  });

  it('[F-434] Nachfrage-Dialog: „Verwerfen“ und „Abbrechen“ (auch Escape) melden ihre Antwort', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    const oks = caught('sx-confirm-ok');
    const cancels = caught('sx-confirm-cancel');
    const d = await mount('sx-confirm', { open: true, heading: 'Neuen Törn beginnen?', text: 'Entwurf „A“ verwerfen und neuen Törn beginnen?', confirmLabel: 'Verwerfen' });
    const btn = (re: RegExp) => [...d.shadowRoot.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!;
    btn(/Verwerfen/).click();
    btn(/^Abbrechen$/).click();
    d.shadowRoot.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(oks).toHaveLength(1);
    expect(cancels).toHaveLength(2);
  });

  it('[F-432] Track-Liste: je GPX eine Zeile mit Farbmarke, Datum, Distanz und Dauer; Tippen hebt hervor, „GPX hinzufügen“ nur im Entwurf', async () => {
    const focus = caught('sx-track-focus');
    const a = makeTrack(genPoints({ n: 31 }).map((p) => P(p.lat, p.lon, p.time)), { id: 'a', name: 'A', color: '--c-track-1' });
    const b = makeTrack(genPoints({ start: T0 + 86_400_000, n: 31 }).map((p) => P(p.lat, p.lon, p.time)), { id: 'b', name: 'B', color: '--c-track-2' });
    const list = await mount('sx-track-list', { tracks: [a, b], addable: true });
    const rows = [...list.shadowRoot.querySelectorAll('li')];
    expect(rows.map((r) => (r.querySelector('.sw') as HTMLElement).getAttribute('style'))).toEqual(['background:var(--c-track-1)', 'background:var(--c-track-2)']);
    const sub = rows[0].querySelectorAll('.sub');
    expect(sub[0].textContent).toMatch(/→/);
    expect(sub[1].textContent).toMatch(/sm · .* h/);
    (rows[1].querySelector('.meta') as HTMLElement).click();
    expect(focus.at(-1)).toBe('b');
    expect(list.shadowRoot.querySelector('button.add')?.textContent).toContain('GPX hinzufügen');
    const view = await mount('sx-track-list', { tracks: [a, b], readonly: true });
    expect(view.shadowRoot.querySelector('button.add')).toBeNull();
  });
});
