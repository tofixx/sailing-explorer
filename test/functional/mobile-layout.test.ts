// @vitest-environment happy-dom
// Handy-Breite: Dialoge als Vollbild, Community-Startseite scrollt per Touch, Kopfzeile passt (F-291).
import { describe, expect, it } from 'vitest';
import { dialogStyles } from '../../src/components/shared';
import { SxEmptyState } from '../../src/components/sx-empty-state';
import { SxTopbar } from '../../src/components/sx-topbar';

const cssOf = (styles: unknown): string =>
  ([styles].flat(Infinity) as { cssText: string }[]).map((s) => s.cssText).join('\n').replace(/\s+/g, ' ');

/** Inhalt des ersten @media-Blocks mit `query` (bis zur passenden schließenden Klammer). */
function media(css: string, query: string): string {
  const i = css.indexOf(`@media ${query}`);
  expect(i, `@media ${query}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') depth++;
    if (css[j] === '}' && --depth === 0) return css.slice(i, j + 1);
  }
  return '';
}

describe('F-291 Handy-Layout', () => {
  it('Dialoge sind in Handy-Breite randlos, scrollen und gewinnen gegen die Breiten der einzelnen Dialoge', () => {
    const m = media(cssOf(dialogStyles), '(max-width: 760px)');
    expect(m).toMatch(/dialog\[open\] \{[^}]*width: 100%[^}]*height: 100dvh[^}]*border-radius: 0[^}]*overflow-y: auto/);
    expect(m).toMatch(/header \{[^}]*position: sticky/);
  });

  it('Community-Startseite nimmt auf Touch-Geräten Wischgesten selbst an', () => {
    const m = media(cssOf(SxEmptyState.styles), '(pointer: coarse) { :host([community])');
    expect(m).toMatch(/:host\(\[community\]\) \{[^}]*pointer-events: auto/);
  });

  it('Startseite: auf dem Handy keine eigene Scroll-Ebene, der Stream fließt in der Seite', () => {
    const m = media(cssOf(SxEmptyState.styles), '(max-width: 760px) { :host { position: relative');
    expect(m).toMatch(/overflow: visible/);
  });

  it('Kopfzeile zeigt „Teilen“ auf schmalen Displays nur als Symbol', () => {
    const m = media(cssOf(SxTopbar.styles), '(max-width: 420px)');
    expect(m).toMatch(/\.share \.label-text \{ display: none/);
  });
});
