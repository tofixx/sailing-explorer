// R2-Keys der Fotos (Konzept 3.5, 6.2, 31) und Aufräumen über die D1-Liste – ohne R2-list.
// Eigenes Modul ohne Abhängigkeit auf Handler, damit shares.ts, retention.ts, auth.ts und die Löschwege von Gruppen,
// Häfen, Booten und Beiträgen es nutzen können.
import type { Env } from './env';
import type { PhotoFormat } from './image';
import { STORAGE_COUNTER } from './storage';

/** R2-Schlüssel eines Törns: Track-Payload, Übersichtsbild und Revier-Raster (einzige Stelle für diese Präfixe). */
export const shareKey = (id: string) => `shares/${id}`;
export const previewKey = (id: string) => `previews/${id}.jpg`;
/** Grobes Raster des Wegs für die Revier-Wärmekarte (Konzept 37, F-581) */
export const heatKey = (id: string) => `heat/${id}.json`;
export const shareFileKeys = (id: string) => [shareKey(id), previewKey(id), heatKey(id)];

/**
 * photos/<parentId>/<photoId>.webp bzw. _t.webp (JPEG-Fallback: .jpg / _t.jpg). Eltern: der Törn (`share_id`) bzw.
 * der Galerie-Beitrag (`post_id`, Konzept 31) – IDs beider kommen aus demselben Zufallsraum.
 */
export function photoKey(parentId: string, photoId: string, format: PhotoFormat | string, thumb: boolean): string {
  return `photos/${parentId}/${photoId}${thumb ? '_t' : ''}.${format === 'jpeg' ? 'jpg' : 'webp'}`;
}

/** Eine Foto-Zeile mit ihrem Eltern-Objekt: genau eins von share_id/post_id ist gesetzt. */
export interface PhotoKeyRow {
  id: string;
  share_id: string | null;
  post_id?: string | null;
  format: string;
}

/** Eltern-ID im R2-Schlüssel (Törn bzw. Galerie-Beitrag). */
export const photoParent = (p: Pick<PhotoKeyRow, 'share_id' | 'post_id'>): string => p.share_id ?? p.post_id ?? '';

export const photoKeys = (p: PhotoKeyRow) => [photoKey(photoParent(p), p.id, p.format, false), photoKey(photoParent(p), p.id, p.format, true)];

/** R2-Keys aller Fotos dieser Törns (aus D1). */
export async function photoKeysForShares(env: Env, shareIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < shareIds.length; i += 50) {
    const part = shareIds.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT id, share_id, format FROM photos WHERE share_id IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<PhotoKeyRow>();
    for (const r of results) out.push(...photoKeys(r));
  }
  return out;
}

/** R2-Keys aller Fotos eines Kontos (aus D1). */
export async function photoKeysForUser(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT id, share_id, post_id, format FROM photos WHERE user_id = ?').bind(userId).all<PhotoKeyRow>();
  return results.flatMap(photoKeys);
}

/** R2 löscht höchstens 1000 Keys pro Aufruf. */
export async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) await env.TRACKS.delete(keys.slice(i, i + 1000));
}

/** Hafen bzw. Boot gelöscht: Galerie-Fotos der Beiträge in diesem Verlauf (kein Fremdschlüssel auf `channel_id`). */
export const channelGalleryCleanup = (env: Env, kind: 'harbor' | 'boat', id: string) =>
  galleryPhotoCleanup(env, 'SELECT id FROM posts WHERE channel_kind = ?1 AND channel_id = ?2', kind, id);

/**
 * `postsSql` ist nur eine Konstante aus dem Code (nie Eingaben einsetzen) – Werte immer als `binds`.
 * Galerie-Fotos der Beiträge aus `postsSql` (Unterabfrage auf `posts.id` mit den Bind-Parametern `binds` als ?1, ?2 …,
 * Konzept 31, F-494): R2-Dateien sofort löschen und die D1-Anweisungen liefern – Speicher abziehen, Reaktionen und
 * Meldungen der Fotos, Foto-Zeilen. Der Aufrufer setzt sie in seinem Batch **vor** das Löschen der Beiträge (deren
 * Kaskade nähme die Zeilen sonst ohne Zähler und Dateien mit). Ein Weg für Beitrag, Gruppe, Hafen, Boot und Konto.
 */
export async function galleryPhotoCleanup(env: Env, postsSql: string, ...binds: unknown[]): Promise<D1PreparedStatement[]> {
  const photos = `SELECT id FROM photos WHERE post_id IN (${postsSql})`;
  const { results } = await env.DB.prepare(`SELECT id, share_id, post_id, format FROM photos WHERE post_id IN (${postsSql})`).bind(...binds).all<PhotoKeyRow>();
  if (!results.length) return [];
  await deleteKeys(env, results.flatMap(photoKeys));
  const n = binds.length + 1;
  return [
    env.DB.prepare(`UPDATE counters SET value = MAX(0, value - (SELECT COALESCE(SUM(bytes), 0) FROM photos WHERE post_id IN (${postsSql}))) WHERE name = ?${n}`).bind(
      ...binds, STORAGE_COUNTER,
    ),
    env.DB.prepare(`DELETE FROM reactions WHERE subject_kind = 'photo' AND subject_id IN (${photos})`).bind(...binds),
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'photo' AND target_id IN (${photos})`).bind(...binds),
    env.DB.prepare(`DELETE FROM photos WHERE post_id IN (${postsSql})`).bind(...binds),
  ];
}
