import { bounds, samplePositions, type WeatherData, type WeatherSample } from '../domain/weather';
import type { Track } from '../domain/types';

export type StatusLevel = 'idle' | 'loading' | 'ok' | 'warn' | 'err';
export interface Status {
  level: StatusLevel;
  text: string;
}

interface Hourly {
  time: string[];
  [k: string]: Array<number | null> | string[];
}

async function fetchHourly(urls: string[], probe: string): Promise<Hourly | null> {
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = (await r.json()) as { hourly?: Hourly };
      const vals = j.hourly?.[probe];
      if (Array.isArray(vals) && vals.some((v) => v != null)) return j.hourly!;
    } catch {
      // Netzwerkfehler → nächste Quelle
    }
  }
  return null;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const nums = (h: Hourly | null, k: string) => (h?.[k] as Array<number | null> | undefined) ?? [];

/** Statuszeile für Wetterdaten, die beim Einstellen gespeichert wurden (kein Abruf). */
export function storedWeatherStatus(tracks: Track[], data: WeatherData): Status {
  const b = bounds(tracks);
  const fmt = (t: number) => new Date(t).toLocaleDateString('de-DE');
  const range = b?.tMin != null && b.tMax != null ? ` für ${fmt(b.tMin)} – ${fmt(b.tMax)}` : '';
  const parts = [data.windOk ? 'Wind' : null, data.waveOk ? 'Wellen' : null].filter(Boolean).join(' und ') || 'Wetter';
  const missing = !data.waveOk ? ' Keine Wellendaten (nur auf offener See verfügbar).' : '';
  return { level: 'ok', text: `${parts}${range} – beim Einstellen gespeichert.${missing}` };
}

/** Lädt stündlichen Wind (Forecast, sonst Archiv) und Seegang (Marine) von Open-Meteo. */
export async function loadWeather(tracks: Track[]): Promise<{ data: WeatherData | null; status: Status }> {
  const b = bounds(tracks);
  // Fahrtenbuch ohne GPX: Wetter entlang der geschätzten Route folgt in Phase 2 (Konzept 19.2.2)
  if (tracks.length && tracks.every((t) => t.estimated)) {
    return { data: null, status: { level: 'idle', text: 'Fahrtenbuch-Eintrag ohne GPS-Aufzeichnung – Wind und Wellen gibt es nur zu aufgezeichneten Tracks.' } };
  }
  if (!b || b.tMin == null || b.tMax == null) {
    return { data: null, status: { level: 'warn', text: 'GPX ohne Zeitstempel – Wind und Wellen lassen sich nicht zuordnen. Die Speed-Auswertung funktioniert trotzdem.' } };
  }
  const sd = day(b.tMin - 3_600_000);
  const ed = day(b.tMax + 3_600_000);
  const positions = samplePositions(tracks, 7);

  const results = await Promise.all(
    positions.map(async ({ lat, lon }) => {
      const q = `latitude=${lat}&longitude=${lon}&timezone=UTC&start_date=${sd}&end_date=${ed}`;
      const windQ = `?${q}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`;
      const waveQ = `?${q}&hourly=wave_height,wave_direction,wave_period`;
      const [w, m] = await Promise.all([
        fetchHourly([`https://api.open-meteo.com/v1/forecast${windQ}`, `https://archive-api.open-meteo.com/v1/archive${windQ}`], 'wind_speed_10m'),
        fetchHourly([`https://marine-api.open-meteo.com/v1/marine${waveQ}`], 'wave_height'),
      ]);
      const times = (w ?? m)?.time.map((t) => Date.parse(`${t}Z`)) ?? [];
      const sample: WeatherSample = {
        lat, lon, times,
        wind: nums(w, 'wind_speed_10m'), dir: nums(w, 'wind_direction_10m'), gust: nums(w, 'wind_gusts_10m'),
        wave: nums(m, 'wave_height'), wdir: nums(m, 'wave_direction'), wper: nums(m, 'wave_period'),
      };
      return { sample, windOk: !!w, waveOk: !!m };
    }),
  );

  const samples = results.filter((r) => r.sample.times.length).map((r) => r.sample);
  const windOk = results.some((r) => r.windOk);
  const waveOk = results.some((r) => r.waveOk);
  const fmt = (t: number) => new Date(t).toLocaleDateString('de-DE');
  const range = `${fmt(b.tMin)} – ${fmt(b.tMax)}`;

  if (!samples.length) {
    const future = b.tMax > Date.now();
    return {
      data: null,
      status: future
        ? { level: 'warn', text: `Für ${range} gibt es noch keine Messwerte.` }
        : { level: 'err', text: 'Wetterdienst nicht erreichbar. In eingebetteten Seiten werden externe Abrufe teils blockiert – dann die App in einem eigenen Tab öffnen.' },
    };
  }
  const parts = [windOk ? 'Wind' : null, waveOk ? 'Wellen' : null].filter(Boolean).join(' und ');
  const missing = !waveOk ? ' Keine Wellendaten (nur auf offener See verfügbar).' : '';
  return { data: { samples, windOk, waveOk }, status: { level: 'ok', text: `${parts} für ${range} geladen.${missing}` } };
}
