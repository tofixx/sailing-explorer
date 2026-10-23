import { shareSummary } from '../domain/summary';
import { ApiError, api, validatePayload, type BoatInput, type Profile, type ShareMeta, type SharePatch } from '../services/api';
import { deflateToBase64Url, gzipString } from '../services/compress';
import type { Store } from '../services/store';
import { turnstileMount } from '../services/turnstile';
import { serializeView } from '../services/url-state';
import type { AccountTab, SxAccountDialog } from '../components/sx-account-dialog';
import type { SxLoginDialog } from '../components/sx-login-dialog';
import type { SxShareDialog } from '../components/sx-share-dialog';

/** Größte URL, die wir für Links mit eingebetteten Daten noch erzeugen. */
const MAX_INLINE_URL = 32_000;

export interface SessionUi {
  login: SxLoginDialog;
  share: SxShareDialog;
  account: SxAccountDialog;
  toast: (msg: string, ms?: number) => void;
}

export interface ShareRequest {
  title: string;
  visibility: 'unlisted' | 'private';
  listed: boolean;
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

  constructor(
    private store: Store,
    private ui: SessionUi,
  ) {
    // Anmeldung in einem anderen Tab (Klick auf den Magic Link) → hier übernehmen
    this.channel?.addEventListener('message', (e) => {
      if (e.data === 'login') this.refreshUser().then(() => this.afterLogin());
      if (e.data === 'logout') this.store.set({ user: null });
    });
  }

  // ---------------------------------------------------------------- Anmeldung

  async checkBackend(): Promise<void> {
    try {
      const cfg = await api.config();
      if (cfg.turnstileSiteKey) this.ui.login.mountCaptcha = turnstileMount(cfg.turnstileSiteKey);
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
    Object.assign(this.ui.login, { open: true, reason, error: '', sentTo: '', devLink: '', confirmEmail: '', busy: false });
  }

  async requestLink(email: string, turnstile: string | null): Promise<void> {
    Object.assign(this.ui.login, { busy: true, error: '' });
    try {
      const res = await api.requestLink(email, turnstile);
      Object.assign(this.ui.login, { sentTo: email.trim(), devLink: res.devLink ?? '' });
    } catch (e) {
      this.ui.login.error = errorText(e);
    } finally {
      this.ui.login.busy = false;
    }
  }

  resetLogin(): void {
    Object.assign(this.ui.login, { sentTo: '', devLink: '', error: '' });
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
    this.channel?.postMessage('logout');
    this.lastShare = null;
    this.closeAll();
    this.ui.toast(msg);
  }

  closeAll(): void {
    this.ui.login.open = false;
    this.ui.share.open = false;
    this.ui.account.open = false;
  }

  // ---------------------------------------------------------------- Teilen

  private tracksKey() {
    return this.store.get().tracks.map((t) => t.id).join(',');
  }

  async share(): Promise<void> {
    const s = this.store.get();
    if (!s.tracks.length) return;
    if (s.mode.kind === 'share') {
      // Geteilte Ansicht weitergeben – inkl. aktueller Einfärbung/Ebenen
      return this.showResult(s.mode.share, `${location.origin}/s/${s.mode.share.id}?${serializeView(s.metric, s.layers)}`);
    }
    if (this.lastShare?.key === this.tracksKey()) return this.showResult(this.lastShare.share);
    if (!s.backend) return this.shareInline();
    if (!s.user) {
      this.pendingShare = true;
      return this.openLogin('Zum Teilen wird dein Törn gespeichert – dafür meldest du dich einmal mit deiner E-Mail-Adresse an. Danach geht es direkt weiter.');
    }
    const names = s.tracks.map((t) => t.name);
    Object.assign(this.ui.share, {
      open: true,
      result: null,
      error: '',
      busy: false,
      boats: [],
      defaultTitle: names.length > 1 ? `${names[0]} → ${names[names.length - 1]}` : names[0],
      summary: shareSummary(s.tracks),
    });
    api.myBoats().then((r) => (this.ui.share.boats = r.boats), () => {});
  }

  private showResult(share: ShareMeta, url = `${location.origin}/s/${share.id}`) {
    Object.assign(this.ui.share, { open: true, error: '', busy: false, result: { share, url } });
  }

  async upload(d: ShareRequest): Promise<void> {
    const s = this.store.get();
    this.ui.share.busy = true;
    this.ui.share.error = '';
    try {
      const payload = validatePayload({ v: 1, tracks: s.tracks.map((t) => ({ name: t.name, gpx: t.raw })) });
      const gz = await gzipString(JSON.stringify(payload));
      const starts = s.tracks.map((t) => t.stats.start).filter((x): x is number => x != null);
      const { share } = await api.createShare(gz, {
        title: d.title,
        summary: shareSummary(s.tracks),
        view: d.includeView ? serializeView(s.metric, s.layers) : '',
        trackCount: s.tracks.length,
        visibility: d.visibility,
        listed: d.listed,
        boatId: d.boatId,
        distNm: s.tracks.reduce((sum, t) => sum + t.stats.distNm, 0),
        startedAt: starts.length ? Math.min(...starts) : null,
      });
      this.lastShare = { key: this.tracksKey(), share };
      this.showResult(share);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        this.closeAll();
        this.pendingShare = true;
        return this.openLogin('Deine Anmeldung ist abgelaufen – bitte erneut anmelden.');
      }
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
    Object.assign(this.ui.account, { open: true, tab, user: this.store.get().user, loading: true, error: '' });
    try {
      const [shares, boats, me] = await Promise.all([api.listShares(), api.myBoats(), api.myProfile()]);
      Object.assign(this.ui.account, { shares: shares.shares, boats: boats.boats, profile: me.profile, profileExists: me.exists });
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

  saveProfile(p: Pick<Profile, 'handle' | 'displayName' | 'bio' | 'visibility'>) {
    return this.act(async () => {
      const { profile } = await api.saveProfile(p);
      Object.assign(this.ui.account, { profile, profileExists: true });
    }, 'Profil gespeichert');
  }

  saveBoat(id: string | null, input: BoatInput) {
    return this.act(async () => {
      const { boat } = id ? await api.updateBoat(id, input) : await api.createBoat(input);
      const boats = this.ui.account.boats;
      this.ui.account.boats = id ? boats.map((b) => (b.id === id ? boat : b)) : [...boats, boat];
    }, id ? 'Boot gespeichert' : 'Boot angelegt');
  }

  deleteBoat(id: string) {
    return this.act(async () => {
      await api.deleteBoat(id);
      this.ui.account.boats = this.ui.account.boats.filter((b) => b.id !== id);
      this.ui.account.shares = this.ui.account.shares.map((s) => (s.boat?.id === id ? { ...s, boat: null } : s));
    }, 'Boot gelöscht – die Törns bleiben erhalten');
  }

  updateShare(id: string, patch: SharePatch) {
    return this.act(async () => {
      const { share } = await api.updateShare(id, patch);
      this.ui.account.shares = this.ui.account.shares.map((s) => (s.id === id ? share : s));
      const mode = this.store.get().mode;
      if (mode.kind === 'share' && mode.share.id === id) this.store.set({ mode: { kind: 'share', share } });
      if (this.lastShare?.share.id === id) this.lastShare.share = share;
    });
  }

  deleteShare(id: string) {
    return this.act(async () => {
      await api.deleteShare(id);
      this.ui.account.shares = this.ui.account.shares.filter((s) => s.id !== id);
      if (this.lastShare?.share.id === id) this.lastShare = null;
    }, 'Freigabe gelöscht');
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}
