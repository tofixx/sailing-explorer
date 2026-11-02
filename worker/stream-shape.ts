// Prüfung einer Aktivität beim Lesen (Konzept 11.3, F-160) – rein, ohne Worker-APIs, damit unit-testbar.
import { memberAlias } from '../src/domain/names';
import { canManageGroup, canSeeMembers, canSeeMembership, isActivityKind, type GroupKind, type GroupRole, type StreamItem } from '../src/domain/groups';
import { coverRef } from '../src/domain/cover';
import { timingSafeEqual } from './validate';
import { canSeePost, isChannelKind, isPostVisibility, isReach, reachCovers, type ChannelKind, type PostVisibility, type Reach } from '../src/domain/posts';

/** Eine Aktivität samt allem, was die Prüfung braucht (ein Batch, LEFT JOINs). */
export interface ActivityRow {
  id: string;
  kind: string;
  actor_id: string | null;
  subject_kind: string;
  subject_id: string;
  group_id: string | null;
  data: string;
  created_at: number;
  actor_handle: string | null;
  actor_name: string | null;
  actor_public: number | null;
  actor_suspended: number | null;
  actor_exists: number | null;
  s_id: string | null;
  s_title: string | null;
  s_dist: number | null;
  s_started: number | null;
  s_image: number | null;
  s_vis: string | null;
  s_hidden: number | null;
  /** gpx | manual (Fahrtenbuch, 0025) */
  s_source?: string | null;
  b_id: string | null;
  b_name: string | null;
  b_vis: string | null;
  b_hidden: number | null;
  /** Eigner des Boots gesperrt – Boot erscheint dann nicht (wie auf /entdecken) */
  b_owner_suspended?: number | null;
  g_id: string | null;
  g_slug: string | null;
  g_name: string | null;
  g_kind: string | null;
  g_vis: string | null;
  g_hidden: number | null;
  g_role: string | null;
  /** wer die Mitgliederliste sieht (0032, F-440) */
  g_members?: string | null;
  /** Eigner der Gruppe gesperrt – dann ohne Titelbild (wie auf /entdecken nicht gelistet) */
  g_owner_suspended?: number | null;
  p_id: string | null;
  p_body: string | null;
  p_link: string | null;
  p_hidden: number | null;
  p_author: string | null;
  /** Sichtbarkeit und Reichweite des Beitrags (0029, Konzept 21) */
  p_vis?: string | null;
  p_reach?: string | null;
  /** Heimatverlauf des Beitrags, Schlüssel „Nur mit Link“ (Phase 2, F-406, F-425) */
  p_ck?: string | null;
  p_cid?: string | null;
  p_key?: string | null;
  /** Hafen- bzw. Boots-Verlauf des Beitrags */
  ph_slug?: string | null;
  ph_name?: string | null;
  ph_hidden?: number | null;
  pb_name?: string | null;
  pb_vis?: string | null;
  pb_hidden?: number | null;
  pb_owner_suspended?: number | null;
  /** angehängter Törn (F-426) */
  ps_id?: string | null;
  ps_title?: string | null;
  ps_dist?: number | null;
  ps_vis?: string | null;
  ps_hidden?: number | null;
  ps_locked?: number | null;
  ps_owner?: string | null;
  ps_reach?: string | null;
  /** „Sichtbar bis“ des Törns (F-427) */
  s_reach?: string | null;
  /** Hafen bei `harbor` (Konzept 12.4) */
  h_slug?: string | null;
  h_name?: string | null;
  h_hidden?: number | null;
  /** Titelbilder (Version, Ausschnitt) von Boot, handelnder Person und Gruppe (Konzept 13.2) */
  cb_ver?: string | null;
  cb_y?: number | null;
  cu_ver?: string | null;
  cu_y?: number | null;
  cg_ver?: string | null;
  cg_y?: number | null;
}

/** Sichtbarer Eintrag eines Fahrtenbuch-Bündels */
export interface LogShare {
  id: string;
  title: string;
  distNm: number;
}

/** Törn-IDs eines Fahrtenbuch-Bündels aus `data.ids` (Unbekanntes fällt weg). */
export function logbookIds(data: string): string[] {
  try {
    const ids = (JSON.parse(data) as { ids?: unknown }).ids;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Wo gelesen wird (F-409): Stream einer Gruppe (mit ihrem Verein), eines Hafens, eines Boots oder die Community
 * („Alles“, „Umgebung“). Fehlt es (persönlicher Stream), entscheiden die beim Schreiben angeglichenen Ziele.
 */
export type ReadAt =
  | { kind: 'group'; id: string; parentId: string | null }
  | { kind: 'harbor'; id: string }
  | { kind: 'boat'; id: string }
  | { kind: 'community' }
  /** einzelne Karte über `/p/<id>` (F-406) */
  | { kind: 'single' };

export interface Viewer {
  id: string | null;
  at?: ReadAt;
  /** Schlüssel aus `/p/<id>/<schlüssel>` (nur Einzelansicht) */
  postKey?: string | null;
}

/** Stufe, die ein Verlauf für ausgebreitete Beiträge bzw. Törns verlangt (Gruppe = Verein, Hafen, Community). */
const levelOf = (at: ReadAt): Reach | null => (at.kind === 'group' ? 'club' : at.kind === 'harbor' ? 'harbor' : at.kind === 'community' ? 'all' : null);

const publicBoat = (r: ActivityRow) => (r.b_id && r.b_vis === 'public' && !r.b_hidden && !r.b_owner_suspended ? { id: r.b_id, name: r.b_name ?? '' } : null);

/** Titelbilder nur öffentlicher Objekte – die Adresse kommt ohne Schlüssel aus und ist cachebar. */
const boatCover = (r: ActivityRow) => (publicBoat(r) ? coverRef('b', r.b_id!, r.cb_ver, r.cb_y) : null);
const groupCover = (r: ActivityRow) => (r.g_id && r.g_vis === 'public' && !r.g_hidden && !r.g_owner_suspended ? coverRef('g', r.g_id, r.cg_ver, r.cg_y) : null);
/** `cover` nur setzen, wenn es eins gibt (kein `cover: null` in der Antwort). */
const withCover = <T extends StreamItem>(item: T, cover: StreamItem['cover'] | null): T => (cover ? { ...item, cover } : item);

/** Gruppe für den Betrachter sichtbar? Öffentlich oder Mitglied; ausgeblendet nur für Eigner/Admins. */
function groupVisible(r: ActivityRow): boolean {
  if (!r.g_id) return false;
  const role = (r.g_role as GroupRole | null) ?? null;
  if (r.g_hidden && !canManageGroup(role)) return false;
  return r.g_vis === 'public' || role !== null;
}

/**
 * Beitrag (F-402, F-406, F-409, F-420, F-425, F-426): Sichtbarkeit wie überall, ausgeblendete nie im Stream. Außerhalb
 * des Heimatverlaufs (Ausbreitung nach oben) nur, solange Beitrag und Heimatverlauf öffentlich sind und „Sichtbar bis“
 * die Stufe des lesenden Verlaufs abdeckt; Vereinsbeiträge in ihren Teams wie bisher ohne Stufe. Der angehängte Törn
 * erscheint nur, wenn der Lesende ihn sehen darf.
 */
function shapePost(r: ActivityRow, viewer: Viewer, base: StreamItem, group: StreamItem['group'], actor: StreamItem['actor']): StreamItem | null {
  if (!r.p_id || r.p_hidden || !isPostVisibility(r.p_vis ?? 'public')) return null;
  const visibility = (r.p_vis ?? 'public') as PostVisibility;
  const channel: ChannelKind = isChannelKind(r.p_ck) ? r.p_ck : r.group_id ? 'group' : 'user';
  const role = (r.g_role as GroupRole | null) ?? null;
  const isAuthor = !!viewer.id && viewer.id === r.p_author;
  const at = viewer.at;
  const atHome = !!at && 'id' in at && at.kind === channel && at.id === r.p_cid;
  const boatPublic = r.pb_vis === 'public' && !r.pb_hidden && !r.pb_owner_suspended;
  const where: NonNullable<StreamItem['post']>['where'] =
    channel === 'harbor' && r.ph_slug && !r.ph_hidden ? { kind: 'harbor', slug: r.ph_slug, name: r.ph_name ?? '' }
    : channel === 'boat' && r.p_cid && r.pb_name !== null && r.pb_name !== undefined && (boatPublic || atHome || isAuthor) ? { kind: 'boat', id: r.p_cid, name: r.pb_name }
    : undefined;
  const channelVisible = channel === 'group' ? !!group : channel === 'user' ? true : !!where;
  const keyOk = !!r.p_key && !!viewer.postKey && timingSafeEqual(viewer.postKey, r.p_key);
  const visible = canSeePost(
    { visibility, channel, hidden: false, authorSuspended: false, authorPublic: !!actor },
    // die Autor:in sieht eigene Beiträge in jedem Verlauf (auch `/p/<id>`), solange es ihn für sie gibt (K2)
    { isAuthor, channelVisible, isMember: role !== null, keyOk },
  );
  if (!visible || (channel === 'group' && !group)) return null;
  const reach = isReach(r.p_reach) ? r.p_reach : 'here';
  if (at && at.kind !== 'single' && !atHome) {
    const homePublic = channel === 'group' ? r.g_vis === 'public' && !r.g_hidden : channel === 'boat' ? boatPublic : channel === 'harbor' ? !!where : !!actor;
    if (visibility !== 'public' || !homePublic) return null;
    // Vereinsbeiträge in den Teams des Vereins (Konzept 11.4) – nach unten, ohne Stufe
    const downward = at.kind === 'group' && channel === 'group' && !!at.parentId && r.p_cid === at.parentId;
    const lvl = levelOf(at);
    if (!downward && (!lvl || !reachCovers(reach, lvl))) return null;
  }
  const canDelete = isAuthor || (channel === 'group' && canManageGroup(role));
  // angehängter Törn (F-426): öffentlich und sein eigenes „Sichtbar bis“ deckt die Stufe, in der der Beitrag gerade
  // erscheint (fail closed) – oder der eigene
  const level = at && !atHome && at.kind !== 'single' ? levelOf(at) : null;
  const attachOk = r.ps_vis === 'public' && !r.ps_hidden && (!level || reachCovers(isReach(r.ps_reach) ? r.ps_reach : 'all', level));
  const attached =
    r.ps_id && !r.ps_locked && (attachOk || (!!viewer.id && viewer.id === r.ps_owner)) ? { id: r.ps_id, title: r.ps_title ?? '', distNm: r.ps_dist ?? 0 } : null;
  const path = keyOk && visibility === 'unlisted' ? `/p/${r.p_id}/${r.p_key}` : `/p/${r.p_id}`;
  return {
    ...base,
    group,
    post: { id: r.p_id, body: r.p_body ?? '', link: r.p_link, canDelete, visibility, reach, path, ...(where ? { where } : {}), voyage: attached },
  };
}

/**
 * Prüft eine Aktivität gegen den aktuellen Stand und formt den Eintrag – oder null (Konzept 11.3, Tabelle „Erscheint nur,
 * wenn …“). Rein, damit unit-testbar. `thumbs`: öffentliche Fotos des Törns (für `photos`).
 */
export function shapeItem(r: ActivityRow, viewer: Viewer, thumbs: string[] = [], logShares: LogShare[] = []): StreamItem | null {
  if (!isActivityKind(r.kind)) return null;
  // Inhalte gesperrter oder gelöschter Konten verschwinden (Konzept 4.4).
  if (r.actor_id && (!r.actor_exists || r.actor_suspended)) return null;
  const actor = r.actor_id && r.actor_public && r.actor_handle ? { handle: r.actor_handle, displayName: r.actor_name ?? '' } : null;
  const group = r.g_id && groupVisible(r) ? { slug: r.g_slug ?? '', name: r.g_name ?? '', kind: (r.g_kind as GroupKind) ?? 'club' } : null;
  const base = { id: r.id, kind: r.kind, createdAt: r.created_at, actor, group: null as StreamItem['group'] };
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(r.data) as Record<string, unknown>;
  } catch {
    data = {};
  }

  switch (r.kind) {
    case 'voyage':
    case 'photos': {
      // Nur jetzt öffentliche, nicht ausgeblendete Törns – privat geschaltet, ausgeblendet oder gelöscht: weg.
      if (!r.s_id || r.s_vis !== 'public' || r.s_hidden) return null;
      if (r.kind === 'photos' && !thumbs.length) return null;
      // „Sichtbar bis“ (F-427): Hafen und Community prüfen die Stufe beim Lesen; Gruppen folgen Auswahl und Zielen
      const lvl = viewer.at && viewer.at.kind !== 'group' ? levelOf(viewer.at) : null;
      if (lvl && !reachCovers(isReach(r.s_reach) ? r.s_reach : 'all', lvl)) return null;
      const voyage = {
        id: r.s_id, title: r.s_title ?? '', distNm: r.s_dist ?? 0, startedAt: r.s_started, hasImage: !!r.s_image, boat: publicBoat(r),
        ...(r.s_source === 'manual' ? { logbook: true } : {}),
      };
      if (r.kind === 'voyage') return { ...base, voyage };
      const count = Math.max(1, Math.floor(Number(data.count) || 1));
      return { ...base, voyage, photos: { count, thumbs: thumbs.slice(0, 4) } };
    }
    case 'member':
      // Beitritte sehen nur Mitglieder derselben Gruppe (F-443) – Gäste, Follower und Mitglieder des Vereins eines
      // Teams nie; damit auch nie in öffentlichen Caches, RSS, „Alles“ und „Umgebung“ (ohne Betrachter berechnet).
      if (!group || !canSeeMembership((r.g_role as GroupRole | null) ?? null)) return null;
      // Ohne öffentliches Profil der Spaßname dieser Gruppe (F-349, F-441) – nie der gewählte Anzeigename
      return withCover({ ...base, group, ...(!actor && r.actor_id && r.g_id ? { alias: memberAlias(r.actor_id, r.g_id) } : {}) }, actor ? coverRef('u', actor.handle, r.cu_ver, r.cu_y) : null);
    case 'boat': {
      const boat = publicBoat(r);
      // Boote der Gruppe folgen der Mitgliederliste (F-442): ein Boot verrät seinen Eigner
      if (!group || !boat || !canSeeMembers(r.g_members, (r.g_role as GroupRole | null) ?? null)) return null;
      return withCover({ ...base, group, boat }, boatCover(r));
    }
    case 'post':
      return shapePost(r, viewer, base, group, actor);
    case 'milestone': {
      const nm = Number(data.nm) || 0;
      const year = Number(data.year) || 0;
      if (r.subject_kind === 'user') {
        if (!actor) return null; // nur mit öffentlichem Profil
        return withCover({ ...base, milestone: { nm, year, subject: 'user', name: actor.displayName, path: `/u/${actor.handle}` } }, coverRef('u', actor.handle, r.cu_ver, r.cu_y));
      }
      if (r.subject_kind === 'boat') {
        const boat = publicBoat(r);
        if (!boat) return null;
        return withCover({ ...base, actor: null, boat, milestone: { nm, year, subject: 'boat', name: boat.name, path: `/b/${boat.id}` } }, boatCover(r));
      }
      if (!group) return null;
      return withCover({ ...base, actor: null, group, milestone: { nm, year, subject: 'group', name: group.name, path: `/g/${group.slug}` } }, groupCover(r));
    }
    case 'logbook': {
      // Nachträge (F-308): nur die jetzt öffentlichen Einträge des Bündels; keiner mehr da → weg.
      if (!actor || !logShares.length) return null;
      const distNm = logShares.reduce((s, x) => s + x.distNm, 0);
      return { ...base, logbook: { count: logShares.length, distNm, voyages: logShares.slice(0, 5).map(({ id, title }) => ({ id, title })) } };
    }
    case 'harbor': {
      // Neues Boot im Hafen: nur öffentliches Boot und nicht ausgeblendeter Hafen.
      const boat = publicBoat(r);
      if (!boat || !r.h_slug || r.h_hidden) return null;
      return withCover({ ...base, boat, harbor: { slug: r.h_slug, name: r.h_name ?? '' } }, boatCover(r));
    }
  }
  return null;
}

