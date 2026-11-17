// Stammcrew eines Boots (Konzept 41, F-270 … F-274): reine Regeln ohne DOM und Netz – genutzt vom Worker (Prüfen)
// und von der Oberfläche (Schalter, Texte).

/** Wer eigene Törns dem Boot zuordnen darf (außer Eigner und Admins, die es immer dürfen). */
export const ASSIGN_MODES = ['crew', 'clubs', 'anyone'] as const;
export type AssignMode = (typeof ASSIGN_MODES)[number];
export const isAssignMode = (v: unknown): v is AssignMode => typeof v === 'string' && (ASSIGN_MODES as readonly string[]).includes(v);

export const ASSIGN_MODE_LABEL: Record<AssignMode, string> = {
  crew: 'Stammcrew',
  clubs: 'Stammcrew und Mitglieder der Vereine des Boots',
  anyone: 'Alle, die dem Boot folgen (z. B. Charter)',
};

export const BOAT_CREW_LIMITS = {
  /** Stammcrew je Boot, offene Einladungen zählen mit */
  members: 50,
  /** freier Titel ohne Rechte */
  titleMax: 40,
  /** „Alle, die folgen“: Konten jünger als das ordnen nicht zu (gegen Wegwerfkonten) */
  anyoneMinAgeMs: 7 * 86_400_000,
} as const;

/** Schalter des Eigners; gespeicherte Werte außerhalb der Liste gelten als der strengste („nur Stammcrew“). */
export interface CrewRights {
  /** Stammcrew schreibt Beiträge am Boot */
  post: boolean;
  /** Stammcrew lädt weitere zur Stammcrew ein */
  invite: boolean;
  assign: AssignMode;
}

export const crewRights = (row: { crew_post?: number | null; crew_invite?: number | null; crew_assign?: string | null }): CrewRights => ({
  post: row.crew_post === 1,
  invite: row.crew_invite === 1,
  assign: isAssignMode(row.crew_assign) ? row.crew_assign : 'crew',
});

/** Stufe am Boot aus Sicht der Rechte: Eigner, Admin, Stammcrew oder nichts. */
export type BoatStanding = 'owner' | 'admin' | 'crew' | null;

/** Darf diese Person Beiträge am Boot schreiben? Eigner und Admins immer, die Stammcrew mit Schalter. */
export const canPostOnBoat = (standing: BoatStanding, rights: Pick<CrewRights, 'post'>): boolean =>
  standing === 'owner' || standing === 'admin' || (standing === 'crew' && rights.post);

/** Darf diese Person zur Stammcrew einladen? Eigner und Admins immer, die Stammcrew mit Schalter. */
export const canInviteToCrew = (standing: BoatStanding, rights: Pick<CrewRights, 'invite'>): boolean =>
  standing === 'owner' || standing === 'admin' || (standing === 'crew' && rights.invite);

/** Titel bereinigen: eine Zeile, höchstens 40 Zeichen; leer erlaubt. */
export const cleanCrewTitle = (v: unknown): string | null => {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > BOAT_CREW_LIMITS.titleMax ? null : t;
};
