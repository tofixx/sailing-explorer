import { svg, type SVGTemplateResult } from 'lit';

// Eigenes, nautisches Icon-Set: 24er-Raster, 1,75er Strich, runde Enden.
// Flächen mit class="f" werden dezent getönt (Duoton) – passend zu den
// getönten Flächen der Oberfläche.
const paths = {
  // Marke: Großsegel + Fock über Rumpf
  sail: svg`<path class="f" d="M11.5 3.5 5 16h6.5z"/><path d="M11.5 3.5 5 16h6.5zM13.5 6.5c3 2.5 4.6 5.7 4.8 9.5h-4.8z"/><path d="M3.5 18.5h17l-2 2.5h-13z"/>`,
  // GPX laden: Seekarte mit Kurslinie + Pfeil
  upload: svg`<path class="f" d="M5 4h9l5 5v11H5z"/><path d="M14 4H5v16h14V9zM14 4v5h5"/><path d="M8.5 16.5 11 13l2 2 2.5-3.5"/><path d="M12 2v0"/>`,
  // Teilen: das bekannte Symbol – drei verbundene Punkte
  share: svg`<circle class="f" cx="18" cy="5.5" r="2.75"/><circle class="f" cx="6" cy="12" r="2.75"/><circle class="f" cx="18" cy="18.5" r="2.75"/><circle cx="18" cy="5.5" r="2.75"/><circle cx="6" cy="12" r="2.75"/><circle cx="18" cy="18.5" r="2.75"/><path d="m8.4 10.7 7.2-3.9M8.4 13.3l7.2 3.9"/>`,
  // Teilen auf iPhone/iPad: Quadrat mit Pfeil nach oben (für die Anleitung „Zum Home-Bildschirm“)
  iosShare: svg`<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5H6v10h12v-10h-2.5"/>`,
  link: svg`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
  copy: svg`<rect class="f" x="9" y="9" width="11" height="11" rx="2.5"/><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>`,
  // Konto: Kapitänsmütze-Silhouette
  user: svg`<circle class="f" cx="12" cy="9" r="4"/><circle cx="12" cy="9" r="4"/><path d="M8 7.2c2.5-1.2 5.5-1.2 8 0M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/>`,
  // Wind: Windsack
  wind: svg`<path class="f" d="M7 6.5 20 8.5v5L7 15.5z"/><path d="M4 21V4M4 6.5h3l13 2v5l-13 2H4"/><path d="M11 7.2v8.6M15.5 7.9v7.2"/>`,
  // Wellen: zwei brechende Kämme
  waves: svg`<path class="f" d="M2 13c2.5 0 3.5-4 6.5-4 2.2 0 3 2 1.8 3.2C12 13.5 14 13 15 12c1.5-1.5 4-1.7 7 1v6H2z"/><path d="M2 13c2.5 0 3.5-4 6.5-4 2.2 0 3 2 1.8 3.2C12 13.5 14 13 15 12c1.5-1.5 4-1.7 7 1M2 18c2 0 3-1.5 5-1.5s3 1.5 5 1.5 3-1.5 5-1.5 3 1.5 5 1.5"/>`,
  // Speed: Logge (Rundinstrument mit Nadel)
  gauge: svg`<path class="f" d="M3.5 17a8.5 8.5 0 1 1 17 0z"/><path d="M3.5 17a8.5 8.5 0 1 1 17 0zM12 17l4-5.5"/><path d="M7 12.5l1 .7M12 9v1.2M17 12.5l-1 .7"/>`,
  // Böen: Windsack mit Blitz
  gust: svg`<path class="f" d="M7 6.5 15 7.8v6.4l-8 1.3z"/><path d="M4 21V4M4 6.5h3l8 1.3v6.4l-8 1.3H4"/><path d="m20 5-2.5 4.5h3L18 14"/>`,
  eye: svg`<path class="f" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>`,
  eyeOff: svg`<path d="M3 3l18 18M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.7M6.6 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 5-1.5"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2"/>`,
  x: svg`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  trash: svg`<path class="f" d="M6 7.5h12l-1 11.5a2 2 0 0 1-2 1.8H9a2 2 0 0 1-2-1.8z"/><path d="M4 7.5h16M6 7.5l1 11.5a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-11.5M9.5 7.5V4.5h5v3M10 11v6M14 11v6"/>`,
  pencil: svg`<path class="f" d="M4 20v-3.5L15.5 5a2.5 2.5 0 0 1 3.5 3.5L7.5 20z"/><path d="M4 20v-3.5L15.5 5a2.5 2.5 0 0 1 3.5 3.5L7.5 20zM13.5 7l3.5 3.5"/>`,
  lock: svg`<rect class="f" x="5" y="10.5" width="14" height="10" rx="2.5"/><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2"/>`,
  // Öffentlich per Link: Kompassrose
  globe: svg`<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="m12 5 1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z"/>`,
  mail: svg`<rect class="f" x="3" y="5.5" width="18" height="13" rx="2.5"/><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7.5 8 5.5 8-5.5"/>`,
  logout: svg`<path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 16.5 14.5 12 10 7.5M14.5 12H4"/>`,
  // Seekarte mit Kompassrose
  map: svg`<path class="f" d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20"/>`,
  // Einstellungen: Zahnrad
  gear: svg`<circle class="f" cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/><circle cx="12" cy="12" r="6.3"/>`,
  info: svg`<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>`,
  check: svg`<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  open: svg`<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>`,
  // Meine Tracks: Logbuch
  folder: svg`<path class="f" d="M5 4.5h12a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M5 17.5v-11a2 2 0 0 1 2-2h12v15H7a2 2 0 0 1-2-2 2 2 0 0 1 2-2h12M9 8.5h6M9 11.5h4"/>`,
  // Bild: Rahmen mit Kurslinie und Sonne
  image: svg`<rect class="f" x="3" y="4.5" width="18" height="15" rx="2.5"/><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="16.5" cy="9" r="1.6"/><path d="m3.5 17 5-5 3.5 3.5 2.5-2.5 6 5"/>`,
  download: svg`<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>`,
  anchor: svg`<circle cx="12" cy="5" r="2"/><path d="M12 7v13M8 10.5h8M4.5 13.5c0 4 3.4 6.5 7.5 6.5s7.5-2.5 7.5-6.5"/><path d="m3 15 1.5-1.5L6 15M18 15l1.5-1.5L21 15"/>`,
  // Unterstützen: Kaffeebecher mit Dampf
  coffee: svg`<path class="f" d="M4.5 10h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M4.5 10h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM15.5 11.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M3.5 21.5h13"/><path d="M8 3.5c-.8 1 .8 2 0 3.5M11.5 3.5c-.8 1 .8 2 0 3.5"/>`,
  // Unterstützen: Bierkrug mit Schaumkrone
  beer: svg`<path class="f" d="M5.5 9h10v10a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2z"/><path d="M5.5 9h10v10a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2zM15.5 11h1.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-1.5M9 12.5v5M12 12.5v5"/><path d="M5.5 9a2.3 2.3 0 0 1 .6-4.3 3 3 0 0 1 4.9-1.2 2.7 2.7 0 0 1 4.3 1.8A1.9 1.9 0 0 1 15.5 9"/>`,
  // Unterstützen: eine Runde – drei Gläser mit Schaum
  round: svg`<path class="f" d="M3 9.5h5l-.6 9.6a1 1 0 0 1-1 .9H4.6a1 1 0 0 1-1-.9zM9.5 9.5h5l-.6 9.6a1 1 0 0 1-1 .9h-1.8a1 1 0 0 1-1-.9zM16 9.5h5l-.6 9.6a1 1 0 0 1-1 .9h-1.8a1 1 0 0 1-1-.9z"/><path d="M3 9.5h5l-.6 9.6a1 1 0 0 1-1 .9H4.6a1 1 0 0 1-1-.9zM9.5 9.5h5l-.6 9.6a1 1 0 0 1-1 .9h-1.8a1 1 0 0 1-1-.9zM16 9.5h5l-.6 9.6a1 1 0 0 1-1 .9h-1.8a1 1 0 0 1-1-.9zM3.3 12.5h4.4M9.8 12.5h4.4M16.3 12.5h4.4"/><path d="M5.5 4.5v2M12 3.5v2.5M18.5 4.5v2"/>`,
  // Unterstützen: Kiste mit Flaschenhälsen
  crate: svg`<rect class="f" x="3" y="11" width="18" height="9.5" rx="1.5"/><rect x="3" y="11" width="18" height="9.5" rx="1.5"/><path d="M6.5 11V8.3c0-.8.7-1.3.7-2.1V3.5h1.6v2.7c0 .8.7 1.3.7 2.1V11M11 11V8.3c0-.8.7-1.3.7-2.1V3.5h1.6v2.7c0 .8.7 1.3.7 2.1V11M15.5 11V8.3c0-.8.7-1.3.7-2.1V3.5h1.6v2.7c0 .8.7 1.3.7 2.1V11"/><path d="M10 15.5h4"/>`,
  // Unterstützer-Abzeichen: Wimpel am Mast
  pennant: svg`<path class="f" d="M6 4.5 19.5 9 6 13.5z"/><path d="M6 21V3M6 4.5 19.5 9 6 13.5"/>`,
  // Kommentare: Sprechblase
  comment: svg`<path class="f" d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z"/><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5zM7 10h10M7 13.5h6"/>`,
  // Fotos: Kamera
  camera: svg`<path class="f" d="M3.5 8h4l1.8-2.5h5.4L16.5 8h4v11h-17z"/><path d="M3.5 8h4l1.8-2.5h5.4L16.5 8h4v11h-17z"/><circle cx="12" cy="13.2" r="3.3"/>`,
  // Pfeile für Galerie und Lightbox
  left: svg`<path d="M14.5 5.5 8 12l6.5 6.5"/>`,
  right: svg`<path d="M9.5 5.5 16 12l-6.5 6.5"/>`,
  // Melden: Signalflagge
  flag: svg`<path class="f" d="M5.5 4.5h12l-2.5 4 2.5 4h-12z"/><path d="M5.5 21V3.5M5.5 4.5h12l-2.5 4 2.5 4h-12"/>`,
  // Reaktionen (Konzept 12.5): „Gefällt mir“ als Herz aus Tauwerk-Linie
  heart: svg`<path class="f" d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>`,
  // „Mast- und Schotbruch“: Mast mit Saling und lose auswehender Schot
  mast: svg`<path class="f" d="M12 3.5v13.5l6.5-2.5c-1.6-3.8-3.8-7.5-6.5-11z"/><path d="M12 3.5V21M8.5 8h7M12 17l6.5-2.5c-1.6-3.8-3.8-7.5-6.5-11"/><path d="M18.5 14.5c1 1.4 1.4 2.8.8 4.2M6 21h12"/>`,
  // „Starker Schlag“: Kreuzkurs im Zickzack mit Pfeil
  tack: svg`<circle class="f" cx="4.5" cy="19" r="2"/><path d="M4 19.5 9 13l3.5 3.5L19.5 7M15 6.5h4.5V11"/>`,
  // Plus (FAB „Track anlegen“)
  plus: svg`<path d="M12 5v14M5 12h14"/>`,
  // Waage/Paragraf für Rechtliches
  scale: svg`<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>`,
};

export type IconName = keyof typeof paths;

/**
 * Logo „Segel im Kompass“ (32er-Raster, gefüllt). Kachel in --accent, Zeichen in --on-accent;
 * dieselbe Form steht in public/favicon.svg und wird in services/share-image.ts gezeichnet.
 */
export function logo(size = 32): SVGTemplateResult {
  return svg`<svg width=${size} height=${size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="var(--accent)"/>
    <g fill="var(--on-accent)" stroke="var(--on-accent)">
      <circle cx="16" cy="16" r="10.5" fill="none" stroke-width="1.6" opacity=".55"/>
      <path d="M16 3.5v3" stroke-width="2" stroke-linecap="round"/>
      <path d="M16 9 22 21H16z" stroke="none"/>
      <path d="M14.5 11.5 10 21h4.5z" stroke="none" opacity=".75"/>
    </g>
  </svg>`;
}

export function icon(name: IconName, cls = 'i'): SVGTemplateResult {
  return svg`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><style>.f{fill:currentColor;fill-opacity:.16;stroke:none}</style>${paths[name]}</svg>`;
}
