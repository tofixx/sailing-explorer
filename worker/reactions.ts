// Reaktionen (Konzept 12.5, F-179/F-180): „Gefällt mir“, „Mast- und Schotbruch“, „Starker Schlag“ auf Törns,
// Beiträge, Fotos und Aktivitäten – eine pro Person und Gegenstand, nur auf Sichtbares, mit Tagesgrenze.
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { assertActive, isAdmin } from './moderation';
import { requestKey } from './access';
import { visibleShare } from './shares';
import { visiblePhoto } from './photos';
import { canViewGroup, loadGroup, roleIn } from './groups';
import { visibleActivity } from './stream';
import { SHARE_ID_RE } from './validate';
import { canManageGroup } from '../src/domain/groups';
import { REACTION_LIMITS, isReactionKind, isReactionSubject, summarizeReactions, type ReactionSubject } from '../src/domain/reactions';
import { notifyReaction } from './notifications';

const DAY = 86_400_000;
const NOT_FOUND = () => new HttpError(404, 'not_found', 'Das gibt es nicht (mehr) oder du kannst es nicht sehen.');

/**
 * Darf die Anfrage den Gegenstand jetzt sehen? Gleiche Prüfung wie beim Ansehen (inkl. Schlüssel per X-Share-Key);
 * bei Aktivitäten die Prüfung des Streams (Konzept 11.3). Sonst 404 wie „gibt es nicht“.
 */
async function assertVisible(request: Request, env: Env, subject: ReactionSubject, id: string): Promise<void> {
  if (!SHARE_ID_RE.test(id)) throw NOT_FOUND();
  if (subject === 'share') {
    await visibleShare(request, env, id);
    return;
  }
  if (subject === 'photo') {
    await visiblePhoto(request, env, id);
    return;
  }
  const user = await currentUser(request, env);
  if (subject === 'activity') {
    if (!(await visibleActivity(env, user?.id ?? null, id))) throw NOT_FOUND();
    return;
  }
  // Beitrag: sichtbar wie die Gruppe, ausgeblendet nur für Autor:in, Verwalter und Moderation, Autor nicht gesperrt.
  const key = requestKey(request);
  const admin = isAdmin(env, user?.id);
  const p = await env.DB.prepare(
    `SELECT p.id, p.author_id, p.group_id, p.hidden_at, (u.suspended_at IS NOT NULL) AS suspended FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
  )
    .bind(id)
    .first<{ id: string; author_id: string; group_id: string | null; hidden_at: number | null; suspended: number }>();
  const g = p?.group_id ? await loadGroup(env, p.group_id) : null;
  const role = g ? await roleIn(env, user?.id, g.id) : null;
  const ok = !!p && !!g && canViewGroup(g, role, key, admin) && (!p.hidden_at || p.author_id === user?.id || canManageGroup(role) || admin) && (!p.suspended || admin);
  if (!ok) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
}

function parseSubject(raw: string): ReactionSubject {
  if (!isReactionSubject(raw)) throw NOT_FOUND();
  return raw;
}

/** Zähler je Art (ohne gesperrte Konten) und die eigene Reaktion. */
export async function reactionSummary(env: Env, subject: ReactionSubject, id: string, viewerId: string | null) {
  const { results } = await env.DB.prepare(
    `SELECT r.kind, COUNT(*) AS n, MAX(r.user_id = ?3) AS mine FROM reactions r
     WHERE r.subject_kind = ?1 AND r.subject_id = ?2
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id AND u.suspended_at IS NOT NULL)
     GROUP BY r.kind`,
  )
    .bind(subject, id, viewerId ?? '')
    .all<{ kind: string; n: number; mine: number }>();
  return summarizeReactions(results);
}

/** Tagesgrenze: Änderungen der letzten 24 h (auch Zurücknehmen). */
async function assertQuota(env: Env, userId: string, now: number): Promise<void> {
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM reaction_log WHERE user_id = ? AND created_at > ?').bind(userId, now - DAY).first<{ n: number }>())?.n ?? 0;
  if (n >= REACTION_LIMITS.perDay) throw new HttpError(429, 'reaction_quota', 'Du hast heute schon sehr viel reagiert – morgen geht es weiter.');
}

/** PUT /api/reactions/:subject/:id – `{ kind }` setzt bzw. ersetzt die eigene Reaktion. */
export async function putReaction(request: Request, env: Env, rawSubject: string, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const subject = parseSubject(rawSubject);
  const { kind } = await readJson<{ kind?: unknown }>(request);
  if (!isReactionKind(kind)) throw new HttpError(400, 'invalid_reaction', 'Unbekannte Reaktion.');
  await assertVisible(request, env, subject, id);
  const now = Date.now();
  await assertQuota(env, user.id, now);
  const had = await env.DB.prepare('SELECT 1 AS x FROM reactions WHERE subject_kind = ? AND subject_id = ? AND user_id = ?').bind(subject, id, user.id).first();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reactions (subject_kind, subject_id, user_id, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(subject_kind, subject_id, user_id) DO UPDATE SET kind = ?4, created_at = ?5`,
    ).bind(subject, id, user.id, kind, now),
    env.DB.prepare('INSERT INTO reaction_log (user_id, created_at) VALUES (?, ?)').bind(user.id, now),
  ]);
  // Nur eine neue Reaktion benachrichtigt – die Art zu wechseln nicht (Konzept 17.2).
  if (!had) await notifyReaction(env, subject, id, user.id);
  return json(await reactionSummary(env, subject, id, user.id));
}

/** DELETE /api/reactions/:subject/:id – eigene Reaktion zurücknehmen. */
export async function deleteReaction(request: Request, env: Env, rawSubject: string, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const subject = parseSubject(rawSubject);
  await assertVisible(request, env, subject, id);
  const now = Date.now();
  await assertQuota(env, user.id, now);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reactions WHERE subject_kind = ? AND subject_id = ? AND user_id = ?').bind(subject, id, user.id),
    env.DB.prepare('INSERT INTO reaction_log (user_id, created_at) VALUES (?, ?)').bind(user.id, now),
  ]);
  return json(await reactionSummary(env, subject, id, user.id));
}

/**
 * GET /api/reactions/:subject/:id – Zähler, eigene Reaktion und „wer hat reagiert“: namentlich nur öffentliche, nicht
 * ausgeblendete Profile nicht gesperrter Konten (höchstens 50), der Rest als Anzahl. Keine Konto-IDs.
 */
export async function getReactions(request: Request, env: Env, rawSubject: string, id: string): Promise<Response> {
  const subject = parseSubject(rawSubject);
  await assertVisible(request, env, subject, id);
  const user = await currentUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT r.kind, p.handle, p.display_name FROM reactions r
       JOIN users u ON u.id = r.user_id AND u.suspended_at IS NULL
       LEFT JOIN profiles p ON p.user_id = r.user_id AND p.visibility = 'public' AND p.hidden_at IS NULL
     WHERE r.subject_kind = ? AND r.subject_id = ? ORDER BY r.created_at DESC`,
  )
    .bind(subject, id)
    .all<{ kind: string; handle: string | null; display_name: string | null }>();
  const named = results.filter((r) => r.handle && isReactionKind(r.kind)).slice(0, REACTION_LIMITS.who);
  return json(
    {
      ...(await reactionSummary(env, subject, id, user?.id ?? null)),
      people: named.map((r) => ({ handle: r.handle!, displayName: r.display_name ?? '', kind: r.kind })),
      others: results.length - named.length,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
