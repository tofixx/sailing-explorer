// Rollen am Törn und Bestätigung durch den Skipper (Konzept 15, F-275 … F-280). Die Prüfungen laufen über die
// Mitgliedschaft, nicht über die Sichtbarkeit: Crew-Sein öffnet keinen Törn (10.6), die eigene Rolle pflegen darf man
// trotzdem. Fremde bekommen dieselbe 404 wie bei unbekannten Törns.
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json, readJson } from './http';
import { assertActive } from './moderation';
import { getShareRow } from './shares';
import { clearConfirmations } from './crew-cleanup';
import { canSetCrewRole, isVoyageRole } from '../src/domain/crew-roles';

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Freigabe gibt es nicht (mehr).');
const SKIPPER_TAKEN = () => new HttpError(409, 'skipper_taken', 'Auf diesem Törn gibt es schon eine:n Skipper:in.');
const INVALID_ROLE = () => new HttpError(400, 'invalid_role', 'Unbekannte Rolle.');
const NOT_SKIPPER = () => new HttpError(403, 'forbidden', 'Bestätigen kann nur die Skipperin bzw. der Skipper des Törns.');

/** Bedingung „kein anderes Crew-Mitglied ist Skipper“ – Platzhalter: ?1 Törn, ?2 Konto, das Skipper werden soll. */
const NO_OTHER_SKIPPER = `NOT EXISTS (SELECT 1 FROM share_crew x WHERE x.share_id = ?1 AND x.role = 'skipper' AND x.user_id <> ?2)`;

/**
 * Bedingung „?2 ist jetzt Skipper des Törns ?1“ – steht in jeder bestätigenden Anweisung selbst, damit eine
 * Bestätigung, die nach einem Skipper-Wechsel ankommt, nichts mehr schreibt.
 */
const IS_SKIPPER = `(EXISTS (SELECT 1 FROM share_crew k WHERE k.share_id = ?1 AND k.user_id = ?2 AND k.role = 'skipper')
  OR EXISTS (SELECT 1 FROM shares o WHERE o.id = ?1 AND o.user_id = ?2 AND o.owner_role = 'skipper'))`;

/** Konto-ID des Skippers: Eigentümer mit Rolle „Skipper“ oder das Crew-Mitglied mit dieser Rolle, sonst null. */
export async function skipperOf(env: Env, share: { id: string; user_id: string; owner_role?: string | null }): Promise<string | null> {
  if (share.owner_role === 'skipper') return share.user_id;
  const row = await env.DB.prepare(`SELECT user_id FROM share_crew WHERE share_id = ? AND role = 'skipper' LIMIT 1`).bind(share.id).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** Eigentümer oder Crew-Mitglied eines nicht ausgeblendeten Törns (sonst 404); gesperrte Konten 403. */
async function loadForMember(request: Request, env: Env, id: string) {
  const user = await requireUser(request, env);
  const row = await getShareRow(env, id);
  if (!row || row.hidden_at) throw NOT_FOUND();
  const member = await env.DB.prepare('SELECT 1 AS n FROM share_crew WHERE share_id = ? AND user_id = ?').bind(row.id, user.id).first();
  if (row.user_id !== user.id && !member) throw NOT_FOUND();
  await assertActive(env, user);
  return { user, row, isOwner: row.user_id === user.id };
}

/**
 * PUT /api/shares/:id/crew/:userId/role – `{ role }`. Eigentümer: jede Rolle jedes Mitglieds; Crew: nur die eigene
 * (`me`), nie Skipper. Höchstens ein Skipper je Törn – geprüft in derselben Anweisung (409 `skipper_taken`). Sie
 * schreibt nur, wenn die Rolle noch die gelesene ist (sonst 409 `role_changed`). Eine neue Rolle hebt die Bestätigung
 * der Person auf, ein Wechsel des Skippers alle.
 */
export async function setCrewRole(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const { user, row, isOwner } = await loadForMember(request, env, id);
  const target = who === 'me' ? user.id : who;
  const { role } = await readJson<{ role?: unknown }>(request);
  if (!isVoyageRole(role)) throw INVALID_ROLE();
  if (!isOwner && target !== user.id) throw NOT_FOUND();
  if (!canSetCrewRole({ isOwner, isSelf: target === user.id }, role)) {
    throw new HttpError(403, 'forbidden', 'Skipper:in kann nur der Eigentümer des Törns eintragen.');
  }
  const roleNow = async () =>
    (await env.DB.prepare('SELECT role FROM share_crew WHERE share_id = ? AND user_id = ?').bind(row.id, target).first<{ role: string }>())?.role;
  const before = await roleNow();
  if (!before) throw new HttpError(404, 'not_found', 'Diese Person ist nicht in der Crew.');
  if (before === role) return json({ role });
  const skipperGuard = role === 'skipper' ? ` AND ${NO_OTHER_SKIPPER} AND COALESCE((SELECT owner_role FROM shares WHERE id = ?1), '') <> 'skipper'` : '';
  const res = await env.DB.prepare(
    `UPDATE share_crew SET role = ?3, confirmed_at = NULL, confirmed_by = NULL WHERE share_id = ?1 AND user_id = ?2 AND role = ?4${skipperGuard}`,
  )
    .bind(row.id, target, role, before)
    .run();
  if (!res.meta.changes) {
    if ((await roleNow()) !== before) throw new HttpError(409, 'role_changed', 'Die Rolle wurde gerade geändert – bitte neu laden.');
    throw SKIPPER_TAKEN();
  }
  if (role === 'skipper' || before === 'skipper') await env.DB.batch(clearConfirmations(env, row.id));
  return json({ role });
}

/** PUT /api/shares/:id/role – `{ role }` (oder null): eigene Rolle des Eigentümers. Skipper nur, wenn kein Crew-Mitglied es ist. */
export async function setOwnerRole(request: Request, env: Env, id: string): Promise<Response> {
  const { row, isOwner } = await loadForMember(request, env, id);
  if (!isOwner) throw NOT_FOUND();
  const { role } = await readJson<{ role?: unknown }>(request);
  if (role !== null && !isVoyageRole(role)) throw INVALID_ROLE();
  const previous = row.owner_role ?? null;
  if (previous === role) return json({ role });
  const guard = role === 'skipper' ? ` AND NOT EXISTS (SELECT 1 FROM share_crew x WHERE x.share_id = ?1 AND x.role = 'skipper')` : '';
  const res = await env.DB.prepare(`UPDATE shares SET owner_role = ?2, role_confirmed_at = NULL, role_confirmed_by = NULL WHERE id = ?1${guard}`)
    .bind(row.id, role)
    .run();
  if (!res.meta.changes) throw SKIPPER_TAKEN();
  if (role === 'skipper' || previous === 'skipper') await env.DB.batch(clearConfirmations(env, row.id));
  return json({ role });
}

/**
 * POST /api/shares/:id/confirm – `{ userIds: string[] | 'all', owner?: true }`: nur der Skipper bestätigt Rolle und
 * Meilen der anderen (nie sich selbst). `owner` bestätigt den Eigentümer, wenn ein Crew-Mitglied Skipper ist und der
 * Eigentümer eine Rolle angegeben hat.
 */
export async function confirmCrew(request: Request, env: Env, id: string): Promise<Response> {
  const { user, row } = await loadForMember(request, env, id);
  if ((await skipperOf(env, row)) !== user.id) throw NOT_SKIPPER();
  const body = await readJson<{ userIds?: unknown; owner?: unknown }>(request);
  const all = body.userIds === 'all';
  const ids: unknown = all ? [] : body.userIds;
  if (!Array.isArray(ids) || ids.length > 50 || !ids.every((v) => typeof v === 'string')) {
    throw new HttpError(400, 'invalid_request', 'Bitte „all“ oder eine Liste von höchstens 50 Personen angeben.');
  }
  const now = Date.now();
  const crewSql = (one: boolean) =>
    `UPDATE share_crew SET confirmed_at = ?3, confirmed_by = ?2 WHERE share_id = ?1 AND user_id <> ?2${one ? ' AND user_id = ?4' : ''} AND ${IS_SKIPPER}`;
  const stmts = all
    ? [env.DB.prepare(crewSql(false)).bind(row.id, user.id, now)]
    : (ids as string[]).map((uid) => env.DB.prepare(crewSql(true)).bind(row.id, user.id, now, uid));
  if (body.owner === true || all) {
    stmts.push(
      env.DB.prepare(`UPDATE shares SET role_confirmed_at = ?3, role_confirmed_by = ?2 WHERE id = ?1 AND user_id <> ?2 AND owner_role IS NOT NULL AND ${IS_SKIPPER}`)
        .bind(row.id, user.id, now),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ confirmedAt: now });
}

/** DELETE /api/shares/:id/confirm/:userId – Skipper zieht eine Bestätigung zurück (`owner` = die des Eigentümers). */
export async function unconfirmCrew(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const { user, row } = await loadForMember(request, env, id);
  if ((await skipperOf(env, row)) !== user.id) throw NOT_SKIPPER();
  await (who === 'owner'
    ? env.DB.prepare(`UPDATE shares SET role_confirmed_at = NULL, role_confirmed_by = NULL WHERE id = ?1 AND ${IS_SKIPPER}`).bind(row.id, user.id)
    : env.DB.prepare(`UPDATE share_crew SET confirmed_at = NULL, confirmed_by = NULL WHERE share_id = ?1 AND user_id = ?3 AND ${IS_SKIPPER}`).bind(row.id, user.id, who)
  ).run();
  return new Response(null, { status: 204 });
}
