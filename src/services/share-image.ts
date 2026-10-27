// Übersichtsbild eines Törns – im Browser gezeichnet, der Worker speichert es nur.
// Die Infos stehen in einem eigenen Randbereich; der Track wird nur in den freien
// Kartenbereich eingepasst und dadurch nie verdeckt.
import { compassName } from '../domain/geo';
import { fmtDate, fmtDuration, fmtNum, fmtShort } from '../domain/format';
import { METRICS, rampColor, smoothedMetric, type Range } from '../domain/metrics';
import { fitBounds, project, tilesFor, TILE_SIZE } from '../domain/projection';
import { averageConditions, kpis } from '../domain/summary';
import { bounds } from '../domain/weather';
import type { MetricKey, Track } from '../domain/types';

export type ImageFormat = 'landscape' | 'square';

export const FORMATS: Record<ImageFormat, { width: number; height: number; label: string }> = {
  landscape: { width: 1200, height: 630, label: 'Querformat (Link-Vorschau)' },
  square: { width: 1080, height: 1080, label: 'Quadrat (Social Media)' },
};

/** Was im Bild erscheinen soll. */
export interface ImageContent {
  title: boolean;
  date: boolean;
  startEnd: boolean;
  distance: boolean;
  duration: boolean;
  speed: boolean;
  wind: boolean;
  waves: boolean;
  legend: boolean;
  map: boolean;
}

export const CONTENT_LABELS: Array<[keyof ImageContent, string]> = [
  ['title', 'Titel'],
  ['date', 'Datum'],
  ['startEnd', 'Start & Ziel'],
  ['distance', 'Distanz'],
  ['duration', 'Dauer'],
  ['speed', 'Fahrt'],
  ['wind', 'Wind'],
  ['waves', 'Wellen'],
  ['legend', 'Farblegende'],
  ['map', 'Seekarte'],
];

export const DEFAULT_CONTENT: ImageContent = {
  title: true, date: true, startEnd: true, distance: true, duration: true,
  speed: true, wind: true, waves: true, legend: true, map: true,
};

export interface ShareImageOptions {
  title: string;
  metric: MetricKey;
  range: Range | null;
  format?: ImageFormat;
  content?: Partial<ImageContent>;
}

/** Feste Farben: Das Bild sieht in jedem Messenger gleich aus, unabhängig vom Farbschema. */
const C = {
  water: '#b9d3e6',
  ink: '#0f1d2b',
  muted: '#5b6b7b',
  faint: '#8a98a6',
  panel: '#ffffff',
  line: '#e3e9ef',
  accent: '#0e6bd8',
  halo: '#ffffff',
  start: '#1f8a4c',
  end: '#c2372b',
  speed: '#7a55c7',
  wind: '#1f78d1',
  gust: '#db4b3f',
  wave: '#0f9a84',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/${z}/${y}/${x}`;

interface InfoRow {
  label: string;
  value: string;
  detail?: string;
  color: string;
}

/** Die Inhalte als Zeilen – reine Daten, damit Layout und Inhalt getrennt bleiben. */
export function infoRows(tracks: Track[], content: ImageContent): InfoRow[] {
  const k = Object.fromEntries(kpis(tracks).map((x) => [x.key, x]));
  const starts = tracks.map((t) => t.stats.start).filter((x): x is number => x != null);
  const ends = tracks.map((t) => t.stats.end).filter((x): x is number => x != null);
  const rows: InfoRow[] = [];
  if (content.startEnd && starts.length && ends.length) {
    rows.push({ label: 'Start', value: fmtShort(Math.min(...starts)), color: C.start });
    rows.push({ label: 'Ziel', value: fmtShort(Math.max(...ends)), color: C.end });
  }
  if (content.distance) rows.push({ label: 'Distanz', value: `${k.dist.value} sm`, color: C.ink });
  if (content.duration) {
    // Gesamtdauer nur nennen, wenn sie spürbar von der Fahrzeit abweicht (Pausen, mehrere Etappen).
    const spanH = starts.length && ends.length ? (Math.max(...ends) - Math.min(...starts)) / 3_600_000 : 0;
    const movingH = tracks.reduce((s, t) => s + t.stats.movingH, 0);
    const detail = spanH - movingH > 0.25 ? `gesamt ${fmtDuration(spanH)} h` : undefined;
    rows.push({ label: 'Fahrzeit', value: `${k.time.value} h`, detail, color: C.ink });
  }
  if (content.speed) rows.push({ label: 'Fahrt', value: `Ø ${k.avgSpeed.value} kn`, detail: `max. ${k.maxSpeed.value} kn`, color: C.speed });
  const avg = averageConditions(tracks);
  if (content.wind && k.avgWind) {
    const dir = avg?.dir != null ? ` aus ${compassName(avg.dir)}` : '';
    rows.push({ label: 'Wind', value: `Ø ${k.avgWind.value} kn${dir}`, detail: k.maxGust ? `Böen bis ${k.maxGust.value} kn` : undefined, color: C.wind });
  }
  if (content.waves && k.avgWave) {
    const per = avg?.wper != null ? ` · ${fmtNum(avg.wper, 0)} s` : '';
    rows.push({ label: 'Wellen', value: `Ø ${k.avgWave.value} m`, detail: `max. ${k.maxWave.value} m${per}`, color: C.wave });
  }
  return rows;
}

function loadTile(url: string, timeoutMs = 6000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => (clearTimeout(t), resolve(img));
    img.onerror = () => (clearTimeout(t), resolve(null));
    img.src = url;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Bricht Text in höchstens maxLines Zeilen um (letzte Zeile mit …). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
  out[maxLines - 1] = `${last}…`;
  return out;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Aufteilung: Querformat → Infospalte rechts, Quadrat → Infoband unten. */
export function layout(format: ImageFormat): { map: Box; info: Box } {
  const { width, height } = FORMATS[format];
  if (format === 'square') {
    const infoH = 380;
    return { map: { x: 0, y: 0, w: width, h: height - infoH }, info: { x: 0, y: height - infoH, w: width, h: infoH } };
  }
  const infoW = 380;
  return { map: { x: 0, y: 0, w: width - infoW, h: height }, info: { x: width - infoW, y: 0, w: infoW, h: height } };
}

async function drawMap(ctx: CanvasRenderingContext2D, tracks: Track[], box: Box, opts: ShareImageOptions, content: ImageContent) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.fillStyle = C.water;
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const b = bounds(tracks);
  if (!b) return ctx.restore();
  const view = fitBounds(b, { width: box.w, height: box.h, padding: 48 }, 13);

  if (content.map) {
    const tiles = tilesFor(view, box.w, box.h);
    const imgs = await Promise.all(tiles.map((t) => loadTile(TILE_URL(t.z, t.x, t.y))));
    tiles.forEach((t, i) => {
      const img = imgs[i];
      if (img) ctx.drawImage(img, box.x + Math.round(t.dx), box.y + Math.round(t.dy), TILE_SIZE, TILE_SIZE);
    });
  }

  const px = (lat: number, lon: number) => {
    const p = project(lat, lon, view.zoom);
    return { x: box.x + p.x - view.originX, y: box.y + p.y - view.originY };
  };

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of tracks) {
    ctx.beginPath();
    t.points.forEach((p, i) => {
      const q = px(p.lat, p.lon);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.strokeStyle = C.halo;
    ctx.lineWidth = 10;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Gleichfarbige Abschnitte zusammenfassen (wie auf der Karte) – sonst wirkt die Linie perlig.
    const values = opts.range ? smoothedMetric(t.points, opts.metric) : null;
    const STEPS = 20;
    const colorAt = (i: number) => {
      const v = values?.[i];
      if (v == null || !opts.range) return C.accent;
      const step = Math.round(((v - opts.range.lo) / (opts.range.hi - opts.range.lo)) * (STEPS - 1));
      return rampColor(Math.max(0, Math.min(STEPS - 1, step)) / (STEPS - 1));
    };
    ctx.lineWidth = 5;
    ctx.lineCap = 'butt';
    let start = px(t.points[0].lat, t.points[0].lon);
    let color = colorAt(1);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < t.points.length; i++) {
      const q = px(t.points[i].lat, t.points[i].lon);
      const c = colorAt(i);
      if (c !== color) {
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        color = c;
      }
      ctx.lineTo(q.x, q.y);
      start = q;
    }
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.lineCap = 'round';
  }

  if (content.startEnd) {
    for (const t of tracks) {
      for (const [p, color] of [
        [t.points[0], C.start],
        [t.points[t.points.length - 1], C.end],
      ] as const) {
        const q = px(p.lat, p.lon);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = C.halo;
        ctx.stroke();
      }
    }
  }

  // Quellenangabe der Kacheln (Pflicht) – in der Ecke, die vom Infobereich wegzeigt
  if (content.map) {
    ctx.font = `500 11px ${FONT}`;
    const attr = 'Kacheln © Esri, GEBCO, NOAA';
    const aw = ctx.measureText(attr).width + 12;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(box.x, box.y + box.h - 18, aw, 18);
    ctx.fillStyle = C.muted;
    ctx.fillText(attr, box.x + 6, box.y + box.h - 5);
  }
  ctx.restore();
}

function drawInfo(ctx: CanvasRenderingContext2D, tracks: Track[], box: Box, opts: ShareImageOptions, content: ImageContent, format: ImageFormat) {
  ctx.fillStyle = C.panel;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = C.line;
  if (format === 'square') ctx.fillRect(box.x, box.y, box.w, 1);
  else ctx.fillRect(box.x, box.y, 1, box.h);

  const pad = 36;
  const x = box.x + pad;
  let y = box.y + pad;
  const innerW = box.w - 2 * pad;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Kopf: Titel und Datum
  if (content.title) {
    ctx.fillStyle = C.ink;
    ctx.font = `750 32px ${FONT}`;
    for (const line of wrap(ctx, opts.title, format === 'square' ? innerW * 0.6 : innerW, 2)) {
      y += 36;
      ctx.fillText(line, x, y);
    }
  }
  if (content.date) {
    const starts = tracks.map((t) => t.stats.start).filter((v): v is number => v != null);
    const ends = tracks.map((t) => t.stats.end).filter((v): v is number => v != null);
    if (starts.length) {
      const a = fmtDate(Math.min(...starts));
      const b = fmtDate(Math.max(...ends));
      ctx.fillStyle = C.muted;
      ctx.font = `500 19px ${FONT}`;
      y += 30;
      ctx.fillText(a === b ? a : `${a} – ${b}`, x, y);
    }
  }

  // Kennzahlen: Querformat untereinander, Quadrat in drei Spalten
  const rows = infoRows(tracks, content);
  const cols = format === 'square' ? 3 : 1;
  const colW = innerW / cols;
  const rowH = 54;
  const gridTop = y + (content.title || content.date ? 26 : 0);
  // unten Platz für Legende und Marke lassen
  const footer = content.legend && opts.range ? 80 : 50;
  const maxRows = Math.max(0, Math.floor((box.y + box.h - footer - gridTop) / rowH));
  rows.slice(0, maxRows * cols).forEach((r, i) => {
    const cx = x + (i % cols) * colW;
    const cy = gridTop + Math.floor(i / cols) * rowH;
    ctx.fillStyle = r.color;
    roundRect(ctx, cx, cy + 4, 4, rowH - 14, 2);
    ctx.fill();
    ctx.fillStyle = C.faint;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(r.label.toUpperCase(), cx + 14, cy + 16);
    ctx.fillStyle = C.ink;
    ctx.font = `750 21px ${FONT}`;
    const value = r.value;
    ctx.fillText(value, cx + 14, cy + 40);
    if (r.detail) {
      const vw = ctx.measureText(value).width;
      ctx.fillStyle = C.muted;
      ctx.font = `500 15px ${FONT}`;
      if (cx + 14 + vw + 10 + ctx.measureText(r.detail).width <= cx + colW - 8) ctx.fillText(r.detail, cx + 14 + vw + 10, cy + 40);
    }
  });

  // Fuß: Legende und Marke
  const footY = box.y + box.h - pad;
  if (content.legend && opts.range) {
    const m = METRICS[opts.metric];
    const lw = format === 'square' ? 260 : innerW;
    const grad = ctx.createLinearGradient(x, 0, x + lw, 0);
    for (let i = 0; i <= 10; i++) grad.addColorStop(i / 10, rampColor(i / 10));
    roundRect(ctx, x, footY - 46, lw, 10, 5);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(`Farbe: ${m.label} ${fmtNum(opts.range.lo, m.decimals)}–${fmtNum(opts.range.hi, m.decimals)} ${m.unit}`, x, footY - 20);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = C.accent;
  ctx.font = `750 18px ${FONT}`;
  ctx.fillText('Sail Explorer', box.x + box.w - pad, footY);
  drawLogo(ctx, box.x + box.w - pad - ctx.measureText('Sail Explorer').width - 30, footY - 17, 22);
  if (!(content.legend && opts.range) || format === 'square') {
    ctx.fillStyle = C.faint;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText('segeln-potsdam.de', box.x + box.w - pad, footY - 22);
  }
  ctx.textAlign = 'left';
}

/** Logo „Segel im Kompass“ (wie logo() in components/icons.ts) – ohne Path2D, damit es überall zeichnet. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const k = size / 32;
  const p = (px: number, py: number): [number, number] => [x + px * k, y + py * k];
  const poly = (pts: Array<[number, number]>) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(...p(px, py)) : ctx.moveTo(...p(px, py))));
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  roundRect(ctx, x, y, size, size, 8 * k);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.6 * k;
  ctx.beginPath();
  ctx.arc(...p(16, 16), 10.5 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.moveTo(...p(16, 3.5));
  ctx.lineTo(...p(16, 6.5));
  ctx.stroke();
  poly([[16, 9], [22, 21], [16, 21]]);
  ctx.globalAlpha = 0.75;
  poly([[14.5, 11.5], [10, 21], [14.5, 21]]);
  ctx.restore();
}

/** Zeichnet das Übersichtsbild in ein Canvas. */
export async function drawShareImage(canvas: HTMLCanvasElement, tracks: Track[], opts: ShareImageOptions): Promise<void> {
  const format = opts.format ?? 'landscape';
  const content = { ...DEFAULT_CONTENT, ...opts.content };
  const { width, height } = FORMATS[format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const { map, info } = layout(format);
  await drawMap(ctx, tracks, map, opts, content);
  drawInfo(ctx, tracks, info, opts, content, format);
}

/** Rendert das Bild als JPEG (klein genug für Messenger und den Upload). */
export async function renderShareImage(tracks: Track[], opts: ShareImageOptions): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await drawShareImage(canvas, tracks, opts);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', 0.88),
  );
}

/** Dateiname aus dem Titel. */
export function imageFileName(title: string): string {
  // Buchstaben ohne Zerlegung in Grundbuchstabe + Akzent (ø, æ, ß …) vorab ersetzen
  const special: Record<string, string> = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'Ae', ß: 'ss', ł: 'l', Ł: 'L', đ: 'd' };
  const base = title
    .replace(/[øØæÆßłŁđ]/g, (c) => special[c])
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'toern'}.jpg`;
}
