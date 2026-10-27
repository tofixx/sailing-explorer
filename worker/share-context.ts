import type { Env } from './env';

/**
 * Wem gehört ein Törn und in welchen Gruppen ist er erschienen (F-228)? Beides nur, soweit der Betrachter es sehen
 * darf: das Profil nur, wenn es öffentlich und nicht ausgeblendet ist (wie „sailor“ in Entdecken, F-82) – der
 * Eigentümer sieht sein eigenes immer; Gruppen nur öffentliche bzw. solche, in denen der Betrachter Mitglied ist
 * (canViewGroup ohne Schlüssel), ausgeblendete nie. Die Gruppen kommen aus dem Publikum der Törn-Aktivität
 * (worker/activity.ts: Gruppen des Seglers und des Boots beim Veröffentlichen).
 */
export async function shareContext(env: Env, share: { id: string; user_id: string }, viewerId: string | null) {
  const isOwner = viewerId === share.user_id;
  const [sailor, groups] = await env.DB.batch([
    env.DB.prepare(
      `SELECT handle, display_name FROM profiles WHERE user_id = ?1 AND (?2 OR (visibility = 'public' AND hidden_at IS NULL))`,
    ).bind(share.user_id, isOwner ? 1 : 0),
    env.DB.prepare(
      `SELECT DISTINCT g.slug, g.name, g.kind FROM activity a
       JOIN activity_target t ON t.activity_id = a.id AND t.target_kind = 'group'
       JOIN groups g ON g.id = t.target_id AND g.hidden_at IS NULL
       LEFT JOIN group_members m ON m.group_id = g.id AND m.user_id = ?2
       WHERE a.bucket = 'voyage:' || ?1 AND (g.visibility = 'public' OR m.user_id IS NOT NULL)
       ORDER BY g.kind, g.name LIMIT 10`,
    ).bind(share.id, viewerId),
  ]);
  const p = (sailor.results as { handle: string; display_name: string }[])[0];
  return {
    sailor: p ? { handle: p.handle, displayName: p.display_name } : null,
    groups: (groups.results as { slug: string; name: string; kind: string }[]).map((g) => ({ slug: g.slug, name: g.name, kind: g.kind })),
  };
}
