import { describe, expect, it } from 'vitest';
import { parseWeatherData } from '../src/domain/weather';
import { validatePayload } from '../src/services/api';

const sample = (n = 3) => ({
  lat: 54.4,
  lon: 12.9,
  times: Array.from({ length: n }, (_, i) => 1_781_000_000_000 + i * 3_600_000),
  wind: Array(n).fill(7),
  dir: Array(n).fill(200),
  gust: Array(n).fill(null),
  wave: [],
  wdir: [],
  wper: [],
});
const good = { samples: [sample()], windOk: true, waveOk: false };

describe('F-22 gespeicherte Wetterdaten prüfen', () => {
  it('[F-22] gültige Daten werden übernommen (leere Reihen = keine Daten dieser Art)', () => {
    expect(parseWeatherData(good)).toEqual(good);
  });

  it('[F-22] ungültige Form, Längen, Werte oder zu große Daten werden verworfen', () => {
    expect(parseWeatherData(null)).toBeNull();
    expect(parseWeatherData({ ...good, windOk: 'ja' })).toBeNull();
    expect(parseWeatherData({ ...good, samples: [] })).toBeNull();
    expect(parseWeatherData({ ...good, samples: [{ ...sample(), wind: [1, 2] }] })).toBeNull();
    expect(parseWeatherData({ ...good, samples: [{ ...sample(), dir: [1, 'x', 3] }] })).toBeNull();
    expect(parseWeatherData({ ...good, samples: [{ ...sample(), lat: 120 }] })).toBeNull();
    expect(parseWeatherData({ ...good, samples: Array(21).fill(sample()) })).toBeNull();
    expect(parseWeatherData({ ...good, samples: [sample(24 * 62 + 1)] })).toBeNull();
  });

  it('[F-22] Freigabe: gültiges Wetter bleibt, ungültiges wird nur entfernt', () => {
    const tracks = [{ name: 'A', gpx: '<gpx/>' }];
    expect(validatePayload({ v: 1, tracks, weather: good }).weather).toEqual(good);
    const p = validatePayload({ v: 1, tracks, weather: { samples: 'kaputt' } });
    expect(p).toEqual({ v: 1, tracks });
  });
});
