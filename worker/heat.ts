// Revier-Wärmekarte (Konzept 37, F-581/F-582): Raster je Törn schreiben (Eigentümer) und die zusammengefasste Karte
// lesen (öffentlich, für alle gleich, gecacht). Der Worker parst kein GPX – das Raster rechnet der Browser
// (`voyageCells`), hier wird es nur geprüft (`parseCells`) und zusammengefasst (`aggregateCells`).
import type { Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { assertActive } from './moderation';
import { assertMediaAllowed, ownedShare } from './shares';
import { deleteKeys, heatKey } from './photo-keys';
import { LISTED } from './discover';
import { HEAT, aggregateCells, parseCells, type HeatData } from '../src/domain/heat';

/**
 * PUT /api/shares/:id/heat { cells } – Raster des eigenen GPX-Törns (F-581). Ersetzt ein vorhandenes; zählt nicht zum
 * Speicher (≤ 200 Zellen). Fahrtenbuch-Einträge ohne GPX 409, ungültiges Raster 400, gesperrte Konten 403, mehr als
 * 10 je Minute 429.
 */
export async function putShareHeat(request: Request, env: Env, id: string): Promise<Response> {
  const { row, user } = await ownedShare(request, env, id);
  assertMediaAllowed(row);
  await assertActive(env, user);
  // eigener Schlüssel je Konto im Upload-Limit (10 je Minute): die App sendet je Törn höchstens einmal je Sitzung. Die Notbremse
  // (Konzept 5.2) greift nicht – die Datei ist klein (≤ 200 Zellen) und ersetzt die vorige.
  await rateLimit(env.UPLOAD_LIMITER, `heat:${user.id}`);
  const body = await readJson<{ cells?: unknown }>(request);
  const cells = parseCells(body.cells);
  if (!cells) throw new HttpError(400, 'invalid_cells', 'Ungültiges Raster.');
  await env.TRACKS.put(heatKey(row.id), JSON.stringify({ cells }), { httpMetadata: { contentType: 'application/json' }, customMetadata: { owner: row.user_id } });
  // Törn inzwischen gelöscht: die Datei hätte keine Zeile mehr – sofort wieder entfernen (wie beim Übersichtsbild).
  if (!(await env.DB.prepare('SELECT 1 AS x FROM shares WHERE id = ?').bind(row.id).first())) {
    await deleteKeys(env, [heatKey(row.id)]);
    throw new HttpError(404, 'not_found', 'Diese Freigabe gibt es nicht (mehr).');
  }
  return new Response(null, { status: 204 });
}

/**
 * Neueste GPX-Törns, die /entdecken zeigt (öffentlich, nicht ausgeblendet, „Sichtbar bis: überall“, Konto nicht
 * gesperrt), höchstens ?2 je Konto – ein Konto allein kann die Karte nicht füllen. Abfahrt liegt höchstens einen Tag in
 * der Zukunft (`createShare`), ein Törn kann sich also nicht dauerhaft nach vorn schieben.
 */
const HEAT_SQL = `SELECT id FROM (
    SELECT s.id, COALESCE(s.started_at, s.created_at) AS at,
      ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY COALESCE(s.started_at, s.created_at) DESC, s.id) AS nth
    FROM shares s WHERE ${LISTED} AND s.source = 'gpx'
  )
  WHERE nth <= ?2
  ORDER BY at DESC, id LIMIT ?1`;

async function readCells(env: Env, id: string): Promise<unknown> {
  try {
    const obj = await env.TRACKS.get(heatKey(id));
    return obj ? ((await obj.json()) as { cells?: unknown }).cells : null;
  } catch {
    return null; // kaputte Datei: der Törn fehlt nur in der Karte
  }
}

/**
 * GET /api/discover/heat – Wärmekarte der Community (F-582): Zellen (i, j, Zahl der Törns) und je Törn ein Pin (ID,
 * mittlere Zelle). Ohne jeden Bezug zum Betrachter (kein Cookie gelesen), daher öffentlich gecacht: im Rechenzentrum
 * `HEAT.edgeTtl`, im Browser `HEAT.browserTtl` – zusammen höchstens 15 Minuten.
 */
export async function getHeat(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const key = new Request(`${origin}/__cache/discover/heat`);
  const hit = await cache?.match(key).catch(() => undefined);
  let data = hit ? ((await hit.json()) as HeatData) : null;
  if (!data) {
    const { results } = await env.DB.prepare(HEAT_SQL).bind(HEAT.voyages, HEAT.perUser).all<{ id: string }>();
    const list = await Promise.all(results.map(async (r) => ({ id: r.id, cells: await readCells(env, r.id) })));
    data = aggregateCells(list);
    await cache?.put(key, new Response(JSON.stringify(data), { headers: { 'Cache-Control': `max-age=${HEAT.edgeTtl}` } })).catch(() => undefined);
  }
  return json(data, { headers: { 'Cache-Control': `public, max-age=${HEAT.browserTtl}` } });
}
