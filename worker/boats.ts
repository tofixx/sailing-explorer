import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { canView, nextShareKey, requestKey } from './access';
import { publicShares } from './shares';
import { checkVisibilityChoice } from './supporter';
import { BOAT_ID_RE, LIMITS, cleanText, parseVisibility } from './validate';
import { DEFAULT_VISIBILITY, sharePath, type Visibility } from '../src/domain/visibility';

interface BoatRow {
  id: string;
  owner_id: string;
  name: string;
  boat_type: string;
  length_m: number | null;
  sail_number: string;
  home_port: string;
  description: string;
  visibility: Visibility;
  /** Schlüssel für „Nur mit Link“ (0006) */
  share_key: string | null;
  created_at: number;
  updated_at: number;
  /** aus JOIN/Aggregaten */
  owner_handle?: string | null;
  owner_name?: string | null;
  owner_public?: number | null;
}

type Role = 'owner' | 'admin' | null;

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Boot gibt es nicht (mehr).');

/** Eigner oder eingetragener Admin. */
export async function canManageBoat(env: Env, userId: string, boatId: string): Promise<boolean> {
  return (await roleFor(env, userId, boatId)) !== null;
}

async function roleFor(env: Env, userId: string, boatId: string): Promise<Role> {
  const row = await env.DB.prepare(
    `SELECT CASE WHEN b.owner_id = ?1 THEN 'owner' WHEN a.user_id IS NOT NULL THEN 'admin' END AS role
     FROM boats b LEFT JOIN boat_admins a ON a.boat_id = b.id AND a.user_id = ?1 WHERE b.id = ?2`,
  )
    .bind(userId, boatId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

const BOAT_SELECT = `SELECT b.*, p.handle AS owner_handle, p.display_name AS owner_name, (p.visibility = 'public') AS owner_public
  FROM boats b LEFT JOIN profiles p ON p.user_id = b.owner_id`;

async function stats(env: Env, boatId: string) {
  const s = await env.DB.prepare(
    `SELECT COUNT(*) AS voyages, COALESCE(SUM(dist_nm), 0) AS dist FROM shares WHERE boat_id = ? AND visibility = 'public'`,
  )
    .bind(boatId)
    .first<{ voyages: number; dist: number }>();
  return { voyages: s?.voyages ?? 0, distNm: s?.dist ?? 0 };
}

export function boatShape(b: BoatRow, role: Role) {
  return {
    id: b.id,
    name: b.name,
    boatType: b.boat_type,
    lengthM: b.length_m,
    sailNumber: b.sail_number,
    homePort: b.home_port,
    description: b.description,
    visibility: b.visibility,
    // Schlüssel und Link nur für Eigner und Admins (Konzept 2.4).
    shareKey: role ? (b.share_key ?? null) : null,
    link: role ? sharePath('b', b.id, b.visibility, b.share_key ?? null) : null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    // Eigner nur zeigen, wenn dessen Profil öffentlich ist (oder man selbst verwaltet)
    owner: b.owner_handle && (b.owner_public || role) ? { handle: b.owner_handle, displayName: b.owner_name ?? '' } : null,
    role,
  };
}

interface BoatInput {
  name?: unknown;
  boatType?: unknown;
  lengthM?: unknown;
  sailNumber?: unknown;
  homePort?: unknown;
  description?: unknown;
  visibility?: unknown;
  rotateKey?: unknown;
}

/** Übernimmt die Eingaben; liefert die gewünschte neue Sichtbarkeit (E1-Prüfung und Schlüssel macht der Aufrufer). */
function applyInput(b: BoatRow, input: BoatInput): Visibility | null {
  if (input.name !== undefined) {
    const name = cleanText(input.name, LIMITS.nameLength);
    if (!name) throw new HttpError(400, 'invalid_name', 'Bitte einen Bootsnamen angeben.');
    b.name = name;
  }
  if (input.boatType !== undefined) b.boat_type = cleanText(input.boatType, LIMITS.nameLength);
  if (input.sailNumber !== undefined) b.sail_number = cleanText(input.sailNumber, 20);
  if (input.homePort !== undefined) b.home_port = cleanText(input.homePort, LIMITS.nameLength);
  if (input.description !== undefined) b.description = cleanText(input.description, LIMITS.bioLength);
  if (input.lengthM !== undefined) {
    const n = input.lengthM === null || input.lengthM === '' ? null : Number(input.lengthM);
    if (n !== null && !(n >= 1 && n <= 150)) throw new HttpError(400, 'invalid_length', 'Länge bitte zwischen 1 und 150 m.');
    b.length_m = n === null ? null : Math.round(n * 100) / 100;
  }
  if (input.visibility === undefined) return null;
  const v = parseVisibility(input.visibility);
  if (!v) throw new HttpError(400, 'invalid_visibility', 'Unbekannte Sichtbarkeit.');
  return v;
}

/**
 * Setzt Sichtbarkeit und Schlüssel. E1 gilt für das Konto des Eigners (das Boot gehört ihm, auch wenn ein Admin ändert);
 * eine schon gesetzte Stufe darf bleiben, auf „Öffentlich“ geht immer.
 */
async function applyVisibility(env: Env, b: BoatRow, next: Visibility | null, rotate: boolean, isNew: boolean): Promise<void> {
  const previous = isNew ? undefined : b.visibility;
  const v = next ?? b.visibility;
  if (next) await checkVisibilityChoice(env, b.owner_id, v, previous);
  b.share_key = nextShareKey(previous ?? null, v, b.share_key, rotate);
  b.visibility = v;
}

/** GET /api/boats – Boote, die ich besitze oder verwalte. */
export async function listMyBoats(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    `${BOAT_SELECT} WHERE b.owner_id = ?1 OR b.id IN (SELECT boat_id FROM boat_admins WHERE user_id = ?1) ORDER BY b.name`,
  )
    .bind(user.id)
    .all<BoatRow>();
  return json({ boats: results.map((b) => boatShape(b, b.owner_id === user.id ? 'owner' : 'admin')) });
}

/** POST /api/boats – Boot anlegen; der Anlegende wird Eigner. */
export async function createBoat(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM boats WHERE owner_id = ?').bind(user.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= LIMITS.boatsPerUser) throw new HttpError(409, 'quota', 'Maximale Anzahl an Booten erreicht.');
  const now = Date.now();
  const b: BoatRow = {
    id: randomId(), owner_id: user.id, name: '', boat_type: '', length_m: null, sail_number: '', home_port: '',
    description: '', visibility: DEFAULT_VISIBILITY, share_key: null, created_at: now, updated_at: now,
  };
  const input = await readJson<BoatInput>(request);
  // Neue Boote sind öffentlich (E1); eine andere Stufe nur mit Unterstützer-Status.
  await applyVisibility(env, b, applyInput(b, { name: '', ...input }) ?? DEFAULT_VISIBILITY, false, true);
  await env.DB.prepare(
    `INSERT INTO boats (id, owner_id, name, boat_type, length_m, sail_number, home_port, description, visibility, share_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(b.id, b.owner_id, b.name, b.boat_type, b.length_m, b.sail_number, b.home_port, b.description, b.visibility, b.share_key, now, now)
    .run();
  return json({ boat: boatShape(b, 'owner') }, { status: 201 });
}

/**
 * GET /api/boats/:id – Bootsseite: öffentlich für alle, „Nur mit Link“ mit X-Share-Key, sonst nur für Verwalter.
 * Listet nur öffentliche Törns (F-83); der Boots-Schlüssel öffnet keine anderen Törns.
 */
export async function getBoat(request: Request, env: Env, id: string): Promise<Response> {
  const key = requestKey(request);
  const b = BOAT_ID_RE.test(id) ? await env.DB.prepare(`${BOAT_SELECT} WHERE b.id = ?`).bind(id).first<BoatRow>() : null;
  const user = await currentUser(request, env);
  const role = b && user ? await roleFor(env, user.id, id) : null;
  if (!b || !canView({ visibility: b.visibility, shareKey: b.share_key ?? null }, { manager: !!role, key })) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  return json({ boat: boatShape(b, role), stats: await stats(env, id), voyages: await publicShares(env, 'boat', id) });
}

/** PATCH /api/boats/:id – Eigner und Admins. */
export async function updateBoat(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (!BOAT_ID_RE.test(id)) throw NOT_FOUND();
  const role = await roleFor(env, user.id, id);
  if (!role) throw NOT_FOUND();
  const b = await env.DB.prepare(`${BOAT_SELECT} WHERE b.id = ?`).bind(id).first<BoatRow>();
  if (!b) throw NOT_FOUND();
  const input = await readJson<BoatInput>(request);
  await applyVisibility(env, b, applyInput(b, input), input.rotateKey === true, false);
  b.updated_at = Date.now();
  await env.DB.prepare(
    `UPDATE boats SET name = ?, boat_type = ?, length_m = ?, sail_number = ?, home_port = ?, description = ?, visibility = ?, share_key = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(b.name, b.boat_type, b.length_m, b.sail_number, b.home_port, b.description, b.visibility, b.share_key, b.updated_at, id)
    .run();
  return json({ boat: boatShape(b, role) });
}

/** DELETE /api/boats/:id – nur der Eigner. Törns bleiben erhalten, verlieren nur die Zuordnung. */
export async function deleteBoat(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (!BOAT_ID_RE.test(id) || (await roleFor(env, user.id, id)) !== 'owner') throw NOT_FOUND();
  await env.DB.batch([
    env.DB.prepare('UPDATE shares SET boat_id = NULL WHERE boat_id = ?').bind(id),
    env.DB.prepare('DELETE FROM boat_admins WHERE boat_id = ?').bind(id),
    env.DB.prepare('DELETE FROM boats WHERE id = ?').bind(id),
  ]);
  return new Response(null, { status: 204 });
}
