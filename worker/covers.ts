// Titelbilder (Konzept 13.2): ein Bild je Profil, Boot und Verein/Team. Für alle Konten (E6), nicht im Kontingent
// des Kontos, aber im globalen Speicherzähler (Notbremse). Sichtbar wie das Objekt selbst; die Version steckt in
// R2-Key und URL, ein Austausch erzeugt eine neue Adresse.
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, countKeyFailure, json, readBodyCapped, readJson, withApiHeaders } from './http';
import { canView, requestKey } from './access';
import { assertActive, isAdmin } from './moderation';
import { roleFor } from './boats';
import { canViewGroup, loadGroup, roleIn } from './groups';
import { isSupporter } from './supporter';
import { STORAGE_COUNTER, checkBrake, currentBrake } from './storage';
import { inspectImage } from './image';
import { deleteKeys } from './photo-keys';
import { normalizeHandle } from './validate';
import { COVER_BYTES, COVER_HEIGHT, COVER_WIDTH } from '../src/domain/limits';
import { canManageGroup } from '../src/domain/groups';
import { COVER_FOCUS_DEFAULT, parseFocusY } from '../src/domain/cover';
import type { Visibility } from '../src/domain/visibility';

/** u = Profil (öffentliche ID: Profiladresse), b = Boot, g = Verein/Team (öffentliche ID: Objekt-ID). */
export type CoverKind = 'u' | 'b' | 'g';
export const isCoverKind = (k: unknown): k is CoverKind => k === 'u' || k === 'b' || k === 'g';

export interface CoverRow {
  kind: CoverKind;
  object_id: string;
  ver: string;
  format: string;
  bytes: number;
  /** sichtbarer Ausschnitt: vertikale Fokus-Position in Prozent (src/domain/cover.ts) */
  focus_y: number;
  user_id: string | null;
  created_at: number;
}

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Titelbild gibt es nicht (mehr).');
const VER_RE = /^[A-Za-z0-9]{6,16}$/;

export const coverKey = (c: Pick<CoverRow, 'kind' | 'object_id' | 'ver' | 'format'>) => `covers/${c.kind}/${c.object_id}/${c.ver}.${c.format}`;

/**
 * Adresse des Titelbilds für die Antwort einer Seite. Bei „Nur mit Link“ hängt der Schlüssel an, mit dem die Seite
 * geöffnet wurde (sonst lädt das <img> nicht); Verwalter brauchen keinen (Cookie).
 */
export function coverUrl(kind: CoverKind, publicId: string, c: Pick<CoverRow, 'ver'> | null, key?: string | null): string | null {
  if (!c) return null;
  return `/api/covers/${kind}/${encodeURIComponent(publicId)}/${c.ver}${key ? `?k=${encodeURIComponent(key)}` : ''}`;
}

/** Titelbild-Felder einer Seiten-Antwort: Adresse (siehe coverUrl) und Ausschnitt. */
export function pageCover(kind: CoverKind, publicId: string, c: CoverRow | null, key?: string | null): { cover: string | null; coverY: number } {
  return { cover: coverUrl(kind, publicId, c, key), coverY: c?.focus_y ?? COVER_FOCUS_DEFAULT };
}

export async function loadCover(env: Env, kind: CoverKind, objectId: string): Promise<CoverRow | null> {
  return env.DB.prepare('SELECT * FROM covers WHERE kind = ? AND object_id = ?').bind(kind, objectId).first<CoverRow>();
}

interface Target {
  objectId: string;
  /** darf das Bild sehen (Sichtbarkeit des Objekts) */
  canSee: boolean;
  /** darf das Bild ändern */
  manager: boolean;
  /** öffentlich und nicht ausgeblendet – dann cachebar */
  open: boolean;
}

/** Objekt zu Art und öffentlicher ID samt Rechten des Anfragenden – null, wenn es das Objekt nicht gibt. */
async function target(env: Env, kind: CoverKind, publicId: string, userId: string | null, key: string | null): Promise<Target | null> {
  const admin = isAdmin(env, userId);
  if (kind === 'u') {
    const handle = normalizeHandle(publicId);
    const p = handle
      ? await env.DB.prepare('SELECT user_id, visibility, share_key, hidden_at FROM profiles WHERE handle = ?')
          .bind(handle)
          .first<{ user_id: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>()
      : null;
    if (!p) return null;
    const manager = userId === p.user_id;
    return {
      objectId: p.user_id,
      manager,
      canSee: canView({ visibility: p.visibility, shareKey: p.share_key, hiddenAt: p.hidden_at }, { manager, key, admin }),
      open: p.visibility === 'public' && !p.hidden_at,
    };
  }
  if (kind === 'b') {
    const b = /^[A-Za-z0-9]{1,40}$/.test(publicId)
      ? await env.DB.prepare('SELECT id, visibility, share_key, hidden_at FROM boats WHERE id = ?')
          .bind(publicId)
          .first<{ id: string; visibility: Visibility; share_key: string | null; hidden_at: number | null }>()
      : null;
    if (!b) return null;
    const manager = !!userId && (await roleFor(env, userId, b.id)) !== null;
    return {
      objectId: b.id,
      manager,
      canSee: canView({ visibility: b.visibility, shareKey: b.share_key, hiddenAt: b.hidden_at }, { manager, key, admin }),
      open: b.visibility === 'public' && !b.hidden_at,
    };
  }
  const g = await loadGroup(env, publicId);
  if (!g) return null;
  const role = await roleIn(env, userId, g.id);
  return { objectId: g.id, manager: canManageGroup(role), canSee: canViewGroup(g, role, key, admin), open: g.visibility === 'public' && !g.hidden_at };
}

/** GET /api/covers/:kind/:id/:ver[?k=] – Bilddaten, nur so sichtbar wie das Objekt. */
export async function getCover(request: Request, env: Env, kind: string, publicId: string, ver: string): Promise<Response> {
  if (!isCoverKind(kind) || !VER_RE.test(ver)) throw NOT_FOUND();
  const user = await currentUser(request, env);
  const key = requestKey(request, true);
  const t = await target(env, kind, publicId, user?.id ?? null, key);
  if (!t || !t.canSee) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  const c = await loadCover(env, kind, t.objectId);
  if (!c || c.ver !== ver) throw NOT_FOUND();
  const obj = await env.TRACKS.get(coverKey(c), { onlyIf: request.headers });
  if (!obj) throw NOT_FOUND();
  const headers = new Headers({
    'Content-Type': c.format === 'jpeg' ? 'image/jpeg' : 'image/webp',
    ETag: obj.httpEtag,
    // Die Version steht in der Adresse – öffentlich daher lange cachebar.
    'Cache-Control': t.open ? 'public, max-age=86400' : 'private, no-cache',
    Vary: 'Cookie',
  });
  return withApiHeaders(new Response('body' in obj ? obj.body : null, { status: 'body' in obj ? 200 : 304, headers }));
}

/** Verwalter des Objekts – sonst 404 (fremde Objekte verraten nichts). */
async function managedTarget(request: Request, env: Env, kind: string, publicId: string) {
  if (!isCoverKind(kind)) throw NOT_FOUND();
  const user = await requireUser(request, env);
  const t = await target(env, kind, publicId, user.id, null);
  if (!t || !t.manager) throw NOT_FOUND();
  return { user, t, kind };
}

/**
 * PUT /api/covers/:kind/:id – Body = Bild (WebP oder JPEG, im Browser auf 3:1 … 3:2 zugeschnitten und neu kodiert,
 * ohne Metadaten). Ersetzt ein vorhandenes Titelbild samt Ausschnitt (wieder mittig); der Zähler verschiebt sich um
 * die Differenz.
 */
export async function putCover(request: Request, env: Env, kind: string, publicId: string): Promise<Response> {
  const { user, t, kind: k } = await managedTarget(request, env, kind, publicId);
  await assertActive(env, user);
  checkBrake(await currentBrake(env), await isSupporter(env, user.id), 'Titelbilder');
  if ((request.headers.get('Content-Type') || '') !== 'application/octet-stream') throw new HttpError(415, 'unsupported_media_type', 'Bilder als application/octet-stream senden.');
  const bytes = await readBodyCapped(request, COVER_BYTES).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 413) throw new HttpError(413, 'too_large', `Titelbild zu groß (höchstens ${COVER_BYTES / 1024} KB).`);
    throw e;
  });
  const check = inspectImage(bytes);
  if (!check.ok) {
    throw check.code === 'image_metadata'
      ? new HttpError(400, 'image_metadata', 'Das Bild enthält noch Metadaten (EXIF/XMP) – bitte über die App hochladen, sie entfernt sie.')
      : new HttpError(400, 'invalid_image', 'Ungültiges Bild – nur WebP oder JPEG.');
  }
  const { format, width, height } = check.info;
  if (width > COVER_WIDTH || height > COVER_HEIGHT) throw new HttpError(400, 'too_large', `Titelbild höchstens ${COVER_WIDTH} × ${COVER_HEIGHT} px.`);
  // Querformat (der Browser liefert 3:1 … 3:2): ein Hochformat zeigte im Banner nur einen schmalen Streifen
  if (height > width) throw new HttpError(400, 'invalid_image', 'Titelbild bitte im Querformat.');

  const old = await loadCover(env, k, t.objectId);
  const c: CoverRow = { kind: k, object_id: t.objectId, ver: randomId(10), format, bytes: bytes.length, focus_y: COVER_FOCUS_DEFAULT, user_id: user.id, created_at: Date.now() };
  await env.TRACKS.put(coverKey(c), bytes, { httpMetadata: { contentType: format === 'jpeg' ? 'image/jpeg' : 'image/webp' }, customMetadata: { owner: user.id } });
  await env.DB.batch([
    env.DB.prepare('UPDATE counters SET value = MAX(0, value + ?1 - COALESCE((SELECT bytes FROM covers WHERE kind = ?2 AND object_id = ?3), 0)) WHERE name = ?4').bind(
      c.bytes, c.kind, c.object_id, STORAGE_COUNTER,
    ),
    env.DB.prepare(
      `INSERT INTO covers (kind, object_id, ver, format, bytes, focus_y, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(kind, object_id) DO UPDATE SET ver = ?3, format = ?4, bytes = ?5, focus_y = ?6, user_id = ?7, created_at = ?8`,
    ).bind(c.kind, c.object_id, c.ver, c.format, c.bytes, c.focus_y, c.user_id, c.created_at),
  ]);
  // Paralleles Ersetzen: hat ein anderer Upload gewonnen, ist die eigene Datei verwaist – sofort entfernen.
  const now = await loadCover(env, k, t.objectId);
  if (now?.ver !== c.ver) await deleteKeys(env, [coverKey(c)]);
  if (old && old.ver !== now?.ver) await deleteKeys(env, [coverKey(old)]);
  // das tatsächlich gespeicherte Bild melden (bei parallelem Ersetzen das des anderen Uploads)
  return json(pageCover(k, publicId, now ?? c), { status: 201 });
}

/** PATCH /api/covers/:kind/:id { focusY } – nur den Ausschnitt ändern, ohne neues Bild (Verwalter). */
export async function patchCover(request: Request, env: Env, kind: string, publicId: string): Promise<Response> {
  const { user, t, kind: k } = await managedTarget(request, env, kind, publicId);
  await assertActive(env, user);
  const focusY = parseFocusY((await readJson<{ focusY?: unknown }>(request)).focusY);
  if (focusY === null) throw new HttpError(400, 'invalid_focus', 'Ausschnitt als ganze Prozent 0 … 100 angeben.');
  const res = await env.DB.prepare('UPDATE covers SET focus_y = ? WHERE kind = ? AND object_id = ?').bind(focusY, k, t.objectId).run();
  if (!res.meta.changes) throw NOT_FOUND();
  return json({ coverY: focusY });
}

/** Löscht Datei, Zeile und Zähleranteil eines Titelbilds. */
async function removeCover(env: Env, c: CoverRow): Promise<void> {
  await deleteKeys(env, [coverKey(c)]);
  await env.DB.batch([
    // nur abziehen, was diese Zeile wirklich belegt (bei parallelem Ersetzen gibt es sie nicht mehr)
    env.DB.prepare('UPDATE counters SET value = MAX(0, value - COALESCE((SELECT bytes FROM covers WHERE kind = ?1 AND object_id = ?2 AND ver = ?3), 0)) WHERE name = ?4').bind(
      c.kind, c.object_id, c.ver, STORAGE_COUNTER,
    ),
    env.DB.prepare('DELETE FROM covers WHERE kind = ? AND object_id = ? AND ver = ?').bind(c.kind, c.object_id, c.ver),
  ]);
}

/**
 * Titelbild eines Objekts sofort entfernen – beim Löschen von Profil (Moderation, Konto), Boot und Gruppe. Der
 * nächtliche Sweep bleibt als Netz für Kaskaden; so kann ein gelöschtes Bild aber nicht mit einem neuen Profil zurückkommen.
 */
export async function removeCoverOf(env: Env, kind: CoverKind, objectId: string): Promise<void> {
  const c = await loadCover(env, kind, objectId);
  if (c) await removeCover(env, c);
}

/** DELETE /api/covers/:kind/:id – Verwalter. */
export async function deleteCover(request: Request, env: Env, kind: string, publicId: string): Promise<Response> {
  const { t, kind: k } = await managedTarget(request, env, kind, publicId);
  await removeCoverOf(env, k, t.objectId);
  return new Response(null, { status: 204 });
}

/**
 * Nächtlich: Netz für Titelbilder, deren Objekt ohne Löschpfad verschwand (Kaskaden). Profil, Boot, Gruppe und Konto
 * entfernen ihr Bild selbst sofort (removeCoverOf). Liefert die Anzahl.
 */
export async function sweepOrphanCovers(env: Env, limit = 200): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM covers c WHERE
       (c.kind = 'u' AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = c.object_id))
       OR (c.kind = 'b' AND NOT EXISTS (SELECT 1 FROM boats b WHERE b.id = c.object_id))
       OR (c.kind = 'g' AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = c.object_id))
     LIMIT ?`,
  )
    .bind(limit)
    .all<CoverRow>();
  for (const c of results) await removeCover(env, c);
  return results.length;
}
