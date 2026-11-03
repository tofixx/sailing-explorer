// Beiträge (Konzept 11.4, 21): Text-Beiträge in Gruppen (F-161, Schreibrecht je Gruppe F-421) und im eigenen Profil
// (F-420), „Mein Verlauf“ mit allen eigenen Beiträgen und Törns (F-401) und der eine Löschpfad `removePost` (F-404).
// Reiner Text wie Kommentare, kein HTML. Sichtbarkeit wird beim Lesen geprüft (src/domain/posts.ts, fail closed).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { randomId } from './crypto';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { assertActive, isAdmin } from './moderation';
import { recordPost, syncPostActivity, type PostForActivity } from './activity';
import { deletePostReactions } from './reaction-cleanup';
import { deletePostNotifications } from './notification-cleanup';
import { GROUP_NOT_FOUND, canViewGroup, loadGroup, roleIn } from './groups';
import { roleFor } from './boats';
import { removeShare } from './shares';
import { isSupporter, visibilityRequiresSupport } from './supporter';
import { SHARE_ID_RE, timingSafeEqual } from './validate';
import { canView, newShareKey, requestKey } from './access';
import { chainOf, composeTarget, writableChannel, writableChannels, type WritableChannel } from './post-chain';
import { postCard } from './stream';
import { postLogKey } from './post-sql';
import { notifyPost } from './notifications';
import { GROUP_LIMITS } from '../src/domain/limits';
import { cleanComment, commentLength, countLinks } from '../src/domain/comment-text';
import { POST_MAX, POST_MAX_LINKS, STREAM_PAGE, canManageGroup, decodeCursor, encodeCursor, parsePostLink, type GroupKind, type GroupRole } from '../src/domain/groups';
import {
  canChoosePostVisibility, canManageChannel, canSeePost, defaultPostVisibility, widensAudience, canWriteInGroup, channelKey, channelPath, effectivePostBy, effectivePostVisibility, isChannelKind, isMyPostArea,
  isPostVisibility, isReach, postVisibilityChoices, reachChoices, reachFor, reachTargets, shareKindOf,
  type AttachableShare, type ChannelKind, type ChannelRef, type MyPost, type PostKind, type PostLink, type PostVisibility, type ProfilePost, type Reach, type ReachChain,
} from '../src/domain/posts';
import { sharePath, type Visibility } from '../src/domain/visibility';
import { isLogState } from '../src/domain/logbook';
import { liveSql, notSuspendedSql, publicSql } from './visible-sql';

const DAY = 86_400_000;
const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Beitrag gibt es nicht (mehr).');

// ---------------------------------------------------------------- Schreiben

/** Text, optionaler Link, Sichtbarkeit, „Sichtbar bis“ und angehängter Törn aus der Anfrage. */
interface PostInput {
  body: string;
  link: string | null;
  visibility: PostVisibility;
  reach: Reach;
  shareId: string | null;
}

type RawPostInput = { body?: unknown; link?: unknown; visibility?: unknown; reach?: unknown; shareId?: unknown; channel?: unknown };

/** Sichtbarkeit und Reichweite gegen die Stufen des Verlaufs prüfen (fail closed: Unbekanntes → 400). */
function readAudience(raw: { visibility?: unknown; reach?: unknown }, c: WritableChannel, fallback: PostVisibility): { visibility: PostVisibility; reach: Reach } {
  const visibility = raw.visibility === undefined ? fallback : raw.visibility;
  if (!isPostVisibility(visibility) || !postVisibilityChoices(c.kind).includes(visibility)) {
    throw new HttpError(400, 'invalid_visibility', 'Diese Sichtbarkeit gibt es hier nicht.');
  }
  if (raw.reach !== undefined && (!isReach(raw.reach) || (visibility === 'public' && !reachChoices(c.chain).includes(raw.reach)))) {
    throw new HttpError(400, 'invalid_reach', 'Diese Stufe „Sichtbar bis“ gibt es hier nicht.');
  }
  // Ohne Angabe wie bisher (ältere Oberflächen): Gruppen, Häfen, Boote „überall“ (Standard B2), das Profil „nur hier“ (F-420)
  const fallbackReach: Reach = c.kind !== 'user' && reachChoices(c.chain).includes('all') ? 'all' : 'here';
  return { visibility, reach: reachFor(visibility, isReach(raw.reach) ? raw.reach : fallbackReach) };
}

/** Angehängter Törn (F-426): nur ein eigener, nicht gesperrter. */
async function readShareId(env: Env, userId: string, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null;
  const ok = typeof raw === 'string' && SHARE_ID_RE.test(raw) && (await env.DB.prepare('SELECT 1 AS x FROM shares WHERE id = ? AND user_id = ? AND locked_at IS NULL').bind(raw, userId).first());
  if (!ok) throw new HttpError(400, 'invalid_share', 'Anhängen kannst du nur deine eigenen Törns.');
  return raw as string;
}

async function readPostInput(env: Env, userId: string, input: RawPostInput, c: WritableChannel): Promise<PostInput> {
  const body = cleanComment(input.body);
  if (!body) throw new HttpError(400, 'empty', 'Bitte einen Text schreiben.');
  if (commentLength(body) > POST_MAX) throw new HttpError(400, 'too_long', `Höchstens ${POST_MAX} Zeichen.`);
  if (countLinks(body) > POST_MAX_LINKS) throw new HttpError(400, 'too_many_links', `Höchstens ${POST_MAX_LINKS} Links pro Beitrag.`);
  const link = parsePostLink(input.link);
  if (link === null) throw new HttpError(400, 'invalid_link', 'Der Link muss mit http:// oder https:// beginnen.');
  // ohne Angabe: in Gruppen „Nur Mitglieder“, sonst öffentlich (F-445)
  const audience = readAudience(input, c, defaultPostVisibility(c.kind));
  return { body, link: link || null, ...audience, shareId: await readShareId(env, userId, input.shareId) };
}


const LOG_WHERE: Record<ChannelKind, string> = { group: 'und Gruppe', user: 'im Profil', harbor: 'von dir im Hafen', boat: 'von dir am Boot' };

/** Link zur Karte (F-406): „Nur mit Link“ mit Schlüssel. */
const postPath = (id: string, visibility: string, key: string | null) => (visibility === 'unlisted' && key ? `/p/${id}/${key}` : `/p/${id}`);

/** Ins Aktivitäts-Log nur Öffentliches und „Nur Mitglieder“ – nie „Nur mit Link“ oder „Nur ich“ (21.7); Ziele bis „Sichtbar bis“. */
const forActivity = (id: string, authorId: string, c: { kind: ChannelKind; id: string }, chain: ReachChain, visibility: PostVisibility, reach: Reach): PostForActivity | null =>
  visibility === 'public' || visibility === 'members'
    ? { id, authorId, channel: { kind: c.kind, id: c.kind === 'user' ? authorId : c.id }, visibility, upward: visibility === 'public' ? reachTargets(chain, reach) : [] }
    : null;

/** Tagesgrenze prüfen, Beitrag samt Zähler in einem Batch schreiben, danach ins Log (Heimatverlauf + Ausbreitung). */
async function insertTextPost(env: Env, authorId: string, c: WritableChannel, p: PostInput): Promise<{ id: string; createdAt: number; path: string }> {
  const now = Date.now();
  const key = postLogKey(c, authorId);
  const today = (await env.DB.prepare('SELECT COUNT(*) AS n FROM post_log WHERE group_id = ? AND created_at > ?').bind(key, now - DAY).first<{ n: number }>())?.n ?? 0;
  if (today >= GROUP_LIMITS.postsPerDay) {
    throw new HttpError(429, 'post_quota', `Höchstens ${GROUP_LIMITS.postsPerDay} Beiträge pro Tag ${LOG_WHERE[c.kind]} – morgen geht es weiter.`);
  }
  const id = randomId();
  const linkKey = p.visibility === 'unlisted' ? newShareKey() : null;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO posts (id, author_id, group_id, body, link, created_at, kind, channel_kind, channel_id, visibility, reach, link_key, data)
       VALUES (?, ?, ?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, ?)`,
    ).bind(id, authorId, c.groupId, p.body, p.link, now, c.kind, c.id, p.visibility, p.reach, linkKey, JSON.stringify(p.shareId ? { shareId: p.shareId } : {})),
    env.DB.prepare('INSERT INTO post_log (group_id, created_at) VALUES (?, ?)').bind(key, now),
  ]);
  const act = forActivity(id, authorId, c, c.chain, p.visibility, p.reach);
  if (act) await recordPost(env, act, now);
  // nur der Heimatverlauf benachrichtigt (F-416)
  await notifyPost(env, { id, authorId, kind: 'text', channel: { kind: c.kind, id: c.kind === 'user' ? authorId : c.id }, visibility: p.visibility });
  return { id, createdAt: now, path: postPath(id, p.visibility, linkKey) };
}

/** Schreiben in einen Verlauf: Konto aktiv, Schreibrecht (fail closed), Eingaben geprüft, „Nur ich“/„Nur mit Link“ nur für Unterstützer. */
async function writePost(request: Request, env: Env, kind: ChannelKind, channelId: string | null, raw?: RawPostInput): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const input = raw ?? (await readJson<RawPostInput>(request));
  const c = await writableChannel(env, user.id, kind, channelId ?? user.id);
  if (!c) throw new HttpError(403, 'forbidden', 'Hier darfst du keine Beiträge schreiben.');
  const p = await readPostInput(env, user.id, input, c);
  if (!canChoosePostVisibility(p.visibility, await isSupporter(env, user.id))) throw visibilityRequiresSupport(env);
  const { id, createdAt, path } = await insertTextPost(env, user.id, c, p);
  return json({ post: { id, body: p.body, link: p.link, visibility: p.visibility, reach: p.reach, createdAt, path, home: channelPath(c.ref, null) } }, { status: 201 });
}

/**
 * POST /api/groups/:id/posts – `{ body, link?, visibility?, reach?, shareId? }`: wer laut `post_by` der Gruppe schreiben
 * darf (F-421), sonst 403 bzw. 404 für Gruppen, die man nicht sehen darf; höchstens 5 pro Gruppe und Tag.
 */
export async function createPost(request: Request, env: Env, groupId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const g = await loadGroup(env, groupId);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  if (!g || !canViewGroup(g, role, requestKey(request))) throw GROUP_NOT_FOUND();
  if (!canWriteInGroup(role, effectivePostBy(g.kind, g.post_by))) {
    throw new HttpError(403, 'forbidden', role ? 'In dieser Gruppe schreiben nur Eigentümer und Admins.' : 'Beiträge schreiben nur Mitglieder der Gruppe.');
  }
  return writePost(request, env, 'group', g.id);
}

/** POST /api/me/posts – Text-Beitrag im eigenen Profil (F-420). */
export const createProfilePost = (request: Request, env: Env): Promise<Response> => writePost(request, env, 'user', null);

/**
 * POST /api/posts – `{ channel: { kind, id }, body, link?, visibility?, reach?, shareId? }` (F-405, F-425): ein Weg für
 * alle Verläufe, aus dem Plus-Knopf. Kein Schreibrecht → 403.
 */
export async function createChannelPost(request: Request, env: Env): Promise<Response> {
  const raw = await readJson<RawPostInput>(request);
  const ch = raw.channel as { kind?: unknown; id?: unknown } | undefined;
  if (!ch || !isChannelKind(ch.kind) || (ch.kind !== 'user' && (typeof ch.id !== 'string' || !SHARE_ID_RE.test(ch.id)))) {
    throw new HttpError(400, 'invalid_channel', 'Unbekannter Verlauf.');
  }
  return writePost(request, env, ch.kind, ch.kind === 'user' ? null : (ch.id as string), raw);
}

/**
 * PATCH /api/posts/:id – `{ visibility?, reach? }` nur für die Autor:in eines Text-Beitrags (F-409): Kette neu
 * auflösen, Ziele angleichen (nichts springt nach oben, Ausbreitung benachrichtigt nie), „Nur mit Link“ bekommt einen
 * Schlüssel. Fremde, Törn-Zeilen und Gesperrtes → 404.
 */
export async function updatePost(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const p = SHARE_ID_RE.test(id)
    ? await env.DB.prepare(
        `SELECT p.id, p.author_id, p.channel_kind, p.channel_id, p.visibility, p.reach, p.link_key, p.created_at, g.locked_at FROM posts p
         LEFT JOIN groups g ON g.id = p.group_id WHERE p.id = ? AND p.share_id IS NULL`,
      )
        .bind(id)
        .first<{ id: string; author_id: string; channel_kind: string; channel_id: string; visibility: string; reach: string; link_key: string | null; created_at: number; locked_at: number | null }>()
    : null;
  if (!p || p.author_id !== user.id || p.locked_at || !isChannelKind(p.channel_kind) || !isPostVisibility(p.visibility)) throw NOT_FOUND();
  const chain = await chainOf(env, user.id, p.channel_kind, p.channel_id);
  if (!chain) throw NOT_FOUND();
  const c = { kind: p.channel_kind, id: p.channel_id, chain };
  const raw = await readJson<{ visibility?: unknown; reach?: unknown }>(request);
  const { visibility, reach } = readAudience({ visibility: raw.visibility, reach: raw.reach ?? (isReach(p.reach) ? p.reach : undefined) }, c as WritableChannel, p.visibility);
  if (visibility !== p.visibility && !canChoosePostVisibility(visibility, await isSupporter(env, user.id))) throw visibilityRequiresSupport(env);
  // erweitern nur mit aktuellem Schreibrecht im Verlauf (z. B. nach Austritt oder ohne Boot im Hafen nicht mehr)
  if (widensAudience({ visibility: p.visibility, reach: isReach(p.reach) ? p.reach : 'here' }, { visibility, reach }) && !(await writableChannel(env, user.id, p.channel_kind, p.channel_id))) {
    throw new HttpError(403, 'forbidden', 'Erweitern kannst du nur, wo du noch schreiben darfst – einschränken geht immer.');
  }
  const linkKey = visibility === 'unlisted' ? (p.link_key ?? newShareKey()) : p.link_key;
  await env.DB.prepare('UPDATE posts SET visibility = ?, reach = ?, link_key = ?, updated_at = ? WHERE id = ?').bind(visibility, reach, linkKey, Date.now(), p.id).run();
  await syncPostActivity(env, p.id, forActivity(p.id, user.id, c, chain, visibility, reach), p.created_at);
  return json({ post: { id: p.id, visibility, reach, path: postPath(p.id, visibility, linkKey) } });
}

/**
 * GET /api/posts/:id (`X-Share-Key` für „Nur mit Link“) – der Beitrag als Karte für diesen Betrachter und wohin
 * `/p/<id>` führt (F-406): Heimatverlauf mit Anker, wenn die Karte dort im Verlauf steht, sonst die einzelne Karte. Nicht
 * sichtbar → 404 (Fehlversuch mit Schlüssel zählt).
 */
export async function getPost(request: Request, env: Env, id: string): Promise<Response> {
  const key = requestKey(request);
  const user = await currentUser(request, env);
  const item = SHARE_ID_RE.test(id) ? await postCard(env, user?.id ?? null, id, key) : null;
  if (!item?.post) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  const p = item.post;
  const isAuthor = !!user && (await env.DB.prepare('SELECT 1 AS x FROM posts WHERE id = ? AND author_id = ?').bind(id, user.id).first());
  const ownHandle = isAuthor && !item.actor ? ((await env.DB.prepare('SELECT handle FROM profiles WHERE user_id = ?').bind(user!.id).first<{ handle: string }>())?.handle ?? null) : null;
  const home =
    item.group ? `/g/${item.group.slug}`
    : p.where?.kind === 'harbor' ? `/h/${p.where.slug}`
    : p.where?.kind === 'boat' ? `/b/${p.where.id}`
    : item.actor ? `/u/${item.actor.handle}` : ownHandle ? `/u/${ownHandle}` : null;
  const where =
    item.group ? `${item.group.kind === 'team' ? 'Team' : 'Verein'} ${item.group.name}`
    : p.where ? `${p.where.kind === 'harbor' ? 'Hafen' : 'Boot'} ${p.where.name}`
    : item.actor ? `Profil von ${item.actor.displayName}` : 'Profil';
  // im Verlauf steht, was dort für alle mit Zugang erscheint; die Autor:in findet alles in „Mein Verlauf“
  const inStream = !!home && (!!isAuthor || p.visibility === 'public' || p.visibility === 'members');
  const link: PostLink = { home, inStream, where };
  return json({ item, link }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * GET /api/me/compose?ctx=<art>:<id> – Verläufe, in die das Konto schreiben darf (F-405), mit Stufen und Kette, und
 * die eigenen Törns zum Anhängen (F-426). `ctx` (Gruppen-, Hafen- bzw. Bootsseite) ist vorausgewählt, wenn man dort
 * schreiben darf.
 */
export async function getCompose(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const supporter = await isSupporter(env, user.id);
  const channels = await writableChannels(env, user.id);
  const m = /^(group|harbor|boat):([A-Za-z0-9]{12,32})$/.exec(new URL(request.url).searchParams.get('ctx') ?? '');
  let preselect: string | null = null;
  if (m) {
    const ctx = channels.find((c) => c.kind === m[1] && c.id === m[2]) ?? (await writableChannel(env, user.id, m[1] as ChannelKind, m[2]));
    if (ctx) {
      if (!channels.includes(ctx)) channels.push(ctx);
      preselect = channelKey(ctx.ref);
    }
  }
  const { results: shares } = await env.DB.prepare(
    'SELECT id, title, started_at FROM shares WHERE user_id = ? AND locked_at IS NULL ORDER BY COALESCE(started_at, created_at) DESC LIMIT 30',
  )
    .bind(user.id)
    .all<{ id: string; title: string; started_at: number | null }>();
  const attachable: AttachableShare[] = shares.map((s) => ({ id: s.id, title: s.title, startedAt: s.started_at }));
  return json({ targets: channels.map((c) => composeTarget(c, supporter)), preselect, shares: attachable, supporter }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// ---------------------------------------------------------------- Lesen: ein Beitrag (Reaktionen, Melden)

interface PostRow {
  id: string;
  author_id: string;
  group_id: string | null;
  visibility: string;
  hidden_at: number | null;
  share_id: string | null;
  channel_kind: string | null;
  channel_id: string | null;
  link_key: string | null;
  suspended: number;
  author_public: number | null;
  harbor_ok: number | null;
  b_vis: Visibility | null;
  b_key: string | null;
  b_hidden: number | null;
  b_locked: number | null;
}

/**
 * Ein Text-Beitrag, den die Anfrage jetzt sehen darf (F-402, F-406) – sonst 404 wie „gibt es nicht“ (Fehlversuch mit
 * Schlüssel zählt). Effektiv min(Beitrag, Verlauf): Gruppe, Hafen bzw. Boot müssen sichtbar sein; „Nur mit Link“ braucht
 * den Schlüssel des Beitrags (`X-Share-Key`). Törn-Zeilen sind hier keine Beiträge: Törns haben ihre eigenen Wege.
 */
export async function visiblePost(request: Request, env: Env, id: string): Promise<{ id: string; authorId: string; groupId: string | null }> {
  const key = requestKey(request);
  const user = await currentUser(request, env);
  const admin = isAdmin(env, user?.id);
  const p = SHARE_ID_RE.test(id)
    ? await env.DB.prepare(
        `SELECT p.id, p.author_id, p.group_id, p.visibility, p.hidden_at, p.share_id, p.channel_kind, p.channel_id, p.link_key,
           (u.suspended_at IS NOT NULL) AS suspended, ${publicSql('pr')} AS author_public,
           (SELECT 1 FROM harbors h WHERE p.channel_kind = 'harbor' AND h.id = p.channel_id AND h.hidden_at IS NULL) AS harbor_ok,
           b.visibility AS b_vis, b.share_key AS b_key, b.hidden_at AS b_hidden, b.locked_at AS b_locked
         FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN profiles pr ON pr.user_id = p.author_id
           LEFT JOIN boats b ON p.channel_kind = 'boat' AND b.id = p.channel_id
         WHERE p.id = ?`,
      )
        .bind(id)
        .first<PostRow>()
    : null;
  let ok = false;
  if (p && !p.share_id && isPostVisibility(p.visibility)) {
    const kind: ChannelKind = isChannelKind(p.channel_kind) ? p.channel_kind : p.group_id ? 'group' : 'user';
    const g = kind === 'group' && p.group_id ? await loadGroup(env, p.group_id) : null;
    const role: GroupRole | null = g ? await roleIn(env, user?.id, g.id) : null;
    const boatRole = kind === 'boat' && user && p.channel_id ? await roleFor(env, user.id, p.channel_id) : null;
    const channelVisible =
      kind === 'group' ? !!g && canViewGroup(g, role, key, admin)
      : kind === 'harbor' ? !!p.harbor_ok
      : kind === 'boat' ? !!p.b_vis && canView({ visibility: p.b_vis, shareKey: p.b_key, hiddenAt: p.b_hidden, lockedAt: p.b_locked }, { manager: !!boatRole, key: null, admin })
      : true;
    ok = canSeePost(
      { visibility: p.visibility, channel: kind, hidden: !!p.hidden_at, authorSuspended: !!p.suspended, authorPublic: !!p.author_public },
      { isAuthor: p.author_id === user?.id, channelVisible, isMember: role !== null, canModerate: admin || canManageGroup(role), keyOk: !!key && !!p.link_key && timingSafeEqual(key, p.link_key) },
    );
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
        `SELECT p.id, p.author_id, p.group_id, p.share_id, p.channel_kind, p.channel_id, g.locked_at, s.locked_at AS s_locked, s.user_id AS s_owner,
           h.created_by AS h_creator FROM posts p
         LEFT JOIN groups g ON g.id = p.group_id LEFT JOIN shares s ON s.id = p.share_id
         LEFT JOIN harbors h ON p.channel_kind = 'harbor' AND h.id = p.channel_id WHERE p.id = ?`,
      )
        .bind(id)
        .first<{
          id: string; author_id: string; group_id: string | null; share_id: string | null; channel_kind: string | null; channel_id: string | null;
          locked_at: number | null; s_locked: number | null; s_owner: string | null; h_creator: string | null;
        }>()
    : null;
  if (!p || p.locked_at || p.s_locked) throw NOT_FOUND();
  if (p.share_id) {
    // Törn: wie ownedShare gegen die Eigentümer:in des Törns prüfen, nicht gegen die Kopie in posts.author_id
    if (p.s_owner !== user.id) throw NOT_FOUND();
  } else {
    // Autor:in oder wer den Heimatverlauf verwaltet (Gruppe, Hafen, Boot – F-403/F-425)
    const kind: ChannelKind = isChannelKind(p.channel_kind) ? p.channel_kind : p.group_id ? 'group' : 'user';
    const manages = canManageChannel({
      kind,
      groupRole: p.group_id ? await roleIn(env, user.id, p.group_id) : null,
      harborCreator: !!p.h_creator && p.h_creator === user.id,
      admin: isAdmin(env, user.id),
      boatRole: kind === 'boat' && p.channel_id ? await roleFor(env, user.id, p.channel_id) : null,
    });
    if (p.author_id !== user.id && (kind === 'user' || !manages)) throw NOT_FOUND();
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
  channel_kind: string | null;
  reach: string;
  link_key: string | null;
  h_slug: string | null;
  h_name: string | null;
  b_id: string | null;
  b_name: string | null;
  b_vis: Visibility | null;
  a_id: string | null;
  a_title: string | null;
  pinned: number;
}

/**
 * Alle eigenen Beiträge und Törns, neueste zuerst – direkt aus `posts(author_id, created_at)`, nicht über das
 * Aktivitäts-Log. `?1` Konto, `?2` Bereich (alles, „Fahrtenbuch“ = Törns, die zählen, F-428, „Privat“), `?3`/`?4`
 * Cursor, `?5` Seitengröße + 1. Gesperrte Törns sieht nur die Moderation (wie Konto → Freigaben).
 */
const MY_POSTS_SQL = `SELECT p.id, p.kind, p.visibility, p.body, p.link, p.hidden_at, p.created_at, p.share_id, p.channel_kind, p.reach, p.link_key,
    s.title AS s_title, s.visibility AS s_vis, s.share_key AS s_key, s.dist_nm AS s_dist, s.started_at AS s_started, s.hidden_at AS s_hidden, s.source AS s_source, s.log_state AS s_log,
    (SELECT json_group_array(json_object('slug', sg.slug, 'name', sg.name)) FROM share_groups x JOIN groups sg ON sg.id = x.group_id
       WHERE x.share_id = p.share_id AND ${liveSql('sg')}) AS s_groups,
    g.slug AS g_slug, g.name AS g_name, g.kind AS g_kind, g.visibility AS g_vis,
    h.slug AS h_slug, h.name AS h_name, b.id AS b_id, b.name AS b_name, b.visibility AS b_vis,
    a.id AS a_id, a.title AS a_title,
    EXISTS (SELECT 1 FROM channel_pins cp WHERE cp.channel_kind = 'user' AND cp.channel_id = ?1 AND cp.post_id = p.id) AS pinned
  FROM posts p
  LEFT JOIN shares s ON s.id = p.share_id
  LEFT JOIN groups g ON g.id = p.group_id
  LEFT JOIN harbors h ON p.channel_kind = 'harbor' AND h.id = p.channel_id
  LEFT JOIN boats b ON p.channel_kind = 'boat' AND b.id = p.channel_id
  LEFT JOIN shares a ON a.id = json_extract(p.data, '$.shareId') AND a.user_id = p.author_id AND a.locked_at IS NULL
  WHERE p.author_id = ?1
    AND (p.share_id IS NULL OR (s.id IS NOT NULL AND s.locked_at IS NULL))
    AND (?2 = 'all'
      OR (?2 = 'private' AND (CASE WHEN p.share_id IS NOT NULL THEN s.visibility ELSE p.visibility END) = 'private')
      OR (?2 = 'logbook' AND p.share_id IS NOT NULL AND s.log_state <> 'excluded'))
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
  const channel: ChannelRef | null =
    r.channel_kind === 'harbor' ? (r.h_slug ? { kind: 'harbor', slug: r.h_slug, name: r.h_name ?? '' } : null)
    : r.channel_kind === 'boat' ? (r.b_id ? { kind: 'boat', id: r.b_id, name: r.b_name ?? '' } : null)
    : r.g_slug && r.g_name && r.g_kind ? { kind: 'group', slug: r.g_slug, name: r.g_name, groupKind: r.g_kind }
    : { kind: 'user' };
  if (!channel) return null;
  // effektiv min(Beitrag, Verlauf): Gruppe bzw. Boot nicht öffentlich ⇒ höchstens deren Stufe
  const channelVis = channel.kind === 'group' ? r.g_vis : channel.kind === 'boat' ? r.b_vis : null;
  const visibility = channel.kind === 'boat' && r.b_vis === 'private' ? 'private' : effectivePostVisibility(r.visibility, channelVis);
  return {
    id: r.id, kind: (r.kind as PostKind) ?? 'text', createdAt: r.created_at, visibility,
    channel, groups: [], body: r.body, link: r.link, hidden: !!r.hidden_at,
    reach: isReach(r.reach) ? r.reach : 'here', path: postPath(r.id, r.visibility, r.link_key),
    attached: r.a_id ? { id: r.a_id, title: r.a_title ?? '' } : null,
    pinned: !!r.pinned,
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
       EXISTS (SELECT 1 FROM channel_pins cp WHERE cp.channel_kind = 'user' AND cp.channel_id = ?1 AND cp.post_id = p.id) AS pinned,
       g.slug AS g_slug, g.name AS g_name, g.kind AS g_kind, g.visibility AS g_vis, g.share_key AS g_key, g.hidden_at AS g_hidden, g.locked_at AS g_locked,
       COALESCE((SELECT m.role FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?2), CASE WHEN g.id = ?3 THEN 'member' END) AS role
     FROM posts p LEFT JOIN groups g ON g.id = p.group_id
     WHERE p.author_id = ?1 AND p.share_id IS NULL AND p.hidden_at IS NULL
       AND ${notSuspendedSql('?1')}
       AND (
         (p.channel_kind = 'user' AND p.visibility = 'public')
         OR (g.id IS NOT NULL AND g.locked_at IS NULL AND p.visibility IN ('public', 'members') AND (
           (p.visibility = 'public' AND ${publicSql('g')})
           OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?2)
           OR g.id = ?3))
       )
     ORDER BY pinned DESC, p.created_at DESC LIMIT 20`,
  )
    .bind(authorId, userId, previewGroup)
    .all<VisitorRow & { role: GroupRole | null; pinned: number }>();
  const out: ProfilePost[] = [];
  for (const r of results) {
    if (!isPostVisibility(r.visibility)) continue;
    const g = r.group_id && r.g_slug && r.g_name && r.g_kind && r.g_vis ? r : null;
    if (r.group_id && !g) continue;
    const role = g ? r.role : null;
    const groupVisible = !!g && canViewGroup({ visibility: g.g_vis!, share_key: g.g_key, hidden_at: g.g_hidden, locked_at: g.g_locked }, role, null);
    const ok = canSeePost(
      { visibility: r.visibility, channel: g ? 'group' : 'user', hidden: false, authorSuspended: false, authorPublic: true },
      { isAuthor: false, channelVisible: groupVisible, isMember: role !== null },
    );
    if (!ok) continue;
    out.push({
      id: r.id, createdAt: r.created_at, body: r.body, link: r.link,
      group: g ? { slug: g.g_slug!, name: g.g_name!, kind: g.g_kind! } : null,
      visibility: effectivePostVisibility(r.visibility, g ? g.g_vis : null),
      // im Profil angepinnt (F-403) – nur Profil-Beiträge, die Liste beginnt mit ihnen
      ...(r.pinned && !g ? { pinned: true } : {}),
    });
  }
  return out;
}
