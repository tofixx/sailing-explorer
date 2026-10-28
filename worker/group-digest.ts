// Wöchentliche Sammelmail „Was war los in deinem Verein“ (Konzept 11.7, F-165): opt-in, ab Sonntag aus dem nächtlichen
// Lauf, höchstens 20 Mails pro Lauf (Resend Free: 100/Tag für alles), nur Anzahlen – keine Texte, keine Namen.
import type { Env } from './env';
import { groupDigestMail, sendMail, type GroupDigestItem } from './mail';
import { GROUP_LIMITS } from '../src/domain/limits';
import { digestWeekStart } from '../src/domain/groups';

const DAY = 86_400_000;
interface CountRow {
  group_id: string;
  slug: string;
  name: string;
  kind: string;
  n: number;
}

/**
 * Neues der letzten 7 Tage je Gruppe eines Kontos – nur, was beim Lesen sichtbar wäre: Törns und Fotos nur, wenn der
 * Törn öffentlich und nicht ausgeblendet ist; Beiträge nicht ausgeblendet; keine Inhalte gesperrter Konten.
 */
const COUNTS_SQL = `SELECT g.id AS group_id, g.slug, g.name, a.kind,
    SUM(CASE WHEN a.kind = 'photos' THEN COALESCE(json_extract(a.data, '$.count'), 1) ELSE 1 END) AS n
  FROM group_members m
  JOIN groups g ON g.id = m.group_id AND g.hidden_at IS NULL
  JOIN activity_target t ON t.target_kind = 'group' AND t.target_id = g.id AND t.created_at > ?2 AND t.created_at <= ?3
  JOIN activity a ON a.id = t.activity_id
  LEFT JOIN users au ON au.id = a.actor_id
  LEFT JOIN shares s ON a.subject_kind = 'share' AND s.id = a.subject_id
  LEFT JOIN posts p ON a.subject_kind = 'post' AND p.id = a.subject_id
  WHERE m.user_id = ?1 AND m.muted_at IS NULL AND a.kind IN ('voyage', 'photos', 'post', 'member')
    AND (a.actor_id IS NULL OR au.suspended_at IS NULL)
    AND (a.kind NOT IN ('voyage', 'photos') OR (s.visibility = 'public' AND s.hidden_at IS NULL))
    AND (a.kind <> 'post' OR (p.id IS NOT NULL AND p.hidden_at IS NULL))
  GROUP BY g.id, a.kind
  ORDER BY g.name`;

/**
 * Nächtlich (Cron): ab Sonntag ist jedes Konto mit `weekly` einmal dran, das in dieser Woche noch keine Mail bekam –
 * höchstens 20 pro Lauf, der Rest in den folgenden Nächten. Ohne Neues keine Mail (zählt trotzdem als erledigt).
 */
export async function sendGroupDigests(env: Env, origin: string, now = Date.now()): Promise<number> {
  const { results: users } = await env.DB.prepare(
    `SELECT id, email, groups_mailed_at FROM users
     WHERE notify_groups = 'weekly' AND suspended_at IS NULL AND COALESCE(groups_mailed_at, 0) < ?
     ORDER BY COALESCE(groups_mailed_at, 0) LIMIT ?`,
  )
    .bind(digestWeekStart(now), GROUP_LIMITS.digestsPerRun * 5)
    .all<{ id: string; email: string; groups_mailed_at: number | null }>();
  let sent = 0;
  for (const u of users) {
    if (sent >= GROUP_LIMITS.digestsPerRun) break;
    const since = Math.max(now - 7 * DAY, u.groups_mailed_at ?? 0);
    const { results } = await env.DB.prepare(COUNTS_SQL).bind(u.id, since, now).all<CountRow>();
    const byGroup = new Map<string, GroupDigestItem>();
    for (const r of results) {
      const g = byGroup.get(r.group_id) ?? { name: r.name, path: `/g/${r.slug}`, voyages: 0, photos: 0, posts: 0, members: 0 };
      if (r.kind === 'voyage') g.voyages += r.n;
      else if (r.kind === 'photos') g.photos += r.n;
      else if (r.kind === 'post') g.posts += r.n;
      else if (r.kind === 'member') g.members += r.n;
      byGroup.set(r.group_id, g);
    }
    const groups = [...byGroup.values()].filter((g) => g.voyages + g.photos + g.posts + g.members > 0);
    if (groups.length) {
      try {
        await sendMail(env, groupDigestMail(env, u.email, origin, groups));
      } catch (err) {
        console.error('group digest failed', err); // nächste Nacht erneut
        continue;
      }
      sent++;
    }
    // Auch ohne Neues als erledigt markieren – sonst würde dasselbe Konto jede Nacht erneut abgefragt.
    await env.DB.prepare('UPDATE users SET groups_mailed_at = ? WHERE id = ?').bind(now, u.id).run();
  }
  return sent;
}
