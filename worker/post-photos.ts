// Galerie-Beiträge (Konzept 31, F-491 … F-495): Fotos ohne Törn an einem Beitrag (`posts.kind = 'gallery'`).
// Für alle Konten mit Monatskontingent (GALLERY_LIMITS, `photo_log`), Speicher gemeinsam mit Törns, Notbremse gilt.
// Einlesen und Prüfen des Bildes wie bei Törn-Fotos (photos.ts `readPhotoBody`), Löschen über removePost bzw.
// galleryPhotoCleanup (photo-keys.ts), Sichtbarkeit wie der Beitrag (photos.ts `visiblePhoto` → `visiblePost`).
import type { Env } from './env';
import { requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, json } from './http';
import { assertActive } from './moderation';
import { readPhotoBody } from './photos';
import { deleteKeys, photoKey, photoKeys } from './photo-keys';
import { addPhotoStmt, checkBrake, currentBrake } from './storage';
import { storageQuotaError, supportConfigured, supportStatus } from './supporter';
import { notifyPost } from './notifications';
import { SHARE_ID_RE } from './validate';
import { GALLERY_LIMITS, galleryLimitMessage, galleryVerdict, monthStart, quotaVerdict } from '../src/domain/limits';
import { fmtMB } from '../src/domain/format';
import type { GalleryQuota, PostPhoto } from '../src/domain/posts';

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Beitrag gibt es nicht (mehr).');
const DAY = 86_400_000;

/** Galerie-Fotos dieses Kontos im laufenden Kalendermonat (auch gelöschte, `photo_log`). */
const monthUsed = async (env: Env, userId: string, now = Date.now()) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM photo_log WHERE user_id = ? AND created_at >= ?').bind(userId, monthStart(now)).first<{ n: number }>())?.n ?? 0;

/** Kontingent für das Formular (GET /api/me/compose): diesen Monat genutzt, Grenze, Fotos je Beitrag. */
export async function galleryQuota(env: Env, userId: string, supporter: boolean): Promise<GalleryQuota> {
  return { used: await monthUsed(env, userId), max: GALLERY_LIMITS.perMonth[supporter ? 'supporter' : 'free'], perPost: GALLERY_LIMITS.perPost };
}

/** Vor dem Anlegen eines Galerie-Beitrags: geht diesen Monat noch ein Foto? Sonst 402 (Unterstützen hilft) bzw. 409. */
export async function assertGalleryQuota(env: Env, userId: string, supporter: boolean): Promise<void> {
  const v = galleryVerdict(supporter, await monthUsed(env, userId));
  if (v !== 'ok') throw new HttpError(v === 'quota' ? 409 : 402, v, galleryLimitMessage(v, supportConfigured(env)));
}

interface GalleryPostRow {
  id: string;
  author_id: string;
  kind: string;
  channel_kind: string;
  channel_id: string;
  visibility: string;
  locked_at: number | null;
  n: number;
}

/**
 * POST /api/posts/:id/photos – ein Foto zum eigenen Galerie-Beitrag (F-491, F-493). Body und Header wie
 * POST /api/shares/:id/photos; Ort und Sichtbarkeit setzt der Server (`none`, wie der Beitrag). Reihenfolge: Konto
 * aktiv → Fotos je Beitrag → Monatskontingent → Speicher (gemeinsam, kostenlos höchstens 25 MB Galerie) → Notbremse –
 * alles vor dem Einlesen; die Grenzen je Beitrag und Monat gelten atomar im INSERT (R 10). Das erste Foto
 * benachrichtigt wie ein neuer Beitrag (F-416).
 */
export async function uploadPostPhoto(request: Request, env: Env, postId: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const post = SHARE_ID_RE.test(postId)
    ? await env.DB.prepare(
        `SELECT p.id, p.author_id, p.kind, p.channel_kind, p.channel_id, p.visibility, g.locked_at, (SELECT COUNT(*) FROM photos WHERE post_id = p.id) AS n
         FROM posts p LEFT JOIN groups g ON g.id = p.group_id WHERE p.id = ?`,
      )
        .bind(postId)
        .first<GalleryPostRow>()
    : null;
  if (!post || post.author_id !== user.id || post.kind !== 'gallery' || post.locked_at) throw NOT_FOUND();
  const { perPost, freeBytes } = GALLERY_LIMITS;
  if (post.n >= perPost) throw new HttpError(409, 'post_full', `Höchstens ${perPost} Fotos je Beitrag.`);

  const now = Date.now();
  const usage = await supportStatus(env, user.id, now);
  const used = await monthUsed(env, user.id, now);
  const v = galleryVerdict(usage.supporter, used);
  if (v !== 'ok') throw new HttpError(v === 'quota' ? 409 : 402, v, galleryLimitMessage(v, supportConfigured(env)));
  const sv = quotaVerdict(usage.supporter, usage.bytesUsed, 1, (l) => l.bytes, usage.sharesFree);
  if (sv !== 'ok') throw storageQuotaError(env, usage, sv);
  let remaining = usage.bytesMax - usage.bytesUsed;
  if (!usage.supporter) {
    const gallery = (await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM photos WHERE user_id = ? AND post_id IS NOT NULL').bind(user.id).first<{ b: number }>())?.b ?? 0;
    if (gallery >= freeBytes) {
      throw new HttpError(
        402,
        'supporter_required',
        `Kostenlos stehen dir ${fmtMB(freeBytes)} für Fotos in Beiträgen zur Verfügung – lösche ältere Beiträge mit Fotos${supportConfigured(env) ? ' oder unterstütze Sail Explorer' : ''}.`,
      );
    }
    remaining = Math.min(remaining, freeBytes - gallery);
  }
  checkBrake(await currentBrake(env), usage.supporter, 'Fotos');

  const { meta, thumb, full, info, size } = await readPhotoBody(request, remaining);
  const id = randomId();
  const opts = { httpMetadata: { contentType: info.format === 'jpeg' ? 'image/jpeg' : 'image/webp' }, customMetadata: { owner: user.id, post: post.id } };
  await env.TRACKS.put(photoKey(post.id, id, info.format, false), full, opts);
  await env.TRACKS.put(photoKey(post.id, id, info.format, true), thumb, opts);
  const keys = photoKeys({ id, share_id: null, post_id: post.id, format: info.format });
  const max = GALLERY_LIMITS.perMonth[usage.supporter ? 'supporter' : 'free'];
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO photos (id, share_id, post_id, user_id, visibility, caption, taken_at, lat, lon, placement, width, height, format, bytes, created_at)
       SELECT ?1, NULL, ?2, ?3, 'public', ?4, ?5, NULL, NULL, 'none', ?6, ?7, ?8, ?9, ?10
       WHERE (SELECT COUNT(*) FROM photos WHERE post_id = ?2) < ?11 AND (SELECT COUNT(*) FROM photo_log WHERE user_id = ?3 AND created_at >= ?12) < ?13`,
    ).bind(id, post.id, user.id, meta.caption, meta.takenAt, info.width, info.height, info.format, size, now, perPost, monthStart(now), max),
    env.DB.prepare('INSERT INTO photo_log (user_id, created_at) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM photos WHERE id = ?3)').bind(user.id, now, id),
    addPhotoStmt(env, id),
  ]).catch(async (err: unknown) => {
    // z. B. Beitrag parallel gelöscht (Fremdschlüssel): keine Zeile – also auch keine Dateien
    if (!(await env.DB.prepare('SELECT 1 AS x FROM photos WHERE id = ?').bind(id).first())) await deleteKeys(env, keys);
    throw err;
  });
  if (!ins.meta.changes) {
    await deleteKeys(env, keys);
    throw new HttpError(409, 'quota', 'Grenze erreicht: zu viele Fotos in diesem Beitrag oder in diesem Monat.');
  }
  if (post.n === 0) {
    const channel = { kind: post.channel_kind, id: post.channel_kind === 'user' ? post.author_id : post.channel_id };
    await notifyPost(env, { id: post.id, authorId: post.author_id, kind: 'gallery', channel, visibility: post.visibility });
  }
  const photo: PostPhoto = { id, width: info.width, height: info.height, caption: meta.caption, takenAt: meta.takenAt };
  return json({ photo }, { status: 201 });
}

/**
 * Nächtlich (F-494): Galerie-Beiträge ohne ein einziges Foto, älter als 24 h (Hochladen abgebrochen) – über den einen
 * Löschpfad. Liefert die IDs; der Aufrufer löscht mit removePost (kein Import-Zyklus mit posts.ts).
 */
export async function emptyGalleries(env: Env, now: number, limit = 200): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id FROM posts p WHERE p.kind = 'gallery' AND p.created_at < ? AND NOT EXISTS (SELECT 1 FROM photos f WHERE f.post_id = p.id) LIMIT ?`,
  )
    .bind(now - DAY, limit)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** Nächtlich: Monatszähler nach 32 Tagen (länger als jeder Kalendermonat) löschen. */
export const photoLogCleanup = (env: Env, now: number) => env.DB.prepare('DELETE FROM photo_log WHERE created_at < ?').bind(now - 32 * DAY);
