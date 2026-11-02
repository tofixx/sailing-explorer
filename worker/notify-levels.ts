// Benachrichtigungs-Stufen je Verlauf (Konzept 24.6, F-449): gespeichert an der Mitgliedschaft (`group_members`) bzw.
// am Folgen (`follows`), NULL = Voreinstellung des Kontos (`users.notify_prefs.level`). Die Regel selbst steht in
// src/domain/notifications.ts (`shouldNotify`), als SQL in worker/notify-sql.ts.
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json, readJson } from './http';
import { resolveTarget } from './follows';
import { isFollowKind, type FollowKind } from '../src/domain/groups';
import { DEFAULT_LEVEL_CHOICES, FOLLOW_DEFAULT_LEVEL, isNotifyLevel, parseDefaultLevel, type NotifyLevel } from '../src/domain/notifications';

/**
 * Wirksame Stufe des Kontos für einen Verlauf – oder null, wenn es weder Mitglied (nur Gruppen) ist noch folgt (dann
 * gibt es nichts einzustellen). Die Mitgliedschaft geht dem Folgen vor.
 */
export async function viewerLevel(env: Env, userId: string | null | undefined, kind: FollowKind, targetId: string): Promise<NotifyLevel | null> {
  if (!userId) return null;
  const row = await env.DB.prepare(
    `SELECT u.notify_prefs AS prefs,
       (SELECT m.notify_level FROM group_members m WHERE ?2 = 'group' AND m.group_id = ?3 AND m.user_id = ?1) AS m_level,
       EXISTS (SELECT 1 FROM group_members m WHERE ?2 = 'group' AND m.group_id = ?3 AND m.user_id = ?1) AS member,
       (SELECT f.notify_level FROM follows f WHERE f.user_id = ?1 AND f.target_kind = ?2 AND f.target_id = ?3) AS f_level,
       EXISTS (SELECT 1 FROM follows f WHERE f.user_id = ?1 AND f.target_kind = ?2 AND f.target_id = ?3) AS follows
     FROM users u WHERE u.id = ?1`,
  )
    .bind(userId, kind, targetId)
    .first<{ prefs: string | null; m_level: string | null; member: number; f_level: string | null; follows: number }>();
  if (!row || (!row.member && !row.follows)) return null;
  // Mitgliedschaft: eigene Wahl, sonst Voreinstellung des Kontos; Folgen: eigene Wahl, sonst „Nur Direktes“ (F-446)
  if (row.member) return isNotifyLevel(row.m_level) ? row.m_level : parseDefaultLevel(row.prefs);
  return isNotifyLevel(row.f_level) ? row.f_level : FOLLOW_DEFAULT_LEVEL;
}

/** Stufe speichern: an der Mitgliedschaft (Gruppe, Mitglied) bzw. am Folgen. false, wenn es beides nicht gibt. */
export async function setLevel(env: Env, userId: string, kind: FollowKind, targetId: string, level: NotifyLevel): Promise<boolean> {
  if (kind === 'group') {
    const res = await env.DB.prepare('UPDATE group_members SET notify_level = ? WHERE group_id = ? AND user_id = ?').bind(level, targetId, userId).run();
    if (res.meta.changes) return true;
  }
  const res = await env.DB.prepare('UPDATE follows SET notify_level = ? WHERE user_id = ? AND target_kind = ? AND target_id = ?').bind(level, userId, kind, targetId).run();
  return !!res.meta.changes;
}

/**
 * PUT /api/notify/:kind/:id `{ level }` – Stufe eines Verlaufs (Glocke auf Gruppen-, Hafen-, Boots- und Profilseite,
 * Übersicht im Konto). Nur für Verläufe, in denen man Mitglied ist oder denen man folgt (sonst 404).
 */
export async function putLevel(request: Request, env: Env, rawKind: string, raw: string): Promise<Response> {
  const user = await requireUser(request, env);
  const { level } = await readJson<{ level?: unknown }>(request);
  if (!isNotifyLevel(level)) throw new HttpError(400, 'invalid_level', 'Unbekannte Stufe.');
  if (!isFollowKind(rawKind)) throw new HttpError(404, 'not_found', 'Diesen Verlauf gibt es nicht.');
  const t = await resolveTarget(env, rawKind, raw, false);
  if (!t || !(await setLevel(env, user.id, rawKind, t.id, level))) {
    throw new HttpError(404, 'not_found', 'Benachrichtigungen gibt es für Gruppen, in denen du Mitglied bist, und für alles, dem du folgst.');
  }
  return json({ level });
}

/**
 * GET /api/me/channels – alle Verläufe mit Stufe (Konto → Benachrichtigungen): eigene Gruppen und alles Gefolgte, dazu
 * die Voreinstellung. `level` null = Voreinstellung.
 */
export async function listChannels(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const [groups, follows, prefs] = await env.DB.batch([
    env.DB.prepare(
      `SELECT 'group' AS kind, g.id AS ref, '/g/' || g.slug AS path, g.name, m.notify_level AS level FROM group_members m JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = ? AND g.locked_at IS NULL ORDER BY g.name LIMIT 200`,
    ).bind(user.id),
    env.DB.prepare(
      `SELECT f.target_kind AS kind, COALESCE(p.handle, f.target_id) AS ref, f.notify_level AS level,
         CASE f.target_kind WHEN 'user' THEN '/u/' || p.handle WHEN 'group' THEN '/g/' || g.slug WHEN 'boat' THEN '/b/' || b.id ELSE '/h/' || h.slug END AS path,
         COALESCE(p.display_name, g.name, b.name, h.name, '') AS name
       FROM follows f
       LEFT JOIN profiles p ON f.target_kind = 'user' AND p.user_id = f.target_id
       LEFT JOIN groups g ON f.target_kind = 'group' AND g.id = f.target_id
       LEFT JOIN boats b ON f.target_kind = 'boat' AND b.id = f.target_id
       LEFT JOIN harbors h ON f.target_kind = 'harbor' AND h.id = f.target_id
       WHERE f.user_id = ?1
       ORDER BY f.target_kind, name LIMIT 1000`,
    ).bind(user.id),
    env.DB.prepare('SELECT notify_prefs FROM users WHERE id = ?').bind(user.id),
  ]);
  type Row = { kind: FollowKind; ref: string; path: string | null; name: string; level: string | null };
  // `ref`: Kennung für PUT /api/notify/:kind/:ref (Profil: Profilname, sonst ID)
  // Folgen ohne eigene Wahl: „Nur Direktes“ (F-446); Mitgliedschaft ohne Wahl: null = Voreinstellung
  const shape = (r: Row, member: boolean) => ({ kind: r.kind, ref: r.ref, path: r.path, name: r.name, member, level: isNotifyLevel(r.level) ? r.level : member ? null : FOLLOW_DEFAULT_LEVEL });
  return json(
    {
      defaultLevel: parseDefaultLevel((prefs.results[0] as { notify_prefs: string | null } | undefined)?.notify_prefs),
      channels: [...(groups.results as Row[]).map((r) => shape(r, true)), ...(follows.results as Row[]).map((r) => shape(r, false))],
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/** PUT /api/me/channels/default `{ level }` – Voreinstellung für Verläufe ohne eigene Stufe (nicht „stumm“). */
export async function putDefaultLevel(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { level } = await readJson<{ level?: unknown }>(request);
  if (!isNotifyLevel(level) || !DEFAULT_LEVEL_CHOICES.includes(level)) throw new HttpError(400, 'invalid_level', 'Unbekannte Stufe.');
  await env.DB.prepare(
    `UPDATE users SET notify_prefs = json_set(CASE WHEN json_valid(notify_prefs) THEN notify_prefs ELSE '{}' END, '$.level', ?1) WHERE id = ?2`,
  )
    .bind(level, user.id)
    .run();
  return json({ defaultLevel: level });
}
