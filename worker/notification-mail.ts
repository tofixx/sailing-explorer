// Kanäle je Art und tägliche Sammelmail (Konzept 17.6, F-256): Wer für eine Art „Mail“ gewählt hat, bekommt einmal am
// Tag eine Sammelmail über das, was auf der Seite noch ungelesen ist – ohne Namen, ohne Texte anderer. Einladungen
// kommen bei „Mail“ sofort (worker/invites.ts). Hinweise des Betreibers zum Konto gehen immer per Mail (nicht hier).
import type { Env } from './env';
import { HttpError } from './http';
import { notificationDigestMail, sendMail } from './mail';
import { loadNotifications } from './notifications';
import { CHOOSABLE, isChannel, isChoosable, mailLine, parsePrefs, type NotifyPrefs } from '../src/domain/notifications';

const HOUR = 3_600_000;
/** höchstens so viele Sammelmails je nächtlichem Lauf (Resend Free: 100/Tag für alles), der Rest in der nächsten Nacht */
export const DIGESTS_PER_RUN = 25;
/** Arten, die in die Sammelmail gehen (Einladungen kommen sofort) */
const DIGEST_KINDS = CHOOSABLE.filter((k) => k !== 'invite');

export async function prefsOf(env: Env, userId: string): Promise<NotifyPrefs> {
  const u = await env.DB.prepare('SELECT notify_prefs FROM users WHERE id = ?').bind(userId).first<{ notify_prefs: string }>();
  return parsePrefs(u?.notify_prefs);
}

/**
 * Teil-Änderung `{ comment: 'mail', follow: 'push' … }` speichern (Unbekanntes → 400). Wird eine Art neu auf „Mail“
 * gestellt und gab es bisher keine Sammelmail, zählt erst ab jetzt (keine Mail über Altes).
 */
/** Gültige Kanal-Änderung `{ comment: 'mail', … }`? – vorab prüfbar, damit ein 400 nichts halb speichert. */
export function validPrefsPatch(patch: unknown): boolean {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  const entries = Object.entries(patch as Record<string, unknown>);
  return entries.length > 0 && entries.every(([k, v]) => isChoosable(k) && isChannel(v));
}

export async function savePrefs(env: Env, userId: string, patch: unknown): Promise<void> {
  if (!validPrefsPatch(patch)) throw new HttpError(400, 'invalid_setting', 'Unbekannte Einstellung.');
  const entries = Object.entries(patch as Record<string, unknown>);
  const before = await prefsOf(env, userId);
  const after = { ...before, ...Object.fromEntries(entries) } as NotifyPrefs;
  const digested = (p: NotifyPrefs) => DIGEST_KINDS.some((k) => p[k] === 'mail');
  await env.DB.prepare(
    `UPDATE users SET notify_prefs = ?1, comments_mailed_at = CASE WHEN ?2 THEN ?3 ELSE comments_mailed_at END WHERE id = ?4`,
  )
    .bind(JSON.stringify(after), !digested(before) && digested(after) ? 1 : 0, Date.now(), userId)
    .run();
  // Keine Art mehr auf Push → alle Geräte abmelden, nicht nur dieses (Datenschutz: „gelöscht, wenn du Push abwählst“)
  if (!CHOOSABLE.some((k) => after[k] === 'push')) await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(userId).run();
}

/**
 * Nächtlich (Cron): eine Mail je Konto mit Ungelesenem der Arten, für die es „Mail“ gewählt hat, seit der letzten
 * Sammelmail (`comments_mailed_at`) – höchstens eine pro Tag und DIGESTS_PER_RUN pro Lauf. Was auf der Seite schon
 * gelesen wurde, kommt nicht; ohne Ungelesenes keine Mail. Inhalt wie in der Glocke geprüft (loadNotifications).
 */
export async function sendNotificationDigests(env: Env, origin: string, now = Date.now()): Promise<number> {
  const kinds = DIGEST_KINDS.map((_, i) => `?${i + 3}`).join(', ');
  const { results: users } = await env.DB.prepare(
    `SELECT u.id, u.email, u.notify_prefs, COALESCE(u.comments_mailed_at, 0) AS since FROM users u
     WHERE u.suspended_at IS NULL AND u.locked_at IS NULL AND COALESCE(u.comments_mailed_at, 0) < ?1
       AND EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.read_at IS NULL
                   AND n.updated_at > COALESCE(u.comments_mailed_at, 0) AND n.kind IN (${kinds})
                   AND json_extract(u.notify_prefs, '$.' || n.kind) = 'mail')
     ORDER BY COALESCE(u.comments_mailed_at, 0) LIMIT ?2`,
  )
    // Höchstens eine Sammelmail pro Tag, auch wenn der Cron doppelt läuft.
    .bind(now - 20 * HOUR, DIGESTS_PER_RUN, ...DIGEST_KINDS)
    .all<{ id: string; email: string; notify_prefs: string; since: number }>();
  let sent = 0;
  for (const u of users) {
    const prefs = parsePrefs(u.notify_prefs);
    const items = (await loadNotifications(env, u, 50)).filter((n) => !n.read && n.at > u.since && isChoosable(n.kind) && n.kind !== 'invite' && prefs[n.kind] === 'mail');
    if (items.length) {
      // Follower-Links führten zum Profil der Person – in der Mail kein Name, also zur Startseite.
      try {
        await sendMail(env, notificationDigestMail(env, u.email, origin, items.map((n) => ({ line: mailLine(n), path: n.kind === 'follow' ? '/' : n.href }))));
      } catch (err) {
        console.error('notification digest failed', err); // nächste Nacht erneut
        continue;
      }
      sent++;
    }
    await env.DB.prepare('UPDATE users SET comments_mailed_at = ? WHERE id = ?').bind(now, u.id).run();
  }
  return sent;
}
