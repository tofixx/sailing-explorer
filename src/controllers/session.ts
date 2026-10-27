import { metricRange } from '../domain/metrics';
import { inviteAcceptedText } from '../domain/invite-text';
import { shareSummary } from '../domain/summary';
import { needsSupport, type SupportTier } from '../domain/support';
import {
  ApiError,
  api,
  validatePayload,
  type BoatInput,
  type InviteTo,
  type ProfileInput,
  type ShareMeta,
  type SharePatch,
  type SupportStatus,
} from '../services/api';
import { deflateToBase64Url, gzipString } from '../services/compress';
import { DEFAULT_CONTENT, imageFileName, renderShareImage, type ImageContent, type ImageFormat } from '../services/share-image';
import { visibleTracks, type Store } from '../services/store';
import { turnstileMount } from '../services/turnstile';
import { absoluteLink, routePath, serializeView } from '../services/url-state';
import { DEFAULT_VISIBILITY, type Visibility } from '../domain/visibility';
import type { AccountTab, SxAccountDialog } from '../components/sx-account-dialog';
import type { SxCrew } from '../components/sx-crew';
import type { SxInviteDialog } from '../components/sx-invite-dialog';
import type { SxLoginDialog } from '../components/sx-login-dialog';
import type { SxShareDialog } from '../components/sx-share-dialog';

/** Größte URL, die wir für Links mit eingebetteten Daten noch erzeugen. */
const MAX_INLINE_URL = 32_000;
const IMAGE_PREFS_KEY = 'sx-image-prefs';

export interface SessionUi {
  login: SxLoginDialog;
  share: SxShareDialog;
  account: SxAccountDialog;
  invite: SxInviteDialog;
  crew: SxCrew;
  /** Panel „Crew“ in der Törn-Ansicht (sichtbar, wenn es etwas zu zeigen oder zu verwalten gibt) */
  crewPanel: HTMLElement;
  toast: (msg: string, ms?: number) => void;
}

export interface ShareRequest {
  title: string;
  visibility: Visibility;
  boatId: string | null;
  includeView: boolean;
}

/**
 * Alles rund um Konto und Server: Anmelden per Magic Link, Teilen, Profil, Boote, Freigaben.
 * Kennt Store und Dialoge, aber weder Karte noch Track-Darstellung.
 */
export class SessionController {
  private pendingShare = false;
  private lastShare: { key: string; share: ShareMeta } | null = null;
  private pendingToken: string | null = null;
  private channel = 'BroadcastChannel' in window ? new BroadcastChannel('sx-auth') : null;
  /** Slider-Stufen aus /api/config (null = Unterstützen nicht eingerichtet) */
  private supportTiers: SupportTier[] | null = null;
  private supportStatus: SupportStatus | null = null;
  /** erfüllt, sobald Konfiguration und Anmeldung geladen sind */
  backendReady: Promise<void> = Promise.resolve();
  /** geöffnete Einladung (Token), bis sie angenommen oder geschlossen ist */
  private pendingInvite: string | null = null;
  /** Törn, dessen Crew gerade gezeigt wird */
  private crewShare: { share: ShareMeta; key?: string } | null = null;

  constructor(
    private store: Store,
    private ui: SessionUi,
  ) {
    // Anmeldung in einem anderen Tab (Klick auf den Magic Link) → hier übernehmen
    this.channel?.addEventListener('message', (e) => {
      if (e.data === 'login') this.refreshUser().then(() => this.afterLogin());
      if (e.data === 'logout') this.store.set({ user: null });
    });
    // Zurück aus einem anderen Tab (z. B. Zahlung dort abgeschlossen): Status still neu laden.
    window.addEventListener('focus', () => {
      if (this.ui.share.open && needsSupport(this.supportStatus)) this.refreshSupport();
    });
    // Zurück per Browser-Verlauf von der Bezahlseite (bfcache): Knopf wieder freigeben.
    window.addEventListener('pageshow', () => this.setCheckoutBusy(false));
  }

  // ---------------------------------------------------------------- Anmeldung

  checkBackend(): Promise<void> {
    this.backendReady = this.loadBackend();
    return this.backendReady;
  }

  private async loadBackend(): Promise<void> {
    try {
      const cfg = await api.config();
      if (cfg.turnstileSiteKey) this.ui.login.mountCaptcha = turnstileMount(cfg.turnstileSiteKey);
      this.supportTiers = cfg.support?.tiers?.length ? cfg.support.tiers : null;
      this.store.set({ backend: cfg.sharing });
      await this.refreshUser();
    } catch {
      this.store.set({ backend: false });
    }
  }

  private async refreshUser() {
    try {
      this.store.set({ user: (await api.me()).user });
    } catch {
      /* offline */
    }
  }

  openLogin(reason = ''): void {
    Object.assign(this.ui.login, { open: true, reason, error: '', sentTo: '', devLink: '', devCode: '', confirmEmail: '', busy: false });
  }

  async requestLink(email: string, turnstile: string | null): Promise<void> {
    Object.assign(this.ui.login, { busy: true, error: '' });
    try {
      const res = await api.requestLink(email, turnstile);
      Object.assign(this.ui.login, { sentTo: email.trim(), devLink: res.devLink ?? '', devCode: res.devCode ?? '' });
    } catch (e) {
      this.ui.login.error = errorText(e);
    } finally {
      this.ui.login.busy = false;
    }
  }

  resetLogin(): void {
    Object.assign(this.ui.login, { sentTo: '', devLink: '', devCode: '', error: '' });
  }

  /**
   * Magic Link geöffnet: erst nachfragen „Als … anmelden?“, dann einlösen.
   * Schützt davor, dass jemand einen Link für sein eigenes Konto unterschiebt.
   */
  async beginLogin(token: string): Promise<void> {
    try {
      const { email } = await api.peek(token);
      this.pendingToken = token;
      Object.assign(this.ui.login, {
        open: true, reason: '', error: '', sentTo: '', devLink: '', busy: false,
        confirmEmail: email, currentEmail: this.store.get().user?.email ?? '',
      });
    } catch (e) {
      this.openLogin();
      this.ui.login.error = errorText(e);
    }
  }

  /** Anmelden mit dem Code aus der Mail (Konzept 14.6) – an die Adresse, an die der Link ging. */
  async loginWithCode(code: string): Promise<void> {
    const email = this.ui.login.sentTo;
    if (!email) return;
    Object.assign(this.ui.login, { busy: true, error: '' });
    try {
      const { user } = await api.verifyCode(email, code);
      this.store.set({ user });
      this.channel?.postMessage('login');
      this.ui.toast(`Angemeldet als ${user.email}`);
      this.afterLogin();
    } catch (e) {
      this.ui.login.error = errorText(e);
    } finally {
      this.ui.login.busy = false;
    }
  }

  async confirmLogin(): Promise<void> {
    if (!this.pendingToken) return;
    this.ui.login.busy = true;
    try {
      const { user } = await api.verify(this.pendingToken);
      this.pendingToken = null;
      this.store.set({ user });
      this.channel?.postMessage('login');
      this.ui.toast(`Angemeldet als ${user.email}`);
      this.afterLogin();
    } catch (e) {
      Object.assign(this.ui.login, { confirmEmail: '', error: errorText(e) });
    } finally {
      this.ui.login.busy = false;
    }
  }

  private afterLogin() {
    this.ui.login.open = false;
    this.ui.login.confirmEmail = '';
    if (this.pendingShare && this.store.get().user) {
      this.pendingShare = false;
      this.share();
    } else if (this.pendingInvite && this.store.get().user) {
      // Einladung nach der Anmeldung (auch aus einem anderen Tab) wieder zeigen – angenommen wird erst per Klick.
      void this.openInvite(this.pendingInvite);
    }
  }

  async logout(): Promise<void> {
    await api.logout().catch(() => {});
    this.signedOut('Abgemeldet');
  }

  async deleteAccount(): Promise<void> {
    try {
      await api.deleteAccount();
      this.signedOut('Konto, Profil, Boote und Freigaben gelöscht');
    } catch (e) {
      this.ui.account.error = errorText(e);
    }
  }

  private signedOut(msg: string) {
    this.store.set({ user: null });
    this.setSupport(null);
    this.channel?.postMessage('logout');
    this.lastShare = null;
    this.closeAll();
    this.ui.toast(msg);
  }

  closeAll(): void {
    this.ui.login.open = false;
    this.ui.share.open = false;
    this.ui.account.open = false;
    this.ui.invite.open = false;
  }

  // ---------------------------------------------------------------- Einladungen

  /** /einladung#token=…: zeigen, wozu eingeladen wird – eingelöst wird erst nach Klick auf „Annehmen“. */
  async openInvite(token: string): Promise<void> {
    await this.backendReady;
    this.pendingInvite = token;
    const user = this.store.get().user;
    this.ui.account.open = false;
    Object.assign(this.ui.invite, {
      open: true, state: 'loading', peek: null, result: null, error: '', errorCode: '', busy: false,
      signedIn: !!user, userEmail: user?.email ?? '',
    });
    try {
      Object.assign(this.ui.invite, { state: 'ready', peek: await api.peekInvite(token) });
    } catch (e) {
      this.pendingInvite = null;
      Object.assign(this.ui.invite, { state: 'error', error: errorText(e) });
    }
  }

  /** Dialog geschlossen: die Einladung bleibt im Postfach, hier wird sie vergessen. */
  closeInvite(): void {
    this.ui.invite.open = false;
    this.pendingInvite = null;
  }

  /** Erst anmelden (bzw. mit der eingeladenen Adresse) – danach erscheint die Einladung wieder. */
  inviteLogin(): void {
    const bound = this.ui.invite.peek?.bound;
    this.ui.invite.open = false;
    this.openLogin(`Melde dich ${bound ? 'mit der eingeladenen E-Mail-Adresse ' : ''}an, um die Einladung anzunehmen. Danach geht es direkt weiter.`);
  }

  async acceptInvite(): Promise<void> {
    if (!this.pendingInvite) return;
    Object.assign(this.ui.invite, { busy: true, error: '', errorCode: '' });
    try {
      const result = await api.acceptInvite(this.pendingInvite);
      this.pendingInvite = null;
      Object.assign(this.ui.invite, { state: 'done', result });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        return this.inviteLogin();
      }
      Object.assign(this.ui.invite, { error: errorText(e), errorCode: e instanceof ApiError ? e.code : '' });
    } finally {
      this.ui.invite.busy = false;
    }
  }

  // ---------------------------------------------------------------- Crew

  /** Crew des geöffneten Törns laden; das Panel erscheint nur, wenn es etwas zu zeigen oder zu verwalten gibt. */
  async loadCrew(share: ShareMeta, key?: string): Promise<void> {
    this.crewShare = { share, key };
    const crewEl = this.ui.crew;
    Object.assign(crewEl, { visibility: share.visibility, error: '', busy: false });
    try {
      const crew = await api.crew(share.id, key);
      if (this.crewShare?.share.id !== share.id) return;
      Object.assign(crewEl, { crew, isOwner: crew.isOwner });
      if (!crew.isOwner) crewEl.newLink = '';
      this.ui.crewPanel.hidden = !(crew.isOwner || crew.isCrew || crew.members.length || crew.others);
    } catch {
      this.ui.crewPanel.hidden = true; // ohne Backend oder ohne Zugriff: kein Panel
    }
  }

  hideCrew(): void {
    this.crewShare = null;
    this.ui.crewPanel.hidden = true;
    Object.assign(this.ui.crew, { crew: null, newLink: '' });
  }

  private async crewAct(fn: (shareId: string) => Promise<void>, done?: string) {
    const cur = this.crewShare;
    if (!cur) return;
    Object.assign(this.ui.crew, { busy: true, error: '' });
    try {
      await fn(cur.share.id);
      if (done) this.ui.toast(done);
      await this.loadCrew(cur.share, cur.key);
    } catch (e) {
      this.ui.crew.error = errorText(e);
    } finally {
      this.ui.crew.busy = false;
    }
  }

  /** Crew einladen: per E-Mail, Profilname oder (to = null) als Einladungslink, der nur jetzt angezeigt wird. */
  inviteCrew(to: InviteTo | null) {
    return this.crewAct(async (id) => {
      const res = await api.inviteCrew(id, to);
      if (res.link) this.ui.crew.newLink = res.link;
      else this.ui.toast(invitedText(res.invite));
      if (res.devLink) console.info('Einladungslink (Entwicklung, kein Mailversand):', res.devLink);
    });
  }

  removeCrew(userId: string) {
    return this.crewAct((id) => api.removeCrew(id, userId), 'Aus der Crew entfernt');
  }

  leaveCrew() {
    return this.crewAct((id) => api.removeCrew(id, 'me'), 'Du bist nicht mehr in der Crew dieses Törns');
  }

  /** Einladungslink kopieren – nur eigene Links dieser Origin. */
  copyInvite(url: string): Promise<void> {
    if (!url.startsWith(`${location.origin}/einladung#token=`)) return Promise.resolve();
    return this.copy(url);
  }

  /** Offene Einladung zurückziehen (Crew im Törn-Panel oder Admin im Konto). */
  revokeInvite(d: { id: string; scope: 'crew' | 'boat'; boatId?: string }) {
    if (d.scope === 'crew') return this.crewAct(() => api.revokeInvite(d.id), 'Einladung zurückgezogen');
    return this.act(async () => {
      await api.revokeInvite(d.id);
      if (d.boatId) await this.loadAdmins(d.boatId);
    }, 'Einladung zurückgezogen');
  }

  // ---------------------------------------------------------------- Boots-Admins

  async loadAdmins(boatId: string): Promise<void> {
    if (this.ui.account.admins?.boatId !== boatId) this.ui.account.admins = { boatId, data: null };
    try {
      const data = await api.boatAdmins(boatId);
      if (this.ui.account.admins?.boatId === boatId) this.ui.account.admins = { boatId, data };
    } catch (e) {
      this.ui.account.error = errorText(e);
    }
  }

  inviteAdmin(boatId: string, to: InviteTo) {
    return this.act(async () => {
      const res = await api.inviteBoatAdmin(boatId, to);
      if (res.devLink) console.info('Einladungslink (Entwicklung, kein Mailversand):', res.devLink);
      this.ui.toast(invitedText(res.invite));
      await this.loadAdmins(boatId);
    });
  }

  /** Einladung an mich aus dem Konto annehmen; als Admin erscheint das Boot gleich unter „Boote“. */
  acceptMyInvite(id: string) {
    return this.act(async () => {
      const r = await api.acceptMyInvite(id);
      this.ui.account.myInvites = this.ui.account.myInvites.filter((i) => i.id !== id);
      if (r.kind === 'boat_admin') this.ui.account.boats = (await api.myBoats()).boats;
      this.ui.toast(inviteAcceptedText(r));
    });
  }

  declineMyInvite(id: string) {
    return this.act(async () => {
      await api.declineMyInvite(id);
      this.ui.account.myInvites = this.ui.account.myInvites.filter((i) => i.id !== id);
    }, 'Einladung abgelehnt');
  }

  removeAdmin(boatId: string, userId: string) {
    return this.act(async () => {
      await api.removeBoatAdmin(boatId, userId);
      await this.loadAdmins(boatId);
    }, 'Admin entfernt');
  }

  /** Als Admin das Boot verlassen – es verschwindet aus „Meine Boote“. */
  leaveBoat(boatId: string) {
    return this.act(async () => {
      await api.removeBoatAdmin(boatId, 'me');
      this.ui.account.boats = this.ui.account.boats.filter((b) => b.id !== boatId);
      this.ui.account.admins = null;
    }, 'Boot verlassen');
  }

  // ---------------------------------------------------------------- Teilen

  private tracksKey() {
    return this.store.get().tracks.map((t) => t.id).join(',');
  }

  /** Öffnet den Teilen-Dialog: „Als Bild“ geht immer, „Als Link“ je nach Anmeldung/Backend. */
  async share(): Promise<void> {
    const s = this.store.get();
    if (!s.tracks.length) return;
    const names = s.tracks.map((t) => t.name);
    let result: { share: ShareMeta; url: string } | null = null;
    if (s.mode.kind === 'share') {
      // Geteilte Ansicht weitergeben – inkl. aktueller Einfärbung/Ebenen
      // Eigentümer bekommen den aktuellen Link vom Server, alle anderen geben den Link weiter, mit dem sie gekommen sind.
      const { share, key } = s.mode;
      const path = share.isOwner && share.link ? share.link : routePath('s', share.id, key);
      result = { share, url: `${location.origin}${path}?${serializeView(s.metric, s.layers)}` };
    } else if (this.lastShare?.key === this.tracksKey()) {
      result = { share: this.lastShare.share, url: shareUrl(this.lastShare.share) };
    }
    const linkState = !s.backend ? 'offline' : s.user ? 'form' : 'login';
    Object.assign(this.ui.share, {
      open: true,
      tab: result || linkState === 'form' ? 'link' : 'image',
      linkState,
      result,
      error: '',
      busy: false,
      boats: [],
      visibility: DEFAULT_VISIBILITY,
      defaultTitle: s.mode.kind === 'share' ? s.mode.share.title : names.length > 1 ? `${names[0]} → ${names[names.length - 1]}` : names[0],
      summary: shareSummary(s.tracks),
      checking: false,
      supportTiers: this.tiersForUser(),
      checkoutBusy: false,
    });
    this.refreshImage();
    if (s.user) {
      api.myBoats().then((r) => (this.ui.share.boats = r.boats), () => {});
      this.refreshSupport();
    }
  }

  // ---------------------------------------------------------------- Unterstützen

  /** Stufen nur für angemeldete Konten – der Checkout braucht das Konto für die Zuordnung. */
  private tiersForUser(): SupportTier[] | null {
    return this.store.get().user ? this.supportTiers : null;
  }

  private setSupport(status: SupportStatus | null) {
    this.supportStatus = status;
    const tiers = status ? this.tiersForUser() : null;
    Object.assign(this.ui.share, { supportStatus: status, supportTiers: tiers });
    Object.assign(this.ui.account, { supportStatus: status, supportTiers: tiers });
  }

  private setCheckoutBusy(busy: boolean) {
    this.ui.share.checkoutBusy = busy;
    this.ui.account.checkoutBusy = busy;
  }

  /**
   * Slider-Knopf „Jetzt unterstützen“: Checkout-Session anlegen und zur Bezahlseite wechseln.
   * Freigeschaltet wird erst durch den Webhook; zurück geht es über /?support=success|cancel.
   */
  async checkout(amount: number): Promise<void> {
    if (!this.store.get().user) return this.openLogin('Zum Unterstützen meldest du dich einmal mit deiner E-Mail-Adresse an.');
    this.setCheckoutBusy(true);
    try {
      const { url } = await api.supportCheckout(amount);
      location.assign(url);
      // Busy bleibt stehen, bis die Bezahlseite lädt – verhindert Doppelklicks.
    } catch (e) {
      this.setCheckoutBusy(false);
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        this.closeAll();
        return this.openLogin('Deine Anmeldung ist abgelaufen – bitte erneut anmelden.');
      }
      this.ui.toast(errorText(e), 7000);
    }
  }

  /**
   * Rückkehr von der Bezahlseite bzw. Link aus der Erinnerungsmail (?support=…).
   * success: danken und Status laden; cancel: kurz bestätigen; open: Angebot im Konto zeigen.
   */
  async supportReturn(kind: 'success' | 'cancel' | 'open'): Promise<void> {
    await this.backendReady;
    if (kind === 'cancel') return this.ui.toast('Zahlung abgebrochen – es wurde nichts abgebucht.');
    if (!this.store.get().user) {
      return this.openLogin(
        kind === 'success'
          ? 'Danke für deine Unterstützung! Melde dich an, um deinen Unterstützer-Status zu sehen.'
          : 'Melde dich an, um Sail Explorer zu unterstützen und deine Törns länger zu behalten.',
      );
    }
    if (kind === 'open') return this.openAccount('shares');
    const status = await this.refreshSupport();
    this.ui.toast(
      status?.supporter
        ? 'Danke für deine Unterstützung! Du kannst jetzt weitere Törns speichern.'
        : 'Danke für deine Unterstützung! Die Bestätigung kann ein paar Sekunden dauern.',
      7000,
    );
    // Webhook noch nicht da: einmal nachladen, damit der Status ohne Klick erscheint.
    if (!status?.supporter) setTimeout(() => void this.refreshSupport(), 5000);
  }

  private async refreshSupport(): Promise<SupportStatus | null> {
    try {
      const status = await api.support();
      this.setSupport(status);
      return status;
    } catch {
      return null; // offline/abgemeldet – der Server prüft beim Hochladen ohnehin selbst
    }
  }

  /** „Ich habe unterstützt – prüfen“: Status neu laden; der Webhook kann ein paar Sekunden brauchen. */
  async checkSupport(): Promise<void> {
    Object.assign(this.ui.share, { checking: true, error: '' });
    const status = await this.refreshSupport();
    this.ui.share.checking = false;
    if (status?.supporter) this.ui.toast('Danke für deine Unterstützung! Du kannst jetzt weitere Törns speichern.', 6000);
    else this.ui.share.error = 'Noch ist keine Zahlung angekommen. Das kann ein paar Sekunden dauern – bitte gleich noch einmal prüfen.';
  }

  private showResult(share: ShareMeta) {
    Object.assign(this.ui.share, { open: true, tab: 'link', error: '', busy: false, result: { share, url: shareUrl(share) } });
  }

  /** Aus dem Link-Reiter: erst anmelden, danach geht es im Dialog weiter. */
  loginForShare(): void {
    this.pendingShare = true;
    this.ui.share.open = false;
    this.openLogin('Für einen Link wird dein Törn gespeichert – dafür meldest du dich einmal mit deiner E-Mail-Adresse an. Danach geht es direkt weiter.');
  }

  shareInlineLink(): Promise<void> {
    return this.shareInline();
  }

  // ---------------------------------------------------------------- Bild

  private imageBlob: Blob | null = null;
  private imageSeq = 0;

  private imagePrefs(): { format: ImageFormat; content: ImageContent } {
    try {
      const p = JSON.parse(localStorage.getItem(IMAGE_PREFS_KEY) || '{}') as { format?: ImageFormat; content?: Partial<ImageContent> };
      return { format: p.format === 'square' ? 'square' : 'landscape', content: { ...DEFAULT_CONTENT, ...p.content } };
    } catch {
      return { format: 'landscape', content: { ...DEFAULT_CONTENT } };
    }
  }

  setImageOptions(format: ImageFormat, content: ImageContent): void {
    try {
      localStorage.setItem(IMAGE_PREFS_KEY, JSON.stringify({ format, content }));
    } catch {
      /* privater Modus: Auswahl gilt nur für diese Sitzung */
    }
    this.refreshImage({ format, content });
  }

  private imageFor(opts: { format: ImageFormat; content: ImageContent }): Promise<Blob> {
    const s = this.store.get();
    const tracks = visibleTracks(s).length ? visibleTracks(s) : s.tracks;
    return renderShareImage(tracks, {
      title: this.ui.share.defaultTitle || tracks[0]?.name || 'Törn',
      metric: s.metric,
      range: metricRange(tracks, s.metric),
      format: opts.format,
      content: opts.content,
    });
  }

  /** Zeichnet die Vorschau neu; ältere, langsamere Läufe werden verworfen. */
  private async refreshImage(opts = this.imagePrefs()): Promise<void> {
    const seq = ++this.imageSeq;
    const prev = this.ui.share.image;
    this.ui.share.image = { url: prev?.url ?? '', busy: true, ...opts };
    try {
      const blob = await this.imageFor(opts);
      if (seq !== this.imageSeq) return;
      if (prev?.url) URL.revokeObjectURL(prev.url);
      this.imageBlob = blob;
      this.ui.share.image = { url: URL.createObjectURL(blob), busy: false, ...opts };
    } catch (e) {
      if (seq !== this.imageSeq) return;
      this.ui.share.image = { url: prev?.url ?? '', busy: false, ...opts };
      this.ui.toast(`Bild: ${errorText(e)}`);
    }
  }

  private imageFile(): File | null {
    if (!this.imageBlob) return null;
    return new File([this.imageBlob], imageFileName(this.ui.share.defaultTitle || 'toern'), { type: 'image/jpeg' });
  }

  downloadImage(): void {
    const f = this.imageFile();
    if (!f) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async shareImage(): Promise<void> {
    const f = this.imageFile();
    if (!f) return;
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: this.ui.share.defaultTitle }).catch(() => {});
    else this.downloadImage();
  }

  async upload(d: ShareRequest): Promise<void> {
    const s = this.store.get();
    this.ui.share.busy = true;
    this.ui.share.error = '';
    try {
      // Wetter wird beim Einstellen einmal geladen und mitgespeichert – Betrachter rufen Open-Meteo nicht erneut ab.
      const payload = validatePayload({ v: 1, tracks: s.tracks.map((t) => ({ name: t.name, gpx: t.raw })), ...(s.weather ? { weather: s.weather } : {}) });
      const gz = await gzipString(JSON.stringify(payload));
      const starts = s.tracks.map((t) => t.stats.start).filter((x): x is number => x != null);
      const { share } = await api.createShare(gz, {
        title: d.title,
        summary: shareSummary(s.tracks),
        view: d.includeView ? serializeView(s.metric, s.layers) : '',
        trackCount: s.tracks.length,
        visibility: d.visibility,
        boatId: d.boatId,
        distNm: s.tracks.reduce((sum, t) => sum + t.stats.distNm, 0),
        startedAt: starts.length ? Math.min(...starts) : null,
      });
      this.lastShare = { key: this.tracksKey(), share };
      this.store.set({ saved: true });
      if (this.supportStatus) this.setSupport({ ...this.supportStatus, sharesUsed: this.supportStatus.sharesUsed + 1 });
      this.showResult(share);
      // Übersichtsbild für die Link-Vorschau – immer im Querformat; Fehler sind nicht kritisch.
      this.imageFor({ format: 'landscape', content: this.imagePrefs().content })
        .then((blob) => api.putShareImage(share.id, blob))
        .catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        this.closeAll();
        this.pendingShare = true;
        return this.openLogin('Deine Anmeldung ist abgelaufen – bitte erneut anmelden.');
      }
      // Kontingent ausgeschöpft: Status laden, dann zeigt der Dialog die Unterstützen-Karte statt des Formulars.
      if (e instanceof ApiError && e.code === 'supporter_required' && needsSupport(await this.refreshSupport())) return;
      this.ui.share.error = errorText(e);
    } finally {
      this.ui.share.busy = false;
    }
  }

  /** Ohne Backend: kleine Tracks als Link mit eingebetteten Daten. */
  private async shareInline() {
    const raws = this.store.get().tracks.map((t) => t.raw);
    const url = `${location.origin}/#g=${await deflateToBase64Url(JSON.stringify(raws))}`;
    if (url.length > MAX_INLINE_URL) {
      return this.ui.toast(`Track ist für einen Link zu groß (${Math.round(url.length / 1024)} kB) und Teilen per Server ist hier nicht verfügbar.`, 7000);
    }
    await this.copy(url);
  }

  /** Link einer eigenen Freigabe kopieren – mit Schlüssel, wenn sie „Nur mit Link“ ist. */
  copyShare(id: string): Promise<void> {
    const share = this.ui.account.shares.find((s) => s.id === id) ?? (this.lastShare?.share.id === id ? this.lastShare.share : null);
    return this.copy(share ? shareUrl(share) : `${location.origin}/s/${id}`);
  }

  /** Pfad einer eigenen Seite (/b/…, /u/…, /s/…) als absoluten Link kopieren. */
  copyPath(path: string): Promise<void> {
    if (!/^\/[sbug]\/[A-Za-z0-9/-]+$/.test(path)) return Promise.resolve();
    return this.copy(location.origin + path);
  }

/** Profil-/Bootsseite teilen: Teilen-Menü des Geräts, sonst Link kopieren. */
  async sharePage(path: string, title: string): Promise<void> {
    if (!/^\/[sbug]\/[A-Za-z0-9/-]+$/.test(path)) return;
    const url = location.origin + path;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${title} · Sail Explorer`, url });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // abgebrochen – nichts tun
      }
    }
    await this.copy(url);
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.ui.toast('Link kopiert');
    } catch {
      prompt('Link kopieren:', text);
    }
  }

  // ---------------------------------------------------------------- Konto, Profil, Boote

  async openAccount(tab: AccountTab = 'shares'): Promise<void> {
    if (!this.store.get().user) return this.openLogin();
    this.ui.share.open = false; // keine gestapelten Dialoge
    this.ui.invite.open = false;
    Object.assign(this.ui.account, { open: true, tab, user: this.store.get().user, loading: true, error: '', admins: null });
    try {
      const [shares, boats, me, invites] = await Promise.all([
        api.listShares(), api.myBoats(), api.myProfile(), api.myInvites().catch(() => ({ invites: [] })), this.refreshSupport(),
      ]);
      Object.assign(this.ui.account, { shares: shares.shares, boats: boats.boats, profile: me.profile, profileExists: me.exists, myInvites: invites.invites });
    } catch (e) {
      this.ui.account.error = errorText(e);
    } finally {
      this.ui.account.loading = false;
    }
  }

  /** Führt eine Konto-Aktion aus und zeigt Fehler im Dialog. */
  private async act(fn: () => Promise<void>, done?: string) {
    Object.assign(this.ui.account, { busy: true, error: '' });
    try {
      await fn();
      if (done) this.ui.toast(done);
    } catch (e) {
      this.ui.account.error = errorText(e);
    } finally {
      this.ui.account.busy = false;
    }
  }

  saveProfile(p: ProfileInput) {
    return this.act(async () => {
      const { profile } = await api.saveProfile(p);
      Object.assign(this.ui.account, { profile, profileExists: true });
    }, p.rotateKey ? ROTATED : 'Profil gespeichert');
  }

  saveBoat(id: string | null, input: BoatInput) {
    return this.act(async () => {
      const { boat } = id ? await api.updateBoat(id, input) : await api.createBoat(input);
      const boats = this.ui.account.boats;
      this.ui.account.boats = id ? boats.map((b) => (b.id === id ? boat : b)) : [...boats, boat];
      // Boote-Kontingent („c von d Booten“) nachladen
      if (!id) void this.refreshSupport();
    }, input.rotateKey ? ROTATED : id ? 'Boot gespeichert' : 'Boot angelegt');
  }

  deleteBoat(id: string) {
    return this.act(async () => {
      await api.deleteBoat(id);
      this.ui.account.boats = this.ui.account.boats.filter((b) => b.id !== id);
      this.ui.account.shares = this.ui.account.shares.map((s) => (s.boat?.id === id ? { ...s, boat: null } : s));
      void this.refreshSupport();
    }, 'Boot gelöscht – die Törns bleiben erhalten');
  }

  updateShare(id: string, patch: SharePatch) {
    return this.act(async () => {
      const { share } = await api.updateShare(id, patch);
      this.ui.account.shares = this.ui.account.shares.map((s) => (s.id === id ? share : s));
      const mode = this.store.get().mode;
      if (mode.kind === 'share' && mode.share.id === id) this.store.set({ mode: { ...mode, share } });
      if (this.lastShare?.share.id === id) this.lastShare.share = share;
    }, patch.rotateKey ? ROTATED : undefined);
  }

  deleteShare(id: string) {
    return this.act(async () => {
      await api.deleteShare(id);
      this.ui.account.shares = this.ui.account.shares.filter((s) => s.id !== id);
      if (this.lastShare?.share.id === id) this.lastShare = null;
      if (this.supportStatus) this.setSupport({ ...this.supportStatus, sharesUsed: Math.max(0, this.supportStatus.sharesUsed - 1) });
      // Speicher („a MB von b MB“) nachladen
      void this.refreshSupport();
    }, 'Freigabe gelöscht');
  }
}

/** Bestätigung nach dem Einladen – mit Namen bzw. der selbst eingegebenen Adresse, nie mit einer fremden. */
function invitedText(invite: { email: string | null; invitee: { displayName: string } | null }): string {
  return `Einladung an ${invite.invitee?.displayName ?? invite.email ?? 'die Crew'} verschickt`;
}

const ROTATED = 'Neuer Link erstellt – der alte Link funktioniert nicht mehr.';

/** Absoluter Link einer eigenen Freigabe (mit Schlüssel bei „Nur mit Link“). */
function shareUrl(share: ShareMeta): string {
  return absoluteLink('s', share.id, share);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}
