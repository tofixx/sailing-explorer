// Unit-Tests: Kommentartext (src/domain/comment-text.ts), ausgeblendete Objekte in canView und Admin-Liste – F-110, F-114.
import { describe, expect, it } from 'vitest';
import { COMMENT_MAX, cleanComment, commentProblem, countLinks, linkify, isReportKind, isCommentsMode } from '../src/domain/comment-text';
import { canView } from '../worker/access';
import { adminIds, isAdmin } from '../worker/validate';

describe('cleanComment', () => {
  it('[F-110] vereinheitlicht Zeilenumbrüche, entfernt Steuer-/Bidi-Zeichen, fasst Leerraum je Zeile zusammen', () => {
    expect(cleanComment('  a\t\tb \r\nc‮d​ ')).toBe('a b\nc d');
    expect(cleanComment('a\n\n\n\n\n\nb')).toBe('a\n\n\n\nb'); // höchstens 3 Leerzeilen
    expect(cleanComment(42)).toBe('');
    expect(cleanComment('<script>x</script>')).toBe('<script>x</script>'); // bleibt Text, wird escaped dargestellt
  });

  it('[F-110] Prüfung: leer, zu lang (Codepoints), zu viele Links', () => {
    expect(commentProblem('')).toBe('empty');
    expect(commentProblem('🙂'.repeat(COMMENT_MAX))).toBeNull();
    expect(commentProblem('x'.repeat(COMMENT_MAX + 1))).toBe('too_long');
    expect(commentProblem('https://a.de https://b.de')).toBeNull();
    expect(commentProblem('https://a.de https://b.de http://c.de')).toBe('too_many_links');
  });
});

describe('linkify', () => {
  it('[F-110] nur http(s) mit Host; Satzzeichen am Ende gehören nicht zum Link', () => {
    expect(linkify('Schau: https://example.org/a?b=1. Danke')).toEqual([
      { text: 'Schau: ' },
      { text: 'https://example.org/a?b=1', href: 'https://example.org/a?b=1' },
      { text: '. Danke' },
    ]);
    expect(countLinks('javascript:alert(1) ftp://x.de www.example.org http://localhost')).toBe(0);
    expect(linkify('(https://de.wikipedia.org/wiki/Kiel_(Stadt))')[1]).toEqual({
      text: 'https://de.wikipedia.org/wiki/Kiel_(Stadt)',
      href: 'https://de.wikipedia.org/wiki/Kiel_(Stadt)',
    });
    expect(linkify('ohne Link')).toEqual([{ text: 'ohne Link' }]);
  });

  it('[F-110] kein HTML-Ausbruch über die URL (Anführungszeichen beenden den Link)', () => {
    const parts = linkify('https://evil.example/"onmouseover="x');
    expect(parts[0]).toEqual({ text: 'https://evil.example/', href: 'https://evil.example/' });
  });
});

describe('Melden und Moderation – reine Regeln', () => {
  it('[F-114] Arten und Modi', () => {
    expect(isReportKind('share')).toBe(true);
    expect(isReportKind('photo')).toBe(false); // folgt mit Fotos
    expect(isCommentsMode('hidden')).toBe(true);
    expect(isCommentsMode('HIDDEN')).toBe(false);
  });

  it('[F-114] Ausgeblendetes sehen nur Verwalter und Admins – auch Admins nie fremde „Nur ich“-Objekte', () => {
    const hidden = { visibility: 'public', shareKey: null, hiddenAt: 1 } as const;
    expect(canView(hidden, { manager: false, key: null })).toBe(false);
    expect(canView(hidden, { manager: true, key: null })).toBe(true);
    expect(canView(hidden, { manager: false, key: null, admin: true })).toBe(true);
    expect(canView({ visibility: 'private', shareKey: null }, { manager: false, key: null, admin: true })).toBe(false);
  });

  it('[F-114] ADMIN_USER_IDS: kommagetrennt, Leerraum egal, ungültige Einträge ignoriert, leer = niemand (fail closed)', () => {
    expect([...adminIds({ ADMIN_USER_IDS: ' AbcdefGhijk12, x, ;drop table, ZyxwvuTsrq98 ' })]).toEqual(['AbcdefGhijk12', 'ZyxwvuTsrq98']);
    expect(isAdmin({ ADMIN_USER_IDS: '' }, 'AbcdefGhijk12')).toBe(false);
    expect(isAdmin({}, 'AbcdefGhijk12')).toBe(false);
    expect(isAdmin({ ADMIN_USER_IDS: 'AbcdefGhijk12' }, null)).toBe(false);
    expect(isAdmin({ ADMIN_USER_IDS: 'AbcdefGhijk12' }, 'AbcdefGhijk12')).toBe(true);
  });
});
