// Anpinnen (Konzept 21.2 B1, 21.13, F-403): in jedem Verlauf, in dem ein Beitrag erscheint, nur dort wirksam, ohne
// Obergrenze und Ablauf. Pins werden getrennt vom (gecachten) Stream geladen, nie gecacht, und jede Karte wird wie im
// Stream dieses Verlaufs geprüft – ein Pin zeigt nur, was die Lesenden ohnehin sehen. Der persönliche Stream kennt keine
// Pins. Wer verwaltet: src/domain/posts.ts (`canManageChannel`).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { assertActive, isAdmin } from './moderation';
import { canView, requestKey } from './access';
import { canViewGroup, loadGroup, roleIn } from './groups';
import { harborVisible, loadHarbor } from './harbors';
import { roleFor } from './boats';
import { postCard } from './stream';
import { notifyPost } from './notifications';
import { SHARE_ID_RE } from './validate';
import type { ReadAt } from './stream-shape';
import { canManageChannel, isChannelKind, type ChannelKind } from '../src/domain/posts';
import type { Visibility } from '../src/domain/visibility';

/** Höchstens so viele Pins je Verlauf werden angezeigt (es gibt keine Obergrenze beim Anpinnen – B1). */
const PINS_SHOWN = 50;

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diesen Verlauf gibt es nicht (mehr).');

/** Ein Verlauf, wie ihn der Lesende sieht: sichtbar? verwaltet? Lese-Kontext für die Prüfung der Karten. */
export interface ChannelAccess {
  kind: ChannelKind;
  id: string;
  manage: boolean;
  at: ReadAt;
}

/**
 * Verlauf aus `kind:id` für diese Anfrage – null, wenn es ihn nicht gibt oder er nicht sichtbar ist (fail closed). Das
 * Profil ist immer das eigene (Pins im Profil setzt nur die Person selbst; Besucher sehen sie über die Profilseite).
 */
export async function channelAccess(request: Request, env: Env, kind: ChannelKind, id: string): Promise<ChannelAccess | null> {
  const user = await currentUser(request, env);
  const admin = isAdmin(env, user?.id);
  const key = requestKey(request);
  switch (kind) {
    case 'user':
      return user ? { kind, id: user.id, manage: true, at: { kind: 'single' } } : null;
    case 'group': {
      const g = await loadGroup(env, id);
      const role = g ? await roleIn(env, user?.id, g.id) : null;
      if (!g || !canViewGroup(g, role, key, admin)) return null;
      return { kind, id: g.id, manage: canManageChannel({ kind, groupRole: role }), at: { kind: 'group', id: g.id, parentId: g.parent_id ?? null } };
    }
    case 'harbor': {
      const h = await loadHarbor(env, id);
      if (!harborVisible(h, admin)) return null;
      return { kind, id: h.id, manage: canManageChannel({ kind, harborCreator: !!user && h.created_by === user.id, admin }), at: { kind: 'harbor', id: h.id } };
    }
    case 'boat': {
      const b = SHARE_ID_RE.test(id)
        ? await env.DB.prepare('SELECT id, visibility, share_key, hidden_at, locked_at FROM boats WHERE id = ?').bind(id).first<{ id: string; visibility: Visibility; share_key: string | null; hidden_at: number | null; locked_at: number | null }>()
        : null;
      const role = b && user ? await roleFor(env, user.id, b.id) : null;
      if (!b || !canView({ visibility: b.visibility, shareKey: b.share_key, hiddenAt: b.hidden_at, lockedAt: b.locked_at }, { manager: !!role, key, admin })) {
        await countKeyFailure(env, request, key);
        return null;
      }
      return { kind, id: b.id, manage: canManageChannel({ kind, boatRole: role }), at: { kind: 'boat', id: b.id } };
    }
  }
}

const parseChannel = (raw: string | null): { kind: ChannelKind; id: string } | null => {
  const m = /^(user|group|harbor|boat):([A-Za-z0-9]{0,32})$/.exec(raw ?? '');
  return m && isChannelKind(m[1]) ? { kind: m[1], id: m[2] } : null;
};

/**
 * GET /api/pins?channel=<art>:<id> – angepinnte Beiträge eines Verlaufs, neueste Pins zuerst, je Karte geprüft wie im
 * Stream dieses Verlaufs; dazu `canManage` (anpinnen, lösen, fremde Beiträge löschen). Nie gecacht.
 */
export async function listPins(request: Request, env: Env): Promise<Response> {
  const ch = parseChannel(new URL(request.url).searchParams.get('channel'));
  const access = ch && ch.kind !== 'user' ? await channelAccess(request, env, ch.kind, ch.id) : null;
  if (!access) throw NOT_FOUND();
  const user = await currentUser(request, env);
  const { results } = await env.DB.prepare('SELECT post_id FROM channel_pins WHERE channel_kind = ? AND channel_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(access.kind, access.id, PINS_SHOWN)
    .all<{ post_id: string }>();
  const items = [];
  for (const r of results) {
    const item = await postCard(env, user?.id ?? null, r.post_id, null, access.at);
    if (item) items.push(item);
  }
  return json({ items, canManage: access.manage }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * PUT /api/posts/:id/pin { channel: { kind, id }, pinned } – anpinnen bzw. lösen (B1): nur, wer den Verlauf verwaltet
 * (sonst 403); anpinnen nur Text-Beiträge, die dort erscheinen (Heimatverlauf oder Ziel der Ausbreitung, sonst 404).
 */
export async function setPin(request: Request, env: Env, postId: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const body = await readJson<{ channel?: { kind?: unknown; id?: unknown }; pinned?: unknown }>(request);
  const kind = body.channel?.kind;
  const id = typeof body.channel?.id === 'string' ? body.channel.id : '';
  if (!isChannelKind(kind) || typeof body.pinned !== 'boolean') throw new HttpError(400, 'invalid_pin', 'Unbekannter Verlauf.');
  const access = await channelAccess(request, env, kind, id);
  if (!access) throw NOT_FOUND();
  if (!access.manage) throw new HttpError(403, 'forbidden', 'Anpinnen dürfen nur die Verwalter dieses Verlaufs.');
  // Lösen geht immer (nur manuell, B1) – auch wenn der Beitrag inzwischen nicht mehr hier erscheint
  const appears = !body.pinned || (SHARE_ID_RE.test(postId)
    ? await env.DB.prepare(
        `SELECT 1 AS x FROM posts p WHERE p.id = ?1 AND p.share_id IS NULL AND (
           (p.channel_kind = ?2 AND p.channel_id = ?3)
           OR EXISTS (SELECT 1 FROM activity a JOIN activity_target t ON t.activity_id = a.id
             WHERE a.subject_kind = 'post' AND a.subject_id = p.id AND t.target_kind = ?2 AND t.target_id = ?3))`,
      )
        .bind(postId, access.kind, access.id)
        .first()
    : null);
  if (!appears) throw new HttpError(404, 'not_found', 'Diesen Beitrag gibt es hier nicht.');
  await (body.pinned
    ? env.DB.prepare('INSERT OR IGNORE INTO channel_pins (channel_kind, channel_id, post_id, created_at) VALUES (?, ?, ?, ?)').bind(access.kind, access.id, postId, Date.now())
    : env.DB.prepare('DELETE FROM channel_pins WHERE channel_kind = ? AND channel_id = ? AND post_id = ?').bind(access.kind, access.id, postId)
  ).run();
  // Angepinnt = wichtig (F-449): benachrichtigt ab Stufe „Wichtiges“, wer zu diesem Beitrag noch nichts bekam. Außerhalb
  // des Heimatverlaufs nur öffentliche Beiträge (dort sehen ihn ohnehin nur die Mitglieder des Heimatverlaufs).
  if (body.pinned && access.kind !== 'user') {
    const p = await env.DB.prepare('SELECT kind, author_id, visibility, channel_kind, channel_id FROM posts WHERE id = ?').bind(postId)
      .first<{ kind: string; author_id: string; visibility: string; channel_kind: string; channel_id: string }>();
    const home = !!p && p.channel_kind === access.kind && p.channel_id === access.id;
    if (p && (home || p.visibility === 'public')) {
      await notifyPost(env, { id: postId, authorId: user.id, kind: p.kind, pinned: true, channel: { kind: access.kind, id: access.id }, visibility: p.visibility });
    }
  }
  return json({ pinned: body.pinned });
}
