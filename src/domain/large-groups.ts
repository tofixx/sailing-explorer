// Große Gruppen (Konzept 28, 21.7.1, B8, F-465 … F-469): Publikums-Hinweis vor dem Posten und Tageszusammenfassung
// großer Verläufe beim Lesen – reine Regeln ohne DOM und Netz. Schwellen nur in GROUP_LIMITS (src/domain/limits.ts).
import { GROUP_LIMITS } from './limits';
import { fmtNum } from './format';
import type { StreamItem } from './groups';
import type { PostKind, PostVisibility, Reach } from './posts';

// ---------------------------------------------------------------- Publikum beim Schreiben (F-465)

/**
 * Wem ein Beitrag im persönlichen Stream erscheint, je Stufe der Kette (kumuliert, auf 10 gerundet): `here` nur der
 * Heimatverlauf, `club`/`harbor` bis dorthin, `members` „Nur Mitglieder“ (nur Gruppen). Fehlende Stufen gibt es im
 * Verlauf nicht. „Überall“ zählt wie die höchste Stufe – „Alles“ und „Umgebung“ liest man aktiv (Konzept 28.2).
 */
export type Audience = Partial<Record<'here' | 'club' | 'harbor' | 'members', number>>;

/** Ungefähre Zahl (≈ 10er), unter 10 genau – keine genaue Mitgliederzahl, keine Namen. */
export const roundAudience = (n: number): number => (n < 10 ? Math.max(0, n) : Math.round(n / 10) * 10);

/** Publikum der gewählten Kombination – null, wenn es kein Publikum im Stream gibt („Nur mit Link“, „Nur ich“). */
export function audienceOf(a: Audience | null | undefined, visibility: PostVisibility, reach: Reach | undefined): number | null {
  if (!a) return null;
  if (visibility === 'members') return a.members ?? null;
  if (visibility !== 'public') return null;
  const order: Array<'here' | 'club' | 'harbor'> = ['here', 'club', 'harbor'];
  const upTo = reach === 'all' || reach === undefined ? 2 : Math.max(0, order.indexOf(reach as 'here' | 'club' | 'harbor'));
  for (let i = upTo; i >= 0; i--) if (a[order[i]] !== undefined) return a[order[i]]!;
  return null;
}

/** Hinweis zeigen? Ab GROUP_LIMITS.audienceHint Personen. */
export const needsAudienceHint = (n: number | null): n is number => n !== null && n >= GROUP_LIMITS.audienceHint;

export const audienceHintText = (n: number): string => `Geht an ca. ${fmtNum(n, 0)} Personen – lieber in einer kleineren Gruppe schreiben?`;

// ---------------------------------------------------------------- Tage in Ortszeit (F-466)

/** Ein Kalendertag in Europe/Berlin: Schlüssel YYYY-MM-DD, Beginn (inkl.) und Ende (exkl.) in ms. */
export interface BerlinDay {
  key: string;
  start: number;
  end: number;
}

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const berlinFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Tag eines Zeitpunkts in Europe/Berlin (YYYY-MM-DD). */
export const berlinDayKey = (ms: number): string => berlinFmt.format(new Date(ms));

/**
 * 0:00 Uhr Ortszeit eines Tages. Berlin liegt UTC+1 bzw. +2, Mitternacht also 22:00 oder 23:00 UTC am Vortag; die
 * Umstellung liegt um 2/3 Uhr, Mitternacht hat immer den Versatz des Vortags.
 */
function startOf(y: number, m: number, d: number): number {
  const utc = Date.UTC(y, m - 1, d);
  const key = new Date(utc).toISOString().slice(0, 10);
  return berlinDayKey(utc - 2 * 3_600_000) === key ? utc - 2 * 3_600_000 : utc - 3_600_000;
}

/** Tag aus einem Schlüssel – null bei ungültigem Datum. */
export function dayOfKey(key: string | null | undefined): BerlinDay | null {
  const m = DAY_KEY_RE.exec(key ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { key: key!, start: startOf(y, mo, d), end: startOf(y, mo, d + 1) };
}

/** Tag, in dem ein Zeitpunkt liegt. */
export const berlinDay = (ms: number): BerlinDay => dayOfKey(berlinDayKey(ms))!;

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „Sa, 14.6.“ */
export function dayLabel(key: string): string {
  const m = DAY_KEY_RE.exec(key);
  if (!m) return key;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).getUTCDay();
  return `${WEEKDAY[wd]}, ${Number(m[3])}.${Number(m[2])}.`;
}

// ---------------------------------------------------------------- Zusammenfassen (F-466 … F-468)

/**
 * ID-Teil des Cursors an einer Tagesgrenze: `<Tagesbeginn>_000000000000` schließt alles ab 0:00 aus (IDs sind
 * alphanumerisch, „0“ ist das kleinste Zeichen) – Seiten enden bei älteren Tagen immer an einer Tagesgrenze (F-468).
 */
export const DAY_CURSOR_ID = '000000000000';

/** Höchstens so viele Kandidaten je zusammengefasstem Tag; darüber „300+“ und immer Tageskarte. */
export const DAY_SCAN = 300;

/** Großer Verlauf: mehr als GROUP_LIMITS.summaryMembers Mitglieder bzw. Boote (F-466). */
export const isLargeChannel = (members: number): boolean => members > GROUP_LIMITS.summaryMembers;

/** Wird ein älterer Tag zur Tageskarte? Großer Verlauf, mehr als summaryPerDay sichtbare Einträge oder gekappt. */
export const shouldSummarizeDay = (d: { large: boolean; visible: number; capped: boolean }): boolean =>
  d.capped || d.large || d.visible > GROUP_LIMITS.summaryPerDay;

/** Beitrags-Arten, die laufen und nie in einer Tageskarte verschwinden (ab Phase 4/5). */
export const NEVER_SUMMARIZED_POSTS: readonly PostKind[] = ['poll', 'event'];

/** Bleibt ein Eintrag einzeln (F-467)? Eigene, von Verwaltern des Verlaufs, Umfragen und Veranstaltungen. */
export function staysSingle(e: { own: boolean; byManager: boolean; postKind?: string | null }): boolean {
  return e.own || e.byManager || (!!e.postKind && (NEVER_SUMMARIZED_POSTS as readonly string[]).includes(e.postKind));
}

/** Tageskarte (F-466): Zähler aus geprüften Einträgen, Vorschau der meistbeachteten. */
export interface DayCard {
  day: string;
  /** Sortierschlüssel im Stream: letzte Millisekunde des Tages (die Karte steht über den Einzelnen des Tages) */
  at: number;
  count: number;
  /** mehr als DAY_SCAN Kandidaten – Zähler sind Untergrenzen */
  more: boolean;
  voyages: number;
  distNm: number;
  photos: number;
  posts: number;
  members: number;
  other: number;
  top: StreamItem[];
  /** aufgeklappt („Alle anzeigen“): geladene Einträge und Cursor für „Weitere laden“ – nur in der Oberfläche */
  open?: { items: StreamItem[]; cursor: string | null };
}

const reactionTotal = (i: StreamItem): number => (i.reactions ? Object.values(i.reactions.counts).reduce((s, n) => s + n, 0) : 0);

/** Tageskarte aus den sichtbaren, zusammengefassten Einträgen eines Tages (neueste zuerst). */
export function summarizeDay(day: BerlinDay, items: StreamItem[], more = false): DayCard {
  const c: DayCard = { day: day.key, at: day.end - 1, count: items.length, more, voyages: 0, distNm: 0, photos: 0, posts: 0, members: 0, other: 0, top: [] };
  for (const i of items) {
    if (i.kind === 'voyage' && i.voyage) {
      c.voyages++;
      c.distNm += i.voyage.distNm;
    } else if (i.kind === 'logbook' && i.logbook) {
      c.voyages += i.logbook.count;
      c.distNm += i.logbook.distNm;
    } else if (i.kind === 'photos') c.photos += i.photos?.count ?? 0;
    else if (i.kind === 'post') c.posts++;
    else if (i.kind === 'member') c.members++;
    else c.other++;
  }
  // stabil sortiert: bei Gleichstand bleibt die Reihenfolge (neueste zuerst)
  c.top = items
    .map((i, n) => ({ i, n, r: reactionTotal(i) }))
    .sort((a, b) => b.r - a.r || a.n - b.n)
    .slice(0, 3)
    .map((x) => x.i);
  return c;
}

const count = (n: number, one: string, many: string) => `${fmtNum(n, 0)} ${n === 1 ? one : many}`;

/** „Sa, 14.6. – 6 Törns (212 sm), 18 Fotos, 3 Beiträge, 2 neue Mitglieder“ */
export function dayCardText(c: DayCard): string {
  const parts = [
    c.voyages ? `${count(c.voyages, 'Törn', 'Törns')} (${fmtNum(c.distNm, 0)} sm)` : '',
    c.photos ? count(c.photos, 'Foto', 'Fotos') : '',
    c.posts ? count(c.posts, 'Beitrag', 'Beiträge') : '',
    c.members ? count(c.members, 'neues Mitglied', 'neue Mitglieder') : '',
    c.other ? count(c.other, 'weiterer Eintrag', 'weitere Einträge') : '',
  ].filter(Boolean);
  return `${dayLabel(c.day)} – ${parts.join(', ')}${c.more ? ' und mehr' : ''}`;
}

/** Eine Seite „Alle anzeigen“ in die Tageskarte `key` übernehmen (erste Seite ersetzt, weitere hängen an). */
export function withDayPage(days: DayCard[], key: string, page: { items: StreamItem[]; cursor: string | null }, append: boolean): DayCard[] {
  return days.map((d) => (d.day === key ? { ...d, open: { items: [...(append && d.open ? d.open.items : []), ...page.items], cursor: page.cursor } } : d));
}
