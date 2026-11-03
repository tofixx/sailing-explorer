import { METRICS, METRIC_KEYS, metricRange, type MetricDef } from './domain/metrics';
import type { VoyageRole } from './domain/crew-roles';
import { averageConditions, kpis } from './domain/summary';
import { nearestByTime, timeline, type TimedPoint } from './domain/timeline';
import { median } from './domain/geo';
import type { MetricKey, TrackPoint } from './domain/types';
import { MapView } from './map/map-view';
import { MAP_STYLES, type MapStyleId } from './domain/map-style';
import { ApiError, api, coverApi, type CoverKind, type PageMedia, type ShareMeta } from './services/api';
import { PhotoError, processCover } from './services/photo-process';
import type { SxCover } from './components/sx-page-media';
import type { SxGalleryPost } from './components/sx-gallery-post';
import { Store, initialState, visibleTracks, type HoverSource, type Layers, type State } from './services/store';
import { LOGBOOK_PATH, parseRoute, routePath, serializeView } from './services/url-state';
import { SessionController, errorText } from './controllers/session';
import { WorkspaceController, resumableDraft, toernLabel } from './controllers/workspace';
import type { SxConfirm } from './components/sx-confirm';
import type { ImageContent, ImageFormat } from './services/share-image';
import { fmtNum, fmtShort } from './util/html';
import type { AccountTab, SxAccountDialog } from './components/sx-account-dialog';
import type { ChartSeries, SxTimeChart } from './components/sx-time-chart';
import type { SxConditions } from './components/sx-conditions';
import type { SxCrew } from './components/sx-crew';
import type { SxVoyageByline } from './components/sx-voyage-byline';
import type { LogbookSave, SxLogbookForm } from './components/sx-logbook-form';
import type { SxLogbookPanel } from './components/sx-logbook-panel';
import type { SxInviteDialog } from './components/sx-invite-dialog';
import type { SxDiscover } from './components/sx-discover';
import type { SxEmptyState } from './components/sx-empty-state';
import type { SxKpis } from './components/sx-kpis';
import type { SxLoginDialog } from './components/sx-login-dialog';
import type { SxMetricPicker } from './components/sx-metric-picker';
import type { SxProfilePage } from './components/sx-profile-page';
import type { SxShareDialog } from './components/sx-share-dialog';
import type { SxToast } from './components/sx-toast';
import type { SxTopbar, TopbarSection } from './components/sx-topbar';
import type { SxTrackList } from './components/sx-track-list';
import type { NearRadius, StreamMode } from './domain/near';
// ---- Kommentare & Melden (Phase D) ----
import { CommunityController } from './controllers/community';
import type { SxComments } from './components/sx-comments';
import type { ReportTarget, SxReportDialog } from './components/sx-report-dialog';
import type { AdminAction } from './services/api';
import type { CommentsMode, NotifyMode, ReportReason } from './domain/comment-text';
// ---- Fotos (Phase C) ----
import { PhotosController } from './controllers/photos';
import { LogbookController } from './controllers/logbook';
import type { SxPhotoStrip } from './components/sx-photo-strip';
import type { SxPhotoLightbox } from './components/sx-photo-lightbox';
import type { SxPhotoUpload } from './components/sx-photo-upload';
import type { Photo } from './services/api';
import type { PhotoVisibility } from './domain/visibility';
// ---- Vereine, Teams, Folgen, Neuigkeiten (Konzept 11) ----
import { GroupsController } from './controllers/groups';
import { DiscoverController } from './controllers/discover';
import type { SxGroupPage } from './components/sx-group-page';
import type { SxHomeFeed } from './components/sx-home-feed';
import type { SxGuestSlider } from './components/sx-guest-slider';
import type { FollowKind, GroupInput } from './services/api';
// ---- Verein, Hafen, Team und Reaktionen (Konzept 12) ----
import { SocialController } from './controllers/social';
import { UnreadController } from './controllers/unread';

import { MapStyleController } from './controllers/map-style';
import type { MapStyleScope, SxMapStyle } from './components/sx-map-style';
import type { SxLegalPage } from './components/sx-legal-page';
import { RECORDING_GUIDE } from './content/recording-guide';
import type { SxAdminPage } from './components/sx-admin-page';
import type { SxLogbookPage } from './components/sx-logbook-page';
import type { SxScoringPage } from './components/sx-scoring-page';
import { suggestFromTracks } from './domain/logbook-suggest';
import type { ReactDetail, SxReactions } from './components/sx-reactions';
import type { HarborChoice, SxHarborPicker } from './components/sx-harbor-picker';
import type { HarborPatch, StreamFilter } from './services/api';
import type { ReactionSubject } from './domain/reactions';
// ---- Benachrichtigungen (Konzept 17) ----
import { NotificationsController } from './controllers/notifications';
import type { SxNotifications } from './components/sx-notifications';
import type { NotificationItem } from './services/api';
import type { Channel, ChoosableKind, NotifyLevel } from './domain/notifications';
import { disablePush, enablePush, pushKey } from './services/push';
import { ClaimController } from './controllers/claims';
import type { SxClaim } from './components/sx-claim';
import type { ClaimRequest } from './services/api';
import { PostsController } from './controllers/posts';
import { ComposeController } from './controllers/compose';
import { PollController } from './controllers/polls';
import type { PollEventDetail } from './components/sx-poll';
import { GuestSliderController } from './controllers/guest-slider';
import { PostLinkController } from './controllers/post-link';
import { PinsController } from './controllers/pins';
import type { SxComposeDialog } from './components/sx-compose-dialog';
import type { SxEventDialog } from './components/sx-event-dialog';
import type { SxEvent } from './components/sx-event';
import { EventsController } from './controllers/events';
import type { EventView, LogbookPreset, RsvpStatus } from './domain/events';
import type { EventFields } from './services/api';
import type { ComposeKind } from './components/sx-compose';
import type { ChannelPostInput, CreatedPost } from './services/api';
import type { MyPostArea, PostKind, PostVisibility, ProfilePreview, Reach } from './domain/posts';
import type { LogState } from './domain/logbook';
import type { ClaimKind } from './domain/claims';

const SAMPLES = [
  { file: '20260613_Stralsund_Prerow', label: 'Stralsund → Prerow' },
  { file: '20260614_Prerow_Rostock', label: 'Prerow → Rostock' },
];

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
  /** Navigationsnummer (F-351: veraltete Seiten setzen keinen Ort) */
  private navSeq = 0;
  /** nach einer Ort-Ansicht beim Zurück zur Karte die Tracks neu einpassen */
  private refitAfterPlace = false;
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
    mapStyle: $<SxMapStyle>('sx-map-style'),
    kpis: $<SxKpis>('sx-kpis'),
    weatherChart: $<SxTimeChart>('#weather-chart'),
    speedChart: $<SxTimeChart>('#speed-chart'),
    chartsPanel: $<HTMLElement>('#charts-panel'),
    weatherWrap: $<HTMLElement>('#weather-wrap'),
    trackList: $<SxTrackList>('sx-track-list'),
    confirm: $<SxConfirm>('sx-confirm'),
    toast: $<SxToast>('sx-toast'),
    login: $<SxLoginDialog>('sx-login-dialog'),
    share: $<SxShareDialog>('sx-share-dialog'),
    account: $<SxAccountDialog>('sx-account-dialog'),
    invite: $<SxInviteDialog>('sx-invite-dialog'),
    crew: $<SxCrew>('sx-crew'),
    byline: $<SxVoyageByline>('sx-voyage-byline'),
    crewPanel: $<HTMLElement>('#crew-panel'),
    comments: $<SxComments>('sx-comments'),
    commentsPanel: $<HTMLElement>('#comments-panel'),
    report: $<SxReportDialog>('sx-report-dialog'),
    photoStrip: $<SxPhotoStrip>('sx-photo-strip'),
    photosPanel: $<HTMLElement>('#photos-panel'),
    lightbox: $<SxPhotoLightbox>('sx-photo-lightbox'),
    photoUpload: $<SxPhotoUpload>('sx-photo-upload'),
    logbookForm: $<SxLogbookForm>('sx-logbook-form'),
    logbookPanel: $<SxLogbookPanel>('sx-logbook-panel'),
    logbookBox: $<HTMLElement>('#logbook-panel'),
    groupPage: $<SxGroupPage>('sx-group-page'),
    homeFeed: $<SxHomeFeed>('sx-home-feed'),
    legalPage: $<SxLegalPage>('sx-legal-page'),
    guidePage: $<HTMLElement>('sx-guide-page'),
    shareReactions: $<SxReactions>('#share-reactions'),
    reactionsPanel: $<HTMLElement>('#reactions-panel'),
    notifications: $<SxNotifications>('sx-notifications'),
    compose: $<SxComposeDialog>('sx-compose-dialog'),
    eventDialog: $<SxEventDialog>('sx-event-dialog'),
  };
  private session: SessionController;
  private ws: WorkspaceController;
  private community: CommunityController;
  private photos: PhotosController;
  private logbook: LogbookController;
  private groups: GroupsController;
  private discover: DiscoverController;
  private social: SocialController;
  private claims = new ClaimController((msg, ms) => this.toast(msg, ms));
  private posts = new PostsController({ page: this.ui.page, toast: (msg, ms) => this.toast(msg, ms) });
  private unread: UnreadController;
  private compose: ComposeController;
  private polls: PollController;
  private events: EventsController;
  private postLink: PostLinkController;
  private pins: PinsController;
  /** Listen der offenen Seite fertig geladen – Bootsstream bzw. „Mein Verlauf“ (für den Anker `#p-<id>`) */
  private pageReady: Promise<void> = Promise.resolve();
  /** angezeigte Seite statt Karte (Entdecken bzw. Profil, Gruppe …) – für die Bereiche in der Kopfzeile */
  private pageSection: 'discover' | 'page' | null = null;
  /** persönlicher Stream geladen, aber noch nicht angezeigt: Stand für „gelesen“ (F-222) */
  private pendingSeen: { at?: number } | null = null;
  /** ?community (Reiter „Community“ von einer Seite aus): nach dem Wiederherstellen die Startseite zeigen */
  private wantCommunity = false;
  /** start() ist durch – vorher ist offen, welcher Bereich gezeigt wird */
  private started = false;

  private mapStyle: MapStyleController;
  private notifications: NotificationsController;
  /** Startseite als Einstieg (nicht Profil-, Boots-, Gruppen- oder Entdecken-Seite) – nur dort lädt die Startseite Neuigkeiten */
  private homeRoute = false;
  private timelinePts: TimedPoint[] = [];

  constructor() {
    this.map = new MapView($('#map'), { onHover: (p) => this.hover(p, 'map') });
    // Törn-Arbeitsbereich (Konzept 23): genau ein Törn – Entwurf, eigener gespeicherter oder fremde Ansicht
    this.ws = new WorkspaceController(this.store, {
      ask: (req) => this.ui.confirm.ask(req),
      dismiss: () => this.ui.confirm.dismiss(),
      ready: () => this.session.backendReady,
      toast: (msg, ms) => this.toast(msg, ms),
      fit: (tracks) => this.map.fit(tracks),
      leavePage: () => this.leavePage(),
      onPage: () => this.ui.app.hasAttribute('data-page'),
      showHome: () => this.showHome(),
    });
    this.session = new SessionController(this.store, {
      login: this.ui.login,
      share: this.ui.share,
      account: this.ui.account,
      invite: this.ui.invite,
      crew: this.ui.crew,
      crewPanel: this.ui.crewPanel,
      crewChanged: (crew) => (this.ui.byline.crew = crew),
      ask: (req) => this.ui.confirm.ask(req),
      toast: (msg, ms) => this.toast(msg, ms),
      signedOut: () => this.ws.signedOut(),
      saved: (share) => this.ws.saved(share),
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
    this.logbook = new LogbookController({
      form: this.ui.logbookForm,
      panel: this.ui.logbookPanel,
      box: this.ui.logbookBox,
      requireLogin: (reason, then) => this.session.requireLogin(reason, then),
      open: (path) => location.assign(path),
    });
    this.map.photos.callbacks = { onOpen: (id) => this.photos.open(id), onHover: (id) => this.photoHover(id) };
    this.discover = new DiscoverController(this.store, this.ui.discoverPage);
    this.discover.toast = (msg) => this.toast(msg, 6000);
    this.groups = new GroupsController(this.store, {
      page: this.ui.groupPage,
      home: this.ui.homeFeed,
      profile: this.ui.page,
      toast: (msg, ms) => this.toast(msg, ms),
      openLogin: (reason) => this.session.openLogin(reason),
      // Startseite: Stream groß, „Track anlegen“ kompakt (Konzept 12.6)
      onCommunity: (visible) => {
        this.ui.empty.community = visible;
      },
      // „Meine Gruppen“ nur nachladen, wenn das Konto offen ist
      onMembership: () => void (this.ui.account.open && this.session.refreshMyGroups()),
      onMembershipBusy: (busy) => (this.ui.account.busy = busy),
      onJoinsChanged: () => void this.unread.refresh(true),
      onPersonalStream: (at) => {
        this.pendingSeen = { at };
        this.markSeen();
      },
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
    this.unread = new UnreadController(this.store, { show: (label) => (this.ui.topbar.unread = label), visible: () => this.markSeen() });

    this.mapStyle = new MapStyleController(this.store, { picker: this.ui.mapStyle, toast: (msg, ms) => this.toast(msg, ms) });
    this.notifications = new NotificationsController(this.store, {
      panel: this.ui.notifications,
      badge: (label) => (this.ui.topbar.bell = label),
      expanded: (open, focus) => {
        this.ui.topbar.bellOpen = open;
        if (focus) (this.ui.topbar.shadowRoot?.querySelector('[data-bell]') as HTMLElement | null)?.focus();
      },
      navigate: (href) => location.assign(href),
    });
    // ---- Beiträge, Phase 2 (Konzept 21.12): „+ Neu“ und `/p/<id>` ----
    this.compose = new ComposeController({
      dialog: this.ui.compose,
      toast: (msg, ms) => this.toast(msg, ms),
      requireLogin: (reason, then) => this.session.requireLogin(reason, then),
      startLogbook: () => this.logbook.start(),
      posted: (post) => this.showPosted(post),
      resumeDraft: () => void this.ws.resume(),
    });
    // ---- Umfragen (Konzept 29) ----
    this.polls = new PollController({ toast: (msg, ms) => this.toast(msg, ms), requireLogin: (reason, then) => this.session.requireLogin(reason, then) });
    // ---- Veranstaltungen (Konzept 30) ----
    this.events = new EventsController({
      dialog: this.ui.eventDialog,
      toast: (msg, ms) => this.toast(msg, ms),
      requireLogin: (reason, then) => this.session.requireLogin(reason, then),
      signedIn: () => !!this.store.get().user,
      ask: (req) => this.ui.confirm.ask(req),
      startLogbook: (preset) => this.logbook.start(null, { preset }),
    });
    this.postLink = new PostLinkController({
      page: this.ui.page,
      groupPage: this.ui.groupPage,
      enterPage: () => {
        this.ui.app.setAttribute('data-page', '');
        this.pageSection = 'page';
        this.ui.topbar.section = 'page';
      },
      openPage: (route) => this.openPage(route),
      ready: () => this.pageReady,
      more: { group: () => this.groups.more('group'), harbor: () => this.social.moreHarbor(), boat: () => this.social.moreBoat(), own: () => this.posts.load(true) },
    });
    this.pins = new PinsController({
      // Pins an die sichtbare Seite: Gruppenseite bzw. Hafen-/Bootsseite
      show: (pins, manage) => Object.assign(this.ui.groupPage.hidden ? this.ui.page : this.ui.groupPage, { pins, manage }),
      toast: (msg, ms) => this.toast(msg, ms),
      refreshOwn: () => this.posts.load(),
    });
    new GuestSliderController(this.store, { slider: $<SxGuestSlider>('sx-guest-slider'), feed: this.ui.homeFeed, samples: SAMPLES, ready: () => this.session.backendReady });
    this.ui.empty.samples = SAMPLES;
    if (new URLSearchParams(location.search).has('embed')) this.ui.app.setAttribute('data-embed', '');
    this.store.subscribe((s, prev) => this.render(s, prev));
    this.wire();
    this.render(this.store.get(), null);
  }

  async start(): Promise<void> {
    this.session.checkBackend();
    this.handleSupportParam();
    this.handleCommunityParam();
    void this.handleAccountParam();
    const route = parseRoute(location);
    // Community-Leiste nur auf der Startseite; lädt nebenbei und blockiert nichts.
    this.homeRoute = route.kind === 'home' || route.kind === 'login' || route.kind === 'invite';
    if (this.homeRoute) void this.loadDiscoverStrip();
    // Entwurf im Browser kennen („+ Neu → Entwurf fortsetzen“, Nachfrage) – auf `/` öffnet restore() ihn ohnehin
    else void this.ws.init();
    if (this.homeRoute) void this.groups.loadHome();
    try {
      switch (route.kind) {
        case 'share':
          return await this.ws.openShare(route.id, route.key);
        case 'post':
          return await this.postLink.open(route.id, route.key);
        case 'profile':
        case 'boat':
        case 'discover':
        case 'group':
        case 'group-new':
        case 'harbor':
        case 'legal':
        case 'guide':
          await this.openPage(route);
          return await this.postLink.revealAnchor();
        case 'admin':
          return await this.openAdmin();
        case 'logbook':
          return await this.openLogbookPage(!!route.legacy);
        case 'scoring':
          return await this.openScoringPage();
        case 'login':
          history.replaceState(null, '', '/');
          await this.ws.restore();
          if (route.token) await this.session.beginLogin(route.token);
          return;
        case 'invite':
          // Token aus der Adresse entfernen (Verlauf, Teilen der Adresse), dann Einladung zeigen.
          history.replaceState(null, '', '/');
          await this.ws.restore();
          if (route.token) await this.session.openInvite(route.token);
          return;
        case 'files':
          return await this.ws.openFiles(route.names);
        case 'inline':
          return await this.ws.openInline(route.data);
        default:
          await this.ws.restore();
          // Mit Tracks im Browser startet sonst die Törn-Ansicht – der Reiter wollte aber die Community.
          if (this.wantCommunity) this.store.set({ home: true });
          return;
      }
    } catch (e) {
      this.setLoading(null);
      this.toast(errorText(e));
    } finally {
      // Erst jetzt steht fest, ob Törn-Ansicht oder Community gezeigt wird (Arbeitsbereich wiederhergestellt).
      this.started = true;
      this.markSeen();
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

  /** ?community: Parameter entfernen, Startseite merken (F-220). */
  private handleCommunityParam() {
    const url = new URL(location.href);
    if (!url.searchParams.has('community')) return;
    url.searchParams.delete('community');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    this.wantCommunity = true;
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
    // Während ein Törn bzw. Tracks geladen werden (z. B. Aufruf per Link), nicht die Einstiegs-/Hochladen-Ansicht
    // zeigen, sondern nur die Ladeanzeige über der Karte (F-223).
    const home = (!has && !s.loading) || s.home;
    this.ui.app.toggleAttribute('data-empty', home);
    this.ui.empty.hidden = !home;
    this.ui.empty.trackCount = s.tracks.length;
    const section = this.section(home);
    // Törn-Chip (F-433) nur über Karte bzw. Startseite – auf Seiten schwebte er über dem Inhalt
    const toern = section === 'track' || section === 'community' ? toernLabel(s) : null;
    Object.assign(this.ui.topbar, { user: s.user, mode: s.mode, hasTracks: has, backend: s.backend, home, saved: s.saved, section, toern, draft: resumableDraft(s) });
    if (changed('home') || changed('tracks')) this.markSeen();
    // „Abmelden“ im Konto nennt den Entwurf, der dabei verworfen wird (F-438)
    if (changed('draft')) this.ui.account.draft = s.draft?.title ?? null;
    // Neuigkeiten auf der Startseite und Rollen auf der Gruppenseite hängen an der Anmeldung (Konzept 11.5).
    if (changed('user') || changed('backend')) {
      this.ui.page.signedIn = !!s.user;
      // Startseite (F-260/F-261): angemeldet zuerst der eigene Stream, „Mitmachen“ zeigt nächste Schritte
      this.ui.empty.streamFirst = !!s.user;
      if (prev) {
        if (this.homeRoute) void this.groups.loadHome(true);
        void this.groups.userChanged();
        this.discover.userChanged();
        void this.social.userChanged();
      }
      void this.unread.refresh(true);
      // Entwurf gehört dem Konto: Gast-Entwurf übernehmen, fremden verwerfen (F-438)
      if (prev) void this.ws.userChanged();
      // Glocke: Zähler nach Anmeldung bzw. Abmeldung (Konzept 17)
      void this.notifications.refresh(true);
    }
    this.ui.toast.loading = s.loading;

    if (dataChanged || changed('metric') || changed('mapStyle')) {
      const range = metricRange(vis, s.metric);
      const style = MAP_STYLES[s.mapStyle];
      this.map.render(vis, s.metric, range, style);
      const available = Object.fromEntries(METRIC_KEYS.map((k) => [k, vis.some((t) => t.points.some((p) => METRICS[k].get(p) != null))])) as Record<MetricKey, boolean>;
      Object.assign(this.ui.metric, { metric: s.metric, range, available, ramp: style.ramp });
    }
    if (changed('layers')) {
      this.map.setLayers(s.layers);
      this.ui.metric.layers = s.layers;
    }
    if (dataChanged) {
      this.timelinePts = timeline(vis);
      // Fahrtenbuch ohne GPX: Distanz mit Herkunft, keine Speed-Werte (F-302)
      this.ui.kpis.items = kpis(vis, s.mode.kind === 'share' ? s.mode.share.distSource : undefined);
      this.ui.trackList.tracks = s.tracks;
      // Entfernen und „GPX hinzufügen“ nur im Entwurf (F-435) – gespeicherte Törns kann der Server nicht ergänzen
      this.ui.trackList.readonly = s.mode.kind !== 'local';
      this.ui.trackList.addable = s.mode.kind === 'local' && has;
      this.renderCharts(s);
    }
    if (dataChanged || changed('hover') || changed('status')) this.renderHover(s);
    // Crew des geteilten Törns – neu laden bei anderem Törn oder anderer Anmeldung (Eigentümer verwaltet).
    if (changed('mode') || changed('user')) {
      // „von … · in …“ (F-228)
      const byline = s.mode.kind === 'share' ? s.mode.share : null;
      this.ui.byline.share = byline;
      // Titel des geteilten Törns immer (umbenennen für die Eigentümer:in, F-424), dazu „von … · in …“
      this.ui.byline.hidden = !byline;
      // Fahrtenbuch-Angaben (Konzept 19)
      this.logbook.show(byline);
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
    this.ui.trackList.focused = p ? (this.map.trackOf(p)?.id ?? null) : null;
  }

  // ---------------------------------------------------------------- Events

  private wire() {
    const on = <T>(name: string, fn: (detail: T, e: Event) => void) => document.addEventListener(name, (e) => fn((e as CustomEvent<T>).detail, e));
    const s = this.session;

    // Tracks & Karte
    on<{ id: MapStyleId; scope: MapStyleScope }>('sx-map-style-apply', (d) => void this.mapStyle.choose(d.id, d.scope));
    on<FileList>('sx-files', (files) => void this.ws.files(files));
    on<FileList>('sx-files-add', (files) => void this.ws.add(files));
    on<string>('sx-sample', (file) => void this.ws.sample(file));
    on('sx-toern-close', () => this.ws.close());
    on('sx-draft-discard', () => void this.ws.discard());
    on<MetricKey>('sx-metric', (metric) => this.store.set({ metric }));
    on<Layers>('sx-layers', (layers) => this.store.set({ layers }));
    on<TrackPoint | null>('sx-kpi-hover', (p) => this.hover(p, 'kpi'));
    on<number | null>('sx-hover-time', (t) => {
      const i = t == null ? -1 : nearestByTime(this.timelinePts, t);
      this.hover(i >= 0 ? this.timelinePts[i] : null, 'chart');
    });
    on<string | null>('sx-track-focus', (id) => {
      const t = id ? (this.store.get().tracks.find((x) => x.id === id) ?? null) : null;
      this.map.focus(t);
      this.ui.trackList.focused = t?.id ?? null;
    });
    on<string>('sx-track-toggle', (id) => {
      this.ui.trackList.focused = null;
      this.ws.toggle(id);
    });
    on<string>('sx-track-remove', (id) => this.ws.remove(id));
    this.wireDragDrop();

    // Startseite ↔ Törn-Ansicht
    on('sx-home', () => this.showHome());
    on('sx-track-view', () => {
      this.store.set({ home: false });
      this.map.fit(visibleTracks(this.store.get()));
    });

    // Konto & Teilen
    on('sx-share', () => s.share());
    on('sx-save', () => s.share('save'));
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
    on<{ answer: 'add' | 'later' | 'never' }>('sx-passkey-offer', (d) => s.answerPasskeyOffer(d.answer));
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
    on<{ id: string; groupIds: string[] }>('sx-share-groups-save', (d) => s.saveShareGroups(d.id, d.groupIds));
    on<Parameters<SessionController['saveProfile']>[0]>('sx-profile-save', (p) => s.saveProfile(p));
    on<{ id: string | null; input: Parameters<SessionController['saveBoat']>[1] }>('sx-boat-save', (d) => s.saveBoat(d.id, d.input));
    on<string>('sx-boat-delete', (id) => s.deleteBoat(id));
    // Einladungen, Crew, Boots-Admins
    on('sx-invite-login', () => s.inviteLogin());
    on('sx-invite-accept', () => s.acceptInvite());
    on<{ id: string; scope: 'crew' | 'boat'; boatId?: string }>('sx-invite-revoke', (d) => s.revokeInvite(d));
    on<string>('sx-invite-copy', (url) => s.copyInvite(url));
    on<{ to: { email: string } | { handle: string } | null; role?: VoyageRole }>('sx-crew-invite', (d) => s.inviteCrew(d.to, d.role));
    on<{ userId: string; role: VoyageRole }>('sx-crew-role', (d) => s.setCrewRole(d.userId, d.role));
    on<{ role: VoyageRole }>('sx-crew-own-role', (d) => s.setOwnerRole(d.role));
    on<{ userIds: string[] | 'all'; owner: boolean }>('sx-crew-confirm', (d) => s.confirmCrew(d.userIds, d.owner));
    on<{ userId: string }>('sx-crew-unconfirm', (d) => s.unconfirmCrew(d.userId));
    on<{ userId: string }>('sx-crew-remove', (d) => s.removeCrew(d.userId));
    on('sx-crew-leave', () => s.leaveCrew());
    on('sx-crew-edit', () => this.editCrew());
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
    on<{ level: NotifyLevel }>('sx-notify-default', (d) => c.saveDefaultLevel(d.level));
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
    // Gruppenseite und Vereinskarten auf /entdecken (F-333) – derselbe Ablauf, dort danach Mitgliedschaften neu
    on<{ id: string }>('sx-group-join', (d) => (this.ui.discoverPage.hidden ? g.join(d.id) : this.discover.join(d.id, () => g.join(d.id))));
    on<{ query: string }>('sx-discover-search', (d) => this.discover.search(d.query));
    on<{ boatClass: string }>('sx-discover-class', (d) => this.discover.setBoatClass(d.boatClass));
    on<{ on: boolean }>('sx-discover-near', (d) => this.discover.setNear(d.on));
    on<{ radius: NearRadius }>('sx-discover-radius', (d) => this.discover.setRadius(d.radius));
    on('sx-discover-locate', () => this.discover.useLocation());
    // Willkommens-Karte der Startseite (Konzept 14.3)
    on<{ id: string; name: string }>('sx-home-join', (d) => g.join(d.id, { name: d.name }));
    on<{ email: string | null }>('sx-friend-invite', (d) => this.social.inviteFriend(d.email));
    // Fahrtenbuch (Konzept 19)
    on('sx-logbook-start', () => this.logbook.start());
    // GPX-Törn: Vorschläge aus dem geladenen Track (F-460). Bearbeiten gibt es nur am offenen Törn, und der Arbeitsbereich
    // ist immer genau dieser Törn (Konzept 23) – die Tracks im Store sind also seine.
    on<ShareMeta>('sx-logbook-edit', (share) =>
      this.logbook.start(share, { suggestion: share.source === 'manual' ? null : suggestFromTracks(this.store.get().tracks) }),
    );
    on<LogbookSave>('sx-logbook-save', (d) => void this.logbook.save(d));
    on('sx-logbook-close', () => this.logbook.close());
    on<{ harbor: HarborChoice }>('sx-home-harbor', async (d) => {
      if (await so.saveHomeHarbor(d.harbor)) await g.loadHome(true);
    });
    on<{ id: string }>('sx-group-withdraw', (d) => g.withdraw(d.id));
    on<{ id: string; follow?: boolean }>('sx-group-leave', (d) => g.leave(d.id, !!d.follow));
    on<{ kind: FollowKind; id: string; level: NotifyLevel }>('sx-notify-level', (d) => g.setNotifyLevel(d));
    on<{ id: string; userId: string }>('sx-group-transfer', (d) => g.transfer(d));
    on<{ id: string; userId: string; approve: boolean }>('sx-group-request', (d) => g.decide(d));
    on<{ id: string; userId: string; role: 'admin' | 'member' }>('sx-group-role', (d) => g.setRole(d));
    on<{ id: string; userId: string }>('sx-group-remove', (d) => g.removeMember(d));
    on<{ id: string; email: string | null }>('sx-group-invite', (d) => g.invite(d));
    on<{ id: string }>('sx-group-invite-revoke', (d) => g.revokeInvite(d.id));
    on<{ id: string; boatId: string }>('sx-group-boat-add', (d) => g.addBoat(d));
    on<{ id: string; boatId: string }>('sx-group-boat-remove', (d) => g.removeBoat(d));
    on<{ id: string }>('sx-post-delete', async (d) => {
      await g.deletePost(d.id);
      // Hafen- bzw. Bootsseite: Stream und Pins neu (Verwalter löschen dort auch fremde Beiträge, F-425)
      const kind = this.ui.page.hidden ? null : this.ui.page.data?.kind;
      if (kind === 'harbor') await this.social.refreshHarbor();
      if (kind === 'boat') await this.social.loadBoatStream();
      if (kind === 'harbor' || kind === 'boat') await this.pins.open(this.pinChannel());
    });
    // Anpinnen (F-403): im Verlauf der Seite bzw. aus „Mein Verlauf“ im eigenen Profil
    on<{ postId: string; pinned: boolean; own?: boolean }>('sx-pin', (d) => void this.pins.toggle(d.postId, d.pinned, !!d.own));
    // ---- Beiträge als Grundtyp (Konzept 21): „Mein Verlauf“, Profil-Beiträge, Fahrtenbuch, „Ansehen als …“ ----
    const po = this.posts;
    on<{ area: MyPostArea }>('sx-my-posts-area', (d) => po.setArea(d.area));
    on('sx-my-posts-more', () => po.load(true));
    on<{ id: string; visibility: PostVisibility; reach: Reach }>('sx-my-post-update', (d) => po.update(d.id, { visibility: d.visibility, reach: d.reach }));
    on<{ id: string; kind: PostKind }>('sx-my-post-delete', (d) => po.remove(d.id, d.kind));
    // Galerie (Konzept 31): einzelnes Foto aus der Großansicht der Karte
    on<{ id: string }>('sx-gallery-photo-delete', (d, e) => po.removeGalleryPhoto(d.id, e.composedPath()[0] as SxGalleryPost));
    on<{ id: string; logState: LogState }>('sx-log-state', (d) => po.setLogState(d.id, d.logState));
    on<{ preview: ProfilePreview | null }>('sx-profile-preview', (d) => po.preview(d.preview));
    // Törn umbenennen (F-424): aus „Mein Verlauf“ über den PostsController, sonst wie Konto → Freigaben
    on<{ id: string; title: string; scope: string }>('sx-title-save', (d) => (d.scope === 'mine' ? po.rename(d.id, d.title) : this.session.updateShare(d.id, { title: d.title })));
    on<{ scope: 'home' | 'group' | 'harbor' | 'boat' | 'public' }>('sx-stream-more', (d) =>
      d.scope === 'harbor' ? this.social.moreHarbor() : d.scope === 'boat' ? this.social.moreBoat() : g.more(d.scope),
    );
    // Tageskarte großer Verläufe aufklappen (F-468) – nur Gruppen- und Hafen-Stream haben welche
    on<{ scope: string; day: string; cursor: string | null }>('sx-day-open', (d) =>
      d.scope === 'harbor' ? this.social.openHarborDay(d.day, d.cursor) : d.scope === 'group' ? g.openDay(d.day, d.cursor) : undefined,
    );
    // „+ Neu“ (F-405): ein Event für alle Arten; Dialog für Text und Umfrage
    on<{ kind: ComposeKind }>('sx-compose-open', (d) => this.compose.open(d.kind));
    on<ChannelPostInput>('sx-compose-submit', (d) => void this.compose.submit(d));
    on('sx-compose-close', () => this.compose.close());
    on<{ ctx: string }>('sx-compose-channel', (d) => void this.compose.loadAudience(d.ctx));
    on<PollEventDetail>('sx-poll-vote', (d) => this.polls.vote(d));
    on<PollEventDetail>('sx-poll-close', (d) => this.polls.close(d));
    on<PollEventDetail>('sx-poll-who', (d) => this.polls.who(d));
    // Veranstaltungen (Konzept 30): Zusage, „Wer kommt?“, Kalender, Fahrtenbuch, Ändern und Absagen
    const ev = this.events;
    on<{ id: string; status: RsvpStatus; key: string | null; el: SxEvent }>('sx-rsvp', (d) => ev.rsvp(d));
    on<{ id: string; key: string | null; el: SxEvent }>('sx-rsvp-who', (d) => void ev.who(d));
    on<{ id: string; title: string; description: string; event: EventView; path: string }>('sx-event-ics', (d) => ev.ics(d));
    on<{ preset: LogbookPreset }>('sx-event-logbook', (d) => ev.logbook(d));
    on<{ id: string; event: EventView; el: SxEvent }>('sx-event-edit', (d) => ev.edit(d));
    on<{ id: string; patch: EventFields }>('sx-event-save', (d) => void ev.save(d));
    on<{ id: string }>('sx-event-cancel', (d) => void ev.cancel(d));
    on('sx-event-dialog-close', () => ev.close());
    on<{ kind: FollowKind; id: string; follow: boolean }>('sx-follow', (d) => g.follow(d));

    // ---- Verein, Hafen, Team und Reaktionen (Konzept 12) ----
    const so = this.social;
    on<{ filter: StreamFilter }>('sx-stream-filter', (d) => g.setFilter(d.filter));
    on<{ mode: StreamMode }>('sx-stream-mode', (d) => g.setMode(d.mode));
    on<{ radius: NearRadius }>('sx-near-radius', (d) => g.setRadius(d.radius));
    on<{ show: boolean }>('sx-stream-joins', (d) => g.setJoins(d.show));
    on('sx-near-locate', () => g.useLocation());
    on('sx-near-forget', () => g.forgetLocation());
    on<{ lat: number; lon: number }>('sx-near-place', (d) => g.usePlace(d));
    on<ReactDetail>('sx-react', (d) => so.react(d));
    on<{ subject: ReactionSubject; id: string; key?: string | null; el: SxReactions }>('sx-react-who', (d) => so.who(d));
    on<{ query: string; el: SxHarborPicker }>('sx-harbor-search', (d) => so.searchHarbors(d));
    on<{ id: string; patch: HarborPatch }>('sx-harbor-save', (d) => so.saveHarbor(d));
    on<{ clubId: string | null; harbor: HarborChoice }>('sx-home-save', (d) => so.saveHome(d));
    on('sx-account-opened', () => so.loadHome());

    // ---- Verifizierte Vertretung (Konzept 20) ----
    on<{ kind: ClaimKind; id: string; el: SxClaim }>('sx-claim-load', (d) => this.claims.load(d));
    on<{ req: ClaimRequest; el: SxClaim }>('sx-claim-submit', (d) => this.claims.submit(d));
    on<{ claimId: string; kind: ClaimKind; id: string; el: SxClaim }>('sx-claim-withdraw', (d) => this.claims.withdraw(d));
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
      if (e.dataTransfer?.files.length) void this.ws.drop(e.dataTransfer.files);
    });
  }

  /** Startseite (Logo, Reiter „Community“, „Törn schließen“): Stream laden, Törn bleibt bzw. ist geschlossen. */
  private showHome() {
    this.homeRoute = true;
    // Neues seit dem Laden: Stream neu holen; gelesen erst mit dessen Stand, damit es zum Angezeigten passt (F-222)
    if (this.unread.pending) this.pendingSeen = null;
    void this.groups.loadHome(this.unread.pending);
    this.store.set({ home: true, hover: null });
    // z. B. aus einer geteilten Ansicht: Community-Leiste nachladen
    if (!this.ui.discoverStrip.data) void this.loadDiscoverStrip();
  }

  private hover(p: TrackPoint | null, source: HoverSource) {
    const cur = this.store.get().hover;
    if (cur?.point === p && cur?.source === source) return;
    this.store.set({ hover: p ? { point: p, source } : null });
  }

  // ---------------------------------------------------------------- Tracks

  // ---------------------------------------------------------------- Links & Seiten

  /** Bereich für die Kopfzeile (F-220). */
  private section(home: boolean): TopbarSection {
    return this.pageSection ?? (home ? 'community' : 'track');
  }

  /**
   * Community ist sichtbar und der persönliche Stream geladen: gelesen bis zu seinem Stand (F-222). Im Hintergrund-Tab
   * (z. B. per Strg-Klick geöffnet) erst, wenn er sichtbar wird.
   */
  private markSeen() {
    const s = this.store.get();
    if (!this.started || !this.pendingSeen || document.visibilityState === 'hidden' || this.section(!s.tracks.length || s.home) !== 'community') return;
    this.unread.seen(this.pendingSeen.at);
    this.pendingSeen = null;
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
      | { kind: 'legal'; page: 'impressum' | 'datenschutz' }
      | { kind: 'guide' },
  ) {
    this.ui.app.setAttribute('data-page', '');
    this.clearPlace();
    // jede Navigation hat ihre Nummer – eine veraltete Seite setzt danach keinen Ort mehr (F-351)
    const nav = ++this.navSeq;
    this.pageSection = route.kind === 'discover' ? 'discover' : 'page';
    this.ui.topbar.section = this.pageSection;
    if (route.kind === 'discover') return this.discover.open();
    if (route.kind === 'legal') {
      // Impressum und Datenschutz kommen aus src/content/legal.ts – ohne Backend (Konzept 12.7).
      this.ui.legalPage.page = route.page;
      this.ui.legalPage.hidden = false;
      document.title = `${route.page === 'impressum' ? 'Impressum' : 'Datenschutz'} · Sail Explorer`;
      return;
    }
    if (route.kind === 'guide') {
      // Anleitung „Aufzeichnen“ aus src/content/recording-guide.ts – ohne Backend (Konzept 25, F-450).
      this.ui.guidePage.hidden = false;
      document.title = `${RECORDING_GUIDE.title} · Sail Explorer`;
      return;
    }
    this.compose.setContext(null);
    this.pageReady = Promise.resolve();
    if (route.kind === 'harbor') {
      await this.social.openHarbor(route.slug);
      if (nav !== this.navSeq) return;
      const d = this.ui.page.data;
      const h = d?.kind === 'harbor' ? d.harbor : null;
      // „+ Neu → Text“ schlägt diesen Hafen vor (F-405)
      if (h) this.compose.setContext({ kind: 'harbor', id: h.id });
      void this.pins.open(h ? { kind: 'harbor', id: h.id } : null);
      return this.showPlace(this.ui.page, h && h.lat != null && h.lon != null ? { lat: h.lat, lon: h.lon } : null);
    }
    if (route.kind === 'group') {
      this.community.setPageKey(route.key);
      await this.groups.openGroup(route.slug, route.key);
      if (nav === this.navSeq) this.showPlace(this.ui.groupPage, this.ui.groupPage.data?.place ?? null);
      // Gruppenseite geöffnet: Beitrittsanfragen dazu gelesen (F-253)
      const group = this.ui.groupPage.data?.group;
      if (group) this.notifications.viewing({ subjectKind: 'group', subjectId: group.id });
      if (group && nav === this.navSeq) {
        this.compose.setContext({ kind: 'group', id: group.id });
        void this.pins.open({ kind: 'group', id: group.id });
      }
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
        // eigene Seite: „Mein Verlauf“ mit allem, auch Privatem (F-401)
        page.myPosts = null;
        if (d.profile.isSelf) this.pageReady = this.posts.openOwn();
      } else {
        const d = await api.boat(route.id, route.key);
        page.data = { kind: 'boat', ...d };
        document.title = `${d.boat.name} · Sail Explorer`;
        // Neuigkeiten des Boots (F-425) und „+ Neu → Text“ mit diesem Boot
        this.pageReady = this.social.loadBoatStream(route.key);
        this.compose.setContext({ kind: 'boat', id: d.boat.id });
        void this.pins.open({ kind: 'boat', id: d.boat.id });
      }
    } catch (e) {
      page.error = e instanceof ApiError && e.status === 404 ? 'Diese Seite gibt es nicht oder sie ist privat.' : errorText(e);
    } finally {
      page.loading = false;
    }
  }

  // ---------------------------------------------------------------- Beiträge: `/p/<id>` und Anker (F-406)

  /** Verlauf der offenen Hafen- bzw. Bootsseite (für die Pins). */
  private pinChannel(): { kind: 'harbor' | 'boat'; id: string } | null {
    const d = this.ui.page.data;
    return d?.kind === 'harbor' ? { kind: 'harbor', id: d.harbor.id } : d?.kind === 'boat' ? { kind: 'boat', id: d.boat.id } : null;
  }

  /** Nach dem Schreiben (F-405): in den Heimatverlauf, die neue Karte oben hervorgehoben (gleiche Seite: neu laden). */
  private showPosted(post: CreatedPost) {
    const user = this.store.get().user;
    const home = post.home ?? (user?.handle ? `/u/${user.handle}` : null);
    if (!home) return;
    const target = `${home}#p-${post.id}`;
    if (location.pathname === home) {
      history.replaceState(null, '', target);
      location.reload();
    } else location.assign(target);
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

  /** „Crew bearbeiten“ aus dem Zahnrad-Menü des Törns (F-512): Bearbeiten-Modus an und das Panel in den Blick holen. */
  private editCrew() {
    this.ui.crew.editing = true;
    this.ui.crewPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

  /**
   * Admin-Bereich (Konzept 18): Seite und Controller erst hier nachgeladen – andere laden keinen Admin-Code. Für
   * Nicht-Admins antwortet die API mit 404 und die Seite zeigt nur das.
   */
  private async openAdmin() {
    this.ui.app.setAttribute('data-page', '');
    const { AdminController } = await import('./controllers/admin');
    const page = document.querySelector<SxAdminPage>('sx-admin-page');
    if (!page) return;
    page.hidden = false;
    document.title = 'Admin · Sail Explorer';
    new AdminController(page).start();
  }

  /**
   * Verwaltungsbereich „Mein Fahrtenbuch“ (Konzept 27): Seite und Controller erst hier nachgeladen. Die alte Adresse
   * `/u/<handle>?bereich=fahrtenbuch` wird ersetzt (F-459). Bearbeiten nutzt das eine Fahrtenbuch-Formular und lädt danach
   * die Liste neu, statt zur Törn-Ansicht zu wechseln.
   */
  private async openLogbookPage(legacy: boolean) {
    if (legacy) history.replaceState(null, '', LOGBOOK_PATH);
    this.ui.app.setAttribute('data-page', '');
    const { LogbookPageController } = await import('./controllers/logbook-page');
    const page = document.querySelector<SxLogbookPage>('sx-logbook-page');
    if (!page) return;
    document.title = 'Mein Fahrtenbuch · Sail Explorer';
    const c: InstanceType<typeof LogbookPageController> = new LogbookPageController({
      page,
      toast: (msg, ms) => this.toast(msg, ms),
      ready: () => this.session.backendReady,
      signedIn: () => !!this.store.get().user,
      requireLogin: (reason, then) => this.session.requireLogin(reason, then),
      edit: (share) => this.logbook.start(share, { after: () => void c.reload() }),
    });
    await c.open();
  }

  /** Verwaltungsbereich „Wertung“ (Konzept 32): Seite und Controller erst hier nachgeladen. */
  private async openScoringPage() {
    this.ui.app.setAttribute('data-page', '');
    const { ScoringPageController } = await import('./controllers/scoring-page');
    const page = document.querySelector<SxScoringPage>('sx-scoring-page');
    if (!page) return;
    document.title = 'Wertung · Sail Explorer';
    await new ScoringPageController({
      page,
      toast: (msg, ms) => this.toast(msg, ms),
      ready: () => this.session.backendReady,
      signedIn: () => !!this.store.get().user,
      requireLogin: (reason, then) => this.session.requireLogin(reason, then),
      ask: (req) => this.ui.confirm.ask(req),
    }).open();
  }

  /**
   * Hafen- und Vereinsseite mit Ort (F-351): Karte als Hintergrund, auf den Ort gezoomt; ohne Ort wie bisher die
   * Seite allein.
   */
  private showPlace(page: HTMLElement, place: { lat: number; lon: number } | null) {
    this.ui.app.toggleAttribute('data-place', !!place);
    page.toggleAttribute('on-map', !!place);
    // erst nach dem Umschalten des Rasters messen – sonst kennt die Karte ihre Größe nicht
    requestAnimationFrame(() => this.map.showPlace(place, Math.min(window.innerHeight * 0.34, 300)));
  }

  /**
   * Ort-Ansicht verlassen: Markierung weg. Die Tracks werden erst wieder eingepasst, wenn die Karte sichtbar ist
   * (leavePage) – auf der versteckten Karte (Wechsel zu einer anderen Seite) wäre ihre Größe 0.
   */
  private clearPlace() {
    if (!this.ui.app.hasAttribute('data-place')) return;
    this.ui.app.removeAttribute('data-place');
    this.ui.page.removeAttribute('on-map');
    this.ui.groupPage.removeAttribute('on-map');
    this.map.showPlace(null);
    this.refitAfterPlace = true;
  }

  /** Zurück von Profil-/Boots-/Entdecken-Seite zur Kartenansicht. */
  private leavePage() {
    if (!this.ui.app.hasAttribute('data-page')) return;
    this.clearPlace();
    this.ui.app.removeAttribute('data-page');
    if (this.refitAfterPlace) {
      this.refitAfterPlace = false;
      const tracks = this.store.get().tracks.filter((t) => !t.hidden);
      if (tracks.length) requestAnimationFrame(() => this.map.fit(tracks));
    }
    this.pageSection = null;
    this.compose.setContext(null);
    void this.pins.open(null);
    this.ui.page.highlight = null;
    this.ui.groupPage.highlight = null;
    this.ui.page.hidden = true;
    this.ui.discoverPage.hidden = true;
    this.ui.groupPage.hidden = true;
    this.ui.legalPage.hidden = true;
    this.ui.guidePage.hidden = true;
    for (const el of document.querySelectorAll<HTMLElement>('sx-admin-page, sx-logbook-page, sx-scoring-page')) el.hidden = true;
    document.title = 'Sail Explorer';
  }

  // ---------------------------------------------------------------- Helfer

  private setLoading(text: string | null) {
    this.store.set({ loading: text });
  }

  private toast(msg: string, ms?: number) {
    this.ui.toast.show(msg, ms);
  }
}
