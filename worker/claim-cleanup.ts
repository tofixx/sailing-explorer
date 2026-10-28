// Verifizierung (Konzept 20.5, 20.8): Bausteine für Nachfolge-Sperre und Aufräumen – ohne Abhängigkeiten zu anderen Modulen,
// damit Gruppen, Häfen, Konten, Admin-Werkzeuge und der nächtliche Lauf sie in ihre Batches aufnehmen können.
import type { Env } from './env';
import { CLAIM_LIMITS, type ClaimKind } from '../src/domain/claims';
import { ADOPTABLE_HARBOR_SQL } from './claim-sql';

export { displacedSql } from './claim-sql';

/**
 * Darf ein Hafen ohne Anleger:in über „wer zuerst die Position setzt“ (Fahrtenbuch L3) übernommen werden? Nicht bei
 * verifizierten oder je verifizierten Häfen (Konzept 20.5, `ADOPTABLE_HARBOR_SQL`).
 */
export async function mayAdoptHarbor(env: Env, harborId: string): Promise<boolean> {
  return !!(await env.DB.prepare(ADOPTABLE_HARBOR_SQL).bind(harborId).first());
}

/** Objekt gelöscht (Gruppe, Hafen, auch Zusammenführen): Anträge dazu und ihre Benachrichtigungen. */
export const claimTargetCleanup = (env: Env, kind: ClaimKind, id: string): D1PreparedStatement[] => [
  env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'claim' AND subject_id IN (SELECT id FROM claims WHERE target_kind = ?1 AND target_id = ?2)`).bind(kind, id),
  env.DB.prepare('DELETE FROM claims WHERE target_kind = ? AND target_id = ?').bind(kind, id),
];

/**
 * Konto gelöscht (`purgeUser`, auch inaktiv): eigene offene und entschiedene Anträge mit ihren Benachrichtigungen;
 * angenommene bleiben ohne Konto-ID – sie tragen die Sperre gegen Verdrängte (20.5, 20.6). Als Verdrängte:r wird die ID
 * geleert (ohne Konto wirkungslos, 20.9 Frage 5). Häfen, die das Konto verifiziert vertrat, verlieren das Abzeichen
 * (Gruppen: `purgeUserGroups`).
 */
export const userClaimCleanup = (env: Env, userId: string): D1PreparedStatement[] => [
  env.DB.prepare(`DELETE FROM notifications WHERE subject_kind = 'claim' AND subject_id IN (SELECT id FROM claims WHERE user_id = ?)`).bind(userId),
  env.DB.prepare(`DELETE FROM claims WHERE user_id = ? AND status <> 'accepted'`).bind(userId),
  env.DB.prepare(`UPDATE claims SET user_id = NULL WHERE user_id = ?`).bind(userId),
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
