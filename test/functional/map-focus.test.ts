// @vitest-environment happy-dom
// Karte (F-215): Beim Hovern über einen Punkt werden bei mehreren Tracks die übrigen verblasst dargestellt.
import { describe, expect, it } from 'vitest';
import L from 'leaflet';
import { MapView } from '../../src/map/map-view';
import { P, makeTrack } from './helpers';

type Internals = { trackGroups: Map<unknown, L.LayerGroup> };

function lineOpacities(group: L.LayerGroup): number[] {
  const out: number[] = [];
  group.eachLayer((l) => {
    if (l instanceof L.Polyline) out.push((l.options.opacity ?? 1) as number);
  });
  return out;
}

describe('MapView: Track hervorheben', () => {
  it('[F-215] Hover auf einen Punkt verblasst die anderen Tracks, Verlassen stellt alle wieder her; ein einzelner Track bleibt unverändert', () => {
    const el = document.createElement('div');
    Object.assign(el.style, { width: '400px', height: '300px' });
    document.body.append(el);
    const view = new MapView(el, { onHover: () => {} });
    const a = makeTrack([P(52.40, 13.00, 0), P(52.41, 13.01, 60_000)], { id: 'a', name: 'A' });
    const b = makeTrack([P(52.42, 13.02, 120_000), P(52.43, 13.03, 180_000)], { id: 'b', name: 'B' });
    view.fit([a, b]);
    view.render([a, b], 'speed', null);
    const groups = (view as unknown as Internals).trackGroups;
    const ga = groups.get(a)!;
    const gb = groups.get(b)!;

    view.showHover(a.points[1]);
    expect(lineOpacities(ga).every((o) => o >= 0.7)).toBe(true);
    expect(lineOpacities(gb).every((o) => o < 0.35)).toBe(true);

    view.showHover(b.points[0]);
    expect(lineOpacities(ga).every((o) => o < 0.35)).toBe(true);
    expect(lineOpacities(gb).every((o) => o >= 0.7)).toBe(true);

    view.showHover(null);
    expect([...lineOpacities(ga), ...lineOpacities(gb)].every((o) => o >= 0.7)).toBe(true);

    view.render([a], 'speed', null);
    view.showHover(a.points[0]);
    expect(lineOpacities((view as unknown as Internals).trackGroups.get(a)!).every((o) => o >= 0.7)).toBe(true);
  });
});
