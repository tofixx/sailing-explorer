import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { canView, nextShareKey, requestKey } from './access';
import { isAdmin } from './moderation';
import { publicShares } from './shares';
import { boatCleanup, recordHarborBoat } from './activity';
import { harborFromBoatInput, type HarborRow } from './harbors';
import { followStats } from './follows';
import { loadCover, pageCover } from './covers';
import { galleryPhotos } from './gallery';
import { checkBoatQuota, checkVisibilityChoice } from './supporter';
import { BOAT_ID_RE, LIMITS, cleanText, parseVisibility } from './validate';
import { DEFAULT_VISIBILITY, sharePath, type Visibility } from '../src/domain/visibility';

interface BoatRow {
  id: string;
  owner_id: string;
  name: string;
  boat_type: string;
  length_m: number | null;
  sail_number: string;
  /** Anzeige-Kopie des Hafennamens (Konzept 12.2) */
  home_port: string;
  /** Hafen des Boots (0013) */
  harbor_id?: string | null;
  description: string;
  /** frei gewählter Eigner (Konzept 13.5), z. B. „Familie Schmidt“ oder „SC Möwe e. V.“; leer = Konto des Eigners */
  owner_label?: string;
  visibility: Visibility;
  /** Schlüssel für „Nur mit Link“ (0006) */
  share_key: string | null;
  /** per Meldung oder Admin ausgeblendet (0009) */
  hidden_at?: number | null;
  created_at: number;
  updated_at: number;
  /** aus JOIN/Aggregaten */
  owner_handle?: string | null;
  owner_name?: string | null;
  owner_public?: number | null;
  /** aus dem JOIN mit harbors (nur nicht ausgeblendete) */
  harbor_slug?: string | null;
  harbor_name?: string | null;
}

export type Role = 'owner' | 'admin' | null;

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Boot gibt es nicht (mehr).');

/** Eigner oder eingetragener Admin. */
export async function canManageBoat(env: Env, userId: string, boatId: string): Promise<boolean> {
  return (await roleFor(env, userId, boatId)) !== null;
}

/** Rolle des Kontos am Boot: Eigner, Admin oder keine (auch bei unbekanntem Boot). */
export async function roleFor(env: Env, userId: string, boatId: string): Promise<Role> {
  const row = await env.DB.prepare(
    `SELECT CASE WHEN b.owner_id = ?1 THEN 'owner' WHEN a.user_id IS NOT NULL THEN 'admin' END AS role
     FROM boats b LEFT JOIN boat_admins a ON a.boat_id = b.id AND a.user_id = ?1 WHERE b.id = ?2`,
  )
    .bind(userId, boatId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

const BOAT_SELECT = `SELECT b.*, p.handle AS owner_handle, p.display_name AS owner_name, (p.visibility = 'public' AND p.hidden_at IS NULL) AS owner_public,
    h.slug AS harbor_slug, h.name AS harbor_name
  FROM boats b LEFT JOIN profiles p ON p.user_id = b.owner_id LEFT JOIN harbors h ON h.id = b.harbor_id AND h.hidden_at IS NULL`;

/** Für andere Abfragen über `boats b`: Hafen (nur nicht ausgeblendet) dazu. */
export const BOAT_HARBOR_COLS = `(SELECT slug FROM harbors WHERE id = b.harbor_id AND hidden_at IS NULL) AS harbor_slug,
  (SELECT name FROM harbors WHERE id = b.harbor_id AND hidden_at IS NULL) AS harbor_name`;

async function stats(env: Env, boatId: string) {
  const s = await env.DB.prepare(
    `SELECT COUNT(*) AS voyages, COALESCE(SUM(dist_nm), 0) AS dist FROM shares WHERE boat_id = ? AND visibility = 'public' AND hidden_at IS NULL`,
  )
    .bind(boatId)
    .first<{ voyages: number; dist: number }>();
  return { voyages: s?.voyages ?? 0, distNm: s?.dist ?? 0 };
}

export function boatShape(b: BoatRow, role: Role) {
  const harbor = b.harbor_id && b.harbor_slug ? { id: b.harbor_id, slug: b.harbor_slug, name: b.harbor_name ?? '' } : null;
  return {
    id: b.id,
    name: b.name,
    boatType: b.boat_type,
    lengthM: b.length_m,
    sailNumber: b.sail_number,
    // Name des Hafens (ausgeblendeter Hafen: leer)
    homePort: harbor ? harbor.name : b.harbor_id ? '' : b.home_port,
    harbor,
    description: b.description,
    /** frei gewählter Eigner – ersetzt in der Anzeige das Konto des Eigners */
    ownerLabel: b.owner_label ?? '',
    visibility: b.visibility,
    // Schlüssel und Link nur für Eigner und Admins (Konzept 2.4).
    shareKey: role ? (b.share_key ?? null) : null,
    link: role ? sharePath('b', b.id, b.visibility, b.share_key ?? null) : null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    // Eigner nur zeigen, wenn dessen Profil öffentlich ist (oder man selbst verwaltet)
    owner: b.owner_handle && (b.owner_public || role) ? { handle: b.owner_handle, displayName: b.owner_name ?? '' } : null,
    role,
    /** nur Verwalter erfahren, dass die Seite bis zur Prüfung ausgeblendet ist (Konzept 4.4) */
    hiddenAt: role ? (b.hidden_at ?? null) : null,
  };
}

interface BoatInput {
  name?: unknown;
  boatType?: unknown;
  lengthM?: unknown;
  sailNumber?: unknown;
  homePort?: unknown;
  /** Hafen (Konzept 12.2): ID oder null; hat Vorrang vor homePort */
  harborId?: unknown;
  description?: unknown;
  /** frei gewählter Eigner (Eigner und Boots-Admins) */
  ownerLabel?: unknown;
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
  if (input.description !== undefined) b.description = cleanText(input.description, LIMITS.bioLength);
  if (input.ownerLabel !== undefined) b.owner_label = cleanText(input.ownerLabel, LIMITS.nameLength);
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

/** Hafen übernehmen: undefined = unverändert, null = keiner; home_port ist die Anzeige-Kopie des Namens. */
function setHarbor(b: BoatRow, harbor: HarborRow | null | undefined): void {
  if (harbor === undefined) return;
  b.harbor_id = harbor?.id ?? null;
  b.home_port = harbor?.name ?? '';
  b.harbor_slug = harbor?.slug ?? null;
  b.harbor_name = harbor?.name ?? null;
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
  // Kontingent (Konzept 5.1): kostenlos 3, Unterstützer 20 Boote als Eigner – 402 bzw. 409, bestehende bleiben.
  await checkBoatQuota(env, user.id);
  const now = Date.now();
  const b: BoatRow = {
    id: randomId(), owner_id: user.id, name: '', boat_type: '', length_m: null, sail_number: '', home_port: '',
    description: '', owner_label: '', visibility: DEFAULT_VISIBILITY, share_key: null, created_at: now, updated_at: now,
  };
  const input = await readJson<BoatInput>(request);
  // Neue Boote sind öffentlich (E1); eine andere Stufe nur mit Unterstützer-Status.
  await applyVisibility(env, b, applyInput(b, { name: '', ...input }) ?? DEFAULT_VISIBILITY, false, true);
  const harbor = await harborFromBoatInput(env, user, input);
  setHarbor(b, harbor);
  await env.DB.prepare(
    `INSERT INTO boats (id, owner_id, name, boat_type, length_m, sail_number, home_port, harbor_id, description, owner_label, visibility, share_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(b.id, b.owner_id, b.name, b.boat_type, b.length_m, b.sail_number, b.home_port, b.harbor_id ?? null, b.description, b.owner_label ?? '', b.visibility, b.share_key, now, now)
    .run();
  if (harbor) await recordHarborBoat(env, harbor.id, b.id, user.id, now);
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
  if (!b || !canView({ visibility: b.visibility, shareKey: b.share_key ?? null, hiddenAt: b.hidden_at ?? null }, { manager: !!role, key, admin: isAdmin(env, user?.id) })) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  return json({
    boat: boatShape(b, role),
    stats: await stats(env, id),
    voyages: await publicShares(env, 'boat', id),
    social: await followStats(env, 'boat', id, user?.id ?? null),
    // Titelbild und neueste öffentliche Fotos der Törns mit diesem Boot (Konzept 13)
    ...pageCover('b', b.id, await loadCover(env, 'b', b.id), b.visibility === 'public' ? null : key),
    photos: await galleryPhotos(env, 'boat', b.id),
    // „Verein des Boots“ (Konzept 12.2): öffentliche, nicht ausgeblendete Vereine, denen das Boot zugeordnet ist
    clubs: (
      await env.DB.prepare(
        `SELECT g.slug, g.name, g.kind FROM group_boats gb JOIN groups g ON g.id = gb.group_id
         WHERE gb.boat_id = ? AND g.kind = 'club' AND g.visibility = 'public' AND g.hidden_at IS NULL ORDER BY g.name`,
      )
        .bind(id)
        .all<{ slug: string; name: string; kind: 'club' }>()
    ).results,
  });
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
  const before = b.harbor_id ?? null;
  const harbor = await harborFromBoatInput(env, user, input);
  setHarbor(b, harbor);
  b.updated_at = Date.now();
  await env.DB.prepare(
    `UPDATE boats SET name = ?, boat_type = ?, length_m = ?, sail_number = ?, home_port = ?, harbor_id = ?, description = ?, owner_label = ?, visibility = ?, share_key = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(b.name, b.boat_type, b.length_m, b.sail_number, b.home_port, b.harbor_id ?? null, b.description, b.owner_label ?? '', b.visibility, b.share_key, b.updated_at, id)
    .run();
  if (harbor && harbor.id !== before) await recordHarborBoat(env, harbor.id, b.id, user.id, b.updated_at);
  return json({ boat: boatShape(b, role) });
}

/** DELETE /api/boats/:id – nur der Eigner. Törns bleiben erhalten, verlieren nur die Zuordnung. */
export async function deleteBoat(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (!BOAT_ID_RE.test(id) || (await roleFor(env, user.id, id)) !== 'owner') throw NOT_FOUND();
  await env.DB.batch([
    ...boatCleanup(env, id),
    env.DB.prepare('UPDATE shares SET boat_id = NULL WHERE boat_id = ?').bind(id),
    env.DB.prepare('DELETE FROM boat_admins WHERE boat_id = ?').bind(id),
    env.DB.prepare('DELETE FROM invites WHERE boat_id = ?').bind(id),
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'boat' AND target_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM boats WHERE id = ?').bind(id),
  ]);
  return new Response(null, { status: 204 });
}
