// Nächtliches Aufräumen (Cron): abgelaufene Törns löschen, vorher erinnern, inaktive leere Konten entfernen.
// Regeln stehen in src/domain/support.ts; der Ablauf eines Törns wird per EXPIRES_SQL in der DB berechnet.
import type { Env } from './env';
import { purgeUser } from './auth';
import { repairSharePostsStmt } from './post-sql';
import { expiryWarningMail, seasonReminderMail, sendMail } from './mail';
import { EXPIRES_SQL, shareDeleteStmts } from './shares';
import { recomputeStorage, storageTotal } from './storage';
import { deleteOrphanReports, ownsLockedSql } from './moderation';
import { expireLocks, orphanLocksStmt, remindLocks } from './locks';
import { UNLOCKED_REPORT_TARGET, digestReports } from './report-notices';
import { sendNotificationDigests } from './notification-mail';
import { nightlyPollClosedStmts, notifyExpiry } from './notifications';
import { deleteKeys, photoKeysForShares, shareFileKeys } from './photo-keys';
import { nightlyNotificationCleanup } from './notification-cleanup';
import { nightlyActivityCleanup } from './activity';
import { sendGroupDigests } from './group-digest';
import { coverLogCleanup, sweepOrphanCovers } from './covers';
import { emptyGalleries, photoLogCleanup } from './post-photos';
import { removePost } from './posts';
import { expireClaims } from './claims';
import { nightlyClaimCleanup } from './claim-cleanup';
import { runEventNight } from './events';
import { GRACE_MS, INACTIVE_ACCOUNT_MS, SEASON_MAIL_MONTH, WARN_MS, seasonEnd } from '../src/domain/support';
import { LOG_ACTION_MS, LOG_VIEW_MS } from '../src/domain/admin';

/** Offene Meldungen werden nach so langer Zeit ohne Entscheidung anonymisiert. */
const OPEN_REPORT_MS = 180 * 86_400_000;
/** Zahlungsdaten (supports) werden so lange nach Ablauf aufbewahrt (steuerliche Aufbewahrung), dann gelöscht. */
const SUPPORT_RECORD_MS = 10 * 365 * 86_400_000;

/** Obergrenzen pro Lauf – hält den Cron im Free-Tier-CPU-Budget; der Rest folgt in der nächsten Nacht. */
const MAX_DELETE = 200;
const MAX_WARN_USERS = 50;
const MAX_PURGE_USERS = 50;
/** D1-Batches klein halten. */
const CHUNK = 50;
/** Entschiedene (anonymisierte) Meldungen bleiben so lange als Nachweis, dann weg. */
const RESOLVED_REPORTS_MS = 180 * 86_400_000;
/** Spam-Zähler für Kommentare (comment_log) braucht nur die letzten 24 h. */
const COMMENT_LOG_MS = 86_400_000;

export interface RetentionResult {
  deleted: number;
  warned: number;
  /** verschickte Saison-Erinnerungen (Dezember, Konzept 5.5) */
  seasonMails: number;
  purged: number;
  /** entfernte Titelbilder gelöschter Profile, Boote und Gruppen (Konzept 13.2) */
  covers: number;
  /** Gesamtspeicher nach dem Lauf (neu berechnet, Konzept 5.2) */
  storageBytes: number;
  /** Abweichung des inkrementell gepflegten Zählers vom neu berechneten Wert (null = Zeile fehlte) */
  storageDrift: number | null;
  /** Schritte, die in diesem Lauf gescheitert sind (leer = alles gelaufen); null-Drift kann auch daher kommen */
  failed: string[];
  /** verschickte Sammelmails über neue Kommentare */
  digests: number;
  /** offene Anträge auf Verifizierung, die ohne Entscheidung abgelaufen sind (Konzept 20.8) */
  claimsExpired: number;
  /** verschickte wöchentliche Sammelmails aus Vereinen und Teams (Konzept 11.7) */
  groupDigests: number;
  /** nach Ablauf der Sperrfrist endgültig gelöschte Objekte (Konzept 18.4) */
  lockExpired: number;
  /** Veranstaltungen: erinnert (nächste 36 h) und nach Frist gelöscht (Konzept 30) */
  events: { reminded: number; expired: number };
}

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Löscht Törns, deren Aufbewahrung abgelaufen ist (Datei, Vorschaubild, Fotos, Datensatz; Foto-Zeilen per CASCADE).
 * Gesperrte bleiben zur Beweissicherung (Konzept 18.3).
 */
async function deleteExpired(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT s.id FROM shares s WHERE ${EXPIRES_SQL} <= ? AND s.locked_at IS NULL LIMIT ?`)
    .bind(now, MAX_DELETE)
    .all<{ id: string }>();
  for (const part of chunks(results)) {
    const photoKeys = await photoKeysForShares(env, part.map((r) => r.id));
    await deleteKeys(env, [...part.flatMap((r) => shareFileKeys(r.id)), ...photoKeys]);
    // derselbe D1-Teil wie beim einzelnen Löschen (Zähler, Meldungen, Reaktionen, Aktivitäten …) – ein Batch je Portion
    await env.DB.batch(part.flatMap((r) => shareDeleteStmts(env, r.id)));
  }
  return results.length;
}

/** Eine Mail pro Konto für alle Törns, die in den nächsten 14 Tagen ablaufen – je Törn nur einmal. */
async function warnExpiring(env: Env, origin: string, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.title, s.user_id, u.email, ${EXPIRES_SQL} AS expires_at
     FROM shares s JOIN users u ON u.id = s.user_id
     WHERE ${EXPIRES_SQL} <= ? AND s.locked_at IS NULL
       -- Eine Warnung vor dem aktuellen Warnfenster ist veraltet (Ablauf wurde durch Unterstützung verschoben).
       AND (s.expiry_warned_at IS NULL OR s.expiry_warned_at < ${EXPIRES_SQL} - ?)
     ORDER BY s.user_id`,
  )
    .bind(now + WARN_MS, WARN_MS)
    .all<{ id: string; title: string; user_id: string; email: string; expires_at: number }>();

  const byUser = new Map<string, typeof results>();
  for (const r of results) {
    if (!byUser.has(r.user_id) && byUser.size >= MAX_WARN_USERS) break;
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  }
  let warned = 0;
  for (const shares of byUser.values()) {
    try {
      await sendMail(env, expiryWarningMail(env, shares[0].email, origin, shares.map((s) => ({ title: s.title, expiresAt: s.expires_at }))));
    } catch (err) {
      // Mail fehlgeschlagen → nicht als gewarnt markieren, nächste Nacht erneut.
      console.error('expiry warning failed', err);
      continue;
    }
    for (const part of chunks(shares)) {
      await env.DB.batch(part.map((s) => env.DB.prepare('UPDATE shares SET expiry_warned_at = ? WHERE id = ?').bind(now, s.id)));
    }
    // zusätzlich in der Glocke (Hinweis des Betreibers, nicht abschaltbar – Konzept 17.6)
    for (const s of shares) await notifyExpiry(env, s.id);
    warned++;
  }
  return warned;
}

/**
 * Saison-Erinnerung (Konzept 5.5): im Dezember einmal pro Konto und Jahr an Konten, deren Törns mit dieser Saison
 * enden (Löschung am 1. Februar), solange keine Unterstützung für die nächste Saison läuft.
 */
async function remindSeason(env: Env, origin: string, now: number): Promise<number> {
  const d = new Date(now);
  if (d.getUTCMonth() !== SEASON_MAIL_MONTH) return 0;
  const season = d.getUTCFullYear();
  const expiresAt = seasonEnd(season) + GRACE_MS;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, COUNT(*) AS voyages FROM users u JOIN shares s ON s.user_id = u.id
     WHERE ${EXPIRES_SQL} <= ?1 AND COALESCE(u.season_mail_year, 0) < ?2 AND u.suspended_at IS NULL
     GROUP BY u.id LIMIT ?3`,
  )
    .bind(expiresAt, season, MAX_WARN_USERS)
    .all<{ id: string; email: string; voyages: number }>();
  let sent = 0;
  for (const u of results) {
    try {
      await sendMail(env, seasonReminderMail(env, u.email, origin, { season, voyages: u.voyages, expiresAt }));
    } catch (err) {
      console.error('season reminder failed', err);
      continue;
    }
    await env.DB.prepare('UPDATE users SET season_mail_year = ? WHERE id = ?').bind(season, u.id).run();
    sent++;
  }
  return sent;
}

/**
 * Konten ohne Törns, die seit 12 Monaten nicht angemeldet waren (und keinen laufenden Unterstützer-Status haben).
 * Gesperrte Konten und Konten mit Gesperrtem bleiben (Konzept 18.3).
 */
async function purgeInactive(env: Env, now: number): Promise<number> {
  const cutoff = now - INACTIVE_ACCOUNT_MS;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email FROM users u
     WHERE COALESCE(u.last_login, u.created_at) < ?
       AND NOT EXISTS (SELECT 1 FROM shares WHERE user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM supports WHERE user_id = u.id AND valid_until > ?)
       AND u.locked_at IS NULL AND NOT ${ownsLockedSql('u.id')}
     ORDER BY COALESCE(u.last_login, u.created_at), u.id LIMIT ?`,
  )
    .bind(cutoff, now, MAX_PURGE_USERS)
    .all<{ id: string; email: string }>();
  let purged = 0;
  for (const user of results) {
    // Ein fehlerhaftes Konto hält die übrigen (und den Rest der Nacht) nicht auf.
    try {
      await purgeUser(env, user);
      purged++;
    } catch (err) {
      console.error('purge inactive failed', user.id, err);
    }
  }
  return purged;
}

async function sweepEmptyGalleries(env: Env, now: number): Promise<number> {
  const ids = await emptyGalleries(env, now);
  for (const id of ids) await removePost(env, id);
  return ids.length;
}

export async function runRetention(env: Env, origin: string, now = Date.now()): Promise<RetentionResult> {
  // Jeder Schritt einzeln: ein Fehler hält die übrigen nicht auf, steht aber im Ergebnis (failed) und im Log.
  const failed: string[] = [];
  const step = <T>(name: string, p: Promise<T>, fallback: T): Promise<T> =>
    p.catch((err) => {
      console.error(`retention step ${name} failed`, err);
      failed.push(name);
      return fallback;
    });
  const deleted = await step('expired', deleteExpired(env, now), 0);
  // Sperrfrist abgelaufen (Konzept 18.4): endgültig löschen über den Löschpfad des Objekts
  const lockExpired = await step('locks', expireLocks(env, now), 0);
  // 14 Tage vor Ablauf einmal eine Sammel-Erinnerung an die Admins
  await step('lock_reminder', remindLocks(env, origin, now), 0);
  // Offene Meldungen (F-570): eine Sammelmail an die Admins, nur wenn seit der letzten neue dazugekommen sind
  await step('report_digest', digestReports(env, now), 0);
  const warned = await step('warn', warnExpiring(env, origin, now), 0);
  const seasonMails = await remindSeason(env, origin, now).catch((err) => {
    console.error('season reminders failed', err);
    return 0;
  });
  const purged = await step('inactive', purgeInactive(env, now), 0);
  // Veranstaltungen (Konzept 30): Frist und Erinnerung – vor der Sammelmail, damit die Erinnerung noch mitgeht
  const events = await step('events', runEventNight(env, now), { reminded: 0, expired: 0 });
  // Sammelmail nach dem Aufräumen: Kommentare auf gerade gelöschten Törns zählen nicht mehr.
  const digests = await sendNotificationDigests(env, origin, now).catch((err) => {
    console.error('comment digests failed', err);
    return 0;
  });
  await step('cleanup', env.DB.batch([
    // erst 24 h nach Ablauf – so lange zählen ihre Code-Fehlversuche noch zur Grenze pro Adresse (Konzept 14.6)
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 86_400_000),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now),
    // abgelaufene und aufgebrauchte Einladungen (Konzept 10.5)
    env.DB.prepare('DELETE FROM invites WHERE expires_at < ? OR uses >= max_uses').bind(now),
    // Kommentare & Melden (Phase D)
    env.DB.prepare('DELETE FROM comment_log WHERE created_at < ?').bind(now - COMMENT_LOG_MS),
    env.DB.prepare('DELETE FROM reports WHERE resolved_at IS NOT NULL AND resolved_at < ?').bind(now - RESOLVED_REPORTS_MS),
    deleteOrphanReports(env),
    // Admin-Bereich (Konzept 18.4, 18.10): Sperren ohne Ziel, Protokoll nach Frist (außer zu noch Gesperrtem)
    orphanLocksStmt(env),
    env.DB.prepare(
      `DELETE FROM admin_log WHERE created_at < CASE WHEN action IN ('list', 'view') THEN ?1 ELSE ?2 END
         AND NOT EXISTS (SELECT 1 FROM locks l WHERE l.target_kind = admin_log.target_kind AND l.target_id = admin_log.target_id)`,
    ).bind(now - LOG_VIEW_MS, now - LOG_ACTION_MS),
    // Neuigkeiten (Konzept 11.9): alte Aktivitäten, verwaiste Ziele und Folgen, alte Anfragen
    ...nightlyActivityCleanup(env, now),
    // Monatszähler der Galerie (Konzept 31) nach 32 Tagen
    photoLogCleanup(env, now),
    // Tageslimit der Titelbilder (Konzept 36) nach 2 Tagen
    coverLogCleanup(env, now),
  ]), []);
  // Galerie-Beiträge ohne Foto (Hochladen abgebrochen) nach 24 h über den einen Löschpfad (Konzept 31, F-494)
  await step('galleries', sweepEmptyGalleries(env, now), 0);
  // Benachrichtigungen (Konzept 17.5) als eigener Schritt – nach dem Aufräumen oben, damit verwaiste gleich mitgehen
  // Verifizierung (Konzept 20.8): offene Anträge ablaufen lassen (mit Hinweis), Angaben und alte Anträge löschen –
  // vor dem Aufräumen der Benachrichtigungen, damit Hinweise zu gelöschten Anträgen gleich mitgehen
  const claimsExpired = await step('claims_expire', expireClaims(env, now), 0);
  await step('claims', env.DB.batch(nightlyClaimCleanup(env, now)), []);
  await step('notifications', env.DB.batch(nightlyNotificationCleanup(env, now)), []);
  // Umfragen (Konzept 29): beendete an ihre Autor:in melden – nach dem Aufräumen, damit die Meldung bleibt
  await step('polls', env.DB.batch(nightlyPollClosedStmts(env, now)), []);
  // Beiträge (Konzept 21.3): Törns ohne Post-Zeile nachtragen
  await step('posts', repairSharePostsStmt(env).run(), null);
  // Datenschutz-Fristen als eigener Batch (scheitert einer, läuft der andere trotzdem)
  await step('privacy', env.DB.batch([
    // Offene Meldungen nach 180 Tagen ohne Entscheidung: ohne Meldende und Anmerkung (Datenschutz, Abschnitt 9)
    // – außer das Ziel ist gesperrt: dann bleibt die Meldung als Beleg, bis die Sperre endet (Konzept 18.3)
    env.DB.prepare(
      `UPDATE reports SET reporter_id = NULL, note = '' WHERE resolved_at IS NULL AND created_at < ? AND (reporter_id IS NOT NULL OR note <> '')
         AND ${UNLOCKED_REPORT_TARGET('reports')}`,
    ).bind(now - OPEN_REPORT_MS),
    // Gutscheine der Admins (Konzept 18.9a): keine Zahlung, keine Aufbewahrungspflicht – 2 Jahre nach Ablauf gelöscht
    env.DB.prepare(`DELETE FROM supports WHERE provider = 'admin' AND valid_until < ?`).bind(now - LOG_ACTION_MS),
    // Zahlungen: 10 Jahre nach Ablauf der Unterstützung (steuerliche Aufbewahrung), dann gelöscht
    env.DB.prepare('DELETE FROM supports WHERE valid_until < ? AND created_at < ?').bind(now - SUPPORT_RECORD_MS, now - SUPPORT_RECORD_MS),
  ]), []);
  const groupDigests = await sendGroupDigests(env, origin, now).catch((err) => {
    console.error('group digests failed', err);
    return 0;
  });
  // Titelbilder gelöschter Profile, Boote und Gruppen (Konzept 13.2)
  const covers = await sweepOrphanCovers(env).catch((err) => {
    console.error('cover sweep failed', err);
    return 0;
  });
  // Notbremse: Zähler aus D1 neu berechnen – korrigiert Abweichungen der inkrementellen Pflege und legt eine
  // fehlende Zeile wieder an (bis dahin gelten Uploads als pausiert).
  const counted = await step('count', storageTotal(env), null);
  const storageBytes = await recomputeStorage(env);
  return { deleted, warned, seasonMails, purged, digests, claimsExpired, groupDigests, lockExpired, covers, events, storageBytes, storageDrift: counted === null ? null : storageBytes - counted, failed };
}
