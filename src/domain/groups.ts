// Vereine, Teams, Folgen und Neuigkeiten (Konzept Abschnitt 11): reine Regeln ohne DOM und Netz –
// genutzt von Worker (Prüfen, Schreiben, Lesen) und Oberfläche (Texte, Formulare).
import { fmtNum } from './format';
import type { ReactionSubject, ReactionSummary } from './reactions';

// ---------------------------------------------------------------- Gruppen

export const GROUP_KINDS = ['club', 'team'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];
export const GROUP_KIND_LABEL: Record<GroupKind, string> = { club: 'Verein', team: 'Team' };

export const GROUP_ROLES = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
export const GROUP_ROLE_LABEL: Record<GroupRole, string> = { owner: 'Eigner', admin: 'Admin', member: 'Mitglied' };

/** Beitritt: per Einladung oder Anfrage (Standard) bzw. nur per Einladung. */
export const JOIN_MODES = ['request', 'invite'] as const;
export type JoinMode = (typeof JOIN_MODES)[number];
export const JOIN_MODE_LABEL: Record<JoinMode, string> = { request: 'Auf Anfrage oder Einladung', invite: 'Nur auf Einladung' };

/** Sichtbarkeit einer Gruppe: „Nur ich“ heißt hier „Geschlossen“ – nur Mitglieder sehen sie. */
export const GROUP_VISIBILITY_LABEL = { public: 'Öffentlich', unlisted: 'Nur mit Link', private: 'Geschlossen' } as const;
export const GROUP_VISIBILITY_HINT = {
  public: 'Für alle sichtbar, unter Entdecken gelistet und von Suchmaschinen auffindbar.',
  unlisted: 'Nur wer den geheimen Link hat, sieht die Gruppe. Nirgends gelistet.',
  private: 'Nur Mitglieder sehen die Gruppe. Beitritt nur auf Einladung.',
} as const;

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

export const isGroupKind = oneOf(GROUP_KINDS);
export const isGroupRole = oneOf(GROUP_ROLES);
export const isJoinMode = oneOf(JOIN_MODES);

/** Reservierte Gruppen-Adressen (Routen, Verwechslung) – zusätzlich zu den reservierten Profilnamen. */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'login', 'logout', 'me', 'settings', 'support', 'help', 'sailing', 'wollow', 'root', 'system', 'null', 'undefined',
  'neu', 'new', 'feed', 'verein', 'vereine', 'team', 'teams', 'gruppe', 'gruppen', 'entdecken',
]);

/** Gruppen-Adresse: 3–30 Zeichen a–z, 0–9, Bindestrich; nicht am Rand, kein doppelter Bindestrich, nicht reserviert. */
export function normalizeSlug(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(s) || s.includes('--') || RESERVED_SLUGS.has(s)) return null;
  return s;
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Vorschlag für eine Adresse aus dem Namen („Segelclub Möwe e.V.“ → „segelclub-moewe-e-v“), höchstens 30 Zeichen. */
export function slugFromName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : '';
}

/** Rechte je Rolle (Konzept 11.1). */
export const canManageGroup = (role: GroupRole | null) => role === 'owner' || role === 'admin';
export const canEditVisibility = (role: GroupRole | null) => role === 'owner';

/** Darf `actor` die Rolle von `target` ändern bzw. ihn entfernen? Eigner alles außer sich; Admins nur einfache Mitglieder. */
export function canRemoveMember(actor: GroupRole | null, target: GroupRole, self: boolean): boolean {
  if (self) return target !== 'owner';
  if (actor === 'owner') return target !== 'owner';
  return actor === 'admin' && target === 'member';
}

// ---------------------------------------------------------------- Folgen

export const FOLLOW_KINDS = ['user', 'boat', 'group', 'harbor'] as const;
export type FollowKind = (typeof FOLLOW_KINDS)[number];
export const isFollowKind = oneOf(FOLLOW_KINDS);

// ---------------------------------------------------------------- Neuigkeiten

/** `harbor` = „Neues Boot im Hafen“ (Konzept 12.4). */
export const ACTIVITY_KINDS = ['voyage', 'photos', 'member', 'boat', 'post', 'milestone', 'harbor'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const isActivityKind = oneOf(ACTIVITY_KINDS);

/** Saison-Meilensteine in Seemeilen (Konzept 11.3). */
export const MILESTONES_NM = [100, 500, 1000] as const;

/** Schwellen, die zwischen `before` und `after` (Seemeilen) überschritten wurden – je höchstens einmal. */
export function crossedMilestones(before: number, after: number, thresholds: readonly number[] = MILESTONES_NM): number[] {
  return thresholds.filter((t) => before < t && after >= t);
}

/** Kalenderjahr (UTC) eines Zeitpunkts – die Saison eines Törns. */
export const seasonOf = (ms: number): number => new Date(ms).getUTCFullYear();

/** Tag (UTC, YYYY-MM-DD) für das Bündeln von Fotos je Törn und Tag. */
export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Cursor „<created_at>_<activity_id>“ – stabil auch bei gleichen Zeitpunkten. */
export interface StreamCursor {
  at: number;
  id: string;
}

export const encodeCursor = (c: StreamCursor): string => `${c.at}_${c.id}`;

export function decodeCursor(raw: string | null | undefined): StreamCursor | null {
  if (!raw) return null;
  const m = /^(\d{1,15})_([A-Za-z0-9]{12,32})$/.exec(raw);
  return m ? { at: Number(m[1]), id: m[2] } : null;
}

/** Seitengröße und wie viele Kandidaten pro Seite höchstens geprüft werden (Aussortieren beim Lesen). */
export const STREAM_PAGE = 20;
export const STREAM_SCAN = 60;

// ---------------------------------------------------------------- Darstellung (Oberfläche, Mail, RSS)

/** Eintrag der Neuigkeiten, wie ihn der Server liefert (worker/stream.ts). Keine Konto-IDs, keine E-Mail-Adressen. */
export interface StreamItem {
  id: string;
  kind: ActivityKind;
  createdAt: number;
  /** Handelnde Person – nur mit öffentlichem Profil, sonst null */
  actor: { handle: string; displayName: string } | null;
  /** Gruppe als Kontext (Beitrag, Mitglied, Boot) */
  group: { slug: string; name: string; kind: GroupKind } | null;
  voyage?: { id: string; title: string; distNm: number; startedAt: number | null; hasImage: boolean; boat: { id: string; name: string } | null };
  photos?: { count: number; thumbs: string[] };
  post?: { id: string; body: string; link: string | null; canDelete: boolean };
  boat?: { id: string; name: string };
  milestone?: { nm: number; year: number; subject: 'user' | 'boat' | 'group'; name: string; path: string };
  /** Hafen als Kontext (`harbor`: neues Boot im Hafen) */
  harbor?: { slug: string; name: string };
  /** Reaktionen (Konzept 12.5): Gegenstand, Zähler je Art und die eigene */
  reactions?: StreamReactions;
}

/** Reaktionen eines Eintrags: Törn bei `voyage`/`photos`, Beitrag bei `post`, sonst die Aktivität selbst. */
export interface StreamReactions extends ReactionSummary {
  subject: ReactionSubject;
  id: string;
}

/** Gegenstand der Reaktionen eines Eintrags – dieselbe Reaktion erscheint im Stream und auf der Törn-Seite. */
export function reactionSubjectOf(i: Pick<StreamItem, 'id' | 'kind' | 'voyage' | 'post'>): { subject: ReactionSubject; id: string } {
  if ((i.kind === 'voyage' || i.kind === 'photos') && i.voyage) return { subject: 'share', id: i.voyage.id };
  if (i.kind === 'post' && i.post) return { subject: 'post', id: i.post.id };
  return { subject: 'activity', id: i.id };
}

const who = (i: StreamItem, fallback: string) => i.actor?.displayName || fallback;

/** Kurzer Satz zu einem Eintrag (ohne Beitragstext) – gleich in App, RSS und Mail. */
export function streamHeadline(i: StreamItem): string {
  switch (i.kind) {
    case 'voyage':
      return `${who(i, 'Ein:e Segler:in')} hat einen Törn geteilt: ${i.voyage?.title ?? 'Törn'}`;
    case 'photos': {
      const n = i.photos?.count ?? 0;
      return `${who(i, 'Ein:e Segler:in')}: ${n === 1 ? '1 neues Foto' : `${fmtNum(n, 0)} neue Fotos`} zu ${i.voyage?.title ?? 'einem Törn'}`;
    }
    case 'member':
      return `${who(i, 'Ein neues Mitglied')} ist ${i.group ? `${i.group.kind === 'club' ? 'dem Verein' : 'dem Team'} ${i.group.name}` : 'der Gruppe'} beigetreten`;
    case 'boat':
      return i.group ? `Neues Boot in ${i.group.name}: ${i.boat?.name ?? 'Boot'}` : `Neues Boot: ${i.boat?.name ?? 'Boot'}`;
    case 'post':
      return `Neuigkeit von ${i.group?.name ?? 'der Gruppe'}`;
    case 'milestone':
      return i.milestone ? `${i.milestone.name} hat ${fmtNum(i.milestone.nm, 0)} Seemeilen in der Saison ${i.milestone.year} erreicht` : 'Meilenstein';
    case 'harbor':
      return `Neues Boot im Hafen ${i.harbor?.name ?? ''}: ${i.boat?.name ?? 'Boot'}`;
  }
}

/** Ziel-Pfad eines Eintrags in der App. */
export function streamPath(i: StreamItem): string {
  if (i.voyage) return `/s/${i.voyage.id}`;
  if (i.kind === 'milestone' && i.milestone) return i.milestone.path;
  if (i.kind === 'harbor' && i.boat) return `/b/${i.boat.id}`;
  if (i.group) return `/g/${i.group.slug}`;
  if (i.boat) return `/b/${i.boat.id}`;
  if (i.harbor) return `/h/${i.harbor.slug}`;
  return '/';
}

// ---------------------------------------------------------------- Beiträge

export const POST_MAX = 2000;
export const POST_MAX_LINKS = 5;
export const POST_LINK_MAX = 500;

/** Optionaler Link eines Beitrags: http(s) mit Host, höchstens 500 Zeichen; leer = keiner; ungültig = null. */
export function parsePostLink(input: unknown): string | '' | null {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string' || input.length > POST_LINK_MAX) return null;
  try {
    const u = new URL(input.trim());
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Vorschläge

export const SUGGESTION_REASONS = ['group', 'crew', 'boat', 'port'] as const;
export type SuggestionReason = (typeof SUGGESTION_REASONS)[number];

export function suggestionReasonText(reason: SuggestionReason, port?: string | null): string {
  switch (reason) {
    case 'group':
      return 'Im selben Verein';
    case 'crew':
      return 'Mit dir gesegelt';
    case 'boat':
      return 'Boot in deinem Verein';
    case 'port':
      return port ? `Heimathafen ${port}` : 'Gleicher Heimathafen';
  }
}

// ---------------------------------------------------------------- Mail-Einstellung

const DAY_MS = 86_400_000;
/** Sonntag (UTC): ab dann ist die wöchentliche Sammelmail fällig (Konzept 11.7). */
export const DIGEST_WEEKDAY = 0;

/** Beginn der laufenden Mail-Woche: der letzte Sonntag 00:00 UTC (bzw. heute, wenn Sonntag ist). */
export function digestWeekStart(now: number): number {
  const d = new Date(now);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day - ((d.getUTCDay() - DIGEST_WEEKDAY + 7) % 7) * DAY_MS;
}



export const GROUP_NOTIFY_MODES = ['off', 'weekly'] as const;
export type GroupNotifyMode = (typeof GROUP_NOTIFY_MODES)[number];
export const isGroupNotifyMode = oneOf(GROUP_NOTIFY_MODES);
