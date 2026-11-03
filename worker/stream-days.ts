// Tageszusammenfassung beim Lesen (Konzept 28, F-466 … F-468): blättert geprüfte Kandidaten tageweise und fasst ältere
// Tage großer Verläufe zu Tageskarten zusammen. Ohne Worker-APIs – Prüfen, Nachladen, Rangfolge und Reaktionen kommen
// als Funktionen herein (worker/stream.ts), damit sich der Cursor über Tagesgrenzen ohne Datenbank testen lässt.
import { STREAM_PAGE, encodeCursor, type StreamCursor, type StreamItem } from '../src/domain/groups';
import { DAY_CURSOR_ID, DAY_SCAN, berlinDay, shouldSummarizeDay, summarizeDay, type BerlinDay, type DayCard } from '../src/domain/large-groups';

export interface Candidate {
  id: string;
  at: number;
}

/** Ein geprüfter Kandidat: Eintrag (null = für diesen Betrachter unsichtbar) und ob er einzeln bleibt (F-467). */
export interface Shaped {
  c: Candidate;
  item: StreamItem | null;
  single: boolean;
}

export interface DayPageDeps {
  /** Kandidaten prüfen (Reihenfolge bleibt) */
  shape: (cs: Candidate[]) => Promise<Shaped[]>;
  /** weitere Kandidaten desselben Tages nach `after` (neueste zuerst, höchstens `limit`) */
  rest: (day: BerlinDay, after: Candidate, limit: number) => Promise<Candidate[]>;
  /** Beachtung je Eintrag (Summe der Reaktionen) für die Vorschau – nur Zahlen, ohne eigene Reaktion */
  score: (items: StreamItem[]) => Promise<Map<string, number>>;
  /** Reaktionen an die gezeigten Einträge hängen (Einzelne und Vorschau) */
  react: (items: StreamItem[]) => Promise<void>;
}

export interface DayPageOut {
  items: StreamItem[];
  days: DayCard[];
  cursor: string | null;
}

/**
 * Eine Seite eines Verlaufs mit Tageskarten. Der laufende Tag (ab 0:00 Europe/Berlin von `now`) bleibt einzeln mit
 * Cursor je Eintrag; jeder ältere Tag wird vollständig behandelt – endet die Kandidatenliste mitten im Tag, wird er bis
 * 0:00 nachgeladen – und die Seite endet an seiner Grenze (`<Tagesbeginn>_000000000000`). Hat ein Tag mehr als DAY_SCAN
 * Kandidaten, endet die Seite beim letzten geprüften; die nächste Seite setzt den Tag als Fortsetzung fort (immer
 * Karte, `continued`), die Oberfläche legt beide Karten zusammen. Steht der Cursor `from` mitten in einem älteren Tag
 * (Fortsetzung oder ein laufender Tag, der seit der letzten Seite vergangen ist), gilt der Rest des Tages ebenso als
 * Fortsetzung. So geht kein Eintrag verloren und kein Eintrag erscheint zweimal (F-468). Eine Tageskarte zählt wie ein
 * Eintrag zur Seitengröße; die Einzelnen eines Tages kommen immer ganz mit (eine Seite kann länger werden).
 */
export async function pageByDays(candidates: Candidate[], scanned: number, now: number, large: boolean, from: StreamCursor | null, deps: DayPageDeps): Promise<DayPageOut> {
  const today = berlinDay(now).start;
  // Fortsetzung eines älteren Tages: Cursor mitten im Tag (nicht an seiner Grenze)
  const midDay = from && from.at < today && from.id !== DAY_CURSOR_ID ? berlinDay(from.at) : null;
  const shaped = await deps.shape(candidates);
  const items: StreamItem[] = [];
  const pooled: Array<{ day: BerlinDay; items: StreamItem[]; more: boolean; continued: boolean }> = [];
  let cursor: StreamCursor | null = null;
  const full = () => items.length + pooled.length >= STREAM_PAGE;
  let i = 0;
  while (i < shaped.length && !full()) {
    const s = shaped[i];
    if (s.c.at >= today) {
      i++;
      cursor = { at: s.c.at, id: s.c.id };
      if (s.item) items.push(s.item);
      continue;
    }
    const day = berlinDay(s.c.at);
    let j = i;
    while (j < shaped.length && shaped[j].c.at >= day.start) j++;
    let group = shaped.slice(i, j);
    let more = false;
    if (j === shaped.length && candidates.length >= scanned) {
      // Kandidatenliste endet in diesem Tag: bis 0:00 vervollständigen (eine mehr, um die Kappung zu erkennen)
      const room = Math.max(0, DAY_SCAN - group.length);
      const extra = await deps.rest(day, group[group.length - 1].c, room + 1);
      more = extra.length > room;
      group = group.concat(await deps.shape(extra.slice(0, room)));
    }
    i = j;
    const last = group[group.length - 1].c;
    // gekappt: weiter beim letzten geprüften Kandidaten, sonst an der Tagesgrenze
    cursor = more ? { at: last.at, id: last.id } : { at: day.start, id: DAY_CURSOR_ID };
    const continued = midDay?.key === day.key;
    const visible = group.filter((g) => g.item);
    const pool = visible.filter((g) => !g.single);
    const forced = more || continued;
    if (pool.length >= (forced ? 1 : 2) && shouldSummarizeDay({ large, visible: visible.length, capped: forced })) {
      pooled.push({ day, items: pool.map((g) => g.item!), more, continued });
      items.push(...visible.filter((g) => g.single).map((g) => g.item!));
    } else items.push(...visible.map((g) => g.item!));
    if (more) break;
  }
  // Rangfolge über alle Zusammengefassten nur als Zahl; volle Reaktionen nur für das, was gezeigt wird
  const scores = pooled.length ? await deps.score(pooled.flatMap((p) => p.items)) : new Map<string, number>();
  const days = pooled.map((p) => ({ ...summarizeDay(p.day, p.items, p.more, (x) => scores.get(x.id) ?? 0), ...(p.continued ? { continued: true } : {}) }));
  await deps.react([...items, ...days.flatMap((d) => d.top)]);
  // Seite geht weiter: abgebrochen, weil voll bzw. gekappt, oder die Kandidatenliste war voll
  const goesOn = i < shaped.length || candidates.length >= scanned;
  return { items, days, cursor: goesOn && cursor ? encodeCursor(cursor) : null };
}
