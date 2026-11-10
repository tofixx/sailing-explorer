// Benachrichtigungs-Glocke (Konzept 17, F-250 … F-258): Fan-out je Empfänger:in, gebündelt je Art und Gegenstand,
// solange ungelesen. Die Zeilen sind nur ein Hinweis – Sichtbarkeit, Namen und Ziele prüft `listNotifications` beim
// Lesen. Schreiben scheitert nie die eigentliche Aktion (Kommentar, Reaktion, Folgen …).
// Bewusst ohne Abhängigkeit zu shares/groups/invites, damit diese Module es importieren können.
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { requireUser } from './auth';
import { canApprove, type Approvers, type GroupRole } from '../src/domain/groups';
import { sharePath, type Visibility } from '../src/domain/visibility';
import { sendPush } from './push';
import { pingLive } from './live';
import { EXPIRES_SQL } from './expiry-sql';
import { WARN_MS } from '../src/domain/support';
import { transferConsequence } from '../src/domain/claims';
import { isAdmin } from './validate';
import { followLevelSql, notifyLevelSql } from './notify-sql';
import { reachAtLeastSql } from './reach-sql';
import { isBackfill } from '../src/domain/logbook';
import { RSVP_NOTIFIED } from '../src/domain/events';
import { firstLine } from '../src/domain/posts';
import { publicSql } from './visible-sql';
import { subscribedSql, threadCol } from './comment-thread-sql';
import type { ThreadKind } from '../src/domain/comment-thread';
import {
  NOTIFICATION_LIMITS, notifyEventOf, isChoosable, type NotifyEvent, isNotificationKind, notificationText, parsePrefs, isNotificationSubject, type NotificationItem, type NotificationKind,
  type NotificationSubject,
} from '../src/domain/notifications';

/** Fehler beim Benachrichtigen dürfen die eigentliche Aktion nie scheitern lassen. */
async function safely(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`notification ${what} failed`, err);
  }
}

/**
 * Upsert für die Empfänger aus `recipients` (SQL, liefert Spalte `uid`, Parameter ab ?6): neue Zeile oder – solange
 * ungelesen – hochzählen und die handelnde Person ersetzen. Bei Reaktionen und Follower:innen zählt dieselbe Person
 * direkt hintereinander nur einmal und löst auch keinen Push und keinen Live-Hinweis aus (Entfolgen und wieder Folgen
 * in einer Schleife). Nie an sich selbst; ohne handelnde
 * Person (Hinweise des Betreibers) ist `actorId` null. Danach: Push an die, die es gewählt haben, und Live-Hinweis an
 * offene Seiten (Konzept 17.7/17.8).
 */
async function deliver(
  env: Env, kind: NotificationKind, subjectKind: NotificationSubject, subjectId: string, actorId: string | null, recipients: string, ...args: unknown[]
): Promise<void> {
  const rows = await write(env, kind, subjectKind, subjectId, actorId, recipients, ...args);
  if (!rows.length) return;
  const users = rows.map((r) => r.user_id);
  if (isChoosable(kind)) await sendPush(env, users, kind);
  await pingLive(env, users);
}

/** Nur die Zeilen schreiben (wie `deliver`, ohne Push und Live-Hinweis) – liefert Empfänger und Zähler der Zeile. */
async function write(
  env: Env, kind: NotificationKind, subjectKind: NotificationSubject, subjectId: string, actorId: string | null, recipients: string, ...args: unknown[]
): Promise<Array<{ user_id: string; count: number }>> {
  const { results } = await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, kind, subject_kind, subject_id, actor_id, count, created_at, updated_at)
     SELECT lower(hex(randomblob(12))), r.uid, ?1, ?2, ?3, ?4, 1, ?5, ?5 FROM (${recipients}) r
     WHERE r.uid IS NOT NULL AND r.uid IS NOT ?4
     ON CONFLICT(user_id, kind, subject_kind, subject_id) WHERE read_at IS NULL
     DO UPDATE SET count = count + 1, actor_id = excluded.actor_id, updated_at = excluded.updated_at
       WHERE NOT (?1 IN ('reaction', 'follow', 'rsvp') AND notifications.actor_id IS excluded.actor_id)
     RETURNING user_id, count`,
  )
    .bind(kind, subjectKind, subjectId, actorId, Date.now(), ...args)
    .all<{ user_id: string; count: number }>();
  return results;
}

/**
 * Neuer Kommentar (Konzept 17.9.1, 40; F-637): nur an die Abonnent:innen des Verlaufs (Törn bzw. Beitrag) – die
 * Eigentümer:in bzw. Autor:in ohne eigene Zeile und alle mit Glocke „an“ (`subscribedSql`, = `isSubscribed`); der Kanal
 * des Beitrags hört von Kommentaren nie. Andere als die Eigentümer:in nur, solange der Verlauf sie erreichen kann: Törn
 * öffentlich, weder ausgeblendet noch gesperrt; Beitrag „Öffentlich“ oder „Nur Mitglieder“ und nicht ausgeblendet (die
 * Mitgliedschaft prüft das Lesen). Nie die Kommentierende selbst, nie gesperrte Konten; Eigentümer:in zuerst, dann die
 * zuletzt Aktiven, höchstens NOTIFICATION_LIMITS.commentFanOut. Kanäle (Mail, Push) wählt jede:r selbst.
 */
export const notifyComment = (env: Env, kind: ThreadKind, threadId: string, actorId: string) =>
  safely('comment', () => {
    const col = threadCol(kind);
    const owner = kind === 'share' ? '(SELECT user_id FROM shares WHERE id = ?3)' : '(SELECT author_id FROM posts WHERE id = ?3)';
    const reachable =
      kind === 'share'
        ? `EXISTS (SELECT 1 FROM shares s WHERE s.id = ?3 AND ${publicSql('s')} AND s.locked_at IS NULL)`
        : `EXISTS (SELECT 1 FROM posts p WHERE p.id = ?3 AND p.visibility IN ('public', 'members') AND p.hidden_at IS NULL)`;
    return deliver(
      env, 'comment', kind, threadId, actorId,
      `SELECT u.id AS uid FROM users u LEFT JOIN comment_subscriptions cs ON cs.${col} = ?3 AND cs.user_id = u.id
       WHERE u.id IN (SELECT user_id FROM comment_subscriptions WHERE ${col} = ?3 UNION SELECT ${owner})
         AND u.suspended_at IS NULL AND u.locked_at IS NULL
         AND ${subscribedSql('cs.state', `u.id = ${owner}`)}
         AND (u.id = ${owner} OR ${reachable})
       ORDER BY u.id = ${owner} DESC, (SELECT MAX(c.created_at) FROM comments c WHERE c.${col} = ?3 AND c.user_id = u.id) DESC, cs.created_at DESC
       LIMIT ?6`,
      NOTIFICATION_LIMITS.commentFanOut,
    );
  });

/**
 * Reaktion: an die Eigentümer:in des Törns (auch bei Fotos – Gegenstand ist dann der Törn), die Autor:in des Beitrags
 * bzw. die handelnde Person der Neuigkeit. Zurücknehmen zählt nicht herunter.
 */
export async function notifyReaction(env: Env, subject: 'share' | 'photo' | 'post' | 'activity', id: string, actorId: string): Promise<void> {
  await safely('reaction', async () => {
    if (subject === 'photo') {
      const p = await env.DB.prepare('SELECT share_id, post_id FROM photos WHERE id = ?').bind(id).first<{ share_id: string | null; post_id: string | null }>();
      if (p?.share_id) await deliver(env, 'reaction', 'share', p.share_id, actorId, 'SELECT user_id AS uid FROM shares WHERE id = ?3');
      // Galerie-Foto (Konzept 31): Gegenstand ist der Beitrag, Empfänger:in seine Autor:in
      else if (p?.post_id) await deliver(env, 'reaction', 'post', p.post_id, actorId, 'SELECT author_id AS uid FROM posts WHERE id = ?3');
      return;
    }
    const owner =
      subject === 'share' ? 'SELECT user_id AS uid FROM shares WHERE id = ?3'
      : subject === 'post' ? 'SELECT author_id AS uid FROM posts WHERE id = ?3'
      : 'SELECT actor_id AS uid FROM activity WHERE id = ?3';
    await deliver(env, 'reaction', subject, id, actorId, owner);
  });
}

/** Neue Follower:in eines Profils: gebündelt in einer Zeile „X und n weitere folgen dir“. */
export const notifyFollow = (env: Env, targetUserId: string, actorId: string) =>
  safely('follow', () => deliver(env, 'follow', 'user', targetUserId, actorId, 'SELECT ?3 AS uid'));

/** Einladung an ein Konto (per Profilname) oder an eine Adresse, zu der es schon ein Konto gibt. */
export const notifyInvite = (env: Env, inviteId: string, to: { userId: string } | { email: string }, actorId: string) =>
  safely('invite', () =>
    'userId' in to
      ? deliver(env, 'invite', 'invite', inviteId, actorId, 'SELECT ?6 AS uid', to.userId)
      : deliver(env, 'invite', 'invite', inviteId, actorId, 'SELECT id AS uid FROM users WHERE email = ?6', to.email),
  );

/**
 * Beitrittsanfrage: an Eigner und Admins (bei „Nur der Eigner“ nur an ihn) – auch wenn alle Mitglieder bestätigen
 * dürften, damit der Fan-out klein bleibt (höchstens NOTIFICATION_LIMITS.requestFanOut). Direktes Ereignis: in jeder
 * Stufe außer „Stumm“ (F-449) – darf nur der Eigner bestätigen, bekommt er sie auch stumm (sie verlangt eine Handlung).
 */
export const notifyRequest = (env: Env, groupId: string, actorId: string) =>
  safely('request', () =>
    deliver(
      env, 'request', 'group', groupId, actorId,
      `SELECT m.user_id AS uid FROM group_members m JOIN groups g ON g.id = m.group_id
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?3 AND (m.role = 'owner' OR (m.role = 'admin' AND g.approve_by <> 'owner'))
         AND (${notifyLevelSql('post', true, 'm.notify_level')} OR (m.role = 'owner' AND g.approve_by = 'owner'))
       ORDER BY m.role = 'owner' DESC LIMIT ?6`,
      NOTIFICATION_LIMITS.requestFanOut,
    ),
  );

/** Verifizierung (Konzept 20.3): neuer Antrag – an die Admin-Konten (`ADMIN_USER_IDS`), nicht abschaltbar. */
export const notifyClaim = (env: Env, claimId: string, actorId: string, adminIds: string[]) =>
  safely('claim', () =>
    deliver(env, 'claim', 'claim', claimId, actorId, 'SELECT value AS uid FROM json_each(?6) WHERE value IN (SELECT id FROM users)', JSON.stringify(adminIds)),
  );

/** Verifizierung (Konzept 20.8): Entscheidung an die Antragsteller:in bzw. Übertragung an die verdrängte Person. */
export const notifyClaimResult = (env: Env, claimId: string) =>
  safely('claim result', () => deliver(env, 'claim_result', 'claim', claimId, null, 'SELECT user_id AS uid FROM claims WHERE id = ?3'));
export const notifyClaimTransfer = (env: Env, claimId: string) =>
  safely('claim transfer', () => deliver(env, 'claim_transfer', 'claim', claimId, null, 'SELECT previous_user_id AS uid FROM claims WHERE id = ?3'));

/**
 * Empfänger je Verlauf (`?6` = Verlauf): Kandidaten (`id`, `rel` = Mitglied bzw. Boot/Heimathafen dort) und die Regel je
 * Konto `u`. Gruppe: die Mitgliedschaft geht vor, die Follower-Stufe zählt nur ohne Mitgliedschaft; Follower nur bei
 * öffentlichen Beiträgen (`?9`) öffentlicher Gruppen. Hafen und Boot: wer dort Boot bzw. Heimathafen hat und folgt,
 * bekommt die höhere der beiden Stufen (Voreinstellung bzw. Folgen). Profil: Follower.
 */
/**
 * Hafen und Boot (24.7 Nr. 9): ein ausdrücklich gesetztes „Stumm“ am Folgen gewinnt immer; sonst die höhere Stufe aus
 * Voreinstellung (wer dort Boot bzw. Heimathafen hat, `c.rel`) und Folgen.
 */
const higherUnlessMuted = (event: NotifyEvent): string =>
  `(f.notify_level IS NOT 'muted' AND ((c.rel AND ${notifyLevelSql(event, false)}) OR (f.user_id IS NOT NULL AND ${notifyLevelSql(event, false, followLevelSql('f'))})))`;

function postAudience(kind: string, event: NotifyEvent): { ids: string; joins: string; ok: string } | null {
  const follow = (k: string) => `LEFT JOIN follows f ON f.user_id = u.id AND f.target_kind = '${k}' AND f.target_id = ?6`;
  const followOk = `(f.user_id IS NOT NULL AND ${notifyLevelSql(event, false, followLevelSql('f'))})`;
  switch (kind) {
    case 'group':
      return {
        ids: `SELECT user_id AS id, 1 AS rel FROM group_members WHERE group_id = ?6
          UNION SELECT user_id, 0 FROM follows WHERE target_kind = 'group' AND target_id = ?6 AND ?9
            AND EXISTS (SELECT 1 FROM groups gp WHERE gp.id = ?6 AND gp.visibility = 'public' AND gp.hidden_at IS NULL AND gp.locked_at IS NULL)`,
        joins: `LEFT JOIN group_members m ON m.group_id = ?6 AND m.user_id = u.id ${follow('group')}`,
        ok: notifyLevelSql(event, false, 'm.notify_level', `CASE WHEN m.user_id IS NULL THEN ${followLevelSql('f')} END`),
      };
    case 'harbor':
      return {
        ids: `SELECT id, MAX(rel) AS rel FROM (SELECT id, 1 AS rel FROM users WHERE home_harbor_id = ?6
          UNION ALL SELECT owner_id, 1 FROM boats WHERE harbor_id = ?6
          UNION ALL SELECT a.user_id, 1 FROM boat_admins a JOIN boats b ON b.id = a.boat_id WHERE b.harbor_id = ?6
          UNION ALL SELECT user_id, 0 FROM follows WHERE target_kind = 'harbor' AND target_id = ?6) GROUP BY id`,
        joins: follow('harbor'),
        ok: higherUnlessMuted(event),
      };
    case 'boat':
      return {
        ids: `SELECT id, MAX(rel) AS rel FROM (SELECT owner_id AS id, 1 AS rel FROM boats WHERE id = ?6
          UNION ALL SELECT user_id, 1 FROM boat_admins WHERE boat_id = ?6
          UNION ALL SELECT user_id, 0 FROM follows WHERE target_kind = 'boat' AND target_id = ?6) GROUP BY id`,
        joins: follow('boat'),
        ok: higherUnlessMuted(event),
      };
    case 'user':
      return { ids: `SELECT user_id AS id, 0 AS rel FROM follows WHERE target_kind = 'user' AND target_id = ?6`, joins: follow('user'), ok: followOk };
    default:
      return null;
  }
}

/**
 * Neuer bzw. angepinnter Beitrag (F-416, F-449, Konzept 21.7, 24.6): nur aus dem Heimatverlauf bzw. dem Verlauf, in dem
 * gepinnt wurde – die Ausbreitung nach oben benachrichtigt nie. Empfänger je `postAudience` und ihrer Stufe
 * (`shouldNotify`: jeder Beitrag nur bei „Alle Beiträge“, Umfragen, Veranstaltungen und Pins ab „Wichtiges“, nie bei
 * „Stumm“). Nie die Autor:in (handelnde Person) und nie `exclude` (wer anpinnt), nie gesperrte Konten, höchstens
 * NOTIFICATION_LIMITS.postFanOut. „Nur mit Link“ und „Nur ich“ benachrichtigen nicht. Ein Pin benachrichtigt nur, wer
 * zu diesem Beitrag noch keine Benachrichtigung hat. Automatische Einträge rufen dies nie auf (F-448).
 */
export const notifyPost = (
  env: Env,
  post: { id: string; authorId: string; kind?: string; pinned?: boolean; exclude?: string; channel: { kind: string; id: string }; visibility: string },
) =>
  safely('post', async () => {
    if (post.visibility !== 'public' && post.visibility !== 'members') return;
    if (post.visibility === 'members' && post.channel.kind !== 'group') return;
    const a = postAudience(post.channel.kind, notifyEventOf(post.kind ?? 'text', !!post.pinned));
    if (!a) return;
    const sql = `SELECT u.id AS uid FROM (${a.ids}) c JOIN users u ON u.id = c.id ${a.joins}
      WHERE u.suspended_at IS NULL AND u.locked_at IS NULL AND u.id IS NOT ?8 AND ${a.ok}
        ${post.pinned ? `AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.kind = 'post' AND n.subject_kind = 'post' AND n.subject_id = ?3)` : ''}
      LIMIT ?7`;
    // ?9 (öffentlich) kommt nur in der Gruppen-Abfrage vor – D1 lehnt überzählige Parameter ab
    const pub = post.channel.kind === 'group' ? [post.visibility === 'public' ? 1 : 0] : [];
    await deliver(env, 'post', 'post', post.id, post.authorId, sql, post.channel.id, NOTIFICATION_LIMITS.postFanOut, post.exclude ?? null, ...pub);
  });

/**
 * Neuer öffentlicher Törn bzw. Fahrtenbuch-Eintrag (F-449, Konzept 24.6): ein Beitrag wie ein Text-Beitrag, nur bei
 * „Alle Beiträge“. Empfänger: Mitglieder der Gruppen, in denen er gezeigt wird (`share_groups`), Follower dieser Gruppen,
 * wenn sie öffentlich sind und ihre Mitgliederliste öffentlich ist (sonst sehen Nicht-Mitglieder den Törn dort nicht,
 * F-442), Eigner und Admins des Boots (Voreinstellung) und Follower des Boots (öffentlich) – je nach Stufe. Nie die
 * Eigentümer:in, nie gesperrte Konten; wer zu diesem Törn schon eine Benachrichtigung hat, bekommt keine zweite (beim
 * ersten Erscheinen und bei neu gewählten Gruppen erneut aufrufbar). Fotos benachrichtigen nicht einzeln; die
 * Ausbreitung nach oben (Verein eines Teams, Hafen, Community) nie.
 */
export const notifyShare = (env: Env, shareId: string) =>
  safely('share', async () => {
    const s = await env.DB.prepare('SELECT user_id, boat_id, visibility, hidden_at, locked_at, started_at, created_at FROM shares WHERE id = ?')
      .bind(shareId)
      .first<{ user_id: string; boat_id: string | null; visibility: string; hidden_at: number | null; locked_at: number | null; started_at: number | null; created_at: number }>();
    if (!s || s.visibility !== 'public' || s.hidden_at || s.locked_at) return;
    // Nachträge (Abfahrt lange zurück, F-308) benachrichtigen nie – sie fluten sonst beim Nachtragen ganzer Saisons
    if (isBackfill(s.started_at, s.created_at)) return;
    const ok = (stored?: string) => (stored ? notifyLevelSql('post', false, stored) : notifyLevelSql('post', false));
    const liveGroup = `g.hidden_at IS NULL AND g.locked_at IS NULL`;
    const boatReach = reachAtLeastSql('?3', 'harbor');
    const sql = `SELECT u.id AS uid FROM (
        SELECT m.user_id AS id FROM share_groups sg JOIN group_members m ON m.group_id = sg.group_id WHERE sg.share_id = ?3
        UNION SELECT f.user_id FROM share_groups sg JOIN follows f ON f.target_kind = 'group' AND f.target_id = sg.group_id WHERE sg.share_id = ?3
        UNION SELECT owner_id FROM boats WHERE id = ?6
        UNION SELECT user_id FROM boat_admins WHERE boat_id = ?6
        UNION SELECT user_id FROM follows WHERE target_kind = 'boat' AND target_id = ?6
      ) c JOIN users u ON u.id = c.id
      WHERE u.suspended_at IS NULL AND u.locked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.kind = 'post' AND n.subject_kind = 'share' AND n.subject_id = ?3)
        -- höchstens SHARE_NOTIFY_PER_DAY Törns derselben Eigentümer:in je Empfänger:in und Tag (keine Flut)
        AND (SELECT COUNT(*) FROM notifications n JOIN shares x ON x.id = n.subject_id
             WHERE n.user_id = u.id AND n.kind = 'post' AND n.subject_kind = 'share' AND x.user_id = ?4 AND n.created_at > ?5 - 86400000) < ${NOTIFICATION_LIMITS.sharesPerDay}
        AND (
          EXISTS (SELECT 1 FROM share_groups sg JOIN groups g ON g.id = sg.group_id AND ${liveGroup}
                    JOIN group_members m ON m.group_id = g.id AND m.user_id = u.id
                  WHERE sg.share_id = ?3 AND ${ok('m.notify_level')})
          OR EXISTS (SELECT 1 FROM share_groups sg JOIN groups g ON g.id = sg.group_id AND ${liveGroup} AND g.visibility = 'public' AND g.members_visible = 'public'
                    JOIN follows f ON f.target_kind = 'group' AND f.target_id = g.id AND f.user_id = u.id
                  WHERE sg.share_id = ?3 AND NOT EXISTS (SELECT 1 FROM group_members x WHERE x.group_id = g.id AND x.user_id = u.id)
                    AND ${ok(followLevelSql('f'))})
          -- Boot nur, wenn „Sichtbar bis“ den Hafen abdeckt (wie shareTargetStmts, F-427); ausdrückliches „Stumm“ gewinnt
          OR (${boatReach} AND NOT EXISTS (SELECT 1 FROM follows fm WHERE fm.user_id = u.id AND fm.target_kind = 'boat' AND fm.target_id = ?6 AND fm.notify_level = 'muted')
              AND (u.id IN (SELECT owner_id FROM boats WHERE id = ?6) OR u.id IN (SELECT user_id FROM boat_admins WHERE boat_id = ?6)) AND ${ok()})
          OR (${boatReach} AND EXISTS (SELECT 1 FROM follows f JOIN boats b ON b.id = f.target_id AND b.visibility = 'public' AND b.hidden_at IS NULL
                  WHERE f.target_kind = 'boat' AND f.target_id = ?6 AND f.user_id = u.id AND ${ok(followLevelSql('f'))}))
        )
      LIMIT ?7`;
    await deliver(env, 'post', 'share', shareId, s.user_id, sql, s.boat_id ?? '', NOTIFICATION_LIMITS.postFanOut);
  });

/** Höchstens so viele beendete Umfragen meldet ein Nachtlauf (der Rest folgt in der nächsten Nacht). */
const POLL_CLOSED_BATCH = 200;
/** Beendete, noch nicht gemeldete Umfragen (`?1` jetzt) – in beiden Anweisungen dieselbe Auswahl in derselben Reihenfolge. */
const CLOSED_POLLS_SQL = `SELECT id FROM posts WHERE kind = 'poll' AND json_extract(data, '$.poll.notified') IS NULL
  AND json_extract(data, '$.poll.closesAt') <= ?1 ORDER BY id LIMIT ${POLL_CLOSED_BATCH}`;

/**
 * Nachtlauf (Konzept 29, F-476): „Deine Umfrage ist beendet“ an die Autor:in jeder Umfrage, deren Ende erreicht ist –
 * einmal (`data.poll.notified`), nur Glocke, im selben Batch markiert. Selbst beendete Umfragen sind schon markiert.
 */
export const nightlyPollClosedStmts = (env: Env, now: number): D1PreparedStatement[] => [
  env.DB.prepare(
    `INSERT INTO notifications (id, user_id, kind, subject_kind, subject_id, actor_id, count, created_at, updated_at)
     SELECT lower(hex(randomblob(12))), p.author_id, 'poll_closed', 'post', p.id, NULL, 1, ?1, ?1 FROM posts p
     WHERE p.id IN (${CLOSED_POLLS_SQL})
     ON CONFLICT DO NOTHING`,
  ).bind(now),
  env.DB.prepare(`UPDATE posts SET data = json_set(data, '$.poll.notified', 1) WHERE id IN (${CLOSED_POLLS_SQL})`).bind(now),
];
// ---------------------------------------------------------------- Veranstaltungen (Konzept 30, F-410, F-416)

/**
 * Alle mit „Nehme teil“ bzw. „Vielleicht“ (?3 = Beitrag), nicht gesperrt, höchstens NOTIFICATION_LIMITS.postFanOut (wie
 * neue Beiträge) – auch in stummen Verläufen (eigene Zusage, 21.7).
 */
const RSVP_RECIPIENTS = `SELECT r.user_id AS uid FROM event_rsvps r JOIN users u ON u.id = r.user_id
  WHERE r.post_id = ?3 AND r.status IN (${RSVP_NOTIFIED.map((x) => `'${x}'`).join(', ')}) AND u.suspended_at IS NULL AND u.locked_at IS NULL
  ORDER BY r.updated_at LIMIT ${NOTIFICATION_LIMITS.postFanOut}`;

/** Erste Zusage („Nehme teil“, „Vielleicht“) an die Autor:in – gebündelt, nur Glocke (kein wählbarer Kanal). */
export const notifyRsvp = (env: Env, postId: string, actorId: string) =>
  safely('rsvp', () => deliver(env, 'rsvp', 'post', postId, actorId, 'SELECT author_id AS uid FROM posts WHERE id = ?3'));

/**
 * Zeit/Ort geändert oder abgesagt (F-410): sofort an alle mit Zusage (Glocke, Live-Hinweis). Push für die, die ihn
 * gewählt haben: bei einer neuen Zeile, bei einer Absage immer und wenn die ungelesene Zeile bisher eine Erinnerung war
 * (ohne handelnde Person, also noch kein Push) – wiederholtes Ändern weckt nicht jedes Mal.
 */
export const notifyEventChange = (env: Env, postId: string, authorId: string, cancelled: boolean) =>
  safely('event change', async () => {
    const { results: reminded } = await env.DB.prepare(
      `SELECT user_id FROM notifications WHERE kind = 'event' AND subject_kind = 'post' AND subject_id = ? AND read_at IS NULL AND actor_id IS NULL`,
    )
      .bind(postId)
      .all<{ user_id: string }>();
    const wasReminder = new Set(reminded.map((r) => r.user_id));
    const rows = await write(env, 'event', 'post', postId, authorId, RSVP_RECIPIENTS);
    if (!rows.length) return;
    const push = rows.filter((r) => cancelled || r.count === 1 || wasReminder.has(r.user_id)).map((r) => r.user_id);
    if (push.length) await sendPush(env, push, 'event');
    await pingLive(env, rows.map((r) => r.user_id));
  });

/**
 * Erinnerung im Nachtlauf (F-485): ohne handelnde Person, nur Glocke und Sammelmail – kein Push und kein Live-Hinweis
 * um 03:17 UTC (Konzept 30.3).
 */
export const notifyEventReminder = (env: Env, postId: string) =>
  safely('event reminder', () => write(env, 'event', 'post', postId, null, RSVP_RECIPIENTS));

/** Hinweis des Betreibers (nicht abschaltbar, zusätzlich zur Mail): Törn wird bald gelöscht – an die Eigentümer:in. */
export const notifyExpiry = (env: Env, shareId: string) =>
  safely('expiry', () => deliver(env, 'expiry', 'share', shareId, null, 'SELECT user_id AS uid FROM shares WHERE id = ?3'));

/**
 * Unterstützung eingegangen (Stripe-Webhook, Gutschein der Moderation – Konzept 17.9.3): Löschwarnungen zu Törns, die
 * jetzt nicht mehr im Warnfenster ablaufen, verschwinden aus der Glocke.
 */
export const clearExpiryNotifications = (env: Env, userId: string) =>
  safely('clear expiry', async () => {
    const res = await env.DB.prepare(
      `DELETE FROM notifications WHERE user_id = ?1 AND kind = 'expiry' AND subject_kind = 'share'
         AND subject_id IN (SELECT s.id FROM shares s WHERE s.user_id = ?1 AND ${EXPIRES_SQL} > ?2)`,
    )
      .bind(userId, Date.now() + WARN_MS)
      .run();
    if (res.meta.changes) await pingLive(env, [userId]);
  });

/** Hinweis des Betreibers (nicht abschaltbar, zusätzlich zur Mail): neuer Passkey am eigenen Konto. */
export const notifyPasskey = (env: Env, userId: string) =>
  safely('passkey', () => deliver(env, 'passkey', 'user', userId, null, 'SELECT ?3 AS uid'));

// ---------------------------------------------------------------- Gelesen

/** Gelesen: diese Einträge, alle einer Art, alle zu einem Gegenstand – immer nur die eigenen. */
const readStmt = (env: Env, userId: string, where: string, ...args: unknown[]) =>
  env.DB.prepare(`UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL AND ${where}`).bind(Date.now(), userId, ...args);

/** Kommentare eines Beitrags geöffnet (Konzept 40): seine Kommentar-Benachrichtigungen für dieses Konto gelesen. */
export const readThreadNotifications = (env: Env, userId: string, postId: string) =>
  safely('read comments', async () => {
    const res = await readStmt(env, userId, `kind = 'comment' AND subject_kind = 'post' AND subject_id = ?3`, postId).run();
    if (res.meta.changes) await pingLive(env, [userId]);
  });

/** Einladung angesehen (Link aus der Mail, `peek`): für dieses Konto gelesen. */
export const readInviteNotification = (env: Env, userId: string, inviteId: string) =>
  safely('read invite', () => readStmt(env, userId, `subject_kind = 'invite' AND subject_id = ?3`, inviteId).run());

/**
 * POST /api/notifications/read – `{ ids }`, `{ kind }`, `{ subjectKind, subjectId }` oder `{ all: true }`. Ohne eine
 * dieser Angaben 400 (nie versehentlich alles). Antwort: neuer Zähler.
 */
export async function markRead(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const b = await readJson<{ ids?: unknown; kind?: unknown; subjectKind?: unknown; subjectId?: unknown; all?: unknown }>(request);
  let stmt: D1PreparedStatement;
  if (Array.isArray(b.ids) && b.ids.length && b.ids.length <= NOTIFICATION_LIMITS.list && b.ids.every((i) => typeof i === 'string' && /^[a-z0-9]{8,32}$/i.test(i))) {
    stmt = readStmt(env, user.id, `id IN (${b.ids.map((_, i) => `?${i + 3}`).join(', ')})`, ...b.ids);
  } else if (isNotificationKind(b.kind)) {
    stmt = readStmt(env, user.id, 'kind = ?3', b.kind);
  } else if (isNotificationSubject(b.subjectKind) && typeof b.subjectId === 'string' && /^[A-Za-z0-9-]{3,32}$/.test(b.subjectId)) {
    stmt = readStmt(env, user.id, 'subject_kind = ?3 AND subject_id = ?4', b.subjectKind, b.subjectId);
  } else if (b.all === true) {
    stmt = readStmt(env, user.id, '1');
  } else {
    throw new HttpError(400, 'invalid_body', 'ids, kind, subjectKind/subjectId oder all angeben.');
  }
  const res = await stmt.run();
  // andere offene Seiten desselben Kontos (Tabs, Geräte) gleichen ihren Zähler an
  if (res.meta.changes) await safely('live', () => pingLive(env, [user.id]));
  return json({ unread: await unreadCount(env, user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// ---------------------------------------------------------------- Lesen

/** Ungelesene, gedeckelt (Badge zeigt ab badgeMax „99+“). */
async function unreadCount(env: Env, userId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM notifications WHERE user_id = ? AND read_at IS NULL LIMIT ?)')
    .bind(userId, NOTIFICATION_LIMITS.badgeMax + 1)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** GET /api/notifications/count – nur der Zähler (Badge); billig, ohne Prüf-Joins. */
export async function getUnread(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json({ unread: await unreadCount(env, user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

interface Row {
  id: string;
  kind: string;
  subject_kind: string;
  subject_id: string;
  count: number;
  updated_at: number;
  read_at: number | null;
  actor_name: string | null;
  actor_handle: string | null;
  s_owner: string | null;
  /** Eigentümer:in gesperrt (Törn als Beitrag, F-449) */
  s_susp?: number | null;
  s_title: string | null;
  s_vis: Visibility | null;
  s_key: string | null;
  s_hidden: number | null;
  s_locked: number | null;
  s_cmode: string | null;
  p_author: string | null;
  p_hidden: number | null;
  p_group: string | null;
  p_handle: string | null;
  /** Profil der Autor:in öffentlich und ihr Name (Profil-Verlauf) */
  p_apub: number | null;
  p_aname: string | null;
  /** Schlüssel „Nur mit Link“ (Veranstaltung: Ziel `/p/<id>/<schlüssel>`) */
  p_key: string | null;
  p_ck: string | null;
  p_vis: string | null;
  /** Kommentar-Modus des Beitrags (Konzept 40) */
  p_cmode?: string | null;
  p_kind?: string | null;
  p_susp: number | null;
  /** Veranstaltung (Konzept 30): erste Zeile = Titel, abgesagt, eigene Zusage, Anlass ohne handelnde Person */
  p_body: string | null;
  p_cancelled: number | null;
  p_rsvp: number | null;
  n_system: number;
  ph_name: string | null;
  pb_name: string | null;
  pb_vis: string | null;
  pb_role: number | null;
  a_actor: string | null;
  g_slug: string | null;
  g_name: string | null;
  g_vis: Visibility | null;
  g_key: string | null;
  g_hidden: number | null;
  g_locked: number | null;
  g_approve: Approvers | null;
  g_role: GroupRole | null;
  g_open: number;
  i_kind: string | null;
  i_gkind: string | null;
  i_for: number | null;
  i_target: string | null;
  c_status: string | null;
  c_user: string | null;
  c_prev: string | null;
  c_prev_action: string | null;
  c_kind: string | null;
  c_name: string | null;
  c_slug: string | null;
  c_public: number | null;
}

/**
 * Eine Abfrage mit den Prüf-Joins je Gegenstand. Handelnde Personen nur mit öffentlichem, nicht ausgeblendetem Profil
 * eines nicht gesperrten Kontos – sonst „Jemand“. Konto-IDs und Adressen verlassen den Worker nicht.
 */
const LIST_SQL = `SELECT n.id, n.kind, n.subject_kind, n.subject_id, n.count, n.updated_at, n.read_at,
    ap.display_name AS actor_name, ap.handle AS actor_handle,
    s.user_id AS s_owner, EXISTS (SELECT 1 FROM users su WHERE su.id = s.user_id AND su.suspended_at IS NOT NULL) AS s_susp, s.title AS s_title, s.visibility AS s_vis, s.share_key AS s_key,
    s.hidden_at AS s_hidden, s.locked_at AS s_locked, s.comments_mode AS s_cmode,
    p.author_id AS p_author, p.hidden_at AS p_hidden, p.group_id AS p_group, pp.handle AS p_handle, a.actor_id AS a_actor,
    ${publicSql('pp')} AS p_apub, pp.display_name AS p_aname, p.link_key AS p_key,
    p.channel_kind AS p_ck, p.visibility AS p_vis, p.kind AS p_kind, p.comments_mode AS p_cmode, ph.name AS ph_name, pb.name AS pb_name, pb.visibility AS pb_vis,
    EXISTS (SELECT 1 FROM users pu WHERE pu.id = p.author_id AND pu.suspended_at IS NOT NULL) AS p_susp,
    CASE WHEN n.kind IN ('event', 'rsvp') THEN p.body END AS p_body, (n.actor_id IS NULL) AS n_system,
    (SELECT pe.cancelled_at FROM post_events pe WHERE n.kind = 'event' AND pe.post_id = p.id) AS p_cancelled,
    EXISTS (SELECT 1 FROM event_rsvps er WHERE n.kind = 'event' AND er.post_id = p.id AND er.user_id = n.user_id AND er.status IN (${RSVP_NOTIFIED.map((x) => `'${x}'`).join(', ')})) AS p_rsvp,
    (pb.owner_id = n.user_id OR EXISTS (SELECT 1 FROM boat_admins ba WHERE ba.boat_id = pb.id AND ba.user_id = n.user_id)) AS pb_role,
    g.slug AS g_slug, g.name AS g_name, g.visibility AS g_vis, g.share_key AS g_key, g.hidden_at AS g_hidden,
    g.locked_at AS g_locked, g.approve_by AS g_approve, gm.role AS g_role,
    EXISTS (SELECT 1 FROM group_requests r WHERE r.group_id = g.id) AS g_open,
    i.kind AS i_kind, ig.kind AS i_gkind,
    (i.id IS NOT NULL AND i.expires_at > ?2 AND i.uses < i.max_uses AND (i.invitee_id = ?1 OR i.email = ?3)) AS i_for,
    COALESCE(ib.name, ishare.title, ig.name) AS i_target,
    c.status AS c_status, c.user_id AS c_user, c.previous_user_id AS c_prev, c.previous_action AS c_prev_action,
    c.target_kind AS c_kind, COALESCE(cg.name, ch.name) AS c_name, COALESCE(cg.slug, ch.slug) AS c_slug,
    (ch.id IS NOT NULL OR cg.visibility = 'public') AS c_public
  FROM notifications n
  LEFT JOIN users au ON au.id = n.actor_id AND au.suspended_at IS NULL AND au.locked_at IS NULL
  LEFT JOIN profiles ap ON ap.user_id = au.id AND ap.visibility = 'public' AND ap.hidden_at IS NULL
  LEFT JOIN shares s ON n.subject_kind = 'share' AND s.id = n.subject_id
  LEFT JOIN posts p ON n.subject_kind = 'post' AND p.id = n.subject_id
  LEFT JOIN profiles pp ON pp.user_id = p.author_id
  LEFT JOIN harbors ph ON p.channel_kind = 'harbor' AND ph.id = p.channel_id AND ph.hidden_at IS NULL
  LEFT JOIN boats pb ON p.channel_kind = 'boat' AND pb.id = p.channel_id AND pb.hidden_at IS NULL AND pb.locked_at IS NULL
  LEFT JOIN activity a ON n.subject_kind = 'activity' AND a.id = n.subject_id
  LEFT JOIN groups g ON g.id = CASE n.subject_kind WHEN 'group' THEN n.subject_id WHEN 'post' THEN p.group_id END
  LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = n.user_id
  LEFT JOIN invites i ON n.subject_kind = 'invite' AND i.id = n.subject_id
  LEFT JOIN boats ib ON ib.id = i.boat_id AND ib.locked_at IS NULL
  LEFT JOIN shares ishare ON ishare.id = i.share_id AND ishare.locked_at IS NULL
  LEFT JOIN groups ig ON ig.id = i.group_id AND ig.locked_at IS NULL
  LEFT JOIN claims c ON n.subject_kind = 'claim' AND c.id = n.subject_id
  LEFT JOIN groups cg ON c.target_kind = 'group' AND cg.id = c.target_id AND cg.hidden_at IS NULL AND cg.locked_at IS NULL
  LEFT JOIN harbors ch ON c.target_kind = 'harbor' AND ch.id = c.target_id AND ch.hidden_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM locks hl WHERE hl.target_kind = 'harbor' AND hl.target_id = ch.id)
  WHERE n.user_id = ?1
  ORDER BY n.updated_at DESC
  LIMIT ?4`;

const INVITE_WHAT: Record<string, string> = { boat_admin: 'als Admin für das Boot', crew: 'in die Crew von', friend: 'zum gegenseitigen Folgen' };

/**
 * Darf die Empfängerin einen Beitrag (neu, Veranstaltung) aus der Glocke sehen – und wie heißt sein Verlauf? Gruppe:
 * öffentlich bzw. „Nur Mitglieder“ und noch Mitglied, Follower nur öffentliche Beiträge öffentlicher Gruppen (F-449);
 * Hafen: öffentlich; Boot: öffentlich und das Boot öffentlich oder selbst verwaltet; Profil: öffentlich und Profil der
 * Autor:in öffentlich (ihr Name). Nie bei ausgeblendetem Beitrag oder gesperrter Autor:in – kein Eintrag führt auf eine 404.
 */
function postWhere(r: Row): string | null {
  if (r.p_hidden || r.p_susp) return null;
  if (r.p_ck === 'group') {
    const member = (r.p_vis === 'public' || r.p_vis === 'members') && !!r.g_role;
    const follower = r.p_vis === 'public' && r.g_vis === 'public';
    return r.g_slug && !r.g_hidden && !r.g_locked && (member || follower) ? (r.g_name ?? '') : null;
  }
  if (r.p_vis !== 'public') return null;
  if (r.p_ck === 'harbor') return r.ph_name ?? null;
  if (r.p_ck === 'boat') return r.pb_name && (r.pb_vis === 'public' || r.pb_role) ? r.pb_name : null;
  if (r.p_ck === 'user') return r.p_apub ? (r.p_aname ?? '') : null;
  return null;
}

/**
 * Verlauf einer Veranstaltung für Erinnerung und Änderung: besteht er noch (Gruppe nicht ausgeblendet oder gesperrt, Hafen
 * nicht ausgeblendet, Boot weder ausgeblendet noch gesperrt)? Name für die Sammelmail; Profil ohne Namen ('').
 */
function eventWhere(r: Row): string | null {
  if (r.p_ck === 'group') return r.g_slug && !r.g_hidden && !r.g_locked ? (r.g_name ?? '') : null;
  if (r.p_ck === 'harbor') return r.ph_name ?? null;
  if (r.p_ck === 'boat') return r.pb_name ?? null;
  return r.p_ck === 'user' ? '' : null;
}

/** Prüfung beim Lesen: Eintrag gültig? Dann Text-Bausteine und Ziel, sonst null. */
function shape(r: Row, userId: string): Omit<NotificationItem, 'text'> | null {
  if (!isNotificationKind(r.kind)) return null;
  const actor = r.actor_name && r.actor_handle ? { name: r.actor_name, handle: r.actor_handle } : null;
  const base = { id: r.id, kind: r.kind, count: r.count, actor, at: r.updated_at, read: r.read_at !== null };
  const groupHref = () => sharePath('g', r.g_slug!, r.g_vis ?? 'private', r.g_key);
  switch (r.subject_kind) {
    case 'share':
      // Gesperrtes sieht nur die Moderation (Konzept 18) – auch nicht die Eigentümer:in über die Glocke
      if (r.s_title === null || r.s_locked) return null;
      // Neuer Törn in einer Gruppe bzw. am Boot (F-449): solange er öffentlich und nicht ausgeblendet ist
      if (r.kind === 'post') return r.s_vis === 'public' && !r.s_hidden && !r.s_susp ? { ...base, title: r.s_title, what: 'voyage', href: sharePath('s', r.subject_id, 'public', null) } : null;
      // Mitkommentierende (17.9.1): nur Kommentare, nur solange der Törn öffentlich ist und Kommentare zeigt – ohne
      // Schlüssel, damit ein erneuerter Link-Schlüssel nie über die Glocke verraten wird.
      if (r.s_owner !== userId) {
        if (r.kind !== 'comment' || r.s_vis !== 'public' || r.s_hidden || r.s_locked || r.s_cmode === 'hidden') return null;
        return { ...base, title: r.s_title, what: 'den Törn', href: sharePath('s', r.subject_id, 'public', null) };
      }
      // Eigene Törns (Kommentare, Reaktionen, Löschhinweis) – die Eigentümer:in sieht ihren Törn immer.
      if (r.kind === 'expiry') return { ...base, title: r.s_title, what: 'bald', href: '/?support=open' };
      return { ...base, title: r.s_title, what: 'deinen Törn', href: sharePath('s', r.subject_id, r.s_vis ?? 'private', r.s_key) };
    case 'post':
      // Neuer Beitrag (F-416): nur, solange die Empfängerin ihn sehen darf – kein Eintrag, der auf eine 404 führt.
      // Gruppe: öffentlich bzw. „Nur Mitglieder“ und noch Mitglied – Follower nur öffentliche Beiträge öffentlicher
      // Gruppen (F-449); Hafen: öffentlich; Boot: öffentlich und das Boot öffentlich oder selbst verwaltet; Profil:
      // öffentlich und Profil der Autor:in öffentlich. Nie bei ausgeblendetem Beitrag oder gesperrter Autor:in.
      if (r.kind === 'post') {
        // Profil: Text-Beiträge „in <Name>“ (nur mit öffentlichem Profil der handelnden Person); Umfrage ohne Ort
        const where = postWhere(r);
        if (where === null || (r.p_ck === 'user' && !actor)) return null;
        // Umfrage (Konzept 29) und Veranstaltung (Konzept 30): eigener Satz „neue Umfrage“ bzw. „neue Veranstaltung“
        const kindWhat = r.p_kind === 'poll' || r.p_kind === 'event' ? r.p_kind : '';
        return { ...base, title: r.p_ck === 'user' && kindWhat ? '' : where, what: kindWhat, href: `/p/${r.subject_id}` };
      }
      // Veranstaltung (Konzept 30): Zusage an die Autor:in; Erinnerung, Änderung, Absage an alle mit gültiger Zusage – wer
      // zugesagt hat, kannte die Veranstaltung (auch „Nur mit Link“: Ziel mit Schlüssel). Nie bei ausgeblendetem Beitrag,
      // gesperrter Autor:in oder ausgeblendetem bzw. gesperrtem Verlauf. Die Sammelmail nennt nur den Verlauf (`where`),
      // nie den Titel (Regel von `mailLine`).
      if (r.kind === 'event' || r.kind === 'rsvp') {
        if (r.p_body === null || r.p_hidden || r.p_susp) return null;
        if (r.kind === 'rsvp' ? r.p_author !== userId : !r.p_rsvp) return null;
        const where = eventWhere(r);
        if (where === null) return null;
        const what = r.kind === 'rsvp' ? '' : r.p_cancelled ? 'cancelled' : r.n_system ? 'reminder' : 'changed';
        const href = r.p_vis === 'unlisted' && r.p_key ? `/p/${r.subject_id}/${r.p_key}` : `/p/${r.subject_id}`;
        return { ...base, title: firstLine(r.p_body), what, href, ...(where ? { where } : {}) };
      }
      // Kommentar im Beitrag (Konzept 40, F-637): die Autor:in, solange ihr Verlauf besteht; Abonnent:innen nur, solange
      // sie den Beitrag sehen dürfen (wie neue Beiträge, `postWhere` – „Nur mit Link“ fällt weg wie bei Törns) und die
      // Kommentare nicht ausgeblendet sind. Titel ist der Verlauf, nie der Beitragstext (Sammelmail, `mailLine`).
      if (r.kind === 'comment') {
        if (r.p_author === null || r.p_hidden || r.p_susp) return null;
        const own = r.p_author === userId;
        const where = own ? eventWhere(r) : r.p_cmode === 'hidden' ? null : postWhere(r);
        if (where === null) return null;
        return { ...base, title: where, what: own ? 'deinen Beitrag' : 'einen Beitrag', href: `/p/${r.subject_id}` };
      }
      if (r.p_author !== userId || r.p_hidden) return null;
      // Beiträge haben keine eigene Seite: `/p/<id>` führt zum Anker im Heimatverlauf (F-406)
      if (!r.p_group) return { ...base, title: '', what: 'deinen Beitrag', href: `/p/${r.subject_id}` };
      if (!r.g_slug || r.g_hidden || r.g_locked || !r.g_role) return null;
      return { ...base, title: r.g_name ?? '', what: 'deinen Beitrag in', href: `/p/${r.subject_id}` };
    case 'activity':
      if (r.a_actor !== userId) return null;
      return { ...base, title: '', what: 'deine Neuigkeit', href: '/' };
    case 'user':
      if (r.subject_id !== userId) return null;
      if (r.kind === 'passkey') return { ...base, title: '', what: '', href: '/?konto=einstellungen' };
      return { ...base, title: '', what: '', href: actor ? `/u/${actor.handle}` : '/' };
    case 'invite': {
      if (!r.i_for || !r.i_kind) return null;
      // Ziel gesperrt (oder gelöscht): nichts verraten
      if (r.i_kind !== 'friend' && r.i_target === null) return null;
      const what = r.i_kind === 'group' ? `in ${r.i_gkind === 'team' ? 'das Team' : 'den Verein'}` : (INVITE_WHAT[r.i_kind] ?? 'zu');
      // Freundes-Einladungen haben kein Ziel. Annehmen und Ablehnen im Konto („Einladungen an dich“).
      return { ...base, title: r.i_kind === 'friend' ? '' : (r.i_target ?? ''), what, href: '/?konto=einladungen' };
    }
    case 'group':
      // Anfragen nur, solange es offene gibt, ich sie bestätigen darf und die Gruppe besteht.
      if (!r.g_slug || r.g_locked || !r.g_approve || !r.g_open || !canApprove(r.g_role, r.g_approve)) return null;
      return { ...base, title: r.g_name ?? '', what: '', href: groupHref() };
    case 'claim': {
      // Verifizierung (Konzept 20.8): Ziel ausgeblendet, gesperrt oder gelöscht → nichts verraten
      if (!r.c_status || !r.c_name || !r.c_slug) return null;
      const target = r.c_kind === 'harbor' ? `/h/${r.c_slug}` : `/g/${r.c_slug}`;
      if (r.kind === 'claim') return r.c_status === 'open' ? { ...base, title: r.c_name, what: '', href: '/admin?tab=claims' } : null;
      // Nicht öffentliche Vereine: nur, wer dort jetzt verwaltet bzw. Mitglied ist, kommt ohne Schlüssel hinein
      if (r.kind === 'claim_result' && r.c_user === userId) {
        return { ...base, title: r.c_name, what: r.c_status, href: r.c_public || r.c_status === 'accepted' ? target : '/' };
      }
      if (r.kind === 'claim_transfer' && r.c_prev === userId) {
        return { ...base, title: r.c_name, what: transferConsequence(r.c_kind === 'harbor' ? 'harbor' : 'group', r.c_prev_action), href: r.c_public ? target : '/' };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * GET /api/notifications – die neuesten Einträge mit Prüfung beim Lesen. Was nicht (mehr) gilt (Gegenstand gelöscht,
 * privat, Rolle verloren, Einladung abgelaufen), erscheint nicht und wird als gelesen markiert, damit der Zähler stimmt.
 */
export async function listNotifications(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  let items = await loadNotifications(env, user, NOTIFICATION_LIMITS.list);
  // ?push=1 (Service Worker): nur Arten, für die das Konto Push gewählt hat – sonst zeigte der Weckruf etwas anderes
  if (new URL(request.url).searchParams.get('push') === '1') {
    const prefs = parsePrefs((await env.DB.prepare('SELECT notify_prefs FROM users WHERE id = ?').bind(user.id).first<{ notify_prefs: string }>())?.notify_prefs);
    items = items.filter((n) => isChoosable(n.kind) && prefs[n.kind] === 'push');
  }
  return json({ items, unread: await unreadCount(env, user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Die neuesten `limit` gültigen Einträge eines Kontos, geprüft wie beim Lesen – auch für die Sammelmail. */
export async function loadNotifications(env: Env, user: { id: string; email: string }, limit: number): Promise<NotificationItem[]> {
  const { results } = await env.DB.prepare(LIST_SQL).bind(user.id, Date.now(), user.email, limit).all<Row>();
  const items: NotificationItem[] = [];
  const stale: string[] = [];
  for (const r of results) {
    // Hinweise auf neue Anträge nur, solange das Konto Admin ist (Konzept 20.3)
    const item = r.kind === 'claim' && !isAdmin(env, user.id) ? null : shape(r, user.id);
    if (item) items.push({ ...item, text: notificationText(item) });
    else if (r.read_at === null) stale.push(r.id);
  }
  if (stale.length) await readStmt(env, user.id, `id IN (${stale.map((_, i) => `?${i + 3}`).join(', ')})`, ...stale).run();
  return items;
}
