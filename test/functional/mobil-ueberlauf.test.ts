// @vitest-environment happy-dom
// Überlauf bei 375 px (F-615 … F-617): Anmelde-Dialog nach „Link senden“, Startseite mit langem Bootsnamen,
// Törn-Chip über der Grundkarten-Wahl.
import L from 'leaflet';
import { afterEach, describe, expect, it } from 'vitest';
import { dialogStyles } from '../../src/components/shared';
import '../../src/components/sx-login-dialog';
import '../../src/components/sx-discover';
import { SxEmptyState } from '../../src/components/sx-empty-state';
import { SxTopbar } from '../../src/components/sx-topbar';
import { SxEventDialog } from '../../src/components/sx-event-dialog';
import { addBaseMapControl } from '../../src/map/basemap-control';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

const cssOf = (styles: unknown): string =>
  ([styles].flat(Infinity) as { cssText: string }[]).map((s) => s.cssText).join('\n').replace(/\s+/g, ' ');
const stylesOf = (el: LitEl) => cssOf((el.constructor as unknown as { elementStyles: unknown }).elementStyles);

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

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => document.body.replaceChildren());

describe('Überlauf bei 375 px', () => {
  it('[F-615] Dialog-Inhalt hat eine Spalte minmax(0, 1fr); Code-Zeile bricht um, Code-Feld ist ein gestyltes Textfeld', async () => {
    expect(cssOf(dialogStyles)).toMatch(/\.body \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    const el = await mount('sx-login-dialog', { sentTo: 'eine.sehr.lange.adresse@beispiel-verein.example.org' });
    const input = el.shadowRoot.querySelector<HTMLInputElement>('form.code input#code')!;
    expect(input.getAttribute('type')).toBe('text'); // sonst greift das gemeinsame Eingabe-Raster aus `base` nicht
    const css = stylesOf(el);
    expect(css).toMatch(/form\.code \.row \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/form\.code input \{[^}]*min-width: 0/);
  });

  it('[F-616] Startseite: Stream-Spalte minmax(0, 1fr), Namens-Chips enden mit Ellipse statt zu verbreitern', async () => {
    expect(cssOf(SxEmptyState.styles)).toMatch(/\.feed, \.side \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    const name = 'Seeschwalbe von Werder an der Havel mit sehr langem Namen';
    const el = await mount('sx-discover', {
      variant: 'strip',
      data: { voyages: [], boats: [{ id: 'B1', name }], people: [], groups: [] },
    });
    const chip = el.shadowRoot.querySelector<HTMLAnchorElement>('.crew a.chip')!;
    expect(chip.querySelector(':scope > span')!.textContent).toBe(name);
    expect(chip.title).toBe(`Boot ${name}`);
    const css = stylesOf(el);
    expect(css).toMatch(/section \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.chip \{[^}]*min-width: 0;[^}]*max-width: 100%[^}]*overflow: hidden/);
    expect(css).toMatch(/\.chip > span \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis/);
  });

  it('[F-617] Törn-Chip lässt auf dem Handy rechts Platz für die Grundkarten-Wahl, die „Grundkarte“ heißt', () => {
    expect(media(cssOf(SxTopbar.styles), '(max-width: 760px) { :host([home])')).toMatch(
      /\.chip\.toern \{[^}]*max-width: calc\(100vw - 2 \* 64px\)/,
    );
    const el = document.createElement('div');
    document.body.append(el);
    const map = L.map(el).setView([54.4, 12.7], 8);
    const ctl = addBaseMapControl(map, { Tag: L.layerGroup(), Nacht: L.layerGroup() });
    const toggle = ctl.getContainer()!.querySelector<HTMLElement>('.leaflet-control-layers-toggle')!;
    expect(toggle.title).toBe('Grundkarte');
    expect(toggle.getAttribute('aria-label')).toBe('Grundkarte');
    expect(ctl.getContainer()!.closest('.leaflet-top.leaflet-right')).not.toBeNull();
    map.remove();
  });

  it('[F-615] Dialoge mit eigener .body-Regel behalten die Spalte minmax(0, 1fr) (Termin-Dialog)', () => {
    const own = cssOf(SxEventDialog.styles).split(cssOf(dialogStyles)).join('');
    const bodies = own.match(/(^|[\s}])\.body \{[^}]*\}/g) ?? [];
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/display:|grid-template-columns:/);
  });
});
