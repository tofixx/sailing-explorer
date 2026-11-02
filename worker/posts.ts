// Beiträge (Konzept 11.4, 21): Text-Beiträge in Gruppen (F-161, Schreibrecht je Gruppe F-421) und im eigenen Profil
// (F-420), „Mein Verlauf“ mit allen eigenen Beiträgen und Törns (F-401) und der eine Löschpfad `removePost` (F-404).
// Reiner Text wie Kommentare, kein HTML. Sichtbarkeit wird beim Lesen geprüft (src/domain/posts.ts, fail closed).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { assertActive, isAdmin } from './moderation';
import { recordPost } from './activity';
import { deletePostReactions } from './reaction-cleanup';
import { deletePostNotifications } from './notification-cleanup';
import { GROUP_NOT_FOUND, canViewGroup, loadGroup, roleIn } from './groups';
import { removeShare } from './shares';
import { isSupporter, visibilityRequiresSupport } from './supporter';
import { SHARE_ID_RE } from './validate';
import { requestKey } from './access';
import { GROUP_LIMITS } from '../src/domain/limits';
import { cleanComment, commentLength, countLinks } from '../src/domain/comment-text';
import { POST_MAX, POST_MAX_LINKS, STREAM_PAGE, canManageGroup, decodeCursor, encodeCursor, parsePostLink, type GroupKind, type GroupRole } from '../src/domain/groups';
import {
  canChoosePostVisibility, canSeePost, canWriteInGroup, effectivePostBy, effectivePostVisibility, isMyPostArea, isPostVisibility,
  postVisibilityChoices, reachFor, shareKindOf, type MyPost, type PostKind, type PostVisibility, type ProfilePost,
} from '../src/domain/posts';
import { sharePath, type Visibility } from '../src/domain/visibility';
import { isLogState } from '../src/domain/logbook';

const DAY = 86_400_000;
const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Beitrag gibt es nicht (mehr).');

// ---------------------------------------------------------------- Schreiben

/** Text, optionaler Link und Sichtbarkeit aus der Anfrage – geprüft gegen die Stufen des Verlaufs. */
async function readPostInput(request: Request, channel: 'user' | 'group') {
  const input = await readJson<{ body?: unknown; link?: unknown; visibility?: unknown }>(request);
  const body = cleanComment(input.body);
  if (!body) throw new HttpError(400, 'empty', 'Bitte einen Text schreiben.');
  if (commentLength(body) > POST_MAX) throw new HttpError(400, 'too_long', `Höchstens ${POST_MAX} Zeichen.`);
  if (countLinks(body) > POST_MAX_LINKS) throw new HttpError(400, 'too_many_links', `Höchstens ${POST_MAX_LINKS} Links pro Beitrag.`);
  const link = parsePostLink(input.link);
  if (link === null) throw new HttpError(400, 'invalid_link', 'Der Link muss mit http:// oder https:// beginnen.');
  const visibility = input.visibility === undefined ? 'public' : input.visibility;
  if (!isPostVisibility(visibility) || !postVisibilityChoices(channel).includes(visibility)) {
    throw new HttpError(400, 'invalid_visibility', 'Diese Sichtbarkeit gibt es hier nicht.');
  }
  return { body, link: link || null, visibility };
}

/** Zähler „Beiträge je Verlauf und Tag“ (post_log, auch nach dem Löschen): Gruppe = ihre ID, Profil = `user:<id>`. */
const logKey = (channel: { kind: 'group'; id: string } | { kind: 'user'; id: string }) => (channel.kind === 'group' ? channel.id : `user:${channel.id}`);

/** Tagesgrenze prüfen und Beitrag samt Zähler in einem Batch schreiben. */
async function insertTextPost(
  env: Env,
  p: { authorId: string; channel: { kind: 'group'; id: string } | { kind: 'user'; id: string }; body: string; link: string | null; visibility: PostVisibility },
): Promise<{ id: string; createdAt: number }> {
  const now = Date.now();
  const key = logKey(p.channel);
  const today = (await env.DB.prepare('SELECT COUNT(*) AS n FROM post_log WHERE group_id = ? AND created_at > ?').bind(key, now - DAY).first<{ n: number }>())?.n ?? 0;
  if (today >= GROUP_LIMITS.postsPerDay) {
    throw new HttpError(429, 'post_quota', `Höchstens ${GROUP_LIMITS.postsPerDay} Beiträge pro Tag ${p.channel.kind === 'group' ? 'und Gruppe' : 'im Profil'} – morgen geht es weiter.`);
  }
  const id = randomId();
  const groupId = p.channel.kind === 'group' ? p.channel.id : null;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO posts (id, author_id, group_id, body, link, created_at, kind, channel_kind, channel_id, visibility, reach)
       VALUES (?, ?, ?, ?, ?, ?, 'text', ?, ?, ?, ?)`,
    ).bind(id, p.authorId, groupId, p.body, p.link, now, p.channel.kind, p.channel.id, p.visibility, reachFor(p.visibility)),
    env.DB.prepare('INSERT INTO post_log (group_id, created_at) VALUES (?, ?)').bind(key, now),
  ]);
  // Ins Aktivitäts-Log nur Öffentliches und „Nur Mitglieder“ (Heimatgruppe) – nie „Nur ich“ (21.7)
  if (p.visibility === 'public' || p.visibility === 'members') {
    await recordPost(env, { id, authorId: p.authorId, channel: groupId ? { kind: 'group', id: groupId } : { kind: 'user' }, visibility: p.visibility }, now);
  }
  return { id, createdAt: now };
}

/**
 * POST /api/groups/:id/posts – `{ body, link?, visibility? }`: wer laut `post_by` der Gruppe schreiben darf (F-421;
 * Standard Verein nur Admins, Team alle Mitglieder), „Öffentlich“ oder „Nur Mitglieder“ (F-402), höchstens 5 pro
 * Gruppe und Tag.
 */
export async function createPost(request: Request, env: Env, groupId: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const g = await loadGroup(env, groupId);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  if (!g || !canViewGroup(g, role, requestKey(request))) throw GROUP_NOT_FOUND();
  if (!canWriteInGroup(role, effectivePostBy(g.kind, g.post_by))) {
    throw new HttpError(403, 'forbidden', role ? 'In dieser Gruppe schreiben nur Eigentümer und Admins.' : 'Beiträge schreiben nur Mitglieder der Gruppe.');
  }
  const input = await readPostInput(request, 'group');
  const { id, createdAt } = await insertTextPost(env, { authorId: user.id, channel: { kind: 'group', id: g.id }, ...input });
  return json({ post: { id, body: input.body, link: input.link, visibility: input.visibility, createdAt } }, { status: 201 });
}

/**
 * POST /api/me/posts – Text-Beitrag im eigenen Profil (F-420): `{ body, link?, visibility }` mit „Öffentlich“ oder
 * „Nur ich“ (wie überall nur für Unterstützer, E1). Öffentliche erscheinen bei Followern und auf dem Profil, nicht in
 * der Community (Ausbreitung folgt in Phase 2).
 */
export async function createProfilePost(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const input = await readPostInput(request, 'user');
  if (!canChoosePostVisibility(input.visibility, await isSupporter(env, user.id))) throw visibilityRequiresSupport(env);
  const { id, createdAt } = await insertTextPost(env, { authorId: user.id, channel: { kind: 'user', id: user.id }, ...input });
  return json({ post: { id, body: input.body, link: input.link, visibility: input.visibility, createdAt } }, { status: 201 });
}

// ---------------------------------------------------------------- Lesen: ein Beitrag (Reaktionen, Melden)

interface PostRow {
  id: string;
  author_id: string;
  group_id: string | null;
  visibility: string;
  hidden_at: number | null;
  share_id: string | null;
  suspended: number;
  author_public: number | null;
}

/**
 * Ein Text-Beitrag, den die Anfrage jetzt sehen darf (F-402) – sonst 404 wie „gibt es nicht“ (Fehlversuch mit
 * Schlüssel zählt). Törn-Zeilen sind hier keine Beiträge: Törns haben ihre eigenen Wege (`share`).
 */
export async function visiblePost(request: Request, env: Env, id: string): Promise<{ id: string; authorId: string; groupId: string | null }> {
  const key = requestKey(request);
  const user = await currentUser(request, env);
  const admin = isAdmin(env, user?.id);
  const p = SHARE_ID_RE.test(id)
    ? await env.DB.prepare(
        `SELECT p.id, p.author_id, p.group_id, p.visibility, p.hidden_at, p.share_id, (u.suspended_at IS NOT NULL) AS suspended,
           (pr.visibility = 'public' AND pr.hidden_at IS NULL) AS author_public
         FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN profiles pr ON pr.user_id = p.author_id WHERE p.id = ?`,
      )
        .bind(id)
        .first<PostRow>()
    : null;
  let ok = false;
  if (p && !p.share_id && isPostVisibility(p.visibility)) {
    const g = p.group_id ? await loadGroup(env, p.group_id) : null;
    const role: GroupRole | null = g ? await roleIn(env, user?.id, g.id) : null;
    if (!p.group_id || g) {
      ok = canSeePost(
        { visibility: p.visibility, channel: p.group_id ? 'group' : 'user', hidden: !!p.hidden_at, authorSuspended: !!p.suspended, authorPublic: !!p.author_public },
        { isAuthor: p.author_id === user?.id, groupVisible: !!g && canViewGroup(g, role, key, admin), isMember: role !== null, canModerate: admin || canManageGroup(role) },
      );
    }
  }
  if (!p || !ok) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  return { id: p.id, authorId: p.author_id, groupId: p.group_id };
}

// ---------------------------------------------------------------- Löschen (F-404)

/**
 * Der eine Löschpfad für Beiträge: Törn-Beiträge (`voyage`/`logbook`) löscht `removeShare` (Dateien, Fotos, Zähler;
 * die Post-Zeile fällt per ON DELETE CASCADE), Text-Beiträge samt Aktivität, Reaktionen, Benachrichtigungen und
 * Meldungen. Auch von der Moderation genutzt.
 */
export async function removePost(env: Env, id: string): Promise<void> {
  const row = await env.DB.prepare('SELECT share_id FROM posts WHERE id = ?').bind(id).first<{ share_id: string | null }>();
  if (row?.share_id) return removeShare(env, row.share_id);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'post' AND target_id = ?`).bind(id),
    deletePostReactions(env, id),
    deletePostNotifications(env, id),
    env.DB.prepare(`DELETE FROM reactions WHERE subject_kind = 'activity' AND subject_id IN (SELECT id FROM activity WHERE subject_kind = 'post' AND subject_id = ?)`).bind(id),
    env.DB.prepare(`DELETE FROM activity WHERE subject_kind = 'post' AND subject_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
  ]);
}

/**
 * DELETE /api/posts/:id – Text-Beiträge: Autor:in oder Eigner/Admins der Gruppe; Törn-Beiträge nur die
 * Eigentümer:in. Gesperrtes bleibt als Beleg (Konzept 18.2). Für alle anderen 404.
 */
export async function deletePost(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const p = SHARE_ID_RE.test(id)
    ? await env.DB.prepare(
        `SELECT p.id, p.author_id, p.group_id, p.share_id, g.locked_at, s.locked_at AS s_locked, s.user_id AS s_owner FROM posts p
         LEFT JOIN groups g ON g.id = p.group_id LEFT JOIN shares s ON s.id = p.share_id WHERE p.id = ?`,
      )
        .bind(id)
        .first<{ id: string; author_id: string; group_id: string | null; share_id: string | null; locked_at: number | null; s_locked: number | null; s_owner: string | null }>()
    : null;
  if (!p || p.locked_at || p.s_locked) throw NOT_FOUND();
  if (p.share_id) {
    // Törn: wie ownedShare gegen die Eigentümer:in des Törns prüfen, nicht gegen die Kopie in posts.author_id
    if (p.s_owner !== user.id) throw NOT_FOUND();
  } else {
    const role = p.group_id ? await roleIn(env, user.id, p.group_id) : null;
    if (p.author_id !== user.id && !canManageGroup(role)) throw NOT_FOUND();
  }
  await removePost(env, p.id);
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- „Mein Verlauf“ (F-401)

interface MyRow {
  id: string;
  kind: string;
  visibility: string;
  body: string;
  link: string | null;
  hidden_at: number | null;
  created_at: number;
  share_id: string | null;
  s_title: string | null;
  s_vis: Visibility | null;
  s_key: string | null;
  s_dist: number | null;
  s_started: number | null;
  s_hidden: number | null;
  s_source: string | null;
  s_log: string | null;
  s_groups: string | null;
  g_slug: string | null;
  g_name: string | null;
  g_kind: GroupKind | null;
  g_vis: Visibility | null;
}

/**
 * Alle eigenen Beiträge und Törns, neueste zuerst – direkt aus `posts(author_id, created_at)`, nicht über das
 * Aktivitäts-Log. `?1` Konto, `?2` Bereich, `?3`/`?4` Cursor, `?5` Seitengröße + 1. Gesperrte Törns sieht nur die
 * Moderation (wie Konto → Freigaben).
 */
const MY_POSTS_SQL = `SELECT p.id, p.kind, p.visibility, p.body, p.link, p.hidden_at, p.created_at, p.share_id,
    s.title AS s_title, s.visibility AS s_vis, s.share_key AS s_key, s.dist_nm AS s_dist, s.started_at AS s_started, s.hidden_at AS s_hidden, s.source AS s_source, s.log_state AS s_log,
    (SELECT json_group_array(json_object('slug', sg.slug, 'name', sg.name)) FROM share_groups x JOIN groups sg ON sg.id = x.group_id
       WHERE x.share_id = p.share_id AND sg.hidden_at IS NULL AND sg.locked_at IS NULL) AS s_groups,
    g.slug AS g_slug, g.name AS g_name, g.kind AS g_kind, g.visibility AS g_vis
  FROM posts p
  LEFT JOIN shares s ON s.id = p.share_id
  LEFT JOIN groups g ON g.id = p.group_id
  WHERE p.author_id = ?1
    AND (p.share_id IS NULL OR (s.id IS NOT NULL AND s.locked_at IS NULL))
    AND (?2 = 'all' OR (CASE WHEN p.share_id IS NOT NULL THEN s.visibility ELSE p.visibility END) = 'private')
    AND (p.created_at < ?3 OR (p.created_at = ?3 AND p.id < ?4))
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT ?5`;

function groupsOf(raw: string | null): Array<{ slug: string; name: string }> {
  try {
    const list = JSON.parse(raw ?? '[]') as Array<{ slug: unknown; name: unknown }>;
    return list.filter((g) => typeof g.slug === 'string' && typeof g.name === 'string').map((g) => ({ slug: String(g.slug), name: String(g.name) }));
  } catch {
    return [];
  }
}

function myPostShape(r: MyRow): MyPost | null {
  if (r.share_id) {
    if (!r.s_title || !r.s_vis) return null;
    return {
      id: r.id, kind: shareKindOf(r.s_source), createdAt: r.created_at, visibility: r.s_vis, channel: { kind: 'user' }, groups: groupsOf(r.s_groups),
      body: '', link: null, hidden: !!r.s_hidden,
      voyage: { title: r.s_title, distNm: r.s_dist ?? 0, startedAt: r.s_started, path: sharePath('s', r.id, r.s_vis, r.s_key), logState: isLogState(r.s_log) ? r.s_log : 'suggested' },
    };
  }
  if (!isPostVisibility(r.visibility)) return null;
  const group = r.g_slug && r.g_name && r.g_kind ? { kind: 'group' as const, slug: r.g_slug, name: r.g_name, groupKind: r.g_kind } : null;
  return {
    id: r.id, kind: (r.kind as PostKind) ?? 'text', createdAt: r.created_at, visibility: effectivePostVisibility(r.visibility, group ? r.g_vis : null),
    channel: group ?? { kind: 'user' }, groups: [], body: r.body, link: r.link, hidden: !!r.hidden_at,
  };
}

/** GET /api/me/posts?area=all|private&cursor= – „Mein Verlauf“: nur für einen selbst, nie gecacht. */
export async function listMyPosts(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const url = new URL(request.url);
  const area = url.searchParams.get('area') ?? 'all';
  if (!isMyPostArea(area)) throw new HttpError(400, 'invalid_area', 'Unbekannter Bereich.');
  const raw = url.searchParams.get('cursor');
  const c = decodeCursor(raw);
  if (raw && !c) throw new HttpError(400, 'invalid_cursor', 'Ungültiger Cursor.');
  const at = c ?? { at: Number.MAX_SAFE_INTEGER, id: '~' };
  const { results } = await env.DB.prepare(MY_POSTS_SQL).bind(user.id, area, at.at, at.id, STREAM_PAGE + 1).all<MyRow>();
  const page = results.slice(0, STREAM_PAGE);
  const last = page[page.length - 1];
  return json(
    { items: page.map(myPostShape).filter((p): p is MyPost => !!p), cursor: results.length > STREAM_PAGE && last ? encodeCursor({ at: last.created_at, id: last.id }) : null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

// ---------------------------------------------------------------- Profil für Besucher (F-420, F-423)

/** Wer eine Profilseite liest: echtes Konto (Mitgliedschaften aus der DB) oder simulierte Vorschau (F-423). */
export type ProfileReader = { userId: string | null } | { preview: { memberOf: string | null } };

interface VisitorRow {
  id: string;
  body: string;
  link: string | null;
  created_at: number;
  visibility: string;
  group_id: string | null;
  g_slug: string | null;
  g_name: string | null;
  g_kind: GroupKind | null;
  g_vis: Visibility | null;
  g_key: string | null;
  g_hidden: number | null;
  g_locked: number | null;
}

/**
 * Beiträge der Person, die dieser Leser sehen darf (neueste 20): öffentliche im Profil und – mit „Wo steht es“ – ihre
 * Gruppen-Beiträge, soweit der Leser die Gruppe sehen darf („Nur Mitglieder“ nur für Mitglieder). Dieselbe Prüfung wie
 * beim Lesen (canSeePost); die Vorschau (F-423) simuliert nur Mitgliedschaften und sieht nie mehr als ein echter Leser.
 * Nur bei öffentlichem Profil aufrufen; nie von gesperrten Konten.
 */
export async function visitorPosts(env: Env, authorId: string, reader: ProfileReader): Promise<ProfilePost[]> {
  // Mitgliedschaften des Lesers: echt (?2 = Konto) bzw. simuliert (?3 = gewählte Gruppe der Vorschau)
  const userId = 'preview' in reader ? '' : (reader.userId ?? '');
  const previewGroup = 'preview' in reader ? (reader.preview.memberOf ?? '') : '';
  // Sichtbarkeit schon im SQL (neueste 20 sichtbare, keine älteren fallen weg); canSeePost prüft danach noch einmal
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.body, p.link, p.created_at, p.visibility, p.group_id,
       g.slug AS g_slug, g.name AS g_name, g.kind AS g_kind, g.visibility AS g_vis, g.share_key AS g_key, g.hidden_at AS g_hidden, g.locked_at AS g_locked,
       COALESCE((SELECT m.role FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?2), CASE WHEN g.id = ?3 THEN 'member' END) AS role
     FROM posts p LEFT JOIN groups g ON g.id = p.group_id
     WHERE p.author_id = ?1 AND p.share_id IS NULL AND p.hidden_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ?1 AND u.suspended_at IS NOT NULL)
       AND (
         (p.group_id IS NULL AND p.visibility = 'public')
         OR (g.id IS NOT NULL AND g.locked_at IS NULL AND p.visibility IN ('public', 'members') AND (
           (p.visibility = 'public' AND g.visibility = 'public' AND g.hidden_at IS NULL)
           OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?2)
           OR g.id = ?3))
       )
     ORDER BY p.created_at DESC LIMIT 20`,
  )
    .bind(authorId, userId, previewGroup)
    .all<VisitorRow & { role: GroupRole | null }>();
  const out: ProfilePost[] = [];
  for (const r of results) {
    if (!isPostVisibility(r.visibility)) continue;
    const g = r.group_id && r.g_slug && r.g_name && r.g_kind && r.g_vis ? r : null;
    if (r.group_id && !g) continue;
    const role = g ? r.role : null;
    const groupVisible = !!g && canViewGroup({ visibility: g.g_vis!, share_key: g.g_key, hidden_at: g.g_hidden, locked_at: g.g_locked }, role, null);
    const ok = canSeePost(
      { visibility: r.visibility, channel: g ? 'group' : 'user', hidden: false, authorSuspended: false, authorPublic: true },
      { isAuthor: false, groupVisible, isMember: role !== null },
    );
    if (!ok) continue;
    out.push({
      id: r.id, createdAt: r.created_at, body: r.body, link: r.link,
      group: g ? { slug: g.g_slug!, name: g.g_name!, kind: g.g_kind! } : null,
      visibility: effectivePostVisibility(r.visibility, g ? g.g_vis : null),
    });
  }
  return out;
}
