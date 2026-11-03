// Große Gruppen (Konzept 28, F-465 … F-468): reine Regeln (src/domain/large-groups.ts) und das Blättern über
// zusammengefasste Tage (worker/stream-days.ts) ohne Datenbank – Prüfen, Nachladen und Reaktionen als Attrappen.
import { describe, expect, it } from 'vitest';
import {
  DAY_CURSOR_ID, DAY_SCAN, audienceHintText, audienceOf, berlinDay, berlinDayKey, dayCardText, dayLabel, dayOfKey, isLargeChannel,
  needsAudienceHint, roundAudience, shouldSummarizeDay, staysSingle, summarizeDay, withDayPage,
} from '../src/domain/large-groups';
import { GROUP_LIMITS } from '../src/domain/limits';
import { STREAM_PAGE, decodeCursor, type StreamItem } from '../src/domain/groups';
import { dayEntries, pageByDays, type Candidate, type Shaped } from '../worker/stream-days';

const H = 3_600_000;

describe('F-465 Publikum', () => {
  it('[F-465] gerundet auf 10, je Sichtbarkeit und „Sichtbar bis“; Hinweis ab 100', () => {
    expect(roundAudience(7)).toBe(7);
    expect(roundAudience(94)).toBe(90);
    expect(roundAudience(95)).toBe(100);
    expect(roundAudience(1234)).toBe(1230);
    const a = { here: 40, club: 120, harbor: 300, members: 30 };
    expect(audienceOf(a, 'public', 'here')).toBe(40);
    expect(audienceOf(a, 'public', 'club')).toBe(120);
    expect(audienceOf(a, 'public', 'all')).toBe(300);
    expect(audienceOf({ here: 40, harbor: 300 }, 'public', 'club')).toBe(40);
    expect(audienceOf({ here: 40 }, 'public', 'all')).toBe(40);
    expect(audienceOf(a, 'members', undefined)).toBe(30);
    expect(audienceOf(a, 'unlisted', 'all')).toBeNull();
    expect(audienceOf(a, 'private', undefined)).toBeNull();
    expect(audienceOf(null, 'public', 'all')).toBeNull();
    expect(GROUP_LIMITS.audienceHint).toBe(100);
    expect(needsAudienceHint(90)).toBe(false);
    expect(needsAudienceHint(100)).toBe(true);
    expect(needsAudienceHint(null)).toBe(false);
    expect(audienceHintText(1230)).toBe('Geht an ca. 1.230 Personen – lieber in einer kleineren Gruppe schreiben?');
  });
});

describe('F-466 Tage und Tageskarte', () => {
  it('[F-466] Tage in Europe/Berlin, auch an der Zeitumstellung', () => {
    // 14.6.2026: Sommerzeit, 0:00 = 22:00 UTC am Vortag
    const d = berlinDay(Date.parse('2026-06-14T10:00:00Z'));
    expect(d).toEqual({ key: '2026-06-14', start: Date.parse('2026-06-13T22:00:00Z'), end: Date.parse('2026-06-14T22:00:00Z') });
    expect(berlinDayKey(Date.parse('2026-06-13T22:30:00Z'))).toBe('2026-06-14');
    // Winter: 0:00 = 23:00 UTC
    expect(dayOfKey('2026-01-10')!.start).toBe(Date.parse('2026-01-09T23:00:00Z'));
    // Umstellung 29.3.2026 (23 h) und 25.10.2026 (25 h)
    const spring = dayOfKey('2026-03-29')!;
    expect(spring.end - spring.start).toBe(23 * H);
    const autumn = dayOfKey('2026-10-25')!;
    expect(autumn.end - autumn.start).toBe(25 * H);
    expect(dayOfKey('2026-02-30')).toBeNull();
    expect(dayOfKey('14.6.2026')).toBeNull();
    expect(dayLabel('2026-06-13')).toBe('Sa, 13.6.');
  });

  it('[F-466] Schwellen aus GROUP_LIMITS: mehr als 150 Mitglieder oder mehr als 15 Einträge', () => {
    expect(isLargeChannel(150)).toBe(false);
    expect(isLargeChannel(151)).toBe(true);
    expect(shouldSummarizeDay({ large: false, visible: 15, capped: false })).toBe(false);
    expect(shouldSummarizeDay({ large: false, visible: 16, capped: false })).toBe(true);
    expect(shouldSummarizeDay({ large: true, visible: 2, capped: false })).toBe(true);
    expect(shouldSummarizeDay({ large: false, visible: 1, capped: true })).toBe(true);
  });

  it('[F-466] Zähler je Art, die drei meistbeachteten (bei Gleichstand die neuesten), Text', () => {
    const r = (n: number) => ({ subject: 'post' as const, id: 'x', counts: { like: n, mast: 0, tack: 0 }, mine: null });
    const items = [
      { id: 'a', kind: 'voyage', createdAt: 5, actor: null, group: null, voyage: { id: 's1', title: 'T', distNm: 12.4, startedAt: null, hasImage: false, boat: null }, reactions: r(1) },
      { id: 'b', kind: 'photos', createdAt: 4, actor: null, group: null, photos: { count: 6, thumbs: [] }, reactions: r(0) },
      { id: 'c', kind: 'post', createdAt: 3, actor: null, group: null, reactions: r(5) },
      { id: 'd', kind: 'member', createdAt: 2, actor: null, group: null },
      { id: 'e', kind: 'logbook', createdAt: 1, actor: null, group: null, logbook: { count: 2, distNm: 30, voyages: [] }, reactions: r(1) },
      { id: 'f', kind: 'milestone', createdAt: 0, actor: null, group: null },
    ] as StreamItem[];
    const c = summarizeDay(dayOfKey('2026-06-13')!, items);
    expect(c).toMatchObject({ day: '2026-06-13', count: 6, voyages: 3, photos: 6, posts: 1, members: 1, other: 1, more: false });
    expect(c.distNm).toBeCloseTo(42.4);
    expect(c.at).toBe(dayOfKey('2026-06-13')!.end - 1);
    expect(c.top.map((i) => i.id)).toEqual(['c', 'a', 'e']);
    expect(dayCardText(c)).toBe('Sa, 13.6. – 3 Törns (42 sm), 6 Fotos, 1 Beitrag, 1 neues Mitglied, 1 weiterer Eintrag');
    expect(dayCardText({ ...c, voyages: 0, photos: 0, posts: 2, members: 0, other: 0, more: true })).toBe('Sa, 13.6. – 2 Beiträge und mehr');
  });
});

describe('F-467 Nie zusammengefasst', () => {
  it('[F-467] eigene, von Verwaltern, Umfragen und Veranstaltungen bleiben einzeln', () => {
    expect(staysSingle({ own: false, byManager: false, postKind: 'text' })).toBe(false);
    expect(staysSingle({ own: true, byManager: false })).toBe(true);
    expect(staysSingle({ own: false, byManager: true })).toBe(true);
    expect(staysSingle({ own: false, byManager: false, postKind: 'poll' })).toBe(true);
    expect(staysSingle({ own: false, byManager: false, postKind: 'event' })).toBe(true);
    expect(staysSingle({ own: false, byManager: false, postKind: null })).toBe(false);
  });
});

// ---------------------------------------------------------------- Blättern (F-468)

const NOW = Date.parse('2026-06-20T10:00:00Z');
const dayStart = (key: string) => dayOfKey(key)!.start;
let seq = 0;
const cid = () => `C${String(++seq).padStart(15, '0')}`;

/** Kandidaten: je Tag `n` Einträge (ab 12:00 Ortszeit, minütlich rückwärts), neueste zuerst wie aus der Datenbank. */
function world(days: Array<[string, number]>, single: (c: Candidate, i: number) => boolean = () => false) {
  const all: Candidate[] = [];
  for (const [key, n] of days) for (let i = 0; i < n; i++) all.push({ id: cid(), at: dayStart(key) + 12 * H - i * 60_000 });
  all.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const singles = new Set(all.filter(single).map((c) => c.id));
  const after = (c: { at: number; id: string }) => (x: Candidate) => x.at < c.at || (x.at === c.at && x.id < c.id);
  const deps = {
    shape: async (cs: Candidate[]): Promise<Shaped[]> =>
      cs.map((c) => ({ c, item: { id: c.id, kind: 'post', createdAt: c.at, actor: null, group: null } as StreamItem, single: singles.has(c.id) })),
    rest: async (day: { start: number }, last: Candidate, limit: number) => all.filter(after(last)).filter((x) => x.at >= day.start).slice(0, limit),
    react: async () => undefined,
  };
  const scan = 60;
  /** Alle Seiten abholen, bis kein Cursor mehr kommt. */
  async function pages(large = false) {
    const out = [];
    let cur = { at: Number.MAX_SAFE_INTEGER, id: '~' };
    for (let guard = 0; guard < 50; guard++) {
      const cands = all.filter(after(cur)).slice(0, scan);
      const p = await pageByDays(cands, scan, NOW, large, deps);
      out.push(p);
      if (!p.cursor) break;
      cur = decodeCursor(p.cursor)!;
    }
    return out;
  }
  return { all, deps, pages, after, scan };
}

describe('F-468 Cursor über zusammengefasste Tage', () => {
  it('[F-468] jeder Tag genau einmal, kein Eintrag verloren, Seiten enden an Tagesgrenzen', async () => {
    const keys = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 5, 19 - i)).toISOString().slice(0, 10));
    const w = world([['2026-06-20', 3], ...keys.map((k, i) => [k, i % 3 === 0 ? 17 : 4] as [string, number])]);
    const pages = await w.pages();
    const days = pages.flatMap((p) => p.days.map((d) => d.day));
    expect(new Set(days).size).toBe(days.length);
    expect(days).toEqual(keys.filter((_, i) => i % 3 === 0));
    // jeder Eintrag steht genau einmal – einzeln oder gezählt in einer Karte
    const single = pages.flatMap((p) => p.items.map((i) => i.id));
    expect(new Set(single).size).toBe(single.length);
    expect(single.length + pages.flatMap((p) => p.days).reduce((s, d) => s + d.count, 0)).toBe(w.all.length);
    // laufender Tag einzeln, danach Grenzen „<Tagesbeginn>_000000000000“
    expect(pages[0].items.slice(0, 3).every((i) => i.createdAt >= dayStart('2026-06-20'))).toBe(true);
    for (const p of pages.slice(0, -1)) {
      const c = decodeCursor(p.cursor)!;
      expect(c.id).toBe(DAY_CURSOR_ID);
      expect(berlinDayKey(c.at)).toBe(berlinDayKey(c.at + 1));
      expect(dayStart(berlinDayKey(c.at))).toBe(c.at);
      expect(p.items.length + p.days.length).toBeLessThanOrEqual(STREAM_PAGE + 16);
    }
    expect(pages.at(-1)!.cursor).toBeNull();
  });

  it('[F-468] ein Tag, der über die Kandidatenliste hinausgeht, wird bis 0:00 vervollständigt; über DAY_SCAN gekappt', async () => {
    const w = world([['2026-06-18', 70], ['2026-06-17', 2]]);
    const [first, second] = await w.pages();
    expect(first.days).toHaveLength(1);
    expect(first.days[0]).toMatchObject({ day: '2026-06-18', count: 70, more: false });
    expect(decodeCursor(first.cursor)).toEqual({ at: dayStart('2026-06-18'), id: DAY_CURSOR_ID });
    expect(second.items).toHaveLength(2);
    expect(second.cursor).toBeNull();
    const big = world([['2026-06-18', DAY_SCAN + 5]]);
    const [p] = await big.pages();
    expect(p.days[0]).toMatchObject({ count: DAY_SCAN, more: true });
  });

  it('[F-468] laufender Tag: Cursor je Eintrag, volle Seite bricht mitten im Tag ab', async () => {
    const w = world([['2026-06-20', 25], ['2026-06-19', 17]]);
    const [first, second, third] = await w.pages();
    expect(first.items).toHaveLength(STREAM_PAGE);
    expect(first.days).toHaveLength(0);
    expect(decodeCursor(first.cursor)!.id).not.toBe(DAY_CURSOR_ID);
    expect(second.items).toHaveLength(5);
    expect(second.days.map((d) => d.day)).toEqual(['2026-06-19']);
    expect(third).toBeUndefined();
  });

  it('[F-467] Einzelne stehen neben der Karte; zu wenige Zusammenfassbare ergeben keine Karte', async () => {
    const w = world([['2026-06-18', 17]], (_, i) => i < 2);
    const [p] = await w.pages();
    expect(p.days[0].count).toBe(15);
    expect(p.items).toHaveLength(2);
    const v = world([['2026-06-18', 17]], (_, i) => i < 16);
    const [q] = await v.pages();
    expect(q.days).toHaveLength(0);
    expect(q.items).toHaveLength(17);
    // großer Verlauf: schon zwei Einträge werden zur Karte
    const l = world([['2026-06-18', 2]]);
    expect((await l.pages(true))[0].days[0].count).toBe(2);
    expect((await l.pages(false))[0].days).toHaveLength(0);
  });

  it('[F-468] „Alle anzeigen“: Einträge des Tages ohne Einzelne, Cursor je Eintrag; Seite in die Karte übernehmen', async () => {
    const w = world([['2026-06-18', 25]], (_, i) => i === 0);
    const day = w.all.filter((c) => c.at >= dayStart('2026-06-18'));
    const p1 = await dayEntries(day.slice(0, w.scan), w.scan, w.deps);
    expect(p1.items).toHaveLength(STREAM_PAGE);
    expect(p1.items.map((i) => i.id)).not.toContain(day[0].id);
    const rest = day.filter(w.after(decodeCursor(p1.cursor)!));
    const p2 = await dayEntries(rest, w.scan, w.deps);
    expect(p2.items).toHaveLength(4);
    expect(p2.cursor).toBeNull();
    const card = summarizeDay(dayOfKey('2026-06-18')!, []);
    const opened = withDayPage([card], '2026-06-18', p1, false);
    expect(opened[0].open!.items).toHaveLength(20);
    expect(withDayPage(opened, '2026-06-18', p2, true)[0].open).toEqual({ items: [...p1.items, ...p2.items], cursor: null });
  });
});
