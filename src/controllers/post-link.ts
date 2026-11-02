// `/p/<id>` und Anker `#p-<id>` (Konzept 21.4, F-406): Beiträge haben keine eigene Seite. Steht die Karte im
// Heimatverlauf, geht es dorthin (Adresse ersetzt, Anker), die Karte wird nachgeladen, falls sie nicht auf der ersten
// Seite steht, und kurz hervorgehoben. Sonst – Verlauf nicht sichtbar, „Nur mit Link“ oder zu weit unten – die einzelne
// Karte. Die Listen der Seiten kennt der Controller nur über die Adapter aus app.ts.
import { postApi, type StreamItem } from '../services/api';
import type { PostLink } from '../domain/posts';

/** Eine Liste mit Beiträgen auf der offenen Seite (Gruppe, Hafen, Boot, Profil, „Mein Verlauf“). */
export interface PostList {
  ids: () => string[];
  /** es gibt weitere Seiten */
  hasMore: () => boolean;
  more: () => Promise<void>;
  mark: (id: string) => void;
}

/** Höchstens so viele Seiten nachladen, bevor die einzelne Karte gezeigt wird. */
const MAX_PAGES = 5;

/** Anker `#p-<id>` aus der Adresse. */
export const anchorPost = (hash: string): string | null => /^#p-([A-Za-z0-9]{12,32})$/.exec(hash)?.[1] ?? null;

export class PostLinkController {
  constructor(private ui: { list: () => PostList | null; ready: () => Promise<void> }) {}

  /** Karte und Ziel holen (404, wenn der Betrachter sie nicht sehen darf). */
  load(id: string, key?: string | null): Promise<{ item: StreamItem; link: PostLink }> {
    return postApi.get(id, key);
  }

  /**
   * Karte im Verlauf der offenen Seite finden – bei Bedarf weitere Seiten laden – und hervorheben. false: nicht
   * gefunden (der Aufrufer zeigt die einzelne Karte).
   */
  async reveal(id: string): Promise<boolean> {
    await this.ui.ready();
    for (let page = 0; page <= MAX_PAGES; page++) {
      const list = this.ui.list();
      if (!list) return false;
      if (list.ids().includes(id)) {
        list.mark(id);
        return true;
      }
      if (!list.hasMore() || page === MAX_PAGES) return false;
      await list.more();
    }
    return false;
  }
}
