import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { boatShape } from './boats';
import { HttpError, json, readJson } from './http';
import { listedShares } from './shares';
import { LIMITS, cleanText, normalizeHandle, parsePublicVisibility } from './validate';

interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  bio: string;
  visibility: 'public' | 'private';
  created_at: number;
  updated_at: number;
}

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Profil gibt es nicht oder es ist privat.');

function profileShape(p: ProfileRow, isSelf: boolean) {
  return { handle: p.handle, displayName: p.display_name, bio: p.bio, visibility: p.visibility, isSelf };
}

/**
 * Vorschlag für ein neues Profil. Bewusst NICHT aus der E-Mail-Adresse abgeleitet –
 * der Profilname ist öffentlich, die Adresse darf nicht durchscheinen.
 */
async function suggestion(env: Env) {
  for (let i = 0; i < 20; i++) {
    const handle = `segler-${Math.floor(1000 + Math.random() * 9000)}`;
    const taken = await env.DB.prepare('SELECT 1 FROM profiles WHERE handle = ?').bind(handle).first();
    if (!taken) return handle;
  }
  return `segler-${Date.now().toString(36)}`;
}

/** GET /api/me/profile – eigenes Profil (oder ein Vorschlag, falls noch keins existiert). */
export async function getMyProfile(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const p = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<ProfileRow>();
  if (p) return json({ profile: profileShape(p, true), exists: true });
  return json({ profile: { handle: await suggestion(env), displayName: '', bio: '', visibility: 'private', isSelf: true }, exists: false });
}

/** PUT /api/me/profile – anlegen oder ändern. */
export async function putMyProfile(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson<{ handle?: unknown; displayName?: unknown; bio?: unknown; visibility?: unknown }>(request);
  const handle = normalizeHandle(body.handle);
  if (!handle) throw new HttpError(400, 'invalid_handle', 'Profilname: 3–30 Zeichen, nur a–z, 0–9 und Bindestrich.');
  const displayName = cleanText(body.displayName, LIMITS.nameLength);
  if (!displayName) throw new HttpError(400, 'invalid_name', 'Bitte einen Anzeigenamen angeben.');
  const bio = cleanText(body.bio, LIMITS.bioLength);
  const visibility = parsePublicVisibility(body.visibility) ?? 'private';

  const taken = await env.DB.prepare('SELECT user_id FROM profiles WHERE handle = ?').bind(handle).first<{ user_id: string }>();
  if (taken && taken.user_id !== user.id) throw new HttpError(409, 'handle_taken', 'Dieser Profilname ist schon vergeben.');

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, handle, display_name, bio, visibility, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT(user_id) DO UPDATE SET handle = ?2, display_name = ?3, bio = ?4, visibility = ?5, updated_at = ?6`,
  )
    .bind(user.id, handle, displayName, bio, visibility, now)
    .run();
  const p = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<ProfileRow>();
  return json({ profile: profileShape(p!, true) });
}

/** GET /api/profiles/:handle – öffentliche Profilseite mit Booten, Statistik und Törns. */
export async function getProfile(request: Request, env: Env, rawHandle: string): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) throw NOT_FOUND();
  const p = await env.DB.prepare('SELECT * FROM profiles WHERE handle = ?').bind(handle).first<ProfileRow>();
  if (!p) throw NOT_FOUND();
  const user = await currentUser(request, env);
  const isSelf = user?.id === p.user_id;
  if (p.visibility !== 'public' && !isSelf) throw NOT_FOUND();

  const { results: boats } = await env.DB.prepare(
    `SELECT b.*, ?2 AS owner_handle, ?3 AS owner_name, 1 AS owner_public FROM boats b
     WHERE b.owner_id = ?1 AND (b.visibility = 'public' OR ?4) ORDER BY b.name`,
  )
    .bind(p.user_id, p.handle, p.display_name, isSelf ? 1 : 0)
    .all();
  const voyages = await listedShares(env, 'user', p.user_id);
  const distNm = voyages.reduce((s, v) => s + v.distNm, 0);
  return json({
    profile: profileShape(p, isSelf),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    boats: boats.map((b: any) => boatShape(b, isSelf ? 'owner' : null)),
    stats: { voyages: voyages.length, distNm },
    voyages,
  });
}
