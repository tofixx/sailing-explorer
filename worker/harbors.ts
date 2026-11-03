// Häfen (Konzept 12.2, F-171 … F-175): Autovervollständigung, Anlegen mit Dubletten-Erkennung, Bearbeiten,
// Hafenseite. Häfen sind immer öffentlich (nur Name und Ort); gelistet werden darin nur öffentliche Boote und Törns.
import type { Env } from './env';
import { IN_LOGBOOK_SQL, RECORDED_NM_SQL } from './logbook-sql';
import { currentUser, requireUser, type User } from './auth';
import { randomId } from './crypto';
import { HttpError, json, readJson } from './http';
import { LOCKED, adminLogStmt, assertActive, isAdmin, isLockedTarget } from './moderation';
import { SHARE_SELECT, shareShape, type ShareRow } from './shares';
import { followStats } from './follows';
import { harborActivityCleanup } from './activity';
import { reachAtLeastSql } from './reach-sql';
import { writableChannel } from './post-chain';
import { LIMITS, SHARE_ID_RE, cleanText } from './validate';
import { HARBOR_LIMITS, harborKey, harborSlugBase, isHarborSlug, mayPlaceHarbor, parseHarborPosition, type HarborRef } from '../src/domain/harbors';
import { canManageGroup, seasonStart } from '../src/domain/groups';
import { claimTargetCleanup, mayAdoptHarbor } from './claim-cleanup';
import { notSuspendedSql, publicSql } from './visible-sql';

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
  /** verifizierte Vertretung (0026, Konzept 20) */
  verified_at?: number | null;
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

/** Hafen über eine alte Adresse (zusammengeführt, Konzept 18.7) – null, wenn es keine Weiterleitung gibt. */
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
/**
 * Hafen zum Namen: vorhandener (gleicher Vergleichsname) oder neu angelegt. `pos`: Lage des neuen Hafens; mit
 * `requirePos` (Anlegen über die Oberfläche, F-353) ohne Lage 400 `position_required`.
 */
export async function harborForName(env: Env, user: Pick<User, 'id'>, rawName: unknown, pos: { lat: number; lon: number } | null = null, requirePos = false): Promise<{ harbor: HarborRow; created: boolean }> {
  const name = cleanText(rawName, HARBOR_LIMITS.nameMax);
  const key = harborKey(name);
  if (!key) throw new HttpError(400, 'invalid_name', 'Bitte einen Hafennamen angeben.');
  const existing = await env.DB.prepare('SELECT * FROM harbors WHERE name_key = ?').bind(key).first<HarborRow>();
  if (existing) {
    if (existing.hidden_at) throw INVALID_HARBOR();
    return { harbor: existing, created: false };
  }
  if (requirePos && !pos) throw new HttpError(400, 'position_required', 'Bitte die Lage des neuen Hafens auf der Karte antippen.');
  await assertActive(env, user);
  const now = Date.now();
  const today = (await env.DB.prepare('SELECT COUNT(*) AS n FROM harbors WHERE created_by = ? AND created_at > ?').bind(user.id, now - DAY).first<{ n: number }>())?.n ?? 0;
  if (today >= HARBOR_LIMITS.perDay) throw new HttpError(429, 'harbor_quota', `Du hast heute schon ${HARBOR_LIMITS.perDay} Häfen angelegt – morgen geht es weiter.`);
  const base = harborSlugBase(name);
  let slug = base;
  // auch keine Adresse, die auf einen zusammengeführten Hafen weiterleitet (Konzept 18.7)
  const taken = (s: string) => env.DB.prepare('SELECT 1 AS x FROM harbors WHERE slug = ?1 UNION ALL SELECT 1 FROM harbor_redirects WHERE old_slug = ?1').bind(s).first();
  for (let i = 0; i < 5 && (await taken(slug)); i++) {
    slug = `${base.slice(0, 24)}-${randomId(5).toLowerCase()}`;
  }
  const h: HarborRow = { id: randomId(), slug, name, name_key: key, lat: pos?.lat ?? null, lon: pos?.lon ?? null, club_id: null, created_by: user.id, hidden_at: null, created_at: now, updated_at: now };
  try {
    await env.DB.prepare('INSERT INTO harbors (id, slug, name, name_key, lat, lon, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(h.id, h.slug, h.name, h.name_key, h.lat, h.lon, h.created_by, now, now)
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
 * Hafen-Eingabe am Boot bzw. an der Gruppe: `harborId` (Zeichenkette oder null) hat Vorrang, sonst `homePort` als
 * Text. Schickt die Oberfläche `homePortPos` mit (auch null), braucht ein neuer Hafen eine Lage (F-353); alte Clients
 * ohne das Feld legen ihn wie bisher ohne Lage an. undefined = keine Änderung, null = keinen Hafen.
 */
export async function harborFromBoatInput(env: Env, user: Pick<User, 'id'>, input: { harborId?: unknown; homePort?: unknown; homePortPos?: unknown }): Promise<HarborRow | null | undefined> {
  if (input.harborId !== undefined) {
    if (input.harborId === null || input.harborId === '') return null;
    const h = await loadHarbor(env, input.harborId);
    if (!harborVisible(h)) throw INVALID_HARBOR();
    return h;
  }
  if (input.homePort !== undefined) {
    if (!cleanText(input.homePort, LIMITS.nameLength)) return null;
    const withPos = input.homePortPos !== undefined;
    const raw = input.homePortPos as { lat?: unknown; lon?: unknown } | null | undefined;
    const p = raw ? parseHarborPosition(raw.lat, raw.lon) : null;
    const pos = p && p.lat !== null && p.lon !== null ? { lat: p.lat, lon: p.lon } : null;
    return (await harborForName(env, user, input.homePort, pos, withPos)).harbor;
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
    `SELECT h.id, h.slug, h.name, h.lat, h.lon, h.verified_at, (SELECT COUNT(*) FROM boats b WHERE b.harbor_id = h.id) AS boats
     FROM harbors h WHERE h.hidden_at IS NULL AND h.name_key LIKE ?1 ESCAPE '\\'
     ORDER BY (h.name_key LIKE ?2 ESCAPE '\\') DESC, boats DESC, h.name LIMIT ?3`,
  )
    .bind(like, prefix, HARBOR_LIMITS.search)
    .all<{ id: string; slug: string; name: string; lat: number | null; lon: number | null; verified_at: number | null; boats: number }>();
  // Position für das Fahrtenbuch (fehlt sie, fragt das Formular danach – L3)
  return json({ harbors: results.map((h) => ({ ...harborRef(h), lat: h.lat, lon: h.lon, boats: h.boats, verified: !!h.verified_at })) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

/**
 * POST /api/harbors – `{ name, lat?, lon? }`: vorhandener Hafen (200) oder neuer (201). Wer neu anlegt, setzt die
 * Position gleich mit (L3, F-307); für vorhandene Häfen gilt PATCH.
 */
export async function createHarbor(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { name, lat, lon } = await readJson<{ name?: unknown; lat?: unknown; lon?: unknown }>(request);
  const pos = lat === undefined && lon === undefined ? null : parseHarborPosition(lat, lon);
  if (pos === undefined) throw new HttpError(400, 'invalid_position', 'Ungültige Position.');
  const { harbor, created } = await harborForName(env, user, name, pos && pos.lat !== null && pos.lon !== null ? { lat: pos.lat, lon: pos.lon } : null, true);
  // Position mit (Fahrtenbuch, F-307)
  return json({ harbor: { ...harborRef(harbor), lat: harbor.lat, lon: harbor.lon }, created }, { status: created ? 201 : 200 });
}

/** Verein des Hafens nur, wenn öffentlich und nicht ausgeblendet. */
async function harborClub(env: Env, clubId: string | null) {
  if (!clubId) return null;
  return env.DB.prepare(`SELECT id, slug, name, kind FROM groups WHERE id = ? AND kind = 'club' AND ${publicSql()}`)
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
    // Abzeichen „Verifiziert“ (Konzept 20.4, F-366)
    verified: !!h.verified_at,
    hiddenAt: isAdmin(env, viewerId) ? h.hidden_at : null,
    createdAt: h.created_at,
  };
}

/** Törn mit „Sichtbar bis“ mindestens Hafen (F-427) – „nur hier“ und „bis Verein“ stehen nicht auf der Hafenseite. */
const REACHES_HARBOR = reachAtLeastSql('s.id', 'harbor');

/** GET /api/harbors/slug/:slug – Hafenseite (F-173). */
export async function getHarbor(request: Request, env: Env, slug: string): Promise<Response> {
  const h = (await loadHarborBySlug(env, slug)) ?? (await loadHarborByRedirect(env, slug));
  const user = await currentUser(request, env);
  if (!harborVisible(h, isAdmin(env, user?.id))) throw HARBOR_NOT_FOUND();
  const { results: boats } = await env.DB.prepare(
    `SELECT b.id, b.name, b.boat_type, b.length_m, p.handle AS owner_handle, p.display_name AS owner_name,
       (${publicSql('p')}) AS owner_public
     FROM boats b LEFT JOIN profiles p ON p.user_id = b.owner_id
     WHERE b.harbor_id = ? AND ${publicSql('b')}
       AND ${notSuspendedSql('b.owner_id')}
     ORDER BY b.name LIMIT 200`,
  )
    .bind(h.id)
    .all<{ id: string; name: string; boat_type: string; length_m: number | null; owner_handle: string | null; owner_name: string | null; owner_public: number | null }>();
  const { results: voyages } = await env.DB.prepare(
    `${SHARE_SELECT} WHERE b.harbor_id = ? AND ${publicSql('b')} AND ${publicSql('s')} AND ${REACHES_HARBOR}
     ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT 30`,
  )
    .bind(h.id)
    .all<ShareRow>();
  const yearStart = seasonStart(Date.now());
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS voyages, COALESCE(SUM(s.dist_nm), 0) AS dist, ${RECORDED_NM_SQL} AS rec,
       COALESCE(SUM(CASE WHEN COALESCE(s.started_at, s.created_at) >= ?2 THEN s.dist_nm END), 0) AS season
     FROM shares s JOIN boats b ON b.id = s.boat_id
     WHERE b.harbor_id = ?1 AND ${publicSql('b')} AND ${publicSql('s')} AND ${IN_LOGBOOK_SQL} AND ${REACHES_HARBOR}`,
  )
    .bind(h.id, yearStart)
    .first<{ voyages: number; dist: number; rec: number; season: number }>();
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
    `SELECT slug, name, kind FROM groups WHERE harbor_id = ? AND ${publicSql()} ORDER BY kind, name LIMIT 100`,
  )
    .bind(h.id)
    .all<{ slug: string; name: string; kind: 'club' | 'team' }>();
  const ownClub = !!h.club_id && manageable.some((c) => c.id === h.club_id);
  // Verifizierter Hafen: nur Hafen-Vertretung und Moderation ordnen den Verein zu (Konzept 20.5)
  const isRep = !!user && !!h.verified_at && h.created_by === user.id;
  const clubLocked = !!h.verified_at && !isRep && !isAdmin(env, user?.id);
  return json({
    harbor: harborShape(env, h, user?.id ?? null),
    club: club ? { slug: club.slug, name: club.name, kind: club.kind } : null,
    groups,
    stats: { boats: boats.length, voyages: stats?.voyages ?? 0, distNm: stats?.dist ?? 0, recordedNm: stats?.rec ?? 0, seasonNm: stats?.season ?? 0 },
    boats: boats.map((b) => ({
      id: b.id,
      name: b.name,
      boatType: b.boat_type,
      lengthM: b.length_m,
      owner: b.owner_public && b.owner_handle ? { handle: b.owner_handle, displayName: b.owner_name ?? '' } : null,
    })),
    voyages: voyages.map((r) => shareShape(r, false, false)),
    social: await followStats(env, 'harbor', h.id, user?.id ?? null),
    // Verein zuordnen: nur Vereine, die das Konto verwaltet, und nur wenn frei oder schon einer davon
    clubChoices: !clubLocked && (!h.club_id || ownClub || isAdmin(env, user?.id) || isRep) ? manageable.map((c) => ({ id: c.id, slug: c.slug, name: c.name })) : [],
    canClearClub: !clubLocked && !!h.club_id && (ownClub || isAdmin(env, user?.id) || isRep),
    // „Beitrag schreiben“ (F-405, F-425): Boot hier, Anleger:in bzw. Vertretung, Moderation (B6)
    canPost: !!user && !!(await writableChannel(env, user.id, 'harbor', h.id)),
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
  // Altbestand ohne Anleger:in und ohne Position (L3, F-307): wer als Erste:r die Position setzt, wird Anleger:in.
  // Je verifizierte Häfen übernimmt so niemand (Konzept 20.5, F-367).
  const adopts = input.name === undefined && h.created_by === null && h.lat === null && mayPlaceHarbor(h, user.id) && (await mayAdoptHarbor(env, h.id));
  if (editsBasics && !adopts && !canEditHarbor(env, h, user.id)) throw new HttpError(403, 'forbidden', 'Name und Position ändert, wer den Hafen angelegt hat.');
  // Gesperrte Häfen (Konzept 18.2) ändert niemand – auch die Moderation erst nach dem Entsperren
  if (await isLockedTarget(env, 'harbor', h.id)) throw LOCKED();
  const before = h.name;
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
    if (adopts && pos.lat !== null) h.created_by = user.id;
  }
  // Verifizierter Hafen (Konzept 20.5, F-371): den Verein ordnen nur Hafen-Vertretung und Moderation zu
  if (input.clubId !== undefined && h.verified_at && h.created_by !== user.id && !admin) {
    throw new HttpError(403, 'verified_harbor', 'Den Verein dieses verifizierten Hafens ordnet die Hafen-Vertretung zu.');
  }
  if (input.clubId !== undefined) {
    const role = async (gid: string) => (await env.DB.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').bind(gid, user.id).first<{ role: string }>())?.role ?? null;
    // Die verifizierte Hafen-Vertretung darf den bisherigen Verein lösen bzw. ersetzen (Konzept 20.5)
    const managesCurrent = (!!h.verified_at && h.created_by === user.id) || (!!h.club_id && canManageGroup((await role(h.club_id)) as never));
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
    env.DB.prepare('UPDATE harbors SET name = ?, name_key = ?, lat = ?, lon = ?, club_id = ?, created_by = ?, updated_at = ? WHERE id = ?').bind(h.name, h.name_key, h.lat, h.lon, h.club_id, h.created_by, h.updated_at, h.id),
    // Anzeige-Kopie an den Booten nachführen
    env.DB.prepare('UPDATE boats SET home_port = ? WHERE harbor_id = ?').bind(h.name, h.id),
    env.DB.prepare('UPDATE groups SET home_port = ? WHERE harbor_id = ?').bind(h.name, h.id),
    // Ändert die Moderation einen fremden Hafen, steht das im Admin-Protokoll (Konzept 18.10)
    ...(admin && h.created_by !== user.id ? [adminLogStmt(env, user.id, 'harbor_edit', 'harbor', h.id, before === h.name ? '' : `${before} → ${h.name}`, h.updated_at)] : []),
  ]);
  return json({ harbor: harborShape(env, h, user.id) });
}

/** Löscht einen Hafen (Moderation): Boote verlieren die Zuordnung, Heimatwahl, Folgen, Aktivitäten und Meldungen fallen. */
export async function removeHarbor(env: Env, id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'harbor' AND target_id = ?`).bind(id),
    ...harborActivityCleanup(env, id),
    ...claimTargetCleanup(env, 'harbor', id),
    env.DB.prepare(`UPDATE boats SET harbor_id = NULL, home_port = '' WHERE harbor_id = ?`).bind(id),
    env.DB.prepare(`UPDATE groups SET harbor_id = NULL, home_port = '' WHERE harbor_id = ?`).bind(id),
    env.DB.prepare('UPDATE users SET home_harbor_id = NULL WHERE home_harbor_id = ?').bind(id),
    env.DB.prepare('DELETE FROM harbor_redirects WHERE harbor_id = ?').bind(id),
    env.DB.prepare('DELETE FROM harbors WHERE id = ?').bind(id),
  ]);
}
