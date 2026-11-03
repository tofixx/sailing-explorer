// Bootsklassen (Konzept 34, F-535 … F-537): Klassenliste, Zuordnung des freien Typs, Filterwerte – reine Regeln.
import { describe, expect, it } from 'vitest';
import {
  BOAT_CLASSES,
  BOAT_CLASS_GROUPS,
  BOAT_CLASS_RULES,
  boatClassFilterLabel,
  boatClassLabel,
  boatClassesOf,
  classifyBoatType,
  isBoatClass,
  isBoatClassFilter,
  resolveBoatClass,
} from '../src/domain/boat-class';
import { BOAT_TYPE_SAMPLES } from './boat-class-samples';

describe('F-535 Klassenliste und Zuordnung des freien Typs', () => {
  it('[F-535] kurze kuratierte Liste: eindeutige IDs, jede Klasse in einer bekannten Gruppe oder für sich (Sonstige)', () => {
    const ids = BOAT_CLASSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(16);
    const groups = BOAT_CLASS_GROUPS.map(([g]) => g as string);
    for (const c of BOAT_CLASSES) expect(c.group === '' || groups.includes(c.group)).toBe(true);
    expect(BOAT_CLASSES.filter((c) => !c.group).map((c) => c.id)).toEqual(['sonstige']);
    expect(boatClassLabel('j24')).toBe('J/24');
    expect(boatClassLabel('gibtsnicht')).toBe('');
  });

  it('[F-535] Regeln nennen nur bekannte Klassen, Muster sind ASCII-Kleinbuchstaben ohne Trennzeichen', () => {
    for (const [id, ps] of BOAT_CLASS_RULES) {
      expect(isBoatClass(id)).toBe(true);
      for (const p of ps) expect(p).toMatch(/^[a-z0-9 ]+$/);
    }
    // „Sonstige“ wählt nur der Eigner – keine Regel führt dorthin
    expect(BOAT_CLASS_RULES.some(([id]) => id === 'sonstige')).toBe(false);
  });

  it.each(BOAT_TYPE_SAMPLES)('[F-535] „%s“ → %s', (type, cls) => {
    expect(classifyBoatType(type)).toBe(cls);
  });

  it('[F-536] gewählte gültige Klasse gilt, sonst die aus dem Typ abgeleitete; Unbekanntes nie gespeichert', () => {
    expect(resolveBoatClass('drachen', 'Bavaria 34')).toBe('drachen');
    expect(resolveBoatClass('', 'Bavaria 34')).toBe('fahrtenyacht');
    expect(resolveBoatClass('quatsch', 'Bavaria 34')).toBe('fahrtenyacht');
    expect(resolveBoatClass('jollen', 'Segelboot')).toBe('');
    expect(resolveBoatClass(42, '')).toBe('');
  });

  it('[F-537] Filterwerte: Klasse oder Gruppe, Unbekanntes filtert nicht', () => {
    expect(boatClassesOf('folkeboot')).toEqual(['folkeboot']);
    expect(boatClassesOf('jollen')).toEqual(['optimist', 'ilca', '420', '470', 'pirat', 'korsar', 'conger', 'jollenkreuzer']);
    expect(boatClassesOf('yachten')).toEqual(['fahrtenyacht', 'katamaran']);
    expect(boatClassesOf('x')).toBeNull();
    expect(boatClassesOf('')).toBeNull();
    expect(boatClassesOf(null)).toBeNull();
    expect(isBoatClassFilter('kielboote')).toBe(true);
    expect(boatClassFilterLabel('jollen')).toBe('Alle Jollen');
    expect(boatClassFilterLabel('h-boot')).toBe('H-Boot');
  });
});
