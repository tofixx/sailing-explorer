// Fotos im Browser vorbereiten (Konzept 3.1): EXIF lesen, dekodieren (mit Drehung laut EXIF), verkleinern und neu
// kodieren. Durch das Neukodieren ist die Datei frei von EXIF, GPS, Kameradaten und XMP – der Server lehnt Bilder mit
// Metadaten ohnehin ab (worker/image.ts). Der Worker dekodiert nichts.
//
// Dekodieren und Skalieren übernimmt createImageBitmap (in den Browsern außerhalb des Haupt-Threads), Kodieren
// OffscreenCanvas.convertToBlob bzw. canvas.toBlob – beides asynchron, ein eigener Web Worker ist dafür nicht nötig.
import { COVER_BANNER_RATIO, COVER_MIN_RATIO } from '../domain/cover';
import { EXIF_SCAN_BYTES, readExif, type ExifData } from '../domain/exif';
import { COVER_BYTES, COVER_HEIGHT, COVER_WIDTH, PHOTO_FULL_BYTES, PHOTO_FULL_PX, PHOTO_THUMB_BYTES, PHOTO_THUMB_PX } from '../domain/limits';

/** Größte Eingabedatei – größere Fotos sind eher Panoramen/RAW-Exporte und sprengen den Speicher mobiler Browser. */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** Höchstens so viele Fotos pro Auswahl. */
export const MAX_BATCH = 30;

export type PhotoOutputFormat = 'webp' | 'jpeg';

export interface ProcessedPhoto {
  exif: ExifData;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  format: PhotoOutputFormat;
}

export class PhotoError extends Error {}

/** Größe für die lange Kante `max` – nie vergrößern. */
export function fitSize(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const f = max / long;
  return { width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)) };
}

/** Qualitätsstufen beim Kodieren: Start wie im Konzept, dann schrittweise kleiner, bis die Grenze passt. */
export const FULL_QUALITIES = { webp: [0.8, 0.7, 0.6, 0.5], jpeg: [0.85, 0.75, 0.65, 0.55] } as const;
export const THUMB_QUALITIES = { webp: [0.7, 0.6, 0.5, 0.4], jpeg: [0.75, 0.65, 0.55, 0.45] } as const;

/** Grobe Prüfung vor dem Lesen: Bilddatei, nicht zu groß. HEIC nur, wo der Browser es kann (beim Dekodieren). */
export function precheck(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const name = file.name.toLowerCase();
  const isImage = /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
  if (!isImage) return 'Keine Bilddatei (JPEG, PNG, WebP oder HEIC).';
  if (file.size > MAX_INPUT_BYTES) return `Datei zu groß (höchstens ${MAX_INPUT_BYTES / 1024 / 1024} MB).`;
  return null;
}

const isHeic = (file: Pick<File, 'name' | 'type'>) => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function canvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

async function toBlob(c: AnyCanvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

async function draw(bitmap: ImageBitmap, max: number): Promise<AnyCanvas> {
  const size = fitSize(bitmap.width, bitmap.height, max);
  const c = canvas(size.width, size.height);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new PhotoError('Bild konnte nicht verarbeitet werden.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return c;
}

/** Kodiert mit sinkender Qualität, bis `maxBytes` passt. null = Format nicht kodierbar. */
async function encode(c: AnyCanvas, format: PhotoOutputFormat, qualities: readonly number[], maxBytes: number): Promise<Blob | null> {
  const type = `image/${format}`;
  for (const q of qualities) {
    const blob = await toBlob(c, type, q);
    // Kann der Browser das Format nicht kodieren, liefert er PNG – dann JPEG nehmen.
    if (!blob || blob.type !== type) return null;
    if (blob.size <= maxBytes) return blob;
  }
  throw new PhotoError('Bild lässt sich nicht klein genug speichern.');
}

let webpEncodes: boolean | null = null;

/** Liest EXIF, dekodiert, verkleinert und kodiert ein Foto neu (WebP, sonst JPEG). */
export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const problem = precheck(file);
  if (problem) throw new PhotoError(problem);
  const exif = readExif(new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer()));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError(
      isHeic(file)
        ? 'HEIC kann dieser Browser nicht öffnen – bitte als JPEG exportieren (iPhone: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“) oder Safari nutzen.'
        : 'Bild konnte nicht gelesen werden.',
    );
  }
  try {
    const fullCanvas = await draw(bitmap, PHOTO_FULL_PX);
    const thumbCanvas = await draw(bitmap, PHOTO_THUMB_PX);
    const formats: PhotoOutputFormat[] = webpEncodes === false ? ['jpeg'] : ['webp', 'jpeg'];
    for (const format of formats) {
      const full = await encode(fullCanvas, format, FULL_QUALITIES[format], PHOTO_FULL_BYTES);
      if (!full) {
        if (format === 'webp') webpEncodes = false;
        continue;
      }
      if (format === 'webp') webpEncodes = true;
      const thumb = await encode(thumbCanvas, format, THUMB_QUALITIES[format], PHOTO_THUMB_BYTES);
      if (!thumb) continue;
      return { exif, full, thumb, width: fullCanvas.width, height: fullCanvas.height, format };
    }
    throw new PhotoError('Dieser Browser kann keine Bilder speichern.');
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------- Titelbilder (Konzept 13.2)

/**
 * Ausschnitt für ein Titelbild: Seitenverhältnis auf 3:1 (Banner) … 3:2 begrenzt – breitere Bilder links und
 * rechts, höhere oben und unten mittig beschnitten. Dazwischen bleibt das Bild ganz; den sichtbaren Streifen wählt
 * später die Fokus-Position. Ausgabe nie größer als die Quelle (kleine Bilder werden nicht hochskaliert).
 */
export function coverCrop(width: number, height: number, outW = COVER_WIDTH, outH = COVER_HEIGHT) {
  const ratio = Math.min(COVER_BANNER_RATIO, Math.max(COVER_MIN_RATIO, width / height));
  const sw = Math.min(width, Math.round(height * ratio));
  const sh = Math.min(height, Math.round(sw / ratio));
  const scale = Math.min(1, outW / sw, outH / sh);
  return {
    sx: Math.round((width - sw) / 2),
    sy: Math.round((height - sh) / 2),
    sw,
    sh,
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}

/** Bild als Titelbild vorbereiten: drehen laut EXIF, auf 3:1 … 3:2 zuschneiden (coverCrop), verkleinern, ohne Metadaten neu kodieren. */
export async function processCover(file: File): Promise<Blob> {
  const problem = precheck(file);
  if (problem) throw new PhotoError(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError(isHeic(file) ? 'HEIC kann dieser Browser nicht öffnen – bitte als JPEG exportieren oder Safari nutzen.' : 'Bild konnte nicht gelesen werden.');
  }
  try {
    const r = coverCrop(bitmap.width, bitmap.height);
    const c = canvas(r.width, r.height);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new PhotoError('Bild konnte nicht verarbeitet werden.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, r.width, r.height);
    for (const format of webpEncodes === false ? (['jpeg'] as const) : (['webp', 'jpeg'] as const)) {
      const blob = await encode(c, format, FULL_QUALITIES[format], COVER_BYTES);
      if (blob) return blob;
      if (format === 'webp') webpEncodes = false;
    }
    throw new PhotoError('Dieser Browser kann keine Bilder speichern.');
  } finally {
    bitmap.close();
  }
}
