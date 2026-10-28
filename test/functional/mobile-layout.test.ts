// @vitest-environment happy-dom
// Handy-Breite: Dialoge als Vollbild, Community-Startseite scrollt per Touch, Kopfzeile passt (F-291); Toasts (F-292).
import { describe, expect, it } from 'vitest';
import { dialogStyles } from '../../src/components/shared';
import { SxEmptyState } from '../../src/components/sx-empty-state';
import { SxTopbar } from '../../src/components/sx-topbar';
import { SxToast } from '../../src/components/sx-toast';

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

describe('F-292 Meldungen (Toasts)', () => {
  // nur die eigenen Stile, ohne den geteilten Grundbaustein
  const toastCss = () => cssOf((SxToast.styles as unknown[])[1]);

  it('Desktop: oben mittig über dem Kartenbereich unter der Kopfzeile, nie unter der Seitenleiste', () => {
    const host = toastCss().match(/^.*?:host \{([^}]*)\}/)![1];
    expect(host).toMatch(/inset: calc\(var\(--topbar-h\) \+ var\(--s-3\)\) auto auto calc\(\(100vw - var\(--sidebar-w\)\) \/ 2\)/);
    expect(host).toMatch(/max-width: calc\(100vw - var\(--sidebar-w\)/);
  });

  it('Handy: unten über dem FAB samt Safe Area, volle Breite mit Rand, Text bricht um', () => {
    const m = media(toastCss(), '(max-width: 760px)');
    expect(m).toMatch(/inset: auto auto calc\(env\(safe-area-inset-bottom, 0px\) \+ 56px/);
    expect(m).toMatch(/max-width: calc\(100vw - 2 \* var\(--s-3\)/);
    expect(toastCss()).toMatch(/\.pill \{[^}]*max-width: 100%[^}]*white-space: normal[^}]*overflow-wrap: anywhere/);
    expect(toastCss()).not.toMatch(/nowrap|text-overflow/);
  });

  it('liegt als Popover in der Top-Layer – auch über modalen Dialogen', async () => {
    const t = document.createElement('sx-toast') as SxToast;
    document.body.append(t);
    expect(t.getAttribute('popover')).toBe('manual');
    const raised: string[] = [];
    t.showPopover = () => void raised.push('show');
    t.show('Gespeichert');
    await t.updateComplete;
    expect(raised).toEqual(['show']);
    t.remove();
  });
});
