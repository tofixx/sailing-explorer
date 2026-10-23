// Eigene Kartensymbole. Eingaben sind ausschließlich Zahlen bzw. Token-Namen – keine Fremdtexte.
// Farben: Intensität aus derselben Rampe wie die Track-Einfärbung, Flächen aus den Tokens
// (die Symbole liegen im Light DOM, CSS-Variablen greifen also).
import { rampColor } from '../domain/metrics';

/** Skalen für die Intensitätsfarbe – identisch zur Legende bei typischen Bereichen. */
export const WIND_SCALE_KN = 30;
export const WAVE_SCALE_M = 3;

export const windColor = (kn: number) => rampColor(kn / WIND_SCALE_KN);
export const waveColor = (m: number) => rampColor(m / WAVE_SCALE_M);

/**
 * Wind-Badge: Knotenzahl im Ring, Pfeilspitze zeigt in Strömungsrichtung (Lee),
 * der Strich gegenüber markiert, woher der Wind kommt.
 */
export function windBadge(dirFrom: number, kn: number): string {
  const col = windColor(kn);
  const rot = (dirFrom + 180) % 360;
  const label = Math.round(kn);
  return `<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
<g transform="rotate(${rot} 22 22)">
  <path d="M22 1.5 28 9.5H16Z" fill="${col}" stroke="var(--map-halo)" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M22 35v7" stroke="var(--map-halo)" stroke-width="5" stroke-linecap="round"/>
  <path d="M22 35v7" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>
</g>
<circle cx="22" cy="22" r="12" fill="var(--surface)" stroke="${col}" stroke-width="3"/>
<text x="22" y="26" text-anchor="middle" font-family="var(--font)" font-size="11.5" font-weight="750" fill="var(--text)">${label}</text>
</svg>`;
}

/** Wellen: Doppel-Chevron in Laufrichtung (Open-Meteo liefert „woher“ → +180°). */
export function waveChevron(dirFrom: number, h: number): string {
  const col = waveColor(h);
  const rot = (dirFrom + 180) % 360;
  const d = 'M9 14 15 8l6 6M9 21l6-6 6 6';
  return `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" style="transform:rotate(${rot}deg)">
<path d="${d}" fill="none" stroke="var(--map-halo)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

/** Start-Pin (Flagge) bzw. Ziel-Pin (Anker) in der Identitätsfarbe des Tracks. */
export function endpointPin(kind: 'start' | 'end', colorToken: string): string {
  const glyph =
    kind === 'start'
      ? '<path d="M10 7.5v10M10 8h6.5l-1.5 2.25 1.5 2.25H10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="8.3" r="1.3"/><path d="M14 9.6v8.4M11.3 11.5h5.4M9.2 14.2c0 2.6 2.1 4 4.8 4s4.8-1.4 4.8-4"/></g>';
  return `<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true">
<path d="M14 34s-11-9.3-11-19a11 11 0 0 1 22 0c0 9.7-11 19-11 19z" fill="var(${colorToken})" stroke="var(--map-halo)" stroke-width="2"/>
${glyph}
</svg>`;
}
