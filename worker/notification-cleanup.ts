// Aufräumen von Benachrichtigungen (Konzept 17.5, F-255) – reine SQL-Bausteine ohne weitere Abhängigkeiten, damit
// Törns, Gruppen, Einladungen, Konten und der nächtliche Lauf sie in ihre Batches aufnehmen können.
import type { Env } from './env';
import { NOTIFICATION_LIMITS } from '../src/domain/notifications';

const DAY = 86_400_000;

/** Törn gelöscht oder abgelaufen: Kommentare und Reaktionen dazu. */
export const deleteShareNotifications = (env: Env, shareId: string): D1PreparedStatement =>
  env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'share' AND subject_id = ?`).bind(shareId);

/** Beitrag gelöscht (Autor:in, Gruppen-Admins, Moderation): Reaktionen darauf. */
export const deletePostNotifications = (env: Env, postId: string): D1PreparedStatement =>
  env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'post' AND subject_id = ?`).bind(postId);

/** Einladung angenommen, abgelehnt oder zurückgezogen. */
export const deleteInviteNotifications = (env: Env, inviteId: string): D1PreparedStatement =>
  env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'invite' AND subject_id = ?`).bind(inviteId);

/** Gruppe gelöscht: Anfragen, Reaktionen auf ihre Beiträge und Einladungen in die Gruppe – vor dem Löschen ausführen. */
export const groupNotificationCleanup = (env: Env, groupId: string): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM notifications WHERE (subject_kind = 'group' AND subject_id = ?1)
       OR (subject_kind = 'post' AND subject_id IN (SELECT id FROM posts WHERE group_id = ?1))
       OR (subject_kind = 'invite' AND subject_id IN (SELECT id FROM invites WHERE group_id = ?1))`,
  ).bind(groupId);

/**
 * Konto gelöscht: eigene Benachrichtigungen, solche über eigene Törns, Beiträge und Einladungen bei anderen (vor deren
 * Löschen), und die Person als Handelnde (Name verschwindet, die Zählung bleibt).
 */
export const userNotificationCleanup = (env: Env, userId: string): D1PreparedStatement[] => [
  env.DB.prepare(
    `DELETE FROM notifications WHERE user_id = ?1
       OR (subject_kind = 'invite' AND subject_id IN (SELECT id FROM invites WHERE inviter_id = ?1))
       OR (subject_kind = 'post' AND subject_id IN (SELECT id FROM posts WHERE author_id = ?1))`,
  ).bind(userId),
  env.DB.prepare('UPDATE notifications SET actor_id = NULL WHERE actor_id = ?').bind(userId),
];

/** Nächtlich: Gelesenes nach readDays, alles nach maxDays, Einträge ohne Gegenstand – je Schritt gedeckelt. */
export function nightlyNotificationCleanup(env: Env, now: number): D1PreparedStatement[] {
  const L = NOTIFICATION_LIMITS;
  return [
    env.DB.prepare(
      `DELETE FROM notifications WHERE id IN (SELECT id FROM notifications
         WHERE (read_at IS NOT NULL AND read_at < ?1) OR updated_at < ?2 LIMIT ?3)`,
    ).bind(now - L.readDays * DAY, now - L.maxDays * DAY, L.nightlyBatch),
    env.DB.prepare(
      `DELETE FROM notifications WHERE id IN (SELECT id FROM notifications n WHERE
         (n.subject_kind = 'share' AND NOT EXISTS (SELECT 1 FROM shares WHERE id = n.subject_id))
         OR (n.subject_kind = 'post' AND NOT EXISTS (SELECT 1 FROM posts WHERE id = n.subject_id))
         OR (n.subject_kind = 'activity' AND NOT EXISTS (SELECT 1 FROM activity WHERE id = n.subject_id))
         OR (n.subject_kind = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = n.subject_id))
         OR (n.subject_kind = 'invite' AND NOT EXISTS (SELECT 1 FROM invites WHERE id = n.subject_id AND expires_at > ?1 AND uses < max_uses))
         OR (n.subject_kind = 'user' AND NOT EXISTS (SELECT 1 FROM users WHERE id = n.subject_id))
         LIMIT ?2)`,
    ).bind(now, L.nightlyBatch),
  ];
}
