// Einladungen (Konzept Abschnitt 10): Boots-Admins per E-Mail, Crew auf einem Törn per Link oder E-Mail.
// Tokens liegen nur als SHA-256-Hash vor; eingelöst wird ausdrücklich per POST nach Anmeldung.
import type { Env } from './env';
import { currentUser, isDevHost, requireUser, type User } from './auth';
import { roleFor } from './boats';
import { randomId, randomToken, sha256Hex } from './crypto';
import { HttpError, clientIp, json, rateLimit, readJson } from './http';
import { inviteMail, sendMail } from './mail';
import { assertActive } from './moderation';
import { getShareRow, ownedShare, visibleShare } from './shares';
import { GROUP_FULL, addMember, insertRequest, loadGroup, roleIn } from './groups';
import { addFollow } from './follows';
import { GROUP_LIMITS } from '../src/domain/limits';
import { canManageGroup, effectiveJoinMode, inviteJoinsDirectly, type Approvers, type JoinMode } from '../src/domain/groups';
import { BOAT_ID_RE, TOKEN_RE, normalizeEmail, normalizeHandle, parseInviteKind, type InviteKind } from './validate';
import { funnyName } from '../src/domain/names';
import { notifyInvite, readInviteNotification } from './notifications';
import { deleteInviteNotifications } from './notification-cleanup';
import { prefsOf } from './notification-mail';

const DAY = 86_400_000;

/** Missbrauchsgrenzen (Konzept 10.5) – gleich für kostenlos und Unterstützer. */
export const INVITE_LIMITS = {
  perUserPerDay: 20,
  adminsPerBoat: 10,
  crewPerShare: 30,
  pendingPerShare: 10,
  /** Einladungsmails pro Tag für den ganzen Server (Resend Free: 100/Tag, Rest für Anmeldungen) */
  mailsPerDay: 50,
  adminDays: 7,
  crewDays: 14,
  /** Einladungen ohne Ziel („Freunde einladen“, Konzept 14.2) */
  friendDays: 14,
  friendLinkUses: 20,
} as const;

const BOAT_NOT_FOUND = () => new HttpError(404, 'not_found', 'Dieses Boot gibt es nicht (mehr).');
const SHARE_NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Freigabe gibt es nicht (mehr).');
const INVALID = () => new HttpError(400, 'invalid_invite', 'Die Einladung ist ungültig, abgelaufen oder wurde schon benutzt.');
const NOT_OWNER = () => new HttpError(403, 'forbidden', 'Nur der Eigner kann Admins einladen und entfernen.');

interface InviteRow {
  id: string;
  kind: string;
  boat_id: string | null;
  share_id: string | null;
  group_id?: string | null;
  inviter_id: string;
  email: string | null;
  /** an dieses Konto gebunden (Einladung über den Profilnamen) */
  invitee_id: string | null;
  max_uses: number;
  uses: number;
  created_at: number;
  expires_at: number;
}

interface PendingRow extends Pick<InviteRow, 'id' | 'email' | 'max_uses' | 'uses' | 'created_at' | 'expires_at'> {
  invitee_name?: string | null;
  invitee_handle?: string | null;
}

/**
 * Offene Einladung für die Liste des Eigentümers – ohne Token (der liegt nur als Hash vor). `email` ist nur die
 * Adresse, die er selbst eingegeben hat; bei Einladungen über den Profilnamen steht dort der Name, nie eine Adresse.
 */
const inviteShape = (i: PendingRow) => ({
  id: i.id,
  email: i.email,
  invitee: i.invitee_handle ? { handle: i.invitee_handle, displayName: i.invitee_name ?? '' } : null,
  /** Einladungslink (ohne Adresse): wie oft noch nutzbar */
  usesLeft: i.max_uses - i.uses,
  createdAt: i.created_at,
  expiresAt: i.expires_at,
});

const inviteLink = (request: Request, token: string) => `${new URL(request.url).origin}/einladung#token=${token}`;

/** Lokal im Log-Modus: Link direkt zurückgeben (wie beim Login), damit man ohne Mailserver testen kann. */
const devLink = (request: Request, env: Env, link: string) => (env.MAIL_PROVIDER === 'log' && isDevHost(new URL(request.url)) ? link : undefined);

const pendingSql = (col: 'boat_id' | 'share_id' | 'group_id') =>
  `SELECT i.id, i.email, i.max_uses, i.uses, i.created_at, i.expires_at, p.display_name AS invitee_name, p.handle AS invitee_handle
   FROM invites i LEFT JOIN profiles p ON p.user_id = i.invitee_id
   WHERE i.${col} = ? AND i.expires_at > ? AND i.uses < i.max_uses ORDER BY i.created_at`;

async function count(env: Env, sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
}

/** Selbst gewählter Anzeigename, sonst der Spaßname des Kontos – nie die E-Mail-Adresse. */
async function displayName(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT display_name FROM profiles WHERE user_id = ?').bind(userId).first<{ display_name: string }>();
  return row?.display_name || funnyName(userId);
}

/**
 * Wen die Einladung erreicht: eine E-Mail-Adresse (auch für neue Konten), ein bestehendes Konto über seinen
 * öffentlichen Profilnamen (`userId`, die Adresse bleibt beim Server) oder niemand bestimmtes (Einladungslink).
 */
type Recipient = { email: string } | { userId: string; name: string; handle: string } | null;

interface NewInvite {
  kind: InviteKind;
  boatId?: string;
  shareId?: string;
  groupId?: string;
  /** nur bei Gruppen: Verein oder Team (Mailtext) */
  groupKind?: 'club' | 'team';
  to: Recipient;
  maxUses: number;
  days: number;
  targetName: string;
}

/**
 * Empfänger aus dem Body: `{ email }` oder `{ handle }` (Profilname, auch mit „@“). Über den Namen nur öffentliche
 * Profile – private, „Nur mit Link“ und ausgeblendete verhalten sich wie unbekannt. Ohne beides: Einladungslink, falls erlaubt.
 */
async function readRecipient(env: Env, body: { email?: unknown; handle?: unknown }, linkAllowed: boolean): Promise<Recipient> {
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  if (!empty(body.handle)) {
    const handle = normalizeHandle(typeof body.handle === 'string' ? body.handle.replace(/^@/, '') : body.handle);
    const p = handle
      ? await env.DB.prepare("SELECT user_id, display_name, handle FROM profiles WHERE handle = ? AND visibility = 'public' AND hidden_at IS NULL")
          .bind(handle)
          .first<{ user_id: string; display_name: string; handle: string }>()
      : null;
    if (!p) throw new HttpError(404, 'profile_not_found', 'Kein öffentliches Profil mit diesem Namen. Lade per E-Mail-Adresse ein.');
    return { userId: p.user_id, name: p.display_name, handle: p.handle };
  }
  if (empty(body.email)) {
    if (linkAllowed) return null;
    throw new HttpError(400, 'invalid_email', 'Bitte eine E-Mail-Adresse oder einen Profilnamen angeben.');
  }
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'invalid_email', 'Bitte eine gültige E-Mail-Adresse angeben.');
  return { email };
}

/** Selbst eingeladen? (eigene Adresse oder eigener Profilname) */
const isSelf = (to: Recipient, user: User) => !!to && ('email' in to ? to.email === user.email : to.userId === user.id);

/**
 * Bei Einladungen über den Profilnamen ist die Person öffentlich bekannt – „schon dabei“ verrät dann nichts.
 * Bei Adressen wird bewusst nicht geprüft, sonst ließe sich ausprobieren, welche Adresse zu wem gehört.
 */
async function checkNotMember(env: Env, to: Recipient, table: 'boat_admins' | 'share_crew' | 'group_members', id: string) {
  if (!to || 'email' in to) return;
  const col = table === 'boat_admins' ? 'boat_id' : table === 'share_crew' ? 'share_id' : 'group_id';
  if (await count(env, `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ? AND user_id = ?`, id, to.userId)) {
    throw new HttpError(409, 'already_member', `${to.name} ist schon dabei.`);
  }
}

/** Legt eine Einladung an (Grenzen pro Konto und Mail-Budget) und verschickt bei gebundenen Einladungen die Mail. */
async function createInvite(request: Request, env: Env, user: User, o: NewInvite) {
  await assertActive(env, user); // gesperrte Konten laden nicht ein (Konzept 4.4)
  await rateLimit(env.AUTH_LIMITER, `invite:${user.id}`);
  const now = Date.now();
  if ((await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND created_at > ?', user.id, now - DAY)) >= INVITE_LIMITS.perUserPerDay) {
    throw new HttpError(429, 'invite_quota', `Du hast heute schon ${INVITE_LIMITS.perUserPerDay} Einladungen verschickt – morgen geht es weiter.`);
  }
  const to = o.to;
  let mailTo: string | null = null;
  if (to) {
    const col = o.boatId ? 'boat_id' : o.groupId ? 'group_id' : o.shareId ? 'share_id' : 'inviter_id';
    const [field, value] = 'email' in to ? ['email', to.email] : ['invitee_id', to.userId];
    const dup = await count(
      env,
      `SELECT COUNT(*) AS n FROM invites WHERE kind = ? AND ${col} = ? AND ${field} = ? AND expires_at > ? AND uses < max_uses`,
      o.kind, o.boatId ?? o.groupId ?? o.shareId ?? user.id, value, now,
    );
    if (dup) throw new HttpError(409, 'already_invited', 'An diese Person ist schon eine Einladung unterwegs. Zieh sie zurück, um neu einzuladen.');
    if ((await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE (email IS NOT NULL OR invitee_id IS NOT NULL) AND created_at > ?', now - DAY)) >= INVITE_LIMITS.mailsPerDay) {
      throw new HttpError(429, 'mail_budget', 'Heute wurden schon sehr viele Einladungen verschickt. Bitte morgen erneut versuchen.');
    }
    // Profilname: die Adresse des Kontos holt nur der Server – sie erscheint nie in einer Antwort. Ob eine Mail kommt,
    // entscheidet das eingeladene Konto (Konzept 17.6: Einladungen keine/Mail/Push); in der Glocke steht sie immer.
    // An eine Adresse geht immer eine Mail – sie ist die Einladung selbst.
    if ('email' in to) mailTo = to.email;
    else if ((await prefsOf(env, to.userId)).invite === 'mail') {
      mailTo = (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(to.userId).first<{ email: string }>())?.email ?? null;
    }
  }
  const token = randomToken();
  const row: InviteRow = {
    id: randomId(), kind: o.kind, boat_id: o.boatId ?? null, share_id: o.shareId ?? null, group_id: o.groupId ?? null, inviter_id: user.id,
    email: to && 'email' in to ? to.email : null, invitee_id: to && 'userId' in to ? to.userId : null,
    max_uses: o.maxUses, uses: 0, created_at: now, expires_at: now + o.days * DAY,
  };
  await env.DB.prepare(
    `INSERT INTO invites (id, token_hash, kind, boat_id, share_id, group_id, inviter_id, email, invitee_id, max_uses, uses, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(row.id, await sha256Hex(token), row.kind, row.boat_id, row.share_id, row.group_id, row.inviter_id, row.email, row.invitee_id, row.max_uses, row.created_at, row.expires_at)
    .run();
  const link = inviteLink(request, token);
  if (mailTo) {
    try {
      await sendMail(env, inviteMail(env, mailTo, { kind: o.kind, groupKind: o.groupKind, inviter: await displayName(env, user.id), target: o.targetName, link, days: o.days }));
    } catch (err) {
      // Ohne Mail keine offene Einladung – sonst sperrt sie die Person (already_invited).
      await env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(row.id).run();
      throw err;
    }
  }
  // Bestehende Konten sehen die Einladung zusätzlich in der Glocke (Konzept 17, F-250).
  if (to) await notifyInvite(env, row.id, 'email' in to ? { email: to.email } : { userId: to.userId }, user.id);
  const shaped = inviteShape(to && 'userId' in to ? { ...row, invitee_name: to.name, invitee_handle: to.handle } : row);
  return { invite: shaped, link };
}

// ---------------------------------------------------------------- Boots-Admins

/**
 * GET /api/boats/:id/admins – Eigner und Admins. Admins erscheinen mit Anzeigenamen (sonst Spaßname), nie mit
 * E-Mail-Adresse; offene Einladungen (mit der Adresse, die der Eigner selbst eingegeben hat) nur für den Eigner.
 */
export async function listBoatAdmins(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const role = BOAT_ID_RE.test(id) ? await roleFor(env, user.id, id) : null;
  if (!role) throw BOAT_NOT_FOUND();
  const owner = role === 'owner';
  const { results } = await env.DB.prepare(
    `SELECT a.user_id, a.created_at, p.handle, p.display_name, CASE WHEN p.hidden_at IS NULL THEN p.visibility END AS visibility FROM boat_admins a
     LEFT JOIN profiles p ON p.user_id = a.user_id WHERE a.boat_id = ? ORDER BY a.created_at`,
  )
    .bind(id)
    .all<{ user_id: string; created_at: number; handle: string | null; display_name: string | null; visibility: string | null }>();
  const invites = owner ? (await env.DB.prepare(pendingSql('boat_id')).bind(id, Date.now()).all<InviteRow>()).results.map(inviteShape) : [];
  return json({
    role,
    admins: results.map((a) => ({
      id: a.user_id,
      displayName: a.display_name || funnyName(a.user_id),
      // Profil-Link nur bei öffentlichem Profil – sonst wäre die Seite ohnehin 404.
      handle: a.visibility === 'public' ? a.handle : null,
      isSelf: a.user_id === user.id,
      createdAt: a.created_at,
    })),
    invites,
  });
}

/**
 * POST /api/boats/:id/invites – nur der Eigner lädt ein: `{ email }` (neue wie bestehende Konten, an die Adresse
 * gebunden) oder `{ handle }` (bestehendes Konto mit öffentlichem Profil). 7 Tage, einmalig.
 */
export async function inviteBoatAdmin(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const role = BOAT_ID_RE.test(id) ? await roleFor(env, user.id, id) : null;
  if (!role) throw BOAT_NOT_FOUND();
  if (role !== 'owner') throw NOT_OWNER();
  const to = await readRecipient(env, await readJson<{ email?: unknown; handle?: unknown }>(request), false);
  if (isSelf(to, user)) throw new HttpError(409, 'own_object', 'Du bist schon Eigner dieses Boots.');
  await checkNotMember(env, to, 'boat_admins', id);
  // Bewusst kein Abgleich mit den Adressen bestehender Admins: sonst ließe sich ausprobieren, welche Adresse zu wem
  // gehört. Wer schon Admin ist, verbraucht beim Annehmen nichts (already).
  const now = Date.now();
  const used =
    (await count(env, 'SELECT COUNT(*) AS n FROM boat_admins WHERE boat_id = ?', id)) +
    (await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE boat_id = ? AND expires_at > ? AND uses < max_uses', id, now));
  if (used >= INVITE_LIMITS.adminsPerBoat) throw new HttpError(409, 'quota', `Ein Boot hat höchstens ${INVITE_LIMITS.adminsPerBoat} Admins (offene Einladungen zählen mit).`);
  const boat = await env.DB.prepare('SELECT name FROM boats WHERE id = ?').bind(id).first<{ name: string }>();
  const { invite, link } = await createInvite(request, env, user, {
    kind: 'boat_admin', boatId: id, to, maxUses: 1, days: INVITE_LIMITS.adminDays, targetName: boat?.name ?? '',
  });
  return json({ invite, devLink: devLink(request, env, link) }, { status: 201 });
}

/** DELETE /api/boats/:id/admins/:userId – Eigner entfernt jeden Admin, ein Admin nur sich selbst (`me`: „Boot verlassen“). */
export async function removeBoatAdmin(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const user = await requireUser(request, env);
  const role = BOAT_ID_RE.test(id) ? await roleFor(env, user.id, id) : null;
  if (!role) throw BOAT_NOT_FOUND();
  const target = who === 'me' ? user.id : who;
  if (role === 'owner' && target === user.id) throw new HttpError(400, 'owner_cannot_leave', 'Der Eigner kann sein Boot nicht verlassen – nur löschen.');
  if (role === 'admin' && target !== user.id) throw NOT_OWNER();
  const res = await env.DB.prepare('DELETE FROM boat_admins WHERE boat_id = ? AND user_id = ?').bind(id, target).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Diese Person ist kein Admin dieses Boots.');
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- Crew

interface CrewRow {
  user_id: string;
  created_at: number;
  handle: string | null;
  display_name: string | null;
  visibility: string | null;
}

async function crewRows(env: Env, shareId: string): Promise<CrewRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.user_id, c.created_at, p.handle, p.display_name, CASE WHEN p.hidden_at IS NULL THEN p.visibility END AS visibility FROM share_crew c
     LEFT JOIN profiles p ON p.user_id = c.user_id WHERE c.share_id = ? ORDER BY c.created_at`,
  )
    .bind(shareId)
    .all<CrewRow>();
  return results;
}

/**
 * GET /api/shares/:id/crew – wer den Törn sehen darf (gleiche Prüfung wie die Freigabe). Besucher sehen Crew nur bei
 * öffentlichen Törns: mit öffentlichem Profil Name und Profil-Link, sonst nur den Spaßnamen ohne Link (F-134; nie den
 * gewählten Anzeigenamen oder Profilnamen eines nicht öffentlichen Profils, Konzept 10.6). Der Eigentümer sieht alle,
 * mit IDs zum Entfernen und offenen Einladungen.
 */
export async function getCrew(request: Request, env: Env, id: string): Promise<Response> {
  const { row, isOwner, user } = await visibleShare(request, env, id);
  const rows = await crewRows(env, row.id);
  const isCrew = !!user && rows.some((r) => r.user_id === user.id);
  if (isOwner) {
    const invites = (await env.DB.prepare(pendingSql('share_id')).bind(row.id, Date.now()).all<InviteRow>()).results.map(inviteShape);
    return json({
      members: rows.map((r) => ({ id: r.user_id, handle: r.visibility === 'public' ? r.handle : null, displayName: r.display_name || funnyName(r.user_id) })),
      others: 0,
      isOwner: true,
      isCrew: false,
      invites,
    });
  }
  const shown = row.visibility === 'public' ? rows : [];
  return json({
    members: shown.map((r) =>
      r.visibility === 'public' && r.handle
        ? { id: null, handle: r.handle, displayName: r.display_name ?? '' }
        : { id: null, handle: null, displayName: funnyName(r.user_id) },
    ),
    others: 0,
    isOwner: false,
    isCrew,
    invites: [],
  });
}

/**
 * POST /api/shares/:id/invites – nur der Eigentümer. `{ email }`: Einladung per Mail (gebunden, einmalig);
 * ohne Adresse: Einladungslink, mehrfach nutzbar bis zur Crew-Obergrenze. Der Link steht nur in dieser Antwort.
 */
export async function inviteCrew(request: Request, env: Env, id: string): Promise<Response> {
  const { row, user } = await ownedShare(request, env, id);
  const to = await readRecipient(env, await readJson<{ email?: unknown; handle?: unknown }>(request), true);
  const now = Date.now();
  const crew = await count(env, 'SELECT COUNT(*) AS n FROM share_crew WHERE share_id = ?', row.id);
  if (crew >= INVITE_LIMITS.crewPerShare) throw new HttpError(409, 'quota', `Ein Törn hat höchstens ${INVITE_LIMITS.crewPerShare} Crew-Mitglieder.`);
  if ((await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE share_id = ? AND expires_at > ? AND uses < max_uses', row.id, now)) >= INVITE_LIMITS.pendingPerShare) {
    throw new HttpError(409, 'quota', `Höchstens ${INVITE_LIMITS.pendingPerShare} offene Einladungen je Törn – zieh alte zurück.`);
  }
  if (isSelf(to, user)) throw new HttpError(409, 'own_object', 'Das ist dein eigener Törn.');
  await checkNotMember(env, to, 'share_crew', row.id);
  const { invite, link } = await createInvite(request, env, user, {
    kind: 'crew', shareId: row.id, to, maxUses: to ? 1 : INVITE_LIMITS.crewPerShare - crew, days: INVITE_LIMITS.crewDays, targetName: row.title,
  });
  return json({ invite, link: to ? undefined : link, devLink: to ? devLink(request, env, link) : undefined }, { status: 201 });
}

/** DELETE /api/shares/:id/crew/:userId – Eigentümer entfernt jeden, ein Crew-Mitglied nur sich selbst (`me`). */
export async function removeCrew(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = await getShareRow(env, id);
  // gesperrter Törn (Konzept 18.2): die Crew bleibt, wie sie ist
  if (!row || row.locked_at) throw SHARE_NOT_FOUND();
  const isOwner = row.user_id === user.id;
  const target = who === 'me' ? user.id : who;
  // Fremde (weder Eigentümer noch selbst betroffen) bekommen dieselbe 404 wie bei unbekannten Törns.
  if (!isOwner && target !== user.id) throw SHARE_NOT_FOUND();
  const res = await env.DB.prepare('DELETE FROM share_crew WHERE share_id = ? AND user_id = ?').bind(row.id, target).run();
  if (!res.meta.changes) throw isOwner ? new HttpError(404, 'not_found', 'Diese Person ist nicht in der Crew.') : SHARE_NOT_FOUND();
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- Gruppen (Konzept 11.1)

/**
 * POST /api/groups/:id/invites – alle Mitglieder (Konzept 14.1). `{ email }` oder `{ handle }`: Einladung per Mail
 * (gebunden, einmalig); ohne Adresse: Einladungslink (bis 100 Nutzungen). Der Link steht nur in dieser Antwort. Lädt
 * ein einfaches Mitglied in eine nicht offene Gruppe ein, wird die Annahme zur Beitrittsanfrage (`needsApproval`).
 */
export async function inviteGroup(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const g = await loadGroup(env, id);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  if (!g || !role || (g.hidden_at && !canManageGroup(role))) throw new HttpError(404, 'not_found', 'Diese Gruppe gibt es nicht oder sie ist geschlossen.');
  const to = await readRecipient(env, await readJson<{ email?: unknown; handle?: unknown }>(request), true);
  if (isSelf(to, user)) throw new HttpError(409, 'own_object', 'Du bist schon Mitglied dieser Gruppe.');
  await checkNotMember(env, to, 'group_members', g.id);
  const members = await count(env, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', g.id);
  if (members >= GROUP_LIMITS.members) throw GROUP_FULL();
  const { invite, link } = await createInvite(request, env, user, {
    kind: 'group', groupId: g.id, groupKind: g.kind, to, maxUses: to ? 1 : Math.min(GROUP_LIMITS.linkUses, GROUP_LIMITS.members - members),
    days: GROUP_LIMITS.inviteDays, targetName: g.name,
  });
  const needsApproval = !inviteJoinsDirectly(role, effectiveJoinMode(g), g.approve_by);
  return json({ invite, link: to ? undefined : link, devLink: to ? devLink(request, env, link) : undefined, needsApproval }, { status: 201 });
}

// ---------------------------------------------------------------- Freunde einladen (ohne Ziel)

/**
 * POST /api/invites – Einladung zu Sail Explorer ohne Boot, Törn oder Gruppe (Konzept 14.2): `{ email }`, `{ handle }`
 * oder ohne beides ein Einladungslink (bis 20 Nutzungen). Wer annimmt, folgt der einladenden Person und umgekehrt.
 */
export async function inviteFriend(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const to = await readRecipient(env, await readJson<{ email?: unknown; handle?: unknown }>(request), true);
  if (isSelf(to, user)) throw new HttpError(409, 'own_object', 'Dich selbst musst du nicht einladen.');
  const { invite, link } = await createInvite(request, env, user, {
    kind: 'friend', to, maxUses: to ? 1 : INVITE_LIMITS.friendLinkUses, days: INVITE_LIMITS.friendDays, targetName: '',
  });
  return json({ invite, link: to ? undefined : link, devLink: to ? devLink(request, env, link) : undefined }, { status: 201 });
}

// ---------------------------------------------------------------- Einlösen, Zurückziehen

interface LoadedInvite extends InviteRow {
  group_name: string | null;
  group_owner: string | null;
  group_slug: string | null;
  group_kind: string | null;
  group_join_mode: JoinMode | null;
  group_approve_by: Approvers | null;
  group_visibility: string | null;
  group_hidden_at: number | null;
  boat_name: string | null;
  boat_owner: string | null;
  share_title: string | null;
  share_owner: string | null;
  share_visibility: string | null;
  /** einladendes Konto gesperrt (Konzept 18.2) */
  inviter_locked: number | null;
}

// Gesperrte Ziele (Boot, Törn, Gruppe) zählen wie gelöscht, Einladungen gesperrter Konten wie ungültig (Konzept 18.2).
const LOADED_SELECT = `SELECT i.*, b.name AS boat_name, b.owner_id AS boat_owner, s.title AS share_title, s.user_id AS share_owner, s.visibility AS share_visibility,
    g.name AS group_name, g.owner_id AS group_owner, g.slug AS group_slug, g.kind AS group_kind, g.join_mode AS group_join_mode, g.approve_by AS group_approve_by,
    g.visibility AS group_visibility, g.hidden_at AS group_hidden_at,
    (SELECT locked_at FROM users WHERE id = i.inviter_id) AS inviter_locked
  FROM invites i LEFT JOIN boats b ON b.id = i.boat_id AND b.locked_at IS NULL LEFT JOIN shares s ON s.id = i.share_id AND s.locked_at IS NULL
    LEFT JOIN groups g ON g.id = i.group_id AND g.locked_at IS NULL`;

const usable = (row: LoadedInvite | null): row is LoadedInvite =>
  !!row && !row.inviter_locked && !!parseInviteKind(row.kind) && (row.kind === 'friend' || !!(row.boat_owner || row.share_owner || row.group_owner));

/** Eigentümer des Ziels – bei Einladungen ohne Ziel die einladende Person. */
const ownerOf = (inv: LoadedInvite) => (inv.kind === 'friend' ? inv.inviter_id : (inv.boat_owner ?? inv.share_owner ?? inv.group_owner));
const targetOf = (inv: LoadedInvite) =>
  inv.kind === 'boat_admin' ? inv.boat_name : inv.kind === 'group' ? inv.group_name : inv.kind === 'friend' ? null : inv.share_title;

/** Gültige Einladung zum Token – ungültige Form, unbekannt, abgelaufen oder aufgebraucht: 400 und Fehlversuch (pro IP). */
async function loadInvite(request: Request, env: Env, token: unknown): Promise<LoadedInvite> {
  const row =
    typeof token === 'string' && TOKEN_RE.test(token)
      ? await env.DB.prepare(`${LOADED_SELECT} WHERE i.token_hash = ? AND i.expires_at > ? AND i.uses < i.max_uses`)
          .bind(await sha256Hex(token), Date.now())
          .first<LoadedInvite>()
      : null;
  if (!usable(row)) {
    await rateLimit(env.LINK_LIMITER, `invite:${clientIp(request)}`);
    throw INVALID();
  }
  return row;
}

async function isMember(env: Env, inv: LoadedInvite, userId: string): Promise<boolean> {
  if (inv.kind === 'group') return !!(await count(env, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND user_id = ?', inv.group_id, userId));
  if (inv.kind === 'friend') return !!(await count(env, `SELECT COUNT(*) AS n FROM follows WHERE user_id = ? AND target_kind = 'user' AND target_id = ?`, userId, inv.inviter_id));
  return inv.kind === 'boat_admin'
    ? !!(await count(env, 'SELECT COUNT(*) AS n FROM boat_admins WHERE boat_id = ? AND user_id = ?', inv.boat_id, userId))
    : !!(await count(env, 'SELECT COUNT(*) AS n FROM share_crew WHERE share_id = ? AND user_id = ?', inv.share_id, userId));
}

/** Gebunden (an eine Adresse oder ein Konto)? Dann gilt sie nur für genau dieses Konto. */
const isBound = (inv: InviteRow) => !!(inv.email || inv.invitee_id);
const isFor = (inv: InviteRow, user: User) => (inv.invitee_id ? inv.invitee_id === user.id : inv.email ? inv.email === user.email : true);

/**
 * POST /api/invites/peek – wozu die Einladung ist, ohne sie einzulösen. Nennt Ziel und den Einladenden
 * (Anzeigename bzw. Spaßname). Die gebundene Adresse erscheint nicht, nur ob es eine Bindung gibt und ob sie passt.
 */
export async function peekInvite(request: Request, env: Env): Promise<Response> {
  const inv = await loadInvite(request, env, (await readJson<{ token?: unknown }>(request)).token);
  const user = await currentUser(request, env);
  // Einladung angesehen (Link aus der Mail): die Benachrichtigung dazu ist gelesen (F-253).
  if (user && isBound(inv) && isFor(inv, user)) await readInviteNotification(env, user.id, inv.id);
  return json({
    kind: inv.kind,
    target: targetOf(inv),
    /** nur bei Gruppen: Verein oder Team */
    groupKind: inv.kind === 'group' ? inv.group_kind : undefined,
    inviter: await displayName(env, inv.inviter_id),
    /** an eine Adresse bzw. ein Konto gebunden (welches, verrät die Antwort nicht) */
    bound: isBound(inv),
    expiresAt: inv.expires_at,
    /** null: nicht angemeldet bzw. nicht gebunden */
    emailMatches: user && isBound(inv) ? isFor(inv, user) : null,
    isOwner: !!user && user.id === ownerOf(inv),
    alreadyMember: !!user && (await isMember(env, inv, user.id)),
  });
}

/** Annehmen nach allen Prüfungen (Konzept 10.2) – gemeinsam für Link (Token) und Posteingang im Konto. */
async function acceptLoaded(env: Env, user: User, inv: LoadedInvite) {
  await assertActive(env, user);
  if (!isFor(inv, user)) {
    throw new HttpError(403, 'invite_wrong_account', 'Diese Einladung gilt für ein anderes Konto. Bitte mit der eingeladenen E-Mail-Adresse anmelden.');
  }
  if (inv.kind === 'group') return acceptGroupInvite(env, inv, user);
  if (inv.kind === 'friend') return acceptFriendInvite(env, inv, user);
  const boat = inv.kind === 'boat_admin';
  const targetId = (boat ? inv.boat_id : inv.share_id)!;
  const result = {
    kind: inv.kind,
    // Admins sehen die Bootsseite immer; Crew-Sein öffnet keinen nicht öffentlichen Törn (Konzept 10.6).
    path: boat ? `/b/${targetId}` : inv.share_visibility === 'public' ? `/s/${targetId}` : null,
    target: boat ? inv.boat_name : inv.share_title,
  };
  if (user.id === (boat ? inv.boat_owner : inv.share_owner)) {
    throw new HttpError(409, 'own_object', boat ? 'Du bist schon Eigner dieses Boots.' : 'Das ist dein eigener Törn.');
  }
  // Schon Mitglied: nichts verbrauchen.
  if (await isMember(env, inv, user.id)) return { ...result, already: true };
  if (boat) {
    if ((await count(env, 'SELECT COUNT(*) AS n FROM boat_admins WHERE boat_id = ?', targetId)) >= INVITE_LIMITS.adminsPerBoat) {
      throw new HttpError(409, 'quota', 'Dieses Boot hat schon die höchste Zahl an Admins.');
    }
  } else {
    // Kein Profil nötig: ohne eigenen Namen trägt das Konto seinen Spaßnamen, öffentlich zählt es nur als Anzahl.
    if ((await count(env, 'SELECT COUNT(*) AS n FROM share_crew WHERE share_id = ?', targetId)) >= INVITE_LIMITS.crewPerShare) {
      throw new HttpError(409, 'quota', 'Die Crew dieses Törns ist voll.');
    }
  }
  if (!(await claim(env, inv.id))) throw INVALID();
  const now = Date.now();
  await env.DB.prepare(boat ? 'INSERT OR IGNORE INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)' : 'INSERT OR IGNORE INTO share_crew (share_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(targetId, user.id, now)
    .run();
  return { ...result, already: false };
}

/** Eine Nutzung der Einladung verbrauchen – atomar, bei gleichzeitigem Einlösen gewinnt nur, wer noch eine bekommt. */
async function claim(env: Env, id: string): Promise<boolean> {
  return !!(await env.DB.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND expires_at > ? RETURNING id').bind(id, Date.now()).first());
}

/**
 * Gruppeneinladung einlösen: Mitglied werden (höchstens 500), offene Anfrage erledigen, Beitritt protokollieren. Hat
 * ein einfaches Mitglied in eine nicht offene Gruppe eingeladen, entsteht stattdessen eine Beitrittsanfrage (Konzept 14.1).
 */
async function acceptGroupInvite(env: Env, inv: LoadedInvite, user: User) {
  const result = { kind: inv.kind, path: `/g/${inv.group_slug}`, target: inv.group_name, groupKind: inv.group_kind, requested: false };
  if (user.id === inv.group_owner) throw new HttpError(409, 'own_object', 'Das ist deine eigene Gruppe.');
  if (await isMember(env, inv, user.id)) return { ...result, already: true };
  if ((await count(env, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', inv.group_id)) >= GROUP_LIMITS.members) throw GROUP_FULL();
  const mode = effectiveJoinMode({ join_mode: inv.group_join_mode!, visibility: inv.group_visibility!, hidden_at: inv.group_hidden_at });
  const direct = inviteJoinsDirectly(await roleIn(env, inv.inviter_id, inv.group_id!), mode, inv.group_approve_by!);
  if (!direct) {
    // Anfrage mit denselben Grenzen wie direkt gestellte; eine schon bestehende verbraucht keine Nutzung.
    if (!(await insertRequest(env, inv.group_id!, user.id, `Eingeladen von ${await displayName(env, inv.inviter_id)}`))) {
      return { ...result, already: true, requested: true };
    }
    if (!(await claim(env, inv.id))) {
      await env.DB.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').bind(inv.group_id, user.id).run();
      throw INVALID();
    }
    return { ...result, already: false, requested: true };
  }
  if (!(await claim(env, inv.id))) throw INVALID();
  await addMember(env, inv.group_id!, user.id);
  return { ...result, already: false };
}

/** Einladung ohne Ziel einlösen: beide folgen einander (Konzept 14.2). Pfad: Profil der einladenden Person, falls öffentlich. */
async function acceptFriendInvite(env: Env, inv: LoadedInvite, user: User) {
  if (user.id === inv.inviter_id) throw new HttpError(409, 'own_object', 'Das ist deine eigene Einladung.');
  const p = await env.DB.prepare(`SELECT handle, display_name FROM profiles WHERE user_id = ? AND visibility = 'public' AND hidden_at IS NULL`)
    .bind(inv.inviter_id)
    .first<{ handle: string; display_name: string }>();
  const result = { kind: inv.kind, path: p ? `/u/${p.handle}` : '/', target: p?.display_name ?? (await displayName(env, inv.inviter_id)) };
  if (await isMember(env, inv, user.id)) return { ...result, already: true };
  if (!(await claim(env, inv.id))) throw INVALID();
  // Folgen mit derselben Grenze wie per Knopf – wer schon am Limit ist, folgt eben nicht zusätzlich.
  await addFollow(env, user.id, 'user', inv.inviter_id);
  await addFollow(env, inv.inviter_id, 'user', user.id);
  return { ...result, already: false };
}

/** POST /api/invites/accept – angemeldet, ausdrücklich bestätigt, mit dem Token aus dem Link. */
export async function acceptInvite(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const inv = await loadInvite(request, env, (await readJson<{ token?: unknown }>(request)).token);
  return json(await acceptAndForget(env, user, inv));
}

// ---------------------------------------------------------------- Posteingang: Einladungen an mich

/** Offene Einladungen an das angemeldete Konto: über seinen Profilnamen oder an seine Adresse (neu wie bestehend). */
async function myInvites(env: Env, user: User, id?: string): Promise<LoadedInvite[]> {
  const { results } = await env.DB.prepare(
    `${LOADED_SELECT} WHERE (i.invitee_id = ?1 OR i.email = ?2) AND i.expires_at > ?3 AND i.uses < i.max_uses ${id ? 'AND i.id = ?4' : ''} ORDER BY i.created_at DESC LIMIT 50`,
  )
    .bind(user.id, user.email, Date.now(), ...(id ? [id] : []))
    .all<LoadedInvite>();
  return results.filter(usable);
}

/**
 * GET /api/me/invites – Einladungen an mich, damit ein bestehendes Konto sie auch ohne Mail findet. Ohne eigene Objekte
 * und ohne solche, bei denen ich schon dabei bin.
 */
export async function listMyInvites(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const out = [];
  for (const inv of await myInvites(env, user)) {
    if (user.id === ownerOf(inv) || (await isMember(env, inv, user.id))) continue;
    out.push({
      id: inv.id,
      kind: inv.kind,
      target: targetOf(inv),
      groupKind: inv.kind === 'group' ? inv.group_kind : undefined,
      inviter: await displayName(env, inv.inviter_id),
      expiresAt: inv.expires_at,
    });
  }
  return json({ invites: out });
}

/** POST /api/me/invites/:id/accept – Einladung an mich aus dem Konto annehmen (gleiche Prüfungen wie per Link). */
export async function acceptMyInvite(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const [inv] = await myInvites(env, user, id);
  if (!inv) throw new HttpError(404, 'not_found', 'Diese Einladung gibt es nicht (mehr).');
  return json(await acceptAndForget(env, user, inv));
}

/** Annehmen; eine gebundene Einladung ist danach erledigt – ihre Benachrichtigung verschwindet (F-255). */
async function acceptAndForget(env: Env, user: User, inv: LoadedInvite) {
  const result = await acceptLoaded(env, user, inv);
  if (isBound(inv)) await deleteInviteNotifications(env, inv.id).run();
  return result;
}

/** DELETE /api/me/invites/:id – Einladung an mich ablehnen (sie verschwindet auch beim Einladenden). */
export async function declineMyInvite(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const res = await env.DB.prepare('DELETE FROM invites WHERE id = ? AND (invitee_id = ? OR email = ?)').bind(id, user.id, user.email).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Diese Einladung gibt es nicht (mehr).');
  await deleteInviteNotifications(env, id).run();
  return new Response(null, { status: 204 });
}

/** DELETE /api/invites/:id – Eigentümer des Ziels (Eigner des Boots bzw. Törns, bei Gruppen Eigner und Admins), ohne Ziel die einladende Person. */
export async function revokeInvite(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare(
    `SELECT i.id, i.group_id, CASE WHEN i.kind = 'friend' THEN i.inviter_id ELSE COALESCE(b.owner_id, s.user_id) END AS owner FROM invites i
     LEFT JOIN boats b ON b.id = i.boat_id LEFT JOIN shares s ON s.id = i.share_id WHERE i.id = ?`,
  )
    .bind(id)
    .first<{ id: string; group_id: string | null; owner: string | null }>();
  const allowed = !!row && (row.group_id ? canManageGroup(await roleIn(env, user.id, row.group_id)) : row.owner === user.id);
  if (!row || !allowed) throw new HttpError(404, 'not_found', 'Diese Einladung gibt es nicht (mehr).');
  await env.DB.batch([deleteInviteNotifications(env, id), env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(id)]);
  return new Response(null, { status: 204 });
}
