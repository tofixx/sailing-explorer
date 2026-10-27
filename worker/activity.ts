// Aktivitäts-Log (Konzept 11.3): eine Zeile `activity` je Ereignis, eine Zeile `activity_target` je Publikum –
// nie eine Zeile pro Mitglied oder Follower. Die Zeilen sind nur ein Index: Sichtbarkeit prüft worker/stream.ts beim
// Lesen. Protokolliert werden nur öffentliche Törns (private stehen gar nicht erst im Log).
// Bewusst ohne Abhängigkeit zu shares/groups/boats, damit diese Module es importieren können.
import type { Env } from './env';
import { randomId } from './crypto';
import { crossedMilestones, dayKey, seasonOf, type ActivityKind } from '../src/domain/groups';
import { deleteBoatReactions, deleteGroupReactions, nightlyReactionCleanup, userReactionCleanup } from './reaction-cleanup';
import { groupNotificationCleanup, nightlyNotificationCleanup, userNotificationCleanup } from './notification-cleanup';

type TargetKind = 'group' | 'boat' | 'user' | 'harbor';

interface NewActivity {
  kind: ActivityKind;
  actorId: string | null;
  subjectKind: 'share' | 'group' | 'boat' | 'post' | 'user';
  subjectId: string;
  groupId?: string | null;
  data?: Record<string, unknown>;
  /** eindeutiger Schlüssel: Bündeln bzw. „nur einmal“ */
  bucket?: string | null;
}

const insertStmt = (env: Env, id: string, a: NewActivity, now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO activity (id, kind, actor_id, subject_kind, subject_id, group_id, data, bucket, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, a.kind, a.actorId, a.subjectKind, a.subjectId, a.groupId ?? null, JSON.stringify(a.data ?? {}), a.bucket ?? null, now, now);

/** Ziel nur eintragen, wenn die Aktivität in diesem Batch wirklich entstand (bei doppeltem bucket nicht). */
const targetStmt = (env: Env, id: string, kind: TargetKind, targetId: string, now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
     SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM activity WHERE id = ?1)`,
  ).bind(id, kind, targetId, now);

/** Ziele „alle Gruppen eines Boots“ bzw. „alle Gruppen eines Kontos“ – per SQL, ohne vorher zu lesen. */
const boatGroupsStmt = (env: Env, id: string, boatId: string, now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
     SELECT ?1, 'group', group_id, ?3 FROM group_boats WHERE boat_id = ?2 AND EXISTS (SELECT 1 FROM activity WHERE id = ?1)`,
  ).bind(id, boatId, now);
const userGroupsStmt = (env: Env, id: string, userId: string, now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
     SELECT ?1, 'group', group_id, ?3 FROM group_members WHERE user_id = ?2 AND EXISTS (SELECT 1 FROM activity WHERE id = ?1)`,
  ).bind(id, userId, now);
/**
 * Ziel „Hafen des Boots“ (Konzept 12.4) – nur für öffentliche, nicht ausgeblendete Boote, sonst verriete der
 * Hafen-Stream den Hafen eines nicht öffentlichen Boots. Die Hafenseite prüft beim Lesen zusätzlich.
 */
const boatHarborStmt = (env: Env, id: string, boatId: string, now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
     SELECT ?1, 'harbor', harbor_id, ?3 FROM boats WHERE id = ?2 AND harbor_id IS NOT NULL AND visibility = 'public' AND hidden_at IS NULL
       AND EXISTS (SELECT 1 FROM activity WHERE id = ?1)`,
  ).bind(id, boatId, now);
/** Vereinsbeiträge erscheinen auch in den Teams des Vereins. */
const teamsStmt = (env: Env, id: string, groupId: string, now: number) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
     SELECT ?1, 'group', id, ?3 FROM groups WHERE parent_id = ?2 AND EXISTS (SELECT 1 FROM activity WHERE id = ?1)`,
  ).bind(id, groupId, now);

/** Fehler im Log dürfen die eigentliche Aktion (Upload, Beitritt …) nie scheitern lassen. */
async function safely(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`activity ${what} failed`, err);
  }
}

export interface ShareForActivity {
  id: string;
  user_id: string;
  boat_id: string | null;
  dist_nm: number;
  started_at: number | null;
  created_at: number;
}

/** Publikum eines Törns: Segler, Boot, Hafen des Boots, Gruppen des Boots und des Seglers. */
function shareTargets(env: Env, id: string, s: ShareForActivity, now: number): D1PreparedStatement[] {
  return [
    targetStmt(env, id, 'user', s.user_id, now),
    ...(s.boat_id ? [targetStmt(env, id, 'boat', s.boat_id, now), boatGroupsStmt(env, id, s.boat_id, now), boatHarborStmt(env, id, s.boat_id, now)] : []),
    userGroupsStmt(env, id, s.user_id, now),
  ];
}

/** Ein Törn ist (neu) öffentlich: einmal je Törn protokollieren, danach Meilensteine prüfen. */
export async function recordVoyage(env: Env, s: ShareForActivity, now = Date.now()): Promise<void> {
  await safely('voyage', async () => {
    const id = randomId();
    await env.DB.batch([
      insertStmt(env, id, { kind: 'voyage', actorId: s.user_id, subjectKind: 'share', subjectId: s.id, bucket: `voyage:${s.id}` }, now),
      ...shareTargets(env, id, s, now),
    ]);
    await recordMilestones(env, s, now);
  });
}

/** Fotos zu einem öffentlichen Törn: gebündelt „n neue Fotos“ je Törn und Tag. */
export async function recordPhotos(env: Env, s: ShareForActivity, count = 1, now = Date.now()): Promise<void> {
  await safely('photos', async () => {
    const id = randomId();
    const bucket = `photos:${s.id}:${dayKey(now)}`;
    await env.DB.batch([
      // Gibt es das Bündel schon, nur hochzählen – das folgende INSERT scheitert dann am eindeutigen bucket.
      env.DB.prepare(`UPDATE activity SET data = json_set(data, '$.count', COALESCE(json_extract(data, '$.count'), 0) + ?), updated_at = ? WHERE bucket = ?`).bind(count, now, bucket),
      insertStmt(env, id, { kind: 'photos', actorId: s.user_id, subjectKind: 'share', subjectId: s.id, data: { count }, bucket }, now),
      ...shareTargets(env, id, s, now),
    ]);
  });
}

/** Neues Mitglied (Einladung oder Anfrage angenommen). */
export async function recordMember(env: Env, groupId: string, userId: string, now = Date.now()): Promise<void> {
  await safely('member', async () => {
    const id = randomId();
    await env.DB.batch([
      insertStmt(env, id, { kind: 'member', actorId: userId, subjectKind: 'group', subjectId: groupId, groupId, bucket: `member:${groupId}:${userId}` }, now),
      targetStmt(env, id, 'group', groupId, now),
    ]);
  });
}

/** Boot einer Gruppe zugeordnet (einmal je Gruppe und Boot – Entfernen und erneutes Zuordnen erzeugt nichts Neues). */
export async function recordBoat(env: Env, groupId: string, boatId: string, actorId: string, now = Date.now()): Promise<void> {
  await safely('boat', async () => {
    const id = randomId();
    await env.DB.batch([
      insertStmt(env, id, { kind: 'boat', actorId, subjectKind: 'boat', subjectId: boatId, groupId, bucket: `boat:${groupId}:${boatId}` }, now),
      targetStmt(env, id, 'group', groupId, now),
      targetStmt(env, id, 'boat', boatId, now),
    ]);
  });
}

/**
 * Boot bekommt einen Hafen (Konzept 12.4): einmal je Hafen und Boot „Neues Boot im Hafen“, Ziele Hafen und Boot.
 * Der Hafen steht in `data.harbor`; sichtbar nur bei öffentlichem Boot und nicht ausgeblendetem Hafen (beim Lesen).
 */
export async function recordHarborBoat(env: Env, harborId: string, boatId: string, actorId: string, now = Date.now()): Promise<void> {
  await safely('harbor', async () => {
    const id = randomId();
    await env.DB.batch([
      insertStmt(env, id, { kind: 'harbor', actorId, subjectKind: 'boat', subjectId: boatId, data: { harbor: harborId }, bucket: `harbor:${harborId}:${boatId}` }, now),
      targetStmt(env, id, 'harbor', harborId, now),
      targetStmt(env, id, 'boat', boatId, now),
    ]);
  });
}

/** Beitrag in einer Gruppe – Ziel die Gruppe und (bei Vereinen) ihre Teams. */
export async function recordPost(env: Env, postId: string, groupId: string, authorId: string, now = Date.now()): Promise<void> {
  await safely('post', async () => {
    const id = randomId();
    await env.DB.batch([
      insertStmt(env, id, { kind: 'post', actorId: authorId, subjectKind: 'post', subjectId: postId, groupId }, now),
      targetStmt(env, id, 'group', groupId, now),
      teamsStmt(env, id, groupId, now),
    ]);
  });
}

// ---------------------------------------------------------------- Meilensteine (Konzept 11.3, F-166)

const PUBLIC_SHARE = `s.visibility = 'public' AND s.hidden_at IS NULL AND COALESCE(s.started_at, s.created_at) >= ?2 AND COALESCE(s.started_at, s.created_at) < ?3`;

/**
 * Nach einem neuen öffentlichen Törn: Saison-Seemeilen von Segler, Boot und deren Gruppen (höchstens 10) neu summieren;
 * jede überschrittene Schwelle (100/500/1000 sm) einmal je Jahr protokollieren. Nur für Törns der laufenden Saison –
 * nachgereichte alte Törns erzeugen keine Meilensteine von gestern.
 */
async function recordMilestones(env: Env, s: ShareForActivity, now: number): Promise<void> {
  const when = s.started_at ?? s.created_at;
  const year = seasonOf(when);
  if (year !== seasonOf(now) || !(s.dist_nm > 0)) return;
  const from = Date.UTC(year, 0, 1);
  const to = Date.UTC(year + 1, 0, 1);
  const sum = async (where: string, ...args: unknown[]) =>
    (await env.DB.prepare(`SELECT COALESCE(SUM(s.dist_nm), 0) AS nm FROM shares s WHERE ${where} AND ${PUBLIC_SHARE}`).bind(...args).first<{ nm: number }>())?.nm ?? 0;

  const subjects: Array<{ kind: 'user' | 'boat' | 'group'; id: string; nm: number }> = [];
  subjects.push({ kind: 'user', id: s.user_id, nm: await sum('s.user_id = ?1', s.user_id, from, to) });
  if (s.boat_id) subjects.push({ kind: 'boat', id: s.boat_id, nm: await sum('s.boat_id = ?1', s.boat_id, from, to) });
  const { results: groups } = await env.DB.prepare(
    `SELECT group_id FROM group_members WHERE user_id = ?1 UNION SELECT group_id FROM group_boats WHERE boat_id = ?2 LIMIT 10`,
  )
    .bind(s.user_id, s.boat_id ?? '')
    .all<{ group_id: string }>();
  for (const g of groups) {
    const nm = await sum(
      `(s.user_id IN (SELECT user_id FROM group_members WHERE group_id = ?1) OR s.boat_id IN (SELECT boat_id FROM group_boats WHERE group_id = ?1))`,
      g.group_id, from, to,
    );
    subjects.push({ kind: 'group', id: g.group_id, nm });
  }
  for (const subj of subjects) {
    for (const t of crossedMilestones(subj.nm - s.dist_nm, subj.nm)) {
      const id = randomId();
      await env.DB.batch([
        insertStmt(
          env, id,
          {
            kind: 'milestone', actorId: subj.kind === 'user' ? s.user_id : null, subjectKind: subj.kind, subjectId: subj.id,
            groupId: subj.kind === 'group' ? subj.id : null, data: { nm: t, year }, bucket: `ms:${subj.kind}:${subj.id}:${year}:${t}`,
          },
          now,
        ),
        targetStmt(env, id, subj.kind, subj.id, now),
      ]);
    }
  }
}

// ---------------------------------------------------------------- Aufräumen (Konzept 11.9)

/** Aktivitäten eines Törns (Törn gelöscht oder abgelaufen); Ziele fallen per ON DELETE CASCADE. */
export const deleteShareActivity = (env: Env, shareId: string) =>
  env.DB.prepare(`DELETE FROM activity WHERE subject_kind = 'share' AND subject_id = ?`).bind(shareId);

/** Boot gelöscht: Zuordnungen, Folgen, Aktivitäten mit dem Boot als Gegenstand, Ziele `boat`. */
export const boatCleanup = (env: Env, boatId: string): D1PreparedStatement[] => [
  deleteBoatReactions(env, boatId),
  env.DB.prepare(`DELETE FROM activity WHERE subject_kind = 'boat' AND subject_id = ?`).bind(boatId),
  env.DB.prepare(`DELETE FROM activity_target WHERE target_kind = 'boat' AND target_id = ?`).bind(boatId),
  env.DB.prepare(`DELETE FROM follows WHERE target_kind = 'boat' AND target_id = ?`).bind(boatId),
  env.DB.prepare('DELETE FROM group_boats WHERE boat_id = ?').bind(boatId),
];

/** Gruppe gelöscht: Aktivitäten der Gruppe, Ziele `group`, Folgen, Beitragszähler. */
export const groupActivityCleanup = (env: Env, groupId: string): D1PreparedStatement[] => [
  deleteGroupReactions(env, groupId),
  groupNotificationCleanup(env, groupId),
  env.DB.prepare(`DELETE FROM activity WHERE group_id = ?1 OR (subject_kind = 'group' AND subject_id = ?1)`).bind(groupId),
  env.DB.prepare(`DELETE FROM activity_target WHERE target_kind = 'group' AND target_id = ?`).bind(groupId),
  env.DB.prepare(`DELETE FROM follows WHERE target_kind = 'group' AND target_id = ?`).bind(groupId),
  env.DB.prepare('DELETE FROM post_log WHERE group_id = ?').bind(groupId),
];

/** Hafen gelöscht (Moderation): Aktivitäten „Neues Boot im Hafen“ samt Reaktionen, Ziele `harbor`, Folgen. */
export const harborActivityCleanup = (env: Env, harborId: string): D1PreparedStatement[] => [
  env.DB.prepare(
    `DELETE FROM reactions WHERE subject_kind = 'activity' AND subject_id IN (SELECT id FROM activity WHERE kind = 'harbor' AND json_extract(data, '$.harbor') = ?1)`,
  ).bind(harborId),
  env.DB.prepare(`DELETE FROM activity WHERE kind = 'harbor' AND json_extract(data, '$.harbor') = ?`).bind(harborId),
  env.DB.prepare(`DELETE FROM activity_target WHERE target_kind = 'harbor' AND target_id = ?`).bind(harborId),
  env.DB.prepare(`DELETE FROM follows WHERE target_kind = 'harbor' AND target_id = ?`).bind(harborId),
];

/** Konto gelöscht: Aktivitäten des Kontos und seiner Törns, Folgen in beide Richtungen, Ziele `user`. */
export const userActivityCleanup = (env: Env, userId: string): D1PreparedStatement[] => [
  // Reaktionen zuerst – sie verweisen auf Törns, Fotos, Beiträge und Aktivitäten des Kontos (Konzept 12.5).
  ...userReactionCleanup(env, userId),
  // Benachrichtigungen ebenso vor Beiträgen und Einladungen (Konzept 17.5)
  ...userNotificationCleanup(env, userId),
  env.DB.prepare(
    `DELETE FROM activity WHERE actor_id = ?1 OR (subject_kind = 'user' AND subject_id = ?1)
       OR (subject_kind = 'share' AND subject_id IN (SELECT id FROM shares WHERE user_id = ?1))
       OR (subject_kind = 'post' AND subject_id IN (SELECT id FROM posts WHERE author_id = ?1))`,
  ).bind(userId),
  env.DB.prepare(`DELETE FROM activity_target WHERE target_kind = 'user' AND target_id = ?`).bind(userId),
  env.DB.prepare(`DELETE FROM follows WHERE user_id = ?1 OR (target_kind = 'user' AND target_id = ?1)`).bind(userId),
];

const YEAR = 365 * 86_400_000;
const DAY = 86_400_000;
/** Höchstens so viele alte Aktivitäten pro Nacht – der Rest folgt (Free-Tier-Budget). */
const MAX_OLD = 1000;

/** Nächtlich: alte Aktivitäten, verwaiste Ziele und Folgen, Bündel ohne Fotos, alte Anfragen und Beitragszähler. */
export function nightlyActivityCleanup(env: Env, now: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE created_at < ? ORDER BY created_at LIMIT ?)').bind(now - YEAR, MAX_OLD),
    // Gegenstand gibt es nicht mehr (z. B. durch ON DELETE CASCADE an anderer Stelle)
    env.DB.prepare(
      `DELETE FROM activity WHERE
         (subject_kind = 'share' AND NOT EXISTS (SELECT 1 FROM shares WHERE id = activity.subject_id))
         OR (subject_kind = 'post' AND NOT EXISTS (SELECT 1 FROM posts WHERE id = activity.subject_id))
         OR (subject_kind = 'boat' AND NOT EXISTS (SELECT 1 FROM boats WHERE id = activity.subject_id))
         OR (subject_kind = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = activity.subject_id))
         OR (kind = 'photos' AND NOT EXISTS (SELECT 1 FROM photos WHERE share_id = activity.subject_id))`,
    ),
    env.DB.prepare(
      `DELETE FROM activity_target WHERE
         (target_kind = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = activity_target.target_id))
         OR (target_kind = 'boat' AND NOT EXISTS (SELECT 1 FROM boats WHERE id = activity_target.target_id))
         OR (target_kind = 'user' AND NOT EXISTS (SELECT 1 FROM users WHERE id = activity_target.target_id))
         OR (target_kind = 'harbor' AND NOT EXISTS (SELECT 1 FROM harbors WHERE id = activity_target.target_id))`,
    ),
    env.DB.prepare('DELETE FROM activity WHERE NOT EXISTS (SELECT 1 FROM activity_target WHERE activity_id = activity.id)'),
    env.DB.prepare(
      `DELETE FROM follows WHERE
         (target_kind = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = follows.target_id))
         OR (target_kind = 'boat' AND NOT EXISTS (SELECT 1 FROM boats WHERE id = follows.target_id))
         OR (target_kind = 'user' AND NOT EXISTS (SELECT 1 FROM users WHERE id = follows.target_id))
         OR (target_kind = 'harbor' AND NOT EXISTS (SELECT 1 FROM harbors WHERE id = follows.target_id))`,
    ),
    env.DB.prepare('DELETE FROM group_requests WHERE created_at < ?').bind(now - 90 * DAY),
    env.DB.prepare('DELETE FROM post_log WHERE created_at < ?').bind(now - DAY),
    // zuletzt: Reaktionen und Benachrichtigungen, deren Gegenstand eben (oder früher) verschwand
    ...nightlyReactionCleanup(env, now),
    ...nightlyNotificationCleanup(env, now),
  ];
}
