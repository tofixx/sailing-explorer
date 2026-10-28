// Moderation (Konzept 4.4): Admin-Konten, gesperrte Konten und Aufräumen von Meldungen.
// Bewusst ohne Abhängigkeit zu shares/boats/profiles, damit diese Module es importieren können.
import type { Env } from './env';
import { currentUser, requireUser, type User } from './auth';
import { randomId } from './crypto';
import { HttpError } from './http';
import { isAdmin } from './validate';
import { ADMIN_LIMITS } from '../src/domain/admin';

// Admin-Liste ist eine reine Funktion (worker/validate.ts, unit-getestet).
export { adminIds, isAdmin } from './validate';

/**
 * Admin oder 404 – auch für Gäste: Nicht-Admins erfahren nicht, dass es die Route gibt (Konzept 18.1, fail closed bei
 * leerem ADMIN_USER_IDS).
 */
export async function requireAdmin(request: Request, env: Env): Promise<User> {
  const user = await currentUser(request, env);
  if (!user || !isAdmin(env, user.id)) throw new HttpError(404, 'not_found');
  return user;
}

/**
 * Eintrag im Admin-Protokoll (Konzept 18.10): wer (null = nächtlicher Lauf), was, Ziel, kurzes Detail – nie
 * Mail-Adressen. Als Anweisung, damit er im selben Batch wie die Aktion landet.
 */
export const adminLogStmt = (env: Env, adminId: string | null, action: string, kind: string | null, id: string | null, detail = '', now = Date.now()): D1PreparedStatement =>
  env.DB.prepare('INSERT INTO admin_log (id, admin_id, action, target_kind, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
    randomId(), adminId, action, kind, id, detail.slice(0, ADMIN_LIMITS.detailMax), now,
  );

/**
 * Einblick eines Admins in gesperrte Inhalte (Konzept 18.5, F-295): nur lesend, jeder Abruf steht im Protokoll
 * (`view_content`, Pfad als Detail). Vor der Antwort geschrieben – scheitert der Eintrag, gibt es keinen Inhalt.
 */
export async function logLockedView(env: Env, request: Request, adminId: string, kind: 'share' | 'boat' | 'group', id: string): Promise<void> {
  await adminLogStmt(env, adminId, 'view_content', kind, id, new URL(request.url).pathname).run();
}

/** Ist das Ziel gesperrt (Konzept 18.2)? Profile zählen als Konto. */
export async function isLockedTarget(env: Env, kind: string, id: string): Promise<boolean> {
  const k = kind === 'profile' ? 'user' : kind;
  return !!(await env.DB.prepare('SELECT 1 AS x FROM locks WHERE target_kind = ? AND target_id = ?').bind(k, id).first());
}

/**
 * SQL: besitzt das Konto (Spalte/Platzhalter `user`) gesperrte Törns, Boote oder Gruppen? `ownOnly`: nur einzeln
 * gesperrte (nicht die mit dem Konto mitgesperrten).
 */
export function ownsLockedSql(user: string, ownOnly = false): string {
  const own = (kind: string) => (ownOnly ? ` AND id NOT IN (SELECT target_id FROM locks WHERE target_kind = '${kind}' AND via_user = ${user})` : '');
  return `(EXISTS (SELECT 1 FROM shares WHERE user_id = ${user} AND locked_at IS NOT NULL${own('share')})
    OR EXISTS (SELECT 1 FROM boats WHERE owner_id = ${user} AND locked_at IS NOT NULL${own('boat')})
    OR EXISTS (SELECT 1 FROM groups WHERE owner_id = ${user} AND locked_at IS NOT NULL))`;
}

export const LOCKED = () => new HttpError(409, 'locked', 'Das ist gesperrt – erst entsperren.');

/** Gesperrt? Fail closed: ein Konto, das es nicht (mehr) gibt, gilt als gesperrt. */
export async function isSuspended(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT suspended_at FROM users WHERE id = ?').bind(userId).first<{ suspended_at: number | null }>();
  return !row || row.suspended_at !== null;
}

export const SUSPENDED = () =>
  new HttpError(403, 'suspended', 'Dein Konto ist gesperrt. Hochladen, Kommentieren, Melden und Einladen sind nicht möglich – bei Fragen wende dich an die Kontaktadresse im Impressum.');

/** Wirft 403 `suspended` für gesperrte Konten (Uploads, Kommentare, Meldungen, Einladungen). */
export async function assertActive(env: Env, user: Pick<User, 'id'>): Promise<void> {
  if (await isSuspended(env, user.id)) throw SUSPENDED();
}

/** Angemeldet und nicht gesperrt. */
export async function requireActiveUser(request: Request, env: Env): Promise<User> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  return user;
}

// ---------------------------------------------------------------- Aufräumen von Meldungen

/**
 * Meldungen zu einem Törn, seinen Kommentaren und Fotos – vor dem Löschen des Törns ausführen
 * (Kommentare und Fotos fallen danach per ON DELETE CASCADE weg).
 */
export const deleteShareReports = (env: Env, shareId: string): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM reports WHERE (target_kind = 'share' AND target_id = ?1)
       OR (target_kind = 'comment' AND target_id IN (SELECT id FROM comments WHERE share_id = ?1))
       OR (target_kind = 'photo' AND target_id IN (SELECT id FROM photos WHERE share_id = ?1))`,
  ).bind(shareId);

/**
 * Konto löschen: Meldungen zu allen Inhalten des Kontos fallen weg; eigene Meldungen bleiben anonym
 * (ohne Meldenden und ohne Anmerkung) bestehen, weil der gemeldete Inhalt weiter geprüft werden muss.
 */
export const purgeUserReports = (env: Env, userId: string): D1PreparedStatement[] => [
  env.DB.prepare(
    `DELETE FROM reports WHERE
       (target_kind = 'share' AND target_id IN (SELECT id FROM shares WHERE user_id = ?1))
       OR (target_kind = 'comment' AND target_id IN (SELECT id FROM comments WHERE user_id = ?1 OR share_id IN (SELECT id FROM shares WHERE user_id = ?1)))
       OR (target_kind = 'photo' AND target_id IN (SELECT id FROM photos WHERE user_id = ?1 OR share_id IN (SELECT id FROM shares WHERE user_id = ?1)))
       OR (target_kind = 'profile' AND target_id = ?1)
       OR (target_kind = 'boat' AND target_id IN (SELECT id FROM boats WHERE owner_id = ?1))
       OR (target_kind = 'post' AND target_id IN (SELECT id FROM posts WHERE author_id = ?1))`,
  ).bind(userId),
  env.DB.prepare(`UPDATE reports SET reporter_id = NULL, note = '' WHERE reporter_id = ?`).bind(userId),
];

/** Nächtlich: Meldungen, deren Ziel es nicht mehr gibt (gelöscht, abgelaufen). */
export const deleteOrphanReports = (env: Env): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM reports WHERE
       (target_kind = 'share' AND NOT EXISTS (SELECT 1 FROM shares WHERE id = reports.target_id))
       OR (target_kind = 'comment' AND NOT EXISTS (SELECT 1 FROM comments WHERE id = reports.target_id))
       OR (target_kind = 'photo' AND NOT EXISTS (SELECT 1 FROM photos WHERE id = reports.target_id))
       OR (target_kind = 'profile' AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = reports.target_id))
       OR (target_kind = 'boat' AND NOT EXISTS (SELECT 1 FROM boats WHERE id = reports.target_id))
       OR (target_kind = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = reports.target_id))
       OR (target_kind = 'post' AND NOT EXISTS (SELECT 1 FROM posts WHERE id = reports.target_id))
       OR (target_kind = 'harbor' AND NOT EXISTS (SELECT 1 FROM harbors WHERE id = reports.target_id))`,
  );
