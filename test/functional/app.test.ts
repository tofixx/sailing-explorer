// @vitest-environment happy-dom
// Funktionale Tests der App-Verdrahtung (src/app.ts) mit echtem Store, Parser, Wetter-Logik und API-Client.
// Ersetzt werden nur: Leaflet-Karte (MapView), IndexedDB (workspace), Netzwerk (fetch) und BroadcastChannel.
// Die Lit-Komponenten werden nicht registriert – die App setzt nur Properties, die hier geprüft werden.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../src/domain/types';
import { SUPPORT_TIERS } from '../../src/domain/support';
import { T0, genPoints, gpxDoc, meteoResponse, type MeteoValues } from './helpers';

const h = vi.hoisted(() => ({
  maps: [] as Array<{ render: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn>; setLayers: ReturnType<typeof vi.fn>; showHover: ReturnType<typeof vi.fn> }>,
  ws: { data: null as null | { tracks: Array<{ id: string; name: string; gpx: string; hidden: boolean }>; weather?: unknown; savedAt: number } },
}));

vi.mock('../../src/map/map-view', async () => {
  const { vi: v } = await import('vitest');
  return {
    MapView: class {
      render = v.fn();
      fit = v.fn();
      setLayers = v.fn();
      showHover = v.fn();
      photos = { set: v.fn(), highlight: v.fn(), focus: v.fn(), startPlacing: v.fn(), stopPlacing: v.fn(), callbacks: {} };
      constructor() {
        h.maps.push(this);
      }
    },
  };
});

vi.mock('../../src/services/workspace', () => ({
  workspace: {
    load: async () => h.ws.data,
    save: async (tracks: Array<{ id: string; name: string; gpx: string; hidden: boolean }>, weather: unknown = null) => {
      h.ws.data = tracks.length ? { tracks: structuredClone(tracks), weather: structuredClone(weather), savedAt: Date.now() } : null;
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
  /** Antwort von /api/discover (null → 500) */
  discover: { voyages: unknown[]; boats: unknown[]; people: unknown[] } | null;
  calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }>;
  /** Unterstützen eingerichtet: Status für /api/me/support; null = nicht eingerichtet */
  support: Record<string, unknown> | null;
  checkout: 'ok' | 'fail';
  /** öffentliches bzw. per Schlüssel lesbares Profil für /api/profiles/:handle */
  profile: { handle: string; visibility: string; shareKey: string | null } | null;
  /** Einladung für /api/invites/peek und /accept (fehlt = ungültig) */
  invite?: { peek: Record<string, unknown>; accept: Record<string, unknown> };
  /** Antwort von /api/shares/:id/crew (fehlt = 404) */
  crew?: Record<string, unknown>;
  /** Vereine, Teams, Neuigkeiten (Konzept 11): Gruppenseite, Gruppen-Stream, eigene Gruppen, persönlicher Stream, Vorschläge */
  groups?: { page?: Record<string, unknown>; stream?: unknown; mine?: unknown; myStream?: unknown; suggestions?: unknown; publicStream?: unknown };
  /** Verein, Hafen, Reaktionen (Konzept 12): Hafenseite, Hafen-Stream, Heimat, Reaktionen eines Törns */
  social?: { harbor?: Record<string, unknown>; harborStream?: unknown; home?: Record<string, unknown>; reactions?: Record<string, unknown> };
}

let server: Server;
let app: InstanceType<typeof App>;
let toast: ReturnType<typeof vi.fn>;
let clipboard: string[];
let listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const origAdd = document.addEventListener.bind(document);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

let keySeq = 0;
/** Schlüssel wie im Worker: 22 Zeichen aus dem ID-Alphabet */
const nextKey = () => `Key${String(++keySeq).padStart(4, '0')}abcdefghijkmnpq`;
/** shareKey und link wie im Vertrag (shareShape für den Eigentümer) */
function withLink(meta: Record<string, unknown>, key: string | null) {
  meta.shareKey = key;
  meta.link = meta.visibility === 'unlisted' && key ? `/s/${meta.id}/${key}` : `/s/${meta.id}`;
}

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
  if (url.startsWith('/api/discover')) return server.discover ? json(server.discover) : json({ error: 'internal', message: 'Interner Fehler' }, 500);
  if (url === '/api/config') return json({ turnstileSiteKey: '', sharing: true, support: server.support ? { tiers: SUPPORT_TIERS } : null, freeShares: 3 });
  // ---- Verein, Hafen, Reaktionen (Konzept 12)
  const so = server.social;
  if (so) {
    if (url.startsWith('/api/harbors/slug/')) return so.harbor ? json(so.harbor) : json({ error: 'not_found', message: 'Diesen Hafen gibt es nicht (mehr).' }, 404);
    if (/^\/api\/harbors\/[A-Za-z0-9]+\/stream/.test(url)) return json(so.harborStream ?? { items: [], cursor: null });
    if (url === '/api/me/home') return server.user ? json(so.home ?? { club: null, harbor: null, harborExplicit: false, clubs: [] }) : json({ error: 'unauthenticated', message: 'Bitte zuerst anmelden.' }, 401);
    if (url.startsWith('/api/reactions/')) {
      if (method === 'GET') return json(so.reactions ?? { counts: { like: 0, mast: 0, tack: 0 }, mine: null, people: [], others: 0 });
      if (!server.user) return json({ error: 'unauthenticated', message: 'Bitte zuerst anmelden.' }, 401);
      const kind = method === 'PUT' ? (JSON.parse(String(init.body)) as { kind: string }).kind : null;
      return json({ counts: { like: kind === 'like' ? 7 : 6, mast: 0, tack: 0 }, mine: kind });
    }
  }
  // ---- Vereine, Teams, Neuigkeiten (Konzept 11)
  const gr = server.groups;
  if (gr) {
    if (url.startsWith('/api/groups/slug/')) return gr.page ? json(gr.page) : json({ error: 'not_found', message: 'Diese Gruppe gibt es nicht oder sie ist geschlossen.' }, 404);
    if (/^\/api\/groups\/[A-Za-z0-9]+\/stream/.test(url)) return json(gr.stream ?? { items: [], cursor: null });
    if (/^\/api\/groups\/[A-Za-z0-9]+\/posts$/.test(url) && method === 'POST') return json({ post: { id: 'P1' } }, 201);
    if (url === '/api/groups' && method === 'GET') return server.user ? json(gr.mine ?? { groups: [], requests: [] }) : json({ error: 'unauthenticated', message: 'Bitte zuerst anmelden.' }, 401);
    if (url.startsWith('/api/stream/public')) return json(gr.publicStream ?? { items: [], cursor: null, filters: { harbors: [], clubs: [] } });
    if (url.startsWith('/api/stream')) return server.user ? json(gr.myStream ?? { items: [], cursor: null, hasGroups: false }) : json({ error: 'unauthenticated', message: 'Bitte zuerst anmelden.' }, 401);
    if (url === '/api/me/suggestions') return json(gr.suggestions ?? { people: [] });
    if (url.startsWith('/api/follows/')) return json({ followers: 1, following: 0, isFollowing: method === 'PUT' });
    if (url === '/api/boats' && method === 'GET') return json({ boats: [] });
  }
  if (url === '/api/me/support') return server.user && server.support ? json(server.support) : json({ error: 'unauthenticated', message: 'Bitte zuerst anmelden.' }, 401);
  if (url === '/api/support/checkout' && method === 'POST') {
    return server.checkout === 'ok'
      ? json({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' })
      : json({ error: 'checkout_failed', message: 'Die Bezahlseite konnte nicht geöffnet werden.' }, 502);
  }
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
    const visibility = headers['x-share-visibility'];
    const meta: Record<string, unknown> = { id, title: decodeURIComponent(headers['x-share-title']), summary: decodeURIComponent(headers['x-share-summary']), visibility, view: decodeURIComponent(headers['x-share-view']), isOwner: true };
    withLink(meta, visibility === 'unlisted' ? nextKey() : null);
    server.shares.set(id, { meta, payload: JSON.parse(gunzipSync(init.body as Uint8Array).toString('utf8')) });
    return json({ share: meta }, 201);
  }
  if (url === '/api/invites/peek' && method === 'POST') {
    return server.invite ? json({ ...server.invite.peek, emailMatches: server.user ? true : null }) : json({ error: 'invalid_invite', message: 'Die Einladung ist ungültig, abgelaufen oder wurde schon benutzt.' }, 400);
  }
  if (url === '/api/invites/accept' && method === 'POST') {
    if (!server.user) return json({ error: 'unauthenticated', message: 'Bitte zuerst anmelden.' }, 401);
    return json(server.invite!.accept);
  }
  if (/^\/api\/shares\/[^/]+\/crew$/.test(url)) return server.crew ? json(server.crew) : json({ error: 'not_found', message: 'Nicht gefunden.' }, 404);
  if (/^\/api\/shares\/[^/]+\/invites$/.test(url) && method === 'POST') {
    const invite = { id: 'Inv1234567890abcde', email: null, usesLeft: 30, createdAt: Date.now(), expiresAt: Date.now() + 14 * 86_400_000 };
    return json({ invite, link: `${location.origin}/einladung#token=${'b'.repeat(43)}` }, 201);
  }
  const prof = /^\/api\/profiles\/([^/]+)$/.exec(url);
  if (prof) {
    const p = server.profile;
    if (!p || p.handle !== prof[1] || (p.visibility === 'unlisted' && headers['x-share-key'] !== p.shareKey)) return json({ error: 'not_found', message: 'Nicht gefunden.' }, 404);
    return json({ profile: { handle: p.handle, displayName: 'Anna', bio: '', visibility: p.visibility, shareKey: null, link: null, isSelf: false }, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] });
  }
  const m = /^\/api\/shares\/([^/]+)(\/data)?$/.exec(url);
  if (m) {
    const s = server.shares.get(decodeURIComponent(m[1]));
    if (method === 'DELETE') {
      server.shares.delete(m[1]);
      return new Response(null, { status: 204 });
    }
    if (method === 'PATCH') {
      const { rotateKey, ...patch } = JSON.parse(String(init.body)) as { rotateKey?: boolean } & Record<string, unknown>;
      Object.assign(s!.meta, patch);
      const key = rotateKey || (s!.meta.visibility === 'unlisted' && !s!.meta.shareKey) ? nextKey() : (s!.meta.shareKey as string | null) ?? null;
      withLink(s!.meta, key);
      return json({ share: s!.meta });
    }
    // „Nur mit Link“ mit Schlüssel: ohne passenden X-Share-Key wie unbekannt (der Eigentümer ist hier vereinfacht jeder Angemeldete)
    const keyed = s?.meta.visibility === 'unlisted' && s.meta.shareKey && headers['x-share-key'] !== s.meta.shareKey && !server.user;
    if (!s || keyed || (s.meta.visibility === 'private' && !server.user)) return json({ error: 'not_found', message: 'Diese Freigabe gibt es nicht (mehr).' }, 404);
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
  server = { backend: 'json', user: null, weather: { wind: 12, gust: 18, dir: 250, wave: 0.6, wdir: 240, wper: 4 }, shares: new Map(), files: {}, discover: { voyages: [], boats: [], people: [] }, calls: [], support: null, checkout: 'ok', profile: null };
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

  it('[F-75] Startseite und Törn-Ansicht: mit geladenen Tracks hin und zurück, Tracks bleiben erhalten', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    const app = el<HTMLElement>('.app');
    const empty = el<{ hidden: boolean; trackCount: number }>('sx-empty-state');
    const topbar = el<{ home: boolean }>('sx-topbar');
    expect(app.hasAttribute('data-empty')).toBe(false);

    emit('sx-home');
    expect(app.hasAttribute('data-empty')).toBe(true);
    expect(empty.hidden).toBe(false);
    expect(empty.trackCount).toBe(1);
    expect(topbar.home).toBe(true);
    expect(state().tracks).toHaveLength(1);

    h.maps[0].fit.mockClear();
    emit('sx-track-view');
    expect(app.hasAttribute('data-empty')).toBe(false);
    expect(empty.hidden).toBe(true);
    expect(topbar.home).toBe(false);
    // Kartenausschnitt wird für die wieder sichtbare Karte neu gesetzt
    expect(h.maps[0].fit).toHaveBeenCalledTimes(1);
  });

  it('[F-75] neuer Upload aus der Startseite wechselt in die Törn-Ansicht', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    emit('sx-home');
    await load(file('b.gpx', leg('B', T0 + 86_400_000)));
    expect(el<HTMLElement>('.app').hasAttribute('data-empty')).toBe(false);
    expect(state().tracks).toHaveLength(2);
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

const meteoCalls = () => server.calls.filter((c) => c.url.includes('open-meteo')).length;

describe('F-22 Wetter einmalig beim Einstellen', () => {
  it('[F-22] Gast-Sitzung: Wetter wird mitgespeichert und beim nächsten Besuch nicht erneut abgerufen', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    await settled();
    expect(meteoCalls()).toBeGreaterThan(0);
    await vi.waitFor(() => expect(h.ws.data?.weather).toBeTruthy());
    // „nächster Besuch“
    for (const [t, fn] of listeners) document.removeEventListener(t, fn);
    document.body.innerHTML = BODY;
    (document.querySelector('sx-toast') as unknown as { show: unknown }).show = toast;
    server.calls = [];
    await startApp();
    await settled();
    expect(state().tracks[0].points.every((pt) => pt.wx?.wind === 12)).toBe(true);
    expect(meteoCalls()).toBe(0);
    expect(state().status.text).toMatch(/beim Einstellen gespeichert/);
  });

  it('[F-22] neue Tracks lösen genau einen neuen Abruf aus', async () => {
    await startApp();
    await load(file('a.gpx', leg('A')));
    await settled();
    server.calls = [];
    await load(file('b.gpx', leg('B', T0 + 86_400_000)));
    await settled();
    expect(meteoCalls()).toBeGreaterThan(0);
  });

  it('[F-22] ungültiges gespeichertes Wetter wird verworfen und neu geladen', async () => {
    h.ws.data = { tracks: [{ id: 'x', name: 'A', gpx: leg('A'), hidden: false }], weather: { samples: 'kaputt', windOk: true, waveOk: true }, savedAt: Date.now() };
    await startApp();
    await settled();
    expect(meteoCalls()).toBeGreaterThan(0);
    expect(state().tracks[0].points[0].wx?.wind).toBe(12);
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
    await settled();
    emit('sx-metric', 'gust');
    emit('sx-share');
    emit('sx-share-submit', { title: 'Mein Törn', visibility: 'private', includeView: true, boatId: null });
    const share = el<{ result: { url: string; share: { id: string } } | null; error: string }>('sx-share-dialog');
    await vi.waitFor(() => expect(share.result ?? share.error).toBeTruthy());
    expect(share.error).toBe('');
    expect(share.result!.url).toBe(`${location.origin}/s/NewShareId23456789`);
    const stored = server.shares.get('NewShareId23456789')!;
    expect(stored.meta).toMatchObject({ title: 'Mein Törn', visibility: 'private', view: 'm=gust&l=s,w,v' });
    // Wetter wird beim Einstellen einmal geladen und mit der Freigabe gespeichert (F-22)
    expect(stored.payload).toEqual({ v: 1, tracks: [{ name: 'A', gpx: state().tracks[0].raw }], weather: state().weather });
    expect(state().weather).not.toBeNull();
    // F-76: Kopfzeile zeigt jetzt „Gespeichert“
    expect(state().saved).toBe(true);
    expect(el<{ saved: boolean }>('sx-topbar').saved).toBe(true);
    emit('sx-track-remove', state().tracks[0].id);
    expect(state().saved).toBe(false);
  });

  it('[F-33] ohne „Ansicht mitgeben“ bleibt die Ansicht leer', async () => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    await load(file('a.gpx', leg('A')));
    emit('sx-share');
    emit('sx-share-submit', { title: 'T', visibility: 'unlisted', includeView: false, boatId: null });
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

  it('[F-22] Freigabe mit gespeichertem Wetter: Betrachter rufen Open-Meteo nicht ab', async () => {
    const times = Array.from({ length: 48 }, (_, i) => T0 - 6 * 3_600_000 + i * 3_600_000);
    const series = (v: number) => times.map(() => v);
    seedShare();
    (server.shares.get('AbCdEfGhJkLmNpQr23')!.payload as { weather?: unknown }).weather = {
      samples: [{ lat: 54.4, lon: 12.9, times, wind: series(7), dir: series(200), gust: series(9), wave: series(0.4), wdir: series(210), wper: series(3) }],
      windOk: true,
      waveOk: true,
    };
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    expect(state().tracks[0].points[0].wx?.wind).toBe(7);
    expect(meteoCalls()).toBe(0);
  });

  it('[F-22] ältere Freigabe ohne Wetter lädt es wie bisher nach', async () => {
    seedShare();
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    expect(meteoCalls()).toBeGreaterThan(0);
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

describe('Phase A: Sichtbarkeit und Schlüssel-Links', () => {
  const KEY = 'Kq7mPz2xWv9tRb4nHs6dJf';
  const seedKeyed = () =>
    server.shares.set('AbCdEfGhJkLmNpQr23', {
      meta: { id: 'AbCdEfGhJkLmNpQr23', title: 'Nur mit Link', summary: '', visibility: 'unlisted', shareKey: KEY, link: null, view: 'm=wind&l=s', isOwner: false },
      payload: { v: 1, tracks: [{ name: 'Etappe', gpx: leg('Etappe') }] },
    });
  const reads = (path: string) => server.calls.filter((c) => c.method === 'GET' && c.url.startsWith(path));

  it('/s/<id>/<key> sendet den Schlüssel als X-Share-Key an Metadaten und Daten', async () => {
    seedKeyed();
    await startApp(`/s/AbCdEfGhJkLmNpQr23/${KEY}`);
    await settled();
    expect(state().mode).toMatchObject({ kind: 'share', key: KEY, share: { id: 'AbCdEfGhJkLmNpQr23' } });
    const calls = reads('/api/shares/AbCdEfGhJkLmNpQr23');
    // Crew (F-134), Kommentare (F-110) und Fotos (F-104) werden mit demselben Schlüssel geladen wie Metadaten und Daten.
    expect(calls.map((c) => c.url).sort()).toEqual([
      '/api/shares/AbCdEfGhJkLmNpQr23', '/api/shares/AbCdEfGhJkLmNpQr23/comments', '/api/shares/AbCdEfGhJkLmNpQr23/crew', '/api/shares/AbCdEfGhJkLmNpQr23/data',
      '/api/shares/AbCdEfGhJkLmNpQr23/photos',
    ]);
    expect(calls.every((c) => c.headers['x-share-key'] === KEY)).toBe(true);
  });

  it('ohne Schlüssel wird kein X-Share-Key gesendet; „Nur mit Link“ ist dann nicht erreichbar', async () => {
    seedKeyed();
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    expect(reads('/api/shares/').every((c) => !('x-share-key' in c.headers))).toBe(true);
    expect(state().tracks).toHaveLength(0);
    expect(location.pathname).toBe('/');
  });

  it('Ansichtswechsel behält den Schlüssel in der Adresse; Weitergeben nutzt denselben Link', async () => {
    seedKeyed();
    await startApp(`/s/AbCdEfGhJkLmNpQr23/${KEY}`);
    await settled();
    emit('sx-metric', 'gust');
    expect(location.pathname + location.search).toBe(`/s/AbCdEfGhJkLmNpQr23/${KEY}?m=gust&l=s`);
    emit('sx-share');
    expect(el<{ result: { url: string } }>('sx-share-dialog').result.url).toBe(`${location.origin}/s/AbCdEfGhJkLmNpQr23/${KEY}?m=gust&l=s`);
  });

  it('/u/<handle>/<key> lädt das Profil mit X-Share-Key', async () => {
    server.profile = { handle: 'anna', visibility: 'unlisted', shareKey: KEY };
    await startApp(`/u/anna/${KEY}`);
    const page = el<{ data: { kind: string } | null; error: string; loading: boolean }>('sx-profile-page');
    await vi.waitFor(() => expect(page.loading).toBe(false));
    expect(page.error).toBe('');
    expect(page.data?.kind).toBe('profile');
    expect(reads('/api/profiles/anna')[0].headers['x-share-key']).toBe(KEY);
  });

  it('Teilen-Dialog startet mit „Öffentlich“; Ergebnis zeigt den absoluten Link aus der Antwort', async () => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    await load(file('a.gpx', leg('A')));
    emit('sx-share');
    const share = el<{ visibility: string; result: { url: string } | null; error: string }>('sx-share-dialog');
    expect(share.visibility).toBe('public');
    emit('sx-share-submit', { title: 'Geheim', visibility: 'unlisted', includeView: false, boatId: null });
    await vi.waitFor(() => expect(share.result ?? share.error).toBeTruthy());
    const meta = server.shares.get('NewShareId23456789')!.meta;
    expect(server.calls.find((c) => c.method === 'POST' && c.url === '/api/shares')!.headers).not.toHaveProperty('x-share-listed');
    expect(share.result!.url).toBe(`${location.origin}${meta.link}`);
    expect(share.result!.url).toMatch(/\/s\/NewShareId23456789\/Key\w+$/);
  });

  it('Konto: Stufe ändern und Link erneuern gehen per PATCH; Kopieren nimmt den neuen Schlüssel-Link', async () => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    server.shares.set('AbCdEfGhJkLmNpQr23', { meta: { id: 'AbCdEfGhJkLmNpQr23', title: 'Alt', visibility: 'public', view: '', isOwner: true, shareKey: null, link: '/s/AbCdEfGhJkLmNpQr23' }, payload: {} });
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    emit('sx-account');
    const acc = el<{ shares: Array<{ visibility: string; link: string }>; loading: boolean }>('sx-account-dialog');
    await vi.waitFor(() => expect(acc.loading).toBe(false));

    emit('sx-share-update', { id: 'AbCdEfGhJkLmNpQr23', patch: { visibility: 'unlisted' } });
    await vi.waitFor(() => expect(acc.shares[0].visibility).toBe('unlisted'));
    const first = acc.shares[0].link;
    expect(first).toMatch(/^\/s\/AbCdEfGhJkLmNpQr23\/Key/);

    emit('sx-share-update', { id: 'AbCdEfGhJkLmNpQr23', patch: { rotateKey: true } });
    await vi.waitFor(() => expect(acc.shares[0].link).not.toBe(first));
    const patches = server.calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(String(c.body)));
    expect(patches).toEqual([{ visibility: 'unlisted' }, { rotateKey: true }]);
    expect(toasts().some((t) => /Neuer Link.*alte Link funktioniert nicht mehr/.test(t))).toBe(true);

    emit('sx-share-copy', 'AbCdEfGhJkLmNpQr23');
    await vi.waitFor(() => expect(clipboard).toEqual([`${location.origin}${acc.shares[0].link}`]));
  });

  it('Boot- und Profil-Links: sx-link-copy kopiert nur eigene Seitenpfade', async () => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    await startApp();
    emit('sx-link-copy', `/b/BoatId1234567890/${KEY}`);
    await vi.waitFor(() => expect(clipboard).toEqual([`${location.origin}/b/BoatId1234567890/${KEY}`]));
    emit('sx-link-copy', 'https://evil.example/x');
    emit('sx-link-copy', '//evil.example');
    await new Promise((r) => setTimeout(r, 20));
    expect(clipboard).toHaveLength(1);
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

describe('F-63 Unterstützen: Checkout und Rückkehr', () => {
  const supportStatus = (supporter: boolean) => ({
    supporter,
    supporterUntil: supporter ? Date.now() + 365 * 86_400_000 : null,
    sharesUsed: 3,
    sharesFree: 3,
    sharesMax: 100,
    bytesUsed: 0,
    bytesMax: 200 * 1024 * 1024,
  });

  beforeEach(() => {
    server.user = { id: 'u1', email: 'skipper@example.org' };
    server.support = supportStatus(false);
  });

  it('[F-63] „Jetzt unterstützen“ legt den Checkout mit dem Betrag an und wechselt zur Bezahlseite', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    emit('sx-support-checkout', { amount: 1000 });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_123'));
    const call = server.calls.find((c) => c.url === '/api/support/checkout')!;
    expect(call.method).toBe('POST');
    expect(JSON.parse(String(call.body))).toEqual({ amount: 1000 });
    expect(el<{ checkoutBusy: boolean }>('sx-share-dialog').checkoutBusy).toBe(true);
    assign.mockRestore();
  });

  it('[F-63] Checkout-Fehler: Hinweis per Toast, Knopf wieder frei, keine Weiterleitung', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    server.checkout = 'fail';
    await startApp();
    await vi.waitFor(() => expect(state().user).not.toBeNull());
    emit('sx-support-checkout', { amount: 300 });
    await vi.waitFor(() => expect(toasts()).toContain('Die Bezahlseite konnte nicht geöffnet werden.'));
    expect(assign).not.toHaveBeenCalled();
    expect(el<{ checkoutBusy: boolean }>('sx-account-dialog').checkoutBusy).toBe(false);
    assign.mockRestore();
  });

  it('[F-63] ?support=success: Dank, Status neu geladen, Parameter entfernt', async () => {
    server.support = supportStatus(true);
    await startApp('/?support=success');
    expect(location.search).toBe('');
    await vi.waitFor(() => expect(toasts().some((t) => /Danke für deine Unterstützung/.test(t))).toBe(true));
    expect(server.calls.some((c) => c.url === '/api/me/support')).toBe(true);
    expect(el<{ supportStatus: { supporter: boolean } }>('sx-account-dialog').supportStatus.supporter).toBe(true);
  });

  it('[F-63] ?support=cancel: kurzer Hinweis, Parameter entfernt', async () => {
    await startApp('/?support=cancel');
    expect(location.search).toBe('');
    await vi.waitFor(() => expect(toasts().some((t) => /abgebrochen/.test(t))).toBe(true));
  });

  it('[F-63] ?support=open (Erinnerungsmail): öffnet Konto & Freigaben mit dem Angebot', async () => {
    await startApp('/?support=open');
    expect(location.search).toBe('');
    const account = el<{ open: boolean; tab: string; supportTiers: unknown[] | null }>('sx-account-dialog');
    await vi.waitFor(() => expect(account.open).toBe(true));
    expect(account.tab).toBe('shares');
    await vi.waitFor(() => expect(account.supportTiers).toHaveLength(SUPPORT_TIERS.length));
  });

  it('[F-63] ?support=open ohne Anmeldung: erst anmelden', async () => {
    server.user = null;
    await startApp('/?support=open');
    await vi.waitFor(() => expect(el<{ open: boolean }>('sx-login-dialog').open).toBe(true));
    expect(el<{ open?: boolean }>('sx-account-dialog').open).toBeFalsy();
  });
});

describe('F-70 Entdecken', () => {
  const voyage = (id: string) => ({ id, title: `Törn ${id}`, summary: '', distNm: 12.5, startedAt: T0, createdAt: T0, trackCount: 1, hasImage: false, boat: null, sailor: { handle: 'anna', displayName: 'Anna' } });
  const strip = () => el<{ hidden: boolean; data: { voyages: unknown[] } | null }>('sx-discover[slot="discover"]');
  const page = () => el<{ hidden: boolean; loading: boolean; error: string; data: { voyages: unknown[] } | null }>('#discover-page');
  const discoverCalls = () => server.calls.filter((c) => c.url.startsWith('/api/discover'));

  it('[F-70] Startseite: Leiste „Zuletzt gesegelt“ bekommt die neuesten öffentlichen Törns', async () => {
    server.discover = { voyages: [voyage('a'), voyage('b')], boats: [], people: [] };
    await startApp();
    await vi.waitFor(() => expect(strip().hidden).toBe(false));
    expect(strip().data?.voyages).toHaveLength(2);
    expect(discoverCalls().map((c) => c.url)).toEqual(['/api/discover?limit=6']);
    // Leiste steckt im Einstieg – sobald eigene Tracks geladen sind, verschwindet sie mit ihm
    expect(document.querySelector('sx-empty-state')?.contains(strip() as unknown as Node)).toBe(true);
  });

  it('[F-70] ohne öffentliche Törns bleibt die Leiste sichtbar und lädt ein', async () => {
    await startApp();
    await vi.waitFor(() => expect(discoverCalls()).toHaveLength(1));
    await vi.waitFor(() => expect(strip().hidden).toBe(false));
    expect(strip().data?.voyages).toEqual([]);
  });

  it('[F-70] bei Serverfehlern bleibt die Leiste still ausgeblendet (kein Hinweis)', async () => {
    server.discover = null;
    await startApp();
    await vi.waitFor(() => expect(discoverCalls()).toHaveLength(1));
    expect(strip().hidden).toBe(true);
    expect(toasts()).toEqual([]);
  });

  it('[F-40] ohne Backend bleibt die Leiste still ausgeblendet', async () => {
    server.backend = 'html';
    await startApp();
    await vi.waitFor(() => expect(discoverCalls()).toHaveLength(1));
    expect(strip().hidden).toBe(true);
    expect(toasts()).toEqual([]);
  });

  it('[F-70] Profilseiten laden keine Entdecken-Leiste', async () => {
    await startApp('/u/anna');
    expect(discoverCalls()).toEqual([]);
  });

  it('[F-70] /entdecken öffnet die Seite statt der Karte und lädt bis zu 24 Einträge', async () => {
    server.discover = { voyages: [voyage('a')], boats: [], people: [] };
    await startApp('/entdecken');
    expect(document.querySelector('.app')?.hasAttribute('data-page')).toBe(true);
    expect(page().hidden).toBe(false);
    expect(page().loading).toBe(false);
    expect(page().data?.voyages).toHaveLength(1);
    expect(document.title).toBe('Entdecken · Sail Explorer');
    expect(discoverCalls().map((c) => c.url)).toEqual(['/api/discover?limit=24']);
  });

  it('[F-40] /entdecken ohne Backend: verständlicher Hinweis statt Fehler', async () => {
    server.backend = 'html';
    await startApp('/entdecken');
    expect(page().error).toMatch(/nicht verfügbar/);
  });
});

describe('F-138 Einladungen in der App', () => {
  const TOKEN = 'c'.repeat(43);
  const invite = () => el<{ open: boolean; state: string; signedIn: boolean; peek: Record<string, unknown> | null; result: Record<string, unknown> | null; errorCode: string }>('sx-invite-dialog');
  const login = () => el<{ open: boolean; reason: string }>('sx-login-dialog');
  const posts = (url: string) => server.calls.filter((c) => c.method === 'POST' && c.url === url);
  const seedInvite = () =>
    (server.invite = {
      peek: { kind: 'crew', target: 'Rügen rund', inviter: 'Anna', bound: false, expiresAt: Date.now() + 86_400_000, isOwner: false, alreadyMember: false },
      accept: { kind: 'crew', path: '/s/AbCdEfGhJkLmNpQr23', target: 'Rügen rund', already: false },
    });

  it('[F-138] /einladung#token=…: Token verschwindet aus der Adresse, Einladung wird gezeigt, nichts wird ohne Klick eingelöst', async () => {
    seedInvite();
    await startApp(`/einladung#token=${TOKEN}`);
    expect(location.pathname + location.hash).toBe('/');
    expect(invite()).toMatchObject({ open: true, state: 'ready', signedIn: false, peek: { kind: 'crew', target: 'Rügen rund' } });
    expect(JSON.parse(String(posts('/api/invites/peek')[0].body))).toEqual({ token: TOKEN });
    expect(posts('/api/invites/accept')).toEqual([]);
  });

  it('[F-138] nicht angemeldet → Anmelden; nach der Anmeldung in einem anderen Tab erscheint die Einladung wieder, Annehmen löst ein', async () => {
    seedInvite();
    await startApp(`/einladung#token=${TOKEN}`);
    emit('sx-invite-login');
    expect(invite().open).toBe(false);
    expect(login().open).toBe(true);
    expect(login().reason).toMatch(/Einladung/);
    server.user = { id: 'u1', email: 'skipper@example.org' };
    FakeChannel.all[0].receive('login');
    await vi.waitFor(() => expect(invite()).toMatchObject({ open: true, state: 'ready', signedIn: true }));
    expect(login().open).toBe(false);
    emit('sx-invite-accept');
    await vi.waitFor(() => expect(invite().state).toBe('done'));
    expect(invite().result).toMatchObject({ path: '/s/AbCdEfGhJkLmNpQr23' });
    expect(JSON.parse(String(posts('/api/invites/accept')[0].body))).toEqual({ token: TOKEN });
  });

  it('[F-138] ungültige Einladung: verständliche Meldung, Schließen vergisst sie', async () => {
    await startApp(`/einladung#token=${TOKEN}`);
    expect(invite()).toMatchObject({ open: true, state: 'error' });
    emit('sx-close', 'invite');
    expect(invite().open).toBe(false);
  });
});

describe('F-139 Crew in der Törn-Ansicht', () => {
  const seed = (isOwner: boolean) =>
    server.shares.set('AbCdEfGhJkLmNpQr23', {
      meta: { id: 'AbCdEfGhJkLmNpQr23', title: 'Crew-Törn', summary: '', visibility: 'public', shareKey: null, link: '/s/AbCdEfGhJkLmNpQr23', view: '', isOwner },
      payload: { v: 1, tracks: [{ name: 'Etappe', gpx: leg('Etappe') }] },
    });
  const panel = () => el<HTMLElement>('#crew-panel');
  const crew = () => el<{ crew: Record<string, unknown> | null; isOwner: boolean; newLink: string }>('sx-crew');

  it('[F-139] Besucher: Panel nur, wenn Crew eingetragen ist', async () => {
    seed(false);
    server.crew = { members: [{ id: null, handle: 'mats', displayName: 'Mats' }], others: 1, isOwner: false, isCrew: false, invites: [] };
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    await vi.waitFor(() => expect(panel().hidden).toBe(false));
    expect(crew().crew).toMatchObject({ others: 1 });
    expect(crew().isOwner).toBe(false);
  });

  it('[F-139] Besucher ohne Crew: kein Panel; ohne Backend-Antwort ebenfalls nicht', async () => {
    seed(false);
    server.crew = { members: [], others: 0, isOwner: false, isCrew: false, invites: [] };
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    await vi.waitFor(() => expect(server.calls.some((c) => c.url.endsWith('/crew'))).toBe(true));
    expect(panel().hidden).toBe(true);
  });

  it('[F-139] Eigentümer: Panel auch ohne Crew; Einladungslink erzeugen zeigt ihn einmal, Kopieren nimmt nur eigene Links', async () => {
    seed(true);
    server.user = { id: 'u1', email: 'skipper@example.org' };
    server.crew = { members: [], others: 0, isOwner: true, isCrew: false, invites: [] };
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    await vi.waitFor(() => expect(panel().hidden).toBe(false));
    emit('sx-crew-invite', { to: null });
    await vi.waitFor(() => expect(crew().newLink).toMatch(/\/einladung#token=b{43}$/));
    emit('sx-invite-copy', 'https://evil.example/einladung#token=x');
    emit('sx-invite-copy', crew().newLink);
    await vi.waitFor(() => expect(clipboard).toEqual([crew().newLink]));
  });

  it('[F-139] zurück zum eigenen Arbeitsbereich blendet das Panel aus', async () => {
    seed(false);
    server.crew = { members: [{ id: null, handle: 'mats', displayName: 'Mats' }], others: 0, isOwner: false, isCrew: false, invites: [] };
    await startApp('/s/AbCdEfGhJkLmNpQr23');
    await settled();
    await vi.waitFor(() => expect(panel().hidden).toBe(false));
    await load(file('eigen.gpx', leg('Eigen')));
    expect(panel().hidden).toBe(true);
  });
});

describe('F-163 Vereine, Teams und Neuigkeiten in der App', () => {
  const T = Date.UTC(2026, 9, 20);
  const groupPage = () => el<{ hidden: boolean; mode: string; loading: boolean; error: string; data: { group: { id: string } } | null; stream: { items: unknown[] } | null }>('sx-group-page');
  const home = () => el<{ hidden: boolean; stream: { items: unknown[]; hasGroups?: boolean } | null; groups: unknown[]; suggestions: Array<{ handle: string }>; publicGroups: unknown[] }>('sx-home-feed');
  const page = (over: Record<string, unknown> = {}) => ({
    group: { id: 'G1', kind: 'club', slug: 'sc-kiel', name: 'SC Kiel', description: '', homePort: '', visibility: 'public', joinMode: 'request', role: null, shareKey: null, link: null, createdAt: T },
    parent: null, teams: [], stats: { members: 1, boats: 0, voyages: 0, distNm: 0, seasonNm: 0 }, members: [], others: 0, boats: [],
    social: { followers: 0, isFollowing: false }, membership: { role: null, requested: false, canRequest: true }, ...over,
  });
  const post = { id: 'a1', kind: 'post', createdAt: T, actor: null, group: { slug: 'sc-kiel', name: 'SC Kiel', kind: 'club' }, post: { id: 'P1', body: 'Hallo', link: null, canDelete: false } };

  it('[F-163] /g/<slug> öffnet die Gruppenseite statt der Karte und lädt die Neuigkeiten der Gruppe', async () => {
    server.groups = { page: page(), stream: { items: [post], cursor: null } };
    await startApp('/g/sc-kiel');
    expect(document.querySelector('.app')?.hasAttribute('data-page')).toBe(true);
    expect(groupPage().hidden).toBe(false);
    expect(groupPage().loading).toBe(false);
    expect(groupPage().data?.group.id).toBe('G1');
    expect(groupPage().stream?.items).toHaveLength(1);
    expect(document.title).toBe('SC Kiel · Sail Explorer');
    expect(server.calls.map((c) => c.url)).toEqual(expect.arrayContaining(['/api/groups/slug/sc-kiel', '/api/groups/G1/stream']));
    // keine Startseiten-Daten auf einer Gruppenseite
    expect(server.calls.some((c) => c.url.startsWith('/api/stream'))).toBe(false);
  });

  it('[F-163] unbekannte oder geschlossene Gruppe: verständlicher Hinweis', async () => {
    server.groups = {};
    await startApp('/g/geheim');
    expect(groupPage().error).toContain('geschlossen');
  });

  it('[F-163] /g/neu zeigt das Formular zum Gründen', async () => {
    server.groups = {};
    await startApp('/g/neu');
    expect(groupPage().hidden).toBe(false);
    expect(groupPage().mode).toBe('create');
  });

  it('[F-163] Startseite angemeldet: Neuigkeiten, eigene Gruppen und Vorschläge; „Folgen“ entfernt den Vorschlag', async () => {
    server.user = { id: 'U1', email: 'a@example.org' };
    server.groups = {
      myStream: { items: [post], cursor: null, hasGroups: true },
      mine: { groups: [{ id: 'G1', slug: 'sc-kiel', name: 'SC Kiel', kind: 'club', role: 'member', members: 2 }], requests: [] },
      suggestions: { people: [{ handle: 'mats', displayName: 'Mats', reason: 'group', reasonText: 'Im selben Verein' }] },
    };
    await startApp();
    await vi.waitFor(() => expect(home().hidden).toBe(false));
    expect(home().stream?.items).toHaveLength(1);
    expect(home().groups).toHaveLength(1);
    expect(home().suggestions.map((s) => s.handle)).toEqual(['mats']);
    emit('sx-follow', { kind: 'user', id: 'mats', follow: true });
    await vi.waitFor(() => expect(home().suggestions).toEqual([]));
    expect(server.calls.find((c) => c.url === '/api/follows/user/mats')?.method).toBe('PUT');
  });

  it('[F-182] Startseite ohne Anmeldung: öffentlicher Community-Stream statt persönlicher Neuigkeiten', async () => {
    server.groups = { publicStream: { items: [post], cursor: null, filters: { harbors: [{ slug: 'potsdam', name: 'Potsdam', boats: 3 }], clubs: [] } } };
    await startApp();
    await vi.waitFor(() => expect(home().hidden).toBe(false));
    expect(server.calls.some((c) => c.url === '/api/stream')).toBe(false);
    expect(server.calls.some((c) => c.url === '/api/stream/public')).toBe(true);
    expect(home().stream?.items).toHaveLength(1);
    expect(el<{ community: boolean }>('sx-empty-state').community).toBe(true);
  });

  it('[F-182] Startseite angemeldet: persönlicher Stream als Hauptbereich, Hochladen bleibt erreichbar (Datei, F-75)', async () => {
    server.user = { id: 'U1', email: 'a@example.org' };
    server.groups = { myStream: { items: [post], cursor: null, hasGroups: true, home: { club: null, harbor: null } }, mine: { groups: [], requests: [] } };
    await startApp();
    await vi.waitFor(() => expect(home().hidden).toBe(false));
    expect(el<{ community: boolean }>('sx-empty-state').community).toBe(true);
    expect(el<{ signedIn: boolean }>('sx-home-feed').signedIn).toBe(true);
    expect(server.calls.some((c) => c.url === '/api/stream')).toBe(true);
    expect(server.calls.some((c) => c.url.startsWith('/api/stream/public'))).toBe(false);
    // „Track anlegen“: Datei laden wechselt in die Törn-Ansicht, die Startseite bleibt per Logo erreichbar
    emit('sx-files', [file('a.gpx', leg('Neu'))]);
    await vi.waitFor(() => expect(state().tracks).toHaveLength(1));
    await settled();
    expect(state().home).toBe(false);
    expect(el<{ hidden: boolean }>('sx-empty-state').hidden).toBe(true);
    emit('sx-home');
    expect(el<{ hidden: boolean }>('sx-empty-state').hidden).toBe(false);
  });

  it('[F-178] Filter-Chip lädt den öffentlichen Stream gefiltert neu', async () => {
    server.groups = { publicStream: { items: [], cursor: null, filters: { harbors: [{ slug: 'potsdam', name: 'Potsdam', boats: 3 }], clubs: [] } } };
    await startApp();
    await vi.waitFor(() => expect(home().hidden).toBe(false));
    emit('sx-stream-filter', { filter: { kind: 'harbor', slug: 'potsdam' } });
    await vi.waitFor(() => expect(server.calls.some((c) => c.url === '/api/stream/public?harbor=potsdam')).toBe(true));
    await vi.waitFor(() => expect(el<{ filter: unknown }>('sx-home-feed').filter).toEqual({ kind: 'harbor', slug: 'potsdam' }));
  });

  const reactItem = { ...post, id: 'a9', kind: 'voyage', voyage: { id: 'S1', title: 'T', distNm: 1, startedAt: T, hasImage: false, boat: null }, post: undefined, reactions: { subject: 'share', id: 'S1', counts: { like: 6, mast: 0, tack: 0 }, mine: null } };
  const previous = { counts: { like: 6, mast: 0, tack: 0 }, mine: null };

  it('[F-179] Reaktion ohne Anmeldung: Anmeldedialog, nichts gespeichert, Anzeige zurück', async () => {
    server.social = {};
    server.groups = { publicStream: { items: [reactItem], cursor: null } };
    await startApp();
    await vi.waitFor(() => expect(home().hidden).toBe(false));
    emit('sx-react', { subject: 'share', id: 'S1', kind: 'like', previous });
    expect(el<{ open: boolean }>('sx-login-dialog').open).toBe(true);
    expect(server.calls.some((c) => c.url.startsWith('/api/reactions/'))).toBe(false);
    expect((home().stream?.items[0] as { reactions: { mine: unknown } }).reactions.mine).toBeNull();
  });

  it('[F-179] Reaktion im Stream: gespeichert und mit der Antwort des Servers nachgeführt', async () => {
    server.social = {};
    server.user = { id: 'U1', email: 'a@example.org' };
    server.groups = { myStream: { items: [reactItem], cursor: null, hasGroups: false }, mine: { groups: [], requests: [] } };
    await startApp();
    await vi.waitFor(() => expect(home().stream?.items).toHaveLength(1));
    emit('sx-react', { subject: 'share', id: 'S1', kind: 'like', previous });
    await vi.waitFor(() => expect((home().stream?.items[0] as { reactions: { mine: string } }).reactions.mine).toBe('like'));
    const call = server.calls.find((c) => c.url === '/api/reactions/share/S1' && c.method === 'PUT');
    expect(JSON.parse(String(call?.body))).toEqual({ kind: 'like' });
    expect((home().stream?.items[0] as { reactions: { counts: { like: number } } }).reactions.counts.like).toBe(7);
  });

  it('[F-173] /h/<slug> öffnet die Hafenseite mit Neuigkeiten des Hafens', async () => {
    server.social = {
      harbor: { harbor: { id: 'H1', slug: 'potsdam', name: 'Potsdam', lat: null, lon: null, canEdit: false, createdAt: T }, club: null, stats: { boats: 0, voyages: 0, distNm: 0, seasonNm: 0 }, boats: [], voyages: [], social: { followers: 0, isFollowing: false }, clubChoices: [], canClearClub: false },
      harborStream: { items: [post], cursor: null },
    };
    await startApp('/h/potsdam');
    const page = el<{ hidden: boolean; data: { kind: string; stream: { items: unknown[] } } | null }>('sx-profile-page');
    await vi.waitFor(() => expect(page.data?.kind).toBe('harbor'));
    expect(page.hidden).toBe(false);
    expect(page.data?.stream.items).toHaveLength(1);
    expect(document.title).toBe('Hafen Potsdam · Sail Explorer');
    expect(document.querySelector('.app')?.hasAttribute('data-page')).toBe(true);
  });

  it('[F-183] /impressum und /datenschutz funktionieren ohne Backend', async () => {
    server.backend = 'html';
    await startApp('/impressum');
    const legal = el<{ hidden: boolean; page: string }>('sx-legal-page');
    expect(legal.hidden).toBe(false);
    expect(legal.page).toBe('impressum');
    expect(document.title).toBe('Impressum · Sail Explorer');
    expect(document.querySelector('.app')?.hasAttribute('data-page')).toBe(true);
    await startApp('/datenschutz');
    expect(el<{ page: string }>('sx-legal-page').page).toBe('datenschutz');
  });

  it('[F-161] Beitrag veröffentlichen lädt die Gruppe neu', async () => {
    server.user = { id: 'U1', email: 'a@example.org' };
    server.groups = { page: page({ group: { ...page().group, role: 'admin' } }) };
    await startApp('/g/sc-kiel');
    const before = server.calls.filter((c) => c.url === '/api/groups/slug/sc-kiel').length;
    emit('sx-post-create', { groupId: 'G1', body: 'Absegeln', link: '' });
    await vi.waitFor(() => expect(server.calls.filter((c) => c.url === '/api/groups/slug/sc-kiel').length).toBeGreaterThan(before));
    const sent = server.calls.find((c) => c.url === '/api/groups/G1/posts');
    expect(JSON.parse(String(sent?.body))).toEqual({ body: 'Absegeln', link: '' });
    expect(toasts()).toContain('Veröffentlicht');
  });
});
