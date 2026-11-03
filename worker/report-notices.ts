// Moderation 3 und 6 (Konzept 35, REQUIREMENTS F-570 … F-575): Hinweis an die Admins auf offene Meldungen (Zähler,
// nächtliche Sammelmail) und Begründung an Betroffene nach einer Meldungs-Entscheidung (DSA Art. 17). Eigenes Modul,
// damit `reports.ts` nur wenige Aufrufe braucht. Gespeichert wird nichts Neues: „letzte Sammelmail“ und „Begründung
// verschickt“ stehen im Admin-Protokoll (`report_digest`, `report_notice`, Konzept 18.10).
import type { Env } from './env';
import { json } from './http';
import { randomId } from './crypto';
import { adminEmails, adminLogStmt, requireAdmin } from './moderation';
import { reportDecisionMail, reportDigestMail, sendMail } from './mail';
import type { ReportKind } from '../src/domain/comment-text';
import { decisionGround, noticeReasons, shouldNotify, type ReportDecision } from '../src/domain/report-decisions';

const DAY = 86_400_000;
/** Höchstens eine Sammelmail in diesem Abstand – auch wenn der Nachtlauf zweimal startet (F-570). */
const DIGEST_GAP_MS = 20 * 3_600_000;

/**
 * SQL: das Ziel der Meldung (Alias `r`) ist nicht gesperrt. Gesperrt heißt: eine Sperre am Ziel (Profil zählt als
 * Konto, Konzept 18.2) oder – bei Kommentar, Foto und Beitrag, die sich nicht einzeln sperren lassen – das Konto der
 * Autor:in ist gesperrt (F-575). Meldungen zu Gesperrtem bleiben als Beleg offen (Konzept 18.3), entschieden wird im
 * Admin-Bereich – sie zählen nicht als „offen“, fehlen in der Meldungsliste und werden nicht nach 180 Tagen anonymisiert.
 */
export const UNLOCKED_REPORT_TARGET = (r: string): string =>
  `(NOT EXISTS (SELECT 1 FROM locks l WHERE l.target_kind = CASE ${r}.target_kind WHEN 'profile' THEN 'user' ELSE ${r}.target_kind END AND l.target_id = ${r}.target_id)
    AND NOT (${r}.target_kind = 'comment' AND EXISTS (SELECT 1 FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ${r}.target_id AND u.locked_at IS NOT NULL))
    AND NOT (${r}.target_kind = 'photo' AND EXISTS (SELECT 1 FROM photos p JOIN users u ON u.id = p.user_id WHERE p.id = ${r}.target_id AND u.locked_at IS NOT NULL))
    AND NOT (${r}.target_kind = 'post' AND EXISTS (SELECT 1 FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ${r}.target_id AND u.locked_at IS NOT NULL)))`;

/** Ist das gemeldete Ziel gesperrt (wie `UNLOCKED_REPORT_TARGET`)? Dann lehnt die Meldungs-Entscheidung ab (409). */
export async function reportTargetLocked(env: Env, kind: ReportKind, id: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS x FROM (SELECT ? AS target_kind, ? AS target_id) r WHERE NOT ${UNLOCKED_REPORT_TARGET('r')}`)
    .bind(kind, id)
    .first();
  return !!row;
}

/** Offene Meldungen je Ziel: wie viele Ziele, davon mit einer Meldung nach `since`, älteste und neueste Meldung. */
export async function openReportStats(env: Env, since = 0): Promise<{ open: number; fresh: number; oldest: number | null; newest: number | null }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS open, COALESCE(SUM(last_at > ?), 0) AS fresh, MIN(first_at) AS oldest, MAX(last_at) AS newest FROM (
       SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM reports r
       WHERE resolved_at IS NULL AND ${UNLOCKED_REPORT_TARGET('r')} GROUP BY target_kind, target_id)`,
  )
    .bind(since)
    .first<{ open: number; fresh: number; oldest: number | null; newest: number | null }>();
  return { open: row?.open ?? 0, fresh: row?.fresh ?? 0, oldest: row?.oldest ?? null, newest: row?.newest ?? null };
}

/** GET /api/admin/reports/count – Zähler am Konto-Knopf (F-571); für andere 404. */
export async function reportCount(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const { open } = await openReportStats(env);
  return json({ open }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * Nächtlich (F-570): eine Mail an jede Admin-Adresse, wenn seit der letzten Sammelmail neue Meldungen offen sind.
 * Ablauf: Wasserstand = Zeitpunkt der neuesten bereits gemeldeten Meldung (`target_id` des letzten `report_digest`);
 * neu ist, was danach kam. Vor dem Versand wird der Lauf **beansprucht** (Eintrag `report_digest` nur, wenn es in den
 * letzten 20 h keinen gab – ein doppelt gestarteter Lauf schickt nichts). Scheitert jeder Versand, wird der Eintrag
 * wieder entfernt (nächste Nacht erneut). Bekannte Lücke: scheitert der Versand nur an einen Teil der Admins oder bricht
 * der Lauf mitten im Versand ab, bekommen die übrigen diese Sammelmail nicht nach – die nächste nennt wieder alle offenen.
 * Ohne `APP_ORIGIN` ohne Link (keine fest eingebaute Domain). Liefert die Zahl der verschickten Mails.
 */
export async function digestReports(env: Env, now: number): Promise<number> {
  const admins = await adminEmails(env);
  if (!admins.length) return 0;
  const last = await env.DB.prepare(`SELECT MAX(CAST(target_id AS INTEGER)) AS t FROM admin_log WHERE action = 'report_digest'`).first<{ t: number | null }>();
  const stats = await openReportStats(env, last?.t ?? 0);
  if (!stats.fresh || stats.oldest === null || stats.newest === null) return 0;
  const id = randomId();
  const claim = await env.DB.prepare(
    `INSERT INTO admin_log (id, admin_id, action, target_kind, target_id, detail, created_at)
     SELECT ?, NULL, 'report_digest', 'reports', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_log WHERE action = 'report_digest' AND created_at > ?)`,
  )
    .bind(id, String(stats.newest), `${stats.open} offen, ${stats.fresh} neu`, now, now - DIGEST_GAP_MS)
    .run();
  if (!claim.meta.changes) return 0;
  const origin = env.APP_ORIGIN?.trim().replace(/\/+$/, '') || null;
  let sent = 0;
  for (const to of admins) {
    try {
      await sendMail(env, reportDigestMail(env, to, origin, { open: stats.open, fresh: stats.fresh, oldest: stats.oldest }));
      sent++;
    } catch (err) {
      console.error('report digest failed', err);
    }
  }
  if (!sent) await env.DB.prepare('DELETE FROM admin_log WHERE id = ?').bind(id).run();
  return sent;
}

/** Eigentümer:in, Bezeichnung und Substantiv (feste Texte), Name (Nutzertext), Ausblend-Status, ob sie Ausgeblendetes sieht. */
const OWNER: Record<ReportKind, string> = {
  share: `SELECT user_id AS owner, 'dein Törn' AS what, 'Törn' AS noun, title AS name, hidden_at, 1 AS sees FROM shares WHERE id = ?`,
  comment: `SELECT c.user_id AS owner, 'dein Kommentar zum Törn' AS what, 'Kommentar' AS noun, s.title AS name, c.hidden_at, 1 AS sees
            FROM comments c JOIN shares s ON s.id = c.share_id WHERE c.id = ?`,
  photo: `SELECT p.user_id AS owner, CASE WHEN s.id IS NULL THEN 'dein Foto in einem Beitrag' ELSE 'dein Foto zum Törn' END AS what, 'Foto' AS noun,
            COALESCE(s.title, '') AS name, p.hidden_at, 1 AS sees FROM photos p LEFT JOIN shares s ON s.id = p.share_id WHERE p.id = ?`,
  profile: `SELECT user_id AS owner, 'dein Profil' AS what, 'Profil' AS noun, display_name AS name, hidden_at, 0 AS sees FROM profiles WHERE user_id = ?`,
  boat: `SELECT owner_id AS owner, 'dein Boot' AS what, 'Boot' AS noun, name, hidden_at, 1 AS sees FROM boats WHERE id = ?`,
  group: `SELECT owner_id AS owner, 'deine Gruppe' AS what, 'Gruppe' AS noun, name, hidden_at, 1 AS sees FROM groups WHERE id = ?`,
  post: `SELECT p.author_id AS owner, CASE WHEN g.id IS NULL THEN 'dein Beitrag' ELSE 'dein Beitrag in der Gruppe' END AS what, 'Beitrag' AS noun,
           COALESCE(g.name, '') AS name, p.hidden_at, 1 AS sees FROM posts p LEFT JOIN groups g ON g.id = p.group_id WHERE p.id = ?`,
  harbor: `SELECT created_by AS owner, 'dein angelegter Hafen' AS what, 'Hafen' AS noun, name, hidden_at, 0 AS sees FROM harbors WHERE id = ?`,
};

export interface DecisionNotice {
  kind: ReportKind;
  id: string;
  owner: string;
  email: string;
  what: string;
  noun: string;
  name: string;
  wasHidden: boolean;
  /** Eigentümer:in sieht Ausgeblendetes (Verwalter-Sicht, Konzept 18.2) – nicht bei Profil und Hafen */
  ownerSees: boolean;
  reasons: Record<string, number>;
}

/**
 * Vor der Entscheidung lesen, was die Begründung braucht (nach „Löschen“ gibt es das Ziel nicht mehr). Ohne
 * Eigentümer:in, ohne Mail-Adresse oder bei gesperrtem Konto (das hat die Sperr-Begründung, F-296) → null.
 */
export async function prepareDecisionNotice(env: Env, kind: ReportKind, id: string): Promise<DecisionNotice | null> {
  const row = await env.DB.prepare(OWNER[kind])
    .bind(id)
    .first<{ owner: string | null; what: string; noun: string; name: string | null; hidden_at: number | null; sees: number }>();
  if (!row?.owner) return null;
  const u = await env.DB.prepare('SELECT email, locked_at FROM users WHERE id = ?').bind(row.owner).first<{ email: string | null; locked_at: number | null }>();
  if (!u?.email || u.locked_at) return null;
  const { results } = await env.DB.prepare('SELECT reason, COUNT(*) AS n FROM reports WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL GROUP BY reason')
    .bind(kind, id)
    .all<{ reason: string; n: number }>();
  const reasons = Object.fromEntries(results.map((r) => [r.reason, r.n]));
  return { kind, id, owner: row.owner, email: u.email, what: row.what, noun: row.noun, name: row.name ?? '', wasHidden: !!row.hidden_at, ownerSees: !!row.sees, reasons };
}

/**
 * Begründung nach der Entscheidung (F-572, F-573): an die Eigentümer:in, mit Maßnahme, Grundlage (Recht oder Regeln),
 * Gründen, Widerspruch an `REPORT_CONTACT` und Rechtsweg. Ein gescheiterter Versand hält die Entscheidung nicht auf.
 * Der Versand steht im Protokoll (`report_notice` am Konto der Eigentümer:in, ohne Adresse) – daraus auch die Grenzen
 * je Konto (nur Spam) und insgesamt je Tag. Liefert, ob verschickt wurde.
 */
export async function sendDecisionNotice(env: Env, adminId: string, n: DecisionNotice | null, decision: ReportDecision, now = Date.now()): Promise<boolean> {
  if (!n) return false;
  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(target_kind = 'user' AND target_id = ?), 0) AS owner FROM admin_log WHERE action = 'report_notice' AND created_at > ?`,
  )
    .bind(n.owner, now - DAY)
    .first<{ total: number; owner: number }>();
  if (!shouldNotify({ decision, wasHidden: n.wasHidden, reasons: n.reasons, sentToday: counts?.owner ?? 0, sentTotal: counts?.total ?? 0, selfDecided: n.owner === adminId })) return false;
  try {
    await sendMail(
      env,
      reportDecisionMail(env, n.email, {
        decision,
        what: n.what,
        noun: n.noun,
        name: n.name,
        ground: decisionGround(n.reasons),
        ownerSees: n.ownerSees,
        reasons: noticeReasons(n.reasons),
        contact: env.REPORT_CONTACT,
      }),
    );
  } catch (err) {
    console.error('report notice failed', n.kind, n.id, err);
    return false;
  }
  await adminLogStmt(env, adminId, 'report_notice', 'user', n.owner, `Begründung per Mail: ${n.kind} ${n.id} – ${decision}`, now).run();
  return true;
}
