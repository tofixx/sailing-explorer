// @vitest-environment happy-dom
// Revier-Wärmekarte in der Oberfläche (Konzept 37): Schalter im Kartenstil-Menü und Controller (F-584), Ebene und
// Cluster-Pins auf der Karte (F-585), Einpassen der Startseite (F-586), Raster senden (F-581).
import { afterEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import '../../src/components/sx-map-style';
import type { SxMapStyle } from '../../src/components/sx-map-style';
import { HeatController, sendHeat } from '../../src/controllers/heat';
import { HeatLayer } from '../../src/map/heat-layer';
import { Store, initialState } from '../../src/services/store';
import { HEAT, cellOf, type HeatData } from '../../src/domain/heat';
import { jsonResponse } from './helpers';

// happy-dom zeichnet nicht: ein Canvas-Kontext, dessen Methoden nichts tun (Leaflet rendert per Canvas)
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({})), set: () => true });
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const [I, J] = cellOf(52.4, 13.0);
const DATA: HeatData = {
  cells: [I, J, 3, I + 1, J, 1, I + 2, J + 1, 1],
  voyages: [
    ['a', I, J],
    ['b', I + 1, J],
    ['c', I + 2, J + 1],
  ],
};

function fetchStub(data: HeatData = DATA) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return url === '/api/discover/heat' ? jsonResponse(data) : new Response(null, { status: 204 });
  });
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('F-584 Schalter „Revier“ im Kartenstil-Menü', () => {
  it('[F-584] Eintrag mit aria-pressed im vorhandenen Menü (kein neuer Knopf), Klick meldet sx-map-heat', async () => {
    const el = document.createElement('sx-map-style') as SxMapStyle;
    Object.assign(el, { current: 'classic', heat: true, open: true });
    document.body.append(el);
    await el.updateComplete;
    const root = el.shadowRoot!;
    // ein einziger Knopf auf der Karte
    expect(root.querySelectorAll('.toggle').length).toBe(1);
    const item = [...root.querySelectorAll<HTMLButtonElement>('.item')].find((b) => b.textContent!.includes('Revier'))!;
    expect(item.getAttribute('aria-pressed')).toBe('true');
    const got: unknown[] = [];
    el.addEventListener('sx-map-heat', (e) => got.push((e as CustomEvent).detail));
    item.click();
    expect(got).toEqual([{ on: false }]);
    // Menü bleibt offen
    expect(el.open).toBe(true);
  });

  it('[F-584] Controller: lädt einmal erst mit Backend, Standard an; aus leert die Ebene, an zeigt sie ohne neuen Abruf', async () => {
    const calls = fetchStub();
    const store = new Store(initialState);
    const set = vi.fn();
    const picker = { heat: false };
    const c = new HeatController(store, { layer: { set, fitHotspot: () => true }, picker });
    expect(picker.heat).toBe(true);
    c.setView({ pins: true, fit: false });
    await flush();
    expect(calls.length).toBe(0);
    expect(set).toHaveBeenLastCalledWith(null, false);
    store.set({ backend: true });
    await flush();
    expect(set).toHaveBeenLastCalledWith(DATA, true);
    c.toggle(false);
    await flush();
    expect(picker.heat).toBe(false);
    expect(set).toHaveBeenLastCalledWith(null, false);
    c.toggle(true);
    c.setView({ pins: false, fit: false });
    await flush();
    expect(set).toHaveBeenLastCalledWith(DATA, false);
    expect(calls.filter((x) => x.url === '/api/discover/heat').length).toBe(1);
  });
});

function mapEl() {
  const el = document.createElement('div');
  Object.assign(el.style, { width: '400px', height: '300px' });
  // happy-dom misst nicht: Größe für Leaflet (getSize) vorgeben
  Object.defineProperties(el, { clientWidth: { value: 400 }, clientHeight: { value: 300 } });
  document.body.append(el);
  const map = L.map(el).setView([52.41, 13.0], 13);
  return { el, map };
}

const markers = (map: L.Map) => {
  const out: L.Marker[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.Marker) out.push(l);
  });
  return out;
};
const rects = (map: L.Map) => {
  let n = 0;
  map.eachLayer((l) => {
    if (l instanceof L.Rectangle) n++;
  });
  return n;
};

describe('F-585 Ebene und Cluster-Pins', () => {
  it('[F-585] Zellen als Rechtecke auf eigener Ebene; Pins nur auf Wunsch, nahe Törns als Cluster mit Zahl', () => {
    const { el, map } = mapEl();
    const layer = new HeatLayer(map, el);
    layer.set(DATA, false);
    expect(rects(map)).toBe(3);
    expect(markers(map).length).toBe(0);
    expect(map.getPane('sx-heat')).toBeTruthy();

    layer.set(DATA, true);
    map.setZoom(8); // alle drei Pins fallen in ein Raster von 48 px
    const pins = markers(map);
    expect(pins.length).toBe(1);
    expect(pins[0].options.title).toBe('3 Törns – hineinzoomen');
    map.setZoom(18);
    expect(markers(map).every((m) => m.options.title === 'Törn ansehen')).toBe(true);
    expect(markers(map).length).toBe(3);

    layer.set(null, true);
    expect(rects(map) + markers(map).length).toBe(0);
  });

  it('[F-585] ein einzelner Pin öffnet den Törn, ein Cluster zoomt hinein', () => {
    const { el, map } = mapEl();
    const layer = new HeatLayer(map, el);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign });
    layer.set(DATA, true);
    map.setZoom(18);
    markers(map)[0].fire('click');
    expect(assign).toHaveBeenCalledWith('/s/a');
    map.setZoom(8);
    markers(map)[0].fire('click');
    expect(map.getZoom()).toBeGreaterThan(8);
  });
});

describe('F-586 Startseite einpassen', () => {
  it('[F-586] passt einmal je Seitenleben auf den dichtesten Bereich ein, nur wenn die Ansicht es will', async () => {
    fetchStub();
    const store = new Store({ ...initialState, backend: true });
    const fit = vi.fn(() => true);
    const c = new HeatController(store, { layer: { set: () => {}, fitHotspot: fit }, picker: { heat: true } });
    c.setView({ pins: true, fit: false });
    await flush();
    expect(fit).not.toHaveBeenCalled();
    c.setView({ pins: true, fit: true });
    await flush();
    c.setView({ pins: false, fit: false });
    c.setView({ pins: true, fit: true });
    await flush();
    expect(fit).toHaveBeenCalledTimes(1);

    const { el, map } = mapEl();
    const layer = new HeatLayer(map, el);
    expect(layer.fitHotspot()).toBe(false);
    layer.set(DATA, false);
    expect(layer.fitHotspot()).toBe(true);
    expect(map.getBounds().contains([52.4 + HEAT.cellLat / 2, 13.0 + HEAT.cellLon / 2])).toBe(true);
    expect(map.getZoom()).toBeLessThanOrEqual(12);
  });

  it('[F-586] ohne Kartengröße (versteckt) wird nicht eingepasst (keine Zoomstufe NaN), sondern beim ersten Größenwechsel', () => {
    const el = document.createElement('div');
    let w = 0;
    Object.defineProperties(el, { clientWidth: { get: () => w }, clientHeight: { get: () => w } });
    document.body.append(el);
    const map = L.map(el).setView([54, 12], 8);
    const layer = new HeatLayer(map, el);
    layer.set(DATA, true);
    expect(layer.fitHotspot()).toBe(true);
    expect(map.getZoom()).toBe(8);
    w = 400;
    map.invalidateSize({ animate: false });
    expect(Number.isFinite(map.getZoom())).toBe(true);
    expect(map.getBounds().contains([52.4 + HEAT.cellLat / 2, 13.0 + HEAT.cellLon / 2])).toBe(true);
  });
});

describe('F-586 aufgeschobenes Einpassen', () => {
  it('[F-586] lädt jemand vor dem ersten Größenwechsel ein GPX, wird nicht mehr eingepasst', async () => {
    fetchStub();
    const el = document.createElement('div');
    let w = 0;
    Object.defineProperties(el, { clientWidth: { get: () => w }, clientHeight: { get: () => w } });
    document.body.append(el);
    const map = L.map(el).setView([54, 12], 8);
    const layer = new HeatLayer(map, el);
    const store = new Store({ ...initialState, backend: true });
    const c = new HeatController(store, { layer, picker: { heat: true } });
    c.setView({ pins: true, fit: true });
    await flush();
    // GPX geladen: Törn-Ansicht will kein Einpassen mehr
    c.setView({ pins: false, fit: false });
    await flush();
    w = 400;
    map.invalidateSize({ animate: false });
    expect(map.getZoom()).toBe(8);
    expect(map.getCenter().lat).toBeCloseTo(54);
  });
});

describe('F-581 Raster senden', () => {
  it('[F-581] sendet das Raster eines GPX-Törns einmal je Sitzung, nie für Fahrtenbuch-Einträge oder ohne Zellen', async () => {
    const calls = fetchStub();
    const pts = Array.from({ length: 50 }, (_, k) => ({ lat: 52.4 + k * 0.001, lon: 13 }));
    sendHeat('t1', [{ points: pts }]);
    sendHeat('t1', [{ points: pts }]);
    sendHeat('t2', [{ points: pts, estimated: true }]);
    sendHeat('t3', [{ points: pts.slice(0, 2) }]);
    await flush();
    const puts = calls.filter((x) => x.init?.method === 'PUT');
    expect(puts.map((x) => x.url)).toEqual(['/api/shares/t1/heat']);
    const body = JSON.parse(String(puts[0].init!.body)) as { cells: number[] };
    expect(body.cells.length).toBeGreaterThan(0);
    expect(Object.keys(body)).toEqual(['cells']);
  });
});
