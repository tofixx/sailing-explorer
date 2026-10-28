// Verifizierung (Konzept 20.5, 20.8): SQL-Bausteine für Nachfolge-Sperre und Aufräumen – ohne weitere Abhängigkeiten,
// damit Gruppen, Häfen, Konten, Admin-Werkzeuge und der nächtliche Lauf sie in ihre Batches aufnehmen können.
import type { Env } from './env';
import { CLAIM_LIMITS, type ClaimKind } from '../src/domain/claims';

/**
 * SQL-Bedingung „Konto :user ist für Objekt :kind/:id verdrängt“ (angenommener Antrag mit ihm als bisheriger
 * Eigner:in). `user` und `id` sind SQL-Ausdrücke (Spalten oder Parameter), `kind` ein fester Wert.
 */
export const displacedSql = (kind: ClaimKind, id: string, user: string): string =>
  `EXISTS (SELECT 1 FROM claims dc WHERE dc.target_kind = '${kind === 'group' ? 'group' : 'harbor'}' AND dc.target_id = ${id}
     AND dc.status = 'accepted' AND dc.previous_user_id = ${user})`;

/**
 * Darf `userId` einen Hafen ohne Anleger:in übernehmen (Fahrtenbuch L3: wer zuerst die Position setzt)? Nie bei einem
 * verifizierten oder je verifizierten Hafen (angenommener Antrag besteht) – damit auch nie für Verdrängte, die es nur
 * dort gibt. Dort setzt nur die Moderation eine neue Anleger:in (Konzept 20.5).
 */
export async function mayAdoptHarbor(env: Env, harbor: { id: string; verified_at?: number | null }): Promise<boolean> {
  if (harbor.verified_at) return false;
  const row = await env.DB.prepare(`SELECT 1 AS x FROM claims WHERE target_kind = 'harbor' AND target_id = ? AND status = 'accepted' LIMIT 1`)
    .bind(harbor.id)
    .first();
  return !row;
}

/** Objekt gelöscht (Gruppe, Hafen, auch Zusammenführen): Anträge dazu und ihre Benachrichtigungen. */
export const claimTargetCleanup = (env: Env, kind: ClaimKind, id: string): D1PreparedStatement[] => [
  env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'claim' AND subject_id IN (SELECT id FROM claims WHERE target_kind = ?1 AND target_id = ?2)`).bind(kind, id),
  env.DB.prepare('DELETE FROM claims WHERE target_kind = ? AND target_id = ?').bind(kind, id),
];

/**
 * Konto gelöscht (`purgeUser`, auch inaktiv): eigene Anträge mit ihren Benachrichtigungen; als Verdrängte:r wird die ID
 * geleert (ohne Konto wirkungslos, 20.9 Frage 5). Häfen, die das Konto verifiziert vertrat, verlieren das Abzeichen
 * (Gruppen: `purgeUserGroups`).
 */
export const userClaimCleanup = (env: Env, userId: string): D1PreparedStatement[] => [
  env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'claim' AND subject_id IN (SELECT id FROM claims WHERE user_id = ?)`).bind(userId),
  env.DB.prepare('DELETE FROM claims WHERE user_id = ?').bind(userId),
  env.DB.prepare('UPDATE claims SET previous_user_id = NULL WHERE previous_user_id = ?').bind(userId),
  env.DB.prepare('UPDATE harbors SET verified_at = NULL WHERE created_by = ? AND verified_at IS NOT NULL').bind(userId),
];

/** Verifizierung endet ohne Antrag (Eigner-Wechsel durch Admins, Entziehen): Abzeichen weg. */
export const unverifyStmt = (env: Env, kind: ClaimKind, id: string): D1PreparedStatement =>
  env.DB.prepare(`UPDATE ${kind === 'group' ? 'groups' : 'harbors'} SET verified_at = NULL WHERE id = ?`).bind(id);

/**
 * Nächtlich (Konzept 20.8): Angaben angenommener Anträge nach der Widerspruchsfrist leeren, abgelehnte, abgelaufene und
 * zurückgezogene nach der Wartefrist löschen, Anträge ohne Objekt löschen. Das Ablaufen offener Anträge (mit Hinweis an
 * die Antragsteller:in) macht `expireClaims` in worker/claims.ts.
 */
export function nightlyClaimCleanup(env: Env, now: number): D1PreparedStatement[] {
  const L = CLAIM_LIMITS;
  return [
    env.DB.prepare(
      `UPDATE claims SET role_text = '', reason = '', contact = '', evidence_url = ''
       WHERE status = 'accepted' AND decided_at < ? AND (role_text <> '' OR reason <> '' OR contact <> '' OR evidence_url <> '')`,
    ).bind(now - L.keepDetailsMs),
    env.DB.prepare(
      `DELETE FROM notifications WHERE subject_kind = 'claim' AND subject_id IN (SELECT id FROM claims WHERE status IN ('rejected', 'expired', 'withdrawn') AND decided_at < ?)`,
    ).bind(now - L.keepRejectedMs),
    env.DB.prepare(`DELETE FROM claims WHERE status IN ('rejected', 'expired', 'withdrawn') AND decided_at < ?`).bind(now - L.keepRejectedMs),
    env.DB.prepare(
      `DELETE FROM claims WHERE (target_kind = 'group' AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = claims.target_id))
         OR (target_kind = 'harbor' AND NOT EXISTS (SELECT 1 FROM harbors h WHERE h.id = claims.target_id))`,
    ),
  ];
}
