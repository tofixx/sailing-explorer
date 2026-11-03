// Beiträge als Grundtyp (Konzept 21, F-400 … F-406): reine Regeln ohne DOM und Netz – Arten, Verläufe („wo steht es“),
// Sichtbarkeit („wer sieht es“), Reichweite („Sichtbar bis“), wer sieht und wer schreibt. Genutzt von Worker
// (Prüfen beim Schreiben und Lesen) und Oberfläche (Texte, Auswahl).
import type { GroupKind, GroupRole } from './groups';
import { canManageGroup } from './groups';
import type { Visibility } from './visibility';
import type { LogState } from './logbook';

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

// ---------------------------------------------------------------- Arten und Verläufe

/** Arten eines Beitrags (21.2). `voyage`/`logbook` sind Törns mit Nutzlast in `shares` (gleiche ID). */
export const POST_KINDS = ['text', 'gallery', 'poll', 'event', 'voyage', 'logbook'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const isPostKind = oneOf(POST_KINDS);

/** Törn-Arten: Sichtbarkeit, Löschen und Aufbewahrung regelt weiter der Törn (`shares`). */
export const isShareKind = (k: PostKind): k is 'voyage' | 'logbook' => k === 'voyage' || k === 'logbook';

/** Art der Post-Zeile eines Törns aus seiner Quelle (`shares.source`). */
export const shareKindOf = (source: string | null | undefined): 'voyage' | 'logbook' => (source === 'manual' ? 'logbook' : 'voyage');

/** Verläufe, in die man schreibt (F-400) – die Community ist keiner. */
export const CHANNEL_KINDS = ['user', 'group', 'harbor', 'boat'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const isChannelKind = oneOf(CHANNEL_KINDS);

// ---------------------------------------------------------------- Sichtbarkeit und Reichweite

/** „Wer sieht es“ (F-402): `members` nur im Gruppen-Verlauf, nie für Törns. */
export const POST_VISIBILITIES = ['public', 'members', 'unlisted', 'private'] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];
export const isPostVisibility = oneOf(POST_VISIBILITIES);

/** „Sichtbar bis“ (B2): nur hier, bis Verein, bis Hafen, überall. */
export const REACHES = ['here', 'club', 'harbor', 'all'] as const;
export type Reach = (typeof REACHES)[number];
export const isReach = oneOf(REACHES);

/**
 * Stufen, die ein Text-Beitrag in diesem Verlauf wählen kann: im Profil „Öffentlich“, „Nur mit Link“ oder „Nur ich“, in
 * einer Gruppe „Öffentlich“ (für alle, die die Gruppe sehen), „Nur Mitglieder“ (kostenlos, B4) oder „Nur mit Link“, im
 * Hafen und am Boot „Öffentlich“ oder „Nur mit Link“ (F-406).
 */
export function postVisibilityChoices(channel: ChannelKind): PostVisibility[] {
  switch (channel) {
    case 'group':
      return ['public', 'members', 'unlisted'];
    case 'user':
      return ['public', 'unlisted', 'private'];
    default:
      return ['public', 'unlisted'];
  }
}

/**
 * Vorgewählte Stufe beim Schreiben (F-445): in Gruppen „Nur Mitglieder“ – „Öffentlich“ wählt man bewusst; sonst
 * „Öffentlich“. Gilt im Formular und auf dem Server, wenn keine Stufe angegeben ist.
 */
export const defaultPostVisibility = (channel: ChannelKind): PostVisibility => (channel === 'group' ? 'members' : 'public');

/** Darf diese Stufe gewählt werden? „Nur Mitglieder“ kostenlos (B4), „Nur mit Link“ und „Nur ich“ wie überall nur für Unterstützer (E1). */
export function canChoosePostVisibility(v: PostVisibility, supporter: boolean): boolean {
  return v === 'public' || v === 'members' || supporter;
}

/**
 * Reichweite beim Speichern: nicht öffentliche Beiträge bleiben immer im Heimatverlauf. Ohne Angabe „nur hier“ – die
 * Oberfläche schlägt „überall“ vor, ältere Oberflächen breiten so nichts ungefragt aus (21.12).
 */
export const reachFor = (visibility: PostVisibility, requested: Reach = 'here'): Reach => (visibility === 'public' ? requested : 'here');

/** Rangfolge der Stufen „Sichtbar bis“ – eine Stufe deckt alle darunter ab. */
export const REACH_RANK: Record<Reach, number> = { here: 0, club: 1, harbor: 2, all: 3 };

/** Deckt `reach` die Stufe `level` ab (beim Lesen: Verein, Hafen, Community)? */
export const reachCovers = (reach: Reach, level: Reach): boolean => REACH_RANK[reach] >= REACH_RANK[level];

/** Alle Stufen, die `level` abdecken – Grundlage des SQL-Fragments (worker/reach-sql.ts). */
export const reachesAtLeast = (level: Reach): Reach[] => REACHES.filter((r) => reachCovers(r, level));

/**
 * Ausbreitungskette eines Verlaufs (B2, F-409), beim Schreiben aufgelöst: Team → Verein des Teams → Heimathafen des
 * Vereins → Community; Verein → sein Heimathafen; Profil → Heimathafen der Person (Umgebung); Boot → Hafen des Boots;
 * Hafen → Community. `open`: der Verlauf ist öffentlich – nur dann gibt es Stufen über „nur hier“.
 */
export interface ReachChain {
  /** Name des Heimatverlaufs („Mittwochsregatta“, „dein Profil“ …) */
  home: string;
  club: { id: string; name: string } | null;
  harbor: { id: string; name: string } | null;
  open: boolean;
}

/** Wählbare Stufen eines Verlaufs: nur die, die es gibt; nicht öffentliche Verläufe nur „nur hier“. */
export function reachChoices(chain: ReachChain): Reach[] {
  if (!chain.open) return ['here'];
  return ['here', ...(chain.club ? (['club'] as const) : []), ...(chain.harbor ? (['harbor'] as const) : []), 'all'];
}

export const REACH_LABEL: Record<Reach, string> = { here: 'Nur hier', club: 'Bis Verein', harbor: 'Bis Hafen', all: 'Überall' };

/** Die Kette bis zur gewählten Stufe, z. B. „Mittwochsregatta → PYC → Hafen Potsdam → überall“. */
export function reachChainText(chain: ReachChain, reach: Reach): string {
  const steps = [chain.home];
  if (chain.club && reachCovers(reach, 'club')) steps.push(chain.club.name);
  if (chain.harbor && reachCovers(reach, 'harbor')) steps.push(`Hafen ${chain.harbor.name}`);
  if (reach === 'all') steps.push('überall');
  return steps.length === 1 ? `nur ${chain.home}` : steps.join(' → ');
}

/** Eine Stufe zur Auswahl (Text und Kette). */
export interface ReachOption {
  reach: Reach;
  label: string;
  chain: string;
}

export const reachOptions = (chain: ReachChain): ReachOption[] =>
  reachChoices(chain).map((reach) => ({ reach, label: REACH_LABEL[reach], chain: reachChainText(chain, reach) }));

/**
 * Ziele der Ausbreitung nach oben bis `reach` (ohne Heimatverlauf): Verein als Gruppen-Ziel, Hafen als Hafen-Ziel. Die
 * Community braucht kein Ziel – „Alles“ liest alle Aktivitäten und prüft `reach = 'all'`.
 */
export function reachTargets(chain: ReachChain, reach: Reach): Array<{ kind: 'group' | 'harbor'; id: string }> {
  if (!chain.open) return [];
  return [
    ...(chain.club && reachCovers(reach, 'club') ? [{ kind: 'group' as const, id: chain.club.id }] : []),
    ...(chain.harbor && reachCovers(reach, 'harbor') ? [{ kind: 'harbor' as const, id: chain.harbor.id }] : []),
  ];
}

/**
 * „Sichtbar bis“ für Törns (21.2, F-427): `here` = nur eigenes Profil und gewählte Gruppen, `club` zusätzlich die
 * Vereine gewählter Teams, `harbor` zusätzlich Boot und Hafen des Boots, `all` wie bisher bis in die Community.
 */
export const SHARE_REACH_OPTIONS: ReachOption[] = [
  { reach: 'here', label: 'Nur hier', chain: 'dein Profil und die gewählten Gruppen' },
  { reach: 'club', label: 'Bis Verein', chain: '… und die Vereine gewählter Teams' },
  { reach: 'harbor', label: 'Bis Hafen', chain: '… und Boot und Hafen des Boots' },
  { reach: 'all', label: 'Überall', chain: '… und die Community („Alles“, „Umgebung“)' },
];

const RANK: Record<PostVisibility, number> = { private: 0, members: 1, unlisted: 2, public: 3 };

/**
 * Erweitert eine Änderung das Publikum – höhere Sichtbarkeit oder (öffentlich) höheres „Sichtbar bis“? Dafür braucht es
 * das aktuelle Schreibrecht im Verlauf; herabsetzen geht immer (F-409).
 */
export function widensAudience(from: { visibility: PostVisibility; reach: Reach }, to: { visibility: PostVisibility; reach: Reach }): boolean {
  if (RANK[to.visibility] > RANK[from.visibility]) return true;
  return to.visibility === 'public' && REACH_RANK[to.reach] > REACH_RANK[from.visibility === 'public' ? from.reach : 'here'];
}

/** Stufe eines Gruppen-Verlaufs als Beitrags-Stufe: geschlossen = nur Mitglieder. */
const channelLevel = (groupVisibility: Visibility): PostVisibility => (groupVisibility === 'private' ? 'members' : groupVisibility);

/** Effektive Sichtbarkeit = min(Beitrag, Verlauf) (F-402); im Profil zählt nur der Beitrag. */
export function effectivePostVisibility(post: PostVisibility, groupVisibility?: Visibility | null): PostVisibility {
  if (!groupVisibility) return post;
  const ch = channelLevel(groupVisibility);
  return RANK[post] <= RANK[ch] ? post : ch;
}

/** Ein Text-Beitrag, wie ihn die Prüfung beim Lesen braucht. */
export interface PostAccess {
  visibility: PostVisibility;
  channel: ChannelKind;
  hidden: boolean;
  authorSuspended: boolean;
  /** nur Profil-Verlauf: Profil der Autor:in öffentlich und nicht ausgeblendet */
  authorPublic: boolean;
}

/** Wer liest – und in welcher Beziehung zum Beitrag. */
export interface PostViewer {
  isAuthor: boolean;
  /** Gruppen-, Hafen- bzw. Boots-Verlauf: darf ihn jetzt sehen (öffentlich, Schlüssel oder Mitglied, nicht ausgeblendet) */
  channelVisible?: boolean;
  /** Gruppen-Verlauf: ist Mitglied */
  isMember?: boolean;
  /** Gruppen-Verwalter oder Moderation: sehen Ausgeblendetes */
  canModerate?: boolean;
  /** „Nur mit Link“: der Schlüssel des Beitrags kam mit (F-406) */
  keyOk?: boolean;
}

/**
 * Darf der Betrachter einen Text-Beitrag sehen? Fail closed: Unbekanntes, „Nur mit Link“ ohne Schlüssel und „Nur ich“
 * für andere sind unsichtbar. Effektiv gilt min(Beitrag, Verlauf): außer im Profil muss der Verlauf sichtbar sein, „Nur
 * Mitglieder“ gibt es nur in Gruppen. Die Autor:in sieht ihre Beiträge immer (F-401).
 */
export function canSeePost(p: PostAccess, v: PostViewer): boolean {
  if (v.isAuthor) return true;
  if (p.authorSuspended && !v.canModerate) return false;
  if (p.hidden && !v.canModerate) return false;
  if (p.visibility === 'private') return false;
  if (p.visibility === 'unlisted' && !v.keyOk) return false;
  if (p.channel === 'user') return p.visibility === 'unlisted' || (p.visibility === 'public' && p.authorPublic);
  if (!v.channelVisible) return false;
  if (p.visibility === 'members') return p.channel === 'group' && !!v.isMember;
  return true;
}

// ---------------------------------------------------------------- Schreiben in Hafen und Boot (B6, F-425)

/** Hafen (B6): wer ein Boot mit diesem Heimathafen hat (Eigner oder Boots-Admin), Vertretung bzw. Anleger:in, Moderation. */
export const canWriteInHarbor = (w: { hasBoat: boolean; isCreator: boolean; isAdmin: boolean }): boolean => w.hasBoat || w.isCreator || w.isAdmin;

/** Boot: Eigner und Boots-Admins. */
export const canWriteOnBoat = (role: 'owner' | 'admin' | null): boolean => role === 'owner' || role === 'admin';

/**
 * Wer einen Verlauf verwaltet – anpinnen (B1, F-403) und fremde Beiträge dort löschen: im Profil die Person selbst, in
 * der Gruppe Eigentümer:in und Admins, im Hafen Vertretung bzw. Anleger:in und Moderation, am Boot Eigner und Admins.
 */
export function canManageChannel(c: { kind: ChannelKind; isSelf?: boolean; groupRole?: GroupRole | null; harborCreator?: boolean; boatRole?: 'owner' | 'admin' | null; admin?: boolean }): boolean {
  switch (c.kind) {
    case 'user':
      return !!c.isSelf;
    case 'group':
      return canManageGroup(c.groupRole ?? null);
    case 'harbor':
      return !!c.harborCreator || !!c.admin;
    case 'boat':
      return canWriteOnBoat(c.boatRole ?? null);
  }
}

// ---------------------------------------------------------------- Schreiben in Gruppen (B3)

export const POST_BY = ['admins', 'members'] as const;
export type PostBy = (typeof POST_BY)[number];
export const isPostBy = oneOf(POST_BY);
export const POST_BY_LABEL: Record<PostBy, string> = { admins: 'Eigentümer und Admins', members: 'Alle Mitglieder' };

/** Standard je Art: Verein „nur Admins“, Team „alle Mitglieder“. */
export const defaultPostBy = (kind: GroupKind): PostBy => (kind === 'team' ? 'members' : 'admins');

/** Gültige Einstellung der Gruppe (gespeichert oder Standard; Unbekanntes zählt als Standard). */
export const effectivePostBy = (kind: GroupKind, stored: string | null | undefined): PostBy => (isPostBy(stored) ? stored : defaultPostBy(kind));

/** Darf diese Rolle in der Gruppe schreiben? Eigner und Admins immer, Mitglieder nur bei „alle Mitglieder“. */
export function canWriteInGroup(role: GroupRole | null, postBy: PostBy): boolean {
  if (canManageGroup(role)) return true;
  return role === 'member' && postBy === 'members';
}

// ---------------------------------------------------------------- Oberfläche: „Wer sieht es“ und „Wo steht es“ (B12)

/** Kurzer Text „Wer sieht es“ (F-401). */
export function whoSeesLabel(v: PostVisibility, groupName?: string | null): string {
  switch (v) {
    case 'public':
      return 'Öffentlich';
    case 'members':
      return groupName ? `Nur Mitglieder von ${groupName}` : 'Nur Mitglieder';
    case 'unlisted':
      return 'Nur mit Link';
    case 'private':
      return 'Nur ich';
  }
}

/** Kurzer Text für die Auswahl beim Schreiben. */
export const POST_VISIBILITY_CHOICE: Record<PostVisibility, string> = {
  public: 'Öffentlich',
  members: 'Nur Mitglieder',
  unlisted: 'Nur mit Link',
  private: 'Nur ich',
};

/** Ein Verlauf, wie ihn „Wo steht es“ nennt. */
export type ChannelRef =
  | { kind: 'user' }
  | { kind: 'group'; slug: string; name: string; groupKind: GroupKind }
  | { kind: 'harbor'; slug: string; name: string }
  | { kind: 'boat'; id: string; name: string };

/** Pfad der Seite eines Verlaufs (Profil braucht den Handle). */
export function channelPath(c: ChannelRef, handle?: string | null): string | null {
  switch (c.kind) {
    case 'group':
      return `/g/${c.slug}`;
    case 'harbor':
      return `/h/${c.slug}`;
    case 'boat':
      return `/b/${c.id}`;
    default:
      return handle ? `/u/${handle}` : null;
  }
}

/** Schlüssel eines Verlaufs für Zuordnungen in der Oberfläche (Profil, Gruppe, Hafen, Boot). */
export const channelKey = (c: ChannelRef): string => (c.kind === 'user' ? 'user' : c.kind === 'boat' ? `boat:${c.id}` : `${c.kind}:${c.slug}`);

/** Name eines Verlaufs mit Art („Team Mittwochsregatta“, „Hafen Potsdam“, „Boot Möwe“, „dein Profil“). */
export function channelName(c: ChannelRef): string {
  switch (c.kind) {
    case 'group':
      return `${c.groupKind === 'team' ? 'Team' : 'Verein'} ${c.name}`;
    case 'harbor':
      return `Hafen ${c.name}`;
    case 'boat':
      return `Boot ${c.name}`;
    default:
      return 'dein Profil';
  }
}

/**
 * „Wo steht es“ (F-401): Heimatverlauf und – bei Törns – die Gruppen, in denen er gezeigt wird (11.12). Für die eigene
 * Seite formuliert („in deinem Profil“).
 */
export function whereLabel(channel: ChannelRef, groups: ReadonlyArray<{ name: string }> = []): string {
  const home = channel.kind === 'user' ? 'in deinem Profil' : `in ${channelName(channel)}`;
  if (!groups.length) return home;
  return `${home} und in ${groups.map((g) => g.name).join(', ')}`;
}

/** Bereiche von „Mein Verlauf“: alles oder nur, was nur ich sehe (B12). Das Fahrtenbuch hat eine eigene Seite (F-459). */
export const MY_POST_AREAS = ['all', 'private'] as const;
export type MyPostArea = (typeof MY_POST_AREAS)[number];
export const isMyPostArea = oneOf(MY_POST_AREAS);

/** Ein eigener Beitrag in „Mein Verlauf“ (GET /api/me/posts). */
export interface MyPost {
  id: string;
  kind: PostKind;
  createdAt: number;
  /** effektive Sichtbarkeit („Wer sieht es“) */
  visibility: PostVisibility;
  channel: ChannelRef;
  /** Törns: Gruppen, in denen er gezeigt wird (11.12) */
  groups: Array<{ slug: string; name: string }>;
  body: string;
  link: string | null;
  /** Törns: Titel, Strecke, Datum und Pfad (mit Schlüssel bei „Nur mit Link“) */
  voyage?: { title: string; distNm: number; startedAt: number | null; path: string; logState: LogState };
  /** gemeldet und bis zur Prüfung ausgeblendet */
  hidden: boolean;
  /** Text-Beiträge: „Sichtbar bis“ und der Link zur Karte (`/p/<id>`, bei „Nur mit Link“ mit Schlüssel, F-406) */
  reach?: Reach;
  path?: string;
  /** angehängter eigener Törn (F-426) */
  attached?: { id: string; title: string } | null;
  /** im eigenen Profil angepinnt (F-403) */
  pinned?: boolean;
}

/** Ein Verlauf, in den das Konto schreiben darf (F-405): „Wo steht es?“ mit Stufen und Kette. */
export interface ComposeTarget {
  ref: ChannelRef;
  /** ID des Verlaufs (Profil: leer) */
  id: string;
  choices: PostVisibility[];
  reaches: ReachOption[];
  /** Team: ID seines Vereins – kleinere Gruppe im Publikums-Hinweis (F-465) */
  clubId?: string;
}

/** Ein eigener Törn zum Anhängen (F-426). */
export interface AttachableShare {
  id: string;
  title: string;
  startedAt: number | null;
}

/** Ein Text-Beitrag als Ziel von `/p/<id>` (F-406): Heimatverlauf und ob die Karte dort im Verlauf steht. */
export interface PostLink {
  /** Seite des Heimatverlaufs oder null (Profil ohne Handle) */
  home: string | null;
  /** steht im Verlauf (öffentlich bzw. „Nur Mitglieder“) – sonst nur als einzelne Karte */
  inStream: boolean;
  where: string;
}

/** Erste Zeile eines Beitrags für die Link-Vorschau (F-406), gekürzt. */
export function firstLine(body: string, max = 140): string {
  const line = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Beitrag auf der Profilseite für Besucher (F-420): im Profil oder in einer Gruppe, die der Leser sehen darf. */
export interface ProfilePost {
  id: string;
  /** Art (Umfrage: Link zur Karte `/p/<id>`, Konzept 29); fehlt = Text */
  kind?: PostKind;
  createdAt: number;
  body: string;
  link: string | null;
  /** Gruppen-Beitrag: „Wo steht es“ */
  group: { slug: string; name: string; kind: GroupKind } | null;
  /** effektive Sichtbarkeit („Wer sieht es“) */
  visibility: PostVisibility;
  /** im Profil angepinnt (F-403) */
  pinned?: boolean;
}

// ---------------------------------------------------------------- „Ansehen als …“ (F-423)

/** Vorschau der eigenen Seite: als Öffentlichkeit, als jemand aus dem Heimathafen, als Mitglied einer eigenen Gruppe. */
export type ProfilePreview = { as: 'public' } | { as: 'harbor' } | { as: 'group'; groupId: string };

/** `?as=public|harbor|group:<id>` – Unbekanntes ist null (keine Vorschau). */
export function parseProfilePreview(raw: string | null): ProfilePreview | null {
  if (raw === 'public' || raw === 'harbor') return { as: raw };
  const m = /^group:([A-Za-z0-9]{12,32})$/.exec(raw ?? '');
  return m ? { as: 'group', groupId: m[1] } : null;
}

export const previewParam = (p: ProfilePreview): string => (p.as === 'group' ? `group:${p.groupId}` : p.as);

/** Wählbare Vorschauen (vom Server für die eigene Seite geliefert). */
export interface PreviewOptions {
  harbor: { name: string } | null;
  groups: Array<{ id: string; name: string; kind: GroupKind }>;
}

/** Beschriftung einer Vorschau. */
export function previewLabel(p: ProfilePreview, o: PreviewOptions | null | undefined): string {
  if (p.as === 'public') return 'Öffentlich (ohne Anmeldung, ohne Link)';
  if (p.as === 'harbor') return `Jemand aus deinem Hafen${o?.harbor ? ` ${o.harbor.name}` : ''}`;
  const g = o?.groups.find((x) => x.id === p.groupId);
  return g ? `Mitglied von ${g.name}` : 'Mitglied einer deiner Gruppen';
}
