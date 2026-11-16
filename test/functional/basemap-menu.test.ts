// @vitest-environment happy-dom
// Grundkarte im Kartenstil-Menü (F-660 … F-663, UX N1): eine Gruppe „Grundkarte“ statt der Leaflet-Ebenen-Steuerung.
import L from 'leaflet';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-map-style';
import type { SxMapStyle } from '../../src/components/sx-map-style';
import { BASE_MAPS, MAP_LANG, defaultBaseMap } from '../../src/domain/basemaps';
import { BaseMapLayer } from '../../src/map/base-map';

type LitEl = SxMapStyle & { shadowRoot: ShadowRoot };

async function mount(props: Partial<SxMapStyle> = {}): Promise<LitEl> {
  const el = document.createElement('sx-map-style') as LitEl;
  Object.assign(el, { open: true, ...props });
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const bases = (el: LitEl) => [...el.shadowRoot.querySelectorAll<HTMLButtonElement>('.item.base')];
const cssOf = (styles: unknown): string =>
  ([styles].flat(Infinity) as { cssText: string }[]).map((s) => s.cssText).join('\n').replace(/\s+/g, ' ');

/** Farbschema zum Umschalten im Test */
function scheme(dark: boolean) {
  const listeners: Array<() => void> = [];
  const mq = { matches: dark, addEventListener: (_: string, fn: () => void) => listeners.push(fn) } as unknown as MediaQueryList;
  const flip = (d: boolean) => {
    Object.assign(mq, { matches: d });
    listeners.forEach((f) => f());
  };
  return { mq, flip };
}

function leafletMap(): L.Map {
  const div = document.createElement('div');
  document.body.append(div);
  return L.map(div).setView([54.4, 12.7], 8);
}
const tileUrls = (map: L.Map) => {
  const urls: string[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.TileLayer) urls.push((l as unknown as { _url: string })._url);
  });
  return urls;
};

afterEach(() => document.body.replaceChildren());

describe('F-660 Gruppe „Grundkarte“ im Kartenstil-Menü', () => {
  it('[F-660] zeigt alle Grundkarten als Gruppe mit Überschrift, die geltende mit Haken und aria-pressed', async () => {
    const el = await mount({ baseMap: 'esri-ocean' });
    const group = el.shadowRoot.querySelector('[role="group"][aria-labelledby="mb-h"]')!;
    expect(group.querySelector('#mb-h')!.textContent).toBe('Grundkarte');
    const items = bases(el);
    expect(items.map((b) => b.textContent!.trim())).toEqual(BASE_MAPS.map((m) => m.label));
    expect(items.map((b) => b.getAttribute('aria-pressed'))).toEqual(BASE_MAPS.map((m) => String(m.key === 'esri-ocean')));
    expect(items.find((b) => b.getAttribute('aria-pressed') === 'true')!.querySelector('.mark svg')).not.toBeNull();
  });

  it('[F-660] Klick wählt sofort (sx-map-base), das Menü bleibt offen; Klick auf die geltende schließt es', async () => {
    const el = await mount({ baseMap: 'osm-de' });
    const got: unknown[] = [];
    el.addEventListener('sx-map-base', (e) => got.push((e as CustomEvent).detail));
    bases(el).find((b) => b.textContent!.includes('Nacht'))!.click();
    await el.updateComplete;
    expect(got).toEqual([{ key: 'esri-dark' }]);
    expect(el.open).toBe(true);
    bases(el).find((b) => b.getAttribute('aria-pressed') === 'true')!.click();
    await el.updateComplete;
    expect(got).toHaveLength(1);
    expect(el.open).toBe(false);
  });

  it('[F-660] ein Weg (UX N1): keine Leaflet-Ebenen-Steuerung mehr im Code', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
    const users = files(resolve('src')).filter((f) => /control\.layers|leaflet-control-layers/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual([]);
  });

  it('[F-660] Startseite und Orts-Seiten (auch nach einem geöffneten Törn) zeigen den Knopf nicht', () => {
    const css = readFileSync(resolve('src/styles/app.css'), 'utf8');
    const hidden = /([^{}]*)\{\s*display:\s*none;?\s*\}/g;
    const selectors = [...css.matchAll(hidden)].map((m) => m[1]).filter((s) => s.includes('sx-map-style')).join(',');
    expect(selectors).toContain('.app[data-empty] sx-map-style');
    expect(selectors).toContain('.app[data-page][data-place] sx-map-style');
  });
});

describe('F-661 Grundkarte auf der Karte', () => {
  it('[F-661] ohne Wahl gilt der Standard nach Farbschema und MAP_LANG (schon beim Start gemeldet) und folgt einem Schemawechsel', () => {
    const map = leafletMap();
    const s = scheme(false);
    const seen: string[] = [];
    const layer = new BaseMapLayer(map, (k) => seen.push(k), s.mq);
    const day = defaultBaseMap(MAP_LANG, false);
    const night = defaultBaseMap(MAP_LANG, true);
    expect(layer.key).toBe(day.key);
    expect(tileUrls(map)).toEqual([day.url]);
    s.flip(true);
    expect(layer.key).toBe(night.key);
    expect(tileUrls(map)).toEqual([night.url]);
    expect(seen).toEqual([day.key, night.key]);
    map.remove();
  });

  it('[F-661] eine Wahl gilt auch über einen Schemawechsel hinweg; unbekannte Schlüssel ändern nichts', () => {
    const map = leafletMap();
    const s = scheme(false);
    const seen: string[] = [];
    const layer = new BaseMapLayer(map, (k) => seen.push(k), s.mq);
    layer.set('esri-ocean');
    layer.set('gibt-es-nicht');
    s.flip(true);
    expect(layer.key).toBe('esri-ocean');
    expect(tileUrls(map)).toEqual([BASE_MAPS.find((m) => m.key === 'esri-ocean')!.url]);
    expect(seen).toEqual([defaultBaseMap(MAP_LANG, false).key, 'esri-ocean']);
    expect(map.getContainer().querySelector('.leaflet-control-layers')).toBeNull();
    map.remove();
  });
});

describe('F-662 Menü mobil', () => {
  it('[F-662] mobil scrollt das Sheet unter der Kopfzeile; alle Einträge sind mindestens 44 px hoch', async () => {
    const el = await mount({ signedIn: true, current: 'classic', profileStyle: 'classic' });
    const css = cssOf((el.constructor as unknown as { elementStyles: unknown }).elementStyles);
    const mobile = css.slice(css.indexOf('@media (max-width: 760px) { .menu { max-height'));
    expect(mobile).toMatch(/^@media \(max-width: 760px\) \{ \.menu \{[^}]*max-height: calc\(100dvh - var\(--topbar-h, 56px\)\);[^}]*overflow-y: auto[^}]*\} \.btn\.small\.action \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.item \{[^}]*min-height: 44px/);
    // Standard-Knöpfe sind .action (mobil 44 px), alle anderen Einträge .item
    const buttons = [...el.shadowRoot.querySelectorAll<HTMLButtonElement>('.menu button')];
    expect(buttons.filter((b) => b.classList.contains('action')).length).toBe(2);
    expect(buttons.every((b) => b.classList.contains('item') || b.classList.contains('action'))).toBe(true);
    expect(el.shadowRoot.querySelectorAll('.item.base').length).toBe(BASE_MAPS.length);
  });
});

describe('F-663 Einbettung', () => {
  it('[F-663] eingebettet zeigt das Menü nur die Grundkarten – ohne Stile, Revier und Standard-Knöpfe', async () => {
    const el = await mount({ embed: true, baseMap: 'osm-de', signedIn: true, profileStyle: 'classic' });
    const toggle = el.shadowRoot.querySelector('.toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe('Grundkarte');
    expect(el.shadowRoot.querySelector('#ms-h')!.textContent).toBe('Grundkarte');
    const buttons = [...el.shadowRoot.querySelectorAll<HTMLButtonElement>('.menu button')];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(BASE_MAPS.map((m) => m.label));
    expect(el.shadowRoot.querySelector('.heat, .action, .bar, .hint')).toBeNull();
    const got: unknown[] = [];
    el.addEventListener('sx-map-base', (e) => got.push((e as CustomEvent).detail));
    buttons.find((b) => b.textContent!.includes('Seekarte'))!.click();
    expect(got).toEqual([{ key: 'esri-ocean' }]);
  });

  it('[F-663] Einbettungen blenden den Knopf nicht mehr aus, die Startseite schon; app.ts setzt embed', () => {
    const css = readFileSync(resolve('src/styles/app.css'), 'utf8');
    expect(css).not.toMatch(/\[data-embed\] sx-map-style/);
    expect(css).toMatch(/.app[data-empty] sx-map-style[,s]/);
    expect(readFileSync(resolve('src/app.ts'), 'utf8')).toMatch(/this\.ui\.mapStyle\.embed = true/);
  });
});
