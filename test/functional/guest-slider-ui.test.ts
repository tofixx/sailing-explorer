// @vitest-environment happy-dom
// Gäste-Slider der Startseite (F-431, Konzept 22): vier Folien mit je einem Knopf, Blättern per Wischen, Punkten,
// Pfeilen und Tastatur, Zahlen nur, wenn sie nicht leer wirken; die Seitenleiste zeigt dann keine zweite Einstiegskarte.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-guest-slider';
import '../../src/components/sx-empty-state';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const button = (el: LitEl, label: RegExp) =>
  [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;

let cleanups: Array<() => void> = [];
function listen(name: string) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  document.addEventListener(name, fn);
  cleanups.push(() => document.removeEventListener(name, fn));
  return got;
}
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
  document.body.innerHTML = '';
});

describe('sx-guest-slider (F-431)', () => {
  const slides = (el: LitEl) => [...el.shadowRoot.querySelectorAll<HTMLElement>('.slide')];
  const stats = { season: 2026, voyages: 128, nm: 2410, boats: 23 };

  it('[F-431] vier Folien mit je genau einem Knopf, Karussell für Screenreader', async () => {
    const el = await mount('sx-guest-slider', { stats });
    const root = el.shadowRoot.querySelector('section')!;
    expect(root.getAttribute('aria-roledescription')).toBe('carousel');
    expect(root.getAttribute('aria-label')).toBeTruthy();
    const s = slides(el);
    expect(s).toHaveLength(4);
    for (const [i, slide] of s.entries()) {
      expect(slide.getAttribute('role')).toBe('group');
      expect(slide.getAttribute('aria-label')).toMatch(new RegExp(`^${i + 1} von 4: `));
      expect(slide.querySelectorAll('button, a')).toHaveLength(1);
    }
    expect(s.map((x) => x.querySelector('.btn')!.textContent!.trim())).toEqual(['GPX ausprobieren', 'Vereine & Häfen entdecken', 'Kostenlos anmelden', 'Community ansehen']);
  });

  it('[F-431] Knöpfe melden den vorhandenen Weg: GPX wie „+ Neu“, Anmelden, Stream, Entdecken als Link, × blendet aus', async () => {
    const compose = listen('sx-compose-open');
    const login = listen('sx-login');
    const stream = listen('sx-guest-stream');
    const dismiss = listen('sx-guest-dismiss');
    const el = await mount('sx-guest-slider', {});
    const s = slides(el);
    s[0].querySelector('button')!.click();
    s[2].querySelector('button')!.click();
    s[3].querySelector('button')!.click();
    expect(compose).toEqual([{ kind: 'gpx' }]);
    expect(stream).toHaveLength(1);
    expect(login).toHaveLength(1);
    expect(s[1].querySelector('a')!.getAttribute('href')).toBe('/entdecken');
    button(el, /Einführung ausblenden/)!.click();
    expect(dismiss).toHaveLength(1);
  });

  it('[F-431] Punkte, Pfeile und Pfeiltasten blättern ohne automatischen Wechsel', async () => {
    const el = await mount('sx-guest-slider', {});
    const dots = () => [...el.shadowRoot.querySelectorAll('.dot')].map((d) => d.getAttribute('aria-current'));
    expect(dots()).toEqual(['true', 'false', 'false', 'false']);
    expect(button(el, /Vorherige Folie/)!.disabled).toBe(true);
    button(el, /Nächste Folie/)!.click();
    await el.updateComplete;
    expect(dots()).toEqual(['false', 'true', 'false', 'false']);
    (el.shadowRoot.querySelectorAll('.dot')[3] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(button(el, /Nächste Folie/)!.disabled).toBe(true);
    el.shadowRoot.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await el.updateComplete;
    expect(dots()).toEqual(['false', 'false', 'true', 'false']);
  });

  it('[F-431] Saison-Zahlen nur, wenn sie nicht leer wirken – sonst Text ohne Zahlen', async () => {
    const big = await mount('sx-guest-slider', { stats });
    expect(slides(big)[1].textContent).toMatch(/128.*Törns 2026.*2\.410.*Seemeilen.*23.*aktive Boote/s);
    const small = await mount('sx-guest-slider', { stats: { season: 2026, voyages: 3, nm: 40, boats: 1 } });
    expect(slides(small)[1].querySelector('.stats')).toBeNull();
    expect(slides(small)[1].textContent).not.toMatch(/\d/);
  });

  it('[F-431] Folie 2 nennt echte Vereine und Häfen, ohne Zahlen mit Titelbildern; Folie 4 zeigt die Stufen', async () => {
    const groups = [
      { slug: 'pyc', name: 'Potsdamer Yacht Club', kind: 'club', homePort: '', description: '', createdAt: 0, members: 9, cover: { src: '/api/covers/g/pyc/v1', y: 40 } },
      { slug: 'crew', name: 'Crew Havel', kind: 'team', homePort: '', description: '', createdAt: 0, members: 3, cover: null },
    ];
    const el = await mount('sx-guest-slider', { groups, harbors: [{ slug: 'templin', name: 'Hafen Templin', boats: 2, groups: 1 }] });
    const two = slides(el)[1];
    expect(two.textContent).toContain('Zum Beispiel Potsdamer Yacht Club, Crew Havel und Hafen Templin.');
    expect([...two.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/api/covers/g/pyc/v1']);
    const none = await mount('sx-guest-slider', {});
    expect(slides(none)[1].querySelector('img')).toBeNull();
    expect(slides(none)[1].textContent).not.toContain('Zum Beispiel');
    expect([...slides(none)[3].querySelectorAll('.levels li')].map((li) => li.textContent!.trim())).toEqual(['Öffentlich', 'Nur Mitglieder']);
    expect(slides(none)[3].textContent).not.toMatch(/Link|Nur ich/);
  });

  it('[F-431] Seitenleiste der Startseite: mit sichtbarem Slider keine kompakte Karte, ausgeblendet kommt sie zurück', async () => {
    const el = await mount('sx-empty-state', { community: true, samples: [] });
    const slider = document.createElement('sx-guest-slider');
    slider.slot = 'join';
    el.append(slider);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.side')!.textContent).not.toMatch(/Eigenen Törn anlegen/);
    slider.hidden = true;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.side')!.textContent).toMatch(/Eigenen Törn anlegen/);
  });
});
