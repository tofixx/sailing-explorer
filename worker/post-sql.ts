// Post-Zeilen von Törns (Konzept 21.3, Option A, F-400): jeder Törn hat eine Zeile in `posts` mit derselben ID
// (`share_id = id`), Heimatverlauf ist das Profil der Eigentümer:in. Sie fällt per ON DELETE CASCADE mit dem Törn.
// Ohne Abhängigkeit zu shares/posts, damit beide Module es importieren können.
import type { Env } from './env';

/** Post-Zeile eines neuen Törns – im selben Batch wie die Törn-Zeile (`source`: gpx | manual). */
export const sharePostStmt = (env: Env, shareId: string, userId: string, source: 'gpx' | 'manual', now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO posts (id, author_id, kind, channel_kind, channel_id, share_id, body, reach, created_at)
     VALUES (?1, ?2, ?3, 'user', ?2, ?1, '', 'all', ?4)`,
  ).bind(shareId, userId, source === 'manual' ? 'logbook' : 'voyage', now);

/** Höchstens so viele fehlende Post-Zeilen je Nacht nachtragen. */
const REPAIR_MAX = 200;

/**
 * Nächtlicher Waisen-Check (21.8): Törns ohne Post-Zeile (z. B. von einem Weg angelegt, der sie vergaß) bekommen sie
 * nach. Post-Zeilen ohne Törn gibt es nicht – der Fremdschlüssel löscht sie mit.
 */
export const repairSharePostsStmt = (env: Env) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO posts (id, author_id, kind, channel_kind, channel_id, share_id, body, reach, created_at)
     SELECT s.id, s.user_id, CASE s.source WHEN 'manual' THEN 'logbook' ELSE 'voyage' END, 'user', s.user_id, s.id, '', 'all', s.created_at
     FROM shares s WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = s.id) LIMIT ?`,
  ).bind(REPAIR_MAX);
