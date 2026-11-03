// Arten von Beiträgen, die man über „+ Neu“ anlegt (Konzept 21.2, 21.4, 29): je Art eine Zeile – Länge des Texts
// (`body`, bei Umfragen die Frage), ob Link und angehängter Törn erlaubt sind, und die geprüfte Nutzlast für
// `posts.data`. Alles andere (Verlauf, Sichtbarkeit, „Sichtbar bis“, Tagesgrenze, Stream, Pins, Löschen) kommt vom Dach
// in worker/posts.ts. Neue Arten (Veranstaltung …) ergänzen hier eine Zeile.
import { HttpError } from './http';
import { POST_MAX } from '../src/domain/groups';
import { POLL_LIMITS, readPollConfig } from '../src/domain/polls';
import type { PostKind } from '../src/domain/posts';

export interface ComposeKindDef {
  /** höchstens so viele Zeichen im `body` */
  bodyMax: number;
  /** nur Text: kein Link, kein angehängter Törn */
  plain: boolean;
  /** Nutzlast aus der Anfrage (`raw[kind]`) prüfen – Fehler als HttpError 400 */
  data?: (raw: unknown, now: number) => Record<string, unknown>;
}

export const COMPOSE_KINDS: Partial<Record<PostKind, ComposeKindDef>> = {
  text: { bodyMax: POST_MAX, plain: false },
  poll: {
    bodyMax: POLL_LIMITS.question,
    plain: true,
    data: (raw, now) => {
      const c = readPollConfig(raw, now);
      if ('error' in c) throw new HttpError(400, c.error, c.message);
      return { poll: c };
    },
  },
};
