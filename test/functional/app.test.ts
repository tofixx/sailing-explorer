// @vitest-environment happy-dom
// Funktionale Tests der App-Verdrahtung (src/app.ts) mit echtem Store, Parser, Wetter-Logik und API-Client.
// Ersetzt werden nur: Leaflet-Karte (MapView), IndexedDB (workspace), Netzwerk (fetch) und BroadcastChannel.
// Die Lit-Komponenten werden nicht registriert – die App setzt nur Properties, die hier geprüft werden.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../src/domain/types';
import { T0, genPoints, gpxDoc, meteoResponse, type MeteoValues } from './helpers';

const h = vi.hoisted(() => ({
  maps: [] as Array<{ render: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn>; setLayers: ReturnType<typeof vi.fn>; showHover: ReturnType<typeof vi.fn> }>,
  ws: { data: null as null | { tracks: Array<{ id: string; name: string; gpx: string; hidden: boolean }>; savedAt: number } },
}));

vi.mock('../../src/map/map-view', async () => {
  const { vi: v } = await import('vitest');
  return {
    MapView: class {
      render = v.fn();
      fit = v.fn();
      setLayers = v.fn();
      showHover = v.fn();
      constructor() {
        h.maps.push(this);
      }
    },
  };
});

vi.mock('../../src/services/workspace', () => ({
  workspace: {
    load: async () => h.ws.data,
    save: async (tracks: Array<{ id: string; name: string; gpx: string; hidden: boolean }>) => {
      h.ws.data = tracks.length ? { tracks: structuredClone(tracks), savedAt: Date.now() } : null;
    },
  },
}));

const { App } = await import('../../src/app');

// ---------------------------------------------------------------- Umgebung

class FakeChannel {
  static all: FakeChannel[] = [];
  private listeners: Array<(e: { data: unknown }) => void> = [];
  posted: unknown[] = [];
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  addEventListener(_t: string, fn: (e: { data: unknown }) => void) {
    this.listeners.push(fn);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
  }
  /** Nachricht aus einem anderen Tab simulieren */
  receive(data: unknown) {
    for (const l of this.listeners) l({ data });
  }
  close() {}
}

interface Server {
  backend: 'json' | 'html';
  user: { id: string; email: string } | null;
  weather: MeteoValues | 'fail';
  shares: Map<string, { meta: Record<string, unknown>; payload: unknown }>;
  files: Record<string, string>;
  calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }>;
}

let server: Server;
let app: InstanceType<typeof App>;
let toast: ReturnType<typeof vi.fn>;
let clipboard: string[];
let listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const origAdd = document.addEventListener.bind(document);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function router(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  const hd = init.headers as Headers | Record<string, string> | Array<[string, string]> | undefined;
  if (hd && typeof (hd as Headers).forEach === 'function' && !Array.isArray(hd)) (hd as Headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
  else for (const [k, v] of Array.isArray(hd) ? hd : Object.entries(hd ?? {})) headers[k.toLowerCase()] = v;
  server.calls.push({ url, method, headers, body: init.body });

  if (url.includes('open-meteo.com')) {
    if (server.weather === 'fail') throw new TypeError('Failed to fetch');
    return json(meteoResponse(url, server.weather));
  }
  if (url.startsWith('/tracks/')) {
    const f = server.files[url];
    return f ? new Response(f, { headers: { 'Content-Type': 'application/gpx+xml' } }) : new Response('nope', { status: 404 });
  }
  if (url.startsWith('/api/') && server.backend === 'html') return new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } });
  if (url === '/api/config') return json({ turnstileSiteKey: '', sharing: true });
  if (url === '/api/auth/me') return json({ user: server.user });
  if (url === '/api/auth/request' && method === 'POST') return json({ ok: true, devLink: 'http://localhost:3000/login#token=' + 'a'.repeat(43) });
  if (url === '/api/auth/peek' && method === 'POST') return json({ email: 'skipper@example.org' });
  if (url === '/api/boats' && method === 'GET') return json({ boats: [] });
  if (url === '/api/me/profile' && method === 'GET') return json({ profile: null, exists: false });
  if (url === '/api/auth/verify' && method === 'POST') {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    return json({ user: server.user });
  }
  if (url === '/api/auth/logout' && method === 'POST') {
    server.user = null;
    return json({ ok: true });
  }
  if (url === '/api/account' && method === 'DELETE') {
    server.user = null;
    server.shares.clear();
    return json({ ok: true });
  }
  if (url === '/api/shares' && method === 'GET') return json({ shares: [...server.shares.values()].map((s) => s.meta) });
  if (url === '/api/shares' && method === 'POST') {
    if (!server.user) return json({ error: 'unauthenticated', message: 'Bitte zuerst anmelden.' }, 401);
    const id = 'NewShareId23456789';
    const meta = { id, title: decodeURIComponent(headers['x-share-title']), summary: decodeURIComponent(headers['x-share-summary']), visibility: headers['x-share-visibility'], view: decodeURIComponent(headers['x-share-view']), isOwner: true };
    server.shares.set(id, { meta, payload: JSON.parse(gunzipSync(init.body as Uint8Array).toString('utf8')) });
    return json({ share: meta }, 201);
  }
  const m = /^\/api\/shares\/([^/]+)(\/data)?$/.exec(url);
  if (m) {
    const s = server.shares.get(decodeURIComponent(m[1]));
    if (method === 'DELETE') {
      server.shares.delete(m[1]);
      return new Response(null, { status: 204 });
    }
    if (method === 'PATCH') {
      Object.assign(s!.meta, JSON.parse(String(init.body)));
      return json({ share: s!.meta });
    }
    if (!s || (s.meta.visibility === 'private' && !server.user)) return json({ error: 'not_found', message: 'Diese Freigabe gibt es nicht (mehr).' }, 404);
    // der Browser entpackt Content-Encoding: gzip selbst
    return m[2] ? new Response(JSON.stringify(s.payload), { headers: { 'Content-Type': 'application/json' } }) : json({ share: s.meta });
  }
  return new Response('not found', { status: 404 });
}

const BODY = readFileSync(resolve('index.html'), 'utf8')
  .replace(/^[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

beforeEach(() => {
  h.maps.length = 0;
  h.ws.data = null;
  FakeChannel.all = [];
  server = { backend: 'json', user: null, weather: { wind: 12, gust: 18, dir: 250, wave: 0.6, wdir: 240, wper: 4 }, shares: new Map(), files: {}, calls: [] };
  vi.stubGlobal('fetch', vi.fn(router));
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  clipboard = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void clipboard.push(t) } });
  history.replaceState(null, '', '/');
  document.body.innerHTML = BODY;
  toast = vi.fn();
  (document.querySelector('sx-toast') as unknown as { show: unknown }).show = toast;
  // Listener der App mitschneiden, damit Instanzen aus anderen Tests nicht mitreagieren
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
});

// ---------------------------------------------------------------- Helfer

async function startApp(path = '/') {
  history.replaceState(null, '', path);
  app = new App();
  await app.start();
  return app;
}

const state = () => (app as unknown as { store: { get(): import('../../src/services/store').State } }).store.get();
const el = <T = Record<string, unknown>>(sel: string) => document.querySelector(sel) as unknown as T;
const emit = (name: string, detail?: unknown) => document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
const toasts = () => toast.mock.calls.map((c) => String(c[0]));
const file = (name: string, text: string, type = '') => new File([text], name, { type });
const settled = () => vi.waitFor(() => expect(state().loading).toBeNull(), { timeout: 5000 });

const leg = (name: string, start = T0, withTime = true) => gpxDoc(genPoints({ start, n: 61, dt: 60, withTime }), name);

async function load(...files: File[]) {
  emit('sx-files', files);
  await vi.waitFor(() => expect(state().tracks.length).toBeGreaterThan(0));
  await settled();
}

// ---------------------------------------------------------------- Tests

describe('F-01/F-02 Dateien laden', () => {
  it('[F-01] mehrere GPX-Dateien per Dateiauswahl laden', async () => {
    await startApp();
    await load(file('Etappe1.gpx', leg('Stralsund → Prerow')), file('Etappe2.gpx', leg('Prerow → Rostock', T0 + 86_400_000)));
    expect(state().tracks.map((t) => t.name)).toEqual(['Stralsund → Prerow', 'Prerow → Rostock']);
    expect(el<{ tracks: Track[] }>('sx-track-list').tracks).toHaveLength(2);
    expect(toasts()).toContain('2 Tracks geladen');
    expect(h.maps[0].fit).toHaveBeenCalled();
    expect(el<HTMLElement>('.app').hasAttribute('data-empty')).toBe(false);
  });

  it('[F-01] Drag & Drop auf die Seite lädt die Dateien', async () => {
    await startApp();
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file('drop.gpx', leg('Gedroppt'))], types: ['Files'] } });
    document.dispatchEvent(ev);
    await vi.waitFor(() => expect(state().tracks.map((t) => t.name)).toEqual(['Gedroppt']));
  });

  it('[F-01] Routen- und Wegpunkt-Dateien werden ebenfalls geladen', async () => {
    await startApp();
    await load(file('r.gpx', gpxDoc(genPoints({ n: 5 }), 'Route', 'rte')), file('w.gpx', gpxDoc(genPoints({ n: 5 }), 'Wegpunkte', 'wpt')));
    expect(state().tracks.map((t) => t.name)).toEqual(['Route', 'Wegpunkte']);
  });

  it('[F-02] ungültige Dateien werden mit Meldung abgelehnt, gültige im selben Vorgang trotzdem geladen', async () => {
    await startApp();
    await load(
      file('kaputt.gpx', '<gpx><trk>'),
      file('gut.gpx', leg('Gut')),
      file('doctype.gpx', '<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x "y">]><gpx/>'),
      file('einpunkt.gpx', gpxDoc(genPoints({ n: 1 }))),
      file('seite.gpx', '<html><body/></html>'),
    );
    expect(state().tracks.map((t) => t.name)).toEqual(['Gut']);
    const t = toasts();
    expect(t).toContain('kaputt: Ungültige GPX/XML-Datei');
    expect(t.some((m) => m.startsWith('doctype: ') && /DOCTYPE/.test(m))).toBe(true);
    expect(t).toContain('einpunkt: Zu wenige Trackpunkte');
    expect(t).toContain('seite: Keine GPX-Datei');
    expect(t).toContain('1 Track geladen');
  });

  it('[F-02] Nicht-GPX-Dateien (z. B. .txt) werden mit Hinweis ignoriert', async () => {
    await startApp();
    emit('sx-files', [file('notizen.txt', 'hallo', 'text/plain')]);
    await vi.waitFor(() => expect(toasts()).toContain('Keine GPX-Dateien gefunden'));
    expect(state().tracks).toHaveLength(0);
  });
});

describe('F-03/F-04/F-05 Auswertung in der App', () => {
  it('[F-03] Kennzahlen der Reise werden angezeigt (Distanz, Fahrzeit, Ø/Max-Speed)', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    const keys = el<{ items: Array<{ key: string; unit: string }> }>('sx-kpis').items.map((k) => `${k.key}:${k.unit}`);
    expect(keys).toEqual(expect.arrayContaining(['dist:sm', 'time:h', 'avgSpeed:kn', 'maxSpeed:kn']));
  });

  it('[F-04] Trackliste erhält die Zahl der Ausreißer je Track', async () => {
    await startApp();
    const pts = genPoints({ n: 121, dt: 10 });
    pts[60] = { ...pts[60], lon: pts[60].lon + 0.03 };
    await load(file('glitch.gpx', gpxDoc(pts, 'Glitch')));
    expect(el<{ tracks: Track[] }>('sx-track-list').tracks[0].stats.nGlitch).toBeGreaterThan(0);
  });

  it('[F-05] Track ohne Zeitstempel: Karte und Distanz ja, kein Wetterabruf, Hinweis im Status', async () => {
    await startApp();
    await load(file('ohnezeit.gpx', leg('Ohne Zeit', T0, false)));
    expect(server.calls.some((c) => c.url.includes('open-meteo'))).toBe(false);
    expect(state().status.level).toBe('warn');
    expect(el<{ status: { text: string } }>('sx-conditions').status.text).toMatch(/ohne Zeitstempel/);
    expect(h.maps[0].render).toHaveBeenCalled();
    expect(el<{ items: Array<{ key: string }> }>('sx-kpis').items.some((k) => k.key === 'dist')).toBe(true);
    expect(el<HTMLElement>('#charts-panel').hidden).toBe(true);
  });
});

describe('F-06 Beispiel-Tracks', () => {
  it('[F-06] Beispiel aus dem Startbildschirm öffnen lädt /tracks/<name>.gpx', async () => {
    server.files['/tracks/20260613_Stralsund_Prerow.gpx'] = leg('Stralsund Prerow');
    await startApp();
    expect(el<{ samples: Array<{ file: string }> }>('sx-empty-state').samples.map((s) => s.file)).toContain('20260613_Stralsund_Prerow');
    emit('sx-sample', '20260613_Stralsund_Prerow');
    await vi.waitFor(() => expect(state().tracks.map((t) => t.name)).toEqual(['Stralsund Prerow']));
    expect(server.calls.some((c) => c.url === '/tracks/20260613_Stralsund_Prerow.gpx')).toBe(true);
  });

  it('[F-06] ?track=<name> lädt aus /tracks/ als Link-Ansicht (nicht gespeichert)', async () => {
    server.files['/tracks/a.gpx'] = leg('A');
    server.files['/tracks/b.gpx'] = leg('B', T0 + 86_400_000);
    await startApp('/?track=a,b.gpx');
    await settled();
    expect(state().tracks.map((t) => t.name)).toEqual(['A', 'B']);
    expect(state().mode).toEqual({ kind: 'link', title: 'A, B' });
    expect(h.ws.data).toBeNull();
  });

  it('[F-06] ?track= mit Pfad oder fremdem Host lädt nichts von außerhalb /tracks/', async () => {
    await startApp('/?track=../secret,https://evil.example/x.gpx');
    const urls = server.calls.map((c) => c.url).filter((u) => !u.startsWith('/api/'));
    expect(urls).toEqual([]);
    expect(state().tracks).toHaveLength(0);
  });
});

describe('F-11/F-12/F-13/F-14/F-15 Darstellung', () => {
  it('[F-11] Metriken ohne Daten sind deaktiviert, mit Wetter verfügbar; Legende bekommt den Bereich', async () => {
    server.weather = 'fail';
    await startApp();
    await load(file('a.gpx', leg('A')));
    const picker = el<{ available: Record<string, boolean>; range: { lo: number; hi: number } | null; metric: string }>('sx-metric-picker');
    expect(picker.available).toEqual({ speed: true, wind: false, gust: false, wave: false });
    expect(picker.range!.lo).toBe(0);
  });

  it('[F-11] Einfärbung nach Wind: Karte und Legende erhalten Metrik und Bereich', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    const picker = el<{ available: Record<string, boolean>; range: { lo: number; hi: number } | null; metric: string }>('sx-metric-picker');
    expect(picker.available).toEqual({ speed: true, wind: true, gust: true, wave: true });
    emit('sx-metric', 'wind');
    expect(picker.metric).toBe('wind');
    const last = h.maps[0].render.mock.calls.at(-1)!;
    expect(last[1]).toBe('wind');
    expect(last[2]).toEqual(picker.range);
    expect(picker.range).toMatchObject({ lo: 12 });
  });

  it('[F-12] Ebenen-Schalter werden an die Karte weitergegeben', async () => {
    await startApp();
    const layers = { seamarks: false, depth: true, windArrows: false, waveArrows: true };
    emit('sx-layers', layers);
    expect(h.maps[0].setLayers).toHaveBeenLastCalledWith(layers);
    expect(el<{ layers: unknown }>('sx-metric-picker').layers).toEqual(layers);
  });

  it('[F-13] (Logik) Hover im Diagramm setzt denselben Zeitpunkt in Karte, Bedingungen und beiden Diagrammen', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    const target = T0 + 20 * 60_000 + 10_000;
    emit('sx-hover-time', target);
    const p = state().hover!.point;
    expect(p.time).toBe(T0 + 20 * 60_000);
    expect(el<{ hoverTime: number }>('#weather-chart').hoverTime).toBe(p.time);
    expect(el<{ hoverTime: number }>('#speed-chart').hoverTime).toBe(p.time);
    expect(el<{ conditions: unknown }>('sx-conditions').conditions).toBe(p.wx);
    expect(h.maps[0].showHover.mock.calls.at(-1)![0]).toBe(p);
  });

  it('[F-13] (Logik) Hover auf Max-Kennzahl hebt den Punkt auf der Karte hervor', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    const max = el<{ items: Array<{ key: string; point?: unknown }> }>('sx-kpis').items.find((k) => k.key === 'maxWind')!;
    emit('sx-kpi-hover', max.point);
    expect(h.maps[0].showHover.mock.calls.at(-1)).toEqual([max.point, { emphasize: true, pan: true }]);
  });

  it('[F-14] Speed-Diagramm zeigt den Median, Pausen zwischen Etappen bleiben getrennt', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')), file('b.gpx', leg('B', T0 + 20 * 3_600_000)));
    const chart = el<{ refLine: { label: string; value: number } | null; points: Array<{ time: number }> }>('#speed-chart');
    expect(chart.refLine!.label).toMatch(/^Median 6,0 kn$/);
    expect(chart.points).toHaveLength(122);
    expect(el<HTMLElement>('#charts-panel').hidden).toBe(false);
  });

  it('[F-15] ausblenden: Kennzahlen/Diagramme nur für sichtbare Tracks; entfernen: Track verschwindet', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')), file('b.gpx', leg('B', T0 + 86_400_000)));
    const dist = () => el<{ items: Array<{ key: string; value: string }> }>('sx-kpis').items.find((k) => k.key === 'dist')!.value;
    const both = dist();
    const [a, b] = state().tracks;
    emit('sx-track-toggle', b.id);
    expect(state().tracks.find((t) => t.id === b.id)!.hidden).toBe(true);
    expect(dist()).not.toBe(both);
    expect(el<{ points: unknown[] }>('#speed-chart').points).toHaveLength(61);
    expect(h.ws.data!.tracks.find((t) => t.name === 'B')!.hidden).toBe(true);
    emit('sx-track-toggle', b.id);
    expect(dist()).toBe(both);
    emit('sx-track-remove', a.id);
    expect(state().tracks.map((t) => t.name)).toEqual(['B']);
    expect(h.ws.data!.tracks.map((t) => t.name)).toEqual(['B']);
  });
});

describe('F-20/F-21 Wetter in der App', () => {
  it('[F-20] Wetter wird nach dem Laden zugeordnet und im Status gemeldet', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    expect(state().tracks[0].points.every((p) => p.wx?.wind === 12)).toBe(true);
    expect(state().status).toMatchObject({ level: 'ok' });
    expect(el<HTMLElement>('#weather-wrap').hidden).toBe(false);
  });

  it('[F-21] ohne Netz bleibt alles benutzbar, Status erklärt warum', async () => {
    server.weather = 'fail';
    await startApp();
    await load(file('a.gpx', leg('A')));
    expect(state().tracks).toHaveLength(1);
    expect(el<{ status: { level: string; text: string } }>('sx-conditions').status).toMatchObject({ level: 'err', text: expect.stringMatching(/nicht erreichbar/) });
    expect(el<HTMLElement>('#weather-wrap').hidden).toBe(true);
    expect(el<HTMLElement>('#charts-panel').hidden).toBe(false);
  });
});

describe('F-30 Gast-Sitzung', () => {
  it('[F-30] geladene Tracks werden lokal gespeichert und beim nächsten Besuch wiederhergestellt', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    expect(h.ws.data!.tracks.map((t) => t.name)).toEqual(['A']);
    expect(h.ws.data!.tracks[0].gpx).toContain('<gpx');
    // „nächster Besuch“: neue App-Instanz
    for (const [t, fn] of listeners) document.removeEventListener(t, fn);
    document.body.innerHTML = BODY;
    (document.querySelector('sx-toast') as unknown as { show: unknown }).show = toast;
    await startApp();
    await settled();
    expect(state().tracks.map((t) => t.name)).toEqual(['A']);
    expect(toasts()).toContain('Gast-Sitzung wiederhergestellt: 1 Track');
    expect(el<{ mode: { kind: string }; user: unknown; hasTracks: boolean }>('sx-topbar')).toMatchObject({ mode: { kind: 'local' }, user: null, hasTracks: true });
  });

  it('[F-30] ohne Teilen verlässt nichts das Gerät (keine GPX-Daten an Server)', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    emit('sx-track-toggle', state().tracks[0].id);
    const outbound = server.calls.filter((c) => c.body != null || c.url.startsWith('/api/shares'));
    expect(outbound).toEqual([]);
  });
});

describe('F-31/F-32 Anmeldung vor dem Teilen', () => {
  it('[F-31] nicht angemeldet → Teilen-Dialog bietet Bild ohne Anmeldung; Link erst nach Anmeldung (im anderen Tab), danach geht es direkt weiter', async () => {
    await startApp();
    await vi.waitFor(() => expect(state().backend).toBe(true));
    await load(file('a.gpx', leg('Mein Törn')));
    emit('sx-share');
    const login = el<{ open: boolean; reason: string }>('sx-login-dialog');
    const share = el<{ open: boolean; defaultTitle: string; tab: string; linkState: string }>('sx-share-dialog');
    expect(share.open).toBe(true);
    expect(share.tab).toBe('image');
    expect(share.linkState).toBe('login');
    expect(login.open).toBeFalsy();
    // „Anmelden & Link erstellen“
    emit('sx-login-for-share');
    expect(login.open).toBe(true);
    expect(login.reason).toMatch(/anmelden|meldest/i);
    expect(share.open).toBeFalsy();
    // Magic Link wurde in einem anderen Tab geöffnet → BroadcastChannel „login“
    server.user = { id: 'u1', email: 'skipper@example.org' };
    FakeChannel.all[0].receive('login');
    await vi.waitFor(() => expect(share.open).toBe(true));
    expect(login.open).toBe(false);
    expect(share.linkState).toBe('form');
    expect(share.tab).toBe('link');
    expect(share.defaultTitle).toBe('Mein Törn');
  });

  it('[F-32] E-Mail eingeben fordert einen Link an; Dialog zeigt „gesendet an“', async () => {
    await startApp();
    emit('sx-login-submit', { email: ' skipper@example.org ', turnstile: null });
    const login = el<{ sentTo: string; devLink: string }>('sx-login-dialog');
    await vi.waitFor(() => expect(login.sentTo).toBe('skipper@example.org'));
    const req = server.calls.find((c) => c.url === '/api/auth/request')!;
    expect(req.method).toBe('POST');
    expect(JSON.parse(String(req.body))).toMatchObject({ email: ' skipper@example.org ' });
  });

  it('[F-32] Klick auf den Link (/login#token=…) fragt „Als … anmelden?“, meldet an und informiert den ursprünglichen Tab', async () => {
    const token = 'b'.repeat(43);
    await startApp(`/login#token=${token}`);
    const login = el<{ open: boolean; confirmEmail: string }>('sx-login-dialog');
    await vi.waitFor(() => expect(login.confirmEmail).toBe('skipper@example.org'));
    expect(login.open).toBe(true);
    expect(state().user).toBeNull(); // erst nach Bestätigung
    expect(server.calls.some((c) => c.url === '/api/auth/verify')).toBe(false);
    emit('sx-login-confirm');
    await vi.waitFor(() => expect(state().user).toEqual({ id: 'u1', email: 'skipper@example.org' }));
    expect(login.open).toBe(false);
    expect(location.pathname).toBe('/');
    expect(location.hash).toBe('');
    const verify = server.calls.find((c) => c.url === '/api/auth/verify')!;
    expect(JSON.parse(String(verify.body))).toEqual({ token });
    expect(FakeChannel.all[0].posted).toContain('login');
    expect(toasts()).toContain('Angemeldet als skipper@example.org');
  });
});

describe('F-33 Freigabe erstellen', () => {
  it('[F-33] Titel, Sichtbarkeit und Ansicht werden hochgeladen; Ergebnis ist der Link /s/<id>', async () => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    await load(file('a.gpx', leg('A')));
    emit('sx-metric', 'gust');
    emit('sx-share');
    emit('sx-share-submit', { title: 'Mein Törn', visibility: 'private', includeView: true, listed: false, boatId: null });
    const share = el<{ result: { url: string; share: { id: string } } | null; error: string }>('sx-share-dialog');
    await vi.waitFor(() => expect(share.result ?? share.error).toBeTruthy());
    expect(share.error).toBe('');
    expect(share.result!.url).toBe(`${location.origin}/s/NewShareId23456789`);
    const stored = server.shares.get('NewShareId23456789')!;
    expect(stored.meta).toMatchObject({ title: 'Mein Törn', visibility: 'private', view: 'm=gust&l=s,w,v' });
    expect(stored.payload).toEqual({ v: 1, tracks: [{ name: 'A', gpx: state().tracks[0].raw }] });
  });

  it('[F-33] ohne „Ansicht mitgeben“ bleibt die Ansicht leer', async () => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    await load(file('a.gpx', leg('A')));
    emit('sx-share');
    emit('sx-share-submit', { title: 'T', visibility: 'unlisted', includeView: false, listed: false, boatId: null });
    await vi.waitFor(() => expect(server.shares.size).toBe(1));
    expect([...server.shares.values()][0].meta).toMatchObject({ view: '', visibility: 'unlisted' });
  });
});

describe('F-34/F-35 Geteilte Links öffnen', () => {
  const seedShare = (visibility = 'unlisted') =>
    server.shares.set('AbCdEfGhJkLmNpQr23', {
      meta: { id: 'AbCdEfGhJkLmNpQr23', title: 'Geteilter Törn', summary: '', visibility, view: 'm=wind&l=s', isOwner: false },
      payload: { v: 1, tracks: [{ name: 'Etappe', gpx: leg('Etappe') }] },
    });

  it('[F-34] /s/<id> öffnet ohne Anmeldung eine interaktive Ansicht mit Wetter und Diagrammen', async () => {
    seedShare();
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    expect(state().mode).toMatchObject({ kind: 'share', share: { id: 'AbCdEfGhJkLmNpQr23' } });
    expect(state().tracks.map((t) => t.name)).toEqual(['Etappe']);
    expect(state().tracks[0].points[0].wx).not.toBeNull();
    expect(state().metric).toBe('wind'); // gespeicherte Ansicht
    expect(el<{ readonly: boolean }>('sx-track-list').readonly).toBe(true);
    expect(el<HTMLElement>('#charts-panel').hidden).toBe(false);
    expect(document.title).toBe('Geteilter Törn · Sail Explorer');
    expect(h.ws.data).toBeNull(); // geteilte Ansicht überschreibt nicht die Gast-Sitzung
  });

  it('[F-34] Ansichtszustand aus der URL (?m=…&l=…) hat Vorrang und wird bei Änderungen nachgeführt', async () => {
    seedShare();
    await startApp('/s/AbCdEfGhJkLmNpQr23?m=wave&l=d');
    await settled();
    expect(state().metric).toBe('wave');
    expect(state().layers).toEqual({ seamarks: false, depth: true, windArrows: false, waveArrows: false });
    emit('sx-metric', 'gust');
    expect(location.pathname + location.search).toBe('/s/AbCdEfGhJkLmNpQr23?m=gust&l=d');
    // Weitergeben der geteilten Ansicht enthält die aktuelle Einfärbung
    emit('sx-share');
    expect(el<{ result: { url: string } }>('sx-share-dialog').result.url).toBe(`${location.origin}/s/AbCdEfGhJkLmNpQr23?m=gust&l=d`);
  });

  it('[F-35] private/unbekannte Freigabe: Hinweis und zurück zur Startseite', async () => {
    seedShare('private');
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    expect(state().tracks).toHaveLength(0);
    expect(toasts().some((t) => /gibt es nicht \(mehr\).*privat/.test(t))).toBe(true);
    expect(location.pathname).toBe('/');
  });
});

describe('F-36/F-37 Konto', () => {
  beforeEach(() => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    server.shares.set('AbCdEfGhJkLmNpQr23', { meta: { id: 'AbCdEfGhJkLmNpQr23', title: 'Alt', visibility: 'unlisted', view: '', isOwner: true }, payload: {} });
  });

  it('[F-36] Meine Tracks: auflisten, umbenennen, Sichtbarkeit ändern, Link kopieren, löschen', async () => {
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    emit('sx-account');
    const acc = el<{ open: boolean; shares: Array<{ id: string; title: string; visibility: string }>; loading: boolean }>('sx-account-dialog');
    await vi.waitFor(() => expect(acc.loading).toBe(false));
    expect(acc.open).toBe(true);
    expect(acc.shares.map((s) => s.title)).toEqual(['Alt']);

    emit('sx-share-update', { id: 'AbCdEfGhJkLmNpQr23', patch: { title: 'Neu' } });
    await vi.waitFor(() => expect(acc.shares[0].title).toBe('Neu'));
    emit('sx-share-update', { id: 'AbCdEfGhJkLmNpQr23', patch: { visibility: 'private' } });
    await vi.waitFor(() => expect(acc.shares[0].visibility).toBe('private'));

    emit('sx-share-copy', 'AbCdEfGhJkLmNpQr23');
    await vi.waitFor(() => expect(clipboard).toEqual([`${location.origin}/s/AbCdEfGhJkLmNpQr23`]));

    emit('sx-share-delete', 'AbCdEfGhJkLmNpQr23');
    await vi.waitFor(() => expect(acc.shares).toEqual([]));
    expect(server.calls.some((c) => c.method === 'DELETE' && c.url === '/api/shares/AbCdEfGhJkLmNpQr23')).toBe(true);
    expect(toasts()).toContain('Freigabe gelöscht');
  });

  it('[F-37] Abmelden', async () => {
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    emit('sx-logout');
    await vi.waitFor(() => expect(state().user).toBeNull());
    expect(server.calls.some((c) => c.method === 'POST' && c.url === '/api/auth/logout')).toBe(true);
    expect(FakeChannel.all[0].posted).toContain('logout');
    expect(toasts()).toContain('Abgemeldet');
  });

  it('[F-37] Konto löschen', async () => {
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    emit('sx-account-delete');
    await vi.waitFor(() => expect(state().user).toBeNull());
    expect(server.calls.some((c) => c.method === 'DELETE' && c.url === '/api/account')).toBe(true);
    expect(toasts().some((t) => /Konto.*Freigaben gelöscht/.test(t))).toBe(true);
  });
});

describe('F-40 Ohne Backend', () => {
  it('[F-40] ohne Backend kein Anmelden/Server-Teilen; Teilen kopiert einen Link mit eingebetteten Daten', async () => {
    server.backend = 'html';
    await startApp();
    await load(file('a.gpx', leg('A')));
    expect(state().backend).toBe(false);
    emit('sx-share');
    expect(el<{ linkState: string }>('sx-share-dialog').linkState).toBe('offline');
    emit('sx-share-inline');
    await vi.waitFor(() => expect(clipboard).toHaveLength(1));
    expect(clipboard[0]).toMatch(new RegExp(`^${location.origin}/#g=[A-Za-z0-9_-]+$`));
    expect(el<{ open?: boolean }>('sx-login-dialog').open).toBeFalsy();
    expect(server.calls.some((c) => c.url.startsWith('/api/shares'))).toBe(false);

    // Link öffnen (z. B. auf einem anderen Gerät)
    const raw = state().tracks[0].raw;
    const link = new URL(clipboard[0]);
    for (const [t, fn] of listeners) document.removeEventListener(t, fn);
    h.ws.data = null;
    await startApp(`/${link.hash}`);
    await settled();
    expect(state().tracks.map((t) => t.raw)).toEqual([raw]);
    expect(state().mode).toEqual({ kind: 'link', title: 'Geteilter Track' });
  });

  it('[F-40] zu große Tracks: verständlicher Hinweis statt riesiger URL', async () => {
    server.backend = 'html';
    await startApp();
    // zufällige Koordinaten komprimieren schlecht → > 32 kB URL
    const pts = genPoints({ n: 3000, dt: 5 }).map((p, i) => ({ ...p, lat: p.lat + Math.sin(i * 7.3) * 1e-4, lon: p.lon + Math.cos(i * 3.1) * 1e-4 }));
    await load(file('gross.gpx', gpxDoc(pts, 'Groß')));
    emit('sx-share');
    emit('sx-share-inline');
    await vi.waitFor(() => expect(toasts().some((t) => /zu groß/.test(t))).toBe(true));
    expect(clipboard).toEqual([]);
  });
});
