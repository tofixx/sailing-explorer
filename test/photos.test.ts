// Unit-Tests Fotos (Phase C): EXIF-Leser, Platzierung, Grenzen, Bildprüfung im Worker, Meta-Header, Sichtbarkeit.
import { describe, expect, it } from 'vitest';
import { EMPTY_EXIF, parseExifDate, parseOffset, readExif } from '../src/domain/exif';
import {
  GPS_MAX_DIST_M,
  clampOffset,
  estimateOffset,
  fmtOffset,
  nearestPhotoByTime,
  placePhoto,
  placePhotos,
  positionAt,
  snapToTrack,
  takenAtUtc,
  timedPoints,
  type PhotoClues,
  type PlacePoint,
} from '../src/domain/photo-place';
import { PHOTO_FULL_PX, limitsFor, photoLimitMessage, photoVerdict, usageText } from '../src/domain/limits';
import { effectivePhotoVisibility, isPhotoVisibility } from '../src/domain/visibility';
import { inspectImage } from '../worker/image';
import { parsePhotoMeta, parsePosition, parseTakenAt } from '../worker/validate';
import { gridCluster } from '../src/domain/cluster';
import { fitSize, precheck } from '../src/services/photo-process';

// ---------------------------------------------------------------- Testbilder mit EXIF

type Tag = { tag: number; type: number; count: number; value: number[] };

/** TIFF (big- oder little-endian) mit IFD0 → ExifIFD und GPS-IFD; Werte immer ausgelagert bzw. inline wie die Norm. */
function tiff(o: { date?: string; sub?: string; offset?: string; lat?: [number, number, number]; latRef?: string; lon?: [number, number, number]; lonRef?: string; orientation?: number; le?: boolean }): Uint8Array {
  const le = !!o.le;
  const buf: number[] = [];
  const u16 = (v: number) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (le ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff] : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const asc = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const rat = (vals: number[]) => vals.flatMap((v) => [...u32(Math.round(v * 1000)), ...u32(1000)]);

  const exifTags: Tag[] = [];
  if (o.date) exifTags.push({ tag: 0x9003, type: 2, count: o.date.length + 1, value: asc(o.date) });
  if (o.offset) exifTags.push({ tag: 0x9011, type: 2, count: o.offset.length + 1, value: asc(o.offset) });
  if (o.sub) exifTags.push({ tag: 0x9291, type: 2, count: o.sub.length + 1, value: asc(o.sub) });
  const gpsTags: Tag[] = [];
  if (o.lat) {
    gpsTags.push({ tag: 1, type: 2, count: 2, value: asc(o.latRef ?? 'N') });
    gpsTags.push({ tag: 2, type: 5, count: 3, value: rat(o.lat) });
  }
  if (o.lon) {
    gpsTags.push({ tag: 3, type: 2, count: 2, value: asc(o.lonRef ?? 'E') });
    gpsTags.push({ tag: 4, type: 5, count: 3, value: rat(o.lon) });
  }

  // Layout: Kopf (8) | IFD0 | ExifIFD | GPS-IFD | Datenbereich
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0Tags = 1 + (exifTags.length ? 1 : 0) + (gpsTags.length ? 1 : 0);
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0Tags);
  const gpsAt = exifAt + (exifTags.length ? ifdSize(exifTags.length) : 0);
  let dataAt = gpsAt + (gpsTags.length ? ifdSize(gpsTags.length) : 0);
  const data: number[] = [];

  const writeIfd = (tags: Tag[]) => {
    buf.push(...u16(tags.length));
    for (const t of tags) {
      buf.push(...u16(t.tag), ...u16(t.type), ...u32(t.count));
      if (t.value.length <= 4) buf.push(...t.value, ...new Array<number>(4 - t.value.length).fill(0));
      else {
        buf.push(...u32(dataAt + data.length));
        data.push(...t.value);
        if (data.length & 1) data.push(0);
      }
    }
    buf.push(...u32(0));
  };

  buf.push(...(le ? [0x49, 0x49, 0x2a, 0] : [0x4d, 0x4d, 0, 0x2a]), ...u32(ifd0At));
  const ifd0: Tag[] = [{ tag: 0x0112, type: 3, count: 1, value: u16(o.orientation ?? 1) }];
  if (exifTags.length) ifd0.push({ tag: 0x8769, type: 4, count: 1, value: u32(exifAt) });
  if (gpsTags.length) ifd0.push({ tag: 0x8825, type: 4, count: 1, value: u32(gpsAt) });
  writeIfd(ifd0);
  if (exifTags.length) writeIfd(exifTags);
  if (gpsTags.length) writeIfd(gpsTags);
  dataAt = buf.length; // (nur zur Kontrolle – Offsets oben schon berechnet)
  return new Uint8Array([...buf, ...data]);
}

const EXIF_HDR = [0x45, 0x78, 0x69, 0x66, 0, 0];

function jpegWithExif(t: Uint8Array): Uint8Array {
  const payload = [...EXIF_HDR, ...t];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xe1, len >> 8, len & 0xff, ...payload, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
}

function pngWithExif(t: Uint8Array): Uint8Array {
  const be32 = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const ihdr = [...be32(13), ...'IHDR'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c));
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...new Array<number>(13 + 4).fill(0), ...be32(t.length), ...[...'eXIf'].map((c) => c.charCodeAt(0)), ...t, 0, 0, 0, 0]);
}

function webpWithExif(t: Uint8Array): Uint8Array {
  const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  const chunk = [...[...'EXIF'].map((c) => c.charCodeAt(0)), ...le32(t.length), ...t, ...(t.length & 1 ? [0] : [])];
  const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...chunk];
  return new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
}

const FULL = { date: '2026:06:13 12:05:30', sub: '250', offset: '+02:00', lat: [54, 0, 18] as [number, number, number], lon: [13, 30, 0] as [number, number, number], orientation: 6 };

describe('exif: readExif', () => {
  it('JPEG (big-endian): Zeit, Sekundenbruchteil, Zeitzone, GPS, Orientierung', () => {
    const e = readExif(jpegWithExif(tiff(FULL)));
    expect(e.localTime).toBe(Date.UTC(2026, 5, 13, 12, 5, 30) + 250);
    expect(e.offsetMin).toBe(120);
    expect(e.lat).toBeCloseTo(54.005, 6);
    expect(e.lon).toBeCloseTo(13.5, 6);
    expect(e.orientation).toBe(6);
  });

  it('little-endian, Süd/West, ohne Zeitzone', () => {
    const e = readExif(jpegWithExif(tiff({ ...FULL, le: true, offset: undefined, sub: undefined, latRef: 'S', lonRef: 'W' })));
    expect(e.localTime).toBe(Date.UTC(2026, 5, 13, 12, 5, 30));
    expect(e.offsetMin).toBeNull();
    expect(e.lat).toBeCloseTo(-54.005, 6);
    expect(e.lon).toBeCloseTo(-13.5, 6);
  });

  it('PNG (eXIf), WebP (EXIF-Chunk) und HEIC-ähnliche Container (Suche)', () => {
    const t = tiff(FULL);
    for (const bytes of [pngWithExif(t), webpWithExif(t), new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), ...new Array<number>(40).fill(7), ...EXIF_HDR, ...t])]) {
      const e = readExif(bytes);
      expect(e.offsetMin).toBe(120);
      expect(e.lat).toBeCloseTo(54.005, 6);
    }
  });

  it('GPS 0/0 und unvollständiges GPS gelten als „kein GPS“', () => {
    expect(readExif(jpegWithExif(tiff({ ...FULL, lat: [0, 0, 0], lon: [0, 0, 0] })))).toMatchObject({ lat: null, lon: null });
    expect(readExif(jpegWithExif(tiff({ ...FULL, lon: undefined })))).toMatchObject({ lat: null, lon: null });
  });

  it('kaputte, abgeschnittene und fremde Daten → leer, nie eine Ausnahme', () => {
    const good = jpegWithExif(tiff(FULL));
    for (let cut = 0; cut < good.length; cut += 7) expect(() => readExif(good.subarray(0, cut))).not.toThrow();
    expect(readExif(new Uint8Array([1, 2, 3]))).toEqual(EMPTY_EXIF);
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toEqual(EMPTY_EXIF);
    const garbage = new Uint8Array(4000).map((_, i) => (i * 7919) & 0xff);
    expect(() => readExif(garbage)).not.toThrow();
  });

  it('parseExifDate / parseOffset', () => {
    expect(parseExifDate('2026:06:13 08:00:00')).toBe(Date.UTC(2026, 5, 13, 8));
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate('    :  :     :  :  ')).toBeNull();
    expect(parseOffset('-05:30')).toBe(-330);
    expect(parseOffset('+15:00')).toBeNull();
    expect(parseOffset('02:00')).toBeNull();
  });
});

// ---------------------------------------------------------------- Platzierung

const T0 = Date.UTC(2026, 5, 13, 10, 0, 0);
/** 61 Punkte, eine Minute Abstand, nach Norden (ca. 185 m pro Minute). */
const TRACK: PlacePoint[] = Array.from({ length: 61 }, (_, i) => ({ lat: 54 + i * 0.001666, lon: 13, time: T0 + i * 60_000 }));
const clue = (o: Partial<PhotoClues> = {}): PhotoClues => ({ localTime: null, offsetMin: null, lat: null, lon: null, ...o });

describe('photo-place', () => {
  it('[F-102] GPS ≤ 2 km vom Track wird übernommen (gerundet), weiter weg verworfen → Zeitabgleich', () => {
    const near = placePhoto(clue({ lat: 54.0101234, lon: 13.001 }), TRACK, 0);
    expect(near).toMatchObject({ placement: 'gps', lat: 54.01012, lon: 13.001, gpsRejected: false });
    // ca. 11 km östlich, Aufnahmezeit 10:30 UTC (Ortszeit 12:30, +02:00)
    const far = placePhoto(clue({ lat: 54.02, lon: 13.17, localTime: T0 + 2.5 * 3_600_000, offsetMin: 120 }), TRACK, 0);
    expect(far.gpsRejected).toBe(true);
    expect(far.placement).toBe('time');
    expect(far.takenAt).toBe(T0 + 30 * 60_000);
    expect(far.lat).toBeCloseTo(54 + 30 * 0.001666, 4);
    expect(GPS_MAX_DIST_M).toBe(2000);
  });

  it('[F-102] Zeitabgleich interpoliert zwischen Nachbarpunkten; ±10 min außerhalb rastet am Ende ein; weiter weg → none', () => {
    const mid = positionAt(timedPoints(TRACK), T0 + 90_000);
    expect(mid!.lat).toBeCloseTo(54 + 1.5 * 0.001666, 6);
    expect(placePhoto(clue({ localTime: T0 - 9 * 60_000, offsetMin: 0 }), TRACK, 0)).toMatchObject({ placement: 'time', lat: 54, lon: 13 });
    expect(placePhoto(clue({ localTime: T0 + 71 * 60_000, offsetMin: 0 }), TRACK, 0).placement).toBe('none');
    expect(placePhoto(clue({ localTime: T0 + 69 * 60_000, offsetMin: 0 }), TRACK, 0).placement).toBe('time');
    expect(placePhoto(clue(), TRACK, 0)).toMatchObject({ placement: 'none', takenAt: null, gpsRejected: false });
  });

  it('[F-102] große Lücken werden nicht interpoliert (näherer Punkt)', () => {
    const gap: PlacePoint[] = [
      { lat: 54, lon: 13, time: T0 },
      { lat: 55, lon: 13, time: T0 + 3 * 3_600_000 },
    ];
    expect(positionAt(timedPoints(gap), T0 + 20 * 60_000)).toEqual({ lat: 54, lon: 13 });
    expect(positionAt(timedPoints(gap), T0 + 170 * 60_000)).toEqual({ lat: 55, lon: 13 });
  });

  it('[F-102] eigener Versatz des Fotos vor dem allgemeinen', () => {
    expect(takenAtUtc({ localTime: T0, offsetMin: 120 }, 60)).toBe(T0 - 120 * 60_000);
    expect(takenAtUtc({ localTime: T0, offsetMin: null }, 60)).toBe(T0 - 60 * 60_000);
    expect(takenAtUtc({ localTime: null, offsetMin: 0 }, 60)).toBeNull();
  });

  it('[F-102] Versatz-Schätzung: Kalibrierung über GPS-Fotos', () => {
    // Handy-Foto mit GPS am Punkt 20 (10:20 UTC), Kamerauhr zeigt 12:20 → +2 h. Kamera-Fotos ohne GPS folgen.
    const photos = [clue({ localTime: T0 + 20 * 60_000 + 2 * 3_600_000, lat: TRACK[20].lat, lon: 13 }), clue({ localTime: T0 + 2 * 3_600_000 + 40 * 60_000 })];
    expect(estimateOffset(photos, TRACK, 0)).toEqual({ offsetMin: 120, source: 'gps' });
    const placed = placePhotos(photos, TRACK, 120);
    expect(placed[1]).toMatchObject({ placement: 'time', takenAt: T0 + 40 * 60_000 });
  });

  it('[F-102] Versatz-Schätzung: meiste Treffer, bei Gleichstand nahe am Browser-Versatz; sonst Browser', () => {
    const photos = [clue({ localTime: T0 + 3 * 3_600_000 + 10 * 60_000 }), clue({ localTime: T0 + 3 * 3_600_000 + 50 * 60_000 })];
    const est = estimateOffset(photos, TRACK, 180);
    expect(est.source).toBe('time');
    expect(est.offsetMin).toBe(180);
    // Alle Fotos bringen ihre Zone mit → Regler wirkungslos
    expect(estimateOffset([clue({ localTime: T0, offsetMin: 60 })], TRACK, 90)).toEqual({ offsetMin: 90, source: 'photo' });
    // Keine Zeit im Track → Browser-Versatz
    expect(estimateOffset(photos, TRACK.map((p) => ({ ...p, time: null })), 60)).toEqual({ offsetMin: 60, source: 'default' });
  });

  it('clampOffset, fmtOffset, snapToTrack, nearestPhotoByTime', () => {
    expect(clampOffset(127)).toBe(120);
    expect(clampOffset(-2000)).toBe(-720);
    expect(clampOffset(5000)).toBe(840);
    expect(fmtOffset(0)).toBe('±0 h');
    expect(fmtOffset(120)).toBe('+2 h');
    expect(fmtOffset(-45)).toBe('−0:45 h');
    expect(snapToTrack(TRACK, 54.0167, 13.004)).toEqual({ lat: TRACK[10].lat, lon: 13, time: TRACK[10].time });
    expect(snapToTrack([], 1, 2)).toBeNull();
    const ps = [{ id: 'a', takenAt: T0 }, { id: 'b', takenAt: T0 + 10 * 60_000 }, { id: 'c', takenAt: null }];
    expect(nearestPhotoByTime(ps, T0 + 7 * 60_000)!.id).toBe('b');
    expect(nearestPhotoByTime(ps, T0 + 60 * 60_000)).toBeNull();
  });
});

// ---------------------------------------------------------------- Grenzen und Sichtbarkeit

describe('limits und visibility für Fotos', () => {
  it('[E3] kostenlos keine Fotos, Unterstützer bis 100 pro Törn', () => {
    expect(limitsFor('free').photosPerShare).toBe(0);
    expect(limitsFor('supporter').photosPerShare).toBe(100);
    expect(photoVerdict(false, 0)).toBe('supporter_required');
    expect(photoVerdict(true, 99)).toBe('ok');
    expect(photoVerdict(true, 100)).toBe('quota');
    expect(photoLimitMessage('supporter_required', true)).toMatch(/nur für Unterstützer.*Kaffee/);
    expect(photoLimitMessage('supporter_required', false)).toBe('Fotos gibt es nur für Unterstützer.');
    expect(photoLimitMessage('quota', true)).toBe('Maximal 100 Fotos pro Törn.');
    expect(usageText({ supporter: true, sharesUsed: 1, sharesMax: 100, bytesUsed: 0, bytesMax: 1, photosUsed: 12 })).toMatch(/12 Fotos$/);
  });

  it('[F-81] ein Foto ist nie sichtbarer als sein Törn', () => {
    expect(effectivePhotoVisibility('public', 'unlisted')).toBe('unlisted');
    expect(effectivePhotoVisibility('public', 'public')).toBe('public');
    expect(effectivePhotoVisibility('private', 'public')).toBe('private');
    expect(isPhotoVisibility('unlisted')).toBe(false);
  });
});

// ---------------------------------------------------------------- Worker: Bildprüfung und Header

describe('worker/image: inspectImage', () => {
  const jpeg = (w: number, h: number, seg: number[] = []) =>
    new Uint8Array([0xff, 0xd8, ...seg, 0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9]);

  it('[F-101] JPEG: Größe aus SOF; APP1, APP13 und Kommentar → Metadaten', () => {
    expect(inspectImage(jpeg(2048, 1365))).toEqual({ ok: true, info: { format: 'jpeg', width: 2048, height: 1365 } });
    for (const m of [0xe1, 0xed, 0xfe]) expect(inspectImage(jpeg(10, 10, [0xff, m, 0, 4, 0, 0]))).toEqual({ ok: false, code: 'image_metadata' });
    // APP0 (JFIF) ist erlaubt
    expect(inspectImage(jpeg(10, 10, [0xff, 0xe0, 0, 4, 0, 0])).ok).toBe(true);
    expect(inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])).ok).toBe(false);
    expect(PHOTO_FULL_PX).toBe(2048);
  });

  it('[F-101] WebP: VP8X mit EXIF-/XMP-Flag → Metadaten, Animation → ungültig', () => {
    const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
    const ch = (id: string, d: number[]) => [...[...id].map((c) => c.charCodeAt(0)), ...le32(d.length), ...d];
    const riff = (chunks: number[]) => {
      const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...chunks];
      return new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
    };
    const vp8x = (flags: number) => ch('VP8X', [flags, 0, 0, 0, 99, 0, 0, 49, 0, 0]);
    const vp8l = ch('VP8L', [0x2f, 0, 0, 0, 0, 0]);
    expect(inspectImage(riff([...vp8x(0), ...vp8l]))).toEqual({ ok: true, info: { format: 'webp', width: 100, height: 50 } });
    expect(inspectImage(riff([...vp8x(0x08), ...vp8l]))).toEqual({ ok: false, code: 'image_metadata' });
    expect(inspectImage(riff([...vp8x(0x04), ...vp8l]))).toEqual({ ok: false, code: 'image_metadata' });
    expect(inspectImage(riff([...vp8x(0x02), ...vp8l]))).toEqual({ ok: false, code: 'invalid_image' });
    expect(inspectImage(riff(vp8x(0)))).toEqual({ ok: false, code: 'invalid_image' });
  });

  it('[F-100] parsePhotoMeta, parsePosition, parseTakenAt', () => {
    const now = Date.UTC(2026, 9, 1);
    expect(parsePhotoMeta(null, now)).toEqual({ caption: '', takenAt: null, lat: null, lon: null, placement: 'none', visibility: 'public' });
    const m = parsePhotoMeta(encodeURIComponent(JSON.stringify({ caption: 'A\u0000b', takenAt: T0, lat: 54.123456, lon: 13.1, placement: 'time', visibility: 'private' })), now);
    expect(m).toMatchObject({ takenAt: T0, lat: 54.12346, lon: 13.1, placement: 'time', visibility: 'private' });
    expect(parsePhotoMeta('%E0%A4%A', now)).toBeNull();
    expect(parsePhotoMeta(encodeURIComponent('[1]'), now)).toBeNull();
    expect(parsePhotoMeta('x'.repeat(3000), now)).toBeNull();
    expect(parsePosition(1, 2, 'none')).toEqual({ lat: null, lon: null, placement: 'none' });
    expect(parsePosition(null, null, 'gps')).toBeNull();
    expect(parsePosition(1, 2, 'gps')).toEqual({ lat: 1, lon: 2, placement: 'gps' });
    expect(parsePosition(1, 2, 'irgendwo')).toBeNull();
    expect(parseTakenAt(now + 10 * 86_400_000, now)).toBeNull();
    expect(parseTakenAt('2026', now)).toBeNull();
  });
});

// ---------------------------------------------------------------- Clusterung und Bildaufbereitung (rein)


describe('cluster und photo-process', () => {
  it('[F-103] Raster-Clusterung: nahe Punkte zusammen (auch über Zellgrenzen), ferne getrennt, Reihenfolge stabil', () => {
    const pts = [
      { item: 'a', x: 10, y: 10 },
      { item: 'b', x: 30, y: 12 },
      { item: 'c', x: 46, y: 10 }, // andere Zelle, aber nah an a/b
      { item: 'd', x: 400, y: 400 },
    ];
    const cs = gridCluster(pts, 44);
    expect(cs.map((c) => c.items)).toEqual([['a', 'b', 'c'], ['d']]);
    expect(cs[0].x).toBeCloseTo((10 + 30 + 46) / 3, 6);
    expect(gridCluster([], 44)).toEqual([]);
  });

  it('[F-100] Verkleinern auf die lange Kante, nie vergrößern; Vorprüfung der Dateien', () => {
    expect(fitSize(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitSize(3024, 4032, 400)).toEqual({ width: 300, height: 400 });
    expect(fitSize(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(precheck({ name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(precheck({ name: 'IMG.HEIC', type: '', size: 1000 })).toBeNull();
    expect(precheck({ name: 'track.gpx', type: 'application/gpx+xml', size: 1000 })).toMatch(/Keine Bilddatei/);
    expect(precheck({ name: 'a.png', type: 'image/png', size: 100 * 1024 * 1024 })).toMatch(/zu groß/);
  });
});

describe('Titelbild: coverCrop und Ausschnitt (Konzept 13.2)', () => {
  it('F-209: begrenzt auf 3:1 … 3:2 (Überstand bleibt für den Ausschnitt) und skaliert nur herunter', async () => {
    const { coverCrop } = await import('../src/services/photo-process');
    // 4:3 → oben und unten mittig auf 3:2
    expect(coverCrop(4000, 3000)).toEqual({ sx: 0, sy: 167, sw: 4000, sh: 2667, width: 1500, height: 1000 });
    // dazwischen (2:1) bleibt das Bild ganz
    expect(coverCrop(3000, 1500)).toEqual({ sx: 0, sy: 0, sw: 3000, sh: 1500, width: 1500, height: 750 });
    // breiter als 3:1 → links und rechts mittig auf 3:1
    expect(coverCrop(3000, 500)).toEqual({ sx: 750, sy: 0, sw: 1500, sh: 500, width: 1500, height: 500 });
    // klein: nicht hochskalieren
    expect(coverCrop(600, 600)).toEqual({ sx: 0, sy: 100, sw: 600, sh: 400, width: 600, height: 400 });
    // Hochformat
    const r = coverCrop(1000, 3000);
    expect(r.sw / r.sh).toBeCloseTo(1.5, 1);
    expect(r.sx).toBe(0);
    expect(r.height).toBeLessThanOrEqual(1000);
  });

  it('F-210: Ziehen verschiebt den Fokus im Verhältnis zum Überstand, begrenzt auf 0 … 100', async () => {
    const { focusAfterDrag, focusSlack, parseFocusY } = await import('../src/domain/cover');
    // 3:2-Bild in einem 900 × 300-Banner: 600 px hoch, 300 px Überstand
    expect(focusSlack(900, 300, 1500, 1000)).toBe(300);
    // 3:1-Bild oder breiter: kein Spielraum
    expect(focusSlack(900, 300, 1500, 500)).toBe(0);
    expect(focusSlack(900, 300, 3000, 500)).toBe(0);
    expect(focusAfterDrag(50, 150, 300)).toBe(0); // Bild nach unten gezogen → oberer Rand
    expect(focusAfterDrag(50, -30, 300)).toBe(60);
    expect(focusAfterDrag(50, -900, 300)).toBe(100);
    expect(focusAfterDrag(50, 40, 0)).toBe(50);
    expect([0, 100, 37].map(parseFocusY)).toEqual([0, 100, 37]);
    expect([-1, 101, 2.5, '50', null].map(parseFocusY)).toEqual([null, null, null, null, null]);
  });
});
