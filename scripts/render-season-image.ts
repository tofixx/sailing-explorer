// Rendert ein Beispiel des „Meine Saison“-Bildes ohne Browser (Konzept 33).
// Nutzung: npx tsx scripts/render-season-image.ts [square|landscape] [ausgabe.png]
import { writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { seasonBadges, type SeasonReview } from '../src/domain/season-review';
import { drawSeasonImage } from '../src/services/season-image';
import type { ImageFormat } from '../src/services/share-image';

const format = (process.argv[2] as ImageFormat) || 'square';
const out = process.argv[3] || `season-${format}.png`;
const review: SeasonReview = {
  season: 2026, voyages: 23, nm: 612.4, recordedNm: 540.2, hours: 148.5, days: 31, boats: 2, harbors: 14,
  longest: { nm: 64.8, startedAt: Date.UTC(2026, 6, 12) }, badges: seasonBadges(612.4),
};
const canvas = createCanvas(10, 10);
drawSeasonImage(canvas as unknown as HTMLCanvasElement, review, format);
writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`geschrieben: ${out}`);
