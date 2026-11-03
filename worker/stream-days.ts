// Tageszusammenfassung beim Lesen (Konzept 28, F-466 … F-468): blättert geprüfte Kandidaten tageweise und fasst ältere
// Tage großer Verläufe zu Tageskarten zusammen. Ohne Worker-APIs – Prüfen, Nachladen und Reaktionen kommen als
// Funktionen herein (worker/stream.ts), damit sich der Cursor über Tagesgrenzen ohne Datenbank testen lässt.
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
  /** Reaktionen an die Einträge hängen */
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
 * 0:00 nachgeladen – und die Seite endet an seiner Grenze (`<Tagesbeginn>_000000000000`). So erscheint kein Tag zweimal
 * und kein Eintrag geht verloren (F-468). Eine Tageskarte zählt wie ein Eintrag zur Seitengröße.
 */
export async function pageByDays(candidates: Candidate[], scanned: number, now: number, large: boolean, deps: DayPageDeps): Promise<DayPageOut> {
  const today = berlinDay(now).start;
  const shaped = await deps.shape(candidates);
  const items: StreamItem[] = [];
  const pooled: Array<{ day: BerlinDay; items: StreamItem[]; more: boolean }> = [];
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
    cursor = { at: day.start, id: DAY_CURSOR_ID };
    const visible = group.filter((g) => g.item);
    const pool = visible.filter((g) => !g.single);
    if (pool.length >= 2 && shouldSummarizeDay({ large, visible: visible.length, capped: more })) {
      pooled.push({ day, items: pool.map((g) => g.item!), more });
      items.push(...visible.filter((g) => g.single).map((g) => g.item!));
    } else items.push(...visible.map((g) => g.item!));
  }
  await deps.react([...items, ...pooled.flatMap((p) => p.items)]);
  // Seite geht weiter: abgebrochen, weil voll, oder die Kandidatenliste war voll
  const goesOn = i < shaped.length || candidates.length >= scanned;
  return { items, days: pooled.map((p) => summarizeDay(p.day, p.items, p.more)), cursor: goesOn && cursor ? encodeCursor(cursor) : null };
}

/**
 * „Alle anzeigen“ (F-468): die zusammengefassten Einträge eines Tages einzeln – Einzelne (F-467) stehen schon im
 * Stream. Cursor je Eintrag wie im normalen Stream.
 */
export async function dayEntries(candidates: Candidate[], scanned: number, deps: Pick<DayPageDeps, 'shape' | 'react'>): Promise<{ items: StreamItem[]; cursor: string | null }> {
  const shaped = await deps.shape(candidates);
  const items: StreamItem[] = [];
  let last: Candidate | null = null;
  for (const s of shaped) {
    last = s.c;
    if (s.item && !s.single) items.push(s.item);
    if (items.length >= STREAM_PAGE) break;
  }
  await deps.react(items);
  const more = items.length >= STREAM_PAGE || candidates.length >= scanned;
  return { items, cursor: more && last ? encodeCursor({ at: last.at, id: last.id }) : null };
}
