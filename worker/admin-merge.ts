// Zusammenführen im Admin-Bereich (Konzept 18.7, 18.8): Hafen-Dubletten und zwei Konten derselben Person.
// Alles Umhängen läuft in einem D1-Batch (eine Transaktion); gelöscht wird über die üblichen Wege.
import type { Env } from './env';
import { purgeUser } from './auth';
import { HttpError, json, readJson } from './http';
import { LOCKED, adminLogStmt, isAdmin, requireAdmin } from './moderation';
import { loadLock } from './locks';
import { harborRef, loadHarbor } from './harbors';
import { SHARE_ID_RE } from './validate';
import { funnyName } from '../src/domain/names';

// ---------------------------------------------------------------- Häfen

/** POST /api/admin/harbors/:id/merge { into } – Dublette :id in `into` überführen, alte Adresse leitet weiter (F-239). */
export async function mergeHarbor(request: Request, env: Env, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { into } = await readJson<{ into?: unknown }>(request);
  const [src, dst] = [await loadHarbor(env, id), await loadHarbor(env, into)];
  if (!src || !dst) throw new HttpError(404, 'not_found', 'Diesen Hafen gibt es nicht (mehr).');
  if (src.id === dst.id) throw new HttpError(400, 'same_harbor', 'Ein Hafen lässt sich nicht mit sich selbst zusammenführen.');
  if ((await loadLock(env, 'harbor', src.id)) || (await loadLock(env, 'harbor', dst.id))) throw LOCKED();
  const now = Date.now();
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM boats WHERE harbor_id = ?1) AS boats, (SELECT COUNT(*) FROM groups WHERE harbor_id = ?1) AS groups,
       (SELECT COUNT(*) FROM follows WHERE target_kind = 'harbor' AND target_id = ?1) AS follows`,
  )
    .bind(src.id)
    .first<{ boats: number; groups: number; follows: number }>();
  await env.DB.batch([
    env.DB.prepare('UPDATE boats SET harbor_id = ?1, home_port = ?2 WHERE harbor_id = ?3').bind(dst.id, dst.name, src.id),
    env.DB.prepare('UPDATE groups SET harbor_id = ?1, home_port = ?2 WHERE harbor_id = ?3').bind(dst.id, dst.name, src.id),
    env.DB.prepare('UPDATE users SET home_harbor_id = ? WHERE home_harbor_id = ?').bind(dst.id, src.id),
    // Fahrtenbuch: Start- und Zielhafen der Törns (Konzept 19)
    env.DB.prepare('UPDATE shares SET from_harbor_id = ?1 WHERE from_harbor_id = ?2').bind(dst.id, src.id),
    env.DB.prepare('UPDATE shares SET to_harbor_id = ?1 WHERE to_harbor_id = ?2').bind(dst.id, src.id),
    // Folgen: wer beiden folgt, folgt danach einmal
    env.DB.prepare(
      `INSERT OR IGNORE INTO follows (user_id, target_kind, target_id, created_at)
       SELECT user_id, 'harbor', ?1, created_at FROM follows WHERE target_kind = 'harbor' AND target_id = ?2`,
    ).bind(dst.id, src.id),
    env.DB.prepare(`DELETE FROM follows WHERE target_kind = 'harbor' AND target_id = ?`).bind(src.id),
    // Neuigkeiten: Ziele und „Neues Boot im Hafen“ (gab es dasselbe Boot schon im Ziel, bleibt nur dieses)
    env.DB.prepare(
      `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
       SELECT activity_id, 'harbor', ?1, created_at FROM activity_target WHERE target_kind = 'harbor' AND target_id = ?2`,
    ).bind(dst.id, src.id),
    env.DB.prepare(`DELETE FROM activity_target WHERE target_kind = 'harbor' AND target_id = ?`).bind(src.id),
    env.DB.prepare(
      `UPDATE OR IGNORE activity SET data = json_set(data, '$.harbor', ?1), bucket = 'harbor:' || ?1 || ':' || subject_id
       WHERE kind = 'harbor' AND json_extract(data, '$.harbor') = ?2`,
    ).bind(dst.id, src.id),
    env.DB.prepare(`DELETE FROM activity WHERE kind = 'harbor' AND json_extract(data, '$.harbor') = ?`).bind(src.id),
    env.DB.prepare('UPDATE harbors SET club_id = COALESCE(club_id, ?1), updated_at = ?2 WHERE id = ?3').bind(src.club_id, now, dst.id),
    // alte Adressen leiten aufs Ziel weiter (auch die, die auf die Dublette zeigten)
    env.DB.prepare('UPDATE harbor_redirects SET harbor_id = ? WHERE harbor_id = ?').bind(dst.id, src.id),
    env.DB.prepare('INSERT OR REPLACE INTO harbor_redirects (old_slug, harbor_id, created_at) VALUES (?, ?, ?)').bind(src.slug, dst.id, now),
    env.DB.prepare(`DELETE FROM reports WHERE target_kind = 'harbor' AND target_id = ?`).bind(src.id),
    env.DB.prepare('DELETE FROM harbors WHERE id = ?').bind(src.id),
    adminLogStmt(env, admin.id, 'merge_harbor', 'harbor', dst.id, `${src.name} (/h/${src.slug}, ${src.id}) → ${dst.name}: ${counts?.boats ?? 0} Boote, ${counts?.groups ?? 0} Gruppen, ${counts?.follows ?? 0} Folgende`, now),
  ]);
  return json({ harbor: harborRef(dst), moved: counts });
}

// ---------------------------------------------------------------- Konten

interface Account {
  id: string;
  locked_at: number | null;
  suspended_at: number | null;
  display_name: string | null;
  handle: string | null;
}

async function loadAccount(env: Env, id: unknown): Promise<Account | null> {
  if (typeof id !== 'string' || !SHARE_ID_RE.test(id)) return null;
  return env.DB.prepare('SELECT u.id, u.locked_at, u.suspended_at, p.display_name, p.handle FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?')
    .bind(id)
    .first<Account>();
}

/** Beide Konten laden und prüfen (gleich, Admin, gesperrt). */
async function mergePair(env: Env, fromId: string, intoId: unknown) {
  const [from, into] = [await loadAccount(env, fromId), await loadAccount(env, intoId)];
  if (!from || !into) throw new HttpError(404, 'not_found', 'Dieses Konto gibt es nicht (mehr).');
  if (from.id === into.id) throw new HttpError(400, 'same_user', 'Ein Konto lässt sich nicht mit sich selbst verbinden.');
  if (isAdmin(env, from.id)) throw new HttpError(400, 'cannot_merge_admin', 'Ein Admin-Konto lässt sich nicht auflösen.');
  if (from.locked_at || into.locked_at) throw LOCKED();
  return { from, into };
}

/** Rang einer Rolle am Törn (SQL), höher = mehr Verantwortung – zum Zusammenführen doppelter Crew-Zeilen. */
const rank = (col: string) => `CASE ${col} WHEN 'skipper' THEN 4 WHEN 'co' THEN 3 WHEN 'crew' THEN 2 ELSE 1 END`;

const label = (a: Account) => `${a.display_name || funnyName(a.id)}${a.handle ? ` (/u/${a.handle})` : ''}`;

/** Zahlen und Konflikte für die Vorschau (und den Protokolleintrag). */
async function mergeCounts(env: Env, from: string, into: string) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM shares WHERE user_id = ?1) AS shares, (SELECT COUNT(*) FROM photos WHERE user_id = ?1) AS photos,
       (SELECT COUNT(*) FROM comments WHERE user_id = ?1) AS comments, (SELECT COUNT(*) FROM posts WHERE author_id = ?1) AS posts,
       (SELECT COUNT(*) FROM boats WHERE owner_id = ?1) AS boats, (SELECT COUNT(*) FROM boat_admins WHERE user_id = ?1) AS boatAdmin,
       (SELECT COUNT(*) FROM group_members WHERE user_id = ?1) AS groups,
       (SELECT COUNT(*) FROM group_members a JOIN group_members b ON b.group_id = a.group_id AND b.user_id = ?2 WHERE a.user_id = ?1) AS bothGroups,
       (SELECT COUNT(*) FROM share_crew WHERE user_id = ?1) AS crew, (SELECT COUNT(*) FROM follows WHERE user_id = ?1) AS follows,
       (SELECT COUNT(*) FROM reactions WHERE user_id = ?1) AS reactions,
       (SELECT COUNT(*) FROM reactions a JOIN reactions b ON b.subject_kind = a.subject_kind AND b.subject_id = a.subject_id AND b.user_id = ?2 WHERE a.user_id = ?1) AS bothReactions,
       (SELECT COUNT(*) FROM passkeys WHERE user_id = ?1) AS passkeys, (SELECT COUNT(*) FROM supports WHERE user_id = ?1) AS supports,
       EXISTS (SELECT 1 FROM profiles WHERE user_id = ?1) AS fromProfile, EXISTS (SELECT 1 FROM profiles WHERE user_id = ?2) AS intoProfile`,
  )
    .bind(from, into)
    .first<Record<string, number>>();
  return row ?? {};
}

/** GET /api/admin/users/:id/merge?into= – Vorschau: was wandert, welche Konflikte (F-240). */
export async function mergeUserPreview(request: Request, env: Env, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const { from, into } = await mergePair(env, id, new URL(request.url).searchParams.get('into'));
  const counts = await mergeCounts(env, from.id, into.id);
  await adminLogStmt(env, admin.id, 'view', 'user', from.id, `Vorschau: verbinden mit ${into.id}`).run();
  return json({
    from: { id: from.id, name: label(from), suspended: !!from.suspended_at },
    into: { id: into.id, name: label(into), suspended: !!into.suspended_at },
    counts,
    profile: counts.intoProfile ? 'keep' : counts.fromProfile ? 'take' : 'none',
  });
}

/**
 * POST /api/admin/users/:id/merge { into, confirm } – Konto :id in `into` aufgehen lassen (Konzept 18.8): alles
 * umhängen (ein Batch), Konflikte nach festen Regeln, danach das leere Konto über purgeUser löschen.
 */
export async function mergeUsers(request: Request, env: Env, id: string): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const body = await readJson<{ into?: unknown; confirm?: unknown }>(request);
  const { from, into } = await mergePair(env, id, body.into);
  if (body.confirm !== from.id) throw new HttpError(400, 'confirm_required', 'Zur Bestätigung bitte die ID des aufzulösenden Kontos eingeben.');
  const counts = await mergeCounts(env, from.id, into.id);
  const now = Date.now();
  const db = env.DB;
  const B = from.id;
  const A = into.id;
  await db.batch([
    // Inhalte
    db.prepare('UPDATE shares SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('UPDATE photos SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('UPDATE comments SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('UPDATE posts SET author_id = ?1 WHERE author_id = ?2').bind(A, B),
    db.prepare('UPDATE activity SET actor_id = ?1 WHERE actor_id = ?2').bind(A, B),
    db.prepare(`UPDATE activity SET subject_id = ?1 WHERE subject_kind = 'user' AND subject_id = ?2`).bind(A, B),
    // Bündel-Schlüssel mit der Konto-ID (Beitritt, Meilensteine): ans Ziel; gab es ihn dort schon, bleibt der des Ziels
    db.prepare(`UPDATE OR IGNORE activity SET bucket = replace(bucket, ?2, ?1) WHERE instr(bucket, ?2) > 0`).bind(A, B),
    db.prepare(`DELETE FROM activity WHERE instr(bucket, ?) > 0`).bind(B),
    db.prepare(
      `INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
       SELECT activity_id, 'user', ?1, created_at FROM activity_target WHERE target_kind = 'user' AND target_id = ?2`,
    ).bind(A, B),
    db.prepare(`DELETE FROM activity_target WHERE target_kind = 'user' AND target_id = ?`).bind(B),
    db.prepare('UPDATE covers SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('UPDATE harbors SET created_by = ?1 WHERE created_by = ?2').bind(A, B),
    // Boote und Boots-Admins (das Ziel ist nie Admin seines eigenen Boots)
    db.prepare('UPDATE boats SET owner_id = ?1 WHERE owner_id = ?2').bind(A, B),
    db.prepare(
      `DELETE FROM boat_admins WHERE user_id = ?2 AND (boat_id IN (SELECT id FROM boats WHERE owner_id = ?1) OR boat_id IN (SELECT boat_id FROM boat_admins WHERE user_id = ?1))`,
    ).bind(A, B),
    db.prepare('UPDATE boat_admins SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('DELETE FROM boat_admins WHERE user_id = ?1 AND boat_id IN (SELECT id FROM boats WHERE owner_id = ?1)').bind(A),
    // Gruppen: in beiden Mitglied → höhere Rolle (Eigner > Admin > Mitglied)
    db.prepare('UPDATE groups SET owner_id = ?1 WHERE owner_id = ?2').bind(A, B),
    db.prepare(
      `UPDATE group_members SET role = CASE
         WHEN role = 'owner' OR (SELECT b.role FROM group_members b WHERE b.group_id = group_members.group_id AND b.user_id = ?2) = 'owner' THEN 'owner'
         WHEN role = 'admin' OR (SELECT b.role FROM group_members b WHERE b.group_id = group_members.group_id AND b.user_id = ?2) = 'admin' THEN 'admin'
         ELSE role END
       WHERE user_id = ?1 AND group_id IN (SELECT group_id FROM group_members WHERE user_id = ?2)`,
    ).bind(A, B),
    db.prepare('DELETE FROM group_members WHERE user_id = ?2 AND group_id IN (SELECT group_id FROM group_members WHERE user_id = ?1)').bind(A, B),
    db.prepare('UPDATE group_members SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare(
      `DELETE FROM group_requests WHERE user_id = ?2 AND (group_id IN (SELECT group_id FROM group_members WHERE user_id = ?1) OR group_id IN (SELECT group_id FROM group_requests WHERE user_id = ?1))`,
    ).bind(A, B),
    db.prepare('UPDATE group_requests SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('UPDATE group_boats SET added_by = ?1 WHERE added_by = ?2').bind(A, B),
    // Crew: nicht auf eigenen Törns, nicht doppelt
    // Crew-Rollen (Konzept 15): beide am selben Törn – die höhere Rolle gilt. Skipper zuerst vormerken, weil es je Törn
    // nur einen gibt (share_crew_one_skipper); nach dem Löschen der Quellzeile wird die Vormerkung zur Rolle.
    db.prepare(
      `UPDATE share_crew SET role = CASE (SELECT b.role FROM share_crew b WHERE b.share_id = share_crew.share_id AND b.user_id = ?2)
         WHEN 'skipper' THEN '_skipper' ELSE (SELECT b.role FROM share_crew b WHERE b.share_id = share_crew.share_id AND b.user_id = ?2) END
       WHERE user_id = ?1 AND share_id IN (SELECT share_id FROM share_crew WHERE user_id = ?2)
         AND ${rank('(SELECT b.role FROM share_crew b WHERE b.share_id = share_crew.share_id AND b.user_id = ?2)')} > ${rank('role')}`,
    ).bind(A, B),
    db.prepare('DELETE FROM share_crew WHERE user_id = ?2 AND share_id IN (SELECT share_id FROM share_crew WHERE user_id = ?1)').bind(A, B),
    db.prepare(`UPDATE share_crew SET role = 'skipper' WHERE user_id = ?1 AND role = '_skipper'`).bind(A),
    // Bestätigungen des Skippers behalten ihren Namen
    db.prepare('UPDATE share_crew SET confirmed_by = ?1 WHERE confirmed_by = ?2').bind(A, B),
    db.prepare('UPDATE shares SET role_confirmed_by = ?1 WHERE role_confirmed_by = ?2').bind(A, B),
    db.prepare('UPDATE share_crew SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('DELETE FROM share_crew WHERE user_id = ?1 AND share_id IN (SELECT id FROM shares WHERE user_id = ?1)').bind(A),
    // Folgen in beide Richtungen, ohne Doppel und ohne Folgen auf sich selbst
    db.prepare(`INSERT OR IGNORE INTO follows (user_id, target_kind, target_id, created_at) SELECT ?1, target_kind, target_id, created_at FROM follows WHERE user_id = ?2`).bind(A, B),
    db.prepare(`INSERT OR IGNORE INTO follows (user_id, target_kind, target_id, created_at) SELECT user_id, 'user', ?1, created_at FROM follows WHERE target_kind = 'user' AND target_id = ?2`).bind(A, B),
    db.prepare(`DELETE FROM follows WHERE user_id = ?1 OR (target_kind = 'user' AND target_id = ?1)`).bind(B),
    db.prepare(`DELETE FROM follows WHERE user_id = ?1 AND target_kind = 'user' AND target_id = ?1`).bind(A),
    // Reaktionen: die des Ziels gewinnen
    db.prepare(`INSERT OR IGNORE INTO reactions (subject_kind, subject_id, user_id, kind, created_at) SELECT subject_kind, subject_id, ?1, kind, created_at FROM reactions WHERE user_id = ?2`).bind(A, B),
    db.prepare('DELETE FROM reactions WHERE user_id = ?').bind(B),
    // Benachrichtigungen (Konzept 17): die der Quelle sind kurzlebig und fallen weg; als Auslöser und Push-Gerät zählt das Ziel
    db.prepare('UPDATE notifications SET actor_id = ?1 WHERE actor_id = ?2').bind(A, B),
    db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(B),
    db.prepare('UPDATE push_subscriptions SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    // Anmeldung, Zahlungen, Einladungen, eigene Meldungen
    db.prepare('UPDATE passkeys SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').bind(B),
    db.prepare('UPDATE supports SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
    db.prepare('UPDATE invites SET inviter_id = ?1 WHERE inviter_id = ?2').bind(A, B),
    db.prepare('UPDATE invites SET invitee_id = ?1 WHERE invitee_id = ?2').bind(A, B),
    db.prepare(
      `DELETE FROM reports WHERE reporter_id = ?2 AND EXISTS (SELECT 1 FROM reports r WHERE r.reporter_id = ?1 AND r.target_kind = reports.target_kind AND r.target_id = reports.target_id)`,
    ).bind(A, B),
    db.prepare('UPDATE reports SET reporter_id = ?1 WHERE reporter_id = ?2').bind(A, B),
    // Profil: das des Ziels bleibt; ohne eigenes übernimmt es das der Quelle (samt Meldungen dazu)
    ...(counts.intoProfile
      ? []
      : [
          db.prepare('UPDATE profiles SET user_id = ?1 WHERE user_id = ?2').bind(A, B),
          db.prepare(`UPDATE reports SET target_id = ?1 WHERE target_kind = 'profile' AND target_id = ?2`).bind(A, B),
        ]),
    // Heimat und Suspendierung (fail closed)
    db.prepare(
      `UPDATE users SET home_club_id = COALESCE(home_club_id, (SELECT home_club_id FROM users WHERE id = ?2)),
         home_harbor_id = COALESCE(home_harbor_id, (SELECT home_harbor_id FROM users WHERE id = ?2)),
         suspended_at = COALESCE(suspended_at, (SELECT suspended_at FROM users WHERE id = ?2))
       WHERE id = ?1`,
    ).bind(A, B),
    adminLogStmt(
      env, admin.id, 'merge_user', 'user', A,
      `${label(from)} (${B}) aufgelöst in ${label(into)}: ${counts.shares} Törns, ${counts.boats} Boote, ${counts.groups} Gruppen, ${counts.passkeys} Passkeys`,
      now,
    ),
  ]);
  // Das leere Quellkonto über den einen Löschpfad (Sitzungen, Profil samt Titelbild, Reste)
  const email = (await db.prepare('SELECT email FROM users WHERE id = ?').bind(B).first<{ email: string }>())?.email ?? '';
  await purgeUser(env, { id: B, email });
  return json({ ok: true, counts });
}
