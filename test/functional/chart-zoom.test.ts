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

  it('[F-430] lange Zeiträume werden in der Großansicht breiter (28 px je Stunde) und damit seitlich scrollbar', async () => {
    const big = await mount({ points: points(72), large: true });
    const drawWidth = (big as unknown as { drawWidth: (w: number) => number }).drawWidth.bind(big);
    expect(drawWidth(800)).toBe(72 * 28);
    // sehr lange Zeiträume: gedeckelt, damit das Canvas noch gezeichnet wird
    const long = await mount({ points: points(24 * 60), large: true });
    expect((long as unknown as { drawWidth: (w: number) => number }).drawWidth(800)).toBeLessThanOrEqual(16_384);
    expect(drawWidth(3000)).toBe(3000);
    const small = await mount({ points: points(72) });
    expect((small as unknown as { drawWidth: (w: number) => number }).drawWidth(800)).toBe(800);
  });
});
