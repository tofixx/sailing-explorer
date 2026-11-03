// @vitest-environment happy-dom
// Anleitung „So zeichnest du deinen Törn auf“ (Konzept 25, F-450): Route, Seite aus src/content/recording-guide.ts
// und die Einstiege im „+ Neu“-Sheet und auf der Startseite.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-guide-page';
import '../../src/components/sx-compose';
import '../../src/components/sx-empty-state';
import { RECORDING_GUIDE, RECORDING_GUIDE_PATH } from '../../src/content/recording-guide';
import { parseRoute } from '../../src/services/url-state';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const loc = (pathname: string) => ({ pathname, search: '', hash: '' });
const guideLinks = (root: ShadowRoot) => [...root.querySelectorAll(`a[href="${RECORDING_GUIDE_PATH}"]`)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Anleitung Aufzeichnen (F-450)', () => {
  it('[F-450] /anleitung/aufzeichnen ist eine eigene Route', () => {
    expect(RECORDING_GUIDE_PATH).toBe('/anleitung/aufzeichnen');
    expect(parseRoute(loc('/anleitung/aufzeichnen'))).toEqual({ kind: 'guide' });
    expect(parseRoute(loc('/anleitung/aufzeichnen/'))).toEqual({ kind: 'guide' });
    expect(parseRoute(loc('/anleitung')).kind).toBe('home');
  });

  it('[F-450] die Seite zeigt alle Abschnitte als aufklappbare Gruppen mit nummerierten Schritten', async () => {
    const el = await mount('sx-guide-page', {});
    const root = el.shadowRoot;
    expect(root.querySelector('h1')?.textContent).toBe(RECORDING_GUIDE.title);
    const details = [...root.querySelectorAll('details')];
    expect(details.map((d) => d.id)).toEqual(['handy', 'uhr', 'garmin-plotter', 'andere-plotter', 'ohne', 'danach']);
    // Handy und „Und dann“ offen, der Rest zugeklappt
    expect(details.filter((d) => d.open).map((d) => d.id)).toEqual(['handy', 'danach']);
    for (const d of details) expect(d.querySelector('summary h2')?.textContent).toBeTruthy();
    expect(root.querySelector('#handy ol li')).not.toBeNull();
    const text = (root.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('OsmAnd');
    expect(text).toContain('ACTIVE LOG');
    expect(text).toContain('+ Neu → Törn (GPX)');
    expect(text).toContain('+ Neu → Fahrtenbuch-Eintrag');
    // externe Quellen öffnen in einem neuen Tab, ohne Opener
    for (const a of root.querySelectorAll('a[target="_blank"]')) expect(a.getAttribute('rel')).toBe('noopener');
    expect(root.querySelector('nav a[href="/"]')).not.toBeNull();
  });

  it('[F-450] „+ Neu“: unter „Törn (GPX)“ führt „Wie zeichne ich auf?“ zur Anleitung', async () => {
    const el = await mount('sx-compose', { open: true });
    const links = guideLinks(el.shadowRoot);
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain('Wie zeichne ich auf?');
    // direkt hinter dem GPX-Eintrag, kein eigener Menüeintrag
    expect(links[0].previousElementSibling?.textContent).toContain('Törn (GPX)');
    // der Hinweis ist kein Menüeintrag (unabhängig davon, wie viele Arten „+ Neu“ anbietet)
    expect(links[0].classList.contains('item')).toBe(false);
    expect([...el.shadowRoot.querySelectorAll('.item')].every((i) => i.localName === 'button')).toBe(true);
  });

  it('[F-450] Startseite ohne Track: Hinweis in der Einstiegskarte (groß und kompakt) und „Anleitung“ in der Fußzeile', async () => {
    const big = await mount('sx-empty-state', {});
    expect(big.shadowRoot.querySelector(`.card a[href="${RECORDING_GUIDE_PATH}"]`)?.textContent).toContain('So zeichnest du deinen Törn auf');
    expect(big.shadowRoot.querySelector(`footer a[href="${RECORDING_GUIDE_PATH}"]`)?.textContent).toBe('Anleitung');

    const compact = await mount('sx-empty-state', { community: true });
    expect(compact.shadowRoot.querySelector(`.card.compact a[href="${RECORDING_GUIDE_PATH}"]`)).not.toBeNull();
    expect(compact.shadowRoot.querySelector(`footer a[href="${RECORDING_GUIDE_PATH}"]`)).not.toBeNull();

    // mit geladenem Track kein Hinweis in der Karte – die Fußzeile bleibt
    for (const el of [big, compact]) {
      el.trackCount = 1;
      await el.updateComplete;
      expect(el.shadowRoot.querySelector(`.card a[href="${RECORDING_GUIDE_PATH}"]`)).toBeNull();
      expect(el.shadowRoot.querySelector(`footer a[href="${RECORDING_GUIDE_PATH}"]`)).not.toBeNull();
    }
  });
});
