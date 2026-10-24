import { isMetricKey } from '../domain/metrics';
import type { MetricKey } from '../domain/types';
import type { Layers } from './store';

export type Route =
  | { kind: 'home' }
  | { kind: 'share'; id: string }
  | { kind: 'profile'; handle: string }
  | { kind: 'boat'; id: string }
  | { kind: 'discover' }
  | { kind: 'login'; token: string | null }
  | { kind: 'files'; names: string[] }
  | { kind: 'inline'; data: string };

export function parseRoute(loc: Pick<Location, 'pathname' | 'search' | 'hash'>): Route {
  const share = /^\/s\/([A-Za-z0-9]{12,32})\/?$/.exec(loc.pathname);
  if (share) return { kind: 'share', id: share[1] };
  const profile = /^\/u\/([a-z0-9-]{3,30})\/?$/i.exec(loc.pathname);
  if (profile) return { kind: 'profile', handle: profile[1].toLowerCase() };
  const boat = /^\/b\/([A-Za-z0-9]{12,32})\/?$/.exec(loc.pathname);
  if (boat) return { kind: 'boat', id: boat[1] };
  if (/^\/entdecken\/?$/.test(loc.pathname)) return { kind: 'discover' };
  if (loc.pathname === '/login') {
    const token = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(loc.hash)?.[1] ?? null;
    return { kind: 'login', token };
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
