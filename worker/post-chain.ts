// Verläufe zum Schreiben (Konzept 21.4, 21.7, F-405, F-409, F-425): wer wohin schreiben darf und die Ausbreitungskette
// je Verlauf, beim Schreiben aufgelöst (Verein des Teams, Heimathafen, Hafen des Boots). Reine Regeln in
// src/domain/posts.ts; hier nur die Abfragen. Ohne Abhängigkeit zu posts.ts, damit es dort importiert werden kann.
import type { Env } from './env';
import { isAdmin } from './moderation';
import type { GroupKind, GroupRole } from '../src/domain/groups';
import {
  canChoosePostVisibility, canWriteInGroup, canWriteInHarbor, canWriteOnBoat, effectivePostBy, postVisibilityChoices, reachOptions,
  type ChannelKind, type ChannelRef, type ComposeTarget, type ReachChain,
} from '../src/domain/posts';
import { liveSql, publicSql } from './visible-sql';

/** Ein Verlauf, in den das Konto gerade schreiben darf – mit Kette und Gruppe (für `posts.group_id`). */
export interface WritableChannel {
  kind: ChannelKind;
  id: string;
  ref: ChannelRef;
  chain: ReachChain;
  groupId: string | null;
}

interface GroupChainRow {
  id: string;
  slug: string;
  name: string;
  kind: GroupKind;
  visibility: string;
  hidden_at: number | null;
  post_by: string | null;
  role: GroupRole | null;
  c_id: string | null;
  c_name: string | null;
  h_id: string | null;
  h_name: string | null;
}

/** Gruppen mit Kette: Verein des Teams (nicht ausgeblendet/gesperrt), Heimathafen des Vereins bzw. der Gruppe. `?1` Konto. */
const GROUP_CHAIN_SQL = `SELECT g.id, g.slug, g.name, g.kind, g.visibility, g.hidden_at, g.post_by,
    (SELECT role FROM group_members WHERE group_id = g.id AND user_id = ?1) AS role,
    c.id AS c_id, c.name AS c_name, h.id AS h_id, h.name AS h_name
  FROM groups g
  LEFT JOIN groups c ON g.kind = 'team' AND c.id = g.parent_id AND ${liveSql('c')}
  LEFT JOIN harbors h ON h.id = COALESCE(c.harbor_id, g.harbor_id) AND h.hidden_at IS NULL
  WHERE ${liveSql('g')}`;

const groupChannel = (r: GroupChainRow): WritableChannel => ({
  kind: 'group',
  id: r.id,
  ref: { kind: 'group', slug: r.slug, name: r.name, groupKind: r.kind },
  chain: { home: r.name, club: r.c_id ? { id: r.c_id, name: r.c_name ?? '' } : null, harbor: r.h_id ? { id: r.h_id, name: r.h_name ?? '' } : null, open: r.visibility === 'public' },
  groupId: r.id,
});

interface BoatChainRow {
  id: string;
  name: string;
  visibility: string;
  hidden_at: number | null;
  h_id: string | null;
  h_name: string | null;
}

/** Boote mit Hafen; `?1` Konto – nur eigene bzw. verwaltete, nicht gesperrte. */
const BOAT_CHAIN_SQL = `SELECT b.id, b.name, b.visibility, b.hidden_at, h.id AS h_id, h.name AS h_name,
    CASE WHEN b.owner_id = ?1 THEN 'owner' ELSE 'admin' END AS role FROM boats b
  LEFT JOIN harbors h ON h.id = b.harbor_id AND h.hidden_at IS NULL
  WHERE b.locked_at IS NULL AND (b.owner_id = ?1 OR EXISTS (SELECT 1 FROM boat_admins a WHERE a.boat_id = b.id AND a.user_id = ?1))`;

const boatChannel = (r: BoatChainRow): WritableChannel => ({
  kind: 'boat',
  id: r.id,
  ref: { kind: 'boat', id: r.id, name: r.name },
  // Hafen des Boots nur bei öffentlichem Boot – sonst verriete der Hafen-Stream den Hafen eines nicht öffentlichen Boots
  chain: { home: r.name, club: null, harbor: r.h_id ? { id: r.h_id, name: r.h_name ?? '' } : null, open: r.visibility === 'public' && !r.hidden_at },
  groupId: null,
});

const harborChannel = (h: { id: string; slug: string; name: string }): WritableChannel => ({
  kind: 'harbor',
  id: h.id,
  ref: { kind: 'harbor', slug: h.slug, name: h.name },
  chain: { home: `Hafen ${h.name}`, club: null, harbor: null, open: true },
  groupId: null,
});

/** Häfen, in denen das Konto ein Boot hat (Eigner oder Boots-Admin, B6) bzw. die es angelegt hat oder vertritt. `?1` Konto. */
const HARBORS_SQL = `SELECT h.id, h.slug, h.name FROM harbors h WHERE h.hidden_at IS NULL AND (h.created_by = ?1 OR h.id IN (
    SELECT b.harbor_id FROM boats b WHERE b.locked_at IS NULL AND (b.owner_id = ?1 OR EXISTS (SELECT 1 FROM boat_admins a WHERE a.boat_id = b.id AND a.user_id = ?1))))`;

async function profileChannel(env: Env, userId: string): Promise<WritableChannel> {
  const r = await env.DB.prepare(
    `SELECT h.id AS h_id, h.name AS h_name, (${publicSql('p')}) AS open
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN harbors h ON h.id = u.home_harbor_id AND h.hidden_at IS NULL WHERE u.id = ?`,
  )
    .bind(userId)
    .first<{ h_id: string | null; h_name: string | null; open: number | null }>();
  return {
    kind: 'user',
    id: userId,
    ref: { kind: 'user' },
    // Umgebung über den Heimathafen der Person (21.7)
    chain: { home: 'dein Profil', club: null, harbor: r?.h_id ? { id: r.h_id, name: r.h_name ?? '' } : null, open: !!r?.open },
    groupId: null,
  };
}

/**
 * Darf das Konto in diesen Verlauf schreiben? Liefert ihn samt Kette – sonst null (der Aufrufer antwortet fail closed
 * mit 403 bzw. 404). Gruppe: `post_by` (B3); Hafen: Boot dort, Anleger:in bzw. Vertretung, Moderation (B6); Boot:
 * Eigner und Boots-Admins; Profil: nur das eigene.
 */
export async function writableChannel(env: Env, userId: string, kind: ChannelKind, id: string): Promise<WritableChannel | null> {
  switch (kind) {
    case 'user':
      return id === userId || id === '' ? profileChannel(env, userId) : null;
    case 'group': {
      const r = await env.DB.prepare(`${GROUP_CHAIN_SQL} AND g.id = ?2`).bind(userId, id).first<GroupChainRow>();
      return r && canWriteInGroup(r.role, effectivePostBy(r.kind, r.post_by)) ? groupChannel(r) : null;
    }
    case 'boat': {
      const r = await env.DB.prepare(`${BOAT_CHAIN_SQL} AND b.id = ?2`).bind(userId, id).first<BoatChainRow & { role: 'owner' | 'admin' }>();
      return r && canWriteOnBoat(r.role) ? boatChannel(r) : null;
    }
    case 'harbor': {
      const h = await env.DB.prepare('SELECT id, slug, name, created_by FROM harbors WHERE id = ? AND hidden_at IS NULL').bind(id).first<{ id: string; slug: string; name: string; created_by: string | null }>();
      if (!h) return null;
      const hasBoat = !!(await env.DB.prepare(`${HARBORS_SQL} AND h.id = ?2`).bind(userId, h.id).first());
      return canWriteInHarbor({ hasBoat, isCreator: h.created_by === userId, isAdmin: isAdmin(env, userId) }) ? harborChannel(h) : null;
    }
  }
}

/** Kette eines bestehenden Verlaufs (beim Ändern von Sichtbarkeit bzw. „Sichtbar bis“) – unabhängig vom Schreibrecht. */
export async function chainOf(env: Env, authorId: string, kind: ChannelKind, id: string): Promise<ReachChain | null> {
  switch (kind) {
    case 'user':
      return (await profileChannel(env, authorId)).chain;
    case 'group': {
      const r = await env.DB.prepare(`${GROUP_CHAIN_SQL} AND g.id = ?2`).bind(authorId, id).first<GroupChainRow>();
      return r ? groupChannel(r).chain : null;
    }
    case 'boat': {
      const r = await env.DB.prepare(
        `SELECT b.id, b.name, b.visibility, b.hidden_at, h.id AS h_id, h.name AS h_name FROM boats b
         LEFT JOIN harbors h ON h.id = b.harbor_id AND h.hidden_at IS NULL WHERE b.id = ? AND b.locked_at IS NULL`,
      )
        .bind(id)
        .first<BoatChainRow>();
      // (kein Schreibrecht nötig: die Autor:in ändert nur ihren eigenen Beitrag)
      return r ? boatChannel(r).chain : null;
    }
    case 'harbor': {
      const h = await env.DB.prepare('SELECT id, slug, name FROM harbors WHERE id = ? AND hidden_at IS NULL').bind(id).first<{ id: string; slug: string; name: string }>();
      return h ? harborChannel(h).chain : null;
    }
  }
}

/** Alle Verläufe, in die das Konto schreiben darf (F-405): Profil, Gruppen (B3), Häfen (B6), Boote – je höchstens 50. */
export async function writableChannels(env: Env, userId: string): Promise<WritableChannel[]> {
  const [groups, harbors, boats] = await env.DB.batch([
    env.DB.prepare(`${GROUP_CHAIN_SQL} AND g.id IN (SELECT group_id FROM group_members WHERE user_id = ?1) ORDER BY g.kind, g.name LIMIT 50`).bind(userId),
    env.DB.prepare(`${HARBORS_SQL} ORDER BY h.name LIMIT 50`).bind(userId),
    env.DB.prepare(`${BOAT_CHAIN_SQL} ORDER BY b.name LIMIT 50`).bind(userId),
  ]);
  return [
    await profileChannel(env, userId),
    ...(groups.results as unknown as GroupChainRow[]).filter((r) => canWriteInGroup(r.role, effectivePostBy(r.kind, r.post_by))).map(groupChannel),
    ...(harbors.results as unknown as Array<{ id: string; slug: string; name: string }>).map(harborChannel),
    ...(boats.results as unknown as BoatChainRow[]).map(boatChannel),
  ];
}

/** Ein Verlauf für das Formular: Stufen „Wer sieht es“ (nur wählbare, E1/B4) und „Sichtbar bis“ mit Kette. */
export const composeTarget = (c: WritableChannel, supporter: boolean): ComposeTarget => ({
  ref: c.ref,
  id: c.kind === 'user' ? '' : c.id,
  choices: postVisibilityChoices(c.kind).filter((v) => canChoosePostVisibility(v, supporter)),
  reaches: reachOptions(c.chain),
});
