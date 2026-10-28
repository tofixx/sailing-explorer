// Törns in Gruppen (Konzept 11.12, F-373 … F-377): Die Eigentümer:in wählt, in welchen ihrer Gruppen ein Törn
// erscheint (share_groups). Wählbar sind nur Gruppen, in denen sie Mitglied ist und die weder ausgeblendet noch gesperrt
// sind; vorausgewählt die Gruppen des Boots. Nur ausgewählte öffentliche Törns stehen im Gruppen-Stream und zählen in
// Kennzahlen, Meilensteinen, Galerie und Wochenmail der Gruppe. Der Hafen bleibt automatisch (worker/activity.ts).
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json } from './http';
import { syncShareGroupTargets } from './activity';
import { GROUP_LIMITS } from '../src/domain/limits';
import { parseGroupIds, type GroupKind, type ShareGroupChoice } from '../src/domain/groups';

/** Teilabfrage: wählbare Gruppen des Kontos im Bind-Parameter `user` – Mitglied, nicht ausgeblendet, nicht gesperrt. */
const choosable = (user: string) => `SELECT g.id FROM group_members m JOIN groups g ON g.id = m.group_id
  WHERE m.user_id = ${user} AND g.hidden_at IS NULL AND g.locked_at IS NULL`;

/** Wählbare Gruppen mit den eigenen bzw. verwalteten Booten darin (für die Vorauswahl im Dialog). */
export async function choosableGroups(env: Env, userId: string): Promise<ShareGroupChoice[]> {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.name, g.kind,
       (SELECT json_group_array(gb.boat_id) FROM group_boats gb JOIN boats b ON b.id = gb.boat_id
         WHERE gb.group_id = g.id AND (b.owner_id = ?1 OR EXISTS (SELECT 1 FROM boat_admins a WHERE a.boat_id = b.id AND a.user_id = ?1))) AS boats
     FROM group_members m JOIN groups g ON g.id = m.group_id
     WHERE m.user_id = ?1 AND g.hidden_at IS NULL AND g.locked_at IS NULL
     ORDER BY g.kind, g.name LIMIT ?2`,
  )
    .bind(userId, GROUP_LIMITS.shareGroups)
    .all<{ id: string; slug: string; name: string; kind: GroupKind; boats: string | null }>();
  return results.map((g) => ({ id: g.id, slug: g.slug, name: g.name, kind: g.kind, boatIds: JSON.parse(g.boats ?? '[]') as string[] }));
}

/** GET /api/me/share-groups – wählbare Gruppen für „In Gruppen zeigen“ (F-373). */
export async function listShareGroupChoices(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json({ groups: await choosableGroups(env, user.id) });
}

/** Ausgewählte Gruppen eines Törns (nur für die Eigentümer:in, F-375). */
export async function selectedGroupIds(env: Env, shareId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT group_id FROM share_groups WHERE share_id = ? ORDER BY group_id').bind(shareId).all<{ group_id: string }>();
  return results.map((r) => r.group_id);
}

/**
 * Auswahl prüfen: wohlgeformt (sonst 400) und jede Gruppe wählbar (sonst 403 – auch für unbekannte IDs, damit
 * geschlossene Gruppen nicht über die Antwort erkennbar sind).
 */
export async function checkGroupIds(env: Env, userId: string, input: unknown): Promise<string[]> {
  const ids = parseGroupIds(input, GROUP_LIMITS.shareGroups);
  if (!ids) throw new HttpError(400, 'invalid_groups', 'Ungültige Auswahl der Gruppen.');
  if (!ids.length) return ids;
  const { results } = await env.DB.prepare(`${choosable('?1')} AND g.id IN (SELECT value FROM json_each(?2))`).bind(userId, JSON.stringify(ids)).all<{ id: string }>();
  if (results.length !== ids.length) throw new HttpError(403, 'group_forbidden', 'In dieser Gruppe kannst du keine Törns zeigen – nur in Gruppen, in denen du Mitglied bist.');
  return ids;
}

/**
 * Auswahl ersetzen (schon geprüft): wählbare Gruppen außerhalb der Auswahl fallen, die Auswahl kommt dazu. Zeilen
 * ausgeblendeter oder gesperrter Gruppen bleiben unberührt (sie sind nicht wählbar, die Sperre ist umkehrbar).
 * Danach die Gruppen-Ziele bestehender Törn- und Foto-Aktivitäten angleichen.
 */
export function replaceShareGroups(env: Env, shareId: string, userId: string, ids: string[], now: number): D1PreparedStatement[] {
  return [
    env.DB.prepare(`DELETE FROM share_groups WHERE share_id = ?1 AND group_id IN (${choosable('?2')}) AND group_id NOT IN (SELECT value FROM json_each(?3))`).bind(
      shareId, userId, JSON.stringify(ids),
    ),
    insertShareGroupsStmt(env, shareId, ids, now),
    ...syncShareGroupTargets(env, shareId),
  ];
}

/** Auswahl eintragen (schon geprüft) – für einen neuen Törn genügt das, es gibt noch nichts zu ersetzen. */
export const insertShareGroupsStmt = (env: Env, shareId: string, ids: string[], now: number) =>
  env.DB.prepare(`INSERT OR IGNORE INTO share_groups (share_id, group_id, created_at) SELECT ?1, value, ?2 FROM json_each(?3)`).bind(shareId, now, JSON.stringify(ids));

/** Auswahl aller eigenen Törns (Konto → Freigaben, F-375): Törn-ID → Gruppen-IDs. */
export async function selectedGroupsOf(env: Env, userId: string): Promise<Map<string, string[]>> {
  const { results } = await env.DB.prepare(
    'SELECT sg.share_id, sg.group_id FROM share_groups sg JOIN shares s ON s.id = sg.share_id WHERE s.user_id = ? ORDER BY sg.group_id',
  )
    .bind(userId)
    .all<{ share_id: string; group_id: string }>();
  const by = new Map<string, string[]>();
  for (const r of results) by.set(r.share_id, [...(by.get(r.share_id) ?? []), r.group_id]);
  return by;
}

/**
 * Ohne Angabe beim Anlegen: die wählbaren Gruppen, denen das Boot zugeordnet ist (ohne Boot keine). Anders als die
 * Migration überspringt das ausgeblendete und gesperrte Gruppen – sie sind nicht wählbar.
 */
export const presetShareGroupsStmt = (env: Env, shareId: string, userId: string, boatId: string, now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO share_groups (share_id, group_id, created_at)
     SELECT ?1, gb.group_id, ?4 FROM group_boats gb WHERE gb.boat_id = ?3 AND gb.group_id IN (${choosable('?2')})`,
  ).bind(shareId, userId, boatId, now);
