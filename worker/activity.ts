// Aktivitäts-Log (Konzept 11.3): eine Zeile `activity` je Ereignis, eine Zeile `activity_target` je Publikum –
// nie eine Zeile pro Mitglied oder Follower. Die Zeilen sind nur ein Index: Sichtbarkeit prüft worker/stream.ts beim
// Lesen. Protokolliert werden nur öffentliche Törns (private stehen gar nicht erst im Log).
// Bewusst ohne Abhängigkeit zu shares/groups/boats, damit diese Module es importieren können.
import type { Env } from './env';
import { randomId } from './crypto';
import { IN_LOGBOOK_SQL } from './logbook-sql';
import { reachAtLeastSql } from './reach-sql';
import { postLogKey } from './post-sql';
import { crossedMilestones, dayKey, seasonOf, type ActivityKind } from '../src/domain/groups';
import { deleteBoatReactions, deleteGroupReactions, nightlyReactionCleanup, userReactionCleanup } from './reaction-cleanup';
import { deleteBoatNotifications, groupNotificationCleanup, userNotificationCleanup } from './notification-cleanup';

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

/**
 * Aktivitäten eines Törns als Paare (aid = Aktivität, sid = Törn, at = Zeit der Aktivität) – Teilabfragen für
 * `shareTargetStmts`: Törn- und Foto-Aktivitäten eines Törns (?1 = Törn), Fahrtenbuch-Bündel mit diesem Törn samt
 * aller Einträge darin (?1 = Törn) und alle Törn-Aktivitäten bzw. Bündel eines Kontos (?1 = Konto).
 */
const ACTS = {
  share: `SELECT id AS aid, subject_id AS sid, created_at AS at FROM activity WHERE subject_kind = 'share' AND subject_id = ?1 AND kind IN ('voyage', 'photos')`,
  bundlesOf: `SELECT a.id AS aid, j.value AS sid, a.created_at AS at FROM activity a, json_each(a.data, '$.ids') j
    WHERE a.kind = 'logbook' AND a.id IN (SELECT a2.id FROM activity a2, json_each(a2.data, '$.ids') j2
      WHERE a2.kind = 'logbook' AND a2.actor_id = (SELECT user_id FROM shares WHERE id = ?1) AND j2.value = ?1)`,
  user: `SELECT id AS aid, subject_id AS sid, created_at AS at FROM activity WHERE subject_kind = 'share' AND kind IN ('voyage', 'photos')
      AND subject_id IN (SELECT id FROM shares WHERE user_id = ?1)
    UNION ALL SELECT a.id, j.value, a.created_at FROM activity a, json_each(a.data, '$.ids') j WHERE a.kind = 'logbook' AND a.actor_id = ?1`,
} as const;

/**
 * Publikum von Törns (Konzept 11.12, 12.4, 21.2) – die eine Funktion für Anlegen, Fahrtenbuch-Bündel und Neuberechnen:
 * Segler, die ausgewählten Gruppen (share_groups); je nach „Sichtbar bis“ (F-427) ab „bis Verein“ die Vereine gewählter
 * Teams, ab „bis Hafen“ Boot und Hafen des Boots (nur öffentliches, nicht ausgeblendetes Boot – sonst verriete der
 * Hafen-Stream den Hafen eines nicht öffentlichen Boots). `acts` liefert (aid, sid, at); jedes Ziel bekommt die Zeit
 * seiner Aktivität – nichts springt nach oben. Ein Bündel hat die Ziele aller seiner Einträge.
 */
function shareTargetStmts(env: Env, acts: string, ...binds: unknown[]): D1PreparedStatement[] {
  const ins = (join: string, kind: string, id: string, where = '') =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
       SELECT x.aid, '${kind}', ${id}, x.at FROM (${acts}) x ${join} ${where}`,
    ).bind(...binds);
  return [
    ins('JOIN shares s ON s.id = x.sid', 'user', 's.user_id'),
    ins('JOIN share_groups sg ON sg.share_id = x.sid', 'group', 'sg.group_id'),
    ins('JOIN share_groups sg ON sg.share_id = x.sid JOIN groups g ON g.id = sg.group_id', 'group', 'g.parent_id', `WHERE g.parent_id IS NOT NULL AND ${reachAtLeastSql('x.sid', 'club')}`),
    ins('JOIN shares s ON s.id = x.sid', 'boat', 's.boat_id', `WHERE s.boat_id IS NOT NULL AND ${reachAtLeastSql('x.sid', 'harbor')}`),
    ins(
      'JOIN shares s ON s.id = x.sid JOIN boats b ON b.id = s.boat_id', 'harbor', 'b.harbor_id',
      `WHERE b.harbor_id IS NOT NULL AND b.visibility = 'public' AND b.hidden_at IS NULL AND ${reachAtLeastSql('x.sid', 'harbor')}`,
    ),
  ];
}

/** Ziele einer eben angelegten Aktivität eines Törns (gab es sie schon – doppelter bucket –, entsteht nichts). */
const shareTargets = (env: Env, id: string, s: Pick<ShareForActivity, 'id'>): D1PreparedStatement[] =>
  shareTargetStmts(env, `SELECT id AS aid, ?2 AS sid, created_at AS at FROM activity WHERE id = ?1`, id, s.id);

/** Alle Ziele der Aktivitäten in `acts` verwerfen und neu aufbauen (für einen Batch). */
const rebuild = (env: Env, acts: string, ...binds: unknown[]): D1PreparedStatement[] => [
  env.DB.prepare(`DELETE FROM activity_target WHERE activity_id IN (SELECT aid FROM (${acts}))`).bind(...binds),
  ...shareTargetStmts(env, acts, ...binds),
];

/**
 * Auswahl, „Sichtbar bis“, Boot oder Sichtbarkeit eines Törns geändert (F-375, F-427): alle Ziele seiner Törn- und
 * Foto-Aktivitäten und der Fahrtenbuch-Bündel mit ihm aus derselben Funktion wie beim Anlegen neu (wie
 * `syncPostActivity`). Für einen Batch.
 */
export const syncShareActivity = (env: Env, shareId: string): D1PreparedStatement[] => [...rebuild(env, ACTS.share, shareId), ...rebuild(env, ACTS.bundlesOf, shareId)];

/**
 * Mitglied verlässt eine Gruppe (Austreten, Entfernen, F-377): nach dem Löschen seiner Auswahl in dieser Gruppe die Ziele
 * aller seiner Törns und Bündel neu aufbauen – dieselbe Funktion, keine eigene Ziel-Anweisung. Für einen Batch.
 */
export const memberShareTargetsCleanup = (env: Env, userId: string): D1PreparedStatement[] => rebuild(env, ACTS.user, userId);

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

/** Ein Törn ist (neu) öffentlich: einmal je Törn protokollieren, danach Meilensteine prüfen. */
export async function recordVoyage(env: Env, s: ShareForActivity, now = Date.now()): Promise<void> {
  await safely('voyage', async () => {
    const id = randomId();
    await env.DB.batch([
      insertStmt(env, id, { kind: 'voyage', actorId: s.user_id, subjectKind: 'share', subjectId: s.id, bucket: `voyage:${s.id}` }, now),
      ...shareTargets(env, id, s),
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
      ...shareTargets(env, id, s),
    ]);
  });
}

/** Höchstens so viele Törns merkt sich ein Fahrtenbuch-Bündel (die Anzeige zählt nur noch sichtbare). */
const LOGBOOK_IDS_MAX = 100;

/**
 * Nachgetragene Fahrtenbuch-Einträge (Abfahrt > 14 Tage zurück, K7, F-308): gebündelt „hat n Törns ins Fahrtenbuch
 * nachgetragen“ je Konto und Tag statt einzeln. Gegenstand ist das Konto; die Törns stehen in `data.ids` und werden
 * beim Lesen geprüft (gelöschte, private, ausgeblendete fallen weg). Meilensteine wie bei einem Törn.
 */
export async function recordLogbook(env: Env, s: ShareForActivity, now = Date.now()): Promise<void> {
  await safely('logbook', async () => {
    // schon in einem Bündel (z. B. privat und wieder öffentlich geschaltet): nicht noch einmal
    const listed = await env.DB.prepare(
      `SELECT 1 AS x FROM activity a, json_each(a.data, '$.ids') j WHERE a.kind = 'logbook' AND a.actor_id = ?1 AND j.value = ?2 LIMIT 1`,
    ).bind(s.user_id, s.id).first();
    if (listed) return;
    const id = randomId();
    const bucket = `logbook:${s.user_id}:${dayKey(now)}`;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE activity SET data = json_set(data, '$.ids', json(CASE WHEN json_array_length(data, '$.ids') < ${LOGBOOK_IDS_MAX}
           THEN json_insert(json_extract(data, '$.ids'), '$[#]', ?1) ELSE json_extract(data, '$.ids') END)), updated_at = ?2 WHERE bucket = ?3`,
      ).bind(s.id, now, bucket),
      insertStmt(env, id, { kind: 'logbook', actorId: s.user_id, subjectKind: 'user', subjectId: s.user_id, data: { ids: [s.id] }, bucket }, now),
      // Ziele hängen am Bündel, das es (nach diesem Batch) gibt – auch wenn es schon bestand; dieselbe Funktion wie bei
      // Törns mit GPX (Gruppen nur aus der Auswahl, F-374; Boot und Hafen erst ab „Sichtbar bis: Hafen“, F-427)
      ...shareTargetStmts(env, `SELECT id AS aid, ?2 AS sid, created_at AS at FROM activity WHERE bucket = ?1`, bucket, s.id),
    ]);
    await recordMilestones(env, s, now);
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

/** Ein Beitrag, wie ihn das Aktivitäts-Log braucht (nur „Öffentlich“ und „Nur Mitglieder“ kommen hinein, 21.7). */
export interface PostForActivity {
  id: string;
  authorId: string;
  channel: { kind: 'user' | 'group' | 'harbor' | 'boat'; id: string };
  visibility: 'public' | 'members';
  /** Ausbreitung nach oben bis „Sichtbar bis“ (F-409), beim Schreiben aufgelöst – nur bei „Öffentlich“ */
  upward: Array<{ kind: 'group' | 'harbor'; id: string }>;
}

/**
 * Ziele eines Beitrags (Konzept 11.3, 21.7): Heimatverlauf – Gruppe (bei Vereinen und „Öffentlich“ zusätzlich ihre
 * Teams), Profil (`user`: Follower, Teamkolleg:innen, man selbst), Hafen bzw. Boot – und bei „Öffentlich“ die Stufen
 * darüber. „Nur Mitglieder“ nur die Heimatgruppe (F-415).
 */
function postTargets(env: Env, id: string, p: PostForActivity, at: number): D1PreparedStatement[] {
  const c = p.channel;
  const home = c.kind === 'user' ? targetStmt(env, id, 'user', p.authorId, at) : targetStmt(env, id, c.kind, c.id, at);
  if (p.visibility !== 'public') return [home];
  return [home, ...(c.kind === 'group' ? [teamsStmt(env, id, c.id, at)] : []), ...p.upward.map((t) => targetStmt(env, id, t.kind, t.id, at))];
}

/** Beitrag ins Log (einmal je Beitrag); `now` = Zeit des Beitrags, auch wenn er erst später öffentlich wird. */
export async function recordPost(env: Env, p: PostForActivity, now = Date.now()): Promise<void> {
  await safely('post', async () => {
    const id = randomId();
    await env.DB.batch([
      insertStmt(env, id, { kind: 'post', actorId: p.authorId, subjectKind: 'post', subjectId: p.id, groupId: p.channel.kind === 'group' ? p.channel.id : null }, now),
      ...postTargets(env, id, p, now),
    ]);
  });
}

/**
 * Sichtbarkeit oder „Sichtbar bis“ geändert (F-409): Ziele angleichen. Nicht mehr im Log (null: „Nur mit Link“, „Nur
 * ich“) – Aktivität weg; sonst die Ziele der bestehenden Aktivität ersetzen, mit ihrer Zeit (nichts springt nach oben);
 * gab es noch keine, entsteht sie mit der Zeit des Beitrags.
 */
export async function syncPostActivity(env: Env, postId: string, p: PostForActivity | null, createdAt: number): Promise<void> {
  if (!p) {
    await env.DB.prepare(`DELETE FROM activity WHERE subject_kind = 'post' AND subject_id = ?`).bind(postId).run();
    return;
  }
  const act = await env.DB.prepare(`SELECT id, created_at FROM activity WHERE subject_kind = 'post' AND subject_id = ?`).bind(postId).first<{ id: string; created_at: number }>();
  if (!act) return recordPost(env, p, createdAt);
  await env.DB.batch([env.DB.prepare('DELETE FROM activity_target WHERE activity_id = ?').bind(act.id), ...postTargets(env, act.id, p, act.created_at)]);
}

// ---------------------------------------------------------------- Meilensteine (Konzept 11.3, F-166)

const PUBLIC_SHARE = `s.visibility = 'public' AND s.hidden_at IS NULL AND COALESCE(s.started_at, s.created_at) >= ?2 AND COALESCE(s.started_at, s.created_at) < ?3`;

/**
 * Nach einem neuen öffentlichen Törn: Saison-Seemeilen von Segler, Boot und den ausgewählten Gruppen des Törns
 * (höchstens 10, Gruppen zählen nur ihre ausgewählten Törns, F-376) neu summieren;
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
    (await env.DB.prepare(`SELECT COALESCE(SUM(s.dist_nm), 0) AS nm FROM shares s WHERE ${where} AND ${PUBLIC_SHARE} AND ${IN_LOGBOOK_SQL}`).bind(...args).first<{ nm: number }>())?.nm ?? 0;

  const subjects: Array<{ kind: 'user' | 'boat' | 'group'; id: string; nm: number }> = [];
  subjects.push({ kind: 'user', id: s.user_id, nm: await sum('s.user_id = ?1', s.user_id, from, to) });
  if (s.boat_id) subjects.push({ kind: 'boat', id: s.boat_id, nm: await sum('s.boat_id = ?1', s.boat_id, from, to) });
  const { results: groups } = await env.DB.prepare(
    `SELECT group_id FROM share_groups WHERE share_id = ? LIMIT 10`,
  )
    .bind(s.id)
    .all<{ group_id: string }>();
  for (const g of groups) {
    const nm = await sum(`s.id IN (SELECT share_id FROM share_groups WHERE group_id = ?1)`, g.group_id, from, to);
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

/** Gruppen-Auswahl eines Törns (Törn gelöscht oder abgelaufen) – ausdrücklich, nicht nur per ON DELETE CASCADE. */
export const deleteShareGroups = (env: Env, shareId: string) => env.DB.prepare('DELETE FROM share_groups WHERE share_id = ?').bind(shareId);

/**
 * Hafen bzw. Boot gelöscht (Konzept 21.3.3, F-425): Text-Beiträge mit diesem Heimatverlauf samt Reaktionen,
 * Benachrichtigungen, Meldungen, Aktivität und Tageszähler – es gibt keinen Fremdschlüssel auf `channel_id`. Fremde
 * Beiträge, die nur hierher ausgebreitet waren, verlieren nur ihr Ziel (Ziele `harbor` bzw. `boat`).
 */
export function channelPostsCleanup(env: Env, kind: 'harbor' | 'boat', id: string): D1PreparedStatement[] {
  const posts = `SELECT id FROM posts WHERE channel_kind = ?1 AND channel_id = ?2 AND share_id IS NULL`;
  const stmt = (sql: string) => env.DB.prepare(sql).bind(kind, id);
  return [
    stmt(`DELETE FROM reactions WHERE subject_kind = 'post' AND subject_id IN (${posts})`),
    stmt(`DELETE FROM notifications WHERE subject_kind = 'post' AND subject_id IN (${posts})`),
    stmt(`DELETE FROM reports WHERE target_kind = 'post' AND target_id IN (${posts})`),
    stmt(`DELETE FROM activity WHERE subject_kind = 'post' AND subject_id IN (${posts})`),
    env.DB.prepare('DELETE FROM post_log WHERE group_id = ?').bind(postLogKey({ kind, id })),
    stmt(`DELETE FROM posts WHERE channel_kind = ?1 AND channel_id = ?2 AND share_id IS NULL`),
  ];
}

/** Boot gelöscht: Zuordnungen, Folgen, Beiträge im Boots-Verlauf, Aktivitäten mit dem Boot als Gegenstand, Ziele `boat`. */
export const boatCleanup = (env: Env, boatId: string): D1PreparedStatement[] => [
  ...channelPostsCleanup(env, 'boat', boatId),
  deleteBoatReactions(env, boatId),
  deleteBoatNotifications(env, boatId),
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

/** Hafen gelöscht (Moderation): Beiträge im Hafen-Verlauf, Aktivitäten „Neues Boot im Hafen“ samt Reaktionen, Ziele `harbor`, Folgen. */
export const harborActivityCleanup = (env: Env, harborId: string): D1PreparedStatement[] => [
  ...channelPostsCleanup(env, 'harbor', harborId),
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
         OR (kind = 'photos' AND NOT EXISTS (SELECT 1 FROM photos WHERE share_id = activity.subject_id))
         OR (kind = 'logbook' AND NOT EXISTS (SELECT 1 FROM shares WHERE id IN (SELECT value FROM json_each(activity.data, '$.ids'))))`,
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
    // zuletzt: Reaktionen, deren Gegenstand eben (oder früher) verschwand
    ...nightlyReactionCleanup(env, now),
  ];
}
