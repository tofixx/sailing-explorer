import { computeTrackStats } from './domain/stats';
import { GpxError, parseGpx } from './domain/gpx';
import { METRICS, METRIC_KEYS, metricRange, type MetricDef } from './domain/metrics';
import { averageConditions, kpis } from './domain/summary';
import { nearestByTime, timeline, type TimedPoint } from './domain/timeline';
import { attachConditions, parseWeatherData, type WeatherData } from './domain/weather';
import { median } from './domain/geo';
import type { MetricKey, Track, TrackPoint } from './domain/types';
import { MapView } from './map/map-view';
import { ApiError, api, coverApi, type CoverKind, type PageMedia } from './services/api';
import { PhotoError, processCover } from './services/photo-process';
import type { SxCover } from './components/sx-page-media';
import { inflateFromBase64Url } from './services/compress';
import { fetchTrackFile } from './services/samples';
import { Store, initialState, visibleTracks, type HoverSource, type Layers, type State } from './services/store';
import { parseRoute, parseView, routePath, serializeView } from './services/url-state';
import { loadWeather, storedWeatherStatus } from './services/weather-api';
import { workspace } from './services/workspace';
import { SessionController, errorText } from './controllers/session';
import type { ImageContent, ImageFormat } from './services/share-image';
import { fmtNum, fmtShort } from './util/html';
import type { AccountTab, SxAccountDialog } from './components/sx-account-dialog';
import type { ChartSeries, SxTimeChart } from './components/sx-time-chart';
import type { SxConditions } from './components/sx-conditions';
import type { SxCrew } from './components/sx-crew';
import type { SxInviteDialog } from './components/sx-invite-dialog';
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
// ---- Kommentare & Melden (Phase D) ----
import { CommunityController } from './controllers/community';
import type { SxComments } from './components/sx-comments';
import type { ReportTarget, SxReportDialog } from './components/sx-report-dialog';
import type { AdminAction } from './services/api';
import type { CommentsMode, NotifyMode, ReportReason } from './domain/comment-text';
// ---- Fotos (Phase C) ----
import { PhotosController } from './controllers/photos';
import type { SxPhotoStrip } from './components/sx-photo-strip';
import type { SxPhotoLightbox } from './components/sx-photo-lightbox';
import type { SxPhotoUpload } from './components/sx-photo-upload';
import type { Photo } from './services/api';
import type { PhotoVisibility } from './domain/visibility';
// ---- Vereine, Teams, Folgen, Neuigkeiten (Konzept 11) ----
import { GroupsController } from './controllers/groups';
import type { SxGroupPage } from './components/sx-group-page';
import type { SxHomeFeed } from './components/sx-home-feed';
import type { FollowKind, GroupInput } from './services/api';
// ---- Verein, Hafen, Team und Reaktionen (Konzept 12) ----
import { SocialController } from './controllers/social';
import type { SxLegalPage } from './components/sx-legal-page';
import type { ReactDetail, SxReactions } from './components/sx-reactions';
import type { HarborChoice, SxHarborPicker } from './components/sx-harbor-picker';
import type { HarborPatch, StreamFilter } from './services/api';
import type { ReactionSubject } from './domain/reactions';
// ---- Benachrichtigungen (Konzept 17) ----
import { NotificationsController } from './controllers/notifications';
import type { SxNotifications } from './components/sx-notifications';
import type { NotificationItem } from './services/api';
import type { Channel, ChoosableKind } from './domain/notifications';
import { disablePush, enablePush, pushKey } from './services/push';

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
    invite: $<SxInviteDialog>('sx-invite-dialog'),
    crew: $<SxCrew>('sx-crew'),
    crewPanel: $<HTMLElement>('#crew-panel'),
    comments: $<SxComments>('sx-comments'),
    commentsPanel: $<HTMLElement>('#comments-panel'),
    report: $<SxReportDialog>('sx-report-dialog'),
    photoStrip: $<SxPhotoStrip>('sx-photo-strip'),
    photosPanel: $<HTMLElement>('#photos-panel'),
    lightbox: $<SxPhotoLightbox>('sx-photo-lightbox'),
    photoUpload: $<SxPhotoUpload>('sx-photo-upload'),
    groupPage: $<SxGroupPage>('sx-group-page'),
    homeFeed: $<SxHomeFeed>('sx-home-feed'),
    legalPage: $<SxLegalPage>('sx-legal-page'),
    shareReactions: $<SxReactions>('#share-reactions'),
    reactionsPanel: $<HTMLElement>('#reactions-panel'),
    notifications: $<SxNotifications>('sx-notifications'),
  };
  private session: SessionController;
  private community: CommunityController;
  private photos: PhotosController;
  private groups: GroupsController;
  private social: SocialController;
  private notifications: NotificationsController;
  /** Startseite als Einstieg (nicht Profil-, Boots-, Gruppen- oder Entdecken-Seite) – nur dort lädt die Startseite Neuigkeiten */
  private homeRoute = false;
  private timelinePts: TimedPoint[] = [];

  constructor() {
    this.map = new MapView($('#map'), { onHover: (p) => this.hover(p, 'map') });
    this.session = new SessionController(this.store, {
      login: this.ui.login,
      share: this.ui.share,
      account: this.ui.account,
      invite: this.ui.invite,
      crew: this.ui.crew,
      crewPanel: this.ui.crewPanel,
      toast: (msg, ms) => this.toast(msg, ms),
    });
    this.community = new CommunityController(this.store, {
      comments: this.ui.comments,
      commentsPanel: this.ui.commentsPanel,
      report: this.ui.report,
      account: this.ui.account,
      toast: (msg, ms) => this.toast(msg, ms),
      openLogin: (reason) => this.session.openLogin(reason),
    });
    this.photos = new PhotosController(this.store, {
      strip: this.ui.photoStrip,
      panel: this.ui.photosPanel,
      lightbox: this.ui.lightbox,
      upload: this.ui.photoUpload,
      layer: this.map.photos,
      toast: (msg, ms) => this.toast(msg, ms),
      openLogin: (reason) => this.session.openLogin(reason),
      openSupport: () => this.session.openAccount('shares'),
      onPhotos: (photos) => this.setPhotoMarks(photos),
    });
    this.map.photos.callbacks = { onOpen: (id) => this.photos.open(id), onHover: (id) => this.photoHover(id) };
    this.groups = new GroupsController(this.store, {
      page: this.ui.groupPage,
      home: this.ui.homeFeed,
      profile: this.ui.page,
      toast: (msg, ms) => this.toast(msg, ms),
      openLogin: (reason) => this.session.openLogin(reason),
      // Startseite: Stream groß, „Track anlegen“ kompakt (Konzept 12.6)
      onCommunity: (visible) => (this.ui.empty.community = visible),
      ready: () => this.session.backendReady,
    });
    this.social = new SocialController(this.store, {
      page: this.ui.page,
      home: this.ui.homeFeed,
      groupPage: this.ui.groupPage,
      account: this.ui.account,
      shareReactions: this.ui.shareReactions,
      reactionsPanel: this.ui.reactionsPanel,
      lightbox: this.ui.lightbox,
      toast: (msg, ms) => this.toast(msg, ms),
      openLogin: (reason) => this.session.openLogin(reason),
    });
    this.notifications = new NotificationsController(this.store, {
      panel: this.ui.notifications,
      badge: (label) => (this.ui.topbar.bell = label),
      expanded: (open, focus) => {
        this.ui.topbar.bellOpen = open;
        if (focus) (this.ui.topbar.shadowRoot?.querySelector('[data-bell]') as HTMLElement | null)?.focus();
      },
      navigate: (href) => location.assign(href),
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
    void this.handleAccountParam();
    const route = parseRoute(location);
    // Community-Leiste nur auf der Startseite; lädt nebenbei und blockiert nichts.
    this.homeRoute = route.kind === 'home' || route.kind === 'login' || route.kind === 'invite';
    if (this.homeRoute) void this.loadDiscoverStrip();
    if (this.homeRoute) void this.groups.loadHome();
    try {
      switch (route.kind) {
        case 'share':
          return await this.openShare(route.id, route.key);
        case 'profile':
        case 'boat':
        case 'discover':
        case 'group':
        case 'group-new':
        case 'harbor':
        case 'legal':
          return await this.openPage(route);
        case 'login':
          history.replaceState(null, '', '/');
          await this.restoreWorkspace();
          if (route.token) await this.session.beginLogin(route.token);
          return;
        case 'invite':
          // Token aus der Adresse entfernen (Verlauf, Teilen der Adresse), dann Einladung zeigen.
          history.replaceState(null, '', '/');
          await this.restoreWorkspace();
          if (route.token) await this.session.openInvite(route.token);
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

  /**
   * ?konto=einstellungen (Mail „Neuer Passkey“) bzw. ?konto=einladungen (Glocke: Einladung an mich): Konto öffnen,
   * Parameter entfernen.
   */
  private async handleAccountParam() {
    const url = new URL(location.href);
    const which = url.searchParams.get('konto');
    if (which !== 'einstellungen' && which !== 'einladungen') return;
    url.searchParams.delete('konto');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    await this.session.backendReady;
    void this.openAccount(which === 'einstellungen' ? 'settings' : undefined);
  }

  /** Konto öffnen; zeigt es „Einladungen an dich“, sind die Benachrichtigungen dazu gelesen (F-253). */
  private async openAccount(tab?: AccountTab) {
    void pushKey().then((k) => (this.ui.account.pushAvailable = !!k));
    await this.session.openAccount(tab);
    if (this.ui.account.myInvites.length) this.notifications.seen({ kind: 'invite' });
  }

  /**
   * Kanal einer Benachrichtigungsart wählen (Konzept 17.6). „Push“ meldet erst dieses Gerät an (Erlaubnis); steht danach
   * keine Art mehr auf Push, wird das Gerät wieder abgemeldet.
   */
  private async setChannel(kind: ChoosableKind, channel: Channel) {
    const account = this.ui.account;
    if (channel === 'push') {
      const r = await enablePush().catch(() => 'unsupported' as const);
      if (r !== 'ok') {
        this.toast(r === 'denied' ? 'Mitteilungen sind für diese Seite blockiert – erlaube sie in den Browser-Einstellungen.' : 'Push ist auf diesem Gerät nicht möglich.', 6000);
        if (account.settings) account.settings = { ...account.settings }; // Auswahl zurücksetzen
        return;
      }
    }
    await this.community.saveSettings({ notify: { [kind]: channel } });
    const notify = account.settings?.notify;
    if (channel !== 'push' && notify && !Object.values(notify).includes('push')) await disablePush().catch(() => undefined);
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
    Object.assign(this.ui.topbar, { user: s.user, mode: s.mode, hasTracks: has, backend: s.backend, home, saved: s.saved });
    // Neuigkeiten auf der Startseite und Rollen auf der Gruppenseite hängen an der Anmeldung (Konzept 11.5).
    if (changed('user') || changed('backend')) {
      this.ui.page.signedIn = !!s.user;
      if (prev) {
        if (this.homeRoute) void this.groups.loadHome(true);
        void this.groups.userChanged();
        void this.social.userChanged();
      }
      // Glocke: Zähler nach Anmeldung bzw. Abmeldung (Konzept 17)
      void this.notifications.refresh(true);
    }
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
    // Crew des geteilten Törns – neu laden bei anderem Törn oder anderer Anmeldung (Eigentümer verwaltet).
    if (changed('mode') || changed('user')) {
      if (s.mode.kind === 'share') void this.session.loadCrew(s.mode.share, s.mode.key);
      else this.session.hideCrew();
      // Kommentare des geteilten Törns (Phase D)
      if (s.mode.kind === 'share' && s.backend) void this.community.loadComments(s.mode.share, s.mode.key);
      else this.community.hideComments();
      // Fotos des geteilten Törns (Phase C)
      if (s.mode.kind === 'share' && s.backend) void this.photos.load(s.mode.share, s.mode.key);
      else this.photos.hide();
      // Reaktionen auf den Törn (Konzept 12.5)
      if (s.mode.kind === 'share' && s.backend) void this.social.loadShare(s.mode.share, s.mode.key);
      else this.social.hideShare();
      // Törn geöffnet (auch über den Link aus der Kommentar-Mail): Kommentare und Reaktionen dazu gelesen (F-253)
      if (s.mode.kind === 'share') this.notifications.viewing({ subjectKind: 'share', subjectId: s.mode.share.id });
      else if (prev?.mode.kind === 'share') this.notifications.viewing(null);
    }
    // Hover auf Track, Diagramm oder Kennzahl hebt das zeitlich nächste Foto hervor (Konzept 3.3).
    if (changed('hover') && s.hover?.source !== 'photo') {
      const near = this.photos.nearestTo(s.hover?.point.time ?? null);
      this.photos.highlight(near?.id ?? null);
      this.setActiveMark(near?.id ?? null);
    }
    if (prev && (changed('metric') || changed('layers')) && s.mode.kind === 'share') {
      // Schlüssel („Nur mit Link“) bleibt in der Adresse, sonst wäre der Link nach dem Kopieren tot.
      history.replaceState(null, '', `${routePath('s', s.mode.share.id, s.mode.key)}?${serializeView(s.metric, s.layers)}`);
    }
  }

  // ---------------------------------------------------------------- Fotos: Diagramm-Ticks und Hover-Verknüpfung

  private setPhotoMarks(photos: Photo[]) {
    const marks = photos.filter((p) => p.takenAt !== null).map((p) => ({ id: p.id, time: p.takenAt! }));
    this.ui.weatherChart.marks = marks;
    this.ui.speedChart.marks = marks;
  }

  private setActiveMark(id: string | null) {
    this.ui.weatherChart.activeMark = id;
    this.ui.speedChart.activeMark = id;
  }

  /** Hover auf ein Foto (Galerie, Karte, Lightbox) zeigt seinen Zeitpunkt überall (Prinzip Design 5). */
  private photoHover(id: string | null) {
    this.photos.highlight(id);
    this.setActiveMark(id);
    const t = id ? (this.photos.find(id)?.takenAt ?? null) : null;
    const i = t === null ? -1 : nearestByTime(this.timelinePts, t);
    const p = i >= 0 && Math.abs(this.timelinePts[i].time - t!) <= 30 * 60_000 ? this.timelinePts[i] : null;
    if (p) this.hover(p, 'photo');
    else if (this.store.get().hover?.source === 'photo') this.hover(null, 'photo');
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
    const on = <T>(name: string, fn: (detail: T, e: Event) => void) => document.addEventListener(name, (e) => fn((e as CustomEvent<T>).detail, e));
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
      this.homeRoute = true;
      void this.groups.loadHome();
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
    on<AccountTab | undefined>('sx-account', (tab) => void this.openAccount(tab));
    // ---- Benachrichtigungen (Konzept 17) ----
    on('sx-notifications', () => this.notifications.toggle());
    on<{ focus?: boolean } | undefined>('sx-notifications-close', (d) => this.notifications.close(!!d?.focus));
    on('sx-notifications-read-all', () => this.notifications.readAll());
    on<{ item: NotificationItem; newTab: boolean }>('sx-notification-open', (d) => this.notifications.open(d.item, d.newTab));
    on<{ kind: ChoosableKind; channel: Channel }>('sx-notify-channel', (d) => void this.setChannel(d.kind, d.channel));
    on<'login' | 'share' | 'account' | 'invite'>('sx-close', (which) => (which === 'invite' ? s.closeInvite() : (this.ui[which].open = false)));
    on<{ email: string; turnstile: string | null }>('sx-login-submit', (d) => s.requestLink(d.email, d.turnstile));
    on('sx-login-reset', () => s.resetLogin());
    on('sx-login-confirm', () => s.confirmLogin());
    on<{ code: string }>('sx-login-code', (d) => s.loginWithCode(d.code));
    on('sx-login-passkey', () => s.loginWithPasskey());
    on('sx-passkey-add', () => s.addPasskey());
    on<{ id: string }>('sx-passkey-remove', (d) => s.removePasskey(d.id));
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
    on<{ path: string; title: string }>('sx-page-share', (d) => s.sharePage(d.path, d.title));
    on<{ kind: CoverKind; id: string; file: File }>('sx-cover-change', (d, e) => this.changeCover(d, e));
    on<{ kind: CoverKind; id: string }>('sx-cover-remove', (d, e) => this.changeCover({ ...d, file: null }, e));
    on<{ kind: CoverKind; id: string; focusY: number; previous: number }>('sx-cover-focus', (d, e) => this.moveCover(d, e));
    on<{ id: string; patch: Parameters<SessionController['updateShare']>[1] }>('sx-share-update', (d) => s.updateShare(d.id, d.patch));
    on<string>('sx-share-delete', (id) => s.deleteShare(id));
    on<Parameters<SessionController['saveProfile']>[0]>('sx-profile-save', (p) => s.saveProfile(p));
    on<{ id: string | null; input: Parameters<SessionController['saveBoat']>[1] }>('sx-boat-save', (d) => s.saveBoat(d.id, d.input));
    on<string>('sx-boat-delete', (id) => s.deleteBoat(id));
    // Einladungen, Crew, Boots-Admins
    on('sx-invite-login', () => s.inviteLogin());
    on('sx-invite-accept', () => s.acceptInvite());
    on<{ id: string; scope: 'crew' | 'boat'; boatId?: string }>('sx-invite-revoke', (d) => s.revokeInvite(d));
    on<string>('sx-invite-copy', (url) => s.copyInvite(url));
    on<{ to: { email: string } | { handle: string } | null }>('sx-crew-invite', (d) => s.inviteCrew(d.to));
    on<{ userId: string }>('sx-crew-remove', (d) => s.removeCrew(d.userId));
    on('sx-crew-leave', () => s.leaveCrew());
    on<string>('sx-boat-admins', (id) => s.loadAdmins(id));
    on<{ boatId: string; to: { email: string } | { handle: string } }>('sx-boat-admin-invite', (d) => s.inviteAdmin(d.boatId, d.to));
    on<string>('sx-my-invite-accept', (id) => s.acceptMyInvite(id));
    on<string>('sx-my-invite-decline', (id) => s.declineMyInvite(id));
    on<{ boatId: string; userId: string }>('sx-boat-admin-remove', (d) => s.removeAdmin(d.boatId, d.userId));
    on<string>('sx-boat-leave', (id) => s.leaveBoat(id));
    on('sx-logout', () => s.logout());
    on('sx-account-delete', () => s.deleteAccount());

    // ---- Kommentare & Melden (Phase D) ----
    const c = this.community;
    on<{ body: string }>('sx-comment-post', (d) => c.postComment(d.body));
    on<{ id: string }>('sx-comment-delete', (d) => c.deleteComment(d.id));
    on<{ mode: CommentsMode }>('sx-comments-mode', (d) => c.setMode(d.mode));
    on<ReportTarget>('sx-report', (t) => c.openReport(t));
    on<{ reason: ReportReason; note: string }>('sx-report-submit', (d) => c.submitReport(d));
    on('sx-report-login', () => c.reportLogin());
    on('sx-report-close', () => c.closeReport());
    on('sx-account-opened', () => c.loadSettings());
    on<{ notifyComments: NotifyMode }>('sx-settings-save', (d) => c.saveSettings(d));
    on('sx-admin-refresh', () => c.loadReports());
    on<{ id: string; action: AdminAction }>('sx-admin-decide', (d) => c.decide(d.id, d.action));
    on<{ userId: string; suspended: boolean }>('sx-admin-suspend', (d) => c.suspend(d.userId, d.suspended));

    // ---- Fotos (Phase C) ----
    const ph = this.photos;
    on<{ id: string }>('sx-photo-open', (d) => {
      ph.open(d.id);
      void this.social.loadPhoto();
    });
    on<{ id: string | null }>('sx-photo-hover', (d) => this.photoHover(d.id));
    on('sx-photo-add', () => ph.openUpload());
    on('sx-photo-support', () => ph.support());
    on<{ index: number }>('sx-photo-nav', (d) => {
      ph.nav(d.index);
      void this.social.loadPhoto();
    });
    on('sx-photo-close', () => {
      ph.close();
      this.photoHover(null);
    });
    on<{ id: string }>('sx-photo-show', (d) => ph.showOnMap(d.id));
    on<{ id: string; caption: string; visibility: PhotoVisibility }>('sx-photo-save', (d) => ph.save(d));
    on<{ id: string }>('sx-photo-place', (d) => ph.place(d.id));
    on<{ id: string }>('sx-photo-delete', (d) => ph.remove(d.id));
    on<{ files: File[] }>('sx-photo-files', (d) => ph.addFiles(d.files));
    on<{ min: number }>('sx-photo-offset', (d) => ph.setOffset(d.min));
    on<{ key: string; caption: string }>('sx-photo-item-caption', (d) => ph.setCaption(d.key, d.caption));
    on<{ key: string }>('sx-photo-item-remove', (d) => ph.removeItem(d.key));
    on<{ visibility: PhotoVisibility }>('sx-photo-upload-visibility', (d) => ph.setVisibility(d.visibility));
    on('sx-photo-upload-submit', () => ph.submitUpload());
    on('sx-photo-upload-close', () => ph.closeUpload());

    // ---- Vereine, Teams, Folgen, Neuigkeiten (Konzept 11) ----
    const g = this.groups;
    on<GroupInput>('sx-group-create', (d) => g.create(d));
    on<{ id: string; patch: GroupInput }>('sx-group-save', (d) => g.save(d.id, d.patch));
    on<{ id: string }>('sx-group-delete', (d) => g.remove(d.id));
    on<{ id: string }>('sx-group-join', (d) => g.join(d.id));
    // Willkommens-Karte der Startseite (Konzept 14.3)
    on<{ id: string; name: string }>('sx-home-join', (d) => g.join(d.id, { name: d.name }));
    on<{ email: string | null }>('sx-friend-invite', (d) => this.social.inviteFriend(d.email));
    on<{ harbor: HarborChoice }>('sx-home-harbor', async (d) => {
      if (await so.saveHomeHarbor(d.harbor)) await g.loadHome(true);
    });
    on<{ id: string }>('sx-group-withdraw', (d) => g.withdraw(d.id));
    on<{ id: string }>('sx-group-leave', (d) => g.leave(d.id));
    on<{ id: string; userId: string; approve: boolean }>('sx-group-request', (d) => g.decide(d));
    on<{ id: string; userId: string; role: 'admin' | 'member' }>('sx-group-role', (d) => g.setRole(d));
    on<{ id: string; userId: string }>('sx-group-remove', (d) => g.removeMember(d));
    on<{ id: string; email: string | null }>('sx-group-invite', (d) => g.invite(d));
    on<{ id: string }>('sx-group-invite-revoke', (d) => g.revokeInvite(d.id));
    on<{ id: string; boatId: string }>('sx-group-boat-add', (d) => g.addBoat(d));
    on<{ id: string; boatId: string }>('sx-group-boat-remove', (d) => g.removeBoat(d));
    on<{ groupId: string; body: string; link: string }>('sx-post-create', (d) => g.createPost(d));
    on<{ id: string }>('sx-post-delete', (d) => g.deletePost(d.id));
    on<{ scope: 'home' | 'group' | 'harbor' | 'public' }>('sx-stream-more', (d) => (d.scope === 'harbor' ? this.social.moreHarbor() : g.more(d.scope)));
    on<{ kind: FollowKind; id: string; follow: boolean }>('sx-follow', (d) => g.follow(d));

    // ---- Verein, Hafen, Team und Reaktionen (Konzept 12) ----
    const so = this.social;
    on<{ filter: StreamFilter }>('sx-stream-filter', (d) => g.setFilter(d.filter));
    on<ReactDetail>('sx-react', (d) => so.react(d));
    on<{ subject: ReactionSubject; id: string; key?: string | null; el: SxReactions }>('sx-react-who', (d) => so.who(d));
    on<{ query: string; el: SxHarborPicker }>('sx-harbor-search', (d) => so.searchHarbors(d));
    on<{ id: string; patch: HarborPatch }>('sx-harbor-save', (d) => so.saveHarbor(d));
    on<{ clubId: string | null; harbor: HarborChoice }>('sx-home-save', (d) => so.saveHome(d));
    on('sx-account-opened', () => so.loadHome());
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
    await this.setTracks(tracks, { mode: { kind: 'local' }, fit: true, weather: parseWeatherData(ws.weather) });
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

  /**
   * Setzt Tracks, speichert den Arbeitsbereich und lädt Wetter – aber nur, wenn keine gespeicherten Daten
   * mitkommen (Freigabe, Gast-Sitzung). Abgerufen wird also einmal beim Einstellen, nicht bei jedem Aufruf.
   */
  private async setTracks(tracks: Track[], opts: { mode: State['mode']; fit: boolean; weather?: WeatherData | null }) {
    this.store.set({ tracks, mode: opts.mode, home: false, saved: opts.mode.kind === 'share' && !!opts.mode.share.isOwner, hover: null, weather: null, status: { level: 'loading', text: 'Lade Wind- und Wellendaten …' }, loading: null });
    if (opts.fit) this.map.fit(tracks);
    this.persist();
    if (!tracks.length) return this.store.set({ status: initialState.status });
    if (opts.weather) {
      attachConditions(tracks, opts.weather);
      return this.store.set({ weather: opts.weather, status: storedWeatherStatus(tracks, opts.weather), tracks: [...tracks] });
    }
    this.setLoading('Lade Wetterdaten …');
    const { data, status } = await loadWeather(tracks);
    // Inzwischen geänderte Trackliste? Dann gilt das Ergebnis nicht mehr.
    if (this.store.get().tracks !== tracks) return;
    attachConditions(tracks, data);
    this.store.set({ weather: data, status, loading: null, tracks: [...tracks] });
    this.persist(); // jetzt mit Wetter
  }

  private updateTracks(tracks: Track[]) {
    if (!tracks.length) return this.clearAll();
    const removed = tracks.length < this.store.get().tracks.length;
    // Entfernen ändert die Trackliste – die Freigabe passt dann nicht mehr dazu.
    this.store.set({ tracks, hover: null, saved: this.store.get().saved && !removed });
    if (removed) this.map.fit(visibleTracks(this.store.get()));
    this.persist();
  }

  private clearAll() {
    const wasLocal = this.store.get().mode.kind === 'local';
    this.store.set({ tracks: [], weather: null, hover: null, saved: false, status: initialState.status, mode: { kind: 'local' } });
    if (wasLocal) return this.persist();
    history.pushState(null, '', '/');
    this.restoreWorkspace();
  }

  private persist() {
    const s = this.store.get();
    if (s.mode.kind !== 'local') return;
    workspace.save(
      s.tracks.map((t) => ({ id: t.id, name: t.name, gpx: t.raw, hidden: t.hidden })),
      s.weather,
    );
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
      await this.setTracks(tracks, { mode: key ? { kind: 'share', share, key } : { kind: 'share', share }, fit: true, weather: payload.weather });
    } catch (e) {
      this.setLoading(null);
      this.toast(e instanceof ApiError && e.status === 404 ? 'Diese Freigabe gibt es nicht (mehr) – oder sie ist privat.' : errorText(e), 6000);
      history.replaceState(null, '', '/');
      await this.restoreWorkspace();
    }
  }

  /** Profil-, Boots- oder Entdecken-Seite statt Karte. */
  private async openPage(
    route:
      | { kind: 'profile'; handle: string; key?: string }
      | { kind: 'boat'; id: string; key?: string }
      | { kind: 'discover' }
      | { kind: 'group'; slug: string; key?: string }
      | { kind: 'group-new' }
      | { kind: 'harbor'; slug: string }
      | { kind: 'legal'; page: 'impressum' | 'datenschutz' },
  ) {
    this.ui.app.setAttribute('data-page', '');
    if (route.kind === 'discover') return this.openDiscover();
    if (route.kind === 'legal') {
      // Impressum und Datenschutz kommen aus src/content/legal.ts – ohne Backend (Konzept 12.7).
      this.ui.legalPage.page = route.page;
      this.ui.legalPage.hidden = false;
      document.title = `${route.page === 'impressum' ? 'Impressum' : 'Datenschutz'} · Sail Explorer`;
      return;
    }
    if (route.kind === 'harbor') return this.social.openHarbor(route.slug);
    if (route.kind === 'group') {
      this.community.setPageKey(route.key);
      await this.groups.openGroup(route.slug, route.key);
      // Gruppenseite geöffnet: Beitrittsanfragen dazu gelesen (F-253)
      const group = this.ui.groupPage.data?.group;
      if (group) this.notifications.viewing({ subjectKind: 'group', subjectId: group.id });
      return;
    }
    if (route.kind === 'group-new') {
      // Anmeldung abwarten (Rolle, Unterstützer-Status für geschlossene Gruppen)
      await this.session.backendReady;
      return this.groups.openCreate();
    }
    this.community.setPageKey(route.key);
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

  /** Titelbild-Felder der angezeigten Profil-, Boots- oder Gruppenseite ersetzen. */
  private patchCover(kind: CoverKind, media: PageMedia) {
    if (kind === 'g') {
      const g = this.ui.groupPage;
      if (g.data) g.data = { ...g.data, ...media };
    } else if (this.ui.page.data && this.ui.page.data.kind !== 'harbor') {
      this.ui.page.data = { ...this.ui.page.data, ...media };
    }
  }

  /**
   * Titelbild hochladen oder entfernen (Konzept 13.2): im Browser zuschneiden und neu kodieren, dann die angezeigte
   * Seite mit der neuen Adresse aktualisieren. Nach einem Upload gleich den Ausschnitt wählen lassen.
   */
  private async changeCover(d: { kind: CoverKind; id: string; file: File | null }, e: Event) {
    const el = e.composedPath()[0] as SxCover;
    el.busy = true;
    try {
      if (d.file) {
        this.patchCover(d.kind, await coverApi.put(d.kind, d.id, await processCover(d.file)));
        el.adjust();
      } else {
        await coverApi.remove(d.kind, d.id);
        this.patchCover(d.kind, { cover: null });
      }
      this.toast(d.file ? 'Titelbild gespeichert' : 'Titelbild entfernt');
    } catch (err) {
      this.toast(err instanceof PhotoError ? err.message : errorText(err), 6000);
    } finally {
      el.busy = false;
    }
  }

  /** Ausschnitt des Titelbilds speichern; schlägt es fehl, zeigt das Banner wieder den alten. */
  private async moveCover(d: { kind: CoverKind; id: string; focusY: number; previous: number }, e: Event) {
    const el = e.composedPath()[0] as SxCover;
    el.busy = true;
    try {
      this.patchCover(d.kind, await coverApi.focus(d.kind, d.id, d.focusY));
      this.toast('Ausschnitt gespeichert');
    } catch (err) {
      el.focusY = d.previous;
      this.toast(errorText(err), 6000);
    } finally {
      el.busy = false;
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
      // Anker /entdecken#vereine („Alle Vereine“)
      if (location.hash === '#vereine') requestAnimationFrame(() => page.shadowRoot?.getElementById('vereine')?.scrollIntoView());
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
      this.groups.setPublicGroups(data.groups);
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
    this.ui.groupPage.hidden = true;
    this.ui.legalPage.hidden = true;
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
