// @vitest-environment happy-dom
// Saisonrückblick in der Oberfläche (Konzept 33): Abzeichen-Reihe auf „Mein Fahrtenbuch“ (F-521), einziger Einstieg
// und Dialog (F-522), Ablauf im Controller ohne Server (F-523, F-524).
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-logbook-page';
import { LogbookPageController } from '../../src/controllers/logbook-page';
import type { SxLogbookPage } from '../../src/components/sx-logbook-page';
import type { SxSeasonReview } from '../../src/components/sx-season-review';
import type { LogbookEntry } from '../../src/domain/logbook-year';

const render = vi.hoisted(() => vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })));
// Canvas gibt es in happy-dom nicht – das Zeichnen selbst prüft test/season-review.test.ts
vi.mock('../../src/services/season-image', () => ({ renderSeasonImage: render }));

type El = SxLogbookPage & { shadowRoot: ShadowRoot };
async function mount(props: Partial<SxLogbookPage>): Promise<El> {
  const el = document.createElement('sx-logbook-page') as El;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (root: ParentNode) => (root.textContent ?? '').replace(/\s+/g, ' ');
const button = (root: ParentNode, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  render.mockClear();
});

const entry = (o: Partial<LogbookEntry>): LogbookEntry => ({
  id: 'A', own: true, path: '/s/A', title: 'Havel', startedAt: Date.UTC(2026, 5, 13, 10), endedAt: null, timed: false, source: 'gpx',
  distNm: 120, distSource: 'track', from: null, to: null, role: 'skipper', roleConfirmed: false, boat: 'Möwe', logState: 'confirmed', log: {}, ...o,
});
const entries = [entry({}), entry({ id: 'B', distNm: 30, logState: 'suggested' }), entry({ id: 'C', startedAt: Date.UTC(2025, 6, 1), distNm: 40, logState: 'excluded' })];

describe('Abzeichen-Reihe und Einstieg auf „Mein Fahrtenbuch“', () => {
  it('[F-521] Reihe unter den Summen: erreicht, das nächste mit Rest – folgt dem Filter', async () => {
    const el = await mount({ entries, season: 2026, states: ['confirmed', 'suggested'] });
    const badges = el.shadowRoot.querySelector('sx-season-badges')! as HTMLElement & { updateComplete: Promise<boolean> };
    await badges.updateComplete;
    const items = [...badges.shadowRoot!.querySelectorAll('li')];
    expect(items.map((li) => [li.className, li.getAttribute('aria-label')])).toEqual([
      ['reached', '100 sm erreicht'],
      ['next', '500 sm – noch 350,0 sm'],
      ['later', '1.000 sm'],
    ]);
    // nur Vorschläge: 30 sm – das erste Abzeichen ist wieder offen
    el.states = ['suggested'];
    await el.updateComplete;
    await badges.updateComplete;
    expect(badges.shadowRoot!.querySelector('li')!.getAttribute('aria-label')).toBe('100 sm – noch 70,0 sm');
  });

  it('[F-522] Ein Knopf „Meine Saison <Jahr>“ neben der Saison-Überschrift, nur mit zählenden Einträgen, nicht im Druck', async () => {
    const el = await mount({ entries, season: 2026, states: ['confirmed', 'suggested'] });
    const head = el.shadowRoot.querySelector('.sum-head')!;
    expect([...el.shadowRoot.querySelectorAll('button')].filter((b) => /Meine Saison/.test(b.textContent ?? ''))).toHaveLength(1);
    expect(button(head, /Meine Saison 2026/)).toBeTruthy();
    const opened: unknown[] = [];
    el.addEventListener('sx-season-open', () => opened.push(1));
    button(head, /Meine Saison/)!.click();
    expect(opened).toHaveLength(1);
    // Saison 2025 hat nur einen ausgeschlossenen Eintrag: kein Knopf, keine Abzeichen
    el.season = 2025;
    await el.updateComplete;
    expect(button(el.shadowRoot, /Meine Saison/)).toBeUndefined();
    expect(el.shadowRoot.querySelector('sx-season-badges')).toBeNull();
    // Druckstil blendet den Knopf aus
    const css = (el.constructor as typeof SxLogbookPage).styles!.toString();
    expect(css).toMatch(/\.sum-head \.btn,/);
  });

  it('[F-522] Dialog: Vorschau mit Alternativtext, Format, Herunterladen; Teilen nur mit Datei-Teilen des Geräts', async () => {
    const el = await mount({ entries, season: 2026, states: ['confirmed', 'suggested'] });
    el.seasonImage = { url: 'blob:x', busy: false, format: 'square' };
    await el.updateComplete;
    const dlg = el.shadowRoot.querySelector('sx-season-review') as SxSeasonReview;
    await dlg.updateComplete;
    const root = dlg.shadowRoot!;
    expect(dlg.open).toBe(true);
    expect(text(root.querySelector('h2')!)).toBe('Meine Saison 2026');
    expect(root.querySelector('img')!.getAttribute('alt')).toMatch(/^Meine Saison 2026: Seemeilen 150,0 sm, Törns 2/);
    expect(text(root)).toMatch(/nur in deinem Browser/);
    expect(button(root, /Teilen/)).toBeUndefined();
    const got: string[] = [];
    for (const n of ['sx-season-format', 'sx-season-download', 'sx-season-share', 'sx-season-close'])
      el.addEventListener(n, (e) => got.push(`${n} ${JSON.stringify((e as CustomEvent).detail ?? null)}`));
    const radios = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    radios[1].dispatchEvent(new Event('change'));
    button(root, /Herunterladen/)!.click();
    button(root, /Schließen/)!.click();
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true });
    dlg.requestUpdate();
    await dlg.updateComplete;
    button(root, /Teilen/)!.click();
    expect(got).toEqual([
      'sx-season-format {"format":"landscape"}',
      'sx-season-download null',
      'sx-season-close null',
      'sx-season-share null',
    ]);
  });
});

describe('Ablauf im Controller', () => {
  it('[F-523] [F-524] Bild nur im Browser: zeichnen, Format wechseln, herunterladen, teilen, schließen – kein Abruf beim Server', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response('{}', { status: 500 });
    }));
    const revoked: string[] = [];
    let n = 0;
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: (u: string) => revoked.push(u) }));
    const el = await mount({ entries, season: 2026, states: ['confirmed', 'suggested'] });
    const c = new LogbookPageController({ page: el, toast: () => {}, ready: async () => {}, signedIn: () => true, requireLogin: () => {}, edit: () => {} });
    el.dispatchEvent(new CustomEvent('sx-season-open'));
    await vi.waitFor(() => expect(el.seasonImage).toEqual({ url: 'blob:1', busy: false, format: 'square' }));
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ season: 2026, voyages: 2, nm: 150 }), 'square');
    el.dispatchEvent(new CustomEvent('sx-season-format', { detail: { format: 'landscape' } }));
    await vi.waitFor(() => expect(el.seasonImage).toEqual({ url: 'blob:2', busy: false, format: 'landscape' }));
    expect(revoked).toEqual(['blob:1']);

    // Herunterladen: Datei meine-saison-2026.jpg über einen Link im Browser
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    el.dispatchEvent(new CustomEvent('sx-season-download'));
    expect(clicks).toEqual(['meine-saison-2026.jpg']);
    // Teilen über das Gerät, wenn es Dateien teilen kann
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    el.dispatchEvent(new CustomEvent('sx-season-share'));
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    const shared = (share.mock.calls[0] as unknown as [{ files: File[]; title: string }])[0];
    expect(shared.title).toBe('Meine Saison 2026');
    expect(shared.files[0].name).toBe('meine-saison-2026.jpg');
    click.mockRestore();

    // Schließen verwirft die Vorschau
    el.dispatchEvent(new CustomEvent('sx-season-close'));
    expect(el.seasonImage).toBeNull();
    expect(revoked).toEqual(['blob:1', 'blob:2']);
    expect(calls).toEqual([]);
    void c;
  });
});
