// Texte zu Einladungen (Konzept 10, 14) an einer Stelle – für Einladungsdialog, Posteingang im Konto und Hinweise.
// Rein, ohne DOM: Ziel- und Personennamen sind Nutzertext und werden von Lit beim Einsetzen escaped.

export type InviteKindText = 'boat_admin' | 'crew' | 'group' | 'friend';

interface InviteLike {
  kind: InviteKindText;
  groupKind?: 'club' | 'team' | null;
  target: string | null;
}

const quote = (s: string | null, fallback: string) => `„${s || fallback}“`;

/** Wozu eingeladen wird – Fortsetzung von „X lädt dich …“. */
export function inviteWhat(i: InviteLike): string {
  switch (i.kind) {
    case 'friend':
      return 'zu Sail Explorer ein';
    case 'group':
      return `${i.groupKind === 'team' ? 'ins Team' : 'in den Verein'} ${quote(i.target, 'Gruppe')} ein`;
    case 'boat_admin':
      return `ein, das Boot ${quote(i.target, 'Boot')} mitzuverwalten`;
    default:
      return `ein, in die Crew des Törns ${quote(i.target, 'Törn')}`;
  }
}

/** Was die Annahme bedeutet. */
export function inviteExplain(i: Pick<InviteLike, 'kind'>): string {
  switch (i.kind) {
    case 'friend':
      return 'Nimmst du an, folgt ihr einander und seht eure öffentlichen Törns und Neuigkeiten. Entfolgen geht jederzeit.';
    case 'group':
      return 'Als Mitglied siehst du die Neuigkeiten der Gruppe und kannst deine Boote zuordnen. Je nach Gruppe bestätigen Admins deine Aufnahme noch. Mitgliedschaft öffnet keine nicht öffentlichen Törns anderer. Mit öffentlichem Profil erscheinst du namentlich, sonst nur als Anzahl. Du kannst jederzeit austreten.';
    case 'boat_admin':
      return 'Als Admin bearbeitest du die Bootsseite und ordnest deine Törns dem Boot zu. Löschen und weitere Admins einladen kann nur der Eigner. Du kannst das Boot jederzeit wieder verlassen.';
    default:
      return 'Solange der Törn öffentlich ist, erscheinst du dort – mit öffentlichem Profil namentlich und auf deiner Profilseite unter „Mitgesegelt“, sonst nur als Anzahl. Deine E-Mail-Adresse sieht niemand. Du kannst dich jederzeit wieder entfernen.';
  }
}

/** Ergebnis nach dem Annehmen – für Dialog und Hinweis. */
export function inviteAcceptedText(r: InviteLike & { requested?: boolean }): string {
  if (r.kind === 'friend') return `Ihr folgt euch jetzt: ${r.target || 'Sail Explorer'}`;
  if (r.kind === 'group' && r.requested) return `Deine Beitrittsanfrage an ${quote(r.target, 'die Gruppe')} ist gestellt – sie wird noch bestätigt.`;
  if (r.kind === 'group') return `Du bist jetzt Mitglied von ${quote(r.target, 'der Gruppe')}`;
  if (r.kind === 'boat_admin') return `Du bist jetzt Admin von ${quote(r.target, 'dem Boot')}`;
  return `Du bist jetzt in der Crew von ${quote(r.target, 'dem Törn')}`;
}

/** Beschriftung des Knopfs zum Ziel nach dem Annehmen. */
export function inviteTargetLabel(kind: InviteKindText): string {
  return kind === 'crew' ? 'Törn ansehen' : kind === 'group' ? 'Zur Gruppe' : kind === 'friend' ? 'Profil ansehen' : 'Bootsseite ansehen';
}
