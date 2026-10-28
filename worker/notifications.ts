// Benachrichtigungs-Glocke (Konzept 17, F-250 … F-258): Fan-out an genau eine Person, gebündelt je Art und Gegenstand,
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
import {
  NOTIFICATION_LIMITS, isChoosable, isNotificationKind, notificationText, parsePrefs, isNotificationSubject, type NotificationItem, type NotificationKind,
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
  const { results } = await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, kind, subject_kind, subject_id, actor_id, count, created_at, updated_at)
     SELECT lower(hex(randomblob(12))), r.uid, ?1, ?2, ?3, ?4, 1, ?5, ?5 FROM (${recipients}) r
     WHERE r.uid IS NOT NULL AND r.uid IS NOT ?4
     ON CONFLICT(user_id, kind, subject_kind, subject_id) WHERE read_at IS NULL
     DO UPDATE SET count = count + 1, actor_id = excluded.actor_id, updated_at = excluded.updated_at
       WHERE NOT (?1 IN ('reaction', 'follow') AND notifications.actor_id IS excluded.actor_id)
     RETURNING user_id`,
  )
    .bind(kind, subjectKind, subjectId, actorId, Date.now(), ...args)
    .all<{ user_id: string }>();
  const users = results.map((r) => r.user_id);
  if (!users.length) return;
  if (isChoosable(kind)) await sendPush(env, users, kind);
  await pingLive(env, users);
}

/** Neuer Kommentar: an die Eigentümer:in des Törns. */
export const notifyComment = (env: Env, shareId: string, actorId: string) =>
  safely('comment', () => deliver(env, 'comment', 'share', shareId, actorId, 'SELECT user_id AS uid FROM shares WHERE id = ?3'));

/**
 * Reaktion: an die Eigentümer:in des Törns (auch bei Fotos – Gegenstand ist dann der Törn), die Autor:in des Beitrags
 * bzw. die handelnde Person der Neuigkeit. Zurücknehmen zählt nicht herunter.
 */
export async function notifyReaction(env: Env, subject: 'share' | 'photo' | 'post' | 'activity', id: string, actorId: string): Promise<void> {
  await safely('reaction', async () => {
    if (subject === 'photo') {
      const p = await env.DB.prepare('SELECT share_id FROM photos WHERE id = ?').bind(id).first<{ share_id: string }>();
      if (p) await deliver(env, 'reaction', 'share', p.share_id, actorId, 'SELECT user_id AS uid FROM shares WHERE id = ?3');
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
 * dürften, damit der Fan-out klein bleibt (höchstens NOTIFICATION_LIMITS.requestFanOut).
 */
export const notifyRequest = (env: Env, groupId: string, actorId: string) =>
  safely('request', () =>
    deliver(
      env, 'request', 'group', groupId, actorId,
      `SELECT m.user_id AS uid FROM group_members m JOIN groups g ON g.id = m.group_id
       WHERE m.group_id = ?3 AND (m.role = 'owner' OR (m.role = 'admin' AND g.approve_by <> 'owner'))
       ORDER BY m.role = 'owner' DESC LIMIT ?6`,
      NOTIFICATION_LIMITS.requestFanOut,
    ),
  );

/** Hinweis des Betreibers (nicht abschaltbar, zusätzlich zur Mail): Törn wird bald gelöscht – an die Eigentümer:in. */
export const notifyExpiry = (env: Env, shareId: string) =>
  safely('expiry', () => deliver(env, 'expiry', 'share', shareId, null, 'SELECT user_id AS uid FROM shares WHERE id = ?3'));

/** Hinweis des Betreibers (nicht abschaltbar, zusätzlich zur Mail): neuer Passkey am eigenen Konto. */
export const notifyPasskey = (env: Env, userId: string) =>
  safely('passkey', () => deliver(env, 'passkey', 'user', userId, null, 'SELECT ?3 AS uid'));

// ---------------------------------------------------------------- Gelesen

/** Gelesen: diese Einträge, alle einer Art, alle zu einem Gegenstand – immer nur die eigenen. */
const readStmt = (env: Env, userId: string, where: string, ...args: unknown[]) =>
  env.DB.prepare(`UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL AND ${where}`).bind(Date.now(), userId, ...args);

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
  s_title: string | null;
  s_vis: Visibility | null;
  s_key: string | null;
  p_author: string | null;
  p_hidden: number | null;
  a_actor: string | null;
  g_slug: string | null;
  g_name: string | null;
  g_vis: Visibility | null;
  g_key: string | null;
  g_hidden: number | null;
  g_approve: Approvers | null;
  g_role: GroupRole | null;
  g_open: number;
  i_kind: string | null;
  i_gkind: string | null;
  i_for: number | null;
  i_target: string | null;
}

/**
 * Eine Abfrage mit den Prüf-Joins je Gegenstand. Handelnde Personen nur mit öffentlichem, nicht ausgeblendetem Profil
 * eines nicht gesperrten Kontos – sonst „Jemand“. Konto-IDs und Adressen verlassen den Worker nicht.
 */
const LIST_SQL = `SELECT n.id, n.kind, n.subject_kind, n.subject_id, n.count, n.updated_at, n.read_at,
    ap.display_name AS actor_name, ap.handle AS actor_handle,
    s.user_id AS s_owner, s.title AS s_title, s.visibility AS s_vis, s.share_key AS s_key,
    p.author_id AS p_author, p.hidden_at AS p_hidden, a.actor_id AS a_actor,
    g.slug AS g_slug, g.name AS g_name, g.visibility AS g_vis, g.share_key AS g_key, g.hidden_at AS g_hidden,
    g.approve_by AS g_approve, gm.role AS g_role,
    EXISTS (SELECT 1 FROM group_requests r WHERE r.group_id = g.id) AS g_open,
    i.kind AS i_kind, ig.kind AS i_gkind,
    (i.id IS NOT NULL AND i.expires_at > ?2 AND i.uses < i.max_uses AND (i.invitee_id = ?1 OR i.email = ?3)) AS i_for,
    COALESCE(ib.name, ishare.title, ig.name) AS i_target
  FROM notifications n
  LEFT JOIN users au ON au.id = n.actor_id AND au.suspended_at IS NULL AND au.locked_at IS NULL
  LEFT JOIN profiles ap ON ap.user_id = au.id AND ap.visibility = 'public' AND ap.hidden_at IS NULL
  LEFT JOIN shares s ON n.subject_kind = 'share' AND s.id = n.subject_id
  LEFT JOIN posts p ON n.subject_kind = 'post' AND p.id = n.subject_id
  LEFT JOIN activity a ON n.subject_kind = 'activity' AND a.id = n.subject_id
  LEFT JOIN groups g ON g.id = CASE n.subject_kind WHEN 'group' THEN n.subject_id WHEN 'post' THEN p.group_id END
  LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = n.user_id
  LEFT JOIN invites i ON n.subject_kind = 'invite' AND i.id = n.subject_id
  LEFT JOIN boats ib ON ib.id = i.boat_id
  LEFT JOIN shares ishare ON ishare.id = i.share_id
  LEFT JOIN groups ig ON ig.id = i.group_id
  WHERE n.user_id = ?1
  ORDER BY n.updated_at DESC
  LIMIT ?4`;

const INVITE_WHAT: Record<string, string> = { boat_admin: 'als Admin für das Boot', crew: 'in die Crew von', friend: 'zum gegenseitigen Folgen' };

/** Prüfung beim Lesen: Eintrag gültig? Dann Text-Bausteine und Ziel, sonst null. */
function shape(r: Row, userId: string): Omit<NotificationItem, 'text'> | null {
  if (!isNotificationKind(r.kind)) return null;
  const actor = r.actor_name && r.actor_handle ? { name: r.actor_name, handle: r.actor_handle } : null;
  const base = { id: r.id, kind: r.kind, count: r.count, actor, at: r.updated_at, read: r.read_at !== null };
  const groupHref = () => sharePath('g', r.g_slug!, r.g_vis ?? 'private', r.g_key);
  switch (r.subject_kind) {
    case 'share':
      // Nur eigene Törns (Kommentare, Reaktionen, Löschhinweis gehen an die Eigentümer:in) – sie sieht ihren Törn immer.
      if (r.s_owner !== userId || r.s_title === null) return null;
      if (r.kind === 'expiry') return { ...base, title: r.s_title, what: 'bald', href: '/?support=open' };
      return { ...base, title: r.s_title, what: 'deinen Törn', href: sharePath('s', r.subject_id, r.s_vis ?? 'private', r.s_key) };
    case 'post':
      if (r.p_author !== userId || r.p_hidden || !r.g_slug || r.g_hidden || !r.g_role) return null;
      return { ...base, title: r.g_name ?? '', what: 'deinen Beitrag in', href: groupHref() };
    case 'activity':
      if (r.a_actor !== userId) return null;
      return { ...base, title: '', what: 'deine Neuigkeit', href: '/' };
    case 'user':
      if (r.subject_id !== userId) return null;
      if (r.kind === 'passkey') return { ...base, title: '', what: '', href: '/?konto=einstellungen' };
      return { ...base, title: '', what: '', href: actor ? `/u/${actor.handle}` : '/' };
    case 'invite': {
      if (!r.i_for || !r.i_kind) return null;
      const what = r.i_kind === 'group' ? `in ${r.i_gkind === 'team' ? 'das Team' : 'den Verein'}` : (INVITE_WHAT[r.i_kind] ?? 'zu');
      // Freundes-Einladungen haben kein Ziel. Annehmen und Ablehnen im Konto („Einladungen an dich“).
      return { ...base, title: r.i_kind === 'friend' ? '' : (r.i_target ?? ''), what, href: '/?konto=einladungen' };
    }
    case 'group':
      // Anfragen nur, solange es offene gibt, ich sie bestätigen darf und die Gruppe besteht.
      if (!r.g_slug || !r.g_approve || !r.g_open || !canApprove(r.g_role, r.g_approve)) return null;
      return { ...base, title: r.g_name ?? '', what: '', href: groupHref() };
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
    const item = shape(r, user.id);
    if (item) items.push({ ...item, text: notificationText(item) });
    else if (r.read_at === null) stale.push(r.id);
  }
  if (stale.length) await readStmt(env, user.id, `id IN (${stale.map((_, i) => `?${i + 3}`).join(', ')})`, ...stale).run();
  return items;
}
