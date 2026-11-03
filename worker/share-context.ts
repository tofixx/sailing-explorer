import type { Env } from './env';
import { membersVisibleSql } from './member-sql';
import { liveSql, publicSql } from './visible-sql';

/**
 * Wem gehört ein Törn und in welchen Gruppen ist er erschienen (F-228)? Beides nur, soweit der Betrachter es sehen
 * darf: das Profil nur, wenn es öffentlich und nicht ausgeblendet ist (wie „sailor“ in Entdecken, F-82) – der
 * Eigentümer sieht sein eigenes immer; Gruppen nur öffentliche bzw. solche, in denen der Betrachter Mitglied ist
 * (canViewGroup ohne Schlüssel), ausgeblendete nie. Die Gruppen sind die von der Eigentümer:in ausgewählten
 * (share_groups, F-373) – wie im Gruppen-Stream nur, solange der Törn öffentlich und nicht ausgeblendet ist.
 * Gesperrte Konten nennen weder Profil noch Gruppen (wie Entdecken). Gruppen mit Mitgliederliste „nur Mitglieder“ nennt der
 * Törn nur ihren Mitgliedern – sonst verriete er die Mitgliedschaft der Eigentümer:in (F-442, Konzept 24.7).
 * Das Boot (`boatPage`, F-533) nur, wenn der Betrachter dessen Seite öffnen darf: öffentlich und nicht ausgeblendet oder
 * er verwaltet es; gesperrte Boote nie, „Nur mit Link“ ohne Schlüssel nicht (fail closed, wie `getBoat`).
 */
export async function shareContext(
  env: Env,
  share: { id: string; user_id: string; visibility: string; hidden_at?: number | null; boat_id?: string | null },
  viewerId: string | null,
) {
  const isOwner = viewerId === share.user_id;
  const listed = share.visibility === 'public' && !share.hidden_at ? 1 : 0;
  const [sailor, groups, boat] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.handle, p.display_name FROM profiles p JOIN users u ON u.id = p.user_id AND u.suspended_at IS NULL
       WHERE p.user_id = ?1 AND (?2 OR ${publicSql('p')})`,
    ).bind(share.user_id, isOwner ? 1 : 0),
    env.DB.prepare(
      `SELECT g.slug, g.name, g.kind FROM share_groups sg
       JOIN groups g ON g.id = sg.group_id AND ${liveSql('g')}
       LEFT JOIN group_members m ON m.group_id = g.id AND m.user_id = ?2
       JOIN users u ON u.id = ?4 AND u.suspended_at IS NULL
       WHERE ?3 AND sg.share_id = ?1 AND (g.visibility = 'public' OR m.user_id IS NOT NULL) AND ${membersVisibleSql('g', '?2')}
       ORDER BY g.kind, g.name LIMIT 10`,
    ).bind(share.id, viewerId, listed, share.user_id),
    env.DB.prepare(
      `SELECT b.id, b.name FROM boats b LEFT JOIN boat_admins a ON a.boat_id = b.id AND a.user_id = ?2
       WHERE b.id = ?1 AND b.locked_at IS NULL
         AND ((b.visibility = 'public' AND b.hidden_at IS NULL) OR b.owner_id = ?2 OR a.user_id IS NOT NULL)`,
    ).bind(share.boat_id ?? null, viewerId),
  ]);
  const p = (sailor.results as { handle: string; display_name: string }[])[0];
  const b = (boat.results as { id: string; name: string }[])[0];
  return {
    boatPage: b ? { id: b.id, name: b.name } : null,
    sailor: p ? { handle: p.handle, displayName: p.display_name } : null,
    groups: (groups.results as { slug: string; name: string; kind: string }[]).map((g) => ({ slug: g.slug, name: g.name, kind: g.kind })),
  };
}
