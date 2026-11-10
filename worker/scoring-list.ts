// Vereinsliste der Wertung (Konzept 32, F-503, F-504): Punktesummen je teilnehmendem Mitglied für eine Saison – nur im
// Verein, nur mit Opt-in, nur dort gezeigte Einträge, gewichtet je Vorlage. Gerechnet beim Abruf mit derselben Regel wie
// das eigene Fahrtenbuch (`pointsByTemplate`, `clubPoints`); gespeichert wird nichts, gecacht wird nicht (K6: keine
// öffentliche und keine vereinsübergreifende Rangliste).
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json } from './http';
import { CLUB_LIST_FROM, clubListSql } from './scoring-sql';
import { clubTemplates, memberClub } from './scoring';
import { liveSql, notSuspendedSql, publicSql } from './visible-sql';
import { canManageGroup } from '../src/domain/groups';
import { voyageRole } from '../src/domain/crew-roles';
import { isBoatClass } from '../src/domain/boat-class';
import { isLogState, readLog, seasonRange } from '../src/domain/logbook';
import { clubListSeason, clubPoints, pointsByTemplate, type ScoredEntry } from '../src/domain/scoring';

/** Höchstens so viele Törns rechnet eine Vereinsliste (alle Teilnehmenden einer Saison zusammen, neueste zuerst). */
export const CLUB_LIST_MAX_ENTRIES = 5000;

interface Participant {
  user_id: string;
  name: string | null;
  handle: string | null;
}

/** Nur, was die Wertung braucht (`ScoredEntry`). */
interface Row {
  uid: string;
  dist_nm: number | null;
  log: string;
  log_state: string;
  role: string | null;
  t: number;
  ended_at: number | null;
  boat_class: string | null;
}

const entryOf = (r: Row): ScoredEntry => ({
  distNm: r.dist_nm ?? 0,
  role: r.role ? voyageRole(r.role) : null,
  log: readLog(r.log),
  startedAt: r.t,
  endedAt: r.ended_at,
  logState: isLogState(r.log_state) ? r.log_state : 'suggested',
  boatClass: isBoatClass(r.boat_class) ? r.boat_class : null,
});

/**
 * GET /api/groups/:id/scoring?saison=2026 – Vereinsliste (F-503). Die ganze Liste sehen nur Eigner:in und Admins des
 * Vereins; ein teilnehmendes Mitglied sieht nur die eigene Summe (sonst 403 `opt_in_required`); andere 404. Je
 * teilnehmender Person: Name (Profilname; mit öffentlichem Profil verlinkt), Punkte, Einträge und Punkte je Vorlage –
 * keine Einzelangaben der Törns.
 */
export async function getClubList(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const club = await memberClub(env, user.id, id);
  const manager = canManageGroup(club.role);
  if (!manager) {
    const me = await env.DB.prepare('SELECT scoring_opt_in_at FROM group_members WHERE group_id = ? AND user_id = ?')
      .bind(club.id, user.id)
      .first<{ scoring_opt_in_at: number | null }>();
    if (!me?.scoring_opt_in_at) throw new HttpError(403, 'opt_in_required', 'Deine Summe gibt es, sobald du an der Vereinsliste teilnimmst.');
  }
  // Mitglieder: nur die eigene Zeile – gerechnet wird gar nicht erst über andere
  const only = manager ? null : user.id;
  const raw = new URL(request.url).searchParams.get('saison');
  const season = raw && /^\d{4}$/.test(raw) ? Number(raw) : clubListSeason(Date.now());
  const [from, to] = seasonRange(season);
  const templates = await clubTemplates(env, club.id);
  const [people, rows] = await env.DB.batch<Participant & Row>([
    env.DB.prepare(
      `SELECT m.user_id, p.display_name AS name, CASE WHEN ${publicSql('p')} THEN p.handle END AS handle
       FROM group_members m LEFT JOIN profiles p ON p.user_id = m.user_id AND p.hidden_at IS NULL
       WHERE m.group_id = ?1 AND m.scoring_opt_in_at IS NOT NULL AND ${notSuspendedSql('m.user_id')} AND (?2 IS NULL OR m.user_id = ?2)`,
    ).bind(club.id, only),
    env.DB.prepare(
      `SELECT s.user_id AS uid, s.dist_nm, s.log, s.log_state, s.owner_role AS role, COALESCE(s.started_at, s.created_at) AS t, s.ended_at, b.boat_class
       FROM ${CLUB_LIST_FROM} LEFT JOIN boats b ON b.id = s.boat_id AND ${liveSql('b')}
       WHERE ${clubListSql('?1')} AND (?5 IS NULL OR s.user_id = ?5) AND COALESCE(s.started_at, s.created_at) >= ?2 AND COALESCE(s.started_at, s.created_at) < ?3
       ORDER BY t DESC LIMIT ?4`,
    ).bind(club.id, from, to, CLUB_LIST_MAX_ENTRIES, only),
  ]);
  const byUser = new Map<string, ScoredEntry[]>();
  for (const r of rows.results) {
    const list = byUser.get(r.uid);
    if (list) list.push(entryOf(r));
    else byUser.set(r.uid, [entryOf(r)]);
  }
  const list = people.results.map((p) => {
    const by = pointsByTemplate(byUser.get(p.user_id) ?? [], templates);
    return {
      name: p.name ?? 'Mitglied ohne Profil',
      handle: p.handle,
      me: p.user_id === user.id,
      points: clubPoints(by),
      entries: by.reduce((n, b) => n + b.count, 0),
      byTemplate: by.map((b) => ({ template: b.template.name, points: b.points, count: b.count })),
    };
  });
  list.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'de'));
  return json(
    {
      season,
      /** false: nur die eigene Summe (Mitglied) */
      full: manager,
      templates: templates.filter((t) => t.listWeight !== null).map((t) => ({ id: t.id, name: t.name, listWeight: t.listWeight })),
      members: list,
      truncated: rows.results.length >= CLUB_LIST_MAX_ENTRIES,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
