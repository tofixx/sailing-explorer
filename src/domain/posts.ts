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

/** Verläufe, in die man schreibt (F-400) – die Community ist keiner. Phase 1 schreibt nur in `user` und `group`. */
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
 * Stufen, die ein neuer Text-Beitrag in diesem Verlauf wählen kann (Phase 1): im Profil „Öffentlich“ oder „Nur ich“,
 * in einer Gruppe „Öffentlich“ (für alle, die die Gruppe sehen) oder „Nur Mitglieder“ (kostenlos, B4). „Nur mit Link“
 * kommt mit `/p/<id>` (Phase 2).
 */
export function postVisibilityChoices(channel: 'user' | 'group'): PostVisibility[] {
  return channel === 'group' ? ['public', 'members'] : ['public', 'private'];
}

/** Darf diese Stufe gewählt werden? „Nur Mitglieder“ kostenlos (B4), „Nur ich“ wie überall nur für Unterstützer (E1). */
export function canChoosePostVisibility(v: PostVisibility, supporter: boolean): boolean {
  return v === 'public' || v === 'members' || supporter;
}

/**
 * Reichweite beim Speichern: nicht öffentliche Beiträge bleiben immer im Heimatverlauf. Phase 1 hat noch keine
 * Ausbreitung nach oben (21.8) – neue Text-Beiträge stehen bis dahin „nur hier“, nichts breitet sich rückwirkend aus.
 */
export const reachFor = (visibility: PostVisibility, requested: Reach = 'here'): Reach => (visibility === 'public' ? requested : 'here');

const RANK: Record<PostVisibility, number> = { private: 0, members: 1, unlisted: 2, public: 3 };

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
  channel: 'user' | 'group';
  hidden: boolean;
  authorSuspended: boolean;
  /** nur Profil-Verlauf: Profil der Autor:in öffentlich und nicht ausgeblendet */
  authorPublic: boolean;
}

/** Wer liest – und in welcher Beziehung zum Beitrag. */
export interface PostViewer {
  isAuthor: boolean;
  /** Gruppen-Verlauf: darf die Gruppe jetzt sehen (öffentlich, Schlüssel oder Mitglied, nicht ausgeblendet) */
  groupVisible?: boolean;
  /** Gruppen-Verlauf: ist Mitglied */
  isMember?: boolean;
  /** Gruppen-Verwalter oder Moderation: sehen Ausgeblendetes */
  canModerate?: boolean;
}

/**
 * Darf der Betrachter einen Text-Beitrag sehen? Fail closed: Unbekanntes, „Nur mit Link“ (ohne Schlüsselprüfung in
 * Phase 1) und „Nur ich“ für andere sind unsichtbar. Die Autor:in sieht ihre Beiträge immer (F-401).
 */
export function canSeePost(p: PostAccess, v: PostViewer): boolean {
  if (v.isAuthor) return true;
  if (p.authorSuspended && !v.canModerate) return false;
  if (p.hidden && !v.canModerate) return false;
  if (p.channel === 'group') {
    if (!v.groupVisible) return false;
    if (p.visibility === 'public') return true;
    return p.visibility === 'members' && !!v.isMember;
  }
  return p.visibility === 'public' && p.authorPublic;
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
export type ChannelRef = { kind: 'user' } | { kind: 'group'; slug: string; name: string; groupKind: GroupKind };

/**
 * „Wo steht es“ (F-401): Heimatverlauf und – bei Törns – die Gruppen, in denen er gezeigt wird (11.12). Für die eigene
 * Seite formuliert („in deinem Profil“).
 */
export function whereLabel(channel: ChannelRef, groups: ReadonlyArray<{ name: string }> = []): string {
  const home = channel.kind === 'group' ? `in ${channel.groupKind === 'team' ? 'Team' : 'Verein'} ${channel.name}` : 'in deinem Profil';
  if (!groups.length) return home;
  return `${home} und in ${groups.map((g) => g.name).join(', ')}`;
}

/** Bereiche von „Mein Verlauf“: alles oder nur, was nur ich sehe (B12). */
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
}

/** Beitrag auf der Profilseite für Besucher (F-420): im Profil oder in einer Gruppe, die der Leser sehen darf. */
export interface ProfilePost {
  id: string;
  createdAt: number;
  body: string;
  link: string | null;
  /** Gruppen-Beitrag: „Wo steht es“ */
  group: { slug: string; name: string; kind: GroupKind } | null;
  /** effektive Sichtbarkeit („Wer sieht es“) */
  visibility: PostVisibility;
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
