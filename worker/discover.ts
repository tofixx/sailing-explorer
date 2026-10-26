import type { Env } from './env';
import { json } from './http';
import { publicGroups } from './groups';

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

const VOYAGES = `SELECT s.id, s.title, s.summary, s.dist_nm, s.started_at, s.created_at, s.has_image, s.track_count,
    b.id AS boat_id, b.name AS boat_name, b.visibility AS boat_visibility,
    p.handle, p.display_name
  FROM shares s
  LEFT JOIN profiles p ON p.user_id = s.user_id AND p.visibility = 'public' AND p.hidden_at IS NULL
  LEFT JOIN boats b ON b.id = s.boat_id AND b.hidden_at IS NULL
  WHERE ${LISTED}
  ORDER BY COALESCE(s.started_at, s.created_at) DESC, s.id
  LIMIT ?1`;

const BOATS = `SELECT b.id, b.name, b.boat_type, b.length_m, b.home_port, b.created_at, p.handle, p.display_name,
    (SELECT COUNT(*) FROM shares s WHERE s.boat_id = b.id AND ${LISTED}) AS voyages,
    (SELECT COALESCE(SUM(s.dist_nm), 0) FROM shares s WHERE s.boat_id = b.id AND ${LISTED}) AS dist_nm
  FROM boats b
  JOIN profiles p ON p.user_id = b.owner_id AND p.visibility = 'public' AND p.hidden_at IS NULL
  WHERE b.visibility = 'public' AND b.hidden_at IS NULL AND ${ACTIVE('b.owner_id')}
  ORDER BY b.created_at DESC, b.id
  LIMIT ?1`;

const PEOPLE = `SELECT * FROM (
    SELECT p.handle, p.display_name, p.bio, p.created_at,
      (SELECT COUNT(*) FROM shares s WHERE s.user_id = p.user_id AND ${LISTED}) AS voyages,
      (SELECT COALESCE(SUM(s.dist_nm), 0) FROM shares s WHERE s.user_id = p.user_id AND ${LISTED}) AS dist_nm,
      (SELECT COUNT(*) FROM boats b WHERE b.owner_id = p.user_id AND b.visibility = 'public' AND b.hidden_at IS NULL) AS boats
    FROM profiles p
    WHERE p.visibility = 'public' AND p.hidden_at IS NULL AND ${ACTIVE('p.user_id')}
  )
  WHERE voyages > 0 OR boats > 0
  ORDER BY created_at DESC, handle
  LIMIT ?1`;

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
}

interface PersonRow {
  handle: string;
  display_name: string;
  bio: string;
  created_at: number;
  voyages: number;
  dist_nm: number;
  boats: number;
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
});

const personShape = (r: PersonRow) => ({
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  createdAt: r.created_at,
  stats: { voyages: r.voyages, distNm: r.dist_nm, boats: r.boats },
});

/** GET /api/discover?limit=… – öffentliche Inhalte, neueste zuerst. */
export async function getDiscover(request: Request, env: Env): Promise<Response> {
  const limit = parseLimit(new URL(request.url).searchParams.get('limit'));
  const [voyages, boats, people] = await env.DB.batch([
    env.DB.prepare(VOYAGES).bind(limit),
    env.DB.prepare(BOATS).bind(limit),
    env.DB.prepare(PEOPLE).bind(limit),
  ]);
  return json(
    {
      voyages: (voyages.results as unknown as VoyageRow[]).map(voyageShape),
      boats: (boats.results as unknown as BoatRow[]).map(boatShape),
      people: (people.results as unknown as PersonRow[]).map(personShape),
      // Vereine und Teams (Konzept 11.5): öffentlich, nicht ausgeblendet, Eigner nicht gesperrt
      groups: await publicGroups(env, limit),
    },
    // Nur öffentliche Daten, für alle gleich – darf kurz geteilt gecacht werden.
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
