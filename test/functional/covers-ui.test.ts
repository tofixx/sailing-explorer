// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche für Titelbilder (Konzept 13.2, F-211): Ausschnitt durch Ziehen oder per
// Schieberegler wählen, Speichern/Abbrechen, nach einem Upload direkt in den Ausschnitt-Modus.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-page-media';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement('sx-cover') as LitEl;
  Object.assign(el, { kind: 'b', targetId: 'Boot1', src: '/api/covers/b/Boot1/abc123', canEdit: true, ...props });
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const button = (el: LitEl, label: RegExp) =>
  [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
const img = (el: LitEl) => el.shadowRoot.querySelector('img')!;
const slider = (el: LitEl) => el.shadowRoot.querySelector<HTMLInputElement>('input[type=range]');
const position = (el: LitEl) => img(el).style.objectPosition;

/** Bild „geladen“ mit diesen Maßen, im Banner mit diesen Maßen angezeigt (happy-dom rechnet kein Layout). */
async function load(el: LitEl, natural: [number, number], shown: [number, number] = [900, 300]) {
  const i = img(el);
  Object.defineProperties(i, {
    naturalWidth: { value: natural[0], configurable: true },
    naturalHeight: { value: natural[1], configurable: true },
    clientWidth: { value: shown[0], configurable: true },
    clientHeight: { value: shown[1], configurable: true },
  });
  i.dispatchEvent(new Event('load'));
  await el.updateComplete;
}

const pointer = (type: string, clientY: number) => new PointerEvent(type, { pointerId: 1, clientY, bubbles: true, cancelable: true });

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

describe('sx-cover: Ausschnitt (F-211)', () => {
  it('F-211: zeigt den gespeicherten Ausschnitt; „Ausschnitt“ nur für Verwalter und nur bei Spielraum', async () => {
    const el = await mount({ focusY: 30 });
    expect(position(el)).toBe('50% 30%');
    expect(button(el, /Ausschnitt/)).toBeUndefined(); // noch nicht geladen
    await load(el, [1500, 500]); // 3:1 – nichts zu verschieben
    expect(button(el, /Ausschnitt/)).toBeUndefined();
    await load(el, [1500, 1000]);
    expect(button(el, /Ausschnitt/)).toBeDefined();

    const guest = await mount({ canEdit: false, focusY: 30 });
    await load(guest, [1500, 1000]);
    expect(button(guest, /Ausschnitt/)).toBeUndefined();
  });

  it('F-211: Ziehen verschiebt den Ausschnitt, Speichern meldet ihn samt vorherigem Wert', async () => {
    const got = listen('sx-cover-focus');
    const el = await mount({ focusY: 50 });
    await load(el, [1500, 1000]); // 900 × 600 angezeigt → 300 px Überstand
    button(el, /Ausschnitt/)!.click();
    await el.updateComplete;
    expect(button(el, /Ändern/)).toBeUndefined();

    img(el).dispatchEvent(pointer('pointerdown', 100));
    img(el).dispatchEvent(pointer('pointermove', 160)); // 60 px nach unten → 20 % weiter oben
    await el.updateComplete;
    expect(position(el)).toBe('50% 30%');
    expect(slider(el)!.value).toBe('30');
    img(el).dispatchEvent(pointer('pointerup', 160));
    img(el).dispatchEvent(pointer('pointermove', 400)); // nach dem Loslassen ohne Wirkung
    await el.updateComplete;
    expect(position(el)).toBe('50% 30%');

    button(el, /Speichern/)!.click();
    await el.updateComplete;
    expect(got).toEqual([{ kind: 'b', id: 'Boot1', focusY: 30, previous: 50 }]);
    expect(slider(el)).toBeNull();
    expect(position(el)).toBe('50% 30%');
  });

  it('F-211: Schieberegler (Tastatur) und Abbrechen bzw. Escape stellen den alten Ausschnitt wieder her', async () => {
    const got = listen('sx-cover-focus');
    const el = await mount({ focusY: 40 });
    await load(el, [1200, 800]);
    button(el, /Ausschnitt/)!.click();
    await el.updateComplete;
    const s = slider(el)!;
    expect(s.getAttribute('aria-label')).toMatch(/Ausschnitt/);
    s.value = '75';
    s.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(position(el)).toBe('50% 75%');
    button(el, /Abbrechen/)!.click();
    await el.updateComplete;
    expect(position(el)).toBe('50% 40%');

    button(el, /Ausschnitt/)!.click();
    await el.updateComplete;
    slider(el)!.value = '10';
    slider(el)!.dispatchEvent(new Event('input'));
    slider(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await el.updateComplete;
    expect(slider(el)).toBeNull();
    expect(position(el)).toBe('50% 40%');
    expect(got).toEqual([]);
  });

  it('F-211: Escape am Banner bricht ab, Fokus wandert zum Regler und zurück zu „Ausschnitt“', async () => {
    const el = await mount({ focusY: 40 });
    await load(el, [1500, 1000]);
    button(el, /Ausschnitt/)!.click();
    await el.updateComplete;
    await el.updateComplete;
    expect(el.shadowRoot.activeElement).toBe(slider(el));
    img(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await el.updateComplete;
    await el.updateComplete;
    expect(slider(el)).toBeNull();
    expect(el.shadowRoot.activeElement).toBe(button(el, /Ausschnitt/));
  });

  it('F-211: wechselt das Objekt (Navigation), wird eine offene Bearbeitung verworfen', async () => {
    const got = listen('sx-cover-focus');
    const el = await mount({ focusY: 40 });
    await load(el, [1500, 1000]);
    button(el, /Ausschnitt/)!.click();
    await el.updateComplete;
    Object.assign(el, { targetId: 'Boot2', src: '/api/covers/b/Boot2/def456', focusY: 50 });
    await el.updateComplete;
    expect(slider(el)).toBeNull();
    expect(position(el)).toBe('50% 50%');
    expect(button(el, /Ausschnitt/)).toBeUndefined(); // erst nach dem Laden des neuen Bilds
    expect(got).toEqual([]);
  });

  it('F-211: nach einem Upload öffnet sich der Ausschnitt-Modus, sobald das neue Bild geladen ist – nur mit Spielraum', async () => {
    const el = await mount({});
    (el as unknown as { adjust(): void }).adjust();
    await load(el, [1500, 1000]);
    expect(slider(el)).not.toBeNull();

    const flat = await mount({});
    (flat as unknown as { adjust(): void }).adjust();
    await load(flat, [1500, 500]);
    expect(slider(flat)).toBeNull();
  });
});
