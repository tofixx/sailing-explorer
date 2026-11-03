// Lösch-Register (Retro R 3, PRINCIPLES „Erweitern“ 5, F-451 … F-453): für jede D1-Tabelle, jeden Bezug ohne
// Fremdschlüssel (Spalten `*_kind`) und jedes R2-Präfix steht hier, auf welchem Weg es wieder entfernt wird. Ein Test
// (test/functional/cleanup-registry.test.ts) prüft das Register gegen das Schema nach allen Migrationen: neue Tabellen
// und `*_kind`-Spalten ohne Eintrag, behauptete Fremdschlüssel, die es nicht gibt, Arten mit nächtlicher Waisen-Suche,
// die sie nicht wegräumt, und genannte Funktionen, die kein Worker-Modul exportiert, machen ihn rot. Prüfpunkt 6
// (Löschkonzept) beginnt damit hier: eine neue Tabelle, Art oder Datei bekommt zuerst ihren Eintrag.
//
// Reine Daten ohne Worker-Importe (Funktionen als exportierte Namen) – der Worker importiert diese Datei nicht.
import type { ReactionSubject } from '../src/domain/reactions';
import type { NotificationSubject } from '../src/domain/notifications';
import type { ClaimKind } from '../src/domain/claims';
import type { ReportKind } from '../src/domain/comment-text';
import type { LockKind } from '../src/domain/admin';
import type { ChannelKind } from '../src/domain/posts';
import type { FollowKind } from '../src/domain/groups';
import type { CoverKind } from '../src/domain/cover';

/**
 * Name einer von einem Worker-Modul exportierten Funktion. Der Test prüft nur, dass es sie gibt – nicht, dass sie die
 * Tabelle bzw. Art wirklich aufräumt; das sichern die Waisen-Prüfung (F-452) und die Löschweg-Tests der Funktionen.
 */
type Fn = string;

/** Wie Zeilen einer Tabelle (bzw. Dateien eines Präfixes) wieder verschwinden. Mindestens ein Feld ist gesetzt. */
export interface Loeschweg {
  /** Eltern-Tabellen, mit deren Zeile sie per `ON DELETE CASCADE` fallen – der Test prüft es am Schema. */
  cascade?: readonly string[];
  /** Funktionen, die sie ausdrücklich entfernen (einzeln, Eltern-Objekt, Konto, Moderation, Zusammenführen) */
  durch?: readonly Fn[];
  /** nächtliche Frist bzw. Waisen-Suche (worker/retention.ts) */
  nachts?: string;
  /** bleibt bewusst (Nachweis, Zähler) – mit Grund */
  bleibt?: string;
}

/**
 * Jede Tabelle nach allen Migrationen. Eine neue Tabelle braucht hier einen Eintrag (sonst ist der Test rot); Bezüge
 * ohne Fremdschlüssel zusätzlich in `KIND_COLUMNS`.
 */
export const TABLES: Record<string, Loeschweg> = {
  users: { durch: ['purgeUser', 'mergeUsers'], nachts: 'inaktive Konten ohne Törns nach 12 Monaten (purgeUser)' },
  sessions: { cascade: ['users'], durch: ['logout', 'lockTarget', 'purgeUser'], nachts: 'abgelaufene' },
  login_tokens: { durch: ['purgeUser'], nachts: '24 h nach Ablauf' },
  shares: { durch: ['removeShare', 'purgeUser', 'mergeUsers'], nachts: 'Aufbewahrung abgelaufen (EXPIRES_SQL, Saison)' },
  profiles: { cascade: ['users'], durch: ['purgeUser', 'mergeUsers'] },
  boats: { cascade: ['users'], durch: ['removeBoat', 'purgeUser'] },
  boat_admins: { cascade: ['users', 'boats'], durch: ['removeBoatAdmin', 'removeBoat', 'purgeUser', 'mergeUsers'] },
  supports: { bleibt: 'Zahlungsnachweis: nach Kontolöschung ohne Konto-ID', nachts: '10 Jahre nach Ablauf, Gutscheine 2 Jahre' },
  invites: { cascade: ['users', 'shares', 'boats', 'groups'], durch: ['revokeInvite', 'removeBoat', 'removeGroup', 'purgeUser'], nachts: 'abgelaufen oder aufgebraucht' },
  share_crew: { cascade: ['shares', 'users'], durch: ['removeCrew', 'purgeUser', 'mergeUsers'] },
  counters: { bleibt: 'globale Zähler (Speicher), nächtlich neu berechnet' },
  comments: { cascade: ['shares', 'users'], durch: ['removeComment', 'purgeUser'] },
  comment_log: { cascade: ['users'], durch: ['purgeUser'], nachts: 'nach 24 h' },
  reports: { durch: ['deleteShareReports', 'purgeUserReports', 'removePost', 'removeBoat', 'removeGroup', 'removeHarbor'], nachts: 'Waisen, entschiedene nach 180 Tagen (offene anonymisiert)' },
  // Törn-Fotos mit dem Törn, Galerie-Fotos (Konzept 31) mit dem Beitrag – Dateien und Zähler vorher galleryPhotoCleanup
  photos: { cascade: ['shares', 'users', 'posts'], durch: ['removePhoto', 'removeShare', 'purgeUser', 'removePost', 'galleryPhotoCleanup', 'channelGalleryCleanup'] },
  photo_log: { cascade: ['users'], durch: ['purgeUser', 'mergeUsers'], nachts: 'nach 32 Tagen (photoLogCleanup)' },
  cover_log: { cascade: ['users'], durch: ['purgeUser', 'mergeUsers'], nachts: 'nach 2 Tagen (coverLogCleanup)' },
  groups: { cascade: ['users'], durch: ['removeGroup', 'purgeUserGroups'] },
  group_members: { cascade: ['groups', 'users'], durch: ['leaveGroupStmts', 'removeGroup', 'purgeUserGroups', 'mergeUsers'] },
  group_requests: { cascade: ['groups', 'users'], durch: ['withdrawRequest', 'removeGroup', 'purgeUserGroups'], nachts: 'nach 90 Tagen' },
  group_boats: { cascade: ['groups', 'boats'], durch: ['removeGroupBoat', 'boatCleanup', 'removeGroup', 'purgeUserGroups'] },
  posts: { cascade: ['shares', 'groups', 'users'], durch: ['removePost', 'removeGroup', 'channelPostsCleanup', 'purgeUserGroups'], nachts: 'Galerie ohne Foto nach 24 h (emptyGalleries → removePost)' },
  post_log: { durch: ['groupActivityCleanup', 'channelPostsCleanup', 'purgeUserGroups'], nachts: 'nach 24 h' },
  follows: { cascade: ['users'], durch: ['boatCleanup', 'groupActivityCleanup', 'harborActivityCleanup', 'userActivityCleanup'], nachts: 'Waisen' },
  activity: {
    cascade: ['users'],
    durch: ['deleteShareActivity', 'removePost', 'boatCleanup', 'groupActivityCleanup', 'harborActivityCleanup', 'userActivityCleanup'],
    nachts: 'nach einem Jahr, Waisen, ohne Ziel',
  },
  activity_target: { cascade: ['activity'], durch: ['syncShareActivity', 'boatCleanup', 'groupActivityCleanup', 'harborActivityCleanup', 'userActivityCleanup'], nachts: 'Waisen' },
  harbors: { durch: ['removeHarbor', 'mergeHarbor'] },
  reactions: {
    cascade: ['users'],
    durch: ['deleteShareReactions', 'deletePhotoReactions', 'deletePostReactions', 'deleteGroupReactions', 'deleteBoatReactions', 'userReactionCleanup'],
    nachts: 'Waisen',
  },
  reaction_log: { durch: ['userReactionCleanup'], nachts: 'nach 24 h' },
  covers: { durch: ['removeCoverOf', 'purgeUser', 'removeBoat', 'removeGroup'], nachts: 'Waisen samt R2-Datei (sweepOrphanCovers)' },
  passkeys: { cascade: ['users'], durch: ['deletePasskey', 'purgeUser'] },
  webauthn_challenges: { cascade: ['users'], durch: ['purgeUser'], nachts: 'abgelaufene' },
  notifications: {
    cascade: ['users'],
    durch: ['deleteShareNotifications', 'deleteBoatNotifications', 'deletePostNotifications', 'deleteInviteNotifications', 'groupNotificationCleanup', 'userNotificationCleanup'],
    nachts: 'Gelesenes und Altes nach Frist, Waisen',
  },
  push_subscriptions: { cascade: ['users'], durch: ['deletePush', 'userNotificationCleanup'], nachts: 'ohne Zustellung seit Frist' },
  locks: { durch: ['unlockTarget', 'removeTarget', 'expireLocks'], nachts: 'Sperrfrist abgelaufen (Objekt wird gelöscht), Waisen' },
  admin_log: { bleibt: 'Protokoll der Moderation (Konzept 18.10)', nachts: 'nach Frist, außer zu noch Gesperrtem' },
  harbor_redirects: { cascade: ['harbors'], durch: ['removeHarbor', 'mergeHarbor'] },
  claims: { durch: ['claimTargetCleanup', 'userClaimCleanup'], nachts: 'Angaben nach Widerspruchsfrist, Abgelehntes nach Wartefrist, Waisen' },
  share_groups: { cascade: ['shares', 'groups'], durch: ['deleteShareGroups', 'removeGroup', 'purgeUserGroups'] },
  // Umfragen (Konzept 29): Stimmen fallen mit dem Beitrag (jeder Löschweg von posts) und mit dem Konto der Wählenden
  poll_votes: { cascade: ['posts', 'users'], durch: ['removePost', 'removeGroup', 'channelPostsCleanup', 'purgeUser', 'mergeUsers'] },
  channel_pins: { cascade: ['posts'], durch: ['setPin', 'channelPostsCleanup', 'groupActivityCleanup', 'userActivityCleanup'], nachts: 'Waisen' },
  // Veranstaltungen (Konzept 30): Termin und Zusagen fallen mit dem Beitrag (jeder Löschweg von posts), Zusagen auch mit
  // dem Konto; Frist 12 Monate nach Ende über removePost
  post_events: { cascade: ['posts'], durch: ['removePost', 'removeGroup', 'channelPostsCleanup', 'purgeUserGroups'], nachts: '12 Monate nach Ende (expireEvents)' },
  event_rsvps: { cascade: ['post_events', 'users'], durch: ['removePost', 'purgeUser', 'mergeUsers'] },
  // Wertung (Konzept 32): Vorschläge der Plattform bleiben, bis Admins sie löschen; Vereinsvorlagen fallen mit dem Verein
  // (removeGroup, auch über purgeUserGroups). Keine Konto-ID. Opt-in steht in group_members und fällt mit der Mitgliedschaft.
  scoring_templates: { cascade: ['groups'], durch: ['deleteTemplate', 'removeGroup'] },
};

/** Je Art eines Bezugs ohne Fremdschlüssel: wer räumt beim Löschen des Gegenstands auf, gibt es ein nächtliches Netz? */
export interface ArtWeg {
  /** Aufräumfunktionen der Löschwege des Gegenstands */
  durch: readonly Fn[];
  /** Die nächtliche Waisen-Suche entfernt Zeilen, deren Gegenstand fehlt – der Test prüft das je Art. */
  waise: boolean;
}

type Arten<K extends string> = Record<K, ArtWeg>;

const all = (durch: readonly Fn[], waise = true): ArtWeg => ({ durch, waise });

/**
 * Bezüge ohne Fremdschlüssel (`<tabelle>.<spalte>`): jede Spalte `*_kind` (und `covers.kind`). Wo die Arten als Typ in
 * `src/domain` stehen, verlangt der Typecheck für jede neue Art einen Eintrag. `bleibt`: Bezug wird nie aufgeräumt.
 */
export const KIND_COLUMNS: Record<string, Partial<Record<string, ArtWeg>> | { bleibt: string }> = {
  'reactions.subject_kind': {
    share: all(['deleteShareReactions', 'userReactionCleanup']),
    post: all(['deletePostReactions', 'deleteGroupReactions', 'channelPostsCleanup', 'userReactionCleanup']),
    photo: all(['deletePhotoReactions', 'deleteShareReactions', 'galleryPhotoCleanup', 'userReactionCleanup']),
    activity: all(['deleteShareReactions', 'deleteGroupReactions', 'deleteBoatReactions', 'harborActivityCleanup', 'removePost', 'userReactionCleanup']),
  } satisfies Arten<ReactionSubject>,
  'notifications.subject_kind': {
    share: all(['deleteShareNotifications']),
    post: all(['deletePostNotifications', 'groupNotificationCleanup', 'channelPostsCleanup', 'userNotificationCleanup']),
    activity: all(['nightlyNotificationCleanup']),
    user: all(['nightlyNotificationCleanup']),
    invite: all(['deleteInviteNotifications', 'deleteShareNotifications', 'deleteBoatNotifications', 'groupNotificationCleanup', 'userNotificationCleanup']),
    group: all(['groupNotificationCleanup']),
    claim: all(['claimTargetCleanup', 'userClaimCleanup', 'nightlyClaimCleanup']),
  } satisfies Arten<NotificationSubject>,
  'activity.subject_kind': {
    share: all(['deleteShareActivity', 'userActivityCleanup']),
    post: all(['removePost', 'channelPostsCleanup', 'userActivityCleanup']),
    boat: all(['boatCleanup']),
    group: all(['groupActivityCleanup']),
    // Konto: userActivityCleanup beim Löschen, mergeUsers hängt um – kein eigenes nächtliches Netz
    user: all(['userActivityCleanup', 'mergeUsers'], false),
  },
  'activity_target.target_kind': {
    group: all(['groupActivityCleanup']),
    boat: all(['boatCleanup']),
    user: all(['userActivityCleanup', 'mergeUsers']),
    harbor: all(['harborActivityCleanup', 'mergeHarbor']),
  } satisfies Arten<FollowKind>, // Ziele: dieselben Arten wie Folgen (TargetKind in activity.ts)
  'follows.target_kind': {
    user: all(['userActivityCleanup', 'mergeUsers']),
    boat: all(['boatCleanup']),
    group: all(['groupActivityCleanup']),
    harbor: all(['harborActivityCleanup', 'mergeHarbor']),
  } satisfies Arten<FollowKind>,
  'channel_pins.channel_kind': {
    user: all(['userActivityCleanup', 'mergeUsers']),
    group: all(['groupActivityCleanup']),
    harbor: all(['channelPostsCleanup', 'mergeHarbor']),
    boat: all(['channelPostsCleanup']),
  } satisfies Arten<ChannelKind>,
  // Beiträge selbst: Profil und Gruppe zusätzlich per Fremdschlüssel (author_id, group_id); Hafen und Boot nur über
  // channelPostsCleanup – kein nächtliches Netz.
  'posts.channel_kind': {
    user: all(['purgeUserGroups', 'mergeUsers'], false),
    group: all(['removeGroup'], false),
    harbor: all(['channelPostsCleanup', 'mergeHarbor'], false),
    boat: all(['channelPostsCleanup'], false),
  } satisfies Arten<ChannelKind>,
  'claims.target_kind': {
    group: all(['claimTargetCleanup', 'nightlyClaimCleanup']),
    harbor: all(['claimTargetCleanup', 'mergeHarbor', 'nightlyClaimCleanup']),
  } satisfies Arten<ClaimKind>,
  'reports.target_kind': {
    share: all(['deleteShareReports', 'purgeUserReports']),
    comment: all(['removeComment', 'deleteShareReports', 'purgeUserReports']),
    photo: all(['removePhoto', 'deleteShareReports', 'galleryPhotoCleanup', 'purgeUserReports']),
    profile: all(['purgeUserReports', 'mergeUsers']),
    boat: all(['removeBoat', 'purgeUserReports']),
    group: all(['removeGroup']),
    post: all(['removePost', 'removeGroup', 'channelPostsCleanup', 'purgeUserGroups']),
    harbor: all(['removeHarbor', 'mergeHarbor']),
  } satisfies Arten<ReportKind>,
  'locks.target_kind': {
    user: all(['unlockTarget', 'removeTarget', 'orphanLocksStmt']),
    share: all(['unlockTarget', 'removeTarget', 'orphanLocksStmt']),
    boat: all(['unlockTarget', 'removeTarget', 'orphanLocksStmt']),
    group: all(['unlockTarget', 'removeTarget', 'orphanLocksStmt']),
    harbor: all(['unlockTarget', 'removeTarget', 'orphanLocksStmt']),
  } satisfies Arten<LockKind>,
  'covers.kind': {
    u: all(['removeCoverOf', 'purgeUser', 'sweepOrphanCovers']),
    b: all(['removeCoverOf', 'removeBoat', 'sweepOrphanCovers']),
    g: all(['removeCoverOf', 'removeGroup', 'sweepOrphanCovers']),
  } satisfies Arten<CoverKind>,
  'admin_log.target_kind': { bleibt: 'Protokoll nennt auch Gelöschtes; Frist in retention.ts' },
};

/** R2-Präfixe: Schlüssel-Funktion (einzige Stelle für das Präfix) und Löschweg. Jedes `TRACKS.put` nutzt eine davon. */
export const R2_PREFIXES: Record<string, { key: Fn; weg: Loeschweg }> = {
  'shares/': { key: 'shareKey', weg: { durch: ['removeShare', 'purgeUser'], nachts: 'mit dem Törn (Aufbewahrung)' } },
  'previews/': { key: 'previewKey', weg: { durch: ['removeShare', 'purgeUser'], nachts: 'mit dem Törn (Aufbewahrung)' } },
  // photos/<shareId>/… bzw. photos/<postId>/… (Galerie, Konzept 31)
  'photos/': {
    key: 'photoKey',
    weg: { durch: ['removePhoto', 'removeShare', 'purgeUser', 'removePost', 'galleryPhotoCleanup', 'channelGalleryCleanup', 'removeGroup'], nachts: 'mit dem Törn (Aufbewahrung) bzw. dem leeren Galerie-Beitrag' },
  },
  'covers/': { key: 'coverKey', weg: { durch: ['removeCoverOf'], nachts: 'Waisen (sweepOrphanCovers)' } },
};

