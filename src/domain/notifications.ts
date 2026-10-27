// Benachrichtigungs-Glocke (Konzept 17, F-250 … F-255): Arten, Grenzen und Texte. Rein, ohne DOM und Netz – Worker
// (Schreiben, Lesen, Aufräumen) und Oberfläche (Glocke, Liste) nutzen dieselben Regeln.

/**
 * Arten: neuer Kommentar auf eigenem Törn, Reaktion auf Eigenes, neue Follower, Einladung an mich, Beitrittsanfrage in
 * einer Gruppe, deren Anfragen ich bestätige. Gegenstand (`subject_kind`) je Art: comment → share; reaction → share
 * (auch Fotos des Törns), post, activity; follow → user (ich selbst); invite → invite; request → group.
 */
export const NOTIFICATION_KINDS = ['comment', 'reaction', 'follow', 'invite', 'request'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_SUBJECTS = ['share', 'post', 'activity', 'user', 'invite', 'group'] as const;
export type NotificationSubject = (typeof NOTIFICATION_SUBJECTS)[number];

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

export const isNotificationKind = oneOf(NOTIFICATION_KINDS);
export const isNotificationSubject = oneOf(NOTIFICATION_SUBJECTS);

/**
 * Nur zur Kenntnis: gelesen, sobald die Liste sie gezeigt hat. Alles andere (Kommentare lesen, Einladung oder Anfrage
 * entscheiden) gilt erst als gelesen, wenn man den Gegenstand öffnet – aus der Glocke, per Mail-Link oder direkt.
 */
export const INFORMATIONAL: ReadonlySet<NotificationKind> = new Set(['reaction', 'follow']);

export const NOTIFICATION_LIMITS = {
  /** Einträge in der Liste (neueste zuerst) */
  list: 30,
  /** Badge zeigt höchstens diese Zahl, darüber „99+“ */
  badgeMax: 99,
  /** Zähler frühestens so oft neu laden (Tab wieder sichtbar) – kein Polling */
  refreshMs: 2 * 60_000,
  /** höchstens so viele Bestätigende einer Gruppe bekommen eine Anfrage gemeldet (Fan-out-Deckel) */
  requestFanOut: 20,
  /** gelesene Einträge werden nach so vielen Tagen gelöscht */
  readDays: 30,
  /** alle Einträge (auch ungelesene) werden nach so vielen Tagen gelöscht */
  maxDays: 90,
  /** höchstens so viele Zeilen löscht der nächtliche Lauf je Schritt (Free-Tier-Budget) */
  nightlyBatch: 1000,
} as const;

/** Badge-Text: leer = keins, sonst Zahl bzw. „99+“. */
export const badgeLabel = (n: number): string => (n <= 0 ? '' : n > NOTIFICATION_LIMITS.badgeMax ? `${NOTIFICATION_LIMITS.badgeMax}+` : String(n));

/** Ein Eintrag, wie ihn `GET /api/notifications` liefert – ohne Konto-IDs und E-Mail-Adressen. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  /** Anzahl gebündelter Ereignisse (z. B. 3 neue Kommentare) */
  count: number;
  /** zuletzt handelnde Person – nur mit öffentlichem Profil, sonst null („Jemand“) */
  actor: { name: string; handle: string } | null;
  /** Törn-Titel, Gruppen- bzw. Bootsname – nur Eigenes bzw. was die Person ohnehin sehen darf */
  title: string;
  /** Bezug im Satz: bei Reaktionen „deinen Törn“, „deinen Beitrag in“, „deine Neuigkeit“; bei Einladungen die Einladungsart */
  what: string;
  /** Ziel beim Anklicken (Pfad der eigenen Origin) */
  href: string;
  at: number;
  read: boolean;
}

const short = (s: string, n = 60) => {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const quoted = (s: string) => `„${short(s) || 'Ohne Titel'}“`;
/** „auf deinen Törn „X““ bzw. ohne Titel nur „auf deine Neuigkeit“ */
const about = (what: string, title: string) => (title.trim() ? `${what} ${quoted(title)}` : what);

/** Satz für die Liste (Lit escaped ihn; Namen und Titel sind Nutzertext). */
export function notificationText(n: Pick<NotificationItem, 'kind' | 'count' | 'actor' | 'title' | 'what'>): string {
  const who = n.actor?.name ?? 'Jemand';
  const more = n.count > 1 ? ` und ${n.count - 1} ${n.count === 2 ? 'weitere Person' : 'weitere'}` : '';
  switch (n.kind) {
    case 'comment':
      return n.count > 1 ? `${n.count} neue Kommentare zu ${quoted(n.title)}` : `${who} hat ${quoted(n.title)} kommentiert`;
    case 'reaction':
      return `${who}${more} ${n.count > 1 ? 'haben' : 'hat'} auf ${about(n.what, n.title)} reagiert`;
    case 'follow':
      return `${who}${more} ${n.count > 1 ? 'folgen' : 'folgt'} dir jetzt`;
    case 'invite':
      return `${who} lädt dich ${about(n.what, n.title)} ein`;
    case 'request':
      return n.count > 1 ? `${n.count} neue Beitrittsanfragen für ${quoted(n.title)}` : `${who} möchte ${quoted(n.title)} beitreten`;
  }
}
