// „Meine Saison“-Bild (Konzept 33, F-523) – im Browser gezeichnet, nichts geht an den Server. Format, Farben, Schrift,
// Markenzeile und JPEG-Ausgabe kommen aus dem Törn-Bild (`share-image.ts`); hier steht nur die Aufteilung der Saison.
import { badgeCaption, reviewFigures, reviewHeadline, type ReviewFigure, type SeasonBadge, type SeasonReview } from '../domain/season-review';
import { fmtNum } from '../domain/format';
import { FORMATS, SHARE_COLORS as C, SHARE_FONT as FONT, canvasToJpeg, drawBrand, roundRect, type ImageFormat } from './share-image';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Aufteilung je Format: Quadrat untereinander, Querformat zweispaltig (Kopf und Abzeichen links, Kacheln rechts). */
export function seasonLayout(format: ImageFormat): { pad: number; head: Box; tiles: Box; cols: number; badges: Box; footY: number } {
  const { width, height } = FORMATS[format];
  if (format === 'square') {
    const pad = 64;
    const w = width - 2 * pad;
    return {
      pad,
      head: { x: pad, y: pad, w, h: 330 },
      tiles: { x: pad, y: pad + 350, w, h: 300 },
      cols: 3,
      badges: { x: pad, y: pad + 680, w, h: 210 },
      footY: height - pad + 8,
    };
  }
  const pad = 48;
  const left = 520;
  return {
    pad,
    head: { x: pad, y: pad, w: left - pad, h: 260 },
    tiles: { x: left + 24, y: pad, w: width - left - 24 - pad, h: height - 2 * pad - 70 },
    cols: 2,
    badges: { x: pad, y: pad + 280, w: left - pad, h: 200 },
    footY: height - pad + 10,
  };
}

/** Schriftgröße so weit verkleinern, bis der Text in `maxW` passt. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 10 && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
}

function drawHead(ctx: CanvasRenderingContext2D, r: SeasonReview, b: Box, big: boolean): void {
  const head = reviewHeadline(r);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.muted;
  ctx.font = `700 ${big ? 22 : 18}px ${FONT}`;
  ctx.fillText('MEINE SAISON', b.x, b.y + (big ? 26 : 22));
  ctx.fillStyle = C.ink;
  ctx.font = `800 ${big ? 64 : 48}px ${FONT}`;
  ctx.fillText(String(r.season), b.x, b.y + (big ? 96 : 76));
  const numY = b.y + (big ? 236 : 180);
  const num = fmtNum(r.nm, 1);
  ctx.fillStyle = C.accent;
  fit(ctx, num, 850, big ? 132 : 96, b.w - 80);
  ctx.fillText(num, b.x, numY);
  const nw = ctx.measureText(num).width;
  ctx.fillStyle = C.ink;
  ctx.font = `700 ${big ? 40 : 30}px ${FONT}`;
  if (b.x + nw + 14 + ctx.measureText('sm').width <= b.x + b.w) ctx.fillText('sm', b.x + nw + 14, numY);
  ctx.fillStyle = C.muted;
  ctx.font = `500 ${big ? 24 : 19}px ${FONT}`;
  ctx.fillText(head.detail ? `Seemeilen, ${head.detail}` : 'Seemeilen', b.x, numY + (big ? 46 : 36));
}

function drawTiles(ctx: CanvasRenderingContext2D, figs: ReviewFigure[], b: Box, cols: number, big: boolean): void {
  const gap = big ? 20 : 16;
  const rows = Math.max(1, Math.ceil(figs.length / cols));
  const tw = (b.w - gap * (cols - 1)) / cols;
  const th = Math.min(140, (b.h - gap * (rows - 1)) / rows);
  figs.forEach((f, i) => {
    const x = b.x + (i % cols) * (tw + gap);
    const y = b.y + Math.floor(i / cols) * (th + gap);
    roundRect(ctx, x, y, tw, th, 18);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    const inner = tw - 40;
    ctx.fillStyle = C.faint;
    fit(ctx, f.label.toUpperCase(), 700, big ? 18 : 15, inner);
    ctx.fillText(f.label.toUpperCase(), x + 20, y + (big ? 38 : 34));
    ctx.fillStyle = C.ink;
    fit(ctx, f.value, 800, big ? 44 : 38, inner);
    ctx.fillText(f.value, x + 20, y + (big ? 88 : 80));
    if (f.detail) {
      ctx.fillStyle = C.muted;
      fit(ctx, f.detail, 500, big ? 20 : 17, inner);
      ctx.fillText(f.detail, x + 20, y + (big ? 118 : 108));
    }
  });
}

function drawBadges(ctx: CanvasRenderingContext2D, badges: SeasonBadge[], b: Box, big: boolean): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = C.muted;
  ctx.font = `700 ${big ? 18 : 15}px ${FONT}`;
  ctx.fillText('ABZEICHEN DER SAISON', b.x, b.y + 20);
  const n = Math.max(1, badges.length);
  const slot = b.w / n;
  const rad = Math.min(big ? 62 : 48, slot / 2 - 10);
  const cy = b.y + 44 + rad;
  badges.forEach((badge, i) => {
    const cx = b.x + slot * i + slot / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = badge.reached ? C.accent : badge.next ? C.panel : '#eef2f6';
    ctx.fill();
    ctx.lineWidth = big ? 8 : 6;
    ctx.strokeStyle = badge.reached ? C.accent : C.line;
    ctx.stroke();
    if (badge.next && badge.progress > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * badge.progress);
      ctx.strokeStyle = C.accent;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = badge.reached ? '#ffffff' : badge.next ? C.ink : C.faint;
    fit(ctx, fmtNum(badge.nm, 0), 850, big ? 36 : 28, rad * 1.6);
    ctx.fillText(fmtNum(badge.nm, 0), cx, cy + 6);
    ctx.font = `700 ${big ? 18 : 15}px ${FONT}`;
    ctx.fillText('sm', cx, cy + (big ? 32 : 26));
    const caption = badgeCaption(badge);
    if (caption) {
      ctx.fillStyle = badge.reached ? C.accent : C.muted;
      fit(ctx, caption, 600, big ? 20 : 16, slot - 8);
      ctx.fillText(caption, cx, cy + rad + (big ? 34 : 28));
    }
    ctx.textAlign = 'left';
  });
}

/** Zeichnet das Saison-Bild in ein Canvas (F-523). Keine Karte, kein Name, keine Titel oder Orte. */
export function drawSeasonImage(canvas: HTMLCanvasElement, review: SeasonReview, format: ImageFormat = 'square'): void {
  const { width, height } = FORMATS[format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const big = format === 'square';
  const L = seasonLayout(format);
  // heller Wasserverlauf – unabhängig vom Farbschema wie das Törn-Bild
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#dcebf7');
  bg.addColorStop(1, C.panel);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  drawHead(ctx, review, L.head, big);
  drawTiles(ctx, reviewFigures(review), L.tiles, L.cols, big);
  drawBadges(ctx, review.badges, L.badges, big);
  ctx.fillStyle = C.line;
  ctx.fillRect(L.pad, L.footY - 44, width - 2 * L.pad, 2);
  drawBrand(ctx, L.pad, width - L.pad, L.footY);
}

/** Saison-Bild als JPEG. */
export function renderSeasonImage(review: SeasonReview, format: ImageFormat = 'square'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  drawSeasonImage(canvas, review, format);
  return canvasToJpeg(canvas);
}
