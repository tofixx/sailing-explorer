// Sperren zur Beweissicherung (Konzept 18.2 – 18.4): nur noch für Admins sichtbar, ausgenommen von den normalen
// Löschfristen, nach Ablauf der Sperrfrist endgültig gelöscht. Baut auf hidden_at und users.suspended_at auf: die Sperre
// setzt beide und merkt sich die vorherigen Werte (locks.prev_at), Entsperren stellt sie wieder her.
import type { Env } from './env';
import { purgeUser } from './auth';
import { HttpError } from './http';
import { adminIds, adminLogStmt, ownsLockedSql } from './moderation';
import { lockNoticeMail, lockReminderMail, sendMail } from './mail';
import { removeShare } from './shares';
import { removeBoat } from './boats';
import { removeGroup } from './groups';
import { removeHarbor } from './harbors';
import { ADMIN_LIMITS, LOCK_WARN_MS, lockUntil, type LockKind } from '../src/domain/admin';

/** Tabelle, ID-Spalte und ob es eine eigene locked_at-Spalte gibt – feste Werte, nie aus der Anfrage. */
const TABLE = {
  share: { table: 'shares', id: 'id', locked: true },
  boat: { table: 'boats', id: 'id', locked: true },
  group: { table: 'groups', id: 'id', locked: true },
  harbor: { table: 'harbors', id: 'id', locked: false },
  // nur mitgesperrt mit dem Konto (ausgeblendet)
  profile: { table: 'profiles', id: 'user_id', locked: false },
} as const;
type ObjectKind = keyof typeof TABLE;

export interface LockRow {
  target_kind: LockKind;
  target_id: string;
  locked_at: number;
  until: number;
  locked_by: string;
  reason: string;
  via_user: string | null;
  prev_at: number | null;
}

export async function loadLock(env: Env, kind: LockKind, id: string): Promise<LockRow | null> {
  return env.DB.prepare('SELECT * FROM locks WHERE target_kind = ? AND target_id = ?').bind(kind, id).first<LockRow>();
}

/** Ein Objekt sperren: Zeile in locks mit dem bisherigen hidden_at, dann locked_at und hidden_at setzen. */
function lockObjectStmts(env: Env, kind: ObjectKind, where: { col: string; value: string }, by: string, reason: string, via: string | null, now: number): D1PreparedStatement[] {
  const t = TABLE[kind];
  return [
    // OR IGNORE: schon (einzeln) gesperrte Objekte behalten ihre eigene Sperre
    env.DB.prepare(
      `INSERT OR IGNORE INTO locks (target_kind, target_id, locked_at, until, locked_by, reason, via_user, prev_at)
       SELECT ?1, ${t.id}, ?2, ?3, ?4, ?5, ?6, hidden_at FROM ${t.table} WHERE ${where.col} = ?7`,
    ).bind(kind, now, lockUntil(now), by, reason, via, where.value),
    env.DB.prepare(`UPDATE ${t.table} SET ${t.locked ? 'locked_at = COALESCE(locked_at, ?1), ' : ''}hidden_at = COALESCE(hidden_at, ?1) WHERE ${where.col} = ?2`).bind(now, where.value),
  ];
}

/** Entsperren: hidden_at aus prev_at wiederherstellen, locked_at leeren, Zeilen löschen. `col` = target_id oder via_user. */
function unlockObjectStmts(env: Env, kind: ObjectKind, col: 'target_id' | 'via_user', value: string): D1PreparedStatement[] {
  const t = TABLE[kind];
  return [
    env.DB.prepare(
      `UPDATE ${t.table} SET ${t.locked ? 'locked_at = NULL, ' : ''}
         hidden_at = (SELECT prev_at FROM locks l WHERE l.target_kind = ?1 AND l.target_id = ${t.table}.${t.id})
       WHERE ${t.id} IN (SELECT target_id FROM locks WHERE target_kind = ?1 AND ${col} = ?2)`,
    ).bind(kind, value),
    env.DB.prepare(`DELETE FROM locks WHERE target_kind = ? AND ${col} = ?`).bind(kind, value),
  ];
}

/** Gibt es das Ziel? (Konto, Törn, Boot, Gruppe, Hafen) */
export async function targetExists(env: Env, kind: LockKind, id: string): Promise<boolean> {
  const table = kind === 'user' ? 'users' : TABLE[kind].table;
  return !!(await env.DB.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ?`).bind(id).first());
}

/**
 * Sperren oder – wenn schon gesperrt – verlängern (180 Tage ab jetzt). Konten sperren Profil, eigene Törns und eigene
 * Boote mit und verlieren alle Sitzungen. Liefert, was geschah.
 */
export async function lockTarget(env: Env, adminId: string, kind: LockKind, id: string, reason: string, now = Date.now()): Promise<'lock' | 'extend'> {
  const existing = await loadLock(env, kind, id);
  if (existing) {
    // Mitgesperrtes verlängert man über das Konto
    if (existing.via_user) throw new HttpError(409, 'locked_via_user', 'Das ist mit seinem Konto gesperrt – bitte dort verlängern.');
    await env.DB.batch([
      env.DB.prepare('UPDATE locks SET until = ?1, reminded_at = NULL WHERE (target_kind = ?2 AND target_id = ?3) OR (?2 = \'user\' AND via_user = ?3)').bind(lockUntil(now), kind, id),
      adminLogStmt(env, adminId, 'extend', kind, id, reason, now),
    ]);
    return 'extend';
  }
  if (kind !== 'user') {
    await env.DB.batch([...lockObjectStmts(env, kind, { col: TABLE[kind].id, value: id }, adminId, reason, null, now), adminLogStmt(env, adminId, 'lock', kind, id, reason, now)]);
    return 'lock';
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO locks (target_kind, target_id, locked_at, until, locked_by, reason, via_user, prev_at)
       SELECT 'user', id, ?1, ?2, ?3, ?4, NULL, suspended_at FROM users WHERE id = ?5`,
    ).bind(now, lockUntil(now), adminId, reason, id),
    env.DB.prepare('UPDATE users SET locked_at = ?1, suspended_at = COALESCE(suspended_at, ?1) WHERE id = ?2').bind(now, id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    ...lockObjectStmts(env, 'profile', { col: 'user_id', value: id }, adminId, '', id, now),
    ...lockObjectStmts(env, 'share', { col: 'user_id', value: id }, adminId, '', id, now),
    ...lockObjectStmts(env, 'boat', { col: 'owner_id', value: id }, adminId, '', id, now),
    adminLogStmt(env, adminId, 'lock', kind, id, reason, now),
  ]);
  return 'lock';
}

/** Entsperren; ein Konto entsperrt nur das, was mit ihm gesperrt wurde. 404, wenn nicht gesperrt. */
export async function unlockTarget(env: Env, adminId: string, kind: LockKind, id: string, now = Date.now()): Promise<void> {
  const lock = await loadLock(env, kind, id);
  if (!lock) throw new HttpError(404, 'not_locked', 'Das ist nicht gesperrt.');
  if (lock.via_user) throw new HttpError(409, 'locked_via_user', 'Das ist mit seinem Konto gesperrt – bitte das Konto entsperren.');
  // Törn oder Boot eines gesperrten Kontos bliebe sonst als einziges sichtbar
  if ((kind === 'share' || kind === 'boat') && (await env.DB.prepare(
    `SELECT 1 AS x FROM ${TABLE[kind].table} t JOIN users u ON u.id = t.${kind === 'share' ? 'user_id' : 'owner_id'} WHERE t.id = ? AND u.locked_at IS NOT NULL`,
  ).bind(id).first())) {
    throw new HttpError(409, 'owner_locked', 'Das Konto des Eigentümers ist gesperrt – erst das Konto entsperren.');
  }
  if (kind !== 'user') {
    await env.DB.batch([...unlockObjectStmts(env, kind, 'target_id', id), adminLogStmt(env, adminId, 'unlock', kind, id, '', now)]);
    return;
  }
  await env.DB.batch([
    ...unlockObjectStmts(env, 'profile', 'via_user', id),
    ...unlockObjectStmts(env, 'share', 'via_user', id),
    ...unlockObjectStmts(env, 'boat', 'via_user', id),
    env.DB.prepare(`UPDATE users SET locked_at = NULL, suspended_at = (SELECT prev_at FROM locks WHERE target_kind = 'user' AND target_id = ?1) WHERE id = ?1`).bind(id),
    env.DB.prepare(`DELETE FROM locks WHERE target_kind = 'user' AND target_id = ?`).bind(id),
    adminLogStmt(env, adminId, 'unlock', kind, id, '', now),
  ]);
}

/** Mitsperre eines Boots beim Eigner-Wechsel lösen (Konzept 18.6): das Boot gehört dann einem nicht gesperrten Konto. */
export const releaseViaLockStmts = (env: Env, kind: 'boat', id: string): D1PreparedStatement[] => unlockObjectStmts(env, kind, 'target_id', id);

/**
 * Endgültig löschen über den einen Löschpfad des Objekts (Admin-Löschen, abgelaufene Sperre) und die Sperre(n) dazu
 * entfernen. Konten über purgeUser (eigene Törns, Boote, Profil fallen mit, also auch ihre Mit-Sperren).
 */
export async function removeTarget(env: Env, kind: LockKind, id: string): Promise<void> {
  if (kind === 'share') await removeShare(env, id);
  else if (kind === 'boat') await removeBoat(env, id);
  else if (kind === 'group') await removeGroup(env, id);
  else if (kind === 'harbor') await removeHarbor(env, id);
  else {
    const u = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(id).first<{ id: string; email: string }>();
    if (u) await purgeUser(env, u);
  }
  await env.DB.prepare('DELETE FROM locks WHERE (target_kind = ?1 AND target_id = ?2) OR via_user = ?2').bind(kind, id).run();
}

/**
 * Nächtlich (Konzept 18.4): abgelaufene Sperren → endgültig löschen (höchstens 20), mit System-Eintrag im Protokoll.
 * Ein Konto, das noch einzeln gesperrte Objekte besitzt, wartet, bis deren Sperre endet (sonst gingen sie früher).
 */
export async function expireLocks(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT target_kind, target_id FROM locks l WHERE until <= ? AND via_user IS NULL
       AND NOT (target_kind = 'user' AND ${ownsLockedSql('l.target_id', true)})
     ORDER BY until LIMIT ?`,
  )
    .bind(now, ADMIN_LIMITS.expirePerNight)
    .all<{ target_kind: LockKind; target_id: string }>();
  let n = 0;
  for (const l of results) {
    try {
      await removeTarget(env, l.target_kind, l.target_id);
      await adminLogStmt(env, null, 'lock_expired', l.target_kind, l.target_id, 'Sperrfrist abgelaufen – endgültig gelöscht', now).run();
      n++;
    } catch (err) {
      console.error('lock expiry failed', l.target_kind, l.target_id, err);
    }
  }
  return n;
}

/** Nächtlich: Sperren ohne Ziel (auf anderem Weg gelöscht). */
export const orphanLocksStmt = (env: Env): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM locks WHERE
       (target_kind = 'user' AND NOT EXISTS (SELECT 1 FROM users WHERE id = locks.target_id))
       OR (target_kind = 'share' AND NOT EXISTS (SELECT 1 FROM shares WHERE id = locks.target_id))
       OR (target_kind = 'boat' AND NOT EXISTS (SELECT 1 FROM boats WHERE id = locks.target_id))
       OR (target_kind = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = locks.target_id))
       OR (target_kind = 'harbor' AND NOT EXISTS (SELECT 1 FROM harbors WHERE id = locks.target_id))
       OR (target_kind = 'profile' AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = locks.target_id))`,
  );

/** Betroffene je Art: wessen Objekt es ist, wie es heißt, feste Bezeichnung für die Mail (Konzept 18.4). */
const NOTICE: Record<LockKind, { sql: string; what: string; label: string }> = {
  user: { sql: `SELECT id AS owner, '' AS name FROM users WHERE id = ?`, what: 'dein Konto', label: 'Konto' },
  share: { sql: 'SELECT user_id AS owner, title AS name FROM shares WHERE id = ?', what: 'dein Törn', label: 'Törn' },
  boat: { sql: 'SELECT owner_id AS owner, name FROM boats WHERE id = ?', what: 'dein Boot', label: 'Boot' },
  group: { sql: 'SELECT owner_id AS owner, name FROM groups WHERE id = ?', what: 'deine Gruppe', label: 'Gruppe' },
  harbor: { sql: 'SELECT created_by AS owner, name FROM harbors WHERE id = ?', what: 'dein angelegter Hafen', label: 'Hafen' },
};

/**
 * Begründung an die Betroffenen beim Sperren (Konzept 18.4, DSA Art. 17): an das Konto selbst bzw. an Eigner:in des
 * Objekts. Ohne Konto oder Mail-Adresse keine Mail. Ein Fehler beim Versand hält die Sperre nicht auf; der Versand steht
 * im Protokoll (`lock_notice`, ohne Adresse). Liefert, ob verschickt wurde.
 */
export async function sendLockNotice(env: Env, adminId: string, kind: LockKind, id: string, now = Date.now()): Promise<boolean> {
  const n = NOTICE[kind];
  const lock = await loadLock(env, kind, id);
  const obj = await env.DB.prepare(n.sql).bind(id).first<{ owner: string | null; name: string | null }>();
  if (!lock || !obj?.owner) return false;
  const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(obj.owner).first<{ email: string | null }>();
  if (!u?.email) return false;
  try {
    await sendMail(env, lockNoticeMail(env, u.email, { what: n.what, name: obj.name ?? '', reason: lock.reason, until: lock.until, contact: env.REPORT_CONTACT }));
  } catch (err) {
    console.error('lock notice failed', kind, id, err);
    return false;
  }
  await adminLogStmt(env, adminId, 'lock_notice', kind, id, 'Begründung per Mail an Betroffene', now).run();
  return true;
}

/**
 * Nächtlich (Konzept 18.4): eine Mail an die Admins mit allen Sperren, die in 14 Tagen ablaufen und noch nicht
 * erinnert wurden (einmal je Sperrfrist – Verlängern setzt `reminded_at` zurück). Mitgesperrtes folgt dem Konto.
 * Ohne Admin-Adresse oder wenn kein Versand gelingt, bleibt es unmarkiert (nächste Nacht erneut).
 */
export async function remindLocks(env: Env, origin: string, now: number): Promise<number> {
  const ids = [...adminIds(env)];
  if (!ids.length) return 0;
  const { results } = await env.DB.prepare(
    'SELECT target_kind, target_id, until, reason FROM locks WHERE via_user IS NULL AND reminded_at IS NULL AND until <= ? ORDER BY until LIMIT 100',
  )
    .bind(now + LOCK_WARN_MS)
    .all<{ target_kind: LockKind; target_id: string; until: number; reason: string }>();
  if (!results.length) return 0;
  const { results: admins } = await env.DB.prepare(`SELECT email FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND email <> ''`)
    .bind(...ids)
    .all<{ email: string }>();
  const items = [];
  for (const l of results) {
    const row = await env.DB.prepare(NOTICE[l.target_kind].sql).bind(l.target_id).first<{ name: string | null }>();
    items.push({ kind: NOTICE[l.target_kind].label, id: l.target_id, name: row?.name ?? '', until: l.until, reason: l.reason });
  }
  let sent = 0;
  for (const a of admins) {
    try {
      await sendMail(env, lockReminderMail(env, a.email, origin, items));
      sent++;
    } catch (err) {
      console.error('lock reminder failed', err);
    }
  }
  if (!sent) return 0;
  await env.DB.batch(results.map((l) => env.DB.prepare('UPDATE locks SET reminded_at = ? WHERE target_kind = ? AND target_id = ?').bind(now, l.target_kind, l.target_id)));
  return results.length;
}
