// Wertung (Konzept 32, F-413, F-414, F-500 … F-506): Wertungsvorlagen als geprüfter Baukasten – feste Bausteine mit
// Gewichten, kein Formeltext, kein `eval`. Reine Regeln ohne DOM und Netz: im Browser für das eigene Fahrtenbuch
// (Punkte, Jahresbericht), im Worker für Prüfung und Vereinsliste. Eine Vereinshilfe, keine offizielle Wertung.
import { cleanComment, commentLength } from './comment-text';
import { countsInLogbook, isTemplateId, type LogState } from './logbook';
import { entryDays, type CsvScores, type LogbookEntry } from './logbook-year';
import type { Visibility } from './visibility';
import { seasonOf } from './support';

/** Posten der Vorlage: Punkte je Einheit eines gleichnamigen Postens im Eintrag (Groß-/Kleinschreibung egal), mit Deckel. */
export interface ScoringItemRule {
  name: string;
  points: number;
  /** höchstens so viele Punkte je Eintrag, 0 = ohne Deckel */
  cap: number;
}

/** Zahl-Bausteine einer Vorlage (alle Pflicht nach `parseRules`; fehlende ergänzt der Standard). */
export interface ScoringNumbers {
  /** Punkte je sm unter Segel bzw. unter Motor (Anteil aus den Stunden, ohne Stunden alles unter Segel) */
  nmSail: number;
  nmMotor: number;
  /** Faktor je Revier (ohne Angabe 1) und Zuschlag Tidengewässer */
  inland: number;
  coastal: number;
  offshore: number;
  tidal: number;
  /** Faktor je Rolle an Bord (ohne Angabe 1) */
  skipper: number;
  co: number;
  crew: number;
  guest: number;
  /** Punkte je Nachtstunde, Tag an Bord, Schleuse, Brücke, Mast legen/stellen */
  nightH: number;
  day: number;
  lock: number;
  bridge: number;
  mast: number;
  /** Regatta: Punkte je Teilnahme + (Starter − Platz + 1) × Gewicht */
  regatta: number;
  regattaPlace: number;
  /** Deckel je Eintrag, 0 = ohne */
  cap: number;
}

export interface ScoringRules extends ScoringNumbers {
  items: ScoringItemRule[];
}

type NumberKey = keyof ScoringNumbers;

/** Baustein für Prüfung und Formular: Gruppe, Beschriftung, Art (Punkte oder Faktor), Grenze, Standard. */
export interface RuleField {
  key: NumberKey;
  group: 'Seemeilen' | 'Revier' | 'Rolle an Bord' | 'Zusätze' | 'Regatta' | 'Deckel';
  label: string;
  kind: 'points' | 'factor';
  max: number;
  /** Wert, wenn die Vorlage ihn nicht nennt (= „Nur Meilen“) */
  fallback: number;
}

const P = (key: NumberKey, group: RuleField['group'], label: string, max = 1000, fallback = 0): RuleField => ({ key, group, label, kind: 'points', max, fallback });
const F = (key: NumberKey, group: RuleField['group'], label: string, fallback = 1): RuleField => ({ key, group, label, kind: 'factor', max: 10, fallback });

/** Alle Zahl-Bausteine in Anzeigereihenfolge – eine Liste für `parseRules`, Formular und Anzeige. */
export const RULE_FIELDS: readonly RuleField[] = [
  P('nmSail', 'Seemeilen', 'Punkte je sm unter Segel', 100, 1),
  P('nmMotor', 'Seemeilen', 'Punkte je sm unter Motor', 100, 1),
  F('inland', 'Revier', 'Faktor Binnen'),
  F('coastal', 'Revier', 'Faktor Küste'),
  F('offshore', 'Revier', 'Faktor Offshore'),
  F('tidal', 'Revier', 'Zuschlag Tidengewässer', 0),
  F('skipper', 'Rolle an Bord', 'Faktor Skipper:in'),
  F('co', 'Rolle an Bord', 'Faktor Co-Skipper:in'),
  F('crew', 'Rolle an Bord', 'Faktor Crew'),
  F('guest', 'Rolle an Bord', 'Faktor Gast'),
  P('nightH', 'Zusätze', 'Punkte je Nachtstunde'),
  P('day', 'Zusätze', 'Punkte je Tag an Bord'),
  P('lock', 'Zusätze', 'Punkte je Schleuse'),
  P('bridge', 'Zusätze', 'Punkte je Brücke'),
  P('mast', 'Zusätze', 'Punkte je Mast legen/stellen'),
  P('regatta', 'Regatta', 'Punkte je Teilnahme'),
  P('regattaPlace', 'Regatta', 'Punkte je Platzierung (Starter − Platz + 1)'),
  P('cap', 'Deckel', 'Höchstens Punkte je Eintrag (0 = ohne)', 100_000),
];

export const SCORING_LIMITS = {
  nameMax: 60,
  items: 10,
  itemNameMax: 40,
  itemPointsMax: 1000,
  itemCapMax: 100_000,
  /** Vorlagen je Verein bzw. Vorschläge der Plattform */
  perClub: 10,
  global: 20,
  /** Faktor eines Vereins für eine Vorlage in der Vereinsliste */
  weightMin: 0.1,
  weightMax: 10,
} as const;

/** Zahl in [0, max] (Text mit Komma erlaubt), auf 0,01 gerundet; null = ungültig. */
function ruleNumber(v: unknown, max: number): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

/** Standard-Regeln („Nur Meilen“): 1 Punkt je Seemeile, alle Faktoren 1, keine Zusätze. */
export const BASE_RULES: ScoringRules = {
  ...(Object.fromEntries(RULE_FIELDS.map((f) => [f.key, f.fallback])) as unknown as ScoringNumbers),
  items: [],
};

/**
 * Regeln prüfen (Baukasten, F-500): nur bekannte Bausteine, Zahlen in ihren Grenzen, höchstens zehn Posten. Fehlende
 * Bausteine bekommen den Standard; Unbekanntes ist ein Fehler (deutsche Meldung) – nie ein Ausdruck.
 */
export function parseRules(input: unknown): { rules: ScoringRules } | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Ungültige Regeln.' };
  const o = input as Record<string, unknown>;
  const known = new Set<string>([...RULE_FIELDS.map((f) => f.key), 'items']);
  const unknown = Object.keys(o).find((k) => !known.has(k));
  if (unknown) return { error: `Unbekannter Baustein „${unknown.slice(0, 40)}“.` };
  const rules = { ...BASE_RULES, items: [] as ScoringItemRule[] };
  for (const f of RULE_FIELDS) {
    if (o[f.key] === undefined || o[f.key] === null || o[f.key] === '') continue;
    const n = ruleNumber(o[f.key], f.max);
    if (n === null) return { error: `${f.label}: 0 bis ${f.max.toLocaleString('de-DE')}.` };
    rules[f.key] = n;
  }
  if (o.items !== undefined && o.items !== null) {
    if (!Array.isArray(o.items)) return { error: 'Posten: ungültige Angabe.' };
    if (o.items.length > SCORING_LIMITS.items) return { error: `Höchstens ${SCORING_LIMITS.items} Posten je Vorlage.` };
    const seen = new Set<string>();
    for (const raw of o.items as unknown[]) {
      const it = raw as Record<string, unknown>;
      if (!it || typeof it !== 'object' || typeof it.name !== 'string') return { error: 'Posten: bitte einen Namen angeben.' };
      const name = cleanComment(it.name).replace(/\s+/g, ' ');
      if (!name) continue;
      if (commentLength(name) > SCORING_LIMITS.itemNameMax) return { error: `Posten: Name höchstens ${SCORING_LIMITS.itemNameMax} Zeichen.` };
      const key = name.toLocaleLowerCase('de-DE');
      if (seen.has(key)) return { error: `Posten „${name}“ steht doppelt in der Vorlage.` };
      seen.add(key);
      const points = ruleNumber(it.points ?? 0, SCORING_LIMITS.itemPointsMax);
      const cap = ruleNumber(it.cap ?? 0, SCORING_LIMITS.itemCapMax);
      if (points === null || cap === null) return { error: `Posten „${name}“: Punkte 0 bis ${SCORING_LIMITS.itemPointsMax}, Deckel 0 bis ${SCORING_LIMITS.itemCapMax.toLocaleString('de-DE')}.` };
      rules.items.push({ name, points, cap });
    }
  }
  return { rules };
}

/** Gespeicherte Regeln lesen: Kaputtes oder Unbekanntes ergibt „Nur Meilen“, nie einen Fehler. */
export function readRules(raw: unknown): ScoringRules {
  try {
    const r = parseRules(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return 'rules' in r ? r.rules : BASE_RULES;
  } catch {
    return BASE_RULES;
  }
}

/** Name einer Vorlage: 1 bis 60 Zeichen, eine Zeile – null = ungültig. */
export function templateName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = cleanComment(v).replace(/\s+/g, ' ');
  return name && commentLength(name) <= SCORING_LIMITS.nameMax ? name : null;
}

/** Faktor für die Vereinsliste (32.4): null = zählt nicht, sonst 0,1 bis 10; undefined = ungültig. */
export function listWeight(v: unknown): number | null | undefined {
  if (v === null || v === '' || v === false) return null;
  const n = ruleNumber(v, SCORING_LIMITS.weightMax);
  return n === null || n < SCORING_LIMITS.weightMin ? undefined : n;
}

// ---------------------------------------------------------------- Vorlagen

/** Vorlage, wie Browser und Worker sie kennen. `groupId` null = Vorschlag der Plattform bzw. die eingebaute. */
export interface ScoringTemplate {
  id: string;
  name: string;
  rules: ScoringRules;
  groupId: string | null;
  /** Verein der Vorlage (Anzeige „Vorlage von …“) */
  groupName: string | null;
  /** übernommen aus (Name der Vorlage, solange es sie gibt) */
  sourceName: string | null;
  /** Vereinsvorlage: Faktor in der Vereinsliste, null = zählt dort nicht */
  listWeight: number | null;
}

/** Die eingebaute Vorlage – immer wählbar, nicht löschbar; Rückfall für Einträge ohne bzw. mit gelöschter Vorlage. */
export const BASE_TEMPLATE_ID = 'meilen';
export const BASE_TEMPLATE: ScoringTemplate = {
  id: BASE_TEMPLATE_ID, name: 'Nur Meilen', rules: BASE_RULES, groupId: null, groupName: null, sourceName: null, listWeight: null,
};

/** Vorlage eines Eintrags: die gewählte, wenn es sie (für dieses Konto) gibt – sonst „Nur Meilen“ (F-501). */
export function templateFor(templateId: string | undefined, templates: readonly ScoringTemplate[]): ScoringTemplate {
  return (isTemplateId(templateId) && templates.find((t) => t.id === templateId)) || BASE_TEMPLATE;
}

/**
 * Vorbelegung im Formular (F-501): die Vorlage des Eintrags, sonst die zuletzt genutzte, sonst „Nur Meilen“ – jeweils
 * nur, wenn sie noch wählbar ist.
 */
export function defaultTemplateId(own: string | undefined, last: string | null | undefined, templates: readonly ScoringTemplate[]): string {
  for (const id of [own, last]) if (id && templates.some((t) => t.id === id)) return id;
  return BASE_TEMPLATE_ID;
}

/** Beschriftung in Auswahl und Listen: „Fahrtenpreis (SV Potsdam)“. */
export const templateLabel = (t: Pick<ScoringTemplate, 'name' | 'groupName'>): string => (t.groupName ? `${t.name} (${t.groupName})` : t.name);

// ---------------------------------------------------------------- Rechnen

/** Was ein Eintrag für die Wertung braucht – eigene Einträge der Liste bzw. Zeilen der Vereinsliste. */
export type ScoredEntry = Pick<LogbookEntry, 'distNm' | 'role' | 'log' | 'startedAt' | 'endedAt' | 'logState'>;

const one = (n: number) => Math.round(n * 10) / 10;

/**
 * Punkte eines Eintrags nach einer Vorlage (F-502): Seemeilen (Anteil unter Motor aus den Stunden) × Revier-Faktor
 * (+ Tide) × Rollen-Faktor, dazu Nachtstunden, Tage an Bord, Schleusen, Brücken, Mast, Regatta und Posten; Deckel je
 * Posten und je Eintrag. Revier und Rolle wirken nur auf die Seemeilen; ohne Angabe Faktor 1. Ausgeschlossene Einträge
 * zählen nie (0). Eine Nachkommastelle.
 */
export function scoreEntry(e: ScoredEntry, r: ScoringRules): number {
  if (!countsInLogbook(e.logState)) return 0;
  const log = e.log;
  const sailH = log.sailH ?? 0;
  const engineH = log.engineH ?? 0;
  const motorShare = sailH + engineH > 0 ? engineH / (sailH + engineH) : 0;
  const nm = e.distNm * ((1 - motorShare) * r.nmSail + motorShare * r.nmMotor);
  const area = log.area ? r[log.area] + (log.tidal ? r.tidal : 0) : 1;
  const role = e.role ? r[e.role] : 1;
  let pts = nm * area * role;
  pts += (log.nightH ?? 0) * r.nightH + entryDays(e) * r.day + (log.locks ?? 0) * r.lock + (log.bridges ?? 0) * r.bridge + (log.mast ?? 0) * r.mast;
  const reg = log.regatta;
  if (reg) pts += r.regatta + (reg.place && reg.starters ? (reg.starters - reg.place + 1) * r.regattaPlace : 0);
  for (const rule of r.items) {
    const key = rule.name.toLocaleLowerCase('de-DE');
    const n = (log.items ?? []).filter((it) => it.name.toLocaleLowerCase('de-DE') === key).reduce((a, it) => a + it.n, 0);
    const p = n * rule.points;
    pts += rule.cap > 0 ? Math.min(p, rule.cap) : p;
  }
  return one(r.cap > 0 ? Math.min(pts, r.cap) : pts);
}

/** Punkte je Vorlage über Einträge (Summe der Einträge, ausgeschlossene nie) – größte zuerst. */
export function pointsByTemplate<E extends ScoredEntry>(entries: readonly E[], templates: readonly ScoringTemplate[]): Array<{ template: ScoringTemplate; points: number; count: number }> {
  const sums = new Map<string, { template: ScoringTemplate; points: number; count: number }>();
  for (const e of entries) {
    if (!countsInLogbook(e.logState)) continue;
    const t = templateFor(e.log.templateId, templates);
    const s = sums.get(t.id) ?? { template: t, points: 0, count: 0 };
    s.points = one(s.points + scoreEntry(e, t.rules));
    s.count++;
    sums.set(t.id, s);
  }
  return [...sums.values()].sort((a, b) => b.points - a.points || a.template.name.localeCompare(b.template.name, 'de'));
}

/**
 * Punktesumme einer Person in der Vereinsliste (F-504, Gewichtung 32.4): Summe je Vorlage des Vereins × ihrem Faktor.
 * Vorlagen ohne Faktor zählen nicht. Die Gewichtung steht nur hier – eine andere Auslegung ändert nur diese Funktion.
 */
export function clubPoints(byTemplate: ReadonlyArray<{ template: Pick<ScoringTemplate, 'listWeight'>; points: number }>): number {
  return one(byTemplate.reduce((sum, b) => sum + (b.template.listWeight === null ? 0 : b.points * b.template.listWeight), 0));
}

/**
 * Zählt ein Törn in der Vereinsliste (F-503)? Nur Törns, die die Person in diesem Verein zeigt (`share_groups`), die
 * öffentlich, nicht ausgeblendet oder gesperrt und im Fahrtenbuch sind, deren Konto nicht gesperrt ist, deren Person
 * teilnimmt (Opt-in) und deren Vorlage eine Vorlage des Vereins mit Faktor ist. = `CLUB_LIST_SQL` (worker/scoring-sql.ts).
 */
export function countsInClubList(s: {
  shownInClub: boolean;
  visibility: Visibility;
  hidden: boolean;
  locked: boolean;
  ownerSuspended: boolean;
  logState: LogState;
  optedIn: boolean;
  templateInList: boolean;
}): boolean {
  return s.shownInClub && s.visibility === 'public' && !s.hidden && !s.locked && !s.ownerSuspended && countsInLogbook(s.logState) && s.optedIn && s.templateInList;
}

/**
 * Saison der Vereinsliste ohne Angabe: im November und Dezember die gerade abgelaufene (die neue hat noch kaum Törns,
 * der Fahrtenpreis wird ausgewertet), sonst die laufende.
 */
export const clubListSeason = (now: number): number => seasonOf(now - 61 * 86_400_000);

/** Hinweis überall, wo Punkte stehen (Risiko „offizielle Wertung“, Konzept 32). */
export const SCORING_NOTE = 'Vereinshilfe nach deinen Angaben – keine offizielle Wertung.';

/** Bausteine nach Gruppe – für Formular und Anzeige. */
export const RULE_GROUPS = [...new Set(RULE_FIELDS.map((f) => f.group))];

/** Kurzbeschreibung der Vorlage für Listen: nur Bausteine, die vom Standard abweichen. */
export function rulesSummary(r: ScoringRules): string {
  const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const parts = RULE_FIELDS.filter((f) => r[f.key] !== f.fallback).map((f) => `${f.label} ${fmt(r[f.key])}`);
  for (const it of r.items) parts.push(`${it.name} ${fmt(it.points)}${it.cap ? ` (höchstens ${fmt(it.cap)})` : ''}`);
  return parts.length ? parts.join(' · ') : '1 Punkt je Seemeile';
}

/**
 * Punkte für den Jahresbericht als CSV (F-505): je Eintrag Vorlage und Punkte, Summen je Vorlage über die Einträge des
 * Berichts (ausgeschlossene zählen nie), dazu der Hinweis „Vereinshilfe“.
 */
export function reportScores(entries: readonly LogbookEntry[], templates: readonly ScoringTemplate[]): CsvScores {
  const nm = new Map<string, number>();
  for (const e of entries) {
    if (!countsInLogbook(e.logState)) continue;
    const id = templateFor(e.log.templateId, templates).id;
    nm.set(id, (nm.get(id) ?? 0) + e.distNm);
  }
  return {
    of: (e) => {
      const t = templateFor(e.log.templateId, templates);
      return { template: templateLabel(t), points: scoreEntry(e, t.rules) };
    },
    totals: pointsByTemplate(entries, templates).map((b) => ({ template: templateLabel(b.template), nm: nm.get(b.template.id) ?? 0, points: b.points })),
    note: SCORING_NOTE,
  };
}
