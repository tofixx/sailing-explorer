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
import { GROUP_FULL, addMember, loadGroup, roleIn } from './groups';
import { GROUP_LIMITS } from '../src/domain/limits';
import { canManageGroup } from '../src/domain/groups';
import { BOAT_ID_RE, TOKEN_RE, normalizeEmail, parseInviteKind, type InviteKind } from './validate';
import { funnyName } from '../src/domain/names';

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
  max_uses: number;
  uses: number;
  created_at: number;
  expires_at: number;
}

/** Offene Einladung für die Liste des Eigentümers – ohne Token (der liegt nur als Hash vor). */
const inviteShape = (i: Pick<InviteRow, 'id' | 'email' | 'max_uses' | 'uses' | 'created_at' | 'expires_at'>) => ({
  id: i.id,
  email: i.email,
  /** Einladungslink (ohne Adresse): wie oft noch nutzbar */
  usesLeft: i.max_uses - i.uses,
  createdAt: i.created_at,
  expiresAt: i.expires_at,
});

const inviteLink = (request: Request, token: string) => `${new URL(request.url).origin}/einladung#token=${token}`;

/** Lokal im Log-Modus: Link direkt zurückgeben (wie beim Login), damit man ohne Mailserver testen kann. */
const devLink = (request: Request, env: Env, link: string) => (env.MAIL_PROVIDER === 'log' && isDevHost(new URL(request.url)) ? link : undefined);

const pendingSql = (col: 'boat_id' | 'share_id' | 'group_id') =>
  `SELECT id, email, max_uses, uses, created_at, expires_at FROM invites WHERE ${col} = ? AND expires_at > ? AND uses < max_uses ORDER BY created_at`;

async function count(env: Env, sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
}

/** Selbst gewählter Anzeigename, sonst der Spaßname des Kontos – nie die E-Mail-Adresse. */
async function displayName(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT display_name FROM profiles WHERE user_id = ?').bind(userId).first<{ display_name: string }>();
  return row?.display_name || funnyName(userId);
}

interface NewInvite {
  kind: InviteKind;
  boatId?: string;
  shareId?: string;
  groupId?: string;
  /** nur bei Gruppen: Verein oder Team (Mailtext) */
  groupKind?: 'club' | 'team';
  email: string | null;
  maxUses: number;
  days: number;
  targetName: string;
}

/** Legt eine Einladung an (Grenzen pro Konto und Mail-Budget) und verschickt bei gebundenen Einladungen die Mail. */
async function createInvite(request: Request, env: Env, user: User, o: NewInvite) {
  await assertActive(env, user); // gesperrte Konten laden nicht ein (Konzept 4.4)
  await rateLimit(env.AUTH_LIMITER, `invite:${user.id}`);
  const now = Date.now();
  if ((await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND created_at > ?', user.id, now - DAY)) >= INVITE_LIMITS.perUserPerDay) {
    throw new HttpError(429, 'invite_quota', `Du hast heute schon ${INVITE_LIMITS.perUserPerDay} Einladungen verschickt – morgen geht es weiter.`);
  }
  if (o.email) {
    const col = o.boatId ? 'boat_id' : o.groupId ? 'group_id' : 'share_id';
    const dup = await count(env, `SELECT COUNT(*) AS n FROM invites WHERE ${col} = ? AND email = ? AND expires_at > ? AND uses < max_uses`, o.boatId ?? o.groupId ?? o.shareId, o.email, now);
    if (dup) throw new HttpError(409, 'already_invited', 'An diese Adresse ist schon eine Einladung unterwegs. Zieh sie zurück, um neu einzuladen.');
    if ((await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE email IS NOT NULL AND created_at > ?', now - DAY)) >= INVITE_LIMITS.mailsPerDay) {
      throw new HttpError(429, 'mail_budget', 'Heute wurden schon sehr viele Einladungen verschickt. Bitte morgen erneut versuchen.');
    }
  }
  const token = randomToken();
  const row: InviteRow = {
    id: randomId(), kind: o.kind, boat_id: o.boatId ?? null, share_id: o.shareId ?? null, group_id: o.groupId ?? null, inviter_id: user.id, email: o.email,
    max_uses: o.maxUses, uses: 0, created_at: now, expires_at: now + o.days * DAY,
  };
  await env.DB.prepare(
    `INSERT INTO invites (id, token_hash, kind, boat_id, share_id, group_id, inviter_id, email, max_uses, uses, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(row.id, await sha256Hex(token), row.kind, row.boat_id, row.share_id, row.group_id, row.inviter_id, row.email, row.max_uses, row.created_at, row.expires_at)
    .run();
  const link = inviteLink(request, token);
  if (o.email) {
    try {
      await sendMail(env, inviteMail(env, o.email, { kind: o.kind, groupKind: o.groupKind, inviter: await displayName(env, user.id), target: o.targetName, link, days: o.days }));
    } catch (err) {
      // Ohne Mail keine offene Einladung – sonst sperrt sie die Adresse (already_invited).
      await env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(row.id).run();
      throw err;
    }
  }
  return { invite: inviteShape(row), link };
}

/** E-Mail aus dem Body; Pflicht für Boots-Admins, optional für Crew (ohne = Einladungslink). */
function readEmail(input: unknown, required: boolean): string | null {
  if (!required && (input === undefined || input === null || input === '')) return null;
  const email = normalizeEmail(input);
  if (!email) throw new HttpError(400, 'invalid_email', 'Bitte eine gültige E-Mail-Adresse angeben.');
  return email;
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

/** POST /api/boats/:id/invites – nur der Eigner lädt per E-Mail ein (an die Adresse gebunden, 7 Tage, einmalig). */
export async function inviteBoatAdmin(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const role = BOAT_ID_RE.test(id) ? await roleFor(env, user.id, id) : null;
  if (!role) throw BOAT_NOT_FOUND();
  if (role !== 'owner') throw NOT_OWNER();
  const email = readEmail((await readJson<{ email?: unknown }>(request)).email, true)!;
  if (email === user.email) throw new HttpError(409, 'own_object', 'Du bist schon Eigner dieses Boots.');
  // Bewusst kein Abgleich mit den Adressen bestehender Admins: sonst ließe sich ausprobieren, welche Adresse zu wem
  // gehört. Wer schon Admin ist, verbraucht beim Annehmen nichts (already).
  const now = Date.now();
  const used =
    (await count(env, 'SELECT COUNT(*) AS n FROM boat_admins WHERE boat_id = ?', id)) +
    (await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE boat_id = ? AND expires_at > ? AND uses < max_uses', id, now));
  if (used >= INVITE_LIMITS.adminsPerBoat) throw new HttpError(409, 'quota', `Ein Boot hat höchstens ${INVITE_LIMITS.adminsPerBoat} Admins (offene Einladungen zählen mit).`);
  const boat = await env.DB.prepare('SELECT name FROM boats WHERE id = ?').bind(id).first<{ name: string }>();
  const { invite, link } = await createInvite(request, env, user, {
    kind: 'boat_admin', boatId: id, email, maxUses: 1, days: INVITE_LIMITS.adminDays, targetName: boat?.name ?? '',
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
 * öffentlichen Törns, namentlich nur mit öffentlichem Profil, sonst als Anzahl (Konzept 10.6). Der Eigentümer sieht alle,
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
  const named = shown.filter((r) => r.visibility === 'public' && r.handle);
  return json({
    members: named.map((r) => ({ id: null, handle: r.handle, displayName: r.display_name ?? '' })),
    others: shown.length - named.length,
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
  const email = readEmail((await readJson<{ email?: unknown }>(request)).email, false);
  const now = Date.now();
  const crew = await count(env, 'SELECT COUNT(*) AS n FROM share_crew WHERE share_id = ?', row.id);
  if (crew >= INVITE_LIMITS.crewPerShare) throw new HttpError(409, 'quota', `Ein Törn hat höchstens ${INVITE_LIMITS.crewPerShare} Crew-Mitglieder.`);
  if ((await count(env, 'SELECT COUNT(*) AS n FROM invites WHERE share_id = ? AND expires_at > ? AND uses < max_uses', row.id, now)) >= INVITE_LIMITS.pendingPerShare) {
    throw new HttpError(409, 'quota', `Höchstens ${INVITE_LIMITS.pendingPerShare} offene Einladungen je Törn – zieh alte zurück.`);
  }
  // Kein Abgleich mit den Adressen der Crew (wie bei Admins): Adressen anderer bleiben unprüfbar.
  if (email === user.email) throw new HttpError(409, 'own_object', 'Das ist dein eigener Törn.');
  const { invite, link } = await createInvite(request, env, user, {
    kind: 'crew', shareId: row.id, email, maxUses: email ? 1 : INVITE_LIMITS.crewPerShare - crew, days: INVITE_LIMITS.crewDays, targetName: row.title,
  });
  return json({ invite, link: email ? undefined : link, devLink: email ? devLink(request, env, link) : undefined }, { status: 201 });
}

/** DELETE /api/shares/:id/crew/:userId – Eigentümer entfernt jeden, ein Crew-Mitglied nur sich selbst (`me`). */
export async function removeCrew(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = await getShareRow(env, id);
  if (!row) throw SHARE_NOT_FOUND();
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
 * POST /api/groups/:id/invites – Eigner und Admins. `{ email }`: Einladung per Mail (gebunden, einmalig);
 * ohne Adresse: Einladungslink (bis 100 Nutzungen). Der Link steht nur in dieser Antwort.
 */
export async function inviteGroup(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const g = await loadGroup(env, id);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  if (!g || !role || (g.hidden_at && !canManageGroup(role))) throw new HttpError(404, 'not_found', 'Diese Gruppe gibt es nicht oder sie ist geschlossen.');
  if (!canManageGroup(role)) throw new HttpError(403, 'forbidden', 'Einladen dürfen Eigner und Admins der Gruppe.');
  const email = readEmail((await readJson<{ email?: unknown }>(request)).email, false);
  if (email === user.email) throw new HttpError(409, 'own_object', 'Du bist schon Mitglied dieser Gruppe.');
  const members = await count(env, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', g.id);
  if (members >= GROUP_LIMITS.members) throw GROUP_FULL();
  const { invite, link } = await createInvite(request, env, user, {
    kind: 'group', groupId: g.id, groupKind: g.kind, email, maxUses: email ? 1 : Math.min(GROUP_LIMITS.linkUses, GROUP_LIMITS.members - members),
    days: GROUP_LIMITS.inviteDays, targetName: g.name,
  });
  return json({ invite, link: email ? undefined : link, devLink: email ? devLink(request, env, link) : undefined }, { status: 201 });
}

// ---------------------------------------------------------------- Einlösen, Zurückziehen

interface LoadedInvite extends InviteRow {
  group_name: string | null;
  group_owner: string | null;
  group_slug: string | null;
  group_kind: string | null;
  boat_name: string | null;
  boat_owner: string | null;
  share_title: string | null;
  share_owner: string | null;
  share_visibility: string | null;
}

/** Gültige Einladung zum Token – ungültige Form, unbekannt, abgelaufen oder aufgebraucht: 400 und Fehlversuch (pro IP). */
async function loadInvite(request: Request, env: Env, token: unknown): Promise<LoadedInvite> {
  const row =
    typeof token === 'string' && TOKEN_RE.test(token)
      ? await env.DB.prepare(
          `SELECT i.*, b.name AS boat_name, b.owner_id AS boat_owner, s.title AS share_title, s.user_id AS share_owner, s.visibility AS share_visibility,
             g.name AS group_name, g.owner_id AS group_owner, g.slug AS group_slug, g.kind AS group_kind
           FROM invites i LEFT JOIN boats b ON b.id = i.boat_id LEFT JOIN shares s ON s.id = i.share_id LEFT JOIN groups g ON g.id = i.group_id
           WHERE i.token_hash = ? AND i.expires_at > ? AND i.uses < i.max_uses`,
        )
          .bind(await sha256Hex(token), Date.now())
          .first<LoadedInvite>()
      : null;
  if (!row || !parseInviteKind(row.kind) || !(row.boat_owner || row.share_owner || row.group_owner)) {
    await rateLimit(env.LINK_LIMITER, `invite:${clientIp(request)}`);
    throw INVALID();
  }
  return row;
}

async function isMember(env: Env, inv: LoadedInvite, userId: string): Promise<boolean> {
  if (inv.kind === 'group') return !!(await count(env, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND user_id = ?', inv.group_id, userId));
  return inv.kind === 'boat_admin'
    ? !!(await count(env, 'SELECT COUNT(*) AS n FROM boat_admins WHERE boat_id = ? AND user_id = ?', inv.boat_id, userId))
    : !!(await count(env, 'SELECT COUNT(*) AS n FROM share_crew WHERE share_id = ? AND user_id = ?', inv.share_id, userId));
}

/**
 * POST /api/invites/peek – wozu die Einladung ist, ohne sie einzulösen. Nennt Boot/Törn und den Einladenden
 * (Anzeigename bzw. Spaßname). Die gebundene Adresse erscheint nicht, nur ob es eine gibt und ob sie passt.
 */
export async function peekInvite(request: Request, env: Env): Promise<Response> {
  const inv = await loadInvite(request, env, (await readJson<{ token?: unknown }>(request)).token);
  const user = await currentUser(request, env);
  const owner = inv.boat_owner ?? inv.share_owner ?? inv.group_owner;
  return json({
    kind: inv.kind,
    target: inv.kind === 'boat_admin' ? inv.boat_name : inv.kind === 'group' ? inv.group_name : inv.share_title,
    /** nur bei Gruppen: Verein oder Team */
    groupKind: inv.kind === 'group' ? inv.group_kind : undefined,
    inviter: await displayName(env, inv.inviter_id),
    /** an eine Adresse gebunden (welche, verrät die Antwort nicht) */
    bound: !!inv.email,
    expiresAt: inv.expires_at,
    /** null: nicht angemeldet bzw. nicht an eine Adresse gebunden */
    emailMatches: user && inv.email ? user.email === inv.email : null,
    isOwner: !!user && user.id === owner,
    alreadyMember: !!user && (await isMember(env, inv, user.id)),
  });
}

/** POST /api/invites/accept – angemeldet, ausdrücklich bestätigt. Prüfungen in Konzept 10.2. */
export async function acceptInvite(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const inv = await loadInvite(request, env, (await readJson<{ token?: unknown }>(request)).token);
  if (inv.email && inv.email !== user.email) {
    throw new HttpError(403, 'invite_wrong_account', 'Diese Einladung gilt für eine andere E-Mail-Adresse. Bitte mit der eingeladenen Adresse anmelden.');
  }
  if (inv.kind === 'group') return acceptGroupInvite(env, inv, user);
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
  if (await isMember(env, inv, user.id)) return json({ ...result, already: true });
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
  const now = Date.now();
  // Atomar zählen – bei gleichzeitigem Einlösen gewinnt nur, wer noch eine Nutzung bekommt.
  const claimed = await env.DB.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND expires_at > ? RETURNING id')
    .bind(inv.id, now)
    .first();
  if (!claimed) throw INVALID();
  await env.DB.prepare(boat ? 'INSERT OR IGNORE INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)' : 'INSERT OR IGNORE INTO share_crew (share_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(targetId, user.id, now)
    .run();
  return json({ ...result, already: false });
}

/** Gruppeneinladung einlösen: Mitglied werden (höchstens 500), offene Anfrage erledigen, Beitritt protokollieren. */
async function acceptGroupInvite(env: Env, inv: LoadedInvite, user: User): Promise<Response> {
  const result = { kind: inv.kind, path: `/g/${inv.group_slug}`, target: inv.group_name, groupKind: inv.group_kind };
  if (user.id === inv.group_owner) throw new HttpError(409, 'own_object', 'Das ist deine eigene Gruppe.');
  if (await isMember(env, inv, user.id)) return json({ ...result, already: true });
  if ((await count(env, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', inv.group_id)) >= GROUP_LIMITS.members) throw GROUP_FULL();
  const claimed = await env.DB.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND expires_at > ? RETURNING id')
    .bind(inv.id, Date.now())
    .first();
  if (!claimed) throw INVALID();
  await addMember(env, inv.group_id!, user.id);
  return json({ ...result, already: false });
}

/** DELETE /api/invites/:id – nur der Eigentümer des Ziels (Eigner des Boots bzw. des Törns, bei Gruppen Eigner und Admins) zieht zurück. */
export async function revokeInvite(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare(
    `SELECT i.id, i.group_id, COALESCE(b.owner_id, s.user_id) AS owner FROM invites i
     LEFT JOIN boats b ON b.id = i.boat_id LEFT JOIN shares s ON s.id = i.share_id WHERE i.id = ?`,
  )
    .bind(id)
    .first<{ id: string; group_id: string | null; owner: string | null }>();
  const allowed = !!row && (row.group_id ? canManageGroup(await roleIn(env, user.id, row.group_id)) : row.owner === user.id);
  if (!row || !allowed) throw new HttpError(404, 'not_found', 'Diese Einladung gibt es nicht (mehr).');
  await env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(id).run();
  return new Response(null, { status: 204 });
}
