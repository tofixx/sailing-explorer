// @vitest-environment happy-dom
// GPX nachreichen (Konzept 38, F-602, F-605, F-607): Menüeintrag, Dateiauswahl aus dem Klick und Ablauf im
// WorkspaceController mit echtem Store, Parser und API-Client; ersetzt werden Karte, IndexedDB, Netzwerk, BroadcastChannel.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T0, genPoints, gpxDoc, meteoResponse } from './helpers';
import '../../src/components/sx-confirm';
import '../../src/components/sx-voyage-byline';
import { voyageMenuItems } from '../../src/components/sx-voyage-byline';
import type { ShareMeta } from '../../src/services/api';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

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
      heat = { set: v.fn(), fitHotspot: v.fn(() => false) };
    },
  };
});
vi.mock('../../src/services/workspace', () => ({ workspace: { load: async () => null, save: async () => {} } }));
vi.mock('../../src/services/share-image', async (orig) => ({
  ...(await orig<typeof import('../../src/services/share-image')>()),
  renderShareImage: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
}));

const { App } = await import('../../src/app');

const ID = 'Eintr00000000001';
const DAY = 86_400_000;
const leg = (start = T0) => gpxDoc(genPoints({ start, n: 31, dt: 60 }), 'Nachgereicht');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** eigener Fahrtenbuch-Eintrag ohne GPX vom 13.06.2026 */
const manualMeta = () => ({
  id: ID, title: 'Havel-Schlag', summary: '3,0 sm · 13.06.2026 · Fahrtenbuch', view: '', visibility: 'public', isOwner: true, link: `/s/${ID}`,
  source: 'manual', distSource: 'stated', distNm: 3, startedAt: T0 - 2 * 3_600_000, endedAt: null, trackCount: 0, commentsMode: 'on',
});
let attached: { headers: Record<string, string>; body: Uint8Array<ArrayBuffer> } | null;
let images: number;
/** Raster für die Revier-Wärmekarte (Konzept 37) */
let heats: Array<{ cells: number[] }>;

async function router(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  if (url.includes('open-meteo.com')) return json(meteoResponse(url, { wind: 10, gust: 14, dir: 250, wave: 0.4, wdir: 240, wper: 4 }));
  if (url === '/api/config') return json({ turnstileSiteKey: '', sharing: true, support: null, freeShares: 3 });
  if (url === '/api/auth/me') return json({ user: { id: 'U1', email: 'a@example.org' } });
  if (url === `/api/shares/${ID}/track` && method === 'PUT') {
    attached = { headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: init.body as Uint8Array<ArrayBuffer> };
    return json({ share: { ...manualMeta(), source: 'gpx', distSource: 'track' } });
  }
  if (url === '/api/discover/heat') return json({ cells: [], voyages: [] });
  if (url === `/api/shares/${ID}/heat` && method === 'PUT') {
    heats.push(JSON.parse(String(init.body)) as { cells: number[] });
    return new Response(null, { status: 204 });
  }
  if (url === `/api/shares/${ID}/image` && method === 'PUT') {
    images++;
    return new Response(null, { status: 204 });
  }
  if (url === `/api/shares/${ID}`) return json({ share: attached ? { ...manualMeta(), source: 'gpx', distSource: 'track', trackCount: 1 } : manualMeta() });
  if (url === `/api/shares/${ID}/data`) {
    return json(attached ? { v: 1, tracks: [{ name: 'Nachgereicht', gpx: leg() }] } : { v: 1, tracks: [], route: [[52.4, 13.06], [52.38, 12.94]] });
  }
  return json({ error: 'not_found' }, 404);
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
  attached = null;
  images = 0;
  heats = [];
  vi.stubGlobal('fetch', vi.fn(router));
  vi.stubGlobal('BroadcastChannel', class {
    addEventListener() {}
    postMessage() {}
  });
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

const state = () => (app as unknown as { store: { get(): import('../../src/services/store').State } }).store.get();
const settled = () => vi.waitFor(() => expect(state().loading).toBeNull(), { timeout: 5000 });
const emit = (name: string, detail?: unknown) => document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
const toasts = () => toast.mock.calls.map((c) => String(c[0]));
async function answer(ok: boolean) {
  const d = document.querySelector('sx-confirm') as unknown as HTMLElement & { open: boolean; text: string; updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
  await vi.waitFor(() => expect(d.open).toBe(true));
  await d.updateComplete;
  const text = d.text;
  (d.shadowRoot.querySelector(ok ? '.btn.primary' : '[data-cancel]') as HTMLButtonElement).click();
  return text;
}
async function openEntry() {
  history.replaceState(null, '', `/s/${ID}`);
  app = new App();
  await app.start();
  await settled();
  await vi.waitFor(() => expect(state().mode.kind).toBe('share'));
}

describe('F-605 Einstieg „GPX nachreichen“', () => {
  const share = (over: Record<string, unknown> = {}) => ({ id: 'S1', title: 'Havel', isOwner: true, commentsMode: 'on', source: 'manual', ...over }) as unknown as ShareMeta;
  it('[F-605] nur für die Eigentümer:in eines Eintrags ohne GPX, als erster Menüeintrag', () => {
    expect(voyageMenuItems(share(), null)[0]).toMatchObject({ id: 'track-attach', label: 'GPX nachreichen', icon: 'upload' });
    expect(voyageMenuItems(share({ source: 'gpx' }), null).map((i) => i.id)).not.toContain('track-attach');
    expect(voyageMenuItems(share({ isOwner: false }), null).map((i) => i.id)).not.toContain('track-attach');
    // F-604: läge der Löschtermin nach Törn-Regel in der 14-Tage-Warnfrist, gibt es den Eintrag nicht
    expect(voyageMenuItems(share({ trackExpiresAt: Date.now() + 3 * DAY }), null).map((i) => i.id)).not.toContain('track-attach');
    expect(voyageMenuItems(share({ trackExpiresAt: Date.now() + 90 * DAY }), null)[0].id).toBe('track-attach');
  });

  it('[F-605] die Byline öffnet die Dateiauswahl direkt aus dem Klick und meldet die Datei als sx-track-attach', async () => {
    const byline = document.createElement('sx-voyage-byline') as HTMLElement & { share: ShareMeta; updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    byline.share = share();
    document.body.append(byline);
    await byline.updateComplete;
    const input = byline.shadowRoot.querySelector('input[type=file]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const click = vi.spyOn(input, 'click');
    const menu = byline.shadowRoot.querySelector('sx-page-menu')!;
    menu.dispatchEvent(new CustomEvent('sx-page-menu-pick', { detail: { id: 'track-attach' } }));
    expect(click).toHaveBeenCalledOnce();
    const got: unknown[] = [];
    const fn = (e: Event) => got.push((e as CustomEvent).detail);
    document.addEventListener('sx-track-attach', fn);
    const f = new File([leg()], 'track.gpx');
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    input.dispatchEvent(new Event('change'));
    document.removeEventListener('sx-track-attach', fn);
    expect(got).toEqual([{ file: f }]);
    // fremde Törns und GPX-Törns haben keine Dateiauswahl
    byline.share = share({ source: 'gpx' });
    await byline.updateComplete;
    expect(byline.shadowRoot.querySelector('input[type=file]')).toBeNull();
  });
});

describe('F-607 Ablauf im Browser', () => {
  it('[F-607] prüfen, nachfragen, mit Wetter hochladen, Törn neu öffnen und Übersichtsbild nachziehen', async () => {
    await openEntry();
    emit('sx-track-attach', { file: new File([leg()], 'nachgereicht.gpx') });
    const text = await answer(true);
    expect(text).toContain('Havel-Schlag');
    expect(text).toContain('eine Saison früher');
    await vi.waitFor(() => expect(toasts()).toContain('Track nachgereicht'));
    expect(attached!.headers['x-share-tracks']).toBe('1');
    expect(Number(attached!.headers['x-share-started'])).toBe(T0);
    expect(Number(attached!.headers['x-share-distance'])).toBeGreaterThan(0);
    // Payload mit Wetter (einmal geladen und mitgespeichert)
    const raw = await new Response(new Blob([attached!.body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const payload = JSON.parse(raw) as { tracks: unknown[]; weather?: unknown };
    expect(payload.tracks).toHaveLength(1);
    expect(payload.weather).toBeTruthy();
    const mode = state().mode;
    expect(mode.kind === 'share' && mode.share.source).toBe('gpx');
    expect(state().tracks.some((t) => t.estimated)).toBe(false);
    await vi.waitFor(() => expect(images).toBe(1));
    // Raster für die Revier-Wärmekarte (F-581) – einmal, aus dem nachgereichten Track
    await vi.waitFor(() => expect(heats).toHaveLength(1));
    expect(heats[0].cells.length).toBeGreaterThan(0);
  });

  it('[F-602] Track von einem anderen Tag: Hinweis vor dem Hochladen, keine Rückfrage, nichts gesendet', async () => {
    await openEntry();
    emit('sx-track-attach', { file: new File([leg(T0 + 5 * DAY)], 'falsch.gpx') });
    await vi.waitFor(() => expect(toasts().some((t) => t.includes('ändere zuerst das Datum'))).toBe(true));
    expect(attached).toBeNull();
    expect((document.querySelector('sx-confirm') as unknown as { open: boolean }).open).toBe(false);
  });

  it('[F-607] Abbrechen in der Rückfrage sendet nichts', async () => {
    await openEntry();
    emit('sx-track-attach', { file: new File([leg()], 'nachgereicht.gpx') });
    await answer(false);
    await settled();
    expect(attached).toBeNull();
    expect(images).toBe(0);
    expect(heats).toHaveLength(0);
  });
});
