// Docs konfliktarm (CLAUDE.md): Konzept-Abschnitte ab 26 stehen in eigenen Dateien unter docs/concept/,
// in docs/CONCEPT.md nur eine Verweiszeile.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const docs = resolve(__dirname, '../docs');
const concept = readFileSync(resolve(docs, 'CONCEPT.md'), 'utf8');

describe('Konzept in eigenen Dateien ab Abschnitt 26', () => {
  const sections = [...concept.matchAll(/^## (\d+)\. .*$/gm)].filter((m) => Number(m[1]) >= 26);

  it('jeder Abschnitt ab 26 ist in CONCEPT.md nur eine Verweiszeile auf eine vorhandene Datei', () => {
    for (const m of sections) {
      const link = m[0].match(/\]\((concept\/(\d+)-[a-z0-9-]+\.md)\)\s*$/);
      expect(link, m[0]).not.toBeNull();
      expect(link![2]).toBe(m[1]);
      expect(existsSync(resolve(docs, link![1])), link![1]).toBe(true);
      // nach der Verweiszeile folgt direkt der nächste Abschnitt oder das Dateiende – kein Inhalt
      const rest = concept.slice(m.index! + m[0].length).split(/^## /m)[0];
      expect(rest.trim(), `Inhalt unter ${m[0]}`).toBe('');
    }
  });

  it('[F-430] Konzept 26 (Diagramm-Zoom) steht in docs/concept/26-diagramm-zoom.md', () => {
    expect(sections.map((m) => m[1])).toContain('26');
    const file = readFileSync(resolve(docs, 'concept/26-diagramm-zoom.md'), 'utf8');
    expect(file).toMatch(/^# 26\. Diagramm-Großansicht/);
    expect(file).toMatch(/F-430/);
    expect(concept).not.toMatch(/\| Ein Mechanismus \|/);
  });
});
