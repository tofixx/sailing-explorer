// Moderation 3 und 6 (Konzept 35, REQUIREMENTS F-570 … F-575): Hinweis an die Admins auf offene Meldungen (Zähler,
// nächtliche Sammelmail) und Begründung an Betroffene nach einer Meldungs-Entscheidung (DSA Art. 17). Eigenes Modul,
// damit `reports.ts` nur zwei Aufrufe braucht. Gespeichert wird nichts Neues: „letzte Sammelmail“ und „Begründung
// verschickt“ stehen im Admin-Protokoll (`report_digest`, `report_notice`, Konzept 18.10).
import type { Env } from './env';
import { json } from './http';
import { adminEmails, adminLogStmt, requireAdmin } from './moderation';
import { reportDecisionMail, reportDigestMail, sendMail } from './mail';
import type { ReportKind } from '../src/domain/comment-text';
import { noticeReasons, shouldNotify, type ReportDecision } from '../src/domain/report-decisions';

const DAY = 86_400_000;

/**
 * SQL: das Ziel der Meldung (Alias `r`) ist nicht gesperrt. Meldungen zu Gesperrtem bleiben als Beleg offen
 * (Konzept 18.3), entschieden wird im Admin-Bereich – sie zählen nicht als „offen“ und fehlen in der Meldungsliste.
 */
export const UNLOCKED_REPORT_TARGET = (r: string): string =>
  `NOT EXISTS (SELECT 1 FROM locks l WHERE l.target_kind = CASE ${r}.target_kind WHEN 'profile' THEN 'user' ELSE ${r}.target_kind END AND l.target_id = ${r}.target_id)`;

/** Offene Meldungen je Ziel: wie viele Ziele, davon mit einer Meldung nach `since`, und die älteste Meldung. */
export async function openReportStats(env: Env, since = 0): Promise<{ open: number; fresh: number; oldest: number | null }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS open, COALESCE(SUM(last_at > ?), 0) AS fresh, MIN(first_at) AS oldest FROM (
       SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM reports r
       WHERE resolved_at IS NULL AND ${UNLOCKED_REPORT_TARGET('r')} GROUP BY target_kind, target_id)`,
  )
    .bind(since)
    .first<{ open: number; fresh: number; oldest: number | null }>();
  return { open: row?.open ?? 0, fresh: row?.fresh ?? 0, oldest: row?.oldest ?? null };
}

/** GET /api/admin/reports/count – Zähler am Konto-Knopf (F-571); für andere 404. */
export async function reportCount(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const { open } = await openReportStats(env);
  return json({ open }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * Nächtlich (F-570): eine Mail an jede Admin-Adresse, wenn seit der letzten Sammelmail neue Meldungen offen sind –
 * höchstens eine je Nacht, sonst keine (Mail-Budget). Die letzte steht im Protokoll (`report_digest`); scheitert jeder
 * Versand, bleibt es unvermerkt und die nächste Nacht versucht es erneut. Liefert die Zahl der verschickten Mails.
 */
export async function digestReports(env: Env, origin: string, now: number): Promise<number> {
  const admins = await adminEmails(env);
  if (!admins.length) return 0;
  const last = await env.DB.prepare(`SELECT MAX(created_at) AS t FROM admin_log WHERE action = 'report_digest'`).first<{ t: number | null }>();
  const stats = await openReportStats(env, last?.t ?? 0);
  if (!stats.fresh || stats.oldest === null) return 0;
  let sent = 0;
  for (const to of admins) {
    try {
      await sendMail(env, reportDigestMail(env, to, origin, { open: stats.open, fresh: stats.fresh, oldest: stats.oldest }));
      sent++;
    } catch (err) {
      console.error('report digest failed', err);
    }
  }
  if (sent) await adminLogStmt(env, null, 'report_digest', null, null, `${stats.open} offen, ${stats.fresh} neu`, now).run();
  return sent;
}

/** Eigentümer:in, Bezeichnung (fester Text), Name (Nutzertext) und Ausblend-Status je Art. */
const OWNER: Record<ReportKind, string> = {
  share: `SELECT user_id AS owner, 'dein Törn' AS what, title AS name, hidden_at FROM shares WHERE id = ?`,
  comment: `SELECT c.user_id AS owner, 'dein Kommentar zum Törn' AS what, s.title AS name, c.hidden_at FROM comments c JOIN shares s ON s.id = c.share_id WHERE c.id = ?`,
  photo: `SELECT p.user_id AS owner, CASE WHEN s.id IS NULL THEN 'dein Foto in einem Beitrag' ELSE 'dein Foto zum Törn' END AS what,
            COALESCE(s.title, '') AS name, p.hidden_at FROM photos p LEFT JOIN shares s ON s.id = p.share_id WHERE p.id = ?`,
  profile: `SELECT user_id AS owner, 'dein Profil' AS what, display_name AS name, hidden_at FROM profiles WHERE user_id = ?`,
  boat: `SELECT owner_id AS owner, 'dein Boot' AS what, name, hidden_at FROM boats WHERE id = ?`,
  group: `SELECT owner_id AS owner, 'deine Gruppe' AS what, name, hidden_at FROM groups WHERE id = ?`,
  post: `SELECT p.author_id AS owner, CASE WHEN g.id IS NULL THEN 'dein Beitrag' ELSE 'dein Beitrag in der Gruppe' END AS what,
           COALESCE(g.name, '') AS name, p.hidden_at FROM posts p LEFT JOIN groups g ON g.id = p.group_id WHERE p.id = ?`,
  harbor: `SELECT created_by AS owner, 'dein angelegter Hafen' AS what, name, hidden_at FROM harbors WHERE id = ?`,
};

export interface DecisionNotice {
  kind: ReportKind;
  id: string;
  owner: string;
  email: string;
  what: string;
  name: string;
  wasHidden: boolean;
  reasons: Record<string, number>;
}

/**
 * Vor der Entscheidung lesen, was die Begründung braucht (nach „Löschen“ gibt es das Ziel nicht mehr). Ohne
 * Eigentümer:in, ohne Mail-Adresse oder bei gesperrtem Konto (das hat die Sperr-Begründung, F-296) → null.
 */
export async function prepareDecisionNotice(env: Env, kind: ReportKind, id: string): Promise<DecisionNotice | null> {
  const row = await env.DB.prepare(OWNER[kind]).bind(id).first<{ owner: string | null; what: string; name: string | null; hidden_at: number | null }>();
  if (!row?.owner) return null;
  const u = await env.DB.prepare('SELECT email, locked_at FROM users WHERE id = ?').bind(row.owner).first<{ email: string | null; locked_at: number | null }>();
  if (!u?.email || u.locked_at) return null;
  const { results } = await env.DB.prepare('SELECT reason, COUNT(*) AS n FROM reports WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL GROUP BY reason')
    .bind(kind, id)
    .all<{ reason: string; n: number }>();
  const reasons = Object.fromEntries(results.map((r) => [r.reason, r.n]));
  return { kind, id, owner: row.owner, email: u.email, what: row.what, name: row.name ?? '', wasHidden: !!row.hidden_at, reasons };
}

/**
 * Begründung nach der Entscheidung (F-572, F-573): an die Eigentümer:in, mit Maßnahme, Gründen und Widerspruch an
 * `REPORT_CONTACT`. Ein gescheiterter Versand hält die Entscheidung nicht auf. Der Versand steht im Protokoll
 * (`report_notice` am Konto der Eigentümer:in, ohne Adresse). Liefert, ob verschickt wurde.
 */
export async function sendDecisionNotice(env: Env, adminId: string, n: DecisionNotice | null, decision: ReportDecision, now = Date.now()): Promise<boolean> {
  if (!n) return false;
  const today = await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_log WHERE action = 'report_notice' AND target_kind = 'user' AND target_id = ? AND created_at > ?`)
    .bind(n.owner, now - DAY)
    .first<{ n: number }>();
  if (!shouldNotify({ decision, wasHidden: n.wasHidden, reasons: n.reasons, sentToday: today?.n ?? 0, selfDecided: n.owner === adminId })) return false;
  try {
    await sendMail(env, reportDecisionMail(env, n.email, { decision, what: n.what, name: n.name, reasons: noticeReasons(n.reasons), contact: env.REPORT_CONTACT }));
  } catch (err) {
    console.error('report notice failed', n.kind, n.id, err);
    return false;
  }
  await adminLogStmt(env, adminId, 'report_notice', 'user', n.owner, `Begründung per Mail: ${n.kind} ${n.id} – ${decision}`, now).run();
  return true;
}
