import type { TrackPoint } from './types';

export class GpxError extends Error {}

export interface ParsedGpx {
  name: string;
  points: TrackPoint[];
}

/** Obergrenze gegen versehentlich riesige Dateien (≈ 60 MB GPX). */
export const MAX_GPX_CHARS = 60_000_000;

/**
 * Parst GPX (Track-, Routen- oder Wegpunkte). GPX ist untrusted:
 * DOCTYPE/ENTITY wird abgelehnt, der Name wird nur als Text weiterverwendet.
 */
export function parseGpx(text: string, fallbackName: string, parser: DOMParser = new DOMParser()): ParsedGpx {
  if (text.length > MAX_GPX_CHARS) throw new GpxError('Datei ist zu groß');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new GpxError('GPX mit DOCTYPE wird nicht unterstützt');
  const xml = parser.parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new GpxError('Ungültige GPX/XML-Datei');
  if (xml.documentElement.localName !== 'gpx') throw new GpxError('Keine GPX-Datei');

  const nameEl = firstChildNamed(xml, ['trk', 'metadata', 'rte'], 'name');
  const name = (nameEl?.textContent || fallbackName || 'Track').trim().slice(0, 120);

  let nodes = xml.getElementsByTagName('trkpt');
  if (!nodes.length) nodes = xml.getElementsByTagName('rtept');
  if (!nodes.length) nodes = xml.getElementsByTagName('wpt');

  const points: TrackPoint[] = [];
  for (const n of Array.from(nodes)) {
    const lat = parseFloat(n.getAttribute('lat') ?? '');
    const lon = parseFloat(n.getAttribute('lon') ?? '');
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const t = childText(n, 'time');
    const e = childText(n, 'ele');
    const time = t ? Date.parse(t) : NaN;
    const ele = e ? parseFloat(e) : NaN;
    points.push({
      lat,
      lon,
      time: isFinite(time) ? time : null,
      ele: isFinite(ele) ? ele : null,
      speed: null,
      speedSmooth: null,
      glitch: false,
      wx: null,
    });
  }
  if (points.length < 2) throw new GpxError('Zu wenige Trackpunkte');
  return { name, points };
}

function childText(el: Element, local: string): string | null {
  for (const c of Array.from(el.children)) if (c.localName === local) return c.textContent;
  return null;
}

function firstChildNamed(doc: Document, parents: string[], local: string): Element | null {
  for (const p of parents) {
    const parent = doc.getElementsByTagName(p)[0];
    if (!parent) continue;
    for (const c of Array.from(parent.children)) if (c.localName === local && c.textContent?.trim()) return c;
  }
  return null;
}
