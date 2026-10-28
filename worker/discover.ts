import type { Env } from './env';
import { json } from './http';
import { nearRank, publicGroups } from './groups';
import { coverRef } from '../src/domain/cover';
import { SEARCH_LIMITS, searchKey, searchLike, sqlSearchFold } from '../src/domain/search';
import { DEFAULT_RADIUS, isNearRadius, parseCenter, type LatLon } from '../src/domain/near';
import { harborVisible, loadHarborBySlug } from './harbors';
import { placesNear } from './stream';

/**
 * Entdecken (F-70 … F-74): zuletzt gesegelte Törns, neue Boote und Segler.
 *
 * Datenschutz: Es erscheint ausschließlich, was ohnehin schon öffentlich ist (F-83) –
 * Törns mit visibility='public' (unabhängig vom Profil; der Autor wird nur bei öffentlichem
 * Profil genannt, sonst sailor: null, F-82), öffentliche Boote mit öffentlichem Eigner-Profil
 * und öffentliche Profile mit mindestens einem öffentlichen Törn oder Boot. Die Spalten werden explizit gewählt
 * (kein SELECT mit Stern), damit nie E-Mail-Adressen oder interne Felder in die Antwort geraten.
 */

export const DISCOVER_LIMIT = { default: 12, max: 24 };

/**
 * Öffentlicher Törn – wie auf Profil- und Bootsseiten, nicht ausgeblendet (Meldung); zusätzlich verschwinden
 * Inhalte gesperrter Konten aus den Listen (Konzept 4.4).
 */
const LISTED = `s.visibility = 'public' AND s.hidden_at IS NULL AND NOT EXISTS (SELECT 1 FROM users su WHERE su.id = s.user_id AND su.suspended_at IS NOT NULL)`;
const ACTIVE = (col: string) => `NOT EXISTS (SELECT 1 FROM users su WHERE su.id = ${col} AND su.suspended_at IS NOT NULL)`;

/**
 * Suche (F-331): Bedingung „eine der Spalten enthält ?2“ in der Vergleichsform von `searchKey` – ohne Suche leer,
 * damit die Startseiten-Leiste nichts zusätzlich rechnet.
 */
const matching = (search: boolean, ...cols: string[]) =>
  search ? `AND (${cols.map((c) => `${sqlSearchFold(c)} LIKE ?2 ESCAPE '\\'`).join(' OR ')})` : '';

/** Umgebung (F-344): Hafen-IDs als ?3 (JSON, nächste zuerst). Törns nur über ein öffentliches Boot dort. */
const NEAR = {
  voyage: `AND b.visibility = 'public' AND b.harbor_id IN (SELECT value FROM json_each(?3))`,
  boat: `AND b.harbor_id IN (SELECT value FROM json_each(?3))`,
  person: `AND EXISTS (SELECT 1 FROM boats nb WHERE nb.owner_id = p.user_id AND nb.visibility = 'public' AND nb.hidden_at IS NULL AND nb.harbor_id IN (SELECT value FROM json_each(?3)))`,
  harbor: `AND h.id IN (SELECT value FROM json_each(?3))`,
};

const VOYAGES = (m: string) => `SELECT s.id, s.title, s.summary, s.dist_nm, s.started_at, s.created_at, s.has_image, s.track_count,
    b.id AS boat_id, b.name AS boat_name, b.visibility AS boat_visibility,
    p.handle, p.display_name
  FROM shares s
  LEFT JOIN profiles p ON p.user_id = s.user_id AND p.visibility = 'public' AND p.hidden_at IS NULL
  LEFT JOIN boats b ON b.id = s.boat_id AND b.hidden_at IS NULL
  WHERE ${LISTED} ${m}
  ORDER BY COALESCE(s.started_at, s.created_at) DESC, s.id
  LIMIT ?1`;

const BOATS = (m: string) => `SELECT b.id, b.name, b.boat_type, b.length_m, b.home_port, b.created_at, p.handle, p.display_name, c.ver AS cover_ver, c.focus_y AS cover_y,
    (SELECT COUNT(*) FROM shares s WHERE s.boat_id = b.id AND ${LISTED}) AS voyages,
    (SELECT COALESCE(SUM(s.dist_nm), 0) FROM shares s WHERE s.boat_id = b.id AND ${LISTED}) AS dist_nm
  FROM boats b
  JOIN profiles p ON p.user_id = b.owner_id AND p.visibility = 'public' AND p.hidden_at IS NULL
  LEFT JOIN covers c ON c.kind = 'b' AND c.object_id = b.id
  WHERE b.visibility = 'public' AND b.hidden_at IS NULL AND ${ACTIVE('b.owner_id')} ${m}
  ORDER BY ${m.includes('?3') ? `${nearRank('b.harbor_id')}, ` : ''}b.created_at DESC, b.id
  LIMIT ?1`;

const PEOPLE = (m: string) => `SELECT * FROM (
    SELECT p.handle, p.display_name, p.bio, p.created_at, c.ver AS cover_ver, c.focus_y AS cover_y,
      (SELECT COUNT(*) FROM shares s WHERE s.user_id = p.user_id AND ${LISTED}) AS voyages,
      (SELECT COALESCE(SUM(s.dist_nm), 0) FROM shares s WHERE s.user_id = p.user_id AND ${LISTED}) AS dist_nm,
      (SELECT COUNT(*) FROM boats b WHERE b.owner_id = p.user_id AND b.visibility = 'public' AND b.hidden_at IS NULL) AS boats
    FROM profiles p
    LEFT JOIN covers c ON c.kind = 'u' AND c.object_id = p.user_id
    WHERE p.visibility = 'public' AND p.hidden_at IS NULL AND ${ACTIVE('p.user_id')} ${m}
  )
  WHERE voyages > 0 OR boats > 0
  ORDER BY created_at DESC, handle
  LIMIT ?1`;

/**
 * Häfen (F-332): nicht ausgeblendet, mit Zahl der öffentlichen Boote und Vereine/Teams. Ohne Suche nur Häfen, in
 * denen etwas los ist (meiste zuerst); mit Suche jeder passende – Häfen sind immer öffentlich (Konzept 12.2).
 */
const HARBORS = (m: string) => `SELECT * FROM (
    SELECT h.id, h.slug, h.name,
      (SELECT COUNT(*) FROM boats b WHERE b.harbor_id = h.id AND b.visibility = 'public' AND b.hidden_at IS NULL AND ${ACTIVE('b.owner_id')}) AS boats,
      (SELECT COUNT(*) FROM groups g WHERE g.harbor_id = h.id AND g.visibility = 'public' AND g.hidden_at IS NULL AND ${ACTIVE('g.owner_id')}) AS clubs
    FROM harbors h
    WHERE h.hidden_at IS NULL ${m}
  )
  WHERE ${m.trim() ? '1' : 'boats > 0 OR clubs > 0'}
  ORDER BY ${m.includes('?3') ? `${nearRank('id')}, ` : ''}boats + clubs DESC, name, slug
  LIMIT ?1`;

interface HarborRow {
  id: string;
  slug: string;
  name: string;
  boats: number;
  clubs: number;
}

interface VoyageRow {
  id: string;
  title: string;
  summary: string;
  dist_nm: number;
  started_at: number | null;
  created_at: number;
  has_image: number;
  track_count: number;
  boat_id: string | null;
  boat_name: string | null;
  boat_visibility: string | null;
  /** NULL, wenn das Profil fehlt oder nicht öffentlich ist */
  handle: string | null;
  display_name: string | null;
}

interface BoatRow {
  id: string;
  name: string;
  boat_type: string;
  length_m: number | null;
  home_port: string;
  created_at: number;
  handle: string;
  display_name: string;
  voyages: number;
  dist_nm: number;
  cover_ver: string | null;
  cover_y: number | null;
}

interface PersonRow {
  handle: string;
  display_name: string;
  bio: string;
  created_at: number;
  voyages: number;
  dist_nm: number;
  boats: number;
  cover_ver: string | null;
  cover_y: number | null;
}

export function parseLimit(raw: string | null): number {
  const n = Math.floor(Number(raw));
  if (!raw || !Number.isFinite(n) || n < 1) return DISCOVER_LIMIT.default;
  return Math.min(n, DISCOVER_LIMIT.max);
}

const voyageShape = (r: VoyageRow) => ({
  id: r.id,
  title: r.title,
  summary: r.summary,
  distNm: r.dist_nm,
  startedAt: r.started_at,
  createdAt: r.created_at,
  trackCount: r.track_count,
  hasImage: !!r.has_image,
  // Private Boote bleiben auch hier unsichtbar (wie in shareShape für Fremde).
  boat: r.boat_id && r.boat_visibility === 'public' ? { id: r.boat_id, name: r.boat_name ?? '' } : null,
  // Autor nur mit öffentlichem Profil; ein „Nur mit Link“-Profil wird nie über einen anderen Link verraten.
  sailor: r.handle ? { handle: r.handle, displayName: r.display_name ?? '' } : null,
});

const boatShape = (r: BoatRow) => ({
  id: r.id,
  name: r.name,
  boatType: r.boat_type,
  lengthM: r.length_m,
  homePort: r.home_port,
  createdAt: r.created_at,
  owner: { handle: r.handle, displayName: r.display_name },
  stats: { voyages: r.voyages, distNm: r.dist_nm },
  cover: coverRef('b', r.id, r.cover_ver, r.cover_y),
});

const personShape = (r: PersonRow) => ({
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  createdAt: r.created_at,
  stats: { voyages: r.voyages, distNm: r.dist_nm, boats: r.boats },
  cover: coverRef('u', r.handle, r.cover_ver, r.cover_y),
});

/** Suchschlüssel aus `?q=` (F-331) – zu kurz oder leer: '' (keine Suche). */
export function parseQuery(raw: string | null): string {
  const key = searchKey(raw ?? '');
  return key.length >= SEARCH_LIMITS.min ? key : '';
}

/**
 * Mittelpunkt der Umgebung aus `lat`/`lon` (gerundet) bzw. `harbor` – ungültig oder ohne Position: keiner (dann
 * gilt „Alles“). Umkreis wie im Stream (F-340).
 */
async function nearOf(env: Env, params: URLSearchParams): Promise<{ ids: string; km: Map<string, number> } | null> {
  const slug = params.get('harbor');
  let center: LatLon | null = null;
  if (slug) {
    const h = await loadHarborBySlug(env, slug);
    if (harborVisible(h) && h.lat !== null && h.lon !== null) center = { lat: h.lat, lon: h.lon };
  } else center = parseCenter(params.get('lat'), params.get('lon'));
  if (!center) return null;
  const r = params.get('r');
  const { harbors } = await placesNear(env, center, isNearRadius(r) ? Number(r) : DEFAULT_RADIUS);
  return { ids: JSON.stringify(harbors.map((h) => h.id)), km: new Map(harbors.map((h) => [h.id, h.km])) };
}

/**
 * GET /api/discover?limit=…&q=…&lat=&lon=&r= bzw. &harbor= – öffentliche Inhalte, neueste zuerst; mit `q` nur passende
 * (F-331); mit Mittelpunkt nur aus Häfen im Umkreis, nächste zuerst, Häfen mit Entfernung (F-344).
 */
export async function getDiscover(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params.get('limit'));
  const query = parseQuery(params.get('q'));
  const search = !!query;
  const near = params.has('lat') || params.has('harbor') ? await nearOf(env, params) : null;
  const like = search ? searchLike(query) : '';
  const bind = (sql: string) =>
    near ? env.DB.prepare(sql).bind(limit, like, near.ids) : search ? env.DB.prepare(sql).bind(limit, like) : env.DB.prepare(sql).bind(limit);
  const n = (k: keyof typeof NEAR) => (near ? NEAR[k] : '');
  const [voyages, boats, people, harbors] = await env.DB.batch([
    // nur der Titel – ein privates Boot darf über die Suche nicht zu seinen Törns führen
    bind(VOYAGES(`${matching(search, 's.title')} ${n('voyage')}`)),
    bind(BOATS(`${matching(search, 'b.name', 'b.boat_type', 'b.home_port')} ${n('boat')}`)),
    bind(PEOPLE(`${matching(search, 'p.display_name', 'p.handle')} ${n('person')}`)),
    bind(HARBORS(`${matching(search, 'h.name')} ${n('harbor')}`)),
  ]);
  return json(
    {
      query,
      voyages: (voyages.results as unknown as VoyageRow[]).map(voyageShape),
      boats: (boats.results as unknown as BoatRow[]).map(boatShape),
      people: (people.results as unknown as PersonRow[]).map(personShape),
      // Vereine und Teams (Konzept 11.5): öffentlich, nicht ausgeblendet, Eigner nicht gesperrt
      groups: await publicGroups(env, limit, search ? { where: matching(true, 'g.name', 'g.home_port'), like } : undefined, near?.ids),
      harbors: (harbors.results as unknown as HarborRow[]).map((r) => ({
        slug: r.slug, name: r.name, boats: r.boats, groups: r.clubs,
        ...(near ? { km: Math.round(near.km.get(r.id) ?? 0) } : {}),
      })),
      near: !!near,
    },
    // Nur öffentliche Daten, für alle gleich – darf kurz geteilt gecacht werden.
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
