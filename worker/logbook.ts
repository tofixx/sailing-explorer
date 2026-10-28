// Fahrtenbuch (Konzept 19, F-300 … F-312): Törns ohne GPX anlegen und Fahrtenbuch-Angaben an jedem Törn ändern.
// Ein Eintrag ist ein Törn in `shares` mit source = 'manual' – alle Lösch-, Sichtbarkeits- und Stream-Pfade erben.
// Die Route (Hafenpositionen) liegt wie jeder Track als gzip-Payload in R2 (`{"v":1,"tracks":[],"route":[…]}`).
import type { Env } from './env';
import type { User } from './auth';
import { requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, clientIp, json, rateLimit, readJson } from './http';
import { nextShareKey } from './access';
import { assertActive, isAdmin } from './moderation';
import { deleteKeys, shareKey } from './photo-keys';
import { checkStorageQuota, supportStatus, visibilityRequiresSupport } from './supporter';
import { addStorageStmt, checkBrake, currentBrake } from './storage';
import { recordLogbook, recordVoyage } from './activity';
import { INVALID_HARBOR, harborForName, harborVisible, loadHarbor, type HarborRow } from './harbors';
import { LIMITS, cleanText, cleanView, parseVisibility } from './validate';
import { checkBoat, getShareRow, shareShape, type ShareRow } from './shares';
import { DEFAULT_VISIBILITY, canChooseVisibility } from '../src/domain/visibility';
import { isVoyageRole } from '../src/domain/crew-roles';
import { mayPlaceHarbor, parseHarborPosition } from '../src/domain/harbors';
import { fmtDate, fmtNum } from '../src/domain/format';
import { seasonOf } from '../src/domain/support';
import {
  LOG_LIMITS, departureError, isBackfill, logQuotaMessage, logTitle, parseLog, plausibleDistance, readLog, routeNm, seasonRange,
  type DistSource, type LatLon, type Logbook,
} from '../src/domain/logbook';

const DAY = 86_400_000;

const implausible = (msg: string) => new HttpError(400, 'implausible_distance', msg);

// ---------------------------------------------------------------- Häfen

/** Hafen-Eingabe: vorhandener `{ harborId }` oder neuer/gefundener `{ name }`, jeweils optional mit Position. */
interface HarborInput {
  harborId?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

/**
 * Hafen für Start oder Ziel. Fehlt ihm die Position und kommt eine mit, setzt sie, wer darf (L3): Anleger:in, Moderation,
 * beim Altbestand ohne Anleger:in die erste Person – sie wird damit Anleger:in. Wer nicht darf, bekommt 403.
 */
async function resolveHarbor(env: Env, user: Pick<User, 'id'>, input: unknown): Promise<HarborRow> {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'invalid_harbor', 'Bitte Start- und Zielhafen angeben.');
  const i = input as HarborInput;
  let h: HarborRow | null;
  if (i.harborId !== undefined && i.harborId !== null && i.harborId !== '') {
    h = await loadHarbor(env, i.harborId);
    if (!harborVisible(h)) throw INVALID_HARBOR();
  } else {
    h = (await harborForName(env, user, i.name)).harbor;
  }
  const wantsPosition = (i.lat !== undefined && i.lat !== null) || (i.lon !== undefined && i.lon !== null);
  if (wantsPosition && h.lat === null) {
    const pos = parseHarborPosition(i.lat, i.lon);
    if (!pos || pos.lat === null || pos.lon === null) throw new HttpError(400, 'invalid_position', 'Ungültige Position des Hafens.');
    if (!mayPlaceHarbor(h, user.id, isAdmin(env, user.id))) throw new HttpError(403, 'forbidden', 'Die Position setzt, wer den Hafen angelegt hat.');
    const now = Date.now();
    // nur, solange noch niemand eine gesetzt hat; der Altbestand bekommt damit seine Anleger:in
    await env.DB.prepare('UPDATE harbors SET lat = ?1, lon = ?2, created_by = COALESCE(created_by, ?3), updated_at = ?4 WHERE id = ?5 AND lat IS NULL')
      .bind(pos.lat, pos.lon, user.id, now, h.id)
      .run();
    h = (await loadHarbor(env, h.id)) ?? h;
  }
  return h;
}

/** Route aus den Hafenpositionen: Start → Ziel, beim Rundtörn ein Punkt. Häfen ohne Position fehlen. */
function harborRoute(from: Pick<HarborRow, 'id' | 'lat' | 'lon'> | null, to: Pick<HarborRow, 'id' | 'lat' | 'lon'> | null): LatLon[] {
  const pts = [from, to && from && to.id === from.id ? null : to].filter((h): h is HarborRow => !!h && h.lat !== null && h.lon !== null);
  return pts.map((h) => [h.lat!, h.lon!]);
}

async function gzipJson(value: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Payload eines Eintrags (L6: ≤ 32 KB) – gleiches Format wie ein GPX-Törn, nur ohne Tracks. */
async function routePayload(route: LatLon[]): Promise<Uint8Array> {
  const bytes = await gzipJson({ v: 1, tracks: [], route });
  if (bytes.length > LOG_LIMITS.payloadBytes) throw new HttpError(413, 'too_large', 'Die Route ist zu groß.');
  return bytes;
}

// ---------------------------------------------------------------- Eingaben

const optionalTime = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v));

function parseDistance(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw implausible('Bitte die Strecke in Seemeilen angeben.');
  return Math.round(n * 10) / 10;
}

function logOrThrow(input: unknown): Logbook {
  const r = parseLog(input);
  if ('error' in r) throw new HttpError(400, 'invalid_log', r.error);
  return r.log;
}

/** Kontingent (L1): 100 je Saison der Abfahrt; dazu höchstens 20 neue Einträge je Tag (F-304, F-305). */
async function checkLogQuota(env: Env, userId: string, startedAt: number, now: number, ignoreId = ''): Promise<void> {
  const season = seasonOf(startedAt);
  const [from, to] = seasonRange(season);
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM shares WHERE user_id = ?1 AND source = 'manual' AND started_at >= ?2 AND started_at < ?3 AND id <> ?5) AS season,
       (SELECT COUNT(*) FROM shares WHERE user_id = ?1 AND source = 'manual' AND created_at > ?4) AS today`,
  )
    .bind(userId, from, to, now - DAY, ignoreId)
    .first<{ season: number; today: number }>();
  if ((row?.season ?? 0) >= LOG_LIMITS.perSeason) throw new HttpError(409, 'quota', logQuotaMessage(season));
  if (!ignoreId && (row?.today ?? 0) >= LOG_LIMITS.perDay) {
    throw new HttpError(429, 'log_quota', `Heute hast du schon ${LOG_LIMITS.perDay} Einträge angelegt – morgen geht es weiter.`);
  }
}

const logSummary = (distNm: number, startedAt: number) => `${fmtNum(distNm, 1)} sm · ${fmtDate(startedAt)} · Fahrtenbuch`;

// ---------------------------------------------------------------- Anlegen

interface ManualBody {
  title?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  timed?: unknown;
  fromHarbor?: unknown;
  toHarbor?: unknown;
  distNm?: unknown;
  boatId?: unknown;
  visibility?: unknown;
  ownerRole?: unknown;
  log?: unknown;
}

/**
 * POST /api/shares/manual – Fahrtenbuch-Eintrag ohne GPX (F-300). Nur angemeldet (L5). Prüft Kontingent und Notbremse,
 * Sichtbarkeit (E1), Plausibilität (F-304), legt Häfen an bzw. setzt ihre Position (F-307), schreibt R2 und D1 wie
 * createShare (Aufräumen bei D1-Fehler).
 */
export async function createManualShare(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  await rateLimit(env.UPLOAD_LIMITER, `upload:${user.id}:${clientIp(request)}`);
  const body = await readJson<ManualBody>(request);
  const now = Date.now();

  const visibility = body.visibility === undefined ? DEFAULT_VISIBILITY : parseVisibility(body.visibility);
  if (!visibility) throw new HttpError(400, 'invalid_visibility', 'Unbekannte Sichtbarkeit.');
  const startedAt = Number(body.startedAt);
  const dateError = departureError(startedAt, now);
  if (dateError) throw new HttpError(400, 'invalid_date', dateError);
  const endedAt = optionalTime(body.endedAt);
  if (endedAt !== null && !Number.isFinite(endedAt)) throw new HttpError(400, 'invalid_date', 'Ungültige Ankunft.');
  const stated = parseDistance(body.distNm);
  const log: Logbook = { ...logOrThrow(body.log), ...(body.timed === true ? { timed: true } : {}) };
  if (body.ownerRole !== undefined && body.ownerRole !== null && !isVoyageRole(body.ownerRole)) throw new HttpError(400, 'invalid_role', 'Unbekannte Rolle.');

  // Speicher und Notbremse wie ein Törn (die Payload zählt mit); das Törn-Kontingent zählt hier nicht (L1).
  const usage = await supportStatus(env, user.id, now);
  checkStorageQuota(env, usage, LOG_LIMITS.payloadBytes);
  checkBrake(await currentBrake(env), usage.supporter);
  if (!canChooseVisibility(visibility, usage.supporter)) throw visibilityRequiresSupport(env);
  await checkLogQuota(env, user.id, startedAt, now);
  const boatId = await checkBoat(env, user.id, body.boatId);

  const from = await resolveHarbor(env, user, body.fromHarbor);
  const to = body.toHarbor === undefined || body.toHarbor === null ? from : await resolveHarbor(env, user, body.toHarbor);
  const route = harborRoute(from, to);
  if (!route.length) throw new HttpError(400, 'harbor_position', 'Wo liegt der Hafen? Bitte die Position auf der Karte setzen.');
  const lineNm = routeNm(route);
  const distNm = stated ?? Math.round(lineNm * 10) / 10;
  const distSource: DistSource = stated !== null ? 'stated' : 'route';
  const msg = plausibleDistance({ distNm, routeNm: lineNm, startedAt, endedAt, hasTime: !!log.timed });
  if (msg) throw implausible(msg);

  const bytes = await routePayload(route);
  const row: ShareRow = {
    id: randomId(),
    user_id: user.id,
    title: cleanText(body.title, LIMITS.titleLength) || logTitle(from.name, to.name),
    summary: logSummary(distNm, startedAt),
    visibility,
    share_key: nextShareKey(null, visibility, null, false, true),
    view: cleanView(''),
    size_bytes: bytes.length,
    track_count: 0,
    created_at: now,
    updated_at: now,
    boat_id: boatId,
    dist_nm: distNm,
    started_at: startedAt,
    ended_at: endedAt,
    has_image: 0,
    source: 'manual',
    dist_source: distSource,
    from_harbor_id: from.id,
    to_harbor_id: to.id,
    log: JSON.stringify(log),
    owner_role: isVoyageRole(body.ownerRole) ? body.ownerRole : null,
  };

  await env.TRACKS.put(shareKey(row.id), bytes, {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
    customMetadata: { owner: user.id },
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO shares (id, user_id, title, summary, visibility, share_key, view, size_bytes, track_count, created_at, updated_at, boat_id, listed,
         dist_nm, started_at, ended_at, source, dist_source, from_harbor_id, to_harbor_id, log, owner_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id, row.user_id, row.title, row.summary, row.visibility, row.share_key, row.view, row.size_bytes, row.track_count, now, now, row.boat_id,
      row.visibility === 'public' ? 1 : 0, row.dist_nm, row.started_at, row.ended_at, row.source, row.dist_source, row.from_harbor_id, row.to_harbor_id,
      row.log, row.owner_role,
    ),
    addStorageStmt(env, row.size_bytes),
  ]).catch(async (err: unknown) => {
    if (!(await env.DB.prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(row.id).first())) await deleteKeys(env, [shareKey(row.id)]);
    throw err;
  });
  // Neuigkeiten: Nachträge (Abfahrt > 14 Tage zurück) gebündelt je Konto und Tag, sonst wie ein Törn (K7, F-308).
  if (row.visibility === 'public') await (isBackfill(row.started_at, now) ? recordLogbook(env, row, now) : recordVoyage(env, row, now));
  const saved = await getShareRow(env, row.id);
  return json({ share: shareShape(saved ?? row, true) }, { status: 201 });
}

// ---------------------------------------------------------------- Ändern (PATCH /api/shares/:id)

export interface LogPatchBody {
  log?: unknown;
  fromHarbor?: unknown;
  toHarbor?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  timed?: unknown;
  distNm?: unknown;
}

/**
 * Fahrtenbuch-Teil eines PATCH (F-301): `log` und Häfen an jedem Törn; nur bei Einträgen ohne GPX auch Datum, Ankunft
 * und Strecke (bei GPX kommen sie aus dem Track). Ändert `row` und liefert eine neue Payload, wenn sich die Route ändert.
 */
export async function applyLogPatch(env: Env, user: Pick<User, 'id'>, row: ShareRow, body: LogPatchBody): Promise<{ payload: Uint8Array | null }> {
  const manual = row.source === 'manual';
  const touchesTrack = body.startedAt !== undefined || body.endedAt !== undefined || body.distNm !== undefined || body.timed !== undefined;
  if (!manual && touchesTrack) throw new HttpError(409, 'not_manual', 'Datum und Strecke kommen bei aufgezeichneten Törns aus dem Track.');
  const previous = readLog(row.log);
  if (body.log !== undefined) {
    const log = logOrThrow(body.log);
    // `timed` gehört zu Datum/Uhrzeit, nicht zu den Angaben – es bleibt, solange es nicht eigens geändert wird
    if (previous.timed) log.timed = true;
    row.log = JSON.stringify(log);
  }
  if (body.timed !== undefined) row.log = JSON.stringify({ ...readLog(row.log), timed: body.timed === true || undefined });

  const harborChanged = body.fromHarbor !== undefined || body.toHarbor !== undefined;
  let from: HarborRow | null = null;
  let to: HarborRow | null = null;
  if (body.fromHarbor !== undefined) {
    if (body.fromHarbor === null && !manual) row.from_harbor_id = null;
    else row.from_harbor_id = (from = await resolveHarbor(env, user, body.fromHarbor)).id;
  }
  if (body.toHarbor !== undefined) {
    if (body.toHarbor === null) row.to_harbor_id = manual ? row.from_harbor_id : null;
    else row.to_harbor_id = (to = await resolveHarbor(env, user, body.toHarbor)).id;
  }
  if (!manual || (!harborChanged && !touchesTrack)) return { payload: null };

  // Eintrag ohne GPX: Route, Datum und Strecke gemeinsam neu prüfen
  from ??= await loadHarbor(env, row.from_harbor_id);
  to ??= await loadHarbor(env, row.to_harbor_id);
  const route = harborRoute(from, to);
  if (!route.length) throw new HttpError(400, 'harbor_position', 'Wo liegt der Hafen? Bitte die Position auf der Karte setzen.');
  const now = Date.now();
  if (body.startedAt !== undefined) {
    const startedAt = Number(body.startedAt);
    const err = departureError(startedAt, now);
    if (err) throw new HttpError(400, 'invalid_date', err);
    if (seasonOf(startedAt) !== seasonOf(row.started_at ?? startedAt)) await checkLogQuota(env, user.id, startedAt, now, row.id);
    row.started_at = startedAt;
  }
  if (body.endedAt !== undefined) {
    const endedAt = optionalTime(body.endedAt);
    if (endedAt !== null && !Number.isFinite(endedAt)) throw new HttpError(400, 'invalid_date', 'Ungültige Ankunft.');
    row.ended_at = endedAt;
  }
  const lineNm = routeNm(route);
  const stated = parseDistance(body.distNm);
  if (stated !== null) {
    row.dist_nm = stated;
    row.dist_source = 'stated';
  } else if (body.distNm === null || (row.dist_source === 'route' && harborChanged)) {
    row.dist_nm = Math.round(lineNm * 10) / 10;
    row.dist_source = 'route';
  }
  const msg = plausibleDistance({ distNm: row.dist_nm, routeNm: lineNm, startedAt: row.started_at ?? now, endedAt: row.ended_at ?? null, hasTime: !!readLog(row.log).timed });
  if (msg) throw implausible(msg);
  row.summary = logSummary(row.dist_nm, row.started_at ?? now);
  return { payload: harborChanged ? await routePayload(route) : null };
}
