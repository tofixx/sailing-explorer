// SQL-Bausteine der Verläufe mit Kommentaren (Konzept 40) – Gegenstück zu src/domain/comment-thread.ts. Ohne
// Abhängigkeiten zu Worker-Modulen, damit worker/notifications.ts sie ohne Import-Zyklus nutzt.
import type { ThreadKind } from '../src/domain/comment-thread';

/** Spalte des Verlaufs in `comments` und `comment_subscriptions` (fest, nie aus der Anfrage). */
export const threadCol = (k: ThreadKind): 'share_id' | 'post_id' => (k === 'share' ? 'share_id' : 'post_id');

/** = `isSubscribed`: Zustand der Zeile (`state`, NULL ohne Zeile) und Eigentum (`owner`, 0/1) → benachrichtigt (0/1). */
export const subscribedSql = (state: string, owner: string): string => `(CASE WHEN ${state} IS NULL THEN (${owner}) ELSE ${state} = 'on' END)`;
