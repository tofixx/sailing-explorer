import { sampleTrackUrl } from './url-state';

/** Lädt eine Beispiel-/Link-Datei aus /tracks/ (nur einfache Dateinamen). */
export async function fetchTrackFile(name: string): Promise<{ name: string; text: string }> {
  const url = sampleTrackUrl(name);
  if (!url) throw new Error('Ungültiger Dateiname');
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { name: name.replace(/\.gpx$/i, ''), text: await r.text() };
}
