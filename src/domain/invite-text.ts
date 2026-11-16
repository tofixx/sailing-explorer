// Texte zu Einladungen (Konzept 10, 14) an einer Stelle – für Einladungsdialog, Posteingang im Konto und Hinweise.
// Rein, ohne DOM: Ziel- und Personennamen sind Nutzertext und werden von Lit beim Einsetzen escaped.

import { VOYAGE_ROLE_SHORT, type VoyageRole } from './crew-roles';
import { APP_NAME } from './brand';

export type InviteKindText = 'boat_admin' | 'boat_member' | 'crew' | 'group' | 'friend';

interface InviteLike {
  kind: InviteKindText;
  groupKind?: 'club' | 'team' | 'class' | null;
  target: string | null;
  /** nur Crew: Rolle, als die eingeladen wird (Konzept 15) */
  role?: VoyageRole;
}

const quote = (s: string | null, fallback: string) => `„${s || fallback}“`;

/** „ins Team“, „in die Klassenvereinigung“, sonst „in den Verein“ */
const groupInto = (k: InviteLike['groupKind']) => (k === 'team' ? 'ins Team' : k === 'class' ? 'in die Klassenvereinigung' : 'in den Verein');

/** Wozu eingeladen wird – Fortsetzung von „X lädt dich …“. */
export function inviteWhat(i: InviteLike): string {
  switch (i.kind) {
    case 'friend':
      return `zu ${APP_NAME} ein`;
    case 'group':
      return `${groupInto(i.groupKind)} ${quote(i.target, 'Gruppe')} ein`;
    case 'boat_admin':
      return `ein, das Boot ${quote(i.target, 'Boot')} mitzuverwalten`;
    case 'boat_member':
      return `in die Stammcrew des Boots ${quote(i.target, 'Boot')} ein`;
    default:
      return `ein, ${i.role && i.role !== 'crew' ? `als ${VOYAGE_ROLE_SHORT[i.role]} ` : ''}in die Crew des Törns ${quote(i.target, 'Törn')}`;
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
    case 'boat_member':
      return 'In der Stammcrew ordnest du deine Törns dem Boot zu und liest seine Neuigkeiten, auch wenn die Bootsseite nicht öffentlich ist. Ob du Beiträge schreiben oder weitere einladen darfst, legt der Eigner fest. Mit öffentlichem Profil erscheinst du namentlich, sonst nur als Anzahl. Du kannst jederzeit austreten.';
    default:
      return 'Solange der Törn öffentlich ist, erscheinst du dort – mit öffentlichem Profil namentlich und auf deiner Profilseite unter „Mitgesegelt“, sonst nur als Anzahl. Deine E-Mail-Adresse sieht niemand. Du kannst dich jederzeit wieder entfernen.';
  }
}

/** Ergebnis nach dem Annehmen – für Dialog und Hinweis. */
export function inviteAcceptedText(r: InviteLike & { requested?: boolean }): string {
  if (r.kind === 'friend') return `Ihr folgt euch jetzt: ${r.target || APP_NAME}`;
  if (r.kind === 'group' && r.requested) return `Deine Beitrittsanfrage an ${quote(r.target, 'die Gruppe')} ist gestellt – sie wird noch bestätigt.`;
  if (r.kind === 'group') return `Du bist jetzt Mitglied von ${quote(r.target, 'der Gruppe')}`;
  if (r.kind === 'boat_admin') return `Du bist jetzt Admin von ${quote(r.target, 'dem Boot')}`;
  if (r.kind === 'boat_member') return `Du bist jetzt in der Stammcrew von ${quote(r.target, 'dem Boot')}`;
  return `Du bist jetzt in der Crew von ${quote(r.target, 'dem Törn')}`;
}

/** Beschriftung des Knopfs zum Ziel nach dem Annehmen. */
export function inviteTargetLabel(kind: InviteKindText): string {
  return kind === 'crew' ? 'Törn ansehen' : kind === 'group' ? 'Zur Gruppe' : kind === 'friend' ? 'Profil ansehen' : 'Bootsseite ansehen';
}

/** Betreff bzw. Titel beim Teilen eines Einladungslinks (F-591). */
export function inviteShareTitle(): string {
  return `Einladung zu ${APP_NAME}`;
}

/**
 * Freundlicher Begleittext zum Einladungslink – für das Teilen-Menü des Geräts und das Mail-Programm (F-591).
 * Der Link selbst steht nicht im Text; Teilen und Mail hängen ihn an.
 */
export function inviteShareText(i: InviteLike): string {
  switch (i.kind) {
    case 'friend':
      return `Ich bin bei ${APP_NAME} – Törns, Fahrtenbuch und Neuigkeiten aus Verein und Hafen. Komm dazu, dann folgen wir einander:`;
    case 'group':
      return `Ich lade dich ${groupInto(i.groupKind)} ${quote(i.target, 'Gruppe')} bei ${APP_NAME} ein:`;
    case 'boat_admin':
      return `Ich lade dich ein, das Boot ${quote(i.target, 'Boot')} bei ${APP_NAME} mitzuverwalten:`;
    case 'boat_member':
      return `Ich lade dich in die Stammcrew des Boots ${quote(i.target, 'Boot')} bei ${APP_NAME} ein:`;
    default:
      return `Ich lade dich ${i.role && i.role !== 'crew' ? `als ${VOYAGE_ROLE_SHORT[i.role]} ` : ''}in die Crew meines Törns ${quote(i.target, 'Törn')} bei ${APP_NAME} ein:`;
  }
}
