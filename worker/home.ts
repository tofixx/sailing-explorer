// „Mein Verein“ und Heimathafen einer Person (Konzept 12.1, 12.2, F-170, F-174). Am Konto gespeichert (users),
// nicht am Profil; gelesen zählt der Verein nur bei bestehender Mitgliedschaft, der Hafen nur, wenn nicht ausgeblendet.
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json, readJson } from './http';
import { loadHarbor, harborVisible, INVALID_HARBOR } from './harbors';
import { SHARE_ID_RE } from './validate';

export interface HomeRow {
  club_id: string | null;
  club_slug: string | null;
  club_name: string | null;
  club_public: number | null;
  harbor_id: string | null;
  harbor_slug: string | null;
  harbor_name: string | null;
  /** ausdrücklich gewählt (sonst: häufigster Hafen der eigenen Boote) */
  harbor_explicit: number | null;
  /** Hafen stammt von einem öffentlichen eigenen Boot (für das Profil) */
  harbor_public_boat: number | null;
}

/** Hafen der eigenen Boote (Eigner oder Admin), der häufigste zuerst. */
const BOAT_HARBOR = `(SELECT b.harbor_id FROM boats b WHERE b.harbor_id IS NOT NULL
    AND (b.owner_id = u.id OR b.id IN (SELECT boat_id FROM boat_admins WHERE user_id = u.id))
  GROUP BY b.harbor_id ORDER BY COUNT(*) DESC, b.harbor_id LIMIT 1)`;

/** Verein (nur bei Mitgliedschaft) und Heimathafen (ausdrücklich oder aus den Booten) – eine Abfrage. */
export const HOME_SQL = `SELECT c.id AS club_id, c.slug AS club_slug, c.name AS club_name,
    (c.visibility = 'public' AND c.hidden_at IS NULL) AS club_public,
    h.id AS harbor_id, h.slug AS harbor_slug, h.name AS harbor_name, (u.home_harbor_id IS NOT NULL) AS harbor_explicit,
    EXISTS (SELECT 1 FROM boats pb WHERE pb.owner_id = u.id AND pb.harbor_id = h.id AND pb.visibility = 'public' AND pb.hidden_at IS NULL) AS harbor_public_boat
  FROM users u
  LEFT JOIN groups c ON c.id = u.home_club_id AND c.kind = 'club'
    AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = c.id AND m.user_id = u.id)
  LEFT JOIN harbors h ON h.hidden_at IS NULL AND h.id = COALESCE(u.home_harbor_id, ${BOAT_HARBOR})
  WHERE u.id = ?1`;

export const homeStmt = (env: Env, userId: string) => env.DB.prepare(HOME_SQL).bind(userId);

export async function homeOf(env: Env, userId: string): Promise<HomeRow | null> {
  return homeStmt(env, userId).first<HomeRow>();
}

/** Für die eigene Ansicht (Konto, Startseite). */
export function homeShape(h: HomeRow | null) {
  return {
    club: h?.club_id ? { id: h.club_id, slug: h.club_slug ?? '', name: h.club_name ?? '' } : null,
    harbor: h?.harbor_id ? { id: h.harbor_id, slug: h.harbor_slug ?? '', name: h.harbor_name ?? '' } : null,
    harborExplicit: !!h?.harbor_explicit,
  };
}

/**
 * Für das öffentliche Profil: Verein nur öffentlich und nicht ausgeblendet, Hafen nur ausdrücklich gewählt oder von
 * einem öffentlichen eigenen Boot – sonst verriete das Profil eine geschlossene Gruppe oder ein privates Boot.
 */
export function publicHome(h: HomeRow | null) {
  return {
    club: h?.club_id && h.club_public ? { slug: h.club_slug ?? '', name: h.club_name ?? '' } : null,
    harbor: h?.harbor_id && (h.harbor_explicit || h.harbor_public_boat) ? { slug: h.harbor_slug ?? '', name: h.harbor_name ?? '' } : null,
  };
}

/** GET /api/me/home – Verein, Heimathafen und die wählbaren Vereine. */
export async function getMyHome(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { results: clubs } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.name FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ? AND g.kind = 'club' ORDER BY g.name`,
  )
    .bind(user.id)
    .all<{ id: string; slug: string; name: string }>();
  return json({ ...homeShape(await homeOf(env, user.id)), clubs });
}

/** PUT /api/me/home – `{ clubId?, harborId? }`; null leert, fehlend lässt unverändert. */
export async function putMyHome(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await readJson<{ clubId?: unknown; harborId?: unknown }>(request);
  const stmts: D1PreparedStatement[] = [];
  if (input.clubId !== undefined) {
    let clubId: string | null = null;
    if (input.clubId !== null && input.clubId !== '') {
      const ok =
        typeof input.clubId === 'string' && SHARE_ID_RE.test(input.clubId)
          ? await env.DB.prepare(`SELECT g.id FROM groups g JOIN group_members m ON m.group_id = g.id AND m.user_id = ? WHERE g.id = ? AND g.kind = 'club'`)
              .bind(user.id, input.clubId)
              .first<{ id: string }>()
          : null;
      if (!ok) throw new HttpError(400, 'invalid_club', 'Als „Mein Verein“ geht nur ein Verein, in dem du Mitglied bist.');
      clubId = ok.id;
    }
    stmts.push(env.DB.prepare('UPDATE users SET home_club_id = ? WHERE id = ?').bind(clubId, user.id));
  }
  if (input.harborId !== undefined) {
    let harborId: string | null = null;
    if (input.harborId !== null && input.harborId !== '') {
      const h = await loadHarbor(env, input.harborId);
      if (!harborVisible(h)) throw INVALID_HARBOR();
      harborId = h.id;
    }
    stmts.push(env.DB.prepare('UPDATE users SET home_harbor_id = ? WHERE id = ?').bind(harborId, user.id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json(homeShape(await homeOf(env, user.id)));
}

/** Austritt oder Entfernen aus einer Gruppe: die Wahl „Mein Verein“ fällt mit (F-170). */
export const clearHomeClub = (env: Env, userId: string, groupId: string) =>
  env.DB.prepare('UPDATE users SET home_club_id = NULL WHERE id = ? AND home_club_id = ?').bind(userId, groupId);
