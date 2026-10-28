import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { canManageBoat } from './boats';
import { randomId } from './crypto';
import { HttpError, clientIp, countKeyFailure, json, rateLimit, readBodyCapped, readJson, withApiHeaders } from './http';
import { canView, nextShareKey, requestKey } from './access';
import { assertActive, deleteShareReports, isAdmin } from './moderation';
import { deleteKeys, photoKeysForShares, previewKey, shareKey } from './photo-keys';
import { checkShareQuota, checkStorageQuota, checkVisibilityChoice, storageQuotaError, supportStatus, visibilityRequiresSupport } from './supporter';
import { addStorageStmt, checkBrake, currentBrake, replaceImageStmt, subtractShareStmt } from './storage';
import { deleteShareActivity, recordVoyage } from './activity';
import { deleteShareReactions } from './reaction-cleanup';
import { quotaVerdict } from '../src/domain/limits';
import { BOAT_ID_RE, LIMITS, PAYLOAD_PREFIX, SHARE_ID_RE, cleanText, cleanView, isGzip, parseCommentsMode, parseVisibility } from './validate';
import { EXPIRES_SQL } from './expiry-sql';
import { shareContext } from './share-context';
export { EXPIRES_SQL };
import { DEFAULT_VISIBILITY, canChooseVisibility, sharePath, type Visibility } from '../src/domain/visibility';

export interface ShareRow {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  visibility: Visibility;
  /** Schlüssel für „Nur mit Link“; NULL = keiner (Altbestand: /s/<id> genügt, F-91) */
  share_key: string | null;
  view: string;
  size_bytes: number;
  track_count: number;
  created_at: number;
  updated_at: number;
  boat_id: string | null;
  /** veraltet seit 0006: wird nur noch geschrieben (= visibility public), nie gelesen */
  listed?: number;
  dist_nm: number;
  started_at: number | null;
  has_image: number;
  /** Größe des Übersichtsbilds (0008), zählt zum Speicher */
  image_bytes?: number;
  expiry_warned_at?: number | null;
  /** Kommentare: on | off | hidden (0009) */
  comments_mode?: string;
  /** per Meldung oder Admin ausgeblendet (0009) */
  hidden_at?: number | null;
  /** gesperrt (0023, Konzept 18.2): nur Admins */
  locked_at?: number | null;
  /** aus EXPIRES_SQL */
  expires_at?: number | null;
  /** aus dem JOIN mit boats */
  boat_name?: string | null;
  boat_visibility?: string | null;
  boat_hidden_at?: number | null;
}

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Freigabe gibt es nicht (mehr).');

export const SHARE_SELECT = `SELECT s.*, b.name AS boat_name, b.visibility AS boat_visibility, b.hidden_at AS boat_hidden_at, ${EXPIRES_SQL} AS expires_at
  FROM shares s LEFT JOIN boats b ON b.id = s.boat_id`;

export function shareShape(row: ShareRow, isOwner: boolean) {
  // Nicht öffentliche Boote nennt nur der Eigentümer der Freigabe (F-82).
  // Ausgeblendete Boote (Meldung) ebenso.
  const boat = row.boat_id && (isOwner || (row.boat_visibility === 'public' && !row.boat_hidden_at)) ? { id: row.boat_id, name: row.boat_name ?? '' } : null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    visibility: row.visibility,
    // Schlüssel und Teilen-Link sieht nur der Eigentümer (Konzept 2.4).
    shareKey: isOwner ? row.share_key : null,
    link: isOwner ? sharePath('s', row.id, row.visibility, row.share_key) : null,
    view: row.view,
    sizeBytes: row.size_bytes,
    trackCount: row.track_count,
    distNm: row.dist_nm,
    startedAt: row.started_at,
    hasImage: !!row.has_image,
    // nur der Besitzer sieht, wann sein Törn gelöscht wird
    expiresAt: isOwner ? (row.expires_at ?? null) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    boat,
    isOwner,
    // Kommentare & Melden (Phase D)
    commentsMode: row.comments_mode ?? 'on',
    /** nur der Eigentümer erfährt, dass sein Törn bis zur Prüfung ausgeblendet ist */
    hiddenAt: isOwner ? (row.hidden_at ?? null) : null,
  };
}

export async function getShareRow(env: Env, id: string): Promise<ShareRow | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  return env.DB.prepare(`${SHARE_SELECT} WHERE s.id = ?`).bind(id).first<ShareRow>();
}

/**
 * Zugriffsprüfung einer Freigabe (Altbestand „Nur mit Link“ ohne Schlüssel bleibt über die ID erreichbar).
 * Ausgeblendete Törns (Meldung) sehen nur Eigentümer und Admins.
 */
export const canViewShare = (row: ShareRow, manager: boolean, key: string | null, admin = false) =>
  canView({ visibility: row.visibility, shareKey: row.share_key, hiddenAt: row.hidden_at ?? null, lockedAt: row.locked_at ?? null }, { manager, key, admin }, true);

/**
 * Lädt eine Freigabe, die der Anfragende sehen darf (worker/access.ts): öffentlich für alle, „Nur mit Link“ mit
 * Schlüssel (X-Share-Key, bei Bildern ?k=), privat nur für den Besitzer. Alles andere ist dieselbe 404 wie eine
 * unbekannte ID – mit denselben Abfragen.
 */
export async function visibleShare(request: Request, env: Env, id: string, allowQueryKey = false) {
  const row = await getShareRow(env, id);
  const user = await currentUser(request, env);
  const k = requestKey(request, allowQueryKey);
  const isOwner = !!row && !!user && user.id === row.user_id;
  if (!row || !canViewShare(row, isOwner, k, isAdmin(env, user?.id))) {
    await countKeyFailure(env, request, k);
    throw NOT_FOUND();
  }
  return { row, isOwner, user };
}

export async function ownedShare(request: Request, env: Env, id: string) {
  const user = await requireUser(request, env);
  const row = await getShareRow(env, id);
  // Fremde und gesperrte Freigaben verhalten sich wie nicht existent (kein Hinweis auf Existenz).
  if (!row || row.user_id !== user.id || row.locked_at) throw NOT_FOUND();
  return { row, user };
}

/** Ein Boot darf nur zugeordnet werden, wenn man es verwalten darf. */
async function checkBoat(env: Env, userId: string, boatId: unknown): Promise<string | null> {
  if (boatId === null || boatId === '' || boatId === undefined) return null;
  if (typeof boatId !== 'string' || !BOAT_ID_RE.test(boatId) || !(await canManageBoat(env, userId, boatId))) {
    throw new HttpError(400, 'invalid_boat', 'Dieses Boot kannst du nicht zuordnen.');
  }
  return boatId;
}

/**
 * Prüft den gzip-Payload günstig: Magic Bytes und Präfix der entpackten Daten.
 * Vollständig geparst wird erst im Browser des Betrachters (CPU-Limit im Free-Plan);
 * dort gelten die Daten ohnehin als untrusted.
 */
async function checkPayload(bytes: Uint8Array): Promise<void> {
  if (!isGzip(bytes)) throw new HttpError(400, 'invalid_payload', 'Ungültiges Upload-Format.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  let head = '';
  const decoder = new TextDecoder();
  try {
    while (head.length < PAYLOAD_PREFIX.length) {
      const { value, done } = await reader.read();
      if (done) break;
      head += decoder.decode(value, { stream: true });
    }
  } catch {
    throw new HttpError(400, 'invalid_payload', 'Ungültiges Upload-Format.');
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!head.startsWith(PAYLOAD_PREFIX)) throw new HttpError(400, 'invalid_payload', 'Ungültiges Upload-Format.');
}

function decodeHeader(v: string | null): string {
  if (!v) return '';
  try {
    return decodeURIComponent(v);
  } catch {
    return '';
  }
}

/** POST /api/shares – Body: gzip(JSON), Metadaten in Headern. */
export async function createShare(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user); // gesperrte Konten laden nichts hoch (Konzept 4.4)
  await rateLimit(env.UPLOAD_LIMITER, `upload:${user.id}:${clientIp(request)}`);

  const h = request.headers;
  // Sichtbarkeit: fehlt sie, gilt „Öffentlich“ (E1); Unbekanntes wird abgelehnt statt still umgedeutet.
  const rawVisibility = h.get('X-Share-Visibility');
  let visibility = rawVisibility ? parseVisibility(rawVisibility) : DEFAULT_VISIBILITY;
  if (!visibility) throw new HttpError(400, 'invalid_visibility', 'Unbekannte Sichtbarkeit.');
  // Ältere Oberflächen schicken „Öffentlich“ noch als unlisted + X-Share-Listed: 1.
  if (visibility === 'unlisted' && h.get('X-Share-Listed') === '1') visibility = 'public';

  // Kontingent vor dem Einlesen prüfen (Anzahl, kostenlose Freigaben bzw. Unterstützer, Speicher pro Konto inkl.
  // Übersichtsbilder), die globale Notbremse (Konzept 5.2) und die Sichtbarkeit (E1: nicht öffentlich nur mit
  // laufendem Unterstützer-Status).
  const usage = await supportStatus(env, user.id);
  checkShareQuota(env, usage);
  const remaining = checkStorageQuota(env, usage);
  checkBrake(await currentBrake(env), usage.supporter);
  if (!canChooseVisibility(visibility, usage.supporter)) throw visibilityRequiresSupport(env);

  const boatId = await checkBoat(env, user.id, h.get('X-Share-Boat'));

  const bytes = await readBodyCapped(request, Math.min(LIMITS.uploadBytes, remaining)).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 413) throw new HttpError(413, 'too_large', 'Upload zu groß (max. 12 MB komprimiert) oder Kontingent erschöpft.');
    throw e;
  });
  await checkPayload(bytes);

  const now = Date.now();
  const started = Number(h.get('X-Share-Started'));
  const row: ShareRow = {
    id: randomId(),
    user_id: user.id,
    title: cleanText(decodeHeader(h.get('X-Share-Title')), LIMITS.titleLength) || 'Törn',
    summary: cleanText(decodeHeader(h.get('X-Share-Summary')), LIMITS.summaryLength),
    visibility,
    share_key: nextShareKey(null, visibility, null, false, true),
    view: cleanView(decodeHeader(h.get('X-Share-View'))),
    size_bytes: bytes.length,
    track_count: Math.max(1, Math.min(LIMITS.tracksPerShare, Number(h.get('X-Share-Tracks')) || 1)),
    created_at: now,
    updated_at: now,
    boat_id: boatId,
    // Angaben des Clients nur plausibilisiert übernehmen – sie dienen nur der Anzeige.
    dist_nm: Math.max(0, Math.min(100_000, Number(h.get('X-Share-Distance')) || 0)),
    started_at: Number.isFinite(started) && started > 0 && started < now + 86_400_000 ? started : null,
    has_image: 0,
  };

  await env.TRACKS.put(shareKey(row.id), bytes, {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
    customMetadata: { owner: user.id },
  });
  // Scheitert D1 nach dem Upload (z. B. Konto parallel gelöscht), bleibt sonst eine Datei ohne Zeile zurück.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO shares (id, user_id, title, summary, visibility, share_key, view, size_bytes, track_count, created_at, updated_at, boat_id, listed, dist_nm, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id, row.user_id, row.title, row.summary, row.visibility, row.share_key, row.view, row.size_bytes, row.track_count, now, now, row.boat_id,
      row.visibility === 'public' ? 1 : 0, row.dist_nm, row.started_at,
    ),
    addStorageStmt(env, row.size_bytes),
  ]).catch(async (err: unknown) => {
    // nur aufräumen, wenn die Zeile wirklich fehlt (ein Timeout kann trotz Schreiben einen Fehler melden)
    if (!(await env.DB.prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(row.id).first())) await deleteKeys(env, [shareKey(row.id)]);
    throw err;
  });
  const saved = await getShareRow(env, row.id);
  // Neuigkeiten (Konzept 11.3): nur öffentliche Törns kommen ins Log.
  if (row.visibility === 'public') await recordVoyage(env, row, now);
  return json({ share: shareShape(saved ?? row, true) }, { status: 201 });
}

/** GET /api/shares – eigene Freigaben. */
export async function listShares(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(`${SHARE_SELECT} WHERE s.user_id = ? AND s.locked_at IS NULL ORDER BY s.created_at DESC`).bind(user.id).all<ShareRow>();
  return json({ shares: results.map((r) => shareShape(r, true)) });
}

/** Metadaten der Einzelansicht: dazu Eigentümer-Profil und Gruppen, soweit sichtbar (F-228). */
const shareDetail = async (env: Env, row: ShareRow, isOwner: boolean, viewerId: string | null) => ({
  ...shareShape(row, isOwner),
  ...(await shareContext(env, row, viewerId)),
});

/** GET /api/shares/:id – Metadaten. */
export async function getShareMeta(request: Request, env: Env, id: string): Promise<Response> {
  const { row, isOwner, user } = await visibleShare(request, env, id);
  return json({ share: await shareDetail(env, row, isOwner, user?.id ?? null) });
}

/** GET /api/shares/:id/data – gzip-Payload, der Browser entpackt selbst. */
export async function getShareData(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await visibleShare(request, env, id);
  const obj = await env.TRACKS.get(shareKey(row.id), { onlyIf: request.headers });
  if (!obj) throw NOT_FOUND();
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Encoding': 'gzip',
    ETag: obj.httpEtag,
    // Revalidieren statt cachen: gelöschte/privat gestellte Freigaben und erneuerte Links greifen sofort.
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie, X-Share-Key',
  });
  if (!('body' in obj)) return withApiHeaders(new Response(null, { status: 304, headers }));
  return withApiHeaders(new Response(obj.body, { headers, encodeBody: 'manual' }));
}

/** PATCH /api/shares/:id – Titel, Sichtbarkeit, Link erneuern (rotateKey), Boot, gespeicherte Ansicht. */
export async function updateShare(request: Request, env: Env, id: string): Promise<Response> {
  const { row, user } = await ownedShare(request, env, id);
  const body = await readJson<{ title?: unknown; visibility?: unknown; view?: unknown; boatId?: unknown; rotateKey?: unknown; commentsMode?: unknown }>(request);
  const previous = row.visibility;
  if (body.title !== undefined) {
    const t = cleanText(body.title, LIMITS.titleLength);
    if (!t) throw new HttpError(400, 'invalid_title', 'Titel darf nicht leer sein.');
    row.title = t;
  }
  if (body.visibility !== undefined) {
    const v = parseVisibility(body.visibility);
    if (!v) throw new HttpError(400, 'invalid_visibility', 'Unbekannte Sichtbarkeit.');
    await checkVisibilityChoice(env, user.id, v, previous);
    row.visibility = v;
  }
  row.share_key = nextShareKey(previous, row.visibility, row.share_key, body.rotateKey === true, true);
  if (body.boatId !== undefined) row.boat_id = await checkBoat(env, user.id, body.boatId);
  if (body.view !== undefined) row.view = cleanView(body.view);
  // Kommentare an/aus/ausgeblendet (Konzept 4.1) – gesperrte Konten dürfen weiter abschalten.
  if (body.commentsMode !== undefined) {
    const mode = parseCommentsMode(body.commentsMode);
    if (!mode) throw new HttpError(400, 'invalid_comments_mode', 'Unbekannte Einstellung für Kommentare.');
    row.comments_mode = mode;
  }
  row.updated_at = Date.now();
  await env.DB.prepare('UPDATE shares SET title = ?, visibility = ?, share_key = ?, listed = ?, boat_id = ?, view = ?, comments_mode = ?, updated_at = ? WHERE id = ?')
    .bind(row.title, row.visibility, row.share_key, row.visibility === 'public' ? 1 : 0, row.boat_id, row.view, row.comments_mode ?? 'on', row.updated_at, row.id)
    .run();
  const saved = await getShareRow(env, row.id);
  // Erst öffentlich geschaltet: jetzt (einmal je Törn) in die Neuigkeiten.
  if (previous !== 'public' && row.visibility === 'public') await recordVoyage(env, row, row.updated_at);
  // mit Kontext wie GET: die Törn-Ansicht übernimmt die Antwort (Gruppen folgen der neuen Sichtbarkeit)
  return json({ share: await shareDetail(env, saved ?? row, true, user.id) });
}

export async function deleteShare(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await ownedShare(request, env, id);
  await removeShare(env, row.id);
  return new Response(null, { status: 204 });
}

/** Löscht Datei, Vorschaubild, Meldungen und Datensatz eines Törns (Kommentare, Crew, Einladungen per CASCADE). */
export async function removeShare(env: Env, id: string): Promise<void> {
  // Dateien zuerst (Track, Übersichtsbild, Fotos aus der D1-Liste): scheitert danach D1, bleibt nur eine Zeile ohne
  // Datei zurück statt einer Datei, die niemand mehr findet. Die Foto-Zeilen fallen per ON DELETE CASCADE.
  await deleteKeys(env, [shareKey(id), previewKey(id), ...(await photoKeysForShares(env, [id]))]);
  // Speicher vom globalen Zähler abziehen (vor dem Löschen der Zeile), Meldungen entfernen, Törn löschen – ein Batch.
  await env.DB.batch([subtractShareStmt(env, id), deleteShareReports(env, id), deleteShareReactions(env, id), deleteShareActivity(env, id), env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(id)]);
}

/**
 * Öffentliche Törns für Profil- und Bootsseiten (F-83) – nie „Nur mit Link“ oder „Nur ich“, auch nicht für Verwalter:
 * ein Schlüssel öffnet genau ein Objekt, ein Boots- oder Profil-Link also keine anderen Törns (Konzept 1.2).
 */
export async function publicShares(env: Env, where: 'user' | 'boat', id: string): Promise<ReturnType<typeof shareShape>[]> {
  const col = where === 'user' ? 's.user_id' : 's.boat_id';
  const { results } = await env.DB.prepare(
    `${SHARE_SELECT} WHERE ${col} = ? AND s.visibility = 'public' AND s.hidden_at IS NULL ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT 200`,
  )
    .bind(id)
    .all<ShareRow>();
  return results.map((r) => shareShape(r, false));
}

/** Öffentliche Törns, auf denen das Konto als Crew eingetragen ist (Profil „Mitgesegelt“, Konzept 10.6). */
export async function crewShares(env: Env, userId: string): Promise<ReturnType<typeof shareShape>[]> {
  const { results } = await env.DB.prepare(
    `${SHARE_SELECT} JOIN share_crew c ON c.share_id = s.id
     WHERE c.user_id = ? AND s.visibility = 'public' AND s.hidden_at IS NULL ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT 200`,
  )
    .bind(userId)
    .all<ShareRow>();
  return results.map((r) => shareShape(r, false));
}

/** JPEG: beginnt mit FF D8 FF. */
function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/**
 * PUT /api/shares/:id/image – Übersichtsbild (JPEG) des Besitzers. Zählt zum Speicher (image_bytes): Ein Bild,
 * das den Speicher über die Grenze der Stufe hebt, wird abgelehnt – außer es ersetzt ein mindestens gleich großes.
 * Die Notbremse gilt hier nicht: das Bild gehört zu einem schon angenommenen Törn und ist klein.
 */
export async function putShareImage(request: Request, env: Env, id: string): Promise<Response> {
  const { row, user } = await ownedShare(request, env, id);
  await assertActive(env, user);
  if ((request.headers.get('Content-Type') || '') !== 'image/jpeg') throw new HttpError(415, 'unsupported_media_type', 'Nur JPEG-Bilder.');
  const bytes = await readBodyCapped(request, LIMITS.imageBytes);
  if (!isJpeg(bytes)) throw new HttpError(400, 'invalid_image', 'Ungültiges Bild.');
  const previous = row.image_bytes ?? 0;
  const delta = bytes.length - previous;
  if (delta > 0) {
    const usage = await supportStatus(env, user.id);
    const v = quotaVerdict(usage.supporter, usage.bytesUsed, delta, (l) => l.bytes, usage.sharesFree);
    if (v !== 'ok') throw storageQuotaError(env, usage, v);
  }
  await env.TRACKS.put(previewKey(row.id), bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { owner: row.user_id } });
  const [, upd] = await env.DB.batch([
    replaceImageStmt(env, row.id, bytes.length),
    env.DB.prepare('UPDATE shares SET has_image = 1, image_bytes = ?, updated_at = ? WHERE id = ?').bind(bytes.length, Date.now(), row.id),
  ]);
  // Törn inzwischen gelöscht: das Bild hätte keine Zeile mehr – sofort wieder entfernen.
  if (!upd.meta.changes) {
    await deleteKeys(env, [previewKey(row.id)]);
    throw NOT_FOUND();
  }
  return new Response(null, { status: 204 });
}

/** GET /api/shares/:id/image[?k=] – Vorschaubild; gleiche Sichtbarkeit wie die Freigabe (Schlüssel als ?k=). */
export async function getShareImage(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await visibleShare(request, env, id, true);
  if (!row.has_image) throw NOT_FOUND();
  const obj = await env.TRACKS.get(previewKey(row.id), { onlyIf: request.headers });
  if (!obj) throw NOT_FOUND();
  const headers = new Headers({
    'Content-Type': 'image/jpeg',
    ETag: obj.httpEtag,
    // Öffentliche Bilder dürfen Messenger kurz cachen; „Nur mit Link“ und „Nur ich“ nie (erneuerte Links greifen sofort).
    'Cache-Control': row.visibility === 'public' ? 'public, max-age=300' : 'private, no-cache',
  });
  const res = withApiHeaders(new Response('body' in obj ? obj.body : null, { status: 'body' in obj ? 200 : 304, headers }));
  // Messenger-Crawler laden das Bild von fremden Seiten (auch über den Schlüssel-Link); private Bilder bleiben same-origin.
  if (row.visibility !== 'private') res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return res;
}
