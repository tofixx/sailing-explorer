// Umfragen (Konzept 21.5, 29, F-407, F-470 … F-474): reine Regeln ohne DOM und Netz – Eingabe prüfen, offen/beendet,
// wer das Ergebnis sieht, gültige Stimmen. Genutzt von Worker (Anlegen, Abstimmen, Stream) und Oberfläche (Formular,
// Karte). Eine Umfrage ist eine Art von `posts`: Frage im `body`, Einstellungen in `data.poll`.

/** Grenzen (21.5). */
export const POLL_LIMITS = {
  /** Zeichen der Frage */
  question: 300,
  /** Zeichen je Antwort */
  option: 100,
  minOptions: 2,
  maxOptions: 10,
  /** Ende höchstens so viele Tage nach dem Anlegen */
  maxDays: 90,
  /** Teilnehmende je Umfrage */
  voters: 1000,
} as const;

/** Wann das Ergebnis sichtbar ist: nach eigener Stimme (Standard), immer, erst nach dem Ende. */
export const POLL_RESULTS = ['voted', 'always', 'closed'] as const;
export type PollResults = (typeof POLL_RESULTS)[number];
export const isPollResults = (v: unknown): v is PollResults => typeof v === 'string' && (POLL_RESULTS as readonly string[]).includes(v);
export const POLL_RESULTS_LABEL: Record<PollResults, string> = { voted: 'Nach eigener Stimme', always: 'Immer', closed: 'Erst nach dem Ende' };

/** Einstellungen einer Umfrage (`posts.data.poll`) – für alle Lesenden gleich. */
export interface PollConfig {
  options: string[];
  /** höchstens so viele Antworten je Person (1 = Einfachauswahl) */
  max: number;
  /** Ende (ms) oder null = offen bis zum Beenden */
  closesAt: number | null;
  results: PollResults;
  /** namentlich (B9) – vorher angekündigt, nicht umstellbar */
  named: boolean;
}

const DAY = 86_400_000;

/** Text einer Antwort bzw. der Frage: getrimmt, Zeilenumbrüche zu Leerzeichen. */
const oneLine = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * Eingabe beim Anlegen prüfen (F-470): 2–10 verschiedene Antworten ≤ 100 Zeichen, `max` 1 … Zahl der Antworten, Ende in
 * der Zukunft und höchstens 90 Tage. Liefert die Einstellungen oder einen Fehlercode mit Text (fail closed).
 */
export function readPollConfig(raw: unknown, now: number): PollConfig | { error: string; message: string } {
  const r = (raw ?? {}) as { options?: unknown; max?: unknown; closesAt?: unknown; results?: unknown; named?: unknown };
  const fail = (error: string, message: string) => ({ error, message });
  if (!Array.isArray(r.options)) return fail('invalid_poll', 'Bitte Antworten angeben.');
  const options = r.options.map(oneLine).filter(Boolean);
  if (options.length < POLL_LIMITS.minOptions || options.length > POLL_LIMITS.maxOptions || options.length !== r.options.length) {
    return fail('invalid_options', `${POLL_LIMITS.minOptions} bis ${POLL_LIMITS.maxOptions} Antworten, keine leer.`);
  }
  if (options.some((o) => [...o].length > POLL_LIMITS.option)) return fail('invalid_options', `Höchstens ${POLL_LIMITS.option} Zeichen je Antwort.`);
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return fail('invalid_options', 'Jede Antwort nur einmal.');
  const max = r.max === undefined ? 1 : r.max;
  if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > options.length) return fail('invalid_max', 'Mehrfachauswahl: höchstens so viele wie Antworten.');
  let closesAt: number | null = null;
  if (r.closesAt !== undefined && r.closesAt !== null) {
    if (typeof r.closesAt !== 'number' || !Number.isFinite(r.closesAt) || r.closesAt <= now || r.closesAt > now + POLL_LIMITS.maxDays * DAY) {
      return fail('invalid_closes_at', `Das Ende muss in der Zukunft liegen, höchstens ${POLL_LIMITS.maxDays} Tage.`);
    }
    closesAt = Math.floor(r.closesAt);
  }
  const results = r.results === undefined ? 'voted' : r.results;
  if (!isPollResults(results)) return fail('invalid_results', 'Unbekannte Einstellung „Ergebnis sichtbar“.');
  if (r.named !== undefined && typeof r.named !== 'boolean') return fail('invalid_poll', 'namentlich: ja oder nein.');
  return { options, max: max as number, closesAt, results, named: r.named === true };
}

/** Gespeicherte Einstellungen lesen (`posts.data`) – Unbekanntes bzw. Kaputtes ist null (fail closed: keine Karte). */
export function parsePollData(data: string | null | undefined): PollConfig | null {
  try {
    const p = (JSON.parse(data ?? '{}') as { poll?: Partial<PollConfig> }).poll;
    if (!p || !Array.isArray(p.options) || !p.options.every((o) => typeof o === 'string')) return null;
    return {
      options: p.options,
      max: Number.isInteger(p.max) && (p.max as number) >= 1 ? (p.max as number) : 1,
      closesAt: typeof p.closesAt === 'number' ? p.closesAt : null,
      results: isPollResults(p.results) ? p.results : 'voted',
      named: p.named === true,
    };
  } catch {
    return null;
  }
}

/** Offen? Beendet ist sie ab `closesAt` – geprüft beim Lesen und Abstimmen, kein Cron (F-472). */
export const isPollOpen = (c: Pick<PollConfig, 'closesAt'>, now: number): boolean => c.closesAt === null || c.closesAt > now;

/**
 * Sieht der Betrachter das Ergebnis (F-473)? Die Autor:in immer; „immer“ für alle; „nach eigener Stimme“ nach der
 * Stimme und nach dem Ende (sonst bliebe es für Spätkommende verborgen); „erst nach Ende“ erst dann.
 */
export function canSeeResults(c: Pick<PollConfig, 'results'>, v: { isAuthor: boolean; voted: boolean; open: boolean }): boolean {
  if (v.isAuthor || c.results === 'always' || !v.open) return true;
  return c.results === 'voted' && v.voted;
}

/** Gültige Auswahl (F-471): ganze Zahlen, verschieden, im Bereich, höchstens `max`; leer = zurücknehmen. */
export function validChoices(c: Pick<PollConfig, 'options' | 'max'>, raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > c.max) return null;
  if (!raw.every((x) => Number.isInteger(x) && x >= 0 && x < c.options.length)) return null;
  return new Set(raw).size === raw.length ? [...(raw as number[])].sort((a, b) => a - b) : null;
}

/** Stand einer Umfrage für einen Betrachter (an der Stream-Karte, nach dem Cache angehängt). */
export interface PollView extends PollConfig {
  open: boolean;
  /** Stimmen je Antwort – nur, wenn der Betrachter das Ergebnis sehen darf, sonst null */
  counts: number[] | null;
  /** Teilnehmende (Personen) – nur mit Ergebnis */
  voters: number | null;
  /** eigene Wahl (leer: noch nicht abgestimmt bzw. Gast) */
  mine: number[];
  /** Autor:in: darf vorzeitig beenden */
  canClose: boolean;
}

/** Ergebnis in Prozent der Teilnehmenden (gerundet) – bei Mehrfachauswahl zusammen über 100. */
export const pollPercent = (count: number, voters: number): number => (voters > 0 ? Math.round((count / voters) * 100) : 0);

/** Hinweis an der Karte bzw. im Formular: Auswahl, Ergebnis, Anonymität. */
export function pollModeText(c: Pick<PollConfig, 'max' | 'named'>): string {
  const pick = c.max === 1 ? 'Eine Antwort' : `Bis zu ${c.max} Antworten`;
  return `${pick} · ${c.named ? 'namentlich – andere sehen, wer was gewählt hat' : 'anonym'}`;
}

/** Gezählte Stimmen einer Umfrage (ohne gesperrte Konten) und die eigene Wahl. */
export interface PollTally {
  counts: number[];
  voters: number;
  mine: number[];
}

/**
 * Stand für einen Betrachter (F-473): Zähler und Teilnehmende nur, wenn er das Ergebnis sehen darf; die eigene Wahl
 * immer; beenden darf nur die Autor:in einer offenen Umfrage.
 */
export function viewPoll(c: PollConfig, t: PollTally, v: { isAuthor: boolean }, now: number): PollView {
  const open = isPollOpen(c, now);
  const visible = canSeeResults(c, { isAuthor: v.isAuthor, voted: t.mine.length > 0, open });
  return {
    ...c,
    open,
    counts: visible ? c.options.map((_, i) => t.counts[i] ?? 0) : null,
    voters: visible ? t.voters : null,
    mine: t.mine,
    canClose: v.isAuthor && open,
  };
}

/** Namen je Antwort bei namentlichen Umfragen (F-474): öffentliche Profile, der Rest als Anzahl. */
export interface PollPeople {
  people: Array<{ handle: string; displayName: string }>;
  others: number;
}
