// Beiträge (News) von Gruppen-Admins (Konzept 11.4, F-161). Reiner Text wie Kommentare, kein HTML; erscheinen über
// das Aktivitäts-Log in der Gruppe und – bei Vereinen – in deren Teams.
import type { Env } from './env';
import { requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, json, readJson } from './http';
import { assertActive } from './moderation';
import { recordPost } from './activity';
import { deletePostReactions } from './reaction-cleanup';
import { GROUP_NOT_FOUND, canViewGroup, loadGroup, roleIn } from './groups';
import { SHARE_ID_RE } from './validate';
import { GROUP_LIMITS } from '../src/domain/limits';
import { cleanComment, commentLength, countLinks } from '../src/domain/comment-text';
import { POST_MAX, POST_MAX_LINKS, canManageGroup, parsePostLink } from '../src/domain/groups';
import { requestKey } from './access';

const DAY = 86_400_000;
const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Beitrag gibt es nicht (mehr).');

/** POST /api/groups/:id/posts – `{ body, link? }`: Eigner und Admins, höchstens 5 pro Gruppe und Tag. */
export async function createPost(request: Request, env: Env, groupId: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const g = await loadGroup(env, groupId);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  if (!g || (!canManageGroup(role) && !canViewGroup(g, role, requestKey(request)))) throw GROUP_NOT_FOUND();
  if (!canManageGroup(role)) throw new HttpError(403, 'forbidden', 'Beiträge schreiben Eigner und Admins der Gruppe.');

  const input = await readJson<{ body?: unknown; link?: unknown }>(request);
  const body = cleanComment(input.body);
  if (!body) throw new HttpError(400, 'empty', 'Bitte einen Text schreiben.');
  if (commentLength(body) > POST_MAX) throw new HttpError(400, 'too_long', `Höchstens ${POST_MAX} Zeichen.`);
  if (countLinks(body) > POST_MAX_LINKS) throw new HttpError(400, 'too_many_links', `Höchstens ${POST_MAX_LINKS} Links pro Beitrag.`);
  const link = parsePostLink(input.link);
  if (link === null) throw new HttpError(400, 'invalid_link', 'Der Link muss mit http:// oder https:// beginnen.');

  const now = Date.now();
  const today = (await env.DB.prepare('SELECT COUNT(*) AS n FROM post_log WHERE group_id = ? AND created_at > ?').bind(g.id, now - DAY).first<{ n: number }>())?.n ?? 0;
  if (today >= GROUP_LIMITS.postsPerDay) throw new HttpError(429, 'post_quota', `Höchstens ${GROUP_LIMITS.postsPerDay} Beiträge pro Tag und Gruppe – morgen geht es weiter.`);

  const id = randomId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO posts (id, author_id, group_id, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user.id, g.id, body, link || null, now),
    env.DB.prepare('INSERT INTO post_log (group_id, created_at) VALUES (?, ?)').bind(g.id, now),
  ]);
  await recordPost(env, id, g.id, user.id, now);
  return json({ post: { id, body, link: link || null, createdAt: now } }, { status: 201 });
}

/** Löscht einen Beitrag samt Aktivität und Meldungen (auch von der Moderation genutzt). */
export async function removePost(env: Env, id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'post' AND target_id = ?`).bind(id),
    deletePostReactions(env, id),
    env.DB.prepare(`DELETE FROM reactions WHERE subject_kind = 'activity' AND subject_id IN (SELECT id FROM activity WHERE subject_kind = 'post' AND subject_id = ?)`).bind(id),
    env.DB.prepare(`DELETE FROM activity WHERE subject_kind = 'post' AND subject_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
  ]);
}

/** DELETE /api/posts/:id – Autor:in oder Eigner/Admins der Gruppe; für alle anderen 404. */
export async function deletePost(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const p = SHARE_ID_RE.test(id) ? await env.DB.prepare('SELECT id, author_id, group_id FROM posts WHERE id = ?').bind(id).first<{ id: string; author_id: string; group_id: string | null }>() : null;
  if (!p) throw NOT_FOUND();
  const role = p.group_id ? await roleIn(env, user.id, p.group_id) : null;
  if (p.author_id !== user.id && !canManageGroup(role)) throw NOT_FOUND();
  await removePost(env, p.id);
  return new Response(null, { status: 204 });
}
