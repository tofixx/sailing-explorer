// Rollen am Törn (Konzept 15, F-275 … F-280): reine Regeln ohne DOM und Netz – genutzt vom Worker (Prüfen) und von
// der Oberfläche (Auswahl, Texte).

export const VOYAGE_ROLES = ['skipper', 'co', 'crew', 'guest'] as const;
export type VoyageRole = (typeof VOYAGE_ROLES)[number];

export const VOYAGE_ROLE_LABEL: Record<VoyageRole, string> = {
  skipper: 'Skipper:in',
  co: 'Co-Skipper:in / Wachführer:in',
  crew: 'Crew',
  guest: 'Gast',
};
/** Kurzform für Chips und Listen */
export const VOYAGE_ROLE_SHORT: Record<VoyageRole, string> = { skipper: 'Skipper:in', co: 'Co-Skipper:in', crew: 'Crew', guest: 'Gast' };

/** Rollen, die ein Crew-Mitglied sich selbst geben und die eine Einladung vorgeben darf – Skipper vergibt nur der Eigentümer. */
export const SELF_ROLES = ['co', 'crew', 'guest'] as const satisfies readonly VoyageRole[];

export const isVoyageRole = (v: unknown): v is VoyageRole => typeof v === 'string' && (VOYAGE_ROLES as readonly string[]).includes(v);
export const isSelfRole = (v: unknown): v is (typeof SELF_ROLES)[number] => typeof v === 'string' && (SELF_ROLES as readonly string[]).includes(v);

/** Gespeicherte Rolle lesen: Unbekanntes gilt als „Crew“ (fail safe – nie als Skipper). */
export const voyageRole = (v: unknown): VoyageRole => (isVoyageRole(v) ? v : 'crew');

/**
 * Darf `actor` die Rolle von `target` auf `role` setzen? Der Eigentümer setzt alle Rollen; ein Crew-Mitglied nur die
 * eigene und nie „Skipper“ (sonst könnte sich jede:r selbst zum Skipper machen und andere bestätigen).
 */
export function canSetCrewRole(actor: { isOwner: boolean; isSelf: boolean }, role: VoyageRole): boolean {
  if (actor.isOwner) return true;
  return actor.isSelf && isSelfRole(role);
}

