// Moderation (Konzept 4.4): Admin-Konten, gesperrte Konten und Aufräumen von Meldungen.
// Bewusst ohne Abhängigkeit zu shares/boats/profiles, damit diese Module es importieren können.
import type { Env } from './env';
import { requireUser, type User } from './auth';
import { HttpError } from './http';

// Admin-Liste ist eine reine Funktion (worker/validate.ts, unit-getestet).
export { adminIds, isAdmin } from './validate';

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
 * Meldungen zu einem Törn und seinen Kommentaren – vor dem Löschen des Törns ausführen
 * (die Kommentare fallen danach per ON DELETE CASCADE weg).
 */
export const deleteShareReports = (env: Env, shareId: string): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM reports WHERE (target_kind = 'share' AND target_id = ?1)
       OR (target_kind = 'comment' AND target_id IN (SELECT id FROM comments WHERE share_id = ?1))`,
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
       OR (target_kind = 'profile' AND target_id = ?1)
       OR (target_kind = 'boat' AND target_id IN (SELECT id FROM boats WHERE owner_id = ?1))`,
  ).bind(userId),
  env.DB.prepare(`UPDATE reports SET reporter_id = NULL, note = '' WHERE reporter_id = ?`).bind(userId),
];

/** Nächtlich: Meldungen, deren Ziel es nicht mehr gibt (gelöscht, abgelaufen). */
export const deleteOrphanReports = (env: Env): D1PreparedStatement =>
  env.DB.prepare(
    `DELETE FROM reports WHERE
       (target_kind = 'share' AND NOT EXISTS (SELECT 1 FROM shares WHERE id = reports.target_id))
       OR (target_kind = 'comment' AND NOT EXISTS (SELECT 1 FROM comments WHERE id = reports.target_id))
       OR (target_kind = 'profile' AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = reports.target_id))
       OR (target_kind = 'boat' AND NOT EXISTS (SELECT 1 FROM boats WHERE id = reports.target_id))`,
  );
