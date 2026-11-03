// Veranstaltungen (Konzept 21.5, 30, F-408, F-410, F-480 … F-489): reine Regeln ohne DOM und Netz – Arten, Grenzen,
// Prüfung der Eingaben, Zusage und Kapazität, Titel im `body`, `.ics`-Datei und Vorlage für das Fahrtenbuch. Genutzt vom
// Worker (Prüfen beim Schreiben, Zusage) und von der Oberfläche (Formular, Karte, Kalender-Datei).
import { cleanComment, commentLength } from './comment-text';
import { POST_MAX } from './groups';
import { LOG_LIMITS, type Logbook } from './logbook';
import { APP_NAME } from './brand';

const DAY = 86_400_000;
const HOUR = 3_600_000;

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

/** Art einer Veranstaltung (21.5). */
export const EVENT_TYPES = ['meet', 'sail', 'regatta', 'work', 'training', 'course'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const isEventType = oneOf(EVENT_TYPES);
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  meet: 'Treffen',
  sail: 'Ausfahrt',
  regatta: 'Regatta',
  work: 'Arbeitsdienst',
  training: 'Training',
  course: 'Kurs',
};

/** Zusage (B7): nehme teil, vielleicht, nehme nicht teil – kein Check-in. */
export const RSVP_STATUSES = ['yes', 'maybe', 'no'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export const isRsvpStatus = oneOf(RSVP_STATUSES);
export const RSVP_LABEL: Record<RsvpStatus, string> = { yes: 'Nehme teil', maybe: 'Vielleicht', no: 'Nehme nicht teil' };
/** Wer eine Erinnerung bzw. Änderungsmeldung bekommt (F-410) */
export const RSVP_NOTIFIED: readonly RsvpStatus[] = ['yes', 'maybe'];

export const EVENT_LIMITS = {
  titleMax: 120,
  placeMax: 120,
  /** Ende höchstens so lange nach Beginn */
  maxDurationMs: 14 * DAY,
  /** Beginn höchstens so weit voraus */
  aheadMs: 2 * 365 * DAY,
  capacityMax: 500,
  /** Beschreibung: zusammen mit dem Titel höchstens so lang wie ein Beitrag */
  descriptionMax: POST_MAX - 121,
  /** Erinnerung im Nachtlauf für Veranstaltungen, die in den nächsten 36 h beginnen */
  remindAheadMs: 36 * HOUR,
  /** so viele Veranstaltungen erinnert der Nachtlauf höchstens (Free-Tier-Budget) */
  remindMax: 50,
  /** so viele abgelaufene Veranstaltungen löscht der Nachtlauf höchstens (removePost je Beitrag) */
  expireMax: 20,
  /** Veranstaltungen werden so lange nach ihrem Ende gelöscht (21.3.3) */
  keepMs: 365 * DAY,
  /** „Wer kommt?“: höchstens so viele Namen je Status */
  whoMax: 50,
} as const;

/** Termin und Ort, wie sie gespeichert werden (Titel und Beschreibung stehen in `posts.body`). */
export interface EventInput {
  type: EventType;
  startsAt: number;
  endsAt: number;
  place: string;
  capacity: number | null;
}

const line = (v: unknown): string => cleanComment(v).replace(/\s*\n\s*/g, ' ');

/**
 * Termin, Ort, Kapazität und Beschreibung prüfen (F-480): Art bekannt, Ende nach Beginn und höchstens 14 Tage später,
 * noch nicht vorbei, Beginn höchstens zwei Jahre voraus, Ort ≤ 120 Zeichen, Kapazität leer oder 1–500, Beschreibung
 * optional (nur beim Anlegen genutzt). Fehler als deutsche Meldung.
 */
export function parseEventInput(raw: unknown, now: number): { event: EventInput; description: string } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Angaben zur Veranstaltung fehlen.' };
  const o = raw as Record<string, unknown>;
  if (!isEventType(o.type)) return { error: 'Bitte die Art der Veranstaltung wählen.' };
  const startsAt = Number(o.startsAt);
  const endsAt = Number(o.endsAt);
  if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || startsAt <= 0) return { error: 'Bitte Beginn und Ende angeben.' };
  if (endsAt <= startsAt) return { error: 'Das Ende muss nach dem Beginn liegen.' };
  if (endsAt - startsAt > EVENT_LIMITS.maxDurationMs) return { error: 'Eine Veranstaltung dauert höchstens 14 Tage.' };
  if (endsAt <= now) return { error: 'Diese Veranstaltung wäre schon vorbei.' };
  if (startsAt > now + EVENT_LIMITS.aheadMs) return { error: 'Höchstens zwei Jahre im Voraus.' };
  const place = o.place === undefined || o.place === null ? '' : typeof o.place === 'string' ? line(o.place) : null;
  if (place === null) return { error: 'Ort: bitte Text angeben.' };
  if (commentLength(place) > EVENT_LIMITS.placeMax) return { error: `Ort: höchstens ${EVENT_LIMITS.placeMax} Zeichen.` };
  let capacity: number | null = null;
  if (o.capacity !== undefined && o.capacity !== null && o.capacity !== '') {
    capacity = Number(o.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > EVENT_LIMITS.capacityMax) return { error: `Plätze: 1 bis ${EVENT_LIMITS.capacityMax} oder leer.` };
  }
  const description = o.description === undefined || o.description === null ? '' : typeof o.description === 'string' ? cleanComment(o.description) : null;
  if (description === null) return { error: 'Beschreibung: bitte Text angeben.' };
  if (commentLength(description) > EVENT_LIMITS.descriptionMax) return { error: `Beschreibung: höchstens ${EVENT_LIMITS.descriptionMax} Zeichen.` };
  return { event: { type: o.type, startsAt, endsAt, place, capacity }, description };
}

// ---------------------------------------------------------------- Titel und Beschreibung im `body`

/** `body` einer Veranstaltung: Titel (eine Zeile) in der ersten Zeile, darunter die Beschreibung (30.3). */
export const eventBody = (title: string, description: string): string => {
  const t = line(title);
  return description.trim() ? `${t}\n${description.trim()}` : t;
};

/** Titel und Beschreibung aus `body` (Gegenstück zu `eventBody`). */
export function splitEventBody(body: string): { title: string; description: string } {
  const i = body.indexOf('\n');
  return i < 0 ? { title: body.trim(), description: '' } : { title: body.slice(0, i).trim(), description: body.slice(i + 1).trim() };
}

// ---------------------------------------------------------------- Karte und Zusage

/** Eine Veranstaltung, wie die Karte sie bekommt (`StreamItem.post.event`) – die eigene Zusage nur mit Betrachter. */
export interface EventView {
  type: EventType;
  startsAt: number;
  endsAt: number;
  place: string;
  capacity: number | null;
  cancelled: boolean;
  counts: Record<RsvpStatus, number>;
  mine: RsvpStatus | null;
  /** der Betrachter hat sie angelegt (ändern, absagen) */
  own: boolean;
  /** zuletzt geändert und Stand (Sekunden seit dem Anlegen) – für die Kalender-Datei (LAST-MODIFIED, SEQUENCE) */
  updatedAt: number;
  sequence: number;
}

export const emptyCounts = (): Record<RsvpStatus, number> => ({ yes: 0, maybe: 0, no: 0 });

/** Vorbei, sobald das Ende erreicht ist. */
export const isOver = (e: Pick<EventView, 'endsAt'>, now: number): boolean => now >= e.endsAt;

/** Freie Plätze (null = ohne Grenze); die eigene Zusage zählt als belegt. */
export const freePlaces = (e: Pick<EventView, 'capacity' | 'counts'>): number | null => (e.capacity === null ? null : Math.max(0, e.capacity - e.counts.yes));

/**
 * Warum geht diese Zusage nicht (F-481, F-482)? Abgesagt, vorbei oder – nur für „Nehme teil“ – voll (die eigene
 * „Nehme teil“-Zusage hält ihren Platz). „Vielleicht“ und „Nehme nicht teil“ gehen auch bei voller Veranstaltung.
 */
export function rsvpProblem(e: Pick<EventView, 'capacity' | 'counts' | 'mine' | 'cancelled' | 'endsAt'>, status: RsvpStatus, now: number): 'cancelled' | 'over' | 'full' | null {
  if (e.cancelled) return 'cancelled';
  if (isOver(e, now)) return 'over';
  if (status === 'yes' && e.mine !== 'yes' && e.capacity !== null && e.counts.yes >= e.capacity) return 'full';
  return null;
}

export const RSVP_PROBLEM_TEXT: Record<'cancelled' | 'over' | 'full', string> = {
  cancelled: 'Diese Veranstaltung ist abgesagt.',
  over: 'Diese Veranstaltung ist vorbei.',
  full: 'Alle Plätze sind vergeben – „Vielleicht“ geht noch.',
};

/** Zähler und eigene Zusage nach einer Änderung – für die sofortige Anzeige, bevor der Server antwortet. */
export function applyRsvp(e: EventView, status: RsvpStatus): EventView {
  const counts = { ...e.counts };
  if (e.mine) counts[e.mine] = Math.max(0, counts[e.mine] - 1);
  counts[status]++;
  return { ...e, counts, mine: status };
}

/** Hat sich für die Zusagen etwas geändert (Zeit, Ort, Absage)? Dann `event` an alle mit Zusage (F-410). */
export const eventChanged = (a: Pick<EventInput, 'startsAt' | 'endsAt' | 'place'>, b: Pick<EventInput, 'startsAt' | 'endsAt' | 'place'>): boolean =>
  a.startsAt !== b.startsAt || a.endsAt !== b.endsAt || a.place !== b.place;

/** „Ins Fahrtenbuch übernehmen“ (F-487): wer „Nehme teil“ hatte, nach dem Ende, nicht bei Absage. */
export const canTakeToLogbook = (e: Pick<EventView, 'mine' | 'cancelled' | 'endsAt'>, now: number): boolean => e.mine === 'yes' && !e.cancelled && isOver(e, now);

/** Vorbelegung des Fahrtenbuch-Formulars aus einer Veranstaltung (F-487) – Zusatzangaben wie Phase 8 (Konzept 27.4). */
export interface LogbookPreset {
  startedAt: number;
  title: string;
  eventId: string;
  /** Regatta (Name; Platz und Starter trägt man selbst ein) bzw. ein Posten für Arbeitsdienst, Training, Kurs */
  log?: Logbook;
}

/** Arten, die im Fahrtenbuch ein Posten sind (B10) */
const ITEM_TYPES: readonly EventType[] = ['work', 'training', 'course'];

export function logbookPreset(postId: string, title: string, e: Pick<EventView, 'startsAt' | 'type'>): LogbookPreset {
  const base = { startedAt: e.startsAt, title, eventId: postId };
  if (e.type === 'regatta') return { ...base, log: { regatta: { name: title.slice(0, LOG_LIMITS.regattaNameMax) } } };
  if (ITEM_TYPES.includes(e.type)) return { ...base, log: { items: [{ name: EVENT_TYPE_LABEL[e.type], n: 1 }] } };
  return base;
}

// ---------------------------------------------------------------- Texte

/**
 * Termin als Text in der Zeit des Geräts, z. B. „Sa., 14.06.2026, 18:00–22:00“ bzw. mehrtägig „Sa., 14.06.2026, 10:00 –
 * So., 15.06.2026, 16:00“.
 */
export function eventWhen(e: Pick<EventView, 'startsAt' | 'endsAt'>): string {
  const day = (t: number) => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = (t: number) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return day(e.startsAt) === day(e.endsAt) ? `${day(e.startsAt)}, ${time(e.startsAt)}–${time(e.endsAt)}` : `${day(e.startsAt)}, ${time(e.startsAt)} – ${day(e.endsAt)}, ${time(e.endsAt)}`;
}

// ---------------------------------------------------------------- Kalender (.ics, F-486)

const icsDate = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Zeile nach RFC 5545 falten: höchstens 75 Bytes je Zeile, Fortsetzung mit führendem Leerzeichen. */
function fold(lineText: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of lineText) {
    const n = enc.encode(ch).length;
    const max = out.length ? 74 : 75;
    if (bytes + n > max) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * Kalender-Datei einer Veranstaltung (im Browser erzeugt, kein Server-Weg): ein VEVENT mit UTC-Zeiten, Ort, Link zur
 * Karte; `LAST-MODIFIED` und `SEQUENCE` aus dem letzten Ändern, damit Kalender eine geänderte Zeit übernehmen. Abgesagte
 * Veranstaltungen bieten keine Datei an. `host`: Domain für die UID.
 */
export function eventIcs(
  e: { id: string; title: string; description: string; url: string; host: string } & Pick<EventView, 'startsAt' | 'endsAt' | 'place' | 'updatedAt' | 'sequence'>,
  now: number,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${APP_NAME}//Veranstaltungen//DE`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@${e.host}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(e.endsAt)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(`${e.description}\n\n${e.url}`)}`] : [`DESCRIPTION:${icsText(e.url)}`]),
    ...(e.place ? [`LOCATION:${icsText(e.place)}`] : []),
    `URL:${e.url}`,
    `LAST-MODIFIED:${icsDate(e.updatedAt)}`,
    `SEQUENCE:${e.sequence}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Dateiname der Kalender-Datei: Titel ohne Sonderzeichen. */
export const icsFileName = (title: string): string => `${title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'veranstaltung'}.ics`;
