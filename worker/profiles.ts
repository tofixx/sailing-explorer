import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { boatShape } from './boats';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { canView, nextShareKey, requestKey } from './access';
import { crewShares, publicShares } from './shares';
import { checkVisibilityChoice } from './supporter';
import { LIMITS, cleanText, normalizeHandle, parseVisibility } from './validate';
import { DEFAULT_VISIBILITY, sharePath, type Visibility } from '../src/domain/visibility';
import { funnyName } from '../src/domain/names';

interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  bio: string;
  visibility: Visibility;
  /** Schlüssel für „Nur mit Link“ (0006) */
  share_key: string | null;
  created_at: number;
  updated_at: number;
}

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Profil gibt es nicht oder es ist privat.');

function profileShape(p: ProfileRow, isSelf: boolean) {
  return {
    handle: p.handle,
    displayName: p.display_name,
    bio: p.bio,
    visibility: p.visibility,
    // Schlüssel und Link nur für das eigene Profil (Konzept 2.4).
    shareKey: isSelf ? p.share_key : null,
    link: isSelf ? sharePath('u', p.handle, p.visibility, p.share_key) : null,
    isSelf,
  };
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
  return json({
    // Anzeigename vorgeschlagen: der Spaßname des Kontos – nie etwas aus der E-Mail-Adresse.
    profile: { handle: await suggestion(env), displayName: funnyName(user.id), bio: '', visibility: DEFAULT_VISIBILITY, shareKey: null, link: null, isSelf: true },
    exists: false,
  });
}

/**
 * PUT /api/me/profile – anlegen oder ändern. Sichtbarkeit: fehlt sie, bleibt die bisherige (neu: „Öffentlich“) –
 * nie eine stille Hochstufung (E4/E5). „Nur mit Link“/„Nur ich“ neu setzen nur als Unterstützer (E1).
 */
export async function putMyProfile(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson<{ handle?: unknown; displayName?: unknown; bio?: unknown; visibility?: unknown; rotateKey?: unknown }>(request);
  const handle = normalizeHandle(body.handle);
  if (!handle) throw new HttpError(400, 'invalid_handle', 'Profilname: 3–30 Zeichen, nur a–z, 0–9 und Bindestrich.');
  const displayName = cleanText(body.displayName, LIMITS.nameLength);
  if (!displayName) throw new HttpError(400, 'invalid_name', 'Bitte einen Anzeigenamen angeben.');
  const bio = cleanText(body.bio, LIMITS.bioLength);
  let requested: Visibility | null = null;
  if (body.visibility !== undefined) {
    requested = parseVisibility(body.visibility);
    if (!requested) throw new HttpError(400, 'invalid_visibility', 'Unbekannte Sichtbarkeit.');
  }

  const taken = await env.DB.prepare('SELECT user_id FROM profiles WHERE handle = ?').bind(handle).first<{ user_id: string }>();
  if (taken && taken.user_id !== user.id) throw new HttpError(409, 'handle_taken', 'Dieser Profilname ist schon vergeben.');

  const current = await env.DB.prepare('SELECT visibility, share_key FROM profiles WHERE user_id = ?').bind(user.id).first<Pick<ProfileRow, 'visibility' | 'share_key'>>();
  const visibility = requested ?? current?.visibility ?? DEFAULT_VISIBILITY;
  if (requested) await checkVisibilityChoice(env, user.id, visibility, current?.visibility);
  const shareKey = nextShareKey(current?.visibility ?? null, visibility, current?.share_key ?? null, body.rotateKey === true);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, handle, display_name, bio, visibility, share_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(user_id) DO UPDATE SET handle = ?2, display_name = ?3, bio = ?4, visibility = ?5, share_key = ?6, updated_at = ?7`,
  )
    .bind(user.id, handle, displayName, bio, visibility, shareKey, now)
    .run();
  const p = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<ProfileRow>();
  return json({ profile: profileShape(p!, true) });
}

/**
 * GET /api/profiles/:handle – Profilseite mit Booten, Statistik und Törns: öffentlich für alle, „Nur mit Link“ mit
 * X-Share-Key, sonst nur für sich selbst. Gelistet werden nur öffentliche Törns und öffentliche Boote (F-83).
 */
export async function getProfile(request: Request, env: Env, rawHandle: string): Promise<Response> {
  const key = requestKey(request);
  const handle = normalizeHandle(rawHandle);
  const p = handle ? await env.DB.prepare('SELECT * FROM profiles WHERE handle = ?').bind(handle).first<ProfileRow>() : null;
  const user = await currentUser(request, env);
  const isSelf = !!p && user?.id === p.user_id;
  if (!p || !canView({ visibility: p.visibility, shareKey: p.share_key }, { manager: isSelf, key })) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }

  const { results: boats } = await env.DB.prepare(
    `SELECT b.*, ?2 AS owner_handle, ?3 AS owner_name, 1 AS owner_public FROM boats b
     WHERE b.owner_id = ?1 AND (b.visibility = 'public' OR ?4) ORDER BY b.name`,
  )
    .bind(p.user_id, p.handle, p.display_name, isSelf ? 1 : 0)
    .all();
  const voyages = await publicShares(env, 'user', p.user_id);
  const distNm = voyages.reduce((s, v) => s + v.distNm, 0);
  return json({
    profile: profileShape(p, isSelf),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    boats: boats.map((b: any) => boatShape(b, isSelf ? 'owner' : null)),
    stats: { voyages: voyages.length, distNm },
    voyages,
    // öffentliche Törns anderer, auf denen die Person Crew ist – zählen nicht in die Kennzahlen
    crewVoyages: await crewShares(env, p.user_id),
  });
}
