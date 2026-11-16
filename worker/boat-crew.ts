// Stammcrew eines Boots (Konzept 41, F-270 … F-274): Liste, Schalter des Eigners, Titel, Austritt/Entfernen,
// Zuordnen eigener Törns und Lösen fremder Zuordnungen. Einladen läuft über worker/invites.ts (Art `boat_member`).
// Stammcrew verwaltet nichts: Bearbeiten, Sichtbarkeit, Admins und Löschen bleiben bei roleFor (Eigner/Admins).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { HttpError, json, readJson } from './http';
import { assertActive, isAdmin } from './moderation';
import { roleFor } from './boats';
import { pendingCrewInvites } from './invites';
import { syncShareActivity } from './activity';
import { clearConfirmations } from './crew-cleanup';
import { canView, requestKey } from './access';
import type { Visibility } from '../src/domain/visibility';
import { funnyName } from '../src/domain/names';
import { BOAT_ID_RE, SHARE_ID_RE } from './validate';
import {
  BOAT_CREW_LIMITS, canInviteToCrew, canPostOnBoat, cleanCrewTitle, crewRights, isAssignMode, type BoatStanding, type CrewRights,
} from '../src/domain/boat-crew';

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Boot gibt es nicht (mehr).');

export interface CrewBoatRow {
  id: string;
  owner_id: string;
  visibility: Visibility;
  share_key: string | null;
  hidden_at: number | null;
  locked_at: number | null;
  crew_post: number;
  crew_invite: number;
  crew_assign: string;
}

/** Stufe eines Kontos am Boot samt Schaltern – gesperrte Boote zählen wie nicht vorhanden. */
export async function boatStanding(env: Env, userId: string | null, boatId: string): Promise<{ boat: CrewBoatRow; standing: BoatStanding; rights: CrewRights } | null> {
  if (!BOAT_ID_RE.test(boatId)) return null;
  const boat = await env.DB.prepare(
    `SELECT b.id, b.owner_id, b.visibility, b.share_key, b.hidden_at, b.locked_at, b.crew_post, b.crew_invite, b.crew_assign,
       CASE WHEN b.owner_id = ?2 THEN 'owner'
            WHEN EXISTS (SELECT 1 FROM boat_admins a WHERE a.boat_id = b.id AND a.user_id = ?2) THEN 'admin'
            WHEN EXISTS (SELECT 1 FROM boat_crew c WHERE c.boat_id = b.id AND c.user_id = ?2) THEN 'crew' END AS standing
     FROM boats b WHERE b.id = ?1 AND b.locked_at IS NULL`,
  )
    .bind(boatId, userId ?? '')
    .first<CrewBoatRow & { standing: BoatStanding }>();
  return boat ? { boat, standing: boat.standing ?? null, rights: crewRights(boat) } : null;
}

/** Ist das Konto in der Stammcrew dieses Boots? (Eigner und Admins zählen nicht.) */
export async function isBoatCrew(env: Env, userId: string, boatId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS n FROM boat_crew WHERE boat_id = ? AND user_id = ?').bind(boatId, userId).first());
}

/**
 * Boote, denen das Konto eigene Törns zuordnen darf, ohne sie zu verwalten (F-272): Stammcrew; bei „clubs“ auch
 * Mitglieder eines (nicht ausgeblendeten, nicht gesperrten) Vereins des öffentlichen Boots; bei „anyone“ auch, wer dem öffentlichen Boot folgt und dessen Konto alt genug ist.
 * `?1` Konto, `?2` Stichtag für das Kontoalter (`BOAT_CREW_LIMITS.anyoneMinAgeMs`).
 */
const ASSIGNABLE_SQL = `SELECT b.id, b.name FROM boats b
  WHERE b.locked_at IS NULL AND b.hidden_at IS NULL AND b.owner_id <> ?1
    AND NOT EXISTS (SELECT 1 FROM boat_admins a WHERE a.boat_id = b.id AND a.user_id = ?1)
    AND (EXISTS (SELECT 1 FROM boat_crew c WHERE c.boat_id = b.id AND c.user_id = ?1)
      OR (b.crew_assign IN ('clubs', 'anyone') AND b.visibility = 'public' AND EXISTS (SELECT 1 FROM group_boats gb
          JOIN groups g ON g.id = gb.group_id AND g.kind = 'club' AND g.hidden_at IS NULL AND g.locked_at IS NULL
          JOIN group_members m ON m.group_id = gb.group_id WHERE gb.boat_id = b.id AND m.user_id = ?1))
      OR (b.crew_assign = 'anyone' AND b.visibility = 'public'
          AND EXISTS (SELECT 1 FROM follows f WHERE f.user_id = ?1 AND f.target_kind = 'boat' AND f.target_id = b.id)
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = ?1 AND u.created_at <= ?2)))`;

/** Für die Boots-Auswahl beim Teilen und im Fahrtenbuch: zuordenbare Boote ohne Verwaltung (höchstens 50). */
export async function assignableBoats(env: Env, userId: string): Promise<Array<{ id: string; name: string }>> {
  const cutoff = Date.now() - BOAT_CREW_LIMITS.anyoneMinAgeMs;
  return (await env.DB.prepare(`${ASSIGNABLE_SQL} ORDER BY b.name LIMIT 50`).bind(userId, cutoff).all<{ id: string; name: string }>()).results;
}

/** Darf das Konto diesem Boot einen eigenen Törn zuordnen? Verwalter immer, sonst nach den Schaltern (F-272). */
export async function canAssignBoat(env: Env, userId: string, boatId: string): Promise<boolean> {
  if (await roleFor(env, userId, boatId)) return true;
  const cutoff = Date.now() - BOAT_CREW_LIMITS.anyoneMinAgeMs;
  return !!(await env.DB.prepare(`${ASSIGNABLE_SQL} AND b.id = ?3`).bind(userId, cutoff, boatId).first());
}

/** Kann diese Person die Bootsseite sehen? Wie getBoat: Verwalter und Stammcrew auch bei „Nur ich“ (F-273). */
const canSeeBoat = (request: Request, env: Env, s: { boat: CrewBoatRow; standing: BoatStanding }, userId: string | null) =>
  canView(
    { visibility: s.boat.visibility, shareKey: s.boat.share_key, hiddenAt: s.boat.hidden_at, lockedAt: s.boat.locked_at },
    { manager: !!s.standing, key: requestKey(request), admin: isAdmin(env, userId ?? undefined) },
  );

interface CrewRow {
  user_id: string;
  title: string;
  created_at: number;
  handle: string | null;
  display_name: string | null;
  open: number;
}

/**
 * GET /api/boats/:id/crew – wer das Boot sehen darf. Besucher: nur Mitglieder mit öffentlichem Profil (Name, Titel),
 * die übrigen als Anzahl. Stammcrew, Admins, Eigner: alle mit Anzeige- bzw. Spaßnamen; Verwalter zusätzlich IDs und
 * die Schalter. Offene Einladungen liefert der Einladungs-Endpunkt nicht hier.
 */
export async function getBoatCrew(request: Request, env: Env, id: string): Promise<Response> {
  const user = await currentUser(request, env);
  const s = await boatStanding(env, user?.id ?? null, id);
  if (!s || !canSeeBoat(request, env, s, user?.id ?? null)) throw NOT_FOUND();
  const { results } = await env.DB.prepare(
    `SELECT c.user_id, c.title, c.created_at, p.handle, p.display_name,
       (p.visibility = 'public' AND p.hidden_at IS NULL AND u.suspended_at IS NULL) AS open
     FROM boat_crew c JOIN users u ON u.id = c.user_id LEFT JOIN profiles p ON p.user_id = c.user_id
     WHERE c.boat_id = ? ORDER BY c.created_at`,
  )
    .bind(id)
    .all<CrewRow>();
  const manager = s.standing === 'owner' || s.standing === 'admin';
  const inside = !!s.standing;
  const shown = inside ? results : results.filter((r) => r.open && r.handle);
  return json({
    standing: s.standing,
    rights: s.rights,
    canInvite: !!user && canInviteToCrew(s.standing, s.rights),
    canPost: !!user && canPostOnBoat(s.standing, s.rights),
    members: shown.map((r) => ({
      id: manager || r.user_id === user?.id ? r.user_id : null,
      handle: r.open ? r.handle : null,
      // Beteiligte sehen Spaßnamen statt privater Anzeigenamen (wie Konzept 15, Skipper-Sicht)
      displayName: (r.open ? r.display_name : null) || (inside ? funnyName(r.user_id) : 'Segler:in'),
      title: r.title,
      isSelf: r.user_id === user?.id,
    })),
    others: results.length - shown.length,
    invites: manager ? await pendingCrewInvites(env, id) : [],
  });
}

/** PUT /api/boats/:id/crew-rights – `{ post?, invite?, assign? }`: nur der Eigner (wie Beitritt und Bestätigende bei Gruppen, 14.1). */
export async function setCrewRights(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const s = await boatStanding(env, user.id, id);
  if (!s || !s.standing) throw NOT_FOUND();
  if (s.standing !== 'owner') throw new HttpError(403, 'forbidden', 'Was die Stammcrew darf, legt der Eigner fest.');
  await assertActive(env, user);
  const body = await readJson<{ post?: unknown; invite?: unknown; assign?: unknown }>(request);
  const next = { ...s.rights };
  if (body.post !== undefined) next.post = body.post === true;
  if (body.invite !== undefined) next.invite = body.invite === true;
  if (body.assign !== undefined) {
    if (!isAssignMode(body.assign)) throw new HttpError(400, 'invalid_assign', 'Unbekannte Einstellung für das Zuordnen.');
    next.assign = body.assign;
  }
  await env.DB.prepare('UPDATE boats SET crew_post = ?, crew_invite = ?, crew_assign = ? WHERE id = ?')
    .bind(next.post ? 1 : 0, next.invite ? 1 : 0, next.assign, id)
    .run();
  return json({ rights: next });
}

/** PATCH /api/boats/:id/crew/:userId – `{ title }`: Verwalter für alle, die Stammcrew für sich (`me`). */
export async function setCrewTitle(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const s = await boatStanding(env, user.id, id);
  if (!s || !s.standing) throw NOT_FOUND();
  const target = who === 'me' ? user.id : who;
  if (target !== user.id && s.standing === 'crew') throw new HttpError(403, 'forbidden', 'Titel anderer setzen Eigner und Admins.');
  const title = cleanCrewTitle((await readJson<{ title?: unknown }>(request)).title);
  if (title === null) throw new HttpError(400, 'invalid_title', `Höchstens ${BOAT_CREW_LIMITS.titleMax} Zeichen.`);
  const res = await env.DB.prepare('UPDATE boat_crew SET title = ? WHERE boat_id = ? AND user_id = ?').bind(title, id, target).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Diese Person ist nicht in der Stammcrew.');
  return json({ title });
}

/** DELETE /api/boats/:id/crew/:userId – Verwalter entfernen jede:n, die Stammcrew sich selbst (`me`). */
export async function removeCrewMember(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const user = await requireUser(request, env);
  const s = await boatStanding(env, user.id, id);
  if (!s || !s.standing) throw NOT_FOUND();
  const target = who === 'me' ? user.id : who;
  if (target !== user.id && s.standing === 'crew') throw NOT_FOUND();
  const res = await env.DB.prepare('DELETE FROM boat_crew WHERE boat_id = ? AND user_id = ?').bind(id, target).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Diese Person ist nicht in der Stammcrew.');
  return new Response(null, { status: 204 });
}

/**
 * DELETE /api/boats/:id/shares/:shareId – Eigner und Admins lösen die Zuordnung eines Törns zum Boot (F-274), z. B.
 * bei offenem Zuordnen (Charter). Der Törn bleibt; Bestätigungen des Skippers fallen (Boot geändert, Konzept 15),
 * Neuigkeiten werden neu gebaut. Fremde Boote oder Törns ohne diese Zuordnung: 404.
 */
export async function unassignShare(request: Request, env: Env, id: string, shareId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const s = await boatStanding(env, user.id, id);
  if (!s || (s.standing !== 'owner' && s.standing !== 'admin')) throw NOT_FOUND();
  if (!SHARE_ID_RE.test(shareId)) throw NOT_FOUND();
  const res = await env.DB.prepare('UPDATE shares SET boat_id = NULL WHERE id = ? AND boat_id = ?').bind(shareId, id).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Dieser Törn ist dem Boot nicht zugeordnet.');
  await env.DB.batch([...clearConfirmations(env, shareId), ...syncShareActivity(env, shareId)]);
  return new Response(null, { status: 204 });
}
