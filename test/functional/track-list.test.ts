// @vitest-environment happy-dom
// Trackliste: Zeile des gehoverten Tracks hervorheben bzw. per Hover auf der Karte hervorheben (F-226), GPX-Export (F-227).
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-track-list';
import { gpxFileName } from '../../src/components/sx-track-list';
import { P, makeTrack } from './helpers';

type List = HTMLElement & { tracks: unknown[]; focused: string | null; updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };

const a = makeTrack([P(52.4, 13, 0), P(52.41, 13.01, 60_000)], { id: 'a', name: 'Havel Runde.gpx', raw: '<gpx>a</gpx>' });
const b = makeTrack([P(52.42, 13.02, 120_000), P(52.43, 13.03, 180_000)], { id: 'b', name: 'B' });

async function mount(tracks: unknown[], focused: string | null = null): Promise<List> {
  const el = document.createElement('sx-track-list') as List;
  Object.assign(el, { tracks, focused });
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const rows = (el: List) => [...el.shadowRoot.querySelectorAll('li')];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Trackliste', () => {
  it('[F-226] mehrere Tracks: Zeile des gehoverten Tracks hervorgehoben; Hovern einer Zeile meldet den Track, Verlassen null', async () => {
    const got: (string | null)[] = [];
    document.addEventListener('sx-track-focus', (e) => got.push((e as CustomEvent<string | null>).detail));
    const el = await mount([a, b], 'b');
    expect(rows(el).map((r) => r.classList.contains('focus'))).toEqual([false, true]);
    rows(el)[0].dispatchEvent(new Event('mouseenter'));
    rows(el)[0].dispatchEvent(new Event('mouseleave'));
    expect(got).toEqual(['a', null]);

    const single = await mount([a], 'a');
    expect(rows(single)[0].classList.contains('focus')).toBe(false);
  });

  it('[F-227] Download-Knopf neben dem Auge lädt das Original-GPX mit lesbarem Dateinamen herunter', async () => {
    const created: Blob[] = [];
    const url = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (created.push(blob as Blob), 'blob:x'));
    let clicked = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this.download;
    });
    const el = await mount([a, b]);
    const btns = [...rows(el)[0].querySelectorAll('button')];
    const dl = btns.findIndex((x) => x.classList.contains('dl'));
    expect(dl).toBe(1); // direkt nach dem Auge
    btns[dl].click();
    expect(clicked).toBe('Havel-Runde.gpx');
    expect(await created[0].text()).toBe('<gpx>a</gpx>');
    expect(rows(el)[1].querySelector('.dl')).toBeNull(); // ohne Original-GPX kein Export
    expect(gpxFileName('  /?  ')).toBe('track.gpx');
    url.mockRestore();
    click.mockRestore();
  });
});
