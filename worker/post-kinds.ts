// Arten von Beiträgen, die man über „+ Neu“ anlegt (Konzept 21.2, 21.4, 29): je Art eine Zeile – Länge des Texts
// (`body`, bei Umfragen die Frage), ob Link und angehängter Törn erlaubt sind, und die geprüfte Nutzlast für
// `posts.data`. Alles andere (Verlauf, Sichtbarkeit, „Sichtbar bis“, Tagesgrenze, Stream, Pins, Löschen) kommt vom Dach
// in worker/posts.ts. Neue Arten (Veranstaltung …) ergänzen hier eine Zeile. Rein, ohne Worker-APIs (genutzt von der
// reinen Stream-Prüfung worker/stream-shape.ts).
import { isPollOpen, parsePollData, readPollConfig } from '../src/domain/polls';
import { COMPOSE_LIMITS, type ComposePostKind, type PostPhoto } from '../src/domain/posts';
import type { StreamItem } from '../src/domain/groups';

/** Nutzlast einer Art an der Stream-Karte (Teil von `StreamItem.post`), für alle Lesenden gleich. */
type KindPayload = Partial<NonNullable<StreamItem['post']>>;

export interface ComposeKindDef {
  /** Nutzlast aus der Anfrage (`raw[kind]`) prüfen – Fehler mit Code und Text (der Worker antwortet 400) */
  data?: (raw: unknown, now: number) => Record<string, unknown> | { error: string; message: string };
  /**
   * gespeicherte Nutzlast (`posts.data`) als Teil der Karte; null = kaputt → keine Karte (fail closed). `photos`:
   * sichtbare Galerie-Fotos als JSON aus derselben Abfrage (`p_photos` in worker/stream.ts, Konzept 31)
   */
  view?: (data: string | null | undefined, now: number, photos?: string | null) => KindPayload | null;
}

/** Grenzen (`bodyMax`, `plain`) stehen einmal in `COMPOSE_LIMITS` (src/domain/posts.ts). */
export const COMPOSE_KINDS: Record<ComposePostKind, ComposeKindDef> = {
  text: {},
  poll: {
    data: (raw, now) => {
      const c = readPollConfig(raw, now);
      return 'error' in c ? c : { poll: c };
    },
    // Stimmen und Ergebnis hängt attachKindData je Betrachter an (worker/stream.ts)
    view: (data, now) => {
      const c = parsePollData(data);
      return c ? { poll: { ...c, open: isPollOpen(c, now), counts: null, voters: null, mine: [], canClose: false } } : null;
    },
  },
  // Galerie (Konzept 31): Fotos aus `photos.post_id`, schon vor dem Formen gelesen (für alle gleich); ohne sichtbares
  // Foto keine Karte. Hochladen, Kontingent und Löschen: worker/post-photos.ts
  gallery: { view: (_data, _now, photos) => galleryView(photos) },
};

/** Sichtbare Fotos eines Galerie-Beitrags aus dem JSON der Abfrage – leer oder kaputt → null (keine Karte). */
function galleryView(raw: string | null | undefined): KindPayload | null {
  try {
    const list = JSON.parse(raw ?? '[]') as Array<Record<string, unknown>>;
    const photos: PostPhoto[] = list
      .filter((p) => typeof p.id === 'string' && typeof p.width === 'number' && typeof p.height === 'number')
      .map((p) => ({ id: p.id as string, width: p.width as number, height: p.height as number, caption: typeof p.caption === 'string' ? p.caption : '', takenAt: typeof p.takenAt === 'number' ? p.takenAt : null }));
    return photos.length ? { gallery: { photos } } : null;
  } catch {
    return null;
  }
}

export const isComposeKind = (k: unknown): k is ComposePostKind => typeof k === 'string' && k in COMPOSE_LIMITS;

/**
 * Nutzlast der Art an der Karte (Stream, Einzelkarte, Pins): Text und unbekannte Arten ohne, eine Art mit `view` ihre
 * Angaben – oder null, wenn die gespeicherte Nutzlast kaputt ist (dann keine Karte).
 */
export function kindView(kind: string | null | undefined, data: string | null | undefined, now: number, photos?: string | null): KindPayload | null {
  const view = isComposeKind(kind) ? COMPOSE_KINDS[kind].view : undefined;
  return view ? view(data, now, photos) : {};
}
