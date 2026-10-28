// Benachrichtigungs-Glocke (Konzept 17, F-250 … F-258): Arten, Grenzen und Texte. Rein, ohne DOM und Netz – Worker
// (Schreiben, Lesen, Aufräumen) und Oberfläche (Glocke, Liste) nutzen dieselben Regeln.

/**
 * Arten: neuer Kommentar auf eigenem oder mitkommentiertem Törn, Reaktion auf Eigenes, neue Follower, Einladung an mich, Beitrittsanfrage in
 * einer Gruppe, deren Anfragen ich bestätige – und Hinweise des Betreibers zum Konto: Törn wird bald gelöscht, neuer
 * Passkey. Gegenstand (`subject_kind`) je Art: comment, expiry → share; reaction → share (auch Fotos des Törns), post,
 * activity; follow, passkey → user (ich selbst); invite → invite; request → group.
 */
export const NOTIFICATION_KINDS = ['comment', 'reaction', 'follow', 'invite', 'request', 'expiry', 'passkey'] as const;
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
export const INFORMATIONAL: ReadonlySet<NotificationKind> = new Set(['reaction', 'follow', 'passkey']);

// ---------------------------------------------------------------- Kanäle (Konzept 17.6)

/** Zusätzlich zur Glocke (die immer alles zeigt): nichts, Mail oder Push aufs Gerät. */
export const CHANNELS = ['none', 'mail', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];
export const isChannel = oneOf(CHANNELS);
export const CHANNEL_LABEL: Record<Channel, string> = { none: 'Keine', mail: 'Mail', push: 'Push' };

/** Wählbare Arten mit Standard. Mail heißt: tägliche Sammelmail – außer Einladungen, die kommen sofort. */
export const CHOOSABLE = ['comment', 'reaction', 'follow', 'invite', 'request'] as const;
export type ChoosableKind = (typeof CHOOSABLE)[number];
export const isChoosable = oneOf(CHOOSABLE);
export const CHOOSABLE_LABEL: Record<ChoosableKind, string> = {
  comment: 'Kommentare auf deinen Törns und Törns, die du kommentiert hast',
  reaction: 'Reaktionen auf deine Inhalte',
  follow: 'Neue Follower',
  invite: 'Einladungen an dich',
  request: 'Beitrittsanfragen in deinen Gruppen',
};
export const DEFAULT_CHANNELS: Record<ChoosableKind, Channel> = { comment: 'none', reaction: 'none', follow: 'none', invite: 'mail', request: 'none' };
export type NotifyPrefs = Record<ChoosableKind, Channel>;

/** Gespeicherte Auswahl (JSON in `users.notify_prefs`) lesen – Unbekanntes fällt auf den Standard zurück. */
export function parsePrefs(raw: unknown): NotifyPrefs {
  let obj: Record<string, unknown> = {};
  try {
    obj = typeof raw === 'string' && raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    obj = {};
  }
  return Object.fromEntries(CHOOSABLE.map((k) => [k, isChannel(obj?.[k]) ? obj[k] : DEFAULT_CHANNELS[k]])) as NotifyPrefs;
}

/** Hinweise des Betreibers zum Konto: immer in der Glocke und immer per Mail, nicht abschaltbar. */
export const MANDATORY: ReadonlySet<NotificationKind> = new Set(['expiry', 'passkey']);
export const MANDATORY_HINT = 'Immer per Mail: Anmeldung, Sicherheitshinweise (z. B. neuer Passkey) und Hinweise, bevor Törns gelöscht werden.';

export const NOTIFICATION_LIMITS = {
  /** Einträge in der Liste (neueste zuerst) */
  list: 30,
  /** Badge zeigt höchstens diese Zahl, darüber „99+“ */
  badgeMax: 99,
  /** Zähler frühestens so oft neu laden (Tab wieder sichtbar) – kein Polling */
  refreshMs: 2 * 60_000,
  /** höchstens so viele Bestätigende einer Gruppe bekommen eine Anfrage gemeldet (Fan-out-Deckel) */
  requestFanOut: 20,
  /** höchstens so viele Empfänger je Kommentar: Eigentümer:in und die zuletzt Mitkommentierenden (Konzept 17.9.1) */
  commentFanOut: 50,
  /** gelesene Einträge werden nach so vielen Tagen gelöscht */
  readDays: 30,
  /** alle Einträge (auch ungelesene) werden nach so vielen Tagen gelöscht */
  maxDays: 90,
  /** höchstens so viele Zeilen löscht der nächtliche Lauf je Schritt (Free-Tier-Budget) */
  nightlyBatch: 1000,
  /** Push-Abos, die so lange nichts zugestellt haben, werden gelöscht */
  pushStaleDays: 365,
  /** Push-Abos (Geräte) je Konto; das älteste fällt heraus */
  pushPerUser: 10,
  /** höchstens so viele Geräte bekommen je Ereignis einen Weckruf (Subrequests im Free Tier: 50) */
  pushPerEvent: 20,
  /** offene Live-Verbindungen (Tabs, Geräte) je Konto */
  liveSockets: 10,
  /** Live-Verbindung: nach einem Abbruch frühestens so spät neu verbinden, dann verdoppelt bis maxRetryMs */
  retryMs: 5_000,
  maxRetryMs: 5 * 60_000,
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
  /** fertiger Satz (notificationText) – für den Service Worker, der keine eigenen Regeln mitbringt */
  text: string;
}

/**
 * Zeile für die tägliche Sammelmail – ohne Namen und ohne Texte anderer (Mails verlassen die Plattform), nur Anzahl
 * und eigener Gegenstand.
 */
export function mailLine(n: Pick<NotificationItem, 'kind' | 'count' | 'title'>): string {
  const many = (one: string, more: string) => (n.count === 1 ? one : `${n.count} ${more}`);
  switch (n.kind) {
    case 'comment':
      return `${quoted(n.title)}: ${many('1 neuer Kommentar', 'neue Kommentare')}`;
    case 'reaction':
      return `${n.title.trim() ? quoted(n.title) : 'Deine Neuigkeit'}: ${many('1 Reaktion', 'Reaktionen')}`;
    case 'follow':
      return many('1 neue Person folgt dir', 'neue Personen folgen dir');
    case 'invite':
      return 'Eine Einladung an dich';
    case 'request':
      return `${quoted(n.title)}: ${many('1 Beitrittsanfrage', 'Beitrittsanfragen')}`;
    default:
      return '';
  }
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
    case 'expiry':
      return `${quoted(n.title)} wird ${n.what} gelöscht – unterstützen, um ihn zu behalten`;
    case 'passkey':
      return `Neuer Passkey an deinem Konto${n.title ? `: ${quoted(n.title)}` : ''} – warst du das nicht, entferne ihn`;
  }
}
