// Wertung „Fahrtensegeln – Brandenburger Seglerverband e. V.“ (Konzept 39, F-625 … F-632): Strecke in km, Zuschlag
// gegen den Strom, Faktor der Bootsklasse, Langtörn, Posten-Vorschläge – reine Regeln. Der Vorschlag selbst kommt mit
// Migration 0047; hier wird genau dessen JSON gelesen und nachgerechnet.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASE_RULES, KM_PER_NM, RULE_FIELDS, fieldLabel, longBonus, parseRules, readRules, rulesSummary, scoreEntry, templateItemNames,
  type ScoringRules,
} from '../src/domain/scoring';
import { areaText, logbookCsv, type LogbookEntry } from '../src/domain/logbook-year';
import { parseLog } from '../src/domain/logbook';
import { reportScores } from '../src/domain/scoring';

const T0 = Date.UTC(2026, 5, 13, 8);
const e = (o: Partial<LogbookEntry>): LogbookEntry => ({
  id: 'x', own: true, path: null, title: null, startedAt: T0, endedAt: null, timed: false, source: 'manual', distNm: 10, distSource: 'stated',
  from: null, to: null, role: null, roleConfirmed: false, boat: null, logState: 'confirmed', log: {}, ...o,
});
const rules = (o: Partial<ScoringRules>): ScoringRules => ({ ...BASE_RULES, ...o });
const km = (n: number) => n / KM_PER_NM;

/** Regeln des Vorschlags genau so, wie Migration 0047 sie schreibt. */
function bsvRules(): ScoringRules {
  const sql = readFileSync(resolve('migrations', '0047_scoring_bsv.sql'), 'utf8');
  const json = /'(\{"unit".*\})'/.exec(sql)?.[1];
  const r = parseRules(JSON.parse(json ?? 'null'));
  if ('error' in r) throw new Error(r.error);
  return r.rules;
}

describe('Vorschlag des BSV (F-625)', () => {
  it('[F-625] Migration 0047: Regeln bestehen parseRules unverändert, feste ID, wiederholbar', () => {
    const sql = readFileSync(resolve('migrations', '0047_scoring_bsv.sql'), 'utf8');
    expect(sql).toMatch(/INSERT OR IGNORE INTO scoring_templates/);
    expect(sql).toContain("('bsvfahrten', NULL, 'Fahrtensegeln – Brandenburger Seglerverband e. V.'");
    const r = bsvRules();
    expect(r).toMatchObject({
      unit: 'km', nmSail: 1, nmMotor: 0.2, upstream: 2, inland: 1, coastal: 1, offshore: 1, boatClass: 'optimist', classFactor: 2,
      lock: 4, mast: 2, bridge: 0, day: 0, longFrom: 200, longBonus: 20, longStep: 100, longStepBonus: 10, cap: 0,
    });
    expect(r.items.map((it) => [it.name, it.points])).toEqual([
      ['Trailertransport (ab 150 km)', 50],
      ['Gemeinschaftsfahrt je Tag (ab 5 Booten)', 20],
      ['Kinder-/Jugendtraining (ab 2 h)', 25],
      ['Regatta-Funktion je Tag (ab 5 h)', 25],
    ]);
  });

  it('[F-625] Rechenbeispiel: 250 km binnen, davon 10 km gegen den Strom, 2 Schleusen, Mast einmal gelegt und gestellt', () => {
    const r = bsvRules();
    const upstream = parseLog({ area: 'inland', upstreamNm: (10 / KM_PER_NM).toFixed(1), locks: 2, mast: 1 });
    if ('error' in upstream) throw new Error(upstream.error);
    const entry = (boatClass: LogbookEntry['boatClass']) => e({ distNm: km(250), boatClass, log: upstream.log });
    // Jollenkreuzer: 250 km × 1 + 10 km × 2 (3 statt 1) + Langtörn 20 + 2 × 4 + 2 = 300
    expect(scoreEntry(entry('jollenkreuzer'), r)).toBe(300);
    // Optimist: Strecke doppelt (500), Zuschlag gegen den Strom ohne Faktor → 550
    expect(scoreEntry(entry('optimist'), r)).toBe(550);
    // 20 km unter Motor (Stunden 1 : 4): 0,2 je km statt 1
    expect(scoreEntry(e({ distNm: km(100), log: { area: 'coastal', sailH: 4, engineH: 1 } }), r)).toBe(84);
    // Posten: 2 Tage Gemeinschaftsfahrt (Groß-/Kleinschreibung egal) + Trailertransport
    expect(scoreEntry(e({ distNm: km(10), log: { items: [{ name: 'gemeinschaftsfahrt je tag (ab 5 booten)', n: 2 }, { name: 'Trailertransport (ab 150 km)', n: 1 }] } }), r)).toBe(100);
  });
});

describe('Strecke gegen den Strom (F-626)', () => {
  it('[F-626] Angabe in sm, nur binnen, 0 bis 2.000; im Jahresbericht beim Revier', () => {
    expect(parseLog({ area: 'inland', upstreamNm: '5,4' })).toEqual({ log: { area: 'inland', upstreamNm: 5.4 } });
    // anderes Revier bzw. ohne Revier: fällt weg (wie Schleusen)
    expect(parseLog({ area: 'coastal', upstreamNm: 3 })).toEqual({ log: { area: 'coastal' } });
    expect(parseLog({ upstreamNm: 3 })).toEqual({ log: {} });
    expect(parseLog({ area: 'inland', upstreamNm: -1 })).toEqual({ error: 'Gegen den Strom: 0 bis 2000 sm.' });
    expect(parseLog({ area: 'inland', upstreamNm: true })).toHaveProperty('error');
    expect(areaText({ area: 'inland', upstreamNm: 5.4 })).toBe('Binnen (5,4 sm gegen den Strom)');
    const entries = [e({ log: { area: 'inland', upstreamNm: 2, templateId: 'meilen' } })];
    expect(logbookCsv(entries, false, reportScores(entries, []))).toContain(';Binnen (2,0 sm gegen den Strom);');
  });

  it('[F-626] Zuschlag je Einheit, höchstens auf die ganze Strecke, ohne Faktoren', () => {
    const r = rules({ upstream: 2, inland: 3, skipper: 2 });
    // 10 sm × 3 × 2 = 60, dazu 4 sm × 2 = 8
    expect(scoreEntry(e({ role: 'skipper', log: { area: 'inland', upstreamNm: 4 } }), r)).toBe(68);
    // mehr als die Strecke: gedeckelt auf 10 sm
    expect(scoreEntry(e({ log: { area: 'inland', upstreamNm: 50 } }), rules({ upstream: 2 }))).toBe(30);
  });
});

describe('Strecke in km (F-627)', () => {
  it('[F-627] Einheit sm oder km; Einträge bleiben in sm und werden umgerechnet; Beschriftung in der Einheit', () => {
    expect(parseRules({ unit: 'km' })).toEqual({ rules: { ...BASE_RULES, unit: 'km' } });
    expect(parseRules({ unit: 'mi' })).toEqual({ error: 'Einheit: sm oder km.' });
    expect(scoreEntry(e({ distNm: 10 }), rules({ unit: 'km' }))).toBe(18.5);
    expect(scoreEntry(e({ distNm: 10 }), rules({ unit: 'km', nmSail: 0.5 }))).toBe(9.3);
    const sail = RULE_FIELDS.find((f) => f.key === 'nmSail')!;
    expect(fieldLabel(sail, 'nm')).toBe('Punkte je sm unter Segel');
    expect(fieldLabel(sail, 'km')).toBe('Punkte je km unter Segel');
    expect(parseRules({ unit: 'km', nmSail: 101 })).toEqual({ error: 'Punkte je km unter Segel: 0 bis 100.' });
    expect(rulesSummary(rules({ unit: 'km', nmMotor: 0.2 }))).toBe('Strecke in km · Punkte je km unter Motor 0,2');
  });
});

describe('Langtörn (F-628)', () => {
  it('[F-628] über der Schwelle einmal der Zuschlag, je volle weitere Strecke mehr; Umrechnung kippt nicht an der Schwelle', () => {
    const r = { longFrom: 200, longBonus: 20, longStep: 100, longStepBonus: 10 };
    expect(longBonus(200, r)).toBe(0);
    expect(longBonus(200.1, r)).toBe(20);
    expect(longBonus(299.9, r)).toBe(20);
    expect(longBonus(300, r)).toBe(30);
    expect(longBonus(520, r)).toBe(50);
    expect(longBonus(5000, { ...r, longFrom: 0 })).toBe(0);
    expect(longBonus(500, { ...r, longStep: 0 })).toBe(20);
    // 300 km als sm eingegeben (161,99 sm = 299,99… km) zählt als 300
    expect(scoreEntry(e({ distNm: km(300) }), rules({ unit: 'km', nmSail: 0, nmMotor: 0, ...r }))).toBe(30);
  });
});

describe('Posten-Vorschläge (F-629)', () => {
  it('[F-629] Namen der Posten aller wählbaren Vorlagen, einmal je Name', () => {
    const t = (names: string[]) => ({ rules: rules({ items: names.map((name) => ({ name, points: 1, cap: 0 })) }) });
    expect(templateItemNames([t(['Training', 'Arbeitsdienst']), t(['training', 'Jugendtraining']), t([])])).toEqual(['Training', 'Arbeitsdienst', 'Jugendtraining']);
  });
});

describe('Faktor der Bootsklasse (F-630)', () => {
  it('[F-630] nur für die genannte Klasse, nur auf die Strecke; unbekannte Klasse → Fehler', () => {
    const r = rules({ boatClass: 'optimist', classFactor: 2, lock: 4 });
    expect(scoreEntry(e({ boatClass: 'optimist', log: { area: 'inland', locks: 1 } }), r)).toBe(24);
    expect(scoreEntry(e({ boatClass: 'pirat', log: { area: 'inland', locks: 1 } }), r)).toBe(14);
    expect(scoreEntry(e({ boatClass: null }), r)).toBe(10);
    // Faktor ohne Klasse wirkt nicht
    expect(scoreEntry(e({ boatClass: 'optimist' }), rules({ classFactor: 3 }))).toBe(10);
    expect(parseRules({ boatClass: 'jolle' })).toEqual({ error: 'Unbekannte Bootsklasse.' });
    expect(rulesSummary(r)).toBe('Faktor Optimist 2 · Punkte je Schleuse 4');
    expect(rulesSummary(rules({ classFactor: 3 }))).toBe('1 Punkt je Seemeile');
  });
});

describe('Rückwärts verträglich (F-631)', () => {
  it('[F-631] Vorlagen ohne die neuen Bausteine rechnen wie bisher (Migration 0040)', () => {
    const sql = readFileSync(resolve('migrations', '0040_scoring.sql'), 'utf8');
    const [preis, binnen] = [...sql.matchAll(/'(\{"nmSail".*\})'/g)].map((m) => readRules(m[1]));
    expect(preis).toMatchObject({ unit: 'nm', boatClass: '', classFactor: 1, upstream: 0, longFrom: 0 });
    // Werte aus Konzept 32 (F-502): 3 h Segel, 1 h Motor, Küste mit Tide, Skipper:in, 2 Nachtstunden, 2 Tage
    const old = e({ distNm: 40, role: 'skipper', endedAt: T0 + 86_400_000, boatClass: 'optimist',
      log: { sailH: 3, engineH: 1, area: 'coastal', tidal: true, nightH: 2, upstreamNm: 9 } });
    // (30 + 10 × 0,3) × 1,4 × 1,2 + 2 × 2 + 2 × 5 = 69,44 → 69,4
    expect(scoreEntry(old, preis)).toBe(69.4);
    expect(scoreEntry(e({ distNm: 20, boatClass: 'optimist', log: { area: 'inland', locks: 2, mast: 1, upstreamNm: 5 } }), binnen)).toBe(32);
  });
});
