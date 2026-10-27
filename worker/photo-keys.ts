// R2-Keys der Fotos (Konzept 3.5, 6.2) und Aufräumen über die D1-Liste – ohne R2-list.
// Eigenes Modul ohne Abhängigkeit auf Handler, damit shares.ts, retention.ts und auth.ts es nutzen können.
import type { Env } from './env';
import type { PhotoFormat } from './image';

/** photos/<shareId>/<photoId>.webp bzw. _t.webp (JPEG-Fallback: .jpg / _t.jpg) */
/** R2-Schlüssel eines Törns: Track-Payload und Übersichtsbild (einzige Stelle für diese Präfixe). */
export const shareKey = (id: string) => `shares/${id}`;
export const previewKey = (id: string) => `previews/${id}.jpg`;
export const shareFileKeys = (id: string) => [shareKey(id), previewKey(id)];

export function photoKey(shareId: string, photoId: string, format: PhotoFormat | string, thumb: boolean): string {
  return `photos/${shareId}/${photoId}${thumb ? '_t' : ''}.${format === 'jpeg' ? 'jpg' : 'webp'}`;
}

export const photoKeys = (p: { share_id: string; id: string; format: string }) => [photoKey(p.share_id, p.id, p.format, false), photoKey(p.share_id, p.id, p.format, true)];

/** R2-Keys aller Fotos dieser Törns (aus D1). */
export async function photoKeysForShares(env: Env, shareIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < shareIds.length; i += 50) {
    const part = shareIds.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT id, share_id, format FROM photos WHERE share_id IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<{ id: string; share_id: string; format: string }>();
    for (const r of results) out.push(...photoKeys(r));
  }
  return out;
}

/** R2-Keys aller Fotos eines Kontos (aus D1). */
export async function photoKeysForUser(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT id, share_id, format FROM photos WHERE user_id = ?').bind(userId).all<{ id: string; share_id: string; format: string }>();
  return results.flatMap(photoKeys);
}

/** R2 löscht höchstens 1000 Keys pro Aufruf. */
export async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) await env.TRACKS.delete(keys.slice(i, i + 1000));
}
