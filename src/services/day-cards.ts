// Tageskarten in der Oberfläche (Konzept 28, F-466, F-468): Seiten aneinanderhängen und „Alle anzeigen“ – rein, ohne
// DOM und Netz; der aufgeklappte Zustand gehört nur dem Client, nicht dem Domain- bzw. API-Typ.
import type { StreamItem } from '../domain/groups';
import { mergeDayCards, type DayCard } from '../domain/large-groups';

/** Tageskarte, wie sie die Oberfläche hält: aufgeklappt mit geladenen Einträgen und Cursor für „Weitere laden“. */
export interface ShownDay extends DayCard {
  open?: { items: StreamItem[]; cursor: string | null };
}

/** Karten der nächsten Seite anhängen; eine Fortsetzung desselben Tages (`continued`) wird mit dessen Karte vereint. */
export function appendDays(prev: readonly ShownDay[], next: readonly DayCard[] = []): ShownDay[] {
  const out = [...prev];
  for (const d of next) {
    const at = d.continued ? out.findIndex((p) => p.day === d.day) : -1;
    if (at >= 0) out[at] = { ...mergeDayCards(out[at], d), ...(out[at].open ? { open: out[at].open } : {}) };
    else out.push(d);
  }
  return out;
}

/** Eine Seite „Alle anzeigen“ in die Tageskarte `key` übernehmen (erste Seite ersetzt, weitere hängen an). */
export function withDayPage(days: readonly ShownDay[], key: string, page: { items: StreamItem[]; cursor: string | null }, append: boolean): ShownDay[] {
  return days.map((d) => (d.day === key ? { ...d, open: { items: [...(append && d.open ? d.open.items : []), ...page.items], cursor: page.cursor } } : d));
}
