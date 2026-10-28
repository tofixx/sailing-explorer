// Kartenbeschriftung auf Deutsch (F-293): eine Einstellung wählt die Standard-Grundkarte nach Sprache und Farbschema.
import { describe, expect, it } from 'vitest';
import { BASE_MAPS, MAP_LANG, defaultBaseMap, labelsFit, type BaseMap } from '../src/domain/basemaps';
import { CONTENT_SECURITY_POLICY } from '../worker/security';
import { SHARE_IMAGE_BASE, shareTileUrl } from '../src/services/share-image';

describe('F-293 Kartenbeschriftung auf Deutsch', () => {
  it('[F-293] die App beschriftet deutsch: tagsüber OSM Deutschland (name:de), nachts ohne Beschriftung', () => {
    expect(MAP_LANG).toBe('de');
    const day = defaultBaseMap(MAP_LANG, false);
    expect(day.key).toBe('osm-de');
    expect(day.url).toContain('tile.openstreetmap.de');
    expect(day.labels).toBe('de');
    const night = defaultBaseMap(MAP_LANG, true);
    expect(night.dark).toBe(true);
    expect(labelsFit(night, 'de')).toBe(true);
  });

  it('[F-293] ein späterer Sprachwechsel ändert nur die Einstellung: englisch → Esri-Seekarte', () => {
    expect(defaultBaseMap('en', false).key).toBe('esri-ocean');
    expect(defaultBaseMap('en', true).key).toBe('esri-dark');
  });

  it('[F-293] ohne passende Beschriftung lieber eine ohne Beschriftung, erst dann irgendeine fürs Schema', () => {
    const m = (key: string, labels: BaseMap['labels']): BaseMap => ({ key, label: key, url: '', maxZoom: 18, attribution: '', attributionText: '', labels });
    expect(defaultBaseMap('de', false, [m('a', 'en'), m('b', 'none')]).key).toBe('b');
    expect(defaultBaseMap('de', false, [m('a', 'en'), m('b', 'local')]).key).toBe('a');
  });

  it('[F-293] anders beschriftete Karten nennen die Sprache im Namen; alle Kachel-Hosts stehen in der CSP', () => {
    for (const b of BASE_MAPS) {
      if (b.labels === 'en') expect(b.label).toContain('englisch');
      if (b.labels === 'local') expect(b.label).toContain('Ortsnamen');
      expect(CONTENT_SECURITY_POLICY).toContain(new URL(b.url.replace(/\{[xyz]\}/g, '0')).origin);
    }
    expect(new Set(BASE_MAPS.map((b) => b.key)).size).toBe(BASE_MAPS.length);
  });

  it('[F-293] OSM-Karten nennen die OpenStreetMap-Mitwirkenden (ODbL), auch als Text fürs Teilen-Bild', () => {
    for (const b of BASE_MAPS.filter((m) => m.url.includes('openstreetmap'))) {
      expect(b.attribution).toContain('openstreetmap.org/copyright');
      expect(b.attributionText).toContain('OpenStreetMap-Mitwirkende');
      expect(b.attributionText).not.toContain('<');
    }
  });

  it('[F-293] das Teilen-Bild nutzt die deutsch beschriftete Tageskarte', () => {
    expect(SHARE_IMAGE_BASE.key).toBe(defaultBaseMap(MAP_LANG, false).key);
    expect(shareTileUrl(5, 17, 10)).toBe('https://tile.openstreetmap.de/5/17/10.png');
  });
});
