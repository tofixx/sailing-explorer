import { computeTrackStats } from './domain/stats';
import { GpxError, parseGpx } from './domain/gpx';
import { METRICS, METRIC_KEYS, metricRange, type MetricDef } from './domain/metrics';
import { averageConditions, kpis } from './domain/summary';
import { nearestByTime, timeline, type TimedPoint } from './domain/timeline';
import { attachConditions } from './domain/weather';
import { median } from './domain/geo';
import type { MetricKey, Track, TrackPoint } from './domain/types';
import { MapView } from './map/map-view';
import { ApiError, api } from './services/api';
import { inflateFromBase64Url } from './services/compress';
import { fetchTrackFile } from './services/samples';
import { Store, initialState, visibleTracks, type HoverSource, type Layers, type State } from './services/store';
import { parseRoute, parseView, routePath, serializeView } from './services/url-state';
import { loadWeather } from './services/weather-api';
import { workspace } from './services/workspace';
import { SessionController, errorText } from './controllers/session';
import type { ImageContent, ImageFormat } from './services/share-image';
import { fmtNum, fmtShort } from './util/html';
import type { AccountTab, SxAccountDialog } from './components/sx-account-dialog';
import type { ChartSeries, SxTimeChart } from './components/sx-time-chart';
import type { SxConditions } from './components/sx-conditions';
import type { SxDiscover } from './components/sx-discover';
import type { SxEmptyState } from './components/sx-empty-state';
import type { SxKpis } from './components/sx-kpis';
import type { SxLoginDialog } from './components/sx-login-dialog';
import type { SxMetricPicker } from './components/sx-metric-picker';
import type { SxProfilePage } from './components/sx-profile-page';
import type { SxShareDialog } from './components/sx-share-dialog';
import type { SxToast } from './components/sx-toast';
import type { SxTopbar } from './components/sx-topbar';
import type { SxTrackList } from './components/sx-track-list';

/** Identitätsfarben der Tracks als Token-Namen (aufgelöst in Karte und Liste). */
const TRACK_COLORS = ['--c-track-1', '--c-track-2', '--c-track-3', '--c-track-4', '--c-track-5', '--c-track-6'];

const SAMPLES = [
  { file: '20260613_Stralsund_Prerow', label: 'Stralsund → Prerow' },
  { file: '20260614_Prerow_Rostock', label: 'Prerow → Rostock' },
];

interface RawItem {
  name: string;
  text: string;
}

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

/** Diagrammreihe aus der Metrik-Definition – Label, Farbe und Nachkommastellen nur an einer Stelle. */
const series = (m: MetricDef, axis: 'left' | 'right', value: (p: TrackPoint) => number | null, extra: Partial<ChartSeries> = {}): ChartSeries => ({
  key: m.key, label: m.short, unit: m.unit, colorVar: m.colorVar, decimals: m.decimals, axis, value, ...extra,
});

/**
 * Verdrahtung der Kartenansicht: hält den Store, übersetzt Komponenten-Events in Aktionen und
 * Zustandsänderungen in Properties. Konto und Teilen liegen im SessionController.
 */
export class App {
  private store = new Store(initialState);
  private map: MapView;
  private ui = {
    app: $<HTMLElement>('.app'),
    topbar: $<SxTopbar>('sx-topbar'),
    empty: $<SxEmptyState>('sx-empty-state'),
    page: $<SxProfilePage>('sx-profile-page'),
    discoverStrip: $<SxDiscover>('sx-discover[slot="discover"]'),
    discoverPage: $<SxDiscover>('#discover-page'),
    conditions: $<SxConditions>('sx-conditions'),
    conditionsCtx: $<HTMLElement>('#conditions-ctx'),
    metric: $<SxMetricPicker>('sx-metric-picker'),
    kpis: $<SxKpis>('sx-kpis'),
    weatherChart: $<SxTimeChart>('#weather-chart'),
    speedChart: $<SxTimeChart>('#speed-chart'),
    chartsPanel: $<HTMLElement>('#charts-panel'),
    weatherWrap: $<HTMLElement>('#weather-wrap'),
    trackList: $<SxTrackList>('sx-track-list'),
    tracksAside: $<HTMLButtonElement>('#tracks-aside'),
    toast: $<SxToast>('sx-toast'),
    login: $<SxLoginDialog>('sx-login-dialog'),
    share: $<SxShareDialog>('sx-share-dialog'),
    account: $<SxAccountDialog>('sx-account-dialog'),
  };
  private session: SessionController;
  private timelinePts: TimedPoint[] = [];

  constructor() {
    this.map = new MapView($('#map'), { onHover: (p) => this.hover(p, 'map') });
    this.session = new SessionController(this.store, {
      login: this.ui.login,
      share: this.ui.share,
      account: this.ui.account,
      toast: (msg, ms) => this.toast(msg, ms),
    });
    this.ui.empty.samples = SAMPLES;
    if (new URLSearchParams(location.search).has('embed')) this.ui.app.setAttribute('data-embed', '');
    this.store.subscribe((s, prev) => this.render(s, prev));
    this.wire();
    this.render(this.store.get(), null);
  }

  async start(): Promise<void> {
    this.session.checkBackend();
    this.handleSupportParam();
    const route = parseRoute(location);
    // Community-Leiste nur auf der Startseite; lädt nebenbei und blockiert nichts.
    if (route.kind === 'home' || route.kind === 'login') void this.loadDiscoverStrip();
    try {
      switch (route.kind) {
        case 'share':
          return await this.openShare(route.id, route.key);
        case 'profile':
        case 'boat':
        case 'discover':
          return await this.openPage(route);
        case 'login':
          history.replaceState(null, '', '/');
          await this.restoreWorkspace();
          if (route.token) await this.session.beginLogin(route.token);
          return;
        case 'files':
          return await this.openFiles(route.names);
        case 'inline':
          return await this.openInline(route.data);
        default:
          return await this.restoreWorkspace();
      }
    } catch (e) {
      this.setLoading(null);
      this.toast(errorText(e));
    }
  }

  /**
   * ?support=success|cancel (Rückkehr von Stripe) bzw. ?support=open (Erinnerungsmail):
   * Parameter sofort entfernen, damit Neuladen oder Teilen der Adresse ihn nicht wiederholt.
   */
  private handleSupportParam() {
    const url = new URL(location.href);
    const kind = url.searchParams.get('support');
    if (kind === null) return;
    url.searchParams.delete('support');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (kind === 'success' || kind === 'cancel' || kind === 'open') void this.session.supportReturn(kind);
  }

  // ---------------------------------------------------------------- Rendering

  /** prev = null rendert alles (erster Aufruf). */
  private render(s: State, prev: State | null) {
    const changed = <K extends keyof State>(k: K) => !prev || s[k] !== prev[k];
    const dataChanged = changed('tracks') || changed('weather');
    const vis = visibleTracks(s);
    const has = s.tracks.length > 0;

    // Startseite: ohne Tracks immer, mit Tracks auf Wunsch (Logo / „Start“) – die Tracks bleiben dabei geladen.
    const home = !has || s.home;
    this.ui.app.toggleAttribute('data-empty', home);
    this.ui.empty.hidden = !home;
    this.ui.empty.trackCount = s.tracks.length;
    Object.assign(this.ui.topbar, { user: s.user, mode: s.mode, hasTracks: has, backend: s.backend, home });
    this.ui.toast.loading = s.loading;

    if (dataChanged || changed('metric')) {
      const range = metricRange(vis, s.metric);
      this.map.render(vis, s.metric, range);
      const available = Object.fromEntries(METRIC_KEYS.map((k) => [k, vis.some((t) => t.points.some((p) => METRICS[k].get(p) != null))])) as Record<MetricKey, boolean>;
      Object.assign(this.ui.metric, { metric: s.metric, range, available });
    }
    if (changed('layers')) {
      this.map.setLayers(s.layers);
      this.ui.metric.layers = s.layers;
    }
    if (dataChanged) {
      this.timelinePts = timeline(vis);
      this.ui.kpis.items = kpis(vis);
      this.ui.trackList.tracks = s.tracks;
      this.ui.trackList.readonly = s.mode.kind !== 'local';
      this.ui.tracksAside.textContent = s.mode.kind === 'local' ? 'Alle entfernen' : 'Schließen';
      this.renderCharts(s);
    }
    if (dataChanged || changed('hover') || changed('status')) this.renderHover(s);
    if (prev && (changed('metric') || changed('layers')) && s.mode.kind === 'share') {
      // Schlüssel („Nur mit Link“) bleibt in der Adresse, sonst wäre der Link nach dem Kopieren tot.
      history.replaceState(null, '', `${routePath('s', s.mode.share.id, s.mode.key)}?${serializeView(s.metric, s.layers)}`);
    }
  }

  private renderCharts(s: State) {
    const pts = this.timelinePts;
    this.ui.chartsPanel.hidden = pts.length < 2;
    if (pts.length < 2) return;

    const waveOk = !!s.weather?.waveOk;
    const hasWeather = !!s.weather && pts.some((p) => p.wx);
    this.ui.weatherWrap.hidden = !hasWeather;
    if (hasWeather) {
      Object.assign(this.ui.weatherChart, {
        points: pts,
        left: { unit: 'kn', colorVar: METRICS.wind.colorVar, minMax: 12, step: 5 },
        right: waveOk ? { unit: 'm', colorVar: METRICS.wave.colorVar, minMax: 2, step: 0.5 } : null,
        series: [
          series(METRICS.wind, 'left', METRICS.wind.get, { fill: true }),
          series(METRICS.gust, 'left', METRICS.gust.get, { width: 1.5 }),
          ...(waveOk ? [series(METRICS.wave, 'right', METRICS.wave.get)] : []),
        ],
      });
    }

    const speeds = pts.map((p) => p.speedSmooth).filter((v): v is number => v != null).sort((a, b) => a - b);
    const med = median(speeds);
    Object.assign(this.ui.speedChart, {
      points: pts,
      left: { unit: 'kn', colorVar: METRICS.speed.colorVar, minMax: 4, step: 2 },
      right: null,
      series: [series(METRICS.speed, 'left', (p) => p.speedSmooth, { label: 'Fahrt (geglättet, ohne GPS-Ausreißer)', fill: true })],
      refLine: speeds.length ? { value: med, label: `Median ${fmtNum(med, 1)} kn`, colorVar: '--c-median', axis: 'left' } : null,
    });
  }

  private renderHover(s: State) {
    const h = s.hover;
    const p = h?.point ?? null;
    if (p) {
      const sp = METRICS.speed.get(p);
      this.ui.conditionsCtx.textContent = `${p.time != null ? fmtShort(p.time) : 'ohne Zeit'} · ${sp != null ? fmtNum(sp, 1) + ' kn' : '–'}`;
      this.ui.conditions.conditions = p.wx;
    } else {
      this.ui.conditionsCtx.textContent = s.weather ? 'Ø Reise' : '';
      this.ui.conditions.conditions = averageConditions(visibleTracks(s));
    }
    this.ui.conditions.status = s.status;
    const t = p?.time ?? null;
    this.ui.weatherChart.hoverTime = t;
    this.ui.speedChart.hoverTime = t;
    const fromKpi = h?.source === 'kpi';
    this.map.showHover(p, { emphasize: fromKpi, pan: fromKpi });
  }

  // ---------------------------------------------------------------- Events

  private wire() {
    const on = <T>(name: string, fn: (detail: T) => void) => document.addEventListener(name, (e) => fn((e as CustomEvent<T>).detail));
    const s = this.session;

    // Tracks & Karte
    on<FileList>('sx-files', (files) => this.addFiles(files));
    on<string>('sx-sample', (file) => this.loadSample(file));
    on<MetricKey>('sx-metric', (metric) => this.store.set({ metric }));
    on<Layers>('sx-layers', (layers) => this.store.set({ layers }));
    on<TrackPoint | null>('sx-kpi-hover', (p) => this.hover(p, 'kpi'));
    on<number | null>('sx-hover-time', (t) => {
      const i = t == null ? -1 : nearestByTime(this.timelinePts, t);
      this.hover(i >= 0 ? this.timelinePts[i] : null, 'chart');
    });
    on<string>('sx-track-toggle', (id) => this.updateTracks(this.store.get().tracks.map((t) => (t.id === id ? { ...t, hidden: !t.hidden } : t))));
    on<string>('sx-track-remove', (id) => this.updateTracks(this.store.get().tracks.filter((t) => t.id !== id)));
    this.ui.tracksAside.addEventListener('click', () => this.clearAll());
    this.wireDragDrop();

    // Startseite ↔ Törn-Ansicht
    on('sx-home', () => {
      this.store.set({ home: true, hover: null });
      // z. B. aus einer geteilten Ansicht: Community-Leiste nachladen
      if (!this.ui.discoverStrip.data) void this.loadDiscoverStrip();
    });
    on('sx-track-view', () => {
      this.store.set({ home: false });
      this.map.fit(visibleTracks(this.store.get()));
    });

    // Konto & Teilen
    on('sx-share', () => s.share());
    on('sx-login', () => s.openLogin());
    on<AccountTab | undefined>('sx-account', (tab) => s.openAccount(tab));
    on<'login' | 'share' | 'account'>('sx-close', (which) => (this.ui[which].open = false));
    on<{ email: string; turnstile: string | null }>('sx-login-submit', (d) => s.requestLink(d.email, d.turnstile));
    on('sx-login-reset', () => s.resetLogin());
    on('sx-login-confirm', () => s.confirmLogin());
    on('sx-login-for-share', () => s.loginForShare());
    on('sx-share-inline', () => s.shareInlineLink());
    on<{ format: ImageFormat; content: ImageContent }>('sx-image-options', (d) => s.setImageOptions(d.format, d.content));
    on('sx-image-download', () => s.downloadImage());
    on('sx-image-share', () => s.shareImage());
    on<Parameters<SessionController['upload']>[0]>('sx-share-submit', (d) => s.upload(d));
    on('sx-support-check', () => s.checkSupport());
    on<{ amount: number }>('sx-support-checkout', (d) => s.checkout(d.amount));
    on<string>('sx-share-open', (id) => location.assign(`/s/${id}`));
    on<string>('sx-share-copy', (id) => s.copyShare(id));
    on<string>('sx-link-copy', (path) => s.copyPath(path));
    on<{ id: string; patch: Parameters<SessionController['updateShare']>[1] }>('sx-share-update', (d) => s.updateShare(d.id, d.patch));
    on<string>('sx-share-delete', (id) => s.deleteShare(id));
    on<Parameters<SessionController['saveProfile']>[0]>('sx-profile-save', (p) => s.saveProfile(p));
    on<{ id: string | null; input: Parameters<SessionController['saveBoat']>[1] }>('sx-boat-save', (d) => s.saveBoat(d.id, d.input));
    on<string>('sx-boat-delete', (id) => s.deleteBoat(id));
    on('sx-logout', () => s.logout());
    on('sx-account-delete', () => s.deleteAccount());
  }

  private wireDragDrop() {
    let depth = 0;
    const reset = () => {
      depth = 0;
      this.ui.empty.dragging = false;
    };
    document.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      depth++;
      this.ui.empty.dragging = true;
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('dragleave', () => --depth <= 0 && reset());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      reset();
      if (e.dataTransfer?.files.length) this.addFiles(e.dataTransfer.files);
    });
  }

  private hover(p: TrackPoint | null, source: HoverSource) {
    const cur = this.store.get().hover;
    if (cur?.point === p && cur?.source === source) return;
    this.store.set({ hover: p ? { point: p, source } : null });
  }

  // ---------------------------------------------------------------- Tracks

  private async restoreWorkspace() {
    const ws = await workspace.load();
    if (!ws?.tracks.length) return;
    const tracks = this.build(ws.tracks.map((t) => ({ name: t.name, text: t.gpx })));
    ws.tracks.forEach((w, i) => tracks[i] && (tracks[i].hidden = w.hidden));
    if (!tracks.length) return;
    await this.setTracks(tracks, { mode: { kind: 'local' }, fit: true });
    this.toast(`Gast-Sitzung wiederhergestellt: ${tracks.length} Track${tracks.length > 1 ? 's' : ''}`);
  }

  private build(items: RawItem[], offset = 0): Track[] {
    const out: Track[] = [];
    for (const it of items) {
      try {
        const g = parseGpx(it.text, it.name);
        out.push({
          id: localId(),
          name: g.name,
          raw: it.text,
          points: g.points,
          stats: computeTrackStats(g.points),
          color: TRACK_COLORS[(offset + out.length) % TRACK_COLORS.length],
          hidden: false,
        });
      } catch (e) {
        this.toast(`${it.name}: ${e instanceof GpxError ? e.message : 'konnte nicht gelesen werden'}`);
      }
    }
    return out;
  }

  private async addFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => /\.gpx$/i.test(f.name) || /xml/.test(f.type));
    if (!files.length) return this.toast('Keine GPX-Dateien gefunden');
    this.setLoading('Lese Dateien …');
    const items = await Promise.all(files.map(async (f) => ({ name: f.name.replace(/\.gpx$/i, ''), text: await f.text() })));
    await this.addItems(items);
  }

  /** Neue Tracks kommen immer in den eigenen Arbeitsbereich (auch aus einer geteilten Ansicht heraus). */
  private async addItems(items: RawItem[]) {
    const s = this.store.get();
    const fresh = this.build(items, s.tracks.length);
    if (!fresh.length) return this.setLoading(null);
    if (s.mode.kind !== 'local' || this.ui.app.hasAttribute('data-page')) history.pushState(null, '', '/');
    this.leavePage();
    await this.setTracks([...s.tracks, ...fresh], { mode: { kind: 'local' }, fit: true });
    this.toast(`${fresh.length} Track${fresh.length > 1 ? 's' : ''} geladen`);
  }

  private async loadSample(file: string) {
    this.setLoading('Lade Beispiel …');
    try {
      await this.addItems([await fetchTrackFile(file)]);
    } catch (e) {
      this.setLoading(null);
      this.toast(`Beispiel konnte nicht geladen werden: ${errorText(e)}`);
    }
  }

  /** Setzt Tracks, speichert den Arbeitsbereich und lädt Wetter nach. */
  private async setTracks(tracks: Track[], opts: { mode: State['mode']; fit: boolean }) {
    this.store.set({ tracks, mode: opts.mode, home: false, hover: null, weather: null, status: { level: 'loading', text: 'Lade Wind- und Wellendaten …' }, loading: null });
    if (opts.fit) this.map.fit(tracks);
    this.persist();
    if (!tracks.length) return this.store.set({ status: initialState.status });
    this.setLoading('Lade Wetterdaten …');
    const { data, status } = await loadWeather(tracks);
    // Inzwischen geänderte Trackliste? Dann gilt das Ergebnis nicht mehr.
    if (this.store.get().tracks !== tracks) return;
    attachConditions(tracks, data);
    this.store.set({ weather: data, status, loading: null, tracks: [...tracks] });
  }

  private updateTracks(tracks: Track[]) {
    if (!tracks.length) return this.clearAll();
    const removed = tracks.length < this.store.get().tracks.length;
    this.store.set({ tracks, hover: null });
    if (removed) this.map.fit(visibleTracks(this.store.get()));
    this.persist();
  }

  private clearAll() {
    const wasLocal = this.store.get().mode.kind === 'local';
    this.store.set({ tracks: [], weather: null, hover: null, status: initialState.status, mode: { kind: 'local' } });
    if (wasLocal) return this.persist();
    history.pushState(null, '', '/');
    this.restoreWorkspace();
  }

  private persist() {
    const s = this.store.get();
    if (s.mode.kind !== 'local') return;
    workspace.save(s.tracks.map((t) => ({ id: t.id, name: t.name, gpx: t.raw, hidden: t.hidden })));
  }

  // ---------------------------------------------------------------- Links & Seiten

  private async openShare(id: string, key?: string) {
    this.setLoading('Lade geteilten Törn …');
    try {
      const [{ share }, payload] = await Promise.all([api.shareMeta(id, key), api.shareData(id, key)]);
      const tracks = this.build(payload.tracks.map((t) => ({ name: t.name, text: t.gpx })));
      const view = { ...parseView(share.view), ...parseView(location.search.slice(1)) };
      this.store.set({ metric: view.metric ?? this.store.get().metric, layers: view.layers ?? this.store.get().layers });
      document.title = `${share.title} · Sail Explorer`;
      await this.setTracks(tracks, { mode: key ? { kind: 'share', share, key } : { kind: 'share', share }, fit: true });
    } catch (e) {
      this.setLoading(null);
      this.toast(e instanceof ApiError && e.status === 404 ? 'Diese Freigabe gibt es nicht (mehr) – oder sie ist privat.' : errorText(e), 6000);
      history.replaceState(null, '', '/');
      await this.restoreWorkspace();
    }
  }

  /** Profil-, Boots- oder Entdecken-Seite statt Karte. */
  private async openPage(route: { kind: 'profile'; handle: string; key?: string } | { kind: 'boat'; id: string; key?: string } | { kind: 'discover' }) {
    this.ui.app.setAttribute('data-page', '');
    if (route.kind === 'discover') return this.openDiscover();
    const page = this.ui.page;
    page.hidden = false;
    Object.assign(page, { loading: true, error: '', data: null });
    try {
      if (route.kind === 'profile') {
        const d = await api.profile(route.handle, route.key);
        page.data = { kind: 'profile', ...d };
        document.title = `${d.profile.displayName} · Sail Explorer`;
      } else {
        const d = await api.boat(route.id, route.key);
        page.data = { kind: 'boat', ...d };
        document.title = `${d.boat.name} · Sail Explorer`;
      }
    } catch (e) {
      page.error = e instanceof ApiError && e.status === 404 ? 'Diese Seite gibt es nicht oder sie ist privat.' : errorText(e);
    } finally {
      page.loading = false;
    }
  }

  /** Seite /entdecken: neueste öffentliche Törns, Boote und Segler. */
  private async openDiscover() {
    const page = this.ui.discoverPage;
    page.hidden = false;
    Object.assign(page, { loading: true, error: '', data: null });
    document.title = 'Entdecken · Sail Explorer';
    try {
      page.data = await api.discover(24);
    } catch (e) {
      page.error = e instanceof ApiError && e.code === 'no_backend' ? 'Entdecken ist auf dieser Installation nicht verfügbar.' : errorText(e);
    } finally {
      page.loading = false;
    }
  }

  /** Community-Leiste im Einstieg – immer sichtbar, wenn der Server antwortet (auch leer mit Einladung); ohne Backend oder bei Fehlern unsichtbar. */
  private async loadDiscoverStrip() {
    const strip = this.ui.discoverStrip;
    try {
      const data = await api.discover(6);
      strip.data = data;
      strip.hidden = false;
    } catch {
      strip.hidden = true;
    }
  }

  /** Zurück von Profil-/Boots-/Entdecken-Seite zur Kartenansicht. */
  private leavePage() {
    if (!this.ui.app.hasAttribute('data-page')) return;
    this.ui.app.removeAttribute('data-page');
    this.ui.page.hidden = true;
    this.ui.discoverPage.hidden = true;
    document.title = 'Sail Explorer';
  }

  private async openFiles(names: string[]) {
    this.setLoading('Lade Track-Dateien …');
    const items: RawItem[] = [];
    for (const n of names) {
      try {
        items.push(await fetchTrackFile(n));
      } catch (e) {
        this.toast(`„${n}“ konnte nicht geladen werden: ${errorText(e)}`, 6000);
      }
    }
    const tracks = this.build(items);
    if (!tracks.length) return this.setLoading(null);
    await this.setTracks(tracks, { mode: { kind: 'link', title: tracks.map((t) => t.name).join(', ') }, fit: true });
  }

  /** Alte Links (#g=…) mit eingebetteten GPX-Daten. */
  private async openInline(data: string) {
    this.setLoading('Lade geteilten Track …');
    const raws = JSON.parse(await inflateFromBase64Url(data)) as unknown;
    if (!Array.isArray(raws) || raws.length > 20 || !raws.every((r) => typeof r === 'string')) throw new Error('Link ist beschädigt');
    const tracks = this.build(raws.map((text, i) => ({ name: `Geteilter Track ${i + 1}`, text })));
    if (!tracks.length) return this.setLoading(null);
    await this.setTracks(tracks, { mode: { kind: 'link', title: 'Geteilter Track' }, fit: true });
  }

  // ---------------------------------------------------------------- Helfer

  private setLoading(text: string | null) {
    this.store.set({ loading: text });
  }

  private toast(msg: string, ms?: number) {
    this.ui.toast.show(msg, ms);
  }
}

/** crypto.randomUUID gibt es nur in sicheren Kontexten – im LAN-Test (http://192.168…) nicht. */
function localId(): string {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
