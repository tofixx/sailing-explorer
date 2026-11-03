// Wertung: reine Regeln (Konzept 32) – Baukasten und Prüfung (F-500), Vorlage je Eintrag (F-501), Punkte je Eintrag
// (F-502), Gewichtung der Vereinsliste (F-504), Jahresbericht als CSV (F-505).
import { describe, expect, it } from 'vitest';
import {
  BASE_RULES, BASE_TEMPLATE, BASE_TEMPLATE_ID, RULE_FIELDS, clubListSeason, clubPoints, defaultTemplateId, listWeight, parseRules, pointsByTemplate,
  readRules, reportScores, rulesSummary, scoreEntry, templateFor, templateName, usesTemplates, type ScoringRules, type ScoringTemplate,
} from '../src/domain/scoring';
import { logbookCsv, type LogbookEntry } from '../src/domain/logbook-year';
import { parseLog } from '../src/domain/logbook';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 5, 13, 8);

const e = (o: Partial<LogbookEntry>): LogbookEntry => ({
  id: 'x', own: true, path: null, title: null, startedAt: T0, endedAt: null, timed: false, source: 'manual', distNm: 10, distSource: 'stated',
  from: null, to: null, role: null, roleConfirmed: false, boat: null, logState: 'confirmed', log: {}, ...o,
});
const rules = (o: Partial<ScoringRules>): ScoringRules => ({ ...BASE_RULES, ...o });
const tpl = (id: string, r: Partial<ScoringRules>, o: Partial<ScoringTemplate> = {}): ScoringTemplate => ({
  id, name: id, rules: rules(r), groupId: 'G', groupName: 'SC Möwe', sourceName: null, listWeight: 1, ...o,
});

describe('Baukasten (F-500)', () => {
  it('[F-500] fehlende Bausteine bekommen den Standard („Nur Meilen“), Komma geht, auf 0,01 gerundet', () => {
    const r = parseRules({ nmMotor: '0,333', day: 5, items: [{ name: ' Training ', points: 5 }] });
    expect(r).toEqual({ rules: { ...BASE_RULES, nmMotor: 0.33, day: 5, items: [{ name: 'Training', points: 5, cap: 0 }] } });
    expect(BASE_RULES).toMatchObject({ nmSail: 1, nmMotor: 1, inland: 1, skipper: 1, tidal: 0, day: 0, cap: 0, items: [] });
    // jede Grenze des Formulars steht in RULE_FIELDS
    for (const f of RULE_FIELDS) expect('error' in parseRules({ [f.key]: f.max + 1 }), f.key).toBe(true);
  });

  it('[F-500] kein Formeltext: Unbekanntes, Text, negative Zahlen, doppelte Posten → Fehler mit deutscher Meldung', () => {
    for (const bad of [null, [], 'nm*2', { formula: 'nm*2' }, { nmSail: 'eval(1)' }, { nmSail: true }, { day: -1 }, { items: {} }, { items: [{ points: 1 }] },
      { items: [{ name: 'A' }, { name: 'a' }] }, { items: Array.from({ length: 11 }, (_, i) => ({ name: `P${i}` })) }, { items: [{ name: 'A', points: 1001 }] }]) {
      const r = parseRules(bad);
      expect('error' in r, JSON.stringify(bad)).toBe(true);
      if ('error' in r) expect(r.error).toMatch(/[a-zäöü]/);
    }
  });

  it('[F-500] gespeicherte Regeln: Kaputtes ergibt „Nur Meilen“; Name und Faktor geprüft', () => {
    expect(readRules('{kaputt')).toEqual(BASE_RULES);
    expect(readRules('{"x":1}')).toEqual(BASE_RULES);
    expect(readRules(JSON.stringify({ day: 3 })).day).toBe(3);
    expect(templateName('  Fahrtenpreis\n2026 ')).toBe('Fahrtenpreis 2026');
    expect(templateName('')).toBeNull();
    expect(templateName('x'.repeat(61))).toBeNull();
    expect(listWeight(null)).toBeNull();
    expect(listWeight('1,5')).toBe(1.5);
    expect(listWeight(0)).toBeUndefined();
    expect(listWeight(11)).toBeUndefined();
    expect(rulesSummary(BASE_RULES)).toBe('1 Punkt je Seemeile');
    expect(rulesSummary(rules({ day: 5 }))).toContain('Tag an Bord 5');
  });
});

describe('Vorlage je Eintrag (F-501)', () => {
  it('[F-501] Vorlage im Eintrag: Form geprüft; unbekannte bzw. gelöschte Vorlage → „Nur Meilen“', () => {
    expect(parseLog({ templateId: 'abc123' })).toEqual({ log: { templateId: 'abc123' } });
    expect(parseLog({ templateId: 'a b' })).toEqual({ error: 'Unbekannte Wertungsvorlage.' });
    const list = [BASE_TEMPLATE, tpl('preis', {})];
    expect(templateFor('preis', list).id).toBe('preis');
    expect(templateFor('weg', list)).toBe(BASE_TEMPLATE);
    expect(templateFor(undefined, list)).toBe(BASE_TEMPLATE);
    // Punkte zeigen nur, wenn eine vorhandene Vorlage mehr als „Nur Meilen“ zählt (F-505)
    expect(usesTemplates([{ log: {} }, { log: { templateId: BASE_TEMPLATE_ID } }, { log: { templateId: 'weg' } }], list)).toBe(false);
    expect(usesTemplates([{ log: { templateId: 'preis' } }], list)).toBe(true);
  });

  it('[F-501] Vorbelegung: eigene Vorlage, sonst zuletzt genutzte, sonst „Nur Meilen“ – nur, wenn noch wählbar', () => {
    const list = [BASE_TEMPLATE, tpl('a', {}), tpl('b', {})];
    expect(defaultTemplateId('a', 'b', list)).toBe('a');
    expect(defaultTemplateId(undefined, 'b', list)).toBe('b');
    expect(defaultTemplateId('weg', 'auchweg', list)).toBe(BASE_TEMPLATE_ID);
  });
});

describe('Punkte je Eintrag (F-502)', () => {
  it('[F-502] „Nur Meilen“ = Seemeilen; ausgeschlossene zählen nie', () => {
    expect(scoreEntry(e({ distNm: 12.34 }), BASE_RULES)).toBe(12.3);
    expect(scoreEntry(e({ logState: 'excluded' }), BASE_RULES)).toBe(0);
    expect(scoreEntry(e({ logState: 'suggested' }), BASE_RULES)).toBe(10);
  });

  it('[F-502] Motor-Anteil aus den Stunden, Revier (+ Tide) und Rolle wirken auf die Seemeilen', () => {
    const r = rules({ nmSail: 1, nmMotor: 0.5, coastal: 1.2, tidal: 0.2, skipper: 1.5 });
    // 3 h Segel, 1 h Motor: 7,5 sm Segel + 2,5 sm × 0,5 = 8,75 × (1,2 + 0,2) × 1,5 = 18,375
    expect(scoreEntry(e({ role: 'skipper', log: { sailH: 3, engineH: 1, area: 'coastal', tidal: true } }), r)).toBe(18.4);
    // ohne Stunden alles unter Segel, ohne Revier und Rolle Faktor 1
    expect(scoreEntry(e({}), r)).toBe(10);
    // nur Motor
    expect(scoreEntry(e({ log: { engineH: 2 } }), r)).toBe(5);
  });

  it('[F-502] Zusätze, Regatta, Posten mit Deckel und Deckel je Eintrag', () => {
    const r = rules({ nmSail: 0, nmMotor: 0, nightH: 2, day: 5, lock: 1, bridge: 0.5, mast: 3, regatta: 10, regattaPlace: 1, items: [{ name: 'Training', points: 5, cap: 12 }] });
    const log = { area: 'inland' as const, locks: 2, bridges: 2, mast: 1, regatta: { name: 'Pokal', place: 3, starters: 10 }, items: [{ name: 'training', n: 2 }, { name: 'TRAINING', n: 1 }] };
    // Tage: 2 (Kalendertage), 2 × 5 + 2 + 1 + 3 + 10 + (10 − 3 + 1) + min(15, 12) = 46
    expect(scoreEntry(e({ endedAt: T0 + DAY, log }), r)).toBe(46);
    expect(scoreEntry(e({ endedAt: T0 + DAY, log }), { ...r, cap: 20 })).toBe(20);
    // Regatta ohne Platz: nur Teilnahme
    expect(scoreEntry(e({ log: { regatta: { name: 'X' } } }), rules({ nmSail: 0, nmMotor: 0, regatta: 10, regattaPlace: 1 }))).toBe(10);
  });

  it('[F-502] Punkte je Vorlage über die Einträge, ausgeschlossene zählen nicht', () => {
    const list = [BASE_TEMPLATE, tpl('doppelt', { nmSail: 2, nmMotor: 2 })];
    const by = pointsByTemplate([e({ log: { templateId: 'doppelt' } }), e({ distNm: 5 }), e({ logState: 'excluded', log: { templateId: 'doppelt' } })], list);
    expect(by.map((b) => [b.template.id, b.points, b.count])).toEqual([['doppelt', 20, 1], [BASE_TEMPLATE_ID, 5, 1]]);
  });
});

describe('Gewichtung der Vereinsliste (F-504)', () => {
  it('[F-504] Summe je Vorlage × Faktor, Vorlagen ohne Faktor zählen nicht', () => {
    expect(clubPoints([{ template: { listWeight: 1 }, points: 10 }, { template: { listWeight: 2 }, points: 15 }, { template: { listWeight: null }, points: 99 }])).toBe(40);
    expect(clubPoints([])).toBe(0);
  });

  it('[F-504] [F-555] Saison ohne Angabe: bis Ende Februar die abgelaufene, ab 1. März die laufende', () => {
    expect(clubListSeason(Date.UTC(2026, 10, 3))).toBe(2026);
    expect(clubListSeason(Date.UTC(2026, 11, 31))).toBe(2026);
    expect(clubListSeason(Date.UTC(2027, 0, 2))).toBe(2026);
    expect(clubListSeason(Date.UTC(2027, 1, 28, 23))).toBe(2026);
    expect(clubListSeason(Date.UTC(2027, 2, 1))).toBe(2027);
    expect(clubListSeason(Date.UTC(2026, 6, 1))).toBe(2026);
  });
});

describe('Jahresbericht als CSV (F-505)', () => {
  it('[F-505] Spalten Revier, Posten, Vorlage, Punkte; Summen je Vorlage; Hinweis; Formel-Schutz bleibt', () => {
    const list = [BASE_TEMPLATE, tpl('=preis', { day: 5 }, { name: '=Preis' })];
    const entries = [
      e({ distNm: 8, log: { area: 'coastal', tidal: true, items: [{ name: 'Training', n: 2 }], templateId: '=preis' } }),
      e({ startedAt: T0 + DAY, distNm: 4 }),
    ];
    // Vorlagen-IDs aus Buchstaben und Ziffern – hier nur die Anzeige des Namens mit „=“ prüfen
    const lines = logbookCsv(entries, false, reportScores(entries, [BASE_TEMPLATE, { ...list[1], id: 'preis' }])).replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer;Revier;Posten;Vorlage;Punkte');
    expect(lines[1]).toBe('13.06.2026;;;8,0;Angabe;;;;Küste (Tide);Training × 2;Nur Meilen;8,0');
    expect(lines[2]).toBe('14.06.2026;;;4,0;Angabe;;;;;;Nur Meilen;4,0');
    expect(lines).toContain('Summe;;;12,0;;;;;;;Nur Meilen;12,0');
    expect(lines.at(-1)).toMatch(/^Vereinshilfe/);
    const scored = reportScores([e({ log: { templateId: 'preis' } })], [{ ...list[1], id: 'preis' }]);
    expect(scored.of(e({ log: { templateId: 'preis' } }))).toEqual({ template: '=Preis (SC Möwe)', points: 15 });
    // Name mit „=“ am Anfang wird in der Datei entschärft
    expect(logbookCsv([e({ log: { templateId: 'preis' } })], false, scored)).toContain(";'=Preis (SC Möwe);15,0");
    // ohne Punkte bleibt der Meilennachweis wie bisher
    expect(logbookCsv(entries).split('\r\n')[0]).toBe('﻿Datum;Von;Nach;sm;Quelle;Rolle;Boot;Dauer');
  });
});
