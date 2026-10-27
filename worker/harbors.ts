// Häfen (Konzept 12.2, F-171 … F-175): Autovervollständigung, Anlegen mit Dubletten-Erkennung, Bearbeiten,
// Hafenseite. Häfen sind immer öffentlich (nur Name und Ort); gelistet werden darin nur öffentliche Boote und Törns.
import type { Env } from './env';
import { currentUser, requireUser, type User } from './auth';
import { randomId } from './crypto';
import { HttpError, json, readJson } from './http';
import { assertActive, isAdmin } from './moderation';
import { SHARE_SELECT, shareShape, type ShareRow } from './shares';
import { followStats } from './follows';
import { harborActivityCleanup } from './activity';
import { LIMITS, SHARE_ID_RE, cleanText } from './validate';
import { HARBOR_LIMITS, harborKey, harborSlugBase, isHarborSlug, parseHarborPosition, type HarborRef } from '../src/domain/harbors';
import { canManageGroup } from '../src/domain/groups';

const DAY = 86_400_000;

export interface HarborRow {
  id: string;
  slug: string;
  name: string;
  name_key: string;
  lat: number | null;
  lon: number | null;
  club_id: string | null;
  created_by: string | null;
  hidden_at: number | null;
  created_at: number;
  updated_at: number;
}

export const HARBOR_NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Hafen gibt es nicht (mehr).');
export const INVALID_HARBOR = () => new HttpError(400, 'invalid_harbor', 'Diesen Hafen gibt es nicht (mehr). Bitte einen anderen wählen.');

export const harborRef = (h: Pick<HarborRow, 'id' | 'slug' | 'name'>): HarborRef => ({ id: h.id, slug: h.slug, name: h.name });

export async function loadHarbor(env: Env, id: unknown): Promise<HarborRow | null> {
  if (typeof id !== 'string' || !SHARE_ID_RE.test(id)) return null;
  return env.DB.prepare('SELECT * FROM harbors WHERE id = ?').bind(id).first<HarborRow>();
}

export async function loadHarborBySlug(env: Env, slug: unknown): Promise<HarborRow | null> {
  if (!isHarborSlug(slug)) return null;
  return env.DB.prepare('SELECT * FROM harbors WHERE slug = ?').bind(slug).first<HarborRow>();
}

/** Hafen über eine alte Adresse (zusammengeführt, Konzept 15.7) – null, wenn es keine Weiterleitung gibt. */
export async function loadHarborByRedirect(env: Env, slug: unknown): Promise<HarborRow | null> {
  if (!isHarborSlug(slug)) return null;
  return env.DB.prepare('SELECT h.* FROM harbor_redirects r JOIN harbors h ON h.id = r.harbor_id WHERE r.old_slug = ?').bind(slug).first<HarborRow>();
}

/** Sichtbar: nicht ausgeblendet – oder Moderation. */
export const harborVisible = (h: HarborRow | null, admin = false): h is HarborRow => !!h && (!h.hidden_at || admin);

/**
 * Hafen zu einem Namen: vorhandener mit gleichem normalisiertem Namen (auch wenn ausgeblendet: dann Fehler statt
 * Dublette) oder ein neuer. Neue zählen gegen „10 pro Konto und Tag“; gesperrte Konten legen keine an.
 */
export async function harborForName(env: Env, user: Pick<User, 'id'>, rawName: unknown): Promise<{ harbor: HarborRow; created: boolean }> {
  const name = cleanText(rawName, HARBOR_LIMITS.nameMax);
  const key = harborKey(name);
  if (!key) throw new HttpError(400, 'invalid_name', 'Bitte einen Hafennamen angeben.');
  const existing = await env.DB.prepare('SELECT * FROM harbors WHERE name_key = ?').bind(key).first<HarborRow>();
  if (existing) {
    if (existing.hidden_at) throw INVALID_HARBOR();
    return { harbor: existing, created: false };
  }
  await assertActive(env, user);
  const now = Date.now();
  const today = (await env.DB.prepare('SELECT COUNT(*) AS n FROM harbors WHERE created_by = ? AND created_at > ?').bind(user.id, now - DAY).first<{ n: number }>())?.n ?? 0;
  if (today >= HARBOR_LIMITS.perDay) throw new HttpError(429, 'harbor_quota', `Du hast heute schon ${HARBOR_LIMITS.perDay} Häfen angelegt – morgen geht es weiter.`);
  const base = harborSlugBase(name);
  let slug = base;
  // auch keine Adresse, die auf einen zusammengeführten Hafen weiterleitet (Konzept 15.7)
  const taken = (s: string) => env.DB.prepare('SELECT 1 AS x FROM harbors WHERE slug = ?1 UNION ALL SELECT 1 FROM harbor_redirects WHERE old_slug = ?1').bind(s).first();
  for (let i = 0; i < 5 && (await taken(slug)); i++) {
    slug = `${base.slice(0, 24)}-${randomId(5).toLowerCase()}`;
  }
  const h: HarborRow = { id: randomId(), slug, name, name_key: key, lat: null, lon: null, club_id: null, created_by: user.id, hidden_at: null, created_at: now, updated_at: now };
  try {
    await env.DB.prepare('INSERT INTO harbors (id, slug, name, name_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(h.id, h.slug, h.name, h.name_key, h.created_by, now, now)
      .run();
  } catch (err) {
    // gleichzeitig angelegt (eindeutiger name_key) – dann den vorhandenen nehmen
    const again = await env.DB.prepare('SELECT * FROM harbors WHERE name_key = ?').bind(key).first<HarborRow>();
    if (again && !again.hidden_at) return { harbor: again, created: false };
    throw err;
  }
  return { harbor: h, created: true };
}

/**
 * Hafen-Eingabe am Boot: `harborId` (Zeichenkette oder null) hat Vorrang, sonst `homePort` als Text (alte Clients).
 * undefined = keine Änderung, null = keinen Hafen.
 */
export async function harborFromBoatInput(env: Env, user: Pick<User, 'id'>, input: { harborId?: unknown; homePort?: unknown }): Promise<HarborRow | null | undefined> {
  if (input.harborId !== undefined) {
    if (input.harborId === null || input.harborId === '') return null;
    const h = await loadHarbor(env, input.harborId);
    if (!harborVisible(h)) throw INVALID_HARBOR();
    return h;
  }
  if (input.homePort !== undefined) {
    if (!cleanText(input.homePort, LIMITS.nameLength)) return null;
    return (await harborForName(env, user, input.homePort)).harbor;
  }
  return undefined;
}

// ---------------------------------------------------------------- API

/** GET /api/harbors?q= – Autovervollständigung (Teilstring im normalisierten Namen, Anfänge zuerst). */
export async function searchHarbors(request: Request, env: Env): Promise<Response> {
  const q = cleanText(new URL(request.url).searchParams.get('q') ?? '', HARBOR_LIMITS.queryMax);
  const key = harborKey(q);
  if (key.length < HARBOR_LIMITS.queryMin) return json({ harbors: [] });
  const like = `%${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const prefix = `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT h.id, h.slug, h.name, (SELECT COUNT(*) FROM boats b WHERE b.harbor_id = h.id) AS boats
     FROM harbors h WHERE h.hidden_at IS NULL AND h.name_key LIKE ?1 ESCAPE '\\'
     ORDER BY (h.name_key LIKE ?2 ESCAPE '\\') DESC, boats DESC, h.name LIMIT ?3`,
  )
    .bind(like, prefix, HARBOR_LIMITS.search)
    .all<{ id: string; slug: string; name: string; boats: number }>();
  return json({ harbors: results.map((h) => ({ ...harborRef(h), boats: h.boats })) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

/** POST /api/harbors – `{ name }`: vorhandener Hafen (200) oder neuer (201). */
export async function createHarbor(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { name } = await readJson<{ name?: unknown }>(request);
  const { harbor, created } = await harborForName(env, user, name);
  return json({ harbor: harborRef(harbor), created }, { status: created ? 201 : 200 });
}

/** Verein des Hafens nur, wenn öffentlich und nicht ausgeblendet. */
async function harborClub(env: Env, clubId: string | null) {
  if (!clubId) return null;
  return env.DB.prepare(`SELECT id, slug, name, kind FROM groups WHERE id = ? AND kind = 'club' AND visibility = 'public' AND hidden_at IS NULL`)
    .bind(clubId)
    .first<{ id: string; slug: string; name: string; kind: 'club' }>();
}

/** Darf das Konto Name und Position ändern? Anleger:in oder Moderation. */
const canEditHarbor = (env: Env, h: HarborRow, userId: string | null | undefined) => !!userId && (h.created_by === userId || isAdmin(env, userId));

function harborShape(env: Env, h: HarborRow, viewerId: string | null) {
  return {
    ...harborRef(h),
    lat: h.lat,
    lon: h.lon,
    canEdit: canEditHarbor(env, h, viewerId),
    hiddenAt: isAdmin(env, viewerId) ? h.hidden_at : null,
    createdAt: h.created_at,
  };
}

/** GET /api/harbors/slug/:slug – Hafenseite (F-173). */
export async function getHarbor(request: Request, env: Env, slug: string): Promise<Response> {
  const h = (await loadHarborBySlug(env, slug)) ?? (await loadHarborByRedirect(env, slug));
  const user = await currentUser(request, env);
  if (!harborVisible(h, isAdmin(env, user?.id))) throw HARBOR_NOT_FOUND();
  const { results: boats } = await env.DB.prepare(
    `SELECT b.id, b.name, b.boat_type, b.length_m, p.handle AS owner_handle, p.display_name AS owner_name,
       (p.visibility = 'public' AND p.hidden_at IS NULL) AS owner_public
     FROM boats b LEFT JOIN profiles p ON p.user_id = b.owner_id
     WHERE b.harbor_id = ? AND b.visibility = 'public' AND b.hidden_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.owner_id AND u.suspended_at IS NOT NULL)
     ORDER BY b.name LIMIT 200`,
  )
    .bind(h.id)
    .all<{ id: string; name: string; boat_type: string; length_m: number | null; owner_handle: string | null; owner_name: string | null; owner_public: number | null }>();
  const { results: voyages } = await env.DB.prepare(
    `${SHARE_SELECT} WHERE b.harbor_id = ? AND b.visibility = 'public' AND b.hidden_at IS NULL AND s.visibility = 'public' AND s.hidden_at IS NULL
     ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT 30`,
  )
    .bind(h.id)
    .all<ShareRow>();
  const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS voyages, COALESCE(SUM(s.dist_nm), 0) AS dist,
       COALESCE(SUM(CASE WHEN COALESCE(s.started_at, s.created_at) >= ?2 THEN s.dist_nm END), 0) AS season
     FROM shares s JOIN boats b ON b.id = s.boat_id
     WHERE b.harbor_id = ?1 AND b.visibility = 'public' AND b.hidden_at IS NULL AND s.visibility = 'public' AND s.hidden_at IS NULL`,
  )
    .bind(h.id, yearStart)
    .first<{ voyages: number; dist: number; season: number }>();
  // Vereine, die das Konto verwaltet – zur Zuordnung „Verein des Hafens“
  const { results: manageable } = user
    ? await env.DB.prepare(
        `SELECT g.id, g.slug, g.name FROM group_members m JOIN groups g ON g.id = m.group_id
         WHERE m.user_id = ? AND m.role IN ('owner', 'admin') AND g.kind = 'club' AND g.hidden_at IS NULL ORDER BY g.name`,
      )
        .bind(user.id)
        .all<{ id: string; slug: string; name: string }>()
    : { results: [] as Array<{ id: string; slug: string; name: string }> };
  const club = await harborClub(env, h.club_id);
  // Vereine und Teams mit diesem Heimathafen (Konzept 13.3) – nur öffentliche
  const { results: groups } = await env.DB.prepare(
    `SELECT slug, name, kind FROM groups WHERE harbor_id = ? AND visibility = 'public' AND hidden_at IS NULL ORDER BY kind, name LIMIT 100`,
  )
    .bind(h.id)
    .all<{ slug: string; name: string; kind: 'club' | 'team' }>();
  const ownClub = !!h.club_id && manageable.some((c) => c.id === h.club_id);
  return json({
    harbor: harborShape(env, h, user?.id ?? null),
    club: club ? { slug: club.slug, name: club.name, kind: club.kind } : null,
    groups,
    stats: { boats: boats.length, voyages: stats?.voyages ?? 0, distNm: stats?.dist ?? 0, seasonNm: stats?.season ?? 0 },
    boats: boats.map((b) => ({
      id: b.id,
      name: b.name,
      boatType: b.boat_type,
      lengthM: b.length_m,
      owner: b.owner_public && b.owner_handle ? { handle: b.owner_handle, displayName: b.owner_name ?? '' } : null,
    })),
    voyages: voyages.map((r) => shareShape(r, false)),
    social: await followStats(env, 'harbor', h.id, user?.id ?? null),
    // Verein zuordnen: nur Vereine, die das Konto verwaltet, und nur wenn frei oder schon einer davon
    clubChoices: !h.club_id || ownClub || isAdmin(env, user?.id) ? manageable.map((c) => ({ id: c.id, slug: c.slug, name: c.name })) : [],
    canClearClub: !!h.club_id && (ownClub || isAdmin(env, user?.id)),
  });
}

/** PATCH /api/harbors/:id – Name/Position (Anleger:in, Moderation), Verein (Eigner/Admins des Vereins). */
export async function updateHarbor(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const h = await loadHarbor(env, id);
  const admin = isAdmin(env, user.id);
  if (!harborVisible(h, admin)) throw HARBOR_NOT_FOUND();
  const input = await readJson<{ name?: unknown; lat?: unknown; lon?: unknown; clubId?: unknown }>(request);
  const editsBasics = input.name !== undefined || input.lat !== undefined || input.lon !== undefined;
  if (editsBasics && !canEditHarbor(env, h, user.id)) throw new HttpError(403, 'forbidden', 'Name und Position ändert, wer den Hafen angelegt hat.');
  if (input.name !== undefined) {
    const name = cleanText(input.name, HARBOR_LIMITS.nameMax);
    const key = harborKey(name);
    if (!key) throw new HttpError(400, 'invalid_name', 'Bitte einen Hafennamen angeben.');
    const other = await env.DB.prepare('SELECT id FROM harbors WHERE name_key = ? AND id <> ?').bind(key, h.id).first();
    if (other) throw new HttpError(409, 'harbor_exists', 'Einen Hafen mit diesem Namen gibt es schon.');
    h.name = name;
    h.name_key = key;
  }
  if (input.lat !== undefined || input.lon !== undefined) {
    const pos = parseHarborPosition(input.lat ?? null, input.lon ?? null);
    if (!pos) throw new HttpError(400, 'invalid_position', 'Bitte Breite (−90 bis 90) und Länge (−180 bis 180) angeben – oder beides leer lassen.');
    h.lat = pos.lat;
    h.lon = pos.lon;
  }
  if (input.clubId !== undefined) {
    const role = async (gid: string) => (await env.DB.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').bind(gid, user.id).first<{ role: string }>())?.role ?? null;
    const managesCurrent = !!h.club_id && canManageGroup((await role(h.club_id)) as never);
    if (input.clubId === null || input.clubId === '') {
      if (h.club_id && !managesCurrent && !admin) throw new HttpError(403, 'forbidden', 'Den Verein lösen Eigner und Admins dieses Vereins.');
      h.club_id = null;
    } else {
      const g = typeof input.clubId === 'string' && SHARE_ID_RE.test(input.clubId)
        ? await env.DB.prepare(`SELECT id, kind FROM groups WHERE id = ? AND hidden_at IS NULL`).bind(input.clubId).first<{ id: string; kind: string }>()
        : null;
      if (!g || g.kind !== 'club' || !canManageGroup((await role(g.id)) as never)) throw new HttpError(400, 'invalid_club', 'Zuordnen kannst du nur einen Verein, den du verwaltest.');
      if (h.club_id && h.club_id !== g.id && !managesCurrent && !admin) throw new HttpError(409, 'club_taken', 'Dieser Hafen gehört schon zu einem anderen Verein.');
      h.club_id = g.id;
    }
  }
  h.updated_at = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE harbors SET name = ?, name_key = ?, lat = ?, lon = ?, club_id = ?, updated_at = ? WHERE id = ?').bind(h.name, h.name_key, h.lat, h.lon, h.club_id, h.updated_at, h.id),
    // Anzeige-Kopie an den Booten nachführen
    env.DB.prepare('UPDATE boats SET home_port = ? WHERE harbor_id = ?').bind(h.name, h.id),
    env.DB.prepare('UPDATE groups SET home_port = ? WHERE harbor_id = ?').bind(h.name, h.id),
  ]);
  return json({ harbor: harborShape(env, h, user.id) });
}

/** Löscht einen Hafen (Moderation): Boote verlieren die Zuordnung, Heimatwahl, Folgen, Aktivitäten und Meldungen fallen. */
export async function removeHarbor(env: Env, id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'harbor' AND target_id = ?`).bind(id),
    ...harborActivityCleanup(env, id),
    env.DB.prepare(`UPDATE boats SET harbor_id = NULL, home_port = '' WHERE harbor_id = ?`).bind(id),
    env.DB.prepare(`UPDATE groups SET harbor_id = NULL, home_port = '' WHERE harbor_id = ?`).bind(id),
    env.DB.prepare('UPDATE users SET home_harbor_id = NULL WHERE home_harbor_id = ?').bind(id),
    env.DB.prepare('DELETE FROM harbors WHERE id = ?').bind(id),
  ]);
}
