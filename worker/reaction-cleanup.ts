// Aufräumen von Reaktionen (Konzept 12.5, F-181) – reine SQL-Bausteine ohne weitere Abhängigkeiten, damit Törns,
// Fotos, Beiträge, Gruppen, Boote, Konten und der nächtliche Lauf sie in ihre Batches aufnehmen können.
import type { Env } from './env';

/** Reaktionen auf einen Törn, seine Fotos und seine Aktivitäten – vor dem Löschen des Törns ausführen. */
export const deleteShareReactions = (env: Env, shareId: string): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM reactions WHERE (subject_kind = 'share' AND subject_id = ?1)
       OR (subject_kind = 'photo' AND subject_id IN (SELECT id FROM photos WHERE share_id = ?1))
       OR (subject_kind = 'activity' AND subject_id IN (SELECT id FROM activity WHERE subject_kind = 'share' AND subject_id = ?1))`,
  ).bind(shareId);

export const deletePhotoReactions = (env: Env, photoId: string): D1PreparedStatement =>
  env.DB.prepare(`DELETE FROM reactions WHERE subject_kind = 'photo' AND subject_id = ?`).bind(photoId);

export const deletePostReactions = (env: Env, postId: string): D1PreparedStatement =>
  env.DB.prepare(`DELETE FROM reactions WHERE subject_kind = 'post' AND subject_id = ?`).bind(postId);

/** Gruppe gelöscht: Reaktionen auf ihre Beiträge und Aktivitäten. */
export const deleteGroupReactions = (env: Env, groupId: string): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM reactions WHERE (subject_kind = 'post' AND subject_id IN (SELECT id FROM posts WHERE group_id = ?1))
       OR (subject_kind = 'activity' AND subject_id IN (SELECT id FROM activity WHERE group_id = ?1 OR (subject_kind = 'group' AND subject_id = ?1)))`,
  ).bind(groupId);

/** Boot gelöscht: Reaktionen auf Aktivitäten mit dem Boot als Gegenstand. */
export const deleteBoatReactions = (env: Env, boatId: string): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM reactions WHERE subject_kind = 'activity' AND subject_id IN (SELECT id FROM activity WHERE subject_kind = 'boat' AND subject_id = ?1)`,
  ).bind(boatId);

/** Konto gelöscht: eigene Reaktionen und alle auf eigene Törns, Fotos, Beiträge und Aktivitäten (vor deren Löschen). */
export const userReactionCleanup = (env: Env, userId: string): D1PreparedStatement[] => [
  env.DB.prepare(
    `DELETE FROM reactions WHERE user_id = ?1
       OR (subject_kind = 'share' AND subject_id IN (SELECT id FROM shares WHERE user_id = ?1))
       OR (subject_kind = 'photo' AND subject_id IN (SELECT id FROM photos WHERE user_id = ?1 OR share_id IN (SELECT id FROM shares WHERE user_id = ?1)))
       OR (subject_kind = 'post' AND subject_id IN (SELECT id FROM posts WHERE author_id = ?1))
       OR (subject_kind = 'activity' AND subject_id IN (SELECT id FROM activity WHERE actor_id = ?1
            OR (subject_kind = 'share' AND subject_id IN (SELECT id FROM shares WHERE user_id = ?1))))`,
  ).bind(userId),
  env.DB.prepare('DELETE FROM reaction_log WHERE user_id = ?').bind(userId),
];

const DAY = 86_400_000;

/** Nächtlich: Reaktionen ohne Gegenstand und Reaktionszähler älter als 24 h. */
export const nightlyReactionCleanup = (env: Env, now: number): D1PreparedStatement[] => [
  env.DB.prepare(
    `DELETE FROM reactions WHERE
       (subject_kind = 'share' AND NOT EXISTS (SELECT 1 FROM shares WHERE id = reactions.subject_id))
       OR (subject_kind = 'photo' AND NOT EXISTS (SELECT 1 FROM photos WHERE id = reactions.subject_id))
       OR (subject_kind = 'post' AND NOT EXISTS (SELECT 1 FROM posts WHERE id = reactions.subject_id))
       OR (subject_kind = 'activity' AND NOT EXISTS (SELECT 1 FROM activity WHERE id = reactions.subject_id))`,
  ),
  env.DB.prepare('DELETE FROM reaction_log WHERE created_at < ?').bind(now - DAY),
];
