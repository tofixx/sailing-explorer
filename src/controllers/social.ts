import { ApiError, socialApi, type HarborPatch, type ShareMeta, type StreamPage } from '../services/api';
import type { Store } from '../services/store';
import type { SxAccountDialog } from '../components/sx-account-dialog';
import type { SxGroupPage } from '../components/sx-group-page';
import type { HarborChoice, SxHarborPicker } from '../components/sx-harbor-picker';
import type { SxHomeFeed } from '../components/sx-home-feed';
import type { SxPhotoLightbox } from '../components/sx-photo-lightbox';
import type { SxProfilePage } from '../components/sx-profile-page';
import type { ReactDetail, ReactionValue, SxReactions } from '../components/sx-reactions';
import type { ReactionSubject, ReactionSummary } from '../domain/reactions';
import { errorText } from './session';

export interface SocialUi {
  /** Profil-/Boots-/Hafenseite (eine Komponente) */
  page: SxProfilePage;
  home: SxHomeFeed;
  groupPage: SxGroupPage;
  account: SxAccountDialog;
  /** Reaktionen in der Törn-Ansicht */
  shareReactions: SxReactions;
  reactionsPanel: HTMLElement;
  lightbox: SxPhotoLightbox;
  toast: (msg: string, ms?: number) => void;
  openLogin: (reason: string) => void;
}

/**
 * Verein, Hafen, Team und Reaktionen (Konzept 12): Hafenseite, „Mein Verein“/Heimathafen im Konto, Hafen-Suche für
 * die Auswahlfelder und Reaktionen überall (Stream, Gruppen- und Hafenseite, Törn, Foto). Kennt weder Karte noch Tracks.
 */
export class SocialController {
  private harborSlug: string | null = null;
  /** Törn der Törn-Ansicht (für Reaktionen) */
  private share: { id: string; key: string | null } | null = null;

  constructor(
    private store: Store,
    private ui: SocialUi,
  ) {}

  private signedIn = () => !!this.store.get().user;

  // ---------------------------------------------------------------- Hafenseite

  async openHarbor(slug: string): Promise<void> {
    this.harborSlug = slug;
    const page = this.ui.page;
    page.hidden = false;
    Object.assign(page, { loading: true, error: '', data: null, editing: false, signedIn: this.signedIn() });
    try {
      await this.reloadHarbor();
    } catch (e) {
      page.error = e instanceof ApiError && e.status === 404 ? 'Diesen Hafen gibt es nicht (mehr).' : errorText(e);
    } finally {
      page.loading = false;
    }
  }

  private async reloadHarbor(): Promise<void> {
    if (!this.harborSlug) return;
    const d = await socialApi.harbor(this.harborSlug);
    const stream = await socialApi.harborStream(d.harbor.id).catch(() => ({ items: [], cursor: null }) as StreamPage);
    this.ui.page.data = { kind: 'harbor', ...d, stream };
    document.title = `Hafen ${d.harbor.name} · Sail Explorer`;
  }

  /** Nach An- oder Abmelden: Rechte (Bearbeiten, Folgen) neu laden. */
  async userChanged(): Promise<void> {
    if (this.harborSlug && !this.ui.page.hidden && this.ui.page.data?.kind === 'harbor') await this.reloadHarbor().catch(() => undefined);
  }

  async moreHarbor(): Promise<void> {
    const page = this.ui.page;
    const d = page.data;
    if (d?.kind !== 'harbor' || !d.stream?.cursor) return;
    page.streamLoading = true;
    try {
      const next = await socialApi.harborStream(d.harbor.id, d.stream.cursor);
      page.data = { ...d, stream: { ...next, items: [...d.stream.items, ...next.items] } };
    } catch (e) {
      this.ui.toast(errorText(e));
    } finally {
      page.streamLoading = false;
    }
  }

  async saveHarbor(d: { id: string; patch: HarborPatch }): Promise<void> {
    if (!this.signedIn()) return this.ui.openLogin('Zum Bearbeiten bitte anmelden.');
    try {
      await socialApi.updateHarbor(d.id, d.patch);
      this.ui.toast('Hafen gespeichert');
      await this.reloadHarbor();
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    }
  }

  // ---------------------------------------------------------------- Hafen-Suche (Auswahlfelder)

  async searchHarbors(d: { query: string; el: SxHarborPicker }): Promise<void> {
    try {
      const { harbors } = await socialApi.searchHarbors(d.query);
      d.el.results = harbors;
    } catch {
      d.el.results = [];
    }
  }

  // ---------------------------------------------------------------- Mein Verein und Heimathafen

  /** Für das Konto (Reiter „Profil“). */
  async loadHome(): Promise<void> {
    if (!this.signedIn()) return;
    try {
      this.ui.account.home = await socialApi.home();
    } catch {
      this.ui.account.home = null;
    }
  }

  async saveHome(d: { clubId: string | null; harbor: HarborChoice }): Promise<void> {
    const acc = this.ui.account;
    Object.assign(acc, { busy: true, error: '' });
    try {
      let harborId: string | null = null;
      if ('name' in d.harbor) harborId = (await socialApi.createHarbor(d.harbor.name)).harbor.id;
      else harborId = d.harbor.harborId;
      const home = await socialApi.saveHome({ clubId: d.clubId, harborId });
      acc.home = { ...home, clubs: acc.home?.clubs ?? [] };
      this.ui.toast('Verein und Heimathafen gespeichert');
    } catch (e) {
      acc.error = errorText(e);
    } finally {
      acc.busy = false;
    }
  }

  // ---------------------------------------------------------------- Reaktionen

  /** Sofort umgeschaltet hat die Komponente; hier speichern und überall nachführen (bei Fehler zurück). */
  async react(d: ReactDetail): Promise<void> {
    if (!this.signedIn()) {
      this.patch(d.subject, d.id, d.previous);
      return this.ui.openLogin('Zum Reagieren bitte anmelden.');
    }
    try {
      const summary = await socialApi.react(d.subject, d.id, d.kind, d.key);
      this.patch(d.subject, d.id, summary);
    } catch (e) {
      this.patch(d.subject, d.id, d.previous);
      this.ui.toast(errorText(e), 6000);
    }
  }

  async who(d: { subject: ReactionSubject; id: string; key?: string | null; el: SxReactions }): Promise<void> {
    d.el.who = null;
    try {
      d.el.who = await socialApi.reactions(d.subject, d.id, d.key);
    } catch (e) {
      d.el.open = false;
      this.ui.toast(errorText(e));
    }
  }

  /** Neue Zusammenfassung in alle Ansichten übernehmen, die diesen Gegenstand zeigen. */
  private patch(subject: ReactionSubject, id: string, s: ReactionSummary): void {
    const fix = (page: StreamPage | null | undefined): StreamPage | null | undefined => {
      if (!page?.items.some((i) => i.reactions?.subject === subject && i.reactions.id === id)) return page;
      return { ...page, items: page.items.map((i) => (i.reactions?.subject === subject && i.reactions.id === id ? { ...i, reactions: { ...i.reactions, ...s } } : i)) };
    };
    const home = this.ui.home;
    const hs = fix(home.stream);
    if (hs !== home.stream) home.stream = hs ?? null;
    const gp = this.ui.groupPage;
    const gs = fix(gp.stream);
    if (gs !== gp.stream) gp.stream = gs ?? null;
    const pd = this.ui.page.data;
    if (pd?.kind === 'harbor') {
      const ps = fix(pd.stream);
      if (ps !== pd.stream) this.ui.page.data = { ...pd, stream: ps };
    }
    const sr = this.ui.shareReactions.value;
    if (sr && sr.subject === subject && sr.id === id) this.ui.shareReactions.value = { ...sr, ...s };
    const lr = this.ui.lightbox.reactions;
    if (lr && lr.subject === subject && lr.id === id) this.ui.lightbox.reactions = { ...lr, ...s };
  }

  /** Reaktionen in der Törn-Ansicht (Seitenleiste). */
  async loadShare(share: ShareMeta, key?: string | null): Promise<void> {
    this.share = { id: share.id, key: key ?? null };
    this.ui.shareReactions.shareKey = key ?? null;
    try {
      const r = await socialApi.reactions('share', share.id, key);
      if (this.share?.id !== share.id) return;
      this.ui.shareReactions.value = { subject: 'share', id: share.id, counts: r.counts, mine: r.mine } satisfies ReactionValue;
      this.ui.reactionsPanel.hidden = false;
    } catch {
      this.hideShare();
    }
  }

  hideShare(): void {
    this.share = null;
    this.ui.shareReactions.value = null;
    this.ui.reactionsPanel.hidden = true;
  }

  /** Reaktionen des gerade in der Lightbox gezeigten Fotos. */
  async loadPhoto(): Promise<void> {
    const lb = this.ui.lightbox;
    const photo = lb.open ? lb.photos[lb.index] : undefined;
    if (!photo || !this.share) {
      lb.reactions = null;
      return;
    }
    lb.shareKey = this.share.key;
    if (lb.reactions?.id === photo.id) return;
    try {
      const r = await socialApi.reactions('photo', photo.id, this.share.key);
      lb.reactions = { subject: 'photo', id: photo.id, counts: r.counts, mine: r.mine };
    } catch {
      lb.reactions = null;
    }
  }
}
