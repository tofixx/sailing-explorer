// Sicherheits-Header für HTML-Seiten. Dieselben Werte stehen in public/_headers
// (für statische Assets); ein Test stellt sicher, dass beide übereinstimmen.

const TILE_HOSTS = [
  'https://tile.openstreetmap.org',
  'https://tile.openstreetmap.de',
  'https://server.arcgisonline.com',
  'https://tiles.openseamap.org',
  'https://ows.emodnet-bathymetry.eu',
];
const API_HOSTS = ['https://api.open-meteo.com', 'https://archive-api.open-meteo.com', 'https://marine-api.open-meteo.com'];
const TURNSTILE = 'https://challenges.cloudflare.com';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE}`,
  // Leaflet und Lit setzen Inline-Styles; Skripte bleiben streng.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${TILE_HOSTS.join(' ')}`,
  `connect-src 'self' ${API_HOSTS.join(' ')}`,
  `frame-src ${TURNSTILE}`,
  "frame-ancestors 'self' https://*.notion.so https://*.notion.site",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function withPageHeaders(res: Response): Response {
  for (const [k, v] of Object.entries(PAGE_HEADERS)) res.headers.set(k, v);
  return res;
}
