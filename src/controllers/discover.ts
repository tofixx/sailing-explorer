import { ApiError, api, groupApi, socialApi, type DiscoverMembership, type NearCenter } from '../services/api';
import { locate, readNearPrefs, writeNearPrefs } from '../services/near-prefs';
import type { NearRadius } from '../domain/near';
import type { Store } from '../services/store';
import type { SxDiscover } from '../components/sx-discover';
import { SEARCH_LIMITS, searchKey } from '../domain/search';
import { errorText } from './session';

/** Einträge je Liste auf /entdecken (F-74) */
const PAGE_LIMIT = 24;
/** Verzögerung der Suche beim Tippen */
export const SEARCH_DELAY_MS = 250;

/**
 * Seite /entdecken (F-70, F-331 … F-333): lädt die öffentlichen Listen – mit Suche `?q=` serverseitig –, merkt die
 * Suche in der Adresse und liefert angemeldeten Nutzern ihre Mitgliedschaften für die Beitreten-Knöpfe. Beitreten
 * selbst läuft über den GroupsController (dieselbe Anfrage wie auf der Gruppenseite).
 */
export class DiscoverController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** laufende Anfrage – ältere Antworten werden verworfen */
  private seq = 0;
  /** zuletzt geladener Suchschlüssel (samt Umgebung) */
  private loadedKey: string | null = null;
  /** Umgebung an (Standard, sobald ein Mittelpunkt bekannt ist) – F-344 */
  private nearOn = true;
  /** Heimathafen (angemeldet) als Mittelpunkt ohne Standort */
  private home: { slug: string; name: string } | null | undefined;

  constructor(
    private store: Store,
    private page: SxDiscover,
  ) {}

  private signedIn = () => !!this.store.get().user;

  async open(): Promise<void> {
    const page = this.page;
    page.hidden = false;
    document.title = 'Entdecken · Sail Explorer';
    const query = new URLSearchParams(location.search).get('q') ?? '';
    Object.assign(page, { query, data: null, error: '' });
    this.loadedKey = null;
    await this.loadHome();
    await Promise.all([this.load(query), this.loadMembership()]);
    // Anker /entdecken#vereine („Alle Vereine“)
    if (location.hash === '#vereine') requestAnimationFrame(() => page.shadowRoot?.getElementById('vereine')?.scrollIntoView());
  }

  /** Eingabe im Suchfeld: verzögert suchen, Adresse ohne neuen Verlaufseintrag anpassen. */
  search(query: string): void {
    this.page.query = query;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const url = new URL(location.href);
      if (query.trim()) url.searchParams.set('q', query.trim());
      else url.searchParams.delete('q');
      history.replaceState(history.state, '', url);
      void this.load(query);
    }, SEARCH_DELAY_MS);
  }

  // ---------------------------------------------------------------- Umgebung (F-344)

  /** Heimathafen einmal holen (angemeldet), Standort aus dem Gerät – Mittelpunkt wie auf der Startseite (F-343). */
  private async loadHome(): Promise<void> {
    if (this.home === undefined) {
      this.home = null;
      if (this.signedIn()) {
        try {
          const h = (await socialApi.home()).harbor;
          this.home = h ? { slug: h.slug, name: h.name } : null;
        } catch {
          this.home = null;
        }
      }
    }
    this.showNear();
  }

  private center(): { center: NearCenter; label: string } | null {
    const geo = readNearPrefs().geo;
    if (geo) return { center: geo, label: 'deinen Standort' };
    return this.home ? { center: { harbor: this.home.slug }, label: this.home.name } : null;
  }

  private showNear(): void {
    const c = this.center();
    this.page.near = { on: this.nearOn && !!c, radius: readNearPrefs().radius, center: c?.label ?? null };
    // Ohne Mittelpunkt zeigt „In der Nähe“ den Standort-Knopf, die Listen bleiben „Überall“
    if (!c && this.nearOn) this.page.near = { ...this.page.near, on: true };
  }

  private reload(): Promise<void> {
    this.loadedKey = null;
    this.showNear();
    return this.load(this.page.query);
  }

  setNear(on: boolean): Promise<void> {
    this.nearOn = on;
    return this.reload();
  }

  setRadius(radius: NearRadius): Promise<void> {
    writeNearPrefs({ ...readNearPrefs(), radius });
    return this.reload();
  }

  async useLocation(): Promise<void> {
    try {
      writeNearPrefs({ ...readNearPrefs(), geo: await locate() });
      this.nearOn = true;
      await this.reload();
    } catch (e) {
      this.page.error = '';
      this.toast?.(`${errorText(e)} Alternativ: Heimathafen im Konto wählen.`);
    }
  }

  /** Meldungen (von der App gesetzt) */
  toast?: (msg: string) => void;

  private async load(query: string): Promise<void> {
    // Zu kurze Eingaben suchen nicht (wie der Server) – dann die ungefilterte Liste.
    const norm = searchKey(query);
    const key = norm.length >= SEARCH_LIMITS.min ? query.trim() : '';
    const c = this.nearOn ? this.center() : null;
    const near = c ? { center: c.center, r: readNearPrefs().radius } : null;
    const loaded = `${key ? norm : ''}|${JSON.stringify(near)}`;
    if (this.page.data && this.loadedKey === loaded) return;
    const seq = ++this.seq;
    const page = this.page;
    page.loading = true;
    try {
      const data = await api.discover(PAGE_LIMIT, key, near);
      if (seq !== this.seq) return;
      page.data = data;
      page.error = '';
      this.loadedKey = loaded;
    } catch (e) {
      if (seq !== this.seq) return;
      page.data = null;
      page.error = e instanceof ApiError && e.code === 'no_backend' ? 'Entdecken ist auf dieser Installation nicht verfügbar.' : errorText(e);
    } finally {
      if (seq === this.seq) page.loading = false;
    }
  }

  /** Eigene Mitgliedschaften und offene Anfragen (F-333) – Gäste: null, Fehler: Knöpfe bleiben nach Beitrittsstufe. */
  async loadMembership(): Promise<void> {
    if (!this.signedIn()) {
      this.page.membership = null;
      return;
    }
    try {
      const mine = await groupApi.mine();
      const membership: DiscoverMembership = { member: mine.groups.map((g) => g.slug), requested: mine.requests.map((r) => r.slug) };
      this.page.membership = membership;
    } catch {
      this.page.membership = null;
    }
  }

  /** Beitreten bzw. anfragen (`run` = GroupsController.join): Knopf solange gesperrt, danach Stand neu laden. */
  async join(id: string, run: () => Promise<unknown>): Promise<void> {
    this.page.joining = id;
    try {
      await run();
    } finally {
      this.page.joining = '';
    }
    await this.loadMembership();
  }

  /** An- oder Abmeldung: Knöpfe und Heimathafen passend zum neuen Konto. */
  userChanged(): void {
    const before = this.home?.slug ?? null;
    this.home = undefined;
    if (this.page.hidden) return;
    void this.loadMembership();
    // nur neu laden, wenn sich der Mittelpunkt ändert (sonst doppelte Anfrage beim Start)
    void this.loadHome().then(() => {
      if ((this.home?.slug ?? null) !== before) void this.reload();
    });
  }
}
