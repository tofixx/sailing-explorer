// Benachrichtigungs-Glocke (Konzept 17, F-250 … F-258): Arten, Grenzen und Texte. Rein, ohne DOM und Netz – Worker
// (Schreiben, Lesen, Aufräumen) und Oberfläche (Glocke, Liste) nutzen dieselben Regeln.
import { claimResultText, isClaimStatus } from './claims';

/**
 * Arten: neuer Kommentar auf eigenem oder mitkommentiertem Törn, Reaktion auf Eigenes, neue Follower, Einladung an mich, Beitrittsanfrage in
 * einer Gruppe, deren Anfragen ich bestätige – und Hinweise des Betreibers zum Konto: Törn wird bald gelöscht, neuer
 * Passkey. Gegenstand (`subject_kind`) je Art: comment, expiry → share; reaction → share (auch Fotos des Törns), post,
 * activity; follow, passkey → user (ich selbst); invite → invite; request → group. Verifizierung (Konzept 20.8): neuer
 * Antrag an die Admins (`claim`), Entscheidung an die Antragsteller:in (`claim_result`), Übertragung an die verdrängte
 * Person (`claim_transfer`) – alle → claim. Umfrage beendet (`poll_closed`, Konzept 29) an die Autor:in → post.
 */
export const NOTIFICATION_KINDS = ['comment', 'reaction', 'follow', 'invite', 'request', 'expiry', 'passkey', 'claim', 'claim_result', 'claim_transfer', 'post', 'poll_closed'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_SUBJECTS = ['share', 'post', 'activity', 'user', 'invite', 'group', 'claim'] as const;
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
export const INFORMATIONAL: ReadonlySet<NotificationKind> = new Set(['reaction', 'follow', 'passkey', 'claim_result', 'claim_transfer', 'poll_closed']);

// ---------------------------------------------------------------- Kanäle (Konzept 17.6)

/** Zusätzlich zur Glocke (die immer alles zeigt): nichts, Mail oder Push aufs Gerät. */
/** `off`: gar nicht, auch nicht in der Glocke – nur für Arten, die standardmäßig aus sind (neue Beiträge, F-416). */
export const CHANNELS = ['off', 'none', 'mail', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];
export const isChannel = oneOf(CHANNELS);
export const CHANNEL_LABEL: Record<Channel, string> = { off: 'Aus', none: 'Nur Glocke', mail: 'Mail', push: 'Push' };

/** Wählbare Arten mit Standard. Mail heißt: tägliche Sammelmail – außer Einladungen, die kommen sofort. */
export const CHOOSABLE = ['comment', 'reaction', 'follow', 'invite', 'request', 'post'] as const;
export type ChoosableKind = (typeof CHOOSABLE)[number];
export const isChoosable = oneOf(CHOOSABLE);
export const CHOOSABLE_LABEL: Record<ChoosableKind, string> = {
  comment: 'Kommentare auf deinen Törns und Törns, die du kommentiert hast',
  reaction: 'Reaktionen auf deine Inhalte',
  follow: 'Neue Follower',
  invite: 'Einladungen an dich',
  request: 'Beitrittsanfragen in deinen Gruppen',
  post: 'Neue Beiträge in deinen Gruppen, deinem Hafen und an deinen Booten',
};

/**
 * Wählbare Kanäle je Art – immer mindestens die Glocke. Ob ein neuer Beitrag überhaupt benachrichtigt, entscheidet seit
 * F-449 die Stufe je Verlauf (`shouldNotify`), nicht mehr ein globales „Aus“; gespeichertes `off` fällt auf den Standard.
 */
export const channelsFor = (_kind: ChoosableKind): readonly Channel[] => CHANNELS.filter((c) => c !== 'off');
export const DEFAULT_CHANNELS: Record<ChoosableKind, Channel> = { comment: 'none', reaction: 'none', follow: 'none', invite: 'mail', request: 'none', post: 'none' };

// ---------------------------------------------------------------- Stufen je Verlauf (Konzept 24.6, F-449)

/**
 * Benachrichtigungs-Stufe je Verlauf (Gruppe als Mitglied, gefolgte Gruppe, Hafen, Boot, Profil): alle Beiträge,
 * Wichtiges (Standard), nur Direktes, stumm (auch nicht im persönlichen Stream, F-346).
 */
export const NOTIFY_LEVELS = ['all', 'important', 'direct', 'muted'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export const isNotifyLevel = oneOf(NOTIFY_LEVELS);
/** Standard für Mitgliedschaften (bzw. die Voreinstellung des Kontos) … */
export const DEFAULT_NOTIFY_LEVEL: NotifyLevel = 'important';
/** … und für Folgende, die nur Öffentliches sehen und eher wenig Benachrichtigungen wollen (F-446). */
export const FOLLOW_DEFAULT_LEVEL: NotifyLevel = 'direct';
/** Wählbar als Voreinstellung für neue Verläufe – „stumm“ nur je Verlauf. */
export const DEFAULT_LEVEL_CHOICES: readonly NotifyLevel[] = ['all', 'important', 'direct'];
export const NOTIFY_LEVEL_LABEL: Record<NotifyLevel, string> = { all: 'Alle Beiträge', important: 'Wichtiges', direct: 'Nur Direktes', muted: 'Stumm' };
export const NOTIFY_LEVEL_HINT: Record<NotifyLevel, string> = {
  all: 'Glocke bei jedem neuen Beitrag.',
  important: 'Umfragen, Veranstaltungen, angepinnte Beiträge und alles, was dich direkt betrifft.',
  direct: 'Nur Reaktionen und Kommentare auf deine Inhalte, Erwähnungen und Anfragen.',
  muted: 'Nichts – auch nicht in deinen Neuigkeiten.',
};

/**
 * Art eines Ereignisses für die Stufen: Beitrag (Text, Törn …), wichtiger Beitrag (Umfrage, Veranstaltung, angepinnt)
 * oder automatischer Eintrag (Beitritt, Boot, Meilenstein – benachrichtigt nie, F-448).
 */
export type NotifyEvent = 'post' | 'important' | 'automatic';
export const NOTIFY_EVENTS: readonly NotifyEvent[] = ['post', 'important', 'automatic'];

/** Ereignisart eines neuen bzw. angepinnten Beitrags aus seiner Art (`posts.kind`). */
export const notifyEventOf = (postKind: string, pinned = false): NotifyEvent =>
  pinned || postKind === 'poll' || postKind === 'event' ? 'important' : 'post';

/**
 * Die eine Regel (F-448, F-449): Benachrichtigt ein Ereignis bei dieser Stufe? Stumm nie, automatische Einträge nie,
 * Direktes (Reaktion, Kommentar auf Eigenes, Erwähnung, Anfrage an Admins) ab „Nur Direktes“, Wichtiges ab
 * „Wichtiges“, jeder Beitrag nur bei „Alle Beiträge“. Unbekannte Stufe zählt wie der Standard. Gleiche Regel als SQL:
 * `notifyLevelSql` (worker/notify-sql.ts).
 */
export function shouldNotify(level: unknown, event: NotifyEvent, isDirect = false): boolean {
  const l: NotifyLevel = isNotifyLevel(level) ? level : DEFAULT_NOTIFY_LEVEL;
  if (l === 'muted' || event === 'automatic') return false;
  if (isDirect) return true;
  return event === 'important' ? l === 'all' || l === 'important' : l === 'all';
}

/** Alle Stufen, bei denen das Ereignis benachrichtigt – Grundlage des SQL-Bausteins. */
export const levelsNotifying = (event: NotifyEvent, isDirect = false): NotifyLevel[] => NOTIFY_LEVELS.filter((l) => shouldNotify(l, event, isDirect));

/** Voreinstellung für neue Verläufe aus `users.notify_prefs` (`level`; Unbekanntes → Standard). */
export function parseDefaultLevel(raw: unknown): NotifyLevel {
  try {
    const v = typeof raw === 'string' && raw ? (JSON.parse(raw) as { level?: unknown }).level : undefined;
    return isNotifyLevel(v) && DEFAULT_LEVEL_CHOICES.includes(v) ? v : DEFAULT_NOTIFY_LEVEL;
  } catch {
    return DEFAULT_NOTIFY_LEVEL;
  }
}
export type NotifyPrefs = Record<ChoosableKind, Channel>;

/** Gespeicherte Auswahl (JSON in `users.notify_prefs`) lesen – Unbekanntes fällt auf den Standard zurück. */
export function parsePrefs(raw: unknown): NotifyPrefs {
  let obj: Record<string, unknown> = {};
  try {
    obj = typeof raw === 'string' && raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    obj = {};
  }
  return Object.fromEntries(CHOOSABLE.map((k) => [k, isChannel(obj?.[k]) && channelsFor(k).includes(obj[k] as Channel) ? obj[k] : DEFAULT_CHANNELS[k]])) as NotifyPrefs;
}

/** Hinweise des Betreibers zum Konto: immer in der Glocke und immer per Mail, nicht abschaltbar. */
export const MANDATORY: ReadonlySet<NotificationKind> = new Set(['expiry', 'passkey', 'claim', 'claim_result', 'claim_transfer']);
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
  /** höchstens so viele Empfänger je neuem Beitrag (F-416) */
  postFanOut: 200,
  /** höchstens so viele Törn-Benachrichtigungen derselben Eigentümer:in je Empfänger:in und Tag (F-449) */
  sharesPerDay: 5,
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
    case 'post':
      return `${quoted(n.title)}: neuer Beitrag`;
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
    case 'post':
      if (n.what === 'voyage') return `${who} hat einen Törn geteilt: ${quoted(n.title)}`;
      return n.what === 'poll' ? `${who} fragt in ${quoted(n.title)}: neue Umfrage` : `${who} hat in ${quoted(n.title)} geschrieben`;
    case 'poll_closed':
      return `Deine Umfrage ${n.title.trim() ? `in ${quoted(n.title)} ` : ''}ist beendet – das Ergebnis steht fest`;
    case 'expiry':
      return `${quoted(n.title)} wird ${n.what} gelöscht – unterstützen, um ihn zu behalten`;
    case 'passkey':
      return `Neuer Passkey an deinem Konto${n.title ? `: ${quoted(n.title)}` : ''} – warst du das nicht, entferne ihn`;
    case 'claim':
      return n.count > 1 ? `${n.count} Anträge, ${quoted(n.title)} zu vertreten` : `${who} beantragt, ${quoted(n.title)} zu vertreten`;
    case 'claim_result':
      return claimResultText(isClaimStatus(n.what) ? n.what : 'open', n.title);
    case 'claim_transfer':
      return `${quoted(n.title)} wird jetzt von der verifizierten Vertretung verwaltet – ${n.what}`;
  }
}
