// Kleiner EXIF-Leser (Konzept 3.1): nur die Felder, die die Platzierung braucht – rein, ohne DOM, ohne Abhängigkeit.
// Eingabe sind die ersten Bytes einer Bilddatei (JPEG, PNG, WebP; HEIC/AVIF über die Suche nach „Exif\0\0“).
// Fremde Daten: jede Länge und jeder Offset wird geprüft, Fehler führen zu „nichts gefunden“, nie zu einer Ausnahme.

export interface ExifData {
  /**
   * DateTimeOriginal als Wanduhrzeit in ms: die Felder werden als UTC gelesen (ohne Zone).
   * Echte UTC-Zeit = localTime − offsetMin · 60 000.
   */
  localTime: number | null;
  /** OffsetTimeOriginal in Minuten (Ortszeit − UTC), z. B. +120 für „+02:00“; null = nicht angegeben */
  offsetMin: number | null;
  /** GPS in Dezimalgrad (Süd/West negativ); beide null, wenn unvollständig */
  lat: number | null;
  lon: number | null;
  /** EXIF-Orientation 1–8 (null = fehlt) – der Browser dreht beim Dekodieren selbst, nur zur Information */
  orientation: number | null;
}

export const EMPTY_EXIF: ExifData = { localTime: null, offsetMin: null, lat: null, lon: null, orientation: null };

/** So viele Bytes vom Dateianfang reichen für die Metadaten (JPEG-APP1 ist höchstens 64 KB, HEIC legt sie meist vorn ab). */
export const EXIF_SCAN_BYTES = 256 * 1024;

const MAX_ENTRIES = 512;

/** Liest EXIF aus den ersten Bytes einer Bilddatei. Unbekanntes Format oder kaputte Daten → EMPTY_EXIF. */
export function readExif(bytes: Uint8Array): ExifData {
  try {
    const tiff = findTiff(bytes);
    return tiff ? parseTiff(tiff) : { ...EMPTY_EXIF };
  } catch {
    return { ...EMPTY_EXIF };
  }
}

// ---------------------------------------------------------------- Container

function findTiff(b: Uint8Array): Uint8Array | null {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return jpegTiff(b);
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return pngTiff(b);
  if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webpTiff(b);
  return scanTiff(b);
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** „Exif\0\0“ gefolgt von einem TIFF-Kopf → TIFF-Bytes. */
function afterExifHeader(b: Uint8Array, at: number, end: number): Uint8Array | null {
  if (end - at < 14 || ascii(b, at, 4) !== 'Exif' || b[at + 4] !== 0 || b[at + 5] !== 0) return null;
  const t = b.subarray(at + 6, end);
  return isTiffHeader(t, 0) ? t : null;
}

function isTiffHeader(b: Uint8Array, at: number): boolean {
  return (
    b.length - at >= 8 &&
    ((b[at] === 0x49 && b[at + 1] === 0x49 && b[at + 2] === 0x2a && b[at + 3] === 0) || (b[at] === 0x4d && b[at + 1] === 0x4d && b[at + 2] === 0 && b[at + 3] === 0x2a))
  );
}

function jpegTiff(b: Uint8Array): Uint8Array | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // Füllbyte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // Bilddaten beginnen – keine Metadaten mehr
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    const end = Math.min(b.length, i + 2 + len);
    if (marker === 0xe1) {
      const t = afterExifHeader(b, i + 4, end);
      if (t) return t;
    }
    i += 2 + len;
  }
  return null;
}

function pngTiff(b: Uint8Array): Uint8Array | null {
  let i = 8;
  while (i + 8 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const start = i + 8;
    if (type === 'eXIf') {
      const end = Math.min(b.length, start + len);
      if (isTiffHeader(b, start)) return b.subarray(start, end);
      return afterExifHeader(b, start, end);
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    i = start + len + 4; // + CRC
  }
  return null;
}

function webpTiff(b: Uint8Array): Uint8Array | null {
  let i = 12;
  while (i + 8 <= b.length) {
    const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    const start = i + 8;
    if (ascii(b, i, 4) === 'EXIF') {
      const end = Math.min(b.length, start + len);
      if (isTiffHeader(b, start)) return b.subarray(start, end);
      return afterExifHeader(b, start, end);
    }
    i = start + len + (len & 1);
  }
  return null;
}

/** Andere Container (HEIC, AVIF, …): erstes „Exif\0\0“ mit TIFF-Kopf suchen. */
function scanTiff(b: Uint8Array): Uint8Array | null {
  const n = Math.min(b.length, EXIF_SCAN_BYTES);
  for (let i = 0; i + 14 <= n; i++) {
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66) {
      const t = afterExifHeader(b, i, b.length);
      if (t) return t;
    }
  }
  return null;
}

// ---------------------------------------------------------------- TIFF

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface Entry {
  type: number;
  count: number;
  /** Offset der Werte im TIFF (inline oder ausgelagert) */
  at: number;
}

function parseTiff(t: Uint8Array): ExifData {
  const le = t[0] === 0x49;
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : NaN);
  const u32 = (o: number) =>
    o + 4 <= t.length ? (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0) : NaN;

  const ifd = (offset: number): Map<number, Entry> => {
    const out = new Map<number, Entry>();
    const n = u16(offset);
    if (!Number.isFinite(n) || n > MAX_ENTRIES) return out;
    for (let k = 0; k < n; k++) {
      const e = offset + 2 + k * 12;
      if (e + 12 > t.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = TYPE_SIZE[type];
      if (!size || !Number.isFinite(count) || count > 1 << 20) continue;
      const at = size * count <= 4 ? e + 8 : u32(e + 8);
      if (!Number.isFinite(at) || at + size * count > t.length) continue;
      out.set(tag, { type, count, at });
    }
    return out;
  };
  const str = (e: Entry | undefined) => (e && e.type === 2 ? ascii(t, e.at, e.count).replace(/\0[\s\S]*$/, '').trim() : null);
  const int = (e: Entry | undefined) => (!e ? null : e.type === 3 ? u16(e.at) : e.type === 4 ? u32(e.at) : null);
  const rationals = (e: Entry | undefined, n: number): number[] | null => {
    if (!e || (e.type !== 5 && e.type !== 10) || e.count < n) return null;
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      let num = u32(e.at + k * 8);
      let den = u32(e.at + k * 8 + 4);
      if (e.type === 10) {
        num = num | 0;
        den = den | 0;
      }
      if (!den) return null;
      out.push(num / den);
    }
    return out;
  };

  const ifd0Off = u32(4);
  if (!Number.isFinite(ifd0Off)) return { ...EMPTY_EXIF };
  const ifd0 = ifd(ifd0Off);
  const exifPtr = int(ifd0.get(0x8769));
  const gpsPtr = int(ifd0.get(0x8825));
  const exif = exifPtr ? ifd(exifPtr) : new Map<number, Entry>();
  const gps = gpsPtr ? ifd(gpsPtr) : new Map<number, Entry>();

  const orientation = int(ifd0.get(0x0112));
  let localTime = parseExifDate(str(exif.get(0x9003)));
  const sub = str(exif.get(0x9291));
  if (localTime !== null && sub && /^\d{1,9}$/.test(sub)) localTime += Math.floor(Number(`0.${sub}`) * 1000);
  const offsetMin = parseOffset(str(exif.get(0x9011)));

  let lat: number | null = null;
  let lon: number | null = null;
  const la = rationals(gps.get(2), 3);
  const lo = rationals(gps.get(4), 3);
  const laRef = str(gps.get(1));
  const loRef = str(gps.get(3));
  if (la && lo) {
    const dms = (v: number[]) => v[0] + v[1] / 60 + v[2] / 3600;
    lat = dms(la) * (laRef === 'S' ? -1 : 1);
    lon = dms(lo) * (loRef === 'W' ? -1 : 1);
    // 0/0 schreiben manche Kameras ohne Fix; außerhalb der Wertebereiche ist es kaputt.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) lat = lon = null;
  }
  return {
    localTime,
    offsetMin,
    lat,
    lon,
    orientation: orientation !== null && orientation >= 1 && orientation <= 8 ? orientation : null,
  };
}

/** „YYYY:MM:DD HH:MM:SS“ → Wanduhrzeit als ms (Felder als UTC); Unplausibles → null. */
export function parseExifDate(s: string | null): number | null {
  const m = s ? /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return null;
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

/** „+02:00“ / „-05:30“ → Minuten; sonst null. */
export function parseOffset(s: string | null): number | null {
  const m = s ? /^([+-])(\d{2}):(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const v = (Number(m[2]) * 60 + Number(m[3])) * (m[1] === '-' ? -1 : 1);
  return v >= -12 * 60 && v <= 14 * 60 ? v : null;
}
