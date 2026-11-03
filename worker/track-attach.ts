// GPX nachreichen (Konzept 38, F-600 … F-606): Eigentümer:innen hängen an einen Fahrtenbuch-Eintrag ohne GPX
// nachträglich einen Track. Danach ist er ein gewöhnlicher GPX-Törn; alles andere am Törn bleibt.
import type { Env } from './env';
import { HttpError, clientIp, rateLimit, readBodyCapped, json } from './http';
import { assertActive } from './moderation';
import { deleteKeys, shareKey } from './photo-keys';
import { checkShareQuota, checkStorageQuota, supportStatus } from './supporter';
import { checkBrake, currentBrake, replaceManualPayloadStmt } from './storage';
import { LIMITS, cleanText } from './validate';
import { NOT_FOUND, checkPayload, decodeHeader, getShareRow, ownedShare, shareDetail } from './shares';
import { plausibleGpx } from '../src/domain/logbook';
import { attachExpiryError, trackDateError } from '../src/domain/track-attach';

/** Zeitpunkt aus einem Header: endlich, positiv, höchstens einen Tag in der Zukunft – sonst null (wie createShare). */
function headerTime(v: string | null, now: number): number | null {
  const t = Number(v);
  return v !== null && Number.isFinite(t) && t > 0 && t < now + 86_400_000 ? t : null;
}

/**
 * PUT /api/shares/:id/track – Body gzip(JSON) wie POST /api/shares, Distanz, Zeiten, Track-Zahl und Kurzbeschreibung
 * in denselben Headern. Reihenfolge: Besitz, Sperre, Rate-Limit, Art (F-600), Kontingente (F-603), Aufbewahrung (F-604),
 * dann erst den Body lesen und prüfen (F-601, F-602).
 */
export async function attachTrack(request: Request, env: Env, id: string): Promise<Response> {
  const { row, user } = await ownedShare(request, env, id);
  await assertActive(env, user);
  await rateLimit(env.UPLOAD_LIMITER, `upload:${user.id}:${clientIp(request)}`);
  if (row.source !== 'manual') throw new HttpError(409, 'not_manual', 'Dieser Törn hat schon einen Track.');

  const now = Date.now();
  // Mit Track zählt der Eintrag als Törn (Kontingent) und belegt Speicher wie ein Upload; die Route fällt weg.
  const usage = await supportStatus(env, user.id, now);
  checkShareQuota(env, usage);
  const remaining = checkStorageQuota(env, usage) + row.size_bytes;
  checkBrake(await currentBrake(env), usage.supporter);
  const expiry = attachExpiryError(row.created_at, usage.supporterUntil, now);
  if (expiry) throw new HttpError(409, 'expiry_soon', expiry);

  const bytes = await readBodyCapped(request, Math.min(LIMITS.uploadBytes, remaining)).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 413) throw new HttpError(413, 'too_large', 'Upload zu groß (max. 12 MB komprimiert) oder Kontingent erschöpft.');
    throw e;
  });
  await checkPayload(bytes);

  const h = request.headers;
  const trackStart = headerTime(h.get('X-Share-Started'), now);
  const trackEnd = trackStart === null ? null : headerTime(h.get('X-Share-Ended'), now);
  const distNm = Math.max(0, Number(h.get('X-Share-Distance')) || 0);
  const implausible = plausibleGpx(distNm, trackStart, trackEnd);
  if (implausible) throw new HttpError(400, 'implausible_distance', implausible);
  const mismatch = trackDateError({ startedAt: row.started_at, endedAt: row.ended_at ?? null }, trackStart, trackEnd);
  if (mismatch) throw new HttpError(409, 'track_mismatch', mismatch);

  // Ohne Zeitstempel im Track bleiben Abfahrt und Ankunft des Eintrags (wie F-05).
  const startedAt = trackStart ?? row.started_at;
  const endedAt = trackStart === null ? (row.ended_at ?? null) : trackEnd;
  const trackCount = Math.max(1, Math.min(LIMITS.tracksPerShare, Number(h.get('X-Share-Tracks')) || 1));
  const summary = cleanText(decodeHeader(h.get('X-Share-Summary')), LIMITS.summaryLength) || row.summary;

  // Dieselbe Datei wie die Route: sie wird überschrieben, es bleibt kein zweites Objekt (38.3).
  await env.TRACKS.put(shareKey(row.id), bytes, {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
    customMetadata: { owner: row.user_id },
  });
  const [, upd] = await env.DB.batch([
    // Zähler vor dem UPDATE um die Differenz verschieben – nur, solange der Törn noch ein Eintrag ohne GPX ist
    replaceManualPayloadStmt(env, row.id, bytes.length),
    env.DB.prepare(
      `UPDATE shares SET source = 'gpx', dist_source = 'track', dist_nm = ?1, started_at = ?2, ended_at = ?3, track_count = ?4, size_bytes = ?5,
         summary = ?6, updated_at = ?7, expiry_warned_at = NULL WHERE id = ?8 AND source = 'manual'`,
    ).bind(distNm, startedAt, endedAt, trackCount, bytes.length, summary, now, row.id),
    // Post-Art folgt der Herkunft (shareKindOf): aus dem Fahrtenbuch-Eintrag wird ein Törn
    env.DB.prepare("UPDATE posts SET kind = 'voyage', updated_at = ?1 WHERE id = ?2 AND kind = 'logbook'").bind(now, row.id),
  ]);
  if (!upd.meta.changes) {
    // Törn inzwischen gelöscht: die gerade geschriebene Datei hätte keine Zeile mehr.
    if (!(await env.DB.prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(row.id).first())) {
      await deleteKeys(env, [shareKey(row.id)]);
      throw NOT_FOUND();
    }
    throw new HttpError(409, 'conflict', 'Dieser Törn hat inzwischen schon einen Track.');
  }
  const saved = await getShareRow(env, row.id);
  return json({ share: await shareDetail(env, saved ?? row, true, user.id) });
}
