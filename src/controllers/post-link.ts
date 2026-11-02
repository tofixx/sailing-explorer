// `/p/<id>` und Anker `#p-<id>` (Konzept 21.4, F-406): Beiträge haben keine eigene Seite. Steht die Karte im
// Heimatverlauf, geht es dorthin (Adresse ersetzt, Anker), die Karte wird nachgeladen, falls sie nicht auf der ersten
// Seite steht, und kurz hervorgehoben. Sonst – Verlauf nicht sichtbar, „Nur mit Link“ oder zu weit unten – die einzelne
// Karte. Der ganze Ablauf liegt hier; app.ts gibt nur Seiten und Nachlade-Wege hinein.
import { ApiError, postApi, type StreamItem } from '../services/api';
import { parseRoute, type Route } from '../services/url-state';
import type { PostLink } from '../domain/posts';
import type { SxProfilePage } from '../components/sx-profile-page';
import type { SxGroupPage } from '../components/sx-group-page';
import { errorText } from './session';

/** Eine Liste mit Beiträgen auf der offenen Seite (Gruppe, Hafen, Boot, Profil, „Mein Verlauf“). */
export interface PostList {
  ids: () => string[];
  /** es gibt weitere Seiten */
  hasMore: () => boolean;
  more: () => Promise<void>;
  mark: (id: string) => void;
}

/** Seiten, die ein Anker öffnen kann. */
export type PageRoute = Extract<Route, { kind: 'profile' | 'boat' | 'group' | 'harbor' }>;

/** Höchstens so viele Seiten nachladen, bevor die einzelne Karte gezeigt wird. */
const MAX_PAGES = 5;

/** Anker `#p-<id>` aus der Adresse. */
export const anchorPost = (hash: string): string | null => /^#p-([A-Za-z0-9]{12,32})$/.exec(hash)?.[1] ?? null;

const postIds = (items: Array<{ kind: string; post?: { id: string } }> | undefined) => (items ?? []).filter((i) => i.kind === 'post' && i.post).map((i) => i.post!.id);

export class PostLinkController {
  constructor(
    private ui: {
      page: SxProfilePage;
      groupPage: SxGroupPage;
      /** Seitenansicht statt Karte einschalten (Raster, Kopfzeile) */
      enterPage: () => void;
      /** Seite eines Verlaufs öffnen (wie ein Aufruf der Adresse) */
      openPage: (route: PageRoute) => Promise<void>;
      /** Listen der offenen Seite fertig geladen (Bootsstream, „Mein Verlauf“) */
      ready: () => Promise<void>;
      more: { group: () => Promise<void>; harbor: () => Promise<void>; boat: () => Promise<void>; own: () => Promise<void> };
    },
  ) {}

  /** Karte und Ziel holen (404, wenn der Betrachter sie nicht sehen darf). */
  load(id: string, key?: string | null): Promise<{ item: StreamItem; link: PostLink }> {
    return postApi.get(id, key);
  }

  /**
   * `/p/<id>(/<schlüssel>)`: Steht die Karte im Heimatverlauf, Adresse auf ihn mit Anker ersetzen und die Seite öffnen
   * (Weiterleitung im Browser, damit die Link-Vorschau des Workers die erste Zeile zeigen kann); sonst die einzelne Karte.
   */
  async open(id: string, key?: string, single = false): Promise<void> {
    this.ui.enterPage();
    this.ui.groupPage.hidden = true;
    const page = this.ui.page;
    page.hidden = false;
    Object.assign(page, { loading: true, error: '', data: null, highlight: null });
    try {
      const r = await this.load(id, key);
      if (!single && r.link.inStream && r.link.home) {
        history.replaceState(null, '', `${r.link.home}#p-${id}`);
        const route = parseRoute(location);
        if (route.kind === 'profile' || route.kind === 'boat' || route.kind === 'group' || route.kind === 'harbor') {
          Object.assign(page, { hidden: true, loading: false });
          await this.ui.openPage(route);
          return await this.revealAnchor(key);
        }
      }
      page.data = { kind: 'post', ...r };
      page.highlight = id;
      document.title = 'Beitrag · Sail Explorer';
    } catch (e) {
      page.error = e instanceof ApiError && e.status === 404 ? 'Diesen Beitrag gibt es nicht (mehr) – oder du darfst ihn nicht sehen.' : errorText(e);
    } finally {
      page.loading = false;
    }
  }

  /** Anker `#p-<id>` der Adresse: Karte im Verlauf finden und hervorheben – sonst die einzelne Karte. */
  async revealAnchor(key?: string): Promise<void> {
    const id = anchorPost(location.hash);
    if (!id) return;
    if (await this.reveal(id)) return;
    history.replaceState(null, '', `/p/${id}${key ? `/${key}` : ''}`);
    await this.open(id, key, true);
  }

  /** Karte im Verlauf der offenen Seite finden – bei Bedarf weitere Seiten laden – und hervorheben. */
  async reveal(id: string): Promise<boolean> {
    await this.ui.ready();
    for (let n = 0; n <= MAX_PAGES; n++) {
      const list = this.list();
      if (!list) return false;
      if (list.ids().includes(id)) {
        list.mark(id);
        return true;
      }
      if (!list.hasMore() || n === MAX_PAGES) return false;
      await list.more();
    }
    return false;
  }

  /** Die Beitragsliste der offenen Seite (Gruppe, Hafen, Boot, eigene Seite, Profil für Besucher). */
  private list(): PostList | null {
    const gp = this.ui.groupPage;
    if (!gp.hidden) return { ids: () => postIds(gp.stream?.items), hasMore: () => !!gp.stream?.cursor, more: this.ui.more.group, mark: (id) => (gp.highlight = id) };
    const page = this.ui.page;
    const mark = (id: string) => (page.highlight = id);
    const stream = () => {
      const d = page.data;
      return d?.kind === 'harbor' || d?.kind === 'boat' ? d.stream : null;
    };
    const d = page.data;
    if (d?.kind === 'harbor' || d?.kind === 'boat') {
      return { ids: () => postIds(stream()?.items), hasMore: () => !!stream()?.cursor, more: d.kind === 'harbor' ? this.ui.more.harbor : this.ui.more.boat, mark };
    }
    if (d?.kind === 'profile' && d.profile.isSelf) {
      return { ids: () => (page.myPosts?.items ?? []).map((p) => p.id), hasMore: () => !!page.myPosts?.cursor, more: this.ui.more.own, mark };
    }
    if (d?.kind === 'profile') return { ids: () => (d.posts ?? []).map((p) => p.id), hasMore: () => false, more: async () => undefined, mark };
    return null;
  }
}
