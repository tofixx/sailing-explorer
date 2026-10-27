// Kommentare an Törns (Konzept 4.1–4.3, F-110 … F-113): ein flacher Thread pro Törn, folgt der Sichtbarkeit des
// Törns (gleiche Prüfung wie die Freigabe, inkl. Schlüssel), Spam-Grenzen pro Konto und Tages-Sammelmail.
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { sha256Hex, randomId } from './crypto';
import { HttpError, json, readJson } from './http';
import { commentDigestMail, sendMail } from './mail';
import { isAdmin, isSuspended, SUSPENDED } from './moderation';
import { visibleShare } from './shares';
import { COMMENT_ID_RE, parseNotifyMode } from './validate';
import { COMMENT_MAX, COMMENT_MAX_LINKS, cleanComment, commentProblem, type CommentsMode } from '../src/domain/comment-text';
import { sharePath, type Visibility } from '../src/domain/visibility';
import { isMapStyleId } from '../src/domain/map-style';
import { isGroupNotifyMode } from '../src/domain/groups';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Grenzen (Konzept 4.2) – gleich für kostenlos und Unterstützer. */
export const COMMENT_LIMITS = {
  perHour: 10,
  perDay: 50,
  /** Mindestabstand zwischen zwei Kommentaren eines Kontos */
  minGapMs: 20_000,
  /** Konten jünger als 24 h … */
  newAccountMs: DAY,
  /** … dürfen insgesamt höchstens so viele Kommentare schreiben */
  newAccountMax: 3,
  /** Kommentare je Törn */
  perShare: 500,
  /** Sammelmails pro nächtlichem Lauf (Resend Free: 100 Mails/Tag für alles zusammen) */
  digestsPerRun: 25,
} as const;

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Kommentar gibt es nicht (mehr).');

interface CommentRow {
  id: string;
  share_id: string;
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

/**
 * Kommentar für die Antwort: nie mit Konto-ID oder E-Mail. Name ist der Anzeigename des Profils (Kommentieren
 * verlangt ein Profil), verlinkt nur bei öffentlichem, nicht ausgeblendetem Profil (wie F-82).
 */
function shape(c: CommentRow, viewerId: string | null, isShareOwner: boolean, admin: boolean) {
  const isMine = !!viewerId && viewerId === c.user_id;
  return {
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    author: { displayName: c.display_name || 'Segler:in', handle: c.profile_visibility === 'public' ? c.handle : null },
    isMine,
    canDelete: isMine || isShareOwner || admin,
    /** nur Autor:in und Admins sehen ausgeblendete Kommentare – mit diesem Hinweis */
    hidden: !!c.hidden_at,
  };
}

const COMMENT_SELECT = `SELECT c.id, c.share_id, c.user_id, c.body, c.hidden_at, c.created_at,
    p.handle, CASE WHEN p.hidden_at IS NULL THEN p.display_name END AS display_name,
    CASE WHEN p.hidden_at IS NULL THEN p.visibility END AS profile_visibility
  FROM comments c LEFT JOIN profiles p ON p.user_id = c.user_id`;

async function hasProfile(env: Env, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM profiles WHERE user_id = ?').bind(userId).first());
}

/**
 * GET /api/shares/:id/comments – wer den Törn sehen darf (gleiche Prüfung wie die Freigabe: privat nur der
 * Eigentümer, „Nur mit Link“ mit X-Share-Key, ausgeblendet nur Eigentümer/Admins). Bei `comments_mode = hidden`
 * sehen nur Eigentümer und Admins die Kommentare. Ausgeblendete Kommentare sehen nur Autor:in und Admins.
 */
export async function listComments(request: Request, env: Env, id: string): Promise<Response> {
  const { row, isOwner, user } = await visibleShare(request, env, id);
  const admin = isAdmin(env, user?.id);
  const mode = (row.comments_mode ?? 'on') as CommentsMode;
  const show = mode !== 'hidden' || isOwner || admin;
  const { results } = show
    ? await env.DB.prepare(`${COMMENT_SELECT} WHERE c.share_id = ?1 AND (c.hidden_at IS NULL OR c.user_id = ?2 OR ?3) ORDER BY c.created_at, c.id LIMIT ?4`)
        .bind(row.id, user?.id ?? '', admin ? 1 : 0, COMMENT_LIMITS.perShare)
        .all<CommentRow>()
    : { results: [] as CommentRow[] };
  let block: CommentBlock = null;
  if (!user) block = 'login';
  else if (mode !== 'on') block = 'off';
  else if (await isSuspended(env, user.id)) block = 'suspended';
  else if (!(await hasProfile(env, user.id))) block = 'profile';
  return json({
    mode,
    comments: results.map((c) => shape(c, user?.id ?? null, isOwner, admin)),
    canComment: block === null,
    block,
    isOwner,
    limits: { maxLength: COMMENT_MAX, maxLinks: COMMENT_MAX_LINKS },
  });
}

/**
 * POST /api/shares/:id/comments – angemeldet, mit Profil, nicht gesperrt, Törn sichtbar (sonst 404) und
 * `comments_mode = on`. Body `{ body }`; `photoId` ist für Fotos (Phase C) reserviert und wird bis dahin abgelehnt.
 */
export async function createComment(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const { row, isOwner } = await visibleShare(request, env, id);
  if (await isSuspended(env, user.id)) throw SUSPENDED();
  if ((row.comments_mode ?? 'on') !== 'on') throw new HttpError(403, 'comments_off', 'Für diesen Törn sind Kommentare abgeschaltet.');
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
       (SELECT COUNT(*) FROM comments WHERE share_id = ?5) AS on_share`,
  )
    .bind(user.id, now - HOUR, now - DAY, hash, row.id)
    .first<{ hour: number; day: number; last: number | null; dup: number; account_created: number | null; on_share: number }>();
  if (!c || c.account_created === null) throw SUSPENDED(); // fail closed: Konto nicht (mehr) da
  if (c.last !== null && now - c.last < COMMENT_LIMITS.minGapMs) {
    const wait = Math.ceil((COMMENT_LIMITS.minGapMs - (now - c.last)) / 1000);
    throw new HttpError(429, 'comment_too_fast', `Bitte warte noch ${wait} s bis zum nächsten Kommentar.`);
  }
  if (now - c.account_created < COMMENT_LIMITS.newAccountMs && c.day >= COMMENT_LIMITS.newAccountMax) {
    throw new HttpError(429, 'comment_new_account', `Neue Konten schreiben am ersten Tag höchstens ${COMMENT_LIMITS.newAccountMax} Kommentare.`);
  }
  if (c.hour >= COMMENT_LIMITS.perHour) throw new HttpError(429, 'comment_quota', `Höchstens ${COMMENT_LIMITS.perHour} Kommentare pro Stunde – bitte später weiterschreiben.`);
  if (c.day >= COMMENT_LIMITS.perDay) throw new HttpError(429, 'comment_quota', `Höchstens ${COMMENT_LIMITS.perDay} Kommentare pro Tag – morgen geht es weiter.`);
  if (c.dup) throw new HttpError(409, 'duplicate_comment', 'Diesen Text hast du gerade schon geschrieben.');
  if (c.on_share >= COMMENT_LIMITS.perShare) throw new HttpError(409, 'comment_share_full', 'Dieser Törn hat die höchste Zahl an Kommentaren erreicht.');

  const commentId = randomId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO comments (id, share_id, photo_id, user_id, body, created_at) VALUES (?, ?, NULL, ?, ?, ?)').bind(commentId, row.id, user.id, body, now),
    env.DB.prepare('INSERT INTO comment_log (user_id, body_hash, created_at) VALUES (?, ?, ?)').bind(user.id, hash, now),
  ]);
  const saved = await env.DB.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).bind(commentId).first<CommentRow>();
  return json({ comment: shape(saved!, user.id, isOwner, isAdmin(env, user.id)) }, { status: 201 });
}

/** DELETE /api/comments/:id – Autor:in, Eigentümer des Törns oder Admin; für alle anderen 404. */
export async function deleteComment(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = COMMENT_ID_RE.test(id)
    ? await env.DB.prepare('SELECT c.id, c.user_id, s.user_id AS owner FROM comments c JOIN shares s ON s.id = c.share_id WHERE c.id = ?')
        .bind(id)
        .first<{ id: string; user_id: string; owner: string }>()
    : null;
  if (!row || !(row.user_id === user.id || row.owner === user.id || isAdmin(env, user.id))) throw NOT_FOUND();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'comment' AND target_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id),
  ]);
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- Einstellungen

async function settingsOf(env: Env, userId: string) {
  const u = await env.DB.prepare(
    'SELECT notify_comments, notify_groups, map_style, suspended_at, (SELECT COUNT(*) FROM profiles WHERE user_id = users.id) AS has_profile FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{ notify_comments: string; notify_groups: string; map_style: string | null; suspended_at: number | null; has_profile: number }>();
  return {
    notifyComments: parseNotifyMode(u?.notify_comments) ?? 'off',
    /** wöchentliche Sammelmail aus Vereinen und Teams (Konzept 11.7) */
    notifyGroups: isGroupNotifyMode(u?.notify_groups) ? u.notify_groups : 'off',
    /** Kartenstil als Profil-Standard, null = keiner */
    mapStyle: isMapStyleId(u?.map_style) ? u.map_style : null,
    suspended: !u || u.suspended_at !== null,
    hasProfile: !!u?.has_profile,
    isAdmin: isAdmin(env, userId),
  };
}

/** GET /api/me/settings – Mail-Einstellung, Sperre, Profil vorhanden, Admin (für die Meldungen-Liste). */
export async function getSettings(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json(await settingsOf(env, user.id));
}

/**
 * PATCH /api/me/settings – `{ notifyComments: 'off' | 'daily' }`, `{ notifyGroups }`, `{ mapStyle: <Stil> | null }`.
 * Beim Einschalten zählen erst Kommentare ab jetzt (keine Sammelmail über alte Kommentare). Auch gesperrte Konten
 * dürfen abschalten. Der Kartenstil (Konzept 15) ist reine Darstellung und gilt auf allen Geräten des Kontos.
 */
export async function patchSettings(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson<{ notifyComments?: unknown; notifyGroups?: unknown; mapStyle?: unknown }>(request);
  if (body.mapStyle !== undefined) {
    if (body.mapStyle !== null && !isMapStyleId(body.mapStyle)) throw new HttpError(400, 'invalid_setting', 'Unbekannte Einstellung.');
    await env.DB.prepare('UPDATE users SET map_style = ? WHERE id = ?').bind(body.mapStyle, user.id).run();
  }
  if (body.notifyGroups !== undefined) {
    if (!isGroupNotifyMode(body.notifyGroups)) throw new HttpError(400, 'invalid_setting', 'Unbekannte Einstellung.');
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
    await env.DB.prepare(
      `UPDATE users SET comments_mailed_at = CASE WHEN ?1 = 'daily' AND notify_comments <> 'daily' THEN ?2 ELSE comments_mailed_at END,
         notify_comments = ?1 WHERE id = ?3`,
    )
      .bind(mode, Date.now(), user.id)
      .run();
  }
  return json(await settingsOf(env, user.id));
}

// ---------------------------------------------------------------- Tages-Sammelmail

interface DigestRow {
  user_id: string;
  email: string;
  share_id: string;
  title: string;
  visibility: Visibility;
  share_key: string | null;
  n: number;
}

/**
 * Nächtlich (Cron): eine Mail pro Konto mit `notify_comments = daily` über neue Kommentare anderer auf eigenen
 * Törns seit der letzten Mail – höchstens `digestsPerRun` Mails pro Lauf, der Rest folgt in der nächsten Nacht.
 * Ohne neue Kommentare keine Mail. Kommentartexte stehen nicht in der Mail (nur Anzahl und Törn).
 */
export async function sendCommentDigests(env: Env, origin: string, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, s.id AS share_id, s.title, s.visibility, s.share_key, COUNT(c.id) AS n
     FROM users u
     JOIN shares s ON s.user_id = u.id
     JOIN comments c ON c.share_id = s.id
     WHERE u.notify_comments = 'daily' AND u.suspended_at IS NULL
       AND COALESCE(u.comments_mailed_at, 0) < ?1
       AND c.created_at > COALESCE(u.comments_mailed_at, 0) AND c.created_at <= ?2
       AND c.user_id <> u.id AND c.hidden_at IS NULL
     GROUP BY u.id, s.id
     ORDER BY u.id, n DESC
     LIMIT 1000`,
  )
    // Höchstens eine Sammelmail pro Tag, auch wenn der Cron doppelt läuft.
    .bind(now - 20 * HOUR, now)
    .all<DigestRow>();
  const byUser = new Map<string, DigestRow[]>();
  for (const r of results) {
    if (!byUser.has(r.user_id) && byUser.size >= COMMENT_LIMITS.digestsPerRun) break;
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  }
  let sent = 0;
  for (const [userId, rows] of byUser) {
    try {
      await sendMail(
        env,
        commentDigestMail(env, rows[0].email, origin, rows.map((r) => ({ title: r.title, count: r.n, path: sharePath('s', r.share_id, r.visibility, r.share_key) }))),
      );
    } catch (err) {
      console.error('comment digest failed', err); // nächste Nacht erneut
      continue;
    }
    await env.DB.prepare('UPDATE users SET comments_mailed_at = ? WHERE id = ?').bind(now, userId).run();
    sent++;
  }
  return sent;
}

/** Ob eine Anfrage einen Kommentar sehen darf, ist an den Törn gebunden – für Meldungen (worker/reports.ts). */
export async function visibleComment(request: Request, env: Env, id: string) {
  const c = COMMENT_ID_RE.test(id)
    ? await env.DB.prepare('SELECT id, share_id, user_id, hidden_at FROM comments WHERE id = ?').bind(id).first<{ id: string; share_id: string; user_id: string; hidden_at: number | null }>()
    : null;
  if (!c) throw NOT_FOUND();
  const { row, isOwner } = await visibleShare(request, env, c.share_id);
  const user = await currentUser(request, env);
  const admin = isAdmin(env, user?.id);
  const mine = !!user && user.id === c.user_id;
  if ((c.hidden_at && !mine && !admin) || ((row.comments_mode ?? 'on') === 'hidden' && !isOwner && !admin)) throw NOT_FOUND();
  return { comment: c, share: row };
}
