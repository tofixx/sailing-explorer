import { isMetricKey } from '../domain/metrics';
import type { MetricKey } from '../domain/types';
import { sharePath } from '../domain/visibility';
import type { Linkable } from './api';
import type { Layers } from './store';

/** key: Schlüssel aus dem Pfad („Nur mit Link“), wird bei API-Lesezugriffen als X-Share-Key mitgesendet. */
export type Route =
  | { kind: 'home' }
  | { kind: 'share'; id: string; key?: string }
  | { kind: 'profile'; handle: string; key?: string }
  | { kind: 'boat'; id: string; key?: string }
  | { kind: 'discover' }
  | { kind: 'login'; token: string | null }
  | { kind: 'invite'; token: string | null }
  | { kind: 'files'; names: string[] }
  | { kind: 'inline'; data: string };

/** Optionales Schlüssel-Segment („Nur mit Link“): /s/<id>/<key>, /b/<id>/<key>, /u/<handle>/<key>. */
const KEY = '(?:/([A-Za-z0-9]{16,64}))?';

/** Schlüssel nur setzen, wenn vorhanden – ohne Schlüssel bleibt die Route wie bisher. */
function withKey<T extends object>(route: T, key: string | undefined): T & { key?: string } {
  return key ? { ...route, key } : route;
}

/** Pfad einer Seite mit optionalem Schlüssel – z. B. zum Nachführen der Adresse bei Ansichtswechseln. */
export function routePath(kind: 's' | 'b' | 'u', idOrHandle: string, key?: string | null): string {
  return `/${kind}/${idOrHandle}${key ? `/${key}` : ''}`;
}

/** Absoluter Teilen-Link eines eigenen Objekts: `link` vom Server, sonst aus Stufe und Schlüssel abgeleitet. */
export function absoluteLink(kind: 's' | 'b' | 'u', idOrHandle: string, obj: Linkable, origin = location.origin): string {
  return origin + (obj.link || sharePath(kind, idOrHandle, obj.visibility, obj.shareKey ?? null));
}

export function parseRoute(loc: Pick<Location, 'pathname' | 'search' | 'hash'>): Route {
  const share = new RegExp(`^/s/([A-Za-z0-9]{12,32})${KEY}/?$`).exec(loc.pathname);
  if (share) return withKey({ kind: 'share', id: share[1] }, share[2]);
  const profile = new RegExp(`^/u/([a-z0-9-]{3,30})${KEY}/?$`, 'i').exec(loc.pathname);
  if (profile) return withKey({ kind: 'profile', handle: profile[1].toLowerCase() }, profile[2]);
  const boat = new RegExp(`^/b/([A-Za-z0-9]{12,32})${KEY}/?$`).exec(loc.pathname);
  if (boat) return withKey({ kind: 'boat', id: boat[1] }, boat[2]);
  if (/^\/entdecken\/?$/.test(loc.pathname)) return { kind: 'discover' };
  if (loc.pathname === '/login') {
    const token = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(loc.hash)?.[1] ?? null;
    return { kind: 'login', token };
  }
  // Einladung (Konzept 10.2): Token im Fragment, eingelöst wird erst nach ausdrücklicher Bestätigung.
  if (/^\/einladung\/?$/.test(loc.pathname)) {
    const token = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(loc.hash)?.[1] ?? null;
    return { kind: 'invite', token };
  }
  // ?track=Datei.gpx (mehrfach oder kommagetrennt) – Beispiel-Tracks aus /tracks/
  const params = new URLSearchParams(loc.search);
  const names = ['track', 'tracks', 't']
    .flatMap((k) => params.getAll(k))
    .flatMap((v) => v.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length) return { kind: 'files', names };
  const inline = /[#&]g=([A-Za-z0-9_-]+)/.exec(loc.hash)?.[1];
  if (inline) return { kind: 'inline', data: inline };
  return { kind: 'home' };
}

/** Nur Dateinamen aus /tracks/ – keine Pfade, keine fremden Hosts. */
export function sampleTrackUrl(name: string): string | null {
  const base = name.replace(/\.gpx$/i, '');
  if (!/^[\w.-]{1,100}$/.test(base) || base.includes('..')) return null;
  return `/tracks/${base}.gpx`;
}

// --- Ansichtszustand im Link: ?m=wind&l=s,d,w,v ---

const LAYER_CODES: Record<keyof Layers, string> = { seamarks: 's', depth: 'd', windArrows: 'w', waveArrows: 'v' };

export interface ViewState {
  metric?: MetricKey;
  layers?: Layers;
}

export function serializeView(metric: MetricKey, layers: Layers): string {
  const l = (Object.keys(LAYER_CODES) as Array<keyof Layers>).filter((k) => layers[k]).map((k) => LAYER_CODES[k]);
  return `m=${metric}&l=${l.join(',')}`;
}

export function parseView(query: string): ViewState {
  const p = new URLSearchParams(query);
  const out: ViewState = {};
  const m = p.get('m');
  if (isMetricKey(m)) out.metric = m;
  const l = p.get('l');
  if (l != null) {
    const codes = new Set(l.split(','));
    out.layers = {
      seamarks: codes.has('s'),
      depth: codes.has('d'),
      windArrows: codes.has('w'),
      waveArrows: codes.has('v'),
    };
  }
  return out;
}
