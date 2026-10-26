// Prüfung hochgeladener Fotos (Konzept 3.1): nur Kopfdaten lesen (< 1 ms), nichts dekodieren.
// Rein, ohne Worker-APIs – unit-testbar. Fail closed: Unbekanntes, Kaputtes und Metadaten werden abgelehnt.

export type PhotoFormat = 'webp' | 'jpeg';

export interface ImageInfo {
  format: PhotoFormat;
  width: number;
  height: number;
}

export type ImageCheck = { ok: true; info: ImageInfo } | { ok: false; code: 'invalid_image' | 'image_metadata' };

const bad = { ok: false, code: 'invalid_image' } as const;
const meta = { ok: false, code: 'image_metadata' } as const;

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Format per Magic Bytes, Breite/Höhe aus dem Kopf, und: keine EXIF-/XMP-/IPTC-Daten. */
export function inspectImage(b: Uint8Array): ImageCheck {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return inspectJpeg(b);
  if (b.length >= 16 && fourcc(b, 0) === 'RIFF' && fourcc(b, 8) === 'WEBP') return inspectWebp(b);
  return bad;
}

/**
 * JPEG: Segmente bis zum Scan-Beginn lesen. APP1 (EXIF, XMP), APP13 (IPTC/Photoshop) und Kommentare (COM) gelten als
 * Metadaten. Größe aus dem SOF-Segment.
 */
function inspectJpeg(b: Uint8Array): ImageCheck {
  let i = 2;
  let size: { width: number; height: number } | null = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return bad;
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xd8 || m === 0xd9) return bad;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return bad;
    if (m === 0xe1 || m === 0xed || m === 0xfe) return meta;
    // SOF0–SOF15 außer DHT (C4), JPG (C8), DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 7) return bad;
      size = { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    if (m === 0xda) {
      if (!size || !size.width || !size.height) return bad;
      return { ok: true, info: { format: 'jpeg', ...size } };
    }
    i += 2 + len;
  }
  return bad;
}

/**
 * WebP (RIFF): alle Chunks durchgehen. EXIF- und XMP-Chunks sowie die entsprechenden VP8X-Flags gelten als
 * Metadaten; Animationen werden nicht angenommen. Größe aus VP8X, VP8 oder VP8L.
 */
function inspectWebp(b: Uint8Array): ImageCheck {
  const riff = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
  if (riff + 8 > b.length || riff < 4) return bad;
  const end = riff + 8;
  let i = 12;
  let size: { width: number; height: number } | null = null;
  let image = false;
  while (i + 8 <= end) {
    const id = fourcc(b, i);
    const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    const d = i + 8;
    if (d + len > end) return bad;
    if (id === 'EXIF' || id === 'XMP ') return meta;
    if (id === 'ANIM' || id === 'ANMF') return bad;
    if (id === 'VP8X') {
      if (len < 10) return bad;
      const flags = b[d];
      if (flags & 0x0c) return meta; // EXIF (0x08) oder XMP (0x04) angekündigt
      if (flags & 0x02) return bad; // Animation
      size = { width: 1 + (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16)), height: 1 + (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16)) };
    } else if (id === 'VP8 ') {
      if (len < 10 || b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return bad;
      image = true;
      size ??= { width: (b[d + 6] | (b[d + 7] << 8)) & 0x3fff, height: (b[d + 8] | (b[d + 9] << 8)) & 0x3fff };
    } else if (id === 'VP8L') {
      if (len < 5 || b[d] !== 0x2f) return bad;
      image = true;
      const bits = (b[d + 1] | (b[d + 2] << 8) | (b[d + 3] << 16) | (b[d + 4] << 24)) >>> 0;
      size ??= { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    i = d + len + (len & 1);
  }
  if (!image || !size || !size.width || !size.height) return bad;
  return { ok: true, info: { format: 'webp', ...size } };
}
