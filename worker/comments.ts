// Kommentare an Törns und Beiträgen (Konzept 4.1–4.3, 40; F-110 … F-113, F-635 … F-644): ein flacher Thread je Verlauf
// (Törn oder Beitrag ohne Törn), folgt dessen Sichtbarkeit (gleiche Prüfung wie beim Ansehen, inkl. Schlüssel),
// Spam-Grenzen pro Konto, Glocke je Verlauf (`comment_subscriptions`).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { sha256Hex, randomId } from './crypto';
import { HttpError, json, readJson } from './http';
import { adminLogStmt, isAdmin, isSuspended, SUSPENDED } from './moderation';
import { visibleShare } from './shares';
import { visiblePost } from './posts';
import { COMMENT_ID_RE, parseCommentsMode, parseNotifyMode } from './validate';
import { COMMENT_MAX, COMMENT_MAX_LINKS, cleanComment, commentProblem, isCommentsMode, type CommentsMode } from '../src/domain/comment-text';
import { isSubscribed, isSubscriptionState, type ThreadKind } from '../src/domain/comment-thread';
import { threadCol } from './comment-thread-sql';
import { isMapStyleId } from '../src/domain/map-style';
import { isGroupNotifyMode } from '../src/domain/groups';
import { notifyComment, readThreadNotifications } from './notifications';
import { prefsOf, savePrefs, validPrefsPatch } from './notification-mail';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Grenzen (Konzept 4.2) – gleich für kostenlos und Unterstützer. */
export const COMMENT_LIMITS = {
  perHour: 10,
  perDay: 50,
  /** Mindestabstand zwischen zwei Kommentaren eines Kontos */
  minGapMs: 20_000,
  /** Konten jünger als 24 h (erster Tag; nicht „neu“ im Sinne von isNewAccount, F-560) … */
  firstDayMs: DAY,
  /** … dürfen insgesamt höchstens so viele Kommentare schreiben */
  firstDayMax: 3,
  /** Kommentare je Verlauf (Törn bzw. Beitrag) */
  perShare: 500,
} as const;

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Kommentar gibt es nicht (mehr).');
const NOUN: Record<ThreadKind, { acc: string; nom: string }> = {
  share: { acc: 'diesen Törn', nom: 'Dieser Törn' },
  post: { acc: 'diesen Beitrag', nom: 'Dieser Beitrag' },
};
const PRIVATE = { headers: { 'Cache-Control': 'private, no-store' } };

interface CommentRow {
  id: string;
  user_id: string;
  body: string;
  hidden_at: number | null;
  created_at: number;
  /** aus dem JOIN mit profiles – NULL bei ausgeblendetem Profil */
  handle: string | null;
  display_name: string | null;
  profile_visibility: string | null;
}

/** Warum (noch) nicht kommentiert werden kann – die Oberfläche zeigt dazu den passenden Hinweis. */
export type CommentBlock = 'login' | 'off' | 'suspended' | 'profile' | null;

/** Ein Verlauf, wie ihn die Anfrage sehen darf (sonst 404 aus `visibleShare` bzw. `visiblePost`). */
interface Thread {
  kind: ThreadKind;
  id: string;
  isOwner: boolean;
  mode: CommentsMode;
  userId: string | null;
  admin: boolean;
}

async function openThread(request: Request, env: Env, kind: ThreadKind, id: string): Promise<Thread> {
  if (kind === 'share') {
    const { row, isOwner, user } = await visibleShare(request, env, id);
    return { kind, id: row.id, isOwner, mode: (row.comments_mode ?? 'on') as CommentsMode, userId: user?.id ?? null, admin: isAdmin(env, user?.id) };
  }
  // Beiträge ohne Törn (Konzept 40): Törn-Beiträge sind hier 404 – ihre Kommentare hängen am Törn
  const p = await visiblePost(request, env, id);
  // unbekannter Modus → keine neuen Kommentare (fail closed)
  const mode: CommentsMode = isCommentsMode(p.commentsMode) ? p.commentsMode : 'off';
  return { kind, id: p.id, isOwner: !!p.viewerId && p.viewerId === p.authorId, mode, userId: p.viewerId, admin: p.admin };
}

/** Sieht die Anfrage die Kommentare des Verlaufs? Bei `hidden` nur Eigentümer:in und Admins. */
const showsComments = (t: Thread) => t.mode !== 'hidden' || t.isOwner || t.admin;

/** Verweis auf den Verlauf als Werte für (share_id, post_id). */
const refOf = (t: Pick<Thread, 'kind' | 'id'>): [string | null, string | null] => (t.kind === 'share' ? [t.id, null] : [null, t.id]);

/**
 * Kommentar für die Antwort: nie mit Konto-ID oder E-Mail. Name ist der Anzeigename des Profils (Kommentieren
 * verlangt ein Profil), verlinkt nur bei öffentlichem, nicht ausgeblendetem Profil (wie F-82).
 */
function shape(c: CommentRow, viewerId: string | null, isThreadOwner: boolean, admin: boolean) {
  const isMine = !!viewerId && viewerId === c.user_id;
  return {
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    author: { displayName: c.display_name || 'Segler:in', handle: c.profile_visibility === 'public' ? c.handle : null },
    isMine,
    canDelete: isMine || isThreadOwner || admin,
    /** nur Autor:in und Admins sehen ausgeblendete Kommentare – mit diesem Hinweis */
    hidden: !!c.hidden_at,
  };
}

const COMMENT_SELECT = `SELECT c.id, c.user_id, c.body, c.hidden_at, c.created_at,
    p.handle, CASE WHEN p.hidden_at IS NULL THEN p.display_name END AS display_name,
    CASE WHEN p.hidden_at IS NULL THEN p.visibility END AS profile_visibility
  FROM comments c LEFT JOIN profiles p ON p.user_id = c.user_id`;

async function hasProfile(env: Env, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM profiles WHERE user_id = ?').bind(userId).first());
}

/** Zeile der Glocke des Kontos im Verlauf (null = keine). */
async function subscriptionOf(env: Env, t: Thread, userId: string) {
  const r = await env.DB.prepare(`SELECT state FROM comment_subscriptions WHERE ${threadCol(t.kind)} = ? AND user_id = ?`).bind(t.id, userId).first<{ state: string }>();
  return r && isSubscriptionState(r.state) ? r.state : null;
}

/**
 * GET /api/shares/:id/comments bzw. /api/posts/:id/comments – wer den Verlauf sehen darf (gleiche Prüfung wie beim
 * Ansehen: privat nur Eigentümer:in, „Nur mit Link“ mit X-Share-Key, ausgeblendet nur Eigentümer:in/Admins, Beitrag
 * nach `visiblePost`). Bei `comments_mode = hidden` sehen nur Eigentümer:in und Admins die Kommentare. Ausgeblendete
 * Kommentare sehen nur Autor:in und Admins. `subscribed`: Glocke für Angemeldete, die die Kommentare sehen (F-639).
 */
export async function listComments(request: Request, env: Env, kind: ThreadKind, id: string): Promise<Response> {
  const t = await openThread(request, env, kind, id);
  const show = showsComments(t);
  const { results } = show
    ? await env.DB.prepare(`${COMMENT_SELECT} WHERE c.${threadCol(kind)} = ?1 AND (c.hidden_at IS NULL OR c.user_id = ?2 OR ?3)
         AND (?3 OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = c.user_id AND lu.locked_at IS NOT NULL))
       ORDER BY c.created_at, c.id LIMIT ?4`)
        .bind(t.id, t.userId ?? '', t.admin ? 1 : 0, COMMENT_LIMITS.perShare)
        .all<CommentRow>()
    : { results: [] as CommentRow[] };
  let block: CommentBlock = null;
  if (!t.userId) block = 'login';
  else if (t.mode !== 'on') block = 'off';
  else if (await isSuspended(env, t.userId)) block = 'suspended';
  else if (!(await hasProfile(env, t.userId))) block = 'profile';
  const subscribed = t.userId && show ? isSubscribed(await subscriptionOf(env, t, t.userId), t.isOwner) : null;
  // Beitrag (Konzept 40): Öffnen der Kommentare liest die Kommentar-Benachrichtigungen dazu (Törns: Öffnen des Törns)
  if (t.userId && kind === 'post' && show) await readThreadNotifications(env, t.userId, t.id);
  return json(
    {
      mode: t.mode,
      comments: results.map((c) => shape(c, t.userId, t.isOwner, t.admin)),
      canComment: block === null,
      block,
      isOwner: t.isOwner,
      subscribed,
      /** Beitrag: die Autor:in stellt den Modus im Kopf der Kommentare (Törns im Zahnrad-Menü, F-510) */
      canSetMode: kind === 'post' && t.isOwner,
      limits: { maxLength: COMMENT_MAX, maxLinks: COMMENT_MAX_LINKS },
    },
    PRIVATE,
  );
}

/**
 * POST /api/shares/:id/comments bzw. /api/posts/:id/comments – angemeldet, mit Profil, nicht gesperrt, Verlauf
 * sichtbar (sonst 404) und `comments_mode = on`. Body `{ body }`; `photoId` ist für Fotos reserviert und wird
 * abgelehnt. Der erste eigene Kommentar schaltet die Glocke an – nur ohne Zeile (stumm bleibt stumm, F-638).
 */
export async function createComment(request: Request, env: Env, kind: ThreadKind, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const t = await openThread(request, env, kind, id);
  if (await isSuspended(env, user.id)) throw SUSPENDED();
  if (t.mode !== 'on') throw new HttpError(403, 'comments_off', `Für ${NOUN[kind].acc} sind Kommentare abgeschaltet.`);
  const input = await readJson<{ body?: unknown; photoId?: unknown }>(request);
  if (input.photoId !== undefined && input.photoId !== null) throw new HttpError(400, 'invalid_photo', 'Kommentare zu Fotos gibt es noch nicht.');
  if (!(await hasProfile(env, user.id))) {
    throw new HttpError(403, 'profile_required', 'Zum Kommentieren brauchst du ein Profil mit Anzeigenamen (Konto → Profil).');
  }
  const body = cleanComment(input.body);
  const problem = commentProblem(body);
  if (problem === 'empty') throw new HttpError(400, 'invalid_comment', 'Bitte einen Text eingeben.');
  if (problem === 'too_long') throw new HttpError(400, 'comment_too_long', `Ein Kommentar hat höchstens ${COMMENT_MAX} Zeichen.`);
  if (problem === 'too_many_links') throw new HttpError(400, 'too_many_links', `Höchstens ${COMMENT_MAX_LINKS} Links pro Kommentar.`);

  // Grenzen über comment_log: zählt auch inzwischen gelöschte Kommentare (sonst ließe sich per Löschen umgehen).
  const now = Date.now();
  const hash = await sha256Hex(body.toLowerCase());
  const c = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM comment_log WHERE user_id = ?1 AND created_at > ?2) AS hour,
       (SELECT COUNT(*) FROM comment_log WHERE user_id = ?1 AND created_at > ?3) AS day,
       (SELECT MAX(created_at) FROM comment_log WHERE user_id = ?1) AS last,
       (SELECT COUNT(*) FROM comment_log WHERE user_id = ?1 AND body_hash = ?4 AND created_at > ?3) AS dup,
       (SELECT created_at FROM users WHERE id = ?1) AS account_created,
       (SELECT COUNT(*) FROM comments WHERE ${threadCol(kind)} = ?5) AS on_thread`,
  )
    .bind(user.id, now - HOUR, now - DAY, hash, t.id)
    .first<{ hour: number; day: number; last: number | null; dup: number; account_created: number | null; on_thread: number }>();
  if (!c || c.account_created === null) throw SUSPENDED(); // fail closed: Konto nicht (mehr) da
  if (c.last !== null && now - c.last < COMMENT_LIMITS.minGapMs) {
    const wait = Math.ceil((COMMENT_LIMITS.minGapMs - (now - c.last)) / 1000);
    throw new HttpError(429, 'comment_too_fast', `Bitte warte noch ${wait} s bis zum nächsten Kommentar.`);
  }
  if (now - c.account_created < COMMENT_LIMITS.firstDayMs && c.day >= COMMENT_LIMITS.firstDayMax) {
    throw new HttpError(429, 'comment_new_account', `Neue Konten schreiben am ersten Tag höchstens ${COMMENT_LIMITS.firstDayMax} Kommentare.`);
  }
  if (c.hour >= COMMENT_LIMITS.perHour) throw new HttpError(429, 'comment_quota', `Höchstens ${COMMENT_LIMITS.perHour} Kommentare pro Stunde – bitte später weiterschreiben.`);
  if (c.day >= COMMENT_LIMITS.perDay) throw new HttpError(429, 'comment_quota', `Höchstens ${COMMENT_LIMITS.perDay} Kommentare pro Tag – morgen geht es weiter.`);
  if (c.dup) throw new HttpError(409, 'duplicate_comment', 'Diesen Text hast du gerade schon geschrieben.');
  if (c.on_thread >= COMMENT_LIMITS.perShare) throw new HttpError(409, 'comment_share_full', `${NOUN[kind].nom} hat die höchste Zahl an Kommentaren erreicht.`);

  const commentId = randomId();
  const ref = refOf(t);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO comments (id, share_id, post_id, photo_id, user_id, body, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)').bind(commentId, ...ref, user.id, body, now),
    env.DB.prepare('INSERT INTO comment_log (user_id, body_hash, created_at) VALUES (?, ?, ?)').bind(user.id, hash, now),
    // Glocke an mit dem ersten eigenen Kommentar – eine vorhandene Zeile (auch „stumm“) bleibt
    env.DB.prepare(`INSERT OR IGNORE INTO comment_subscriptions (share_id, post_id, user_id, state, created_at) VALUES (?, ?, ?, 'on', ?)`).bind(...ref, user.id, now),
  ]);
  await notifyComment(env, kind, t.id, user.id);
  const saved = await env.DB.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).bind(commentId).first<CommentRow>();
  return json({ comment: shape(saved!, user.id, t.isOwner, isAdmin(env, user.id)) }, { status: 201 });
}

/**
 * PUT /api/shares/:id/comments/subscription bzw. /api/posts/:id/comments/subscription – `{ on: boolean }`: Glocke des
 * Verlaufs an oder stumm (F-639). Wer den Verlauf und seine Kommentare sieht, auch ohne eigenen Kommentar.
 */
export async function setSubscription(request: Request, env: Env, kind: ThreadKind, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const t = await openThread(request, env, kind, id);
  if (!showsComments(t)) throw new HttpError(403, 'comments_hidden', `Die Kommentare zu ${NOUN[kind].acc} sind ausgeblendet.`);
  const input = await readJson<{ on?: unknown }>(request);
  if (typeof input.on !== 'boolean') throw new HttpError(400, 'invalid_body', '`on` (true oder false) angeben.');
  const col = threadCol(kind);
  await env.DB.prepare(
    `INSERT INTO comment_subscriptions (share_id, post_id, user_id, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(${col}, user_id) WHERE ${col} IS NOT NULL DO UPDATE SET state = excluded.state`,
  )
    .bind(...refOf(t), user.id, input.on ? 'on' : 'off', Date.now())
    .run();
  return json({ subscribed: input.on }, PRIVATE);
}

/**
 * PUT /api/posts/:id/comments/mode – `{ mode: 'on' | 'off' | 'hidden' }`: Kommentar-Modus eines Beitrags (F-636), nur
 * die Autor:in (für alle anderen 404). Törns stellen ihn über `PATCH /api/shares/:id { commentsMode }`.
 */
export async function setPostCommentsMode(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const t = await openThread(request, env, 'post', id);
  if (!t.isOwner) throw NOT_FOUND();
  const mode = parseCommentsMode((await readJson<{ mode?: unknown }>(request)).mode);
  if (!mode) throw new HttpError(400, 'invalid_comments_mode', 'Unbekannter Kommentar-Modus.');
  await env.DB.prepare('UPDATE posts SET comments_mode = ? WHERE id = ? AND author_id = ?').bind(mode, t.id, user.id).run();
  return json({ mode }, PRIVATE);
}

/** DELETE /api/comments/:id – Autor:in, Eigentümer:in des Verlaufs (Törn bzw. Beitrag) oder Admin; sonst 404. */
export async function deleteComment(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = COMMENT_ID_RE.test(id)
    ? await env.DB.prepare(
        `SELECT c.id, c.user_id, c.post_id, COALESCE(s.user_id, p.author_id) AS owner, s.locked_at FROM comments c
         LEFT JOIN shares s ON s.id = c.share_id LEFT JOIN posts p ON p.id = c.post_id WHERE c.id = ?`,
      )
        .bind(id)
        .first<{ id: string; user_id: string; post_id: string | null; owner: string | null; locked_at: number | null }>()
    : null;
  const admin = isAdmin(env, user.id);
  // Gesperrter Törn (Konzept 18.2): Kommentare bleiben als Beleg – löschen nur Admins
  if (!row || (row.locked_at && !admin) || !(row.user_id === user.id || row.owner === user.id || admin)) throw NOT_FOUND();
  await removeComment(env, id);
  // Fremde Kommentare löscht nur die Moderation – ins Admin-Protokoll (Konzept 18.10)
  if (row.user_id !== user.id && row.owner !== user.id) await adminLogStmt(env, user.id, 'delete_comment', row.post_id ? 'post' : 'share', null, `Kommentar ${id}`).run();
  return new Response(null, { status: 204 });
}

/** Der eine Löschpfad für Kommentare (Autor, Eigentümer:in des Verlaufs, Moderation): Meldungen fallen mit. */
export async function removeComment(env: Env, id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'comment' AND target_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id),
  ]);
}

// ---------------------------------------------------------------- Einstellungen

async function settingsOf(env: Env, userId: string) {
  const u = await env.DB.prepare(
    'SELECT notify_groups, map_style, suspended_at, (SELECT COUNT(*) FROM profiles WHERE user_id = users.id) AS has_profile FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{ notify_groups: string; map_style: string | null; suspended_at: number | null; has_profile: number }>();
  const notify = await prefsOf(env, userId);
  return {
    /** Kanäle je Art (Konzept 17.6): keine, Mail (tägliche Sammelmail, Einladungen sofort) oder Push */
    notify,
    /** bisherige Kommentar-Einstellung, abgeleitet (F-113): „daily“ = Kommentare per Mail */
    notifyComments: notify.comment === 'mail' ? 'daily' : 'off',
    /** wöchentliche Sammelmail aus Vereinen und Teams (Konzept 11.7) */
    notifyGroups: isGroupNotifyMode(u?.notify_groups) ? u.notify_groups : 'off',
    /** Kartenstil als Profil-Standard, null = keiner */
    mapStyle: isMapStyleId(u?.map_style) ? u.map_style : null,
    suspended: !u || u.suspended_at !== null,
    hasProfile: !!u?.has_profile,
    isAdmin: isAdmin(env, userId),
  };
}

/** GET /api/me/settings – Benachrichtigungen, Sperre, Profil vorhanden, Admin (für die Meldungen-Liste). */
export async function getSettings(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json(await settingsOf(env, user.id));
}

/**
 * PATCH /api/me/settings – `{ notify: { comment: 'mail', … } }` (Kanäle je Art), `{ notifyGroups: 'off' | 'weekly' }`,
 * `{ mapStyle: <Stil> | null }` und weiter `{ notifyComments: 'off' | 'daily' }` (= Kommentare keine/Mail). Neu auf
 * „Mail“ zählt erst ab jetzt. Auch gesperrte Konten dürfen abschalten. Der Kartenstil (Konzept 16) ist reine
 * Darstellung und gilt auf allen Geräten des Kontos.
 */
export async function patchSettings(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson<{ notify?: unknown; notifyComments?: unknown; notifyGroups?: unknown; mapStyle?: unknown }>(request);
  // Erst alles prüfen, dann schreiben – ein 400 hinterlässt keine Teiländerung.
  const invalid =
    (body.mapStyle !== undefined && body.mapStyle !== null && !isMapStyleId(body.mapStyle)) ||
    (body.notifyGroups !== undefined && !isGroupNotifyMode(body.notifyGroups)) ||
    (body.notifyComments !== undefined && !parseNotifyMode(body.notifyComments)) ||
    (body.notify !== undefined && !validPrefsPatch(body.notify));
  if (invalid) throw new HttpError(400, 'invalid_setting', 'Unbekannte Einstellung.');
  if (body.mapStyle !== undefined) {
    await env.DB.prepare('UPDATE users SET map_style = ? WHERE id = ?').bind(body.mapStyle, user.id).run();
  }
  if (body.notifyGroups !== undefined) {
    // Einschalten zählt erst ab jetzt – die erste Sammelmail kommt am nächsten Sonntag.
    await env.DB.prepare(
      `UPDATE users SET groups_mailed_at = CASE WHEN ?1 = 'weekly' AND notify_groups <> 'weekly' THEN ?2 ELSE groups_mailed_at END,
         notify_groups = ?1 WHERE id = ?3`,
    )
      .bind(body.notifyGroups, Date.now(), user.id)
      .run();
  }
  if (body.notifyComments !== undefined) {
    const mode = parseNotifyMode(body.notifyComments);
    if (!mode) throw new HttpError(400, 'invalid_setting', 'Unbekannte Einstellung.');
    await savePrefs(env, user.id, { comment: mode === 'daily' ? 'mail' : 'none' });
  }
  if (body.notify !== undefined) await savePrefs(env, user.id, body.notify);
  return json(await settingsOf(env, user.id));
}

/** Ob eine Anfrage einen Kommentar sehen darf, ist an den Verlauf gebunden – für Meldungen (worker/reports.ts). */
export async function visibleComment(request: Request, env: Env, id: string) {
  const c = COMMENT_ID_RE.test(id)
    ? await env.DB.prepare('SELECT id, share_id, post_id, user_id, hidden_at FROM comments WHERE id = ?')
        .bind(id)
        .first<{ id: string; share_id: string | null; post_id: string | null; user_id: string; hidden_at: number | null }>()
    : null;
  if (!c || !(c.share_id ?? c.post_id)) throw NOT_FOUND();
  const t = await openThread(request, env, c.share_id ? 'share' : 'post', (c.share_id ?? c.post_id)!);
  const mine = (t.userId ?? (await currentUser(request, env))?.id) === c.user_id;
  if ((c.hidden_at && !mine && !t.admin) || !showsComments(t)) throw NOT_FOUND();
  return { comment: c };
}
