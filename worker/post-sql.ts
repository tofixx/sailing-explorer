// Post-Zeilen von Törns (Konzept 21.3, Option A, F-400): jeder Törn hat eine Zeile in `posts` mit derselben ID
// (`share_id = id`), Heimatverlauf ist das Profil der Eigentümer:in. Sie fällt per ON DELETE CASCADE mit dem Törn.
// Ohne Abhängigkeit zu shares/posts, damit beide Module es importieren können.
import type { Env } from './env';
import { HttpError } from './http';
import { isReach, type Reach } from '../src/domain/posts';

/**
 * Post-Zeile eines neuen Törns – im selben Batch wie die Törn-Zeile (`source`: gpx | manual). `reach`: „Sichtbar bis“
 * (F-427), ohne Angabe wie bisher „überall“.
 */
export const sharePostStmt = (env: Env, shareId: string, userId: string, source: 'gpx' | 'manual', now: number, reach: Reach = 'all') =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO posts (id, author_id, kind, channel_kind, channel_id, share_id, body, reach, created_at)
     VALUES (?1, ?2, ?3, 'user', ?2, ?1, '', ?5, ?4)`,
  ).bind(shareId, userId, source === 'manual' ? 'logbook' : 'voyage', now, reach);

/** „Sichtbar bis“ eines Törns aus Header bzw. JSON (F-427): fehlt = „überall“, Unbekanntes → 400. */
export function readShareReach(raw: unknown): Reach {
  if (raw === undefined || raw === null || raw === '') return 'all';
  if (!isReach(raw)) throw new HttpError(400, 'invalid_reach', 'Unbekannte Stufe „Sichtbar bis“.');
  return raw;
}

/**
 * Schlüssel des Tageszählers „Beiträge je Verlauf und Tag“ (`post_log.group_id`, auch nach dem Löschen): Gruppe = ihre
 * ID (wie seit Konzept 11.4), Profil `user:<id>`; Hafen und Boot zählen je Konto (`harbor:<id>:<konto>`), damit niemand
 * mit Schreiben und Löschen den Verlauf für alle sperrt (21.12).
 */
export function postLogKey(c: { kind: 'user' | 'group' | 'harbor' | 'boat'; id: string }, authorId = ''): string {
  if (c.kind === 'group') return c.id;
  if (c.kind === 'user') return `user:${c.id}`;
  return `${postLogPrefix(c.kind, c.id)}${authorId}`;
}

/** Gemeinsamer Anfang aller Zähler eines Hafens bzw. Boots (Aufräumen, Zusammenführen). */
export const postLogPrefix = (kind: 'harbor' | 'boat', id: string): string => `${kind}:${id}:`;

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
