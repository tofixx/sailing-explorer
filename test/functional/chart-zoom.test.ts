// @vitest-environment happy-dom
// Großansicht der Verlaufs-Diagramme mit scrollbarer Zeitachse (F-430).
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-time-chart';

type El = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

// happy-dom zeichnet nicht – ein Kontext, der alles schluckt
const noop = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true });
HTMLCanvasElement.prototype.getContext = (() => noop) as unknown as typeof HTMLCanvasElement.prototype.getContext;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const T0 = Date.UTC(2026, 6, 1);
const points = (hours: number) => Array.from({ length: hours + 1 }, (_, i) => ({ time: T0 + i * 3_600_000, sog: 4 + (i % 3) }));
const series = [{ label: 'Fahrt', unit: 'kn', decimals: 1, colorVar: '--c-speed', axis: 'left', value: (p: { sog: number }) => p.sog }];

async function mount(props: Record<string, unknown>): Promise<El> {
  const el = document.createElement('sx-time-chart') as El;
  Object.assign(el, { series, left: { unit: 'kn', colorVar: '--text-2', minMax: 5, step: 1 }, label: 'Geschwindigkeit', ...props });
  document.body.append(el);
  await el.updateComplete;
  return el;
}
afterEach(() => (document.body.innerHTML = ''));

describe('F-430 Großansicht der Diagramme', () => {
  it('[F-430] Knopf öffnet die Großansicht mit derselben Zeitreihe; Schließen beendet sie', async () => {
    const el = await mount({ points: points(10) });
    (el.shadowRoot.querySelector('.zoom') as HTMLButtonElement).click();
    await el.updateComplete;
    const dlg = el.shadowRoot.querySelector('dialog')!;
    expect(dlg.hasAttribute('open')).toBe(true);
    const big = dlg.querySelector('sx-time-chart') as El;
    expect(big.hasAttribute('large')).toBe(true);
    expect((big.points as unknown[]).length).toBe(11);
    expect(big.shadowRoot.querySelector('.zoom')).toBeNull(); // keine Großansicht in der Großansicht
    (dlg.querySelector('button[aria-label="Schließen"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.zoomed).toBe(false);
  });

  it('[F-430] Titelzeile der Großansicht zeigt den gewählten Zeitpunkt mit Datum und Uhrzeit', async () => {
    const el = await mount({ points: points(10), zoomed: true });
    const when = () => el.shadowRoot.querySelector('dialog header .when');
    expect(when()).toBeNull();
    el.hoverTime = T0 + 3 * 3_600_000;
    await el.updateComplete;
    expect(when()?.textContent).toMatch(/01\.07\.26/);
    expect(when()?.textContent).toMatch(/\d{2}:\d{2}/);
  });

  type Big = El & { view: { zoom: number; offset: number }; contentWidth: () => number; resetView: () => void };
  const scroll = (big: El) => big.shadowRoot.querySelector('.scroll') as HTMLElement;
  const wheel = (big: El, init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { deltaY: -100, clientX: 200, bubbles: true, cancelable: true, ...init });
    scroll(big).dispatchEvent(e);
    return e;
  };

  it('[F-430] lange Zeiträume starten mit 28 px je Stunde und sind seitlich scrollbar; kurze passen ganz', async () => {
    const big = (await mount({ points: points(72), large: true })) as Big;
    const s = scroll(big);
    expect(s.hasAttribute('data-scroll-x')).toBe(true);
    expect(s.getAttribute('tabindex')).toBe('0');
    expect(s.getAttribute('aria-label')).toMatch(/Plus und Minus zoomen.*Pfeiltasten verschieben.*0 zeigt den ganzen Zeitraum/);
    // Testumgebung misst 0 px – es gilt die Vorgabebreite 320, Datenfläche 320 − 34 − 12
    expect(big.view.zoom).toBeCloseTo((72 * 28) / 274, 6);
    const short = (await mount({ points: points(5), large: true })) as Big;
    expect(short.view.zoom).toBe(1);
  });

  it('[F-430] Rad mit Strg zoomt um den Zeiger, „Ganzer Zeitraum“ in der Titelzeile setzt zurück', async () => {
    const el = await mount({ points: points(6), zoomed: true });
    const big = el.shadowRoot.querySelector('sx-time-chart[large]') as Big;
    await big.updateComplete;
    const reset = () => el.shadowRoot.querySelector('dialog header .reset') as HTMLButtonElement | null;
    expect(big.view.zoom).toBe(1);
    expect(reset()).toBeNull();
    const e = wheel(big, { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true); // kein Browser-Zoom
    expect(big.view.zoom).toBeGreaterThan(1);
    await el.updateComplete;
    expect(reset()?.textContent).toBe('Ganzer Zeitraum');
    reset()!.click();
    await el.updateComplete;
    expect(big.view).toEqual({ zoom: 1, offset: 0 });
    expect(reset()).toBeNull();
    // ganz herausgezoomt: Rad ohne Strg geht an die Seite weiter
    expect(wheel(big, { deltaY: 100 }).defaultPrevented).toBe(false);
    // waagerechtes Rad bleibt natives Scrollen
    expect(wheel(big, { deltaY: 0, deltaX: 80 }).defaultPrevented).toBe(false);
  });

  it('[F-430] Tastatur: + zoomt, Pfeil verschiebt, 0 setzt zurück', async () => {
    const big = (await mount({ points: points(6), large: true })) as Big;
    const key = (k: string) => scroll(big).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('+');
    expect(big.view.zoom).toBeCloseTo(1.5, 6);
    const off = big.view.offset;
    key('ArrowRight');
    expect(big.view.offset).toBeGreaterThan(off);
    key('-');
    key('0');
    expect(big.view).toEqual({ zoom: 1, offset: 0 });
  });

  it('[F-430] stark gezoomt bleibt die Canvas so breit wie der sichtbare Bereich; die Scrollbreite ist gedeckelt', async () => {
    const big = (await mount({ points: points(24 * 60), large: true })) as Big;
    for (let i = 0; i < 200; i++) wheel(big, { ctrlKey: true, deltaY: -100 });
    expect(big.view.zoom).toBeGreaterThan(100);
    const cv = big.shadowRoot.querySelector('canvas.base') as HTMLCanvasElement;
    expect(cv.width).toBeLessThanOrEqual(320 * (window.devicePixelRatio || 1));
    expect(cv.width).toBeLessThanOrEqual(16_384);
    expect(big.contentWidth()).toBeLessThanOrEqual(4_000_000 + 34 + 12);
    expect((big.shadowRoot.querySelector('.wrap') as HTMLElement).style.width).toBe(`${big.contentWidth()}px`);
  });

  it('[F-430] das kleine Diagramm bleibt ohne Zoom und ohne Scrollbereich', async () => {
    const small = await mount({ points: points(72) });
    const s = small.shadowRoot.querySelector('.scroll') as HTMLElement;
    expect(s.hasAttribute('tabindex')).toBe(false);
    expect(s.hasAttribute('data-scroll-x')).toBe(false);
  });
});
