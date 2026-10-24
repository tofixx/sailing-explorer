// Rendert das Übersichtsbild eines Beispiel-Tracks ohne Browser (Kartenkacheln aus).
// Nutzung: npx tsx scripts/render-share-image.ts [landscape|square] [ausgabe.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { DOMParser } from 'linkedom';
import { parseGpx } from '../src/domain/gpx';
import { computeTrackStats } from '../src/domain/stats';
import { metricRange } from '../src/domain/metrics';
import { drawShareImage, type ImageFormat } from '../src/services/share-image';
import type { Track } from '../src/domain/types';

const format = (process.argv[2] as ImageFormat) || 'landscape';
const out = process.argv[3] || `share-${format}.png`;
const text = readFileSync('public/tracks/20260613_Stralsund_Prerow.gpx', 'utf8');
const g = parseGpx(text, 'x', new (DOMParser as unknown as new () => globalThis.DOMParser)());
const track: Track = { id: 't', name: g.name, raw: '', points: g.points, stats: computeTrackStats(g.points), color: '--c-track-1', hidden: false };
const canvas = createCanvas(10, 10);
await drawShareImage(canvas as unknown as HTMLCanvasElement, [track], {
  title: 'Stralsund → Prerow',
  metric: 'speed',
  range: metricRange([track], 'speed'),
  format,
  content: { map: false },
});
writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`geschrieben: ${out}`);
