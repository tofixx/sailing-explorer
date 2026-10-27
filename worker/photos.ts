// Fotos (Konzept 3, 6.3, Phase C): Liste, Hochladen, Ändern, Löschen, Ausliefern.
// Nur Eigentümer mit laufendem Unterstützer-Status laden hoch (E3); vorhandene Fotos bleiben nach dem Ende der
// Unterstützung, bis der Törn abläuft (E4). Ein Foto ist nie sichtbarer als sein Törn (F-81).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, countKeyFailure, json, readBodyCapped, readJson, withApiHeaders } from './http';
import { canView, requestKey } from './access';
import { assertActive, isAdmin } from './moderation';
import { ownedShare, visibleShare } from './shares';
import { storageQuotaError, supportConfigured, supportStatus } from './supporter';
import { addPhotoStmt, checkBrake, currentBrake, subtractPhotoStmt } from './storage';
import { inspectImage, type PhotoFormat } from './image';
import { deleteKeys, photoKey, photoKeys } from './photo-keys';
import { recordPhotos } from './activity';
import { deletePhotoReactions } from './reaction-cleanup';
import { SHARE_ID_RE, cleanText, parsePhotoMeta, parsePosition, parseTakenAt } from './validate';
import {
  PHOTO_CAPTION_LENGTH,
  PHOTO_FULL_BYTES,
  PHOTO_FULL_PX,
  PHOTO_THUMB_BYTES,
  PHOTO_THUMB_PX,
  limitsFor,
  photoLimitMessage,
  photoVerdict,
  quotaVerdict,
} from '../src/domain/limits';
import { effectivePhotoVisibility, isPhotoVisibility, type PhotoVisibility, type Visibility } from '../src/domain/visibility';
import type { Placement } from '../src/domain/photo-place';

export interface PhotoRow {
  id: string;
  share_id: string;
  user_id: string;
  visibility: PhotoVisibility;
  caption: string;
  taken_at: number | null;
  lat: number | null;
  lon: number | null;
  placement: Placement;
  width: number;
  height: number;
  format: PhotoFormat;
  bytes: number;
  hidden_at: number | null;
  created_at: number;
}

/** Foto samt den Feldern seines Törns, die über die Sichtbarkeit entscheiden. */
interface PhotoWithShare extends PhotoRow {
  owner_id: string;
  share_visibility: Visibility;
  share_key: string | null;
  share_hidden_at: number | null;
}

/** Höchstens so viele Fotos liefert die Liste (Grenze pro Törn ist 100). */
const LIST_LIMIT = 200;

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Foto gibt es nicht (mehr).');

/** Antwortform: Position und Aufnahmezeit nur so sichtbar wie das Foto; eigene Stufe und Größe nur für den Eigentümer. */
export function photoShape(p: PhotoRow, shareVisibility: Visibility, isOwner: boolean) {
  return {
    id: p.id,
    caption: p.caption,
    takenAt: p.taken_at,
    lat: p.lat,
    lon: p.lon,
    placement: p.placement,
    width: p.width,
    height: p.height,
    createdAt: p.created_at,
    /** effektive Sichtbarkeit (min aus Foto und Törn) */
    effectiveVisibility: effectivePhotoVisibility(p.visibility, shareVisibility),
    visibility: isOwner ? p.visibility : null,
    bytes: isOwner ? p.bytes : null,
    hidden: isOwner ? !!p.hidden_at : false,
  };
}

/** Darf der Betrachter dieses Foto sehen? Eigentümer immer; sonst Törn sichtbar, Foto „wie der Törn“ und nicht ausgeblendet. */
function canViewPhoto(p: PhotoWithShare, viewer: { userId: string | null; key: string | null; admin: boolean }): boolean {
  if (viewer.userId !== null && viewer.userId === p.owner_id) return true;
  const shareOk = canView({ visibility: p.share_visibility, shareKey: p.share_key, hiddenAt: p.share_hidden_at }, { manager: false, key: viewer.key, admin: viewer.admin }, true);
  if (!shareOk || p.visibility !== 'public') return false;
  return !p.hidden_at || viewer.admin;
}

async function loadPhoto(env: Env, id: string): Promise<PhotoWithShare | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  return env.DB.prepare(
    `SELECT p.*, s.user_id AS owner_id, s.visibility AS share_visibility, s.share_key, s.hidden_at AS share_hidden_at
     FROM photos p JOIN shares s ON s.id = p.share_id WHERE p.id = ?`,
  )
    .bind(id)
    .first<PhotoWithShare>();
}

/**
 * Foto, das der Anfragende sehen darf – sonst dieselbe 404 wie „gibt es nicht“ (auch für Meldungen genutzt).
 * Schlüssel per X-Share-Key, bei Bildern zusätzlich ?k=.
 */
export async function visiblePhoto(request: Request, env: Env, id: string, allowQueryKey = false) {
  const row = await loadPhoto(env, id);
  const user = await currentUser(request, env);
  const key = requestKey(request, allowQueryKey);
  if (!row || !canViewPhoto(row, { userId: user?.id ?? null, key, admin: isAdmin(env, user?.id) })) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  return { row, isOwner: !!user && user.id === row.owner_id, user };
}

/** Eigenes Foto (Eigentümer des Törns) – fremde verhalten sich wie nicht existent. */
async function ownedPhoto(request: Request, env: Env, id: string) {
  const user = await requireUser(request, env);
  const row = await loadPhoto(env, id);
  if (!row || row.owner_id !== user.id) throw NOT_FOUND();
  return { row, user };
}

/** Darf der Eigentümer gerade ein Foto hinzufügen? Für die Oberfläche (gleiche Reihenfolge wie beim Hochladen). */
async function uploadState(env: Env, userId: string, inShare: number) {
  const usage = await supportStatus(env, userId);
  const v = photoVerdict(usage.supporter, inShare);
  const bytes = quotaVerdict(usage.supporter, usage.bytesUsed, 1, (l) => l.bytes, usage.sharesFree);
  const reason = v !== 'ok' ? v : bytes !== 'ok' ? 'storage_full' : usage.storagePaused ? 'storage_paused' : null;
  return {
    usage,
    upload: {
      allowed: reason === null,
      reason,
      supporter: usage.supporter,
      used: inShare,
      max: limitsFor('supporter').photosPerShare,
      bytesLeft: Math.max(0, usage.bytesMax - usage.bytesUsed),
      /** Unterstützen ist eingerichtet – die Oberfläche bietet es bei supporter_required an */
      supportOffered: supportConfigured(env),
    },
  };
}

/**
 * GET /api/shares/:id/photos – Fotos eines sichtbaren Törns (Schlüssel wie beim Törn). Andere sehen nur Fotos
 * „wie der Törn“, die nicht ausgeblendet sind; der Eigentümer alle, dazu `upload` (darf er hinzufügen?).
 */
export async function listPhotos(request: Request, env: Env, shareId: string): Promise<Response> {
  const { row, isOwner, user } = await visibleShare(request, env, shareId);
  const admin = isAdmin(env, user?.id);
  const { results } = await env.DB.prepare(
    `SELECT * FROM photos WHERE share_id = ? ${isOwner ? '' : `AND visibility = 'public'${admin ? '' : ' AND hidden_at IS NULL'}`}
     ORDER BY taken_at IS NULL, taken_at, created_at LIMIT ?`,
  )
    .bind(row.id, LIST_LIMIT)
    .all<PhotoRow>();
  const photos = results.map((p) => photoShape(p, row.visibility, isOwner));
  return json({ photos, upload: isOwner && user ? (await uploadState(env, user.id, results.length)).upload : null });
}

/**
 * POST /api/shares/:id/photos – Body = Vorschaubild ‖ Vollbild (WebP oder JPEG, im Browser neu kodiert),
 * Header X-Photo-Thumb-Length (Bytes des Vorschaubilds) und X-Photo-Meta (URI-kodiertes JSON: caption, takenAt,
 * lat, lon, placement, visibility). Reihenfolge wie bei Törns: Unterstützer-Status und Anzahl, Speicher, Notbremse –
 * alles vor dem Einlesen. Der Server lehnt Bilder mit Metadaten, falschem Format oder Übergröße ab.
 */
export async function uploadPhoto(request: Request, env: Env, shareId: string): Promise<Response> {
  const { row: share, user } = await ownedShare(request, env, shareId);
  await assertActive(env, user);

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM photos WHERE share_id = ?').bind(share.id).first<{ n: number }>();
  const inShare = count?.n ?? 0;
  const usage = await supportStatus(env, user.id);
  const v = photoVerdict(usage.supporter, inShare);
  if (v !== 'ok') throw new HttpError(v === 'quota' ? 409 : 402, v, photoLimitMessage(v, supportConfigured(env)));
  const remaining = usage.bytesMax - usage.bytesUsed;
  const sv = quotaVerdict(usage.supporter, usage.bytesUsed, 1, (l) => l.bytes, usage.sharesFree);
  if (sv !== 'ok') throw storageQuotaError(env, usage, sv);
  checkBrake(await currentBrake(env), usage.supporter, 'Fotos');

  if ((request.headers.get('Content-Type') || '') !== 'application/octet-stream') throw new HttpError(415, 'unsupported_media_type', 'Fotos als application/octet-stream senden.');
  const meta = parsePhotoMeta(request.headers.get('X-Photo-Meta'));
  if (!meta) throw new HttpError(400, 'invalid_meta', 'Ungültige Angaben zum Foto.');
  const thumbLen = Number(request.headers.get('X-Photo-Thumb-Length'));
  if (!Number.isInteger(thumbLen) || thumbLen < 16 || thumbLen > PHOTO_THUMB_BYTES) {
    throw new HttpError(400, 'invalid_thumb', `Vorschaubild fehlt oder ist größer als ${PHOTO_THUMB_BYTES / 1024} KB.`);
  }
  const bytes = await readBodyCapped(request, Math.min(PHOTO_THUMB_BYTES + PHOTO_FULL_BYTES, thumbLen + PHOTO_FULL_BYTES, remaining)).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 413) throw new HttpError(413, 'too_large', 'Foto zu groß (max. 1 MB) oder Speicher erschöpft.');
    throw e;
  });
  if (bytes.length <= thumbLen + 16) throw new HttpError(400, 'invalid_image', 'Ungültiges Bild.');
  const thumb = bytes.subarray(0, thumbLen);
  const full = bytes.subarray(thumbLen);

  const ft = inspectImage(full);
  const tt = inspectImage(thumb);
  for (const c of [ft, tt]) {
    if (!c.ok) {
      throw c.code === 'image_metadata'
        ? new HttpError(400, 'image_metadata', 'Das Bild enthält noch Metadaten (EXIF/XMP) – bitte über die App hochladen, sie entfernt sie.')
        : new HttpError(400, 'invalid_image', 'Ungültiges Bild – nur WebP oder JPEG.');
    }
  }
  if (!ft.ok || !tt.ok) throw new HttpError(400, 'invalid_image', 'Ungültiges Bild.');
  const fi = ft.info;
  const ti = tt.info;
  if (fi.format !== ti.format) throw new HttpError(400, 'invalid_image', 'Vollbild und Vorschaubild müssen dasselbe Format haben.');
  if (Math.max(fi.width, fi.height) > PHOTO_FULL_PX || Math.max(ti.width, ti.height) > PHOTO_THUMB_PX) {
    throw new HttpError(400, 'too_large', `Bild zu groß: höchstens ${PHOTO_FULL_PX} px (Vorschau ${PHOTO_THUMB_PX} px) an der langen Kante.`);
  }

  const id = randomId();
  const now = Date.now();
  const contentType = fi.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const opts = { httpMetadata: { contentType }, customMetadata: { owner: user.id, share: share.id } };
  await env.TRACKS.put(photoKey(share.id, id, fi.format, false), full, opts);
  await env.TRACKS.put(photoKey(share.id, id, fi.format, true), thumb, opts);
  // Einfügen nur unter der Grenze pro Törn (parallele Uploads), Zähler nur, wenn die Zeile entstand.
  const max = limitsFor('supporter').photosPerShare;
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO photos (id, share_id, user_id, visibility, caption, taken_at, lat, lon, placement, width, height, format, bytes, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM photos WHERE share_id = ?) < ?`,
    ).bind(id, share.id, user.id, meta.visibility, meta.caption, meta.takenAt, meta.lat, meta.lon, meta.placement, fi.width, fi.height, fi.format, bytes.length, now, share.id, max),
    addPhotoStmt(env, id),
  ]);
  if (!ins.meta.changes) {
    await deleteKeys(env, photoKeys({ share_id: share.id, id, format: fi.format }));
    throw new HttpError(409, 'quota', photoLimitMessage('quota', false));
  }
  const saved = await env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first<PhotoRow>();
  // Neuigkeiten: Fotos „wie der Törn“ an öffentlichen Törns, gebündelt je Törn und Tag (Konzept 11.3).
  if (share.visibility === 'public' && meta.visibility === 'public') await recordPhotos(env, share, 1, now);
  return json({ photo: photoShape(saved!, share.visibility, true) }, { status: 201 });
}

/**
 * PATCH /api/photos/:id – Bildunterschrift, Aufnahmezeit, Position/Platzierung, Sichtbarkeit (Eigentümer).
 * Bearbeiten geht auch nach Ende der Unterstützung (E4) – auch „Nur ich“, das macht nichts sichtbarer.
 */
export async function updatePhoto(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await ownedPhoto(request, env, id);
  const body = await readJson<{ caption?: unknown; visibility?: unknown; lat?: unknown; lon?: unknown; placement?: unknown; takenAt?: unknown }>(request);
  if (body.caption !== undefined) row.caption = cleanText(body.caption, PHOTO_CAPTION_LENGTH);
  if (body.visibility !== undefined) {
    if (!isPhotoVisibility(body.visibility)) throw new HttpError(400, 'invalid_visibility', 'Fotos sind „Wie der Törn“ oder „Nur ich“.');
    row.visibility = body.visibility;
  }
  if (body.lat !== undefined || body.lon !== undefined || body.placement !== undefined) {
    const pos = parsePosition(body.lat ?? null, body.lon ?? null, body.placement);
    if (!pos) throw new HttpError(400, 'invalid_position', 'Ungültige Position.');
    Object.assign(row, pos);
  }
  if (body.takenAt !== undefined) row.taken_at = body.takenAt === null ? null : parseTakenAt(body.takenAt);
  await env.DB.prepare('UPDATE photos SET caption = ?, visibility = ?, lat = ?, lon = ?, placement = ?, taken_at = ? WHERE id = ?')
    .bind(row.caption, row.visibility, row.lat, row.lon, row.placement, row.taken_at, row.id)
    .run();
  return json({ photo: photoShape(row, row.share_visibility, true) });
}

/** Löscht Dateien, Meldungen und Datensatz eines Fotos; der Speicher wird im selben Batch abgezogen. */
export async function removePhoto(env: Env, row: Pick<PhotoRow, 'id' | 'share_id' | 'format'>): Promise<void> {
  await deleteKeys(env, photoKeys(row));
  await env.DB.batch([
    subtractPhotoStmt(env, row.id),
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'photo' AND target_id = ?`).bind(row.id),
    deletePhotoReactions(env, row.id),
    env.DB.prepare('UPDATE comments SET photo_id = NULL WHERE photo_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(row.id),
  ]);
}

/** Löschen über die ID (Admin-Entscheidung zu einer Meldung). */
export async function removePhotoById(env: Env, id: string): Promise<void> {
  const row = await env.DB.prepare('SELECT id, share_id, format FROM photos WHERE id = ?').bind(id).first<Pick<PhotoRow, 'id' | 'share_id' | 'format'>>();
  if (row) await removePhoto(env, row);
}

/** DELETE /api/photos/:id – Eigentümer. */
export async function deletePhoto(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await ownedPhoto(request, env, id);
  await removePhoto(env, row);
  return new Response(null, { status: 204 });
}

/**
 * GET /api/photos/:id?s=t|f[&k=<key>] – Bilddaten (t = Vorschaubild, Standard; f = Vollbild) mit derselben Prüfung
 * wie die Liste. Effektiv öffentlich: 5 min cachebar mit ETag; sonst `private, no-cache`. Immer same-origin.
 */
export async function getPhotoImage(request: Request, env: Env, id: string): Promise<Response> {
  const size = new URL(request.url).searchParams.get('s') ?? 't';
  if (size !== 't' && size !== 'f') throw NOT_FOUND();
  const { row } = await visiblePhoto(request, env, id, true);
  const obj = await env.TRACKS.get(photoKey(row.share_id, row.id, row.format, size === 't'), { onlyIf: request.headers });
  if (!obj) throw NOT_FOUND();
  const effective = effectivePhotoVisibility(row.visibility, row.share_visibility);
  const headers = new Headers({
    'Content-Type': row.format === 'jpeg' ? 'image/jpeg' : 'image/webp',
    ETag: obj.httpEtag,
    'Cache-Control': effective === 'public' && !row.hidden_at && !row.share_hidden_at ? 'public, max-age=300' : 'private, no-cache',
    Vary: 'Cookie',
  });
  return withApiHeaders(new Response('body' in obj ? obj.body : null, { status: 'body' in obj ? 200 : 304, headers }));
}
