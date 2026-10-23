import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { canManageBoat } from './boats';
import { randomId } from './crypto';
import { HttpError, clientIp, json, rateLimit, readBodyCapped, readJson, withApiHeaders } from './http';
import { BOAT_ID_RE, LIMITS, PAYLOAD_PREFIX, SHARE_ID_RE, cleanText, cleanView, isGzip, parseVisibility } from './validate';

export interface ShareRow {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  visibility: 'unlisted' | 'private';
  view: string;
  size_bytes: number;
  track_count: number;
  created_at: number;
  updated_at: number;
  boat_id: string | null;
  listed: number;
  dist_nm: number;
  started_at: number | null;
  /** aus dem JOIN mit boats */
  boat_name?: string | null;
  boat_visibility?: string | null;
}

const key = (id: string) => `shares/${id}`;
const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Freigabe gibt es nicht (mehr).');

export const SHARE_SELECT = `SELECT s.*, b.name AS boat_name, b.visibility AS boat_visibility
  FROM shares s LEFT JOIN boats b ON b.id = s.boat_id`;

export function shareShape(row: ShareRow, isOwner: boolean) {
  // Private Boote sieht nur der Eigentümer der Freigabe.
  const boat = row.boat_id && (isOwner || row.boat_visibility === 'public') ? { id: row.boat_id, name: row.boat_name ?? '' } : null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    visibility: row.visibility,
    listed: !!row.listed,
    view: row.view,
    sizeBytes: row.size_bytes,
    trackCount: row.track_count,
    distNm: row.dist_nm,
    startedAt: row.started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    boat,
    isOwner,
  };
}

export async function getShareRow(env: Env, id: string): Promise<ShareRow | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  return env.DB.prepare(`${SHARE_SELECT} WHERE s.id = ?`).bind(id).first<ShareRow>();
}

/** Lädt eine Freigabe, die der Anfragende sehen darf – private nur für den Besitzer. */
async function visibleShare(request: Request, env: Env, id: string) {
  const row = await getShareRow(env, id);
  if (!row) throw NOT_FOUND();
  const user = await currentUser(request, env);
  const isOwner = !!user && user.id === row.user_id;
  if (row.visibility === 'private' && !isOwner) throw NOT_FOUND();
  return { row, isOwner };
}

async function ownedShare(request: Request, env: Env, id: string) {
  const user = await requireUser(request, env);
  const row = await getShareRow(env, id);
  // Fremde Freigaben verhalten sich wie nicht existent (kein Hinweis auf Existenz).
  if (!row || row.user_id !== user.id) throw NOT_FOUND();
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
  await rateLimit(env.UPLOAD_LIMITER, `upload:${user.id}:${clientIp(request)}`);

  // Kontingent vor dem Einlesen prüfen (Anzahl und Gesamtgröße pro Konto).
  const usage = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM shares WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number; bytes: number }>();
  if ((usage?.n ?? 0) >= LIMITS.sharesPerUser) throw new HttpError(409, 'quota', 'Maximale Anzahl an Freigaben erreicht.');
  const remaining = LIMITS.bytesPerUser - (usage?.bytes ?? 0);
  if (remaining <= 0) throw new HttpError(409, 'quota', 'Speicherkontingent erschöpft – bitte alte Freigaben löschen.');

  const h = request.headers;
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
    visibility: parseVisibility(h.get('X-Share-Visibility')) ?? 'unlisted',
    view: cleanView(decodeHeader(h.get('X-Share-View'))),
    size_bytes: bytes.length,
    track_count: Math.max(1, Math.min(LIMITS.tracksPerShare, Number(h.get('X-Share-Tracks')) || 1)),
    created_at: now,
    updated_at: now,
    boat_id: boatId,
    listed: h.get('X-Share-Listed') === '1' ? 1 : 0,
    // Angaben des Clients nur plausibilisiert übernehmen – sie dienen nur der Anzeige.
    dist_nm: Math.max(0, Math.min(100_000, Number(h.get('X-Share-Distance')) || 0)),
    started_at: Number.isFinite(started) && started > 0 && started < now + 86_400_000 ? started : null,
  };

  await env.TRACKS.put(key(row.id), bytes, {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
    customMetadata: { owner: user.id },
  });
  await env.DB.prepare(
    `INSERT INTO shares (id, user_id, title, summary, visibility, view, size_bytes, track_count, created_at, updated_at, boat_id, listed, dist_nm, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.user_id, row.title, row.summary, row.visibility, row.view, row.size_bytes, row.track_count, now, now, row.boat_id, row.listed, row.dist_nm, row.started_at)
    .run();
  const saved = await getShareRow(env, row.id);
  return json({ share: shareShape(saved ?? row, true) }, { status: 201 });
}

/** GET /api/shares – eigene Freigaben. */
export async function listShares(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(`${SHARE_SELECT} WHERE s.user_id = ? ORDER BY s.created_at DESC`).bind(user.id).all<ShareRow>();
  return json({ shares: results.map((r) => shareShape(r, true)) });
}

/** GET /api/shares/:id – Metadaten. */
export async function getShareMeta(request: Request, env: Env, id: string): Promise<Response> {
  const { row, isOwner } = await visibleShare(request, env, id);
  return json({ share: shareShape(row, isOwner) });
}

/** GET /api/shares/:id/data – gzip-Payload, der Browser entpackt selbst. */
export async function getShareData(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await visibleShare(request, env, id);
  const obj = await env.TRACKS.get(key(row.id), { onlyIf: request.headers });
  if (!obj) throw NOT_FOUND();
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Encoding': 'gzip',
    ETag: obj.httpEtag,
    // Revalidieren statt cachen: gelöschte/privat gestellte Freigaben verschwinden sofort.
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie',
  });
  if (!('body' in obj)) return withApiHeaders(new Response(null, { status: 304, headers }));
  return withApiHeaders(new Response(obj.body, { headers, encodeBody: 'manual' }));
}

/** PATCH /api/shares/:id – Titel, Sichtbarkeit, Profil-Anzeige, Boot, gespeicherte Ansicht. */
export async function updateShare(request: Request, env: Env, id: string): Promise<Response> {
  const { row, user } = await ownedShare(request, env, id);
  const body = await readJson<{ title?: unknown; visibility?: unknown; view?: unknown; listed?: unknown; boatId?: unknown }>(request);
  if (body.title !== undefined) {
    const t = cleanText(body.title, LIMITS.titleLength);
    if (!t) throw new HttpError(400, 'invalid_title', 'Titel darf nicht leer sein.');
    row.title = t;
  }
  if (body.visibility !== undefined) {
    const v = parseVisibility(body.visibility);
    if (!v) throw new HttpError(400, 'invalid_visibility');
    row.visibility = v;
  }
  if (body.listed !== undefined) row.listed = body.listed === true ? 1 : 0;
  if (body.boatId !== undefined) row.boat_id = await checkBoat(env, user.id, body.boatId);
  if (body.view !== undefined) row.view = cleanView(body.view);
  row.updated_at = Date.now();
  await env.DB.prepare('UPDATE shares SET title = ?, visibility = ?, listed = ?, boat_id = ?, view = ?, updated_at = ? WHERE id = ?')
    .bind(row.title, row.visibility, row.listed, row.boat_id, row.view, row.updated_at, row.id)
    .run();
  const saved = await getShareRow(env, row.id);
  return json({ share: shareShape(saved ?? row, true) });
}

export async function deleteShare(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await ownedShare(request, env, id);
  await env.TRACKS.delete(key(row.id));
  await env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(row.id).run();
  return new Response(null, { status: 204 });
}

/** Öffentlich gelistete Törns (für Profil- und Bootsseiten). */
export async function listedShares(env: Env, where: 'user' | 'boat', id: string): Promise<ReturnType<typeof shareShape>[]> {
  const col = where === 'user' ? 's.user_id' : 's.boat_id';
  const { results } = await env.DB.prepare(
    `${SHARE_SELECT} WHERE ${col} = ? AND s.listed = 1 AND s.visibility = 'unlisted' ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT 200`,
  )
    .bind(id)
    .all<ShareRow>();
  return results.map((r) => shareShape(r, false));
}
