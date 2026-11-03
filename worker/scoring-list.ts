// Vereinsliste der Wertung (Konzept 32, F-503, F-504): Punktesummen je teilnehmendem Mitglied für eine Saison – nur im
// Verein, nur mit Opt-in, nur dort gezeigte Einträge, gewichtet je Vorlage. Gerechnet beim Abruf mit derselben Regel wie
// das eigene Fahrtenbuch (`pointsByTemplate`, `clubPoints`); gespeichert wird nichts, gecacht wird nicht (K6: keine
// öffentliche und keine vereinsübergreifende Rangliste).
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json } from './http';
import { LOGBOOK_JOINS, OWN_COLS, logbookShape, type LogbookRow } from './logbook-list';
import { clubListSql } from './scoring-sql';
import { clubTemplates, memberClub } from './scoring';
import { notSuspendedSql, publicSql } from './visible-sql';
import { canManageGroup } from '../src/domain/groups';
import { seasonRange } from '../src/domain/logbook';
import { clubListSeason, clubPoints, pointsByTemplate } from '../src/domain/scoring';

/** Höchstens so viele Törns rechnet eine Vereinsliste (alle Teilnehmenden einer Saison zusammen). */
export const CLUB_LIST_MAX_ENTRIES = 5000;

interface Participant {
  user_id: string;
  name: string | null;
  handle: string | null;
}

/**
 * GET /api/groups/:id/scoring?saison=2026 – Vereinsliste. Sehen dürfen sie Eigner und Admins des Vereins und Mitglieder,
 * die selbst teilnehmen (sonst 403 `opt_in_required`); andere 404. Je teilnehmender Person: Name (Profilname; mit
 * öffentlichem Profil verlinkt), Punkte, Einträge und Punkte je Vorlage – keine Einzelangaben der Törns.
 */
export async function getClubList(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const club = await memberClub(env, user.id, id);
  const me = await env.DB.prepare('SELECT scoring_opt_in_at FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(club.id, user.id)
    .first<{ scoring_opt_in_at: number | null }>();
  if (!canManageGroup(club.role) && !me?.scoring_opt_in_at) {
    throw new HttpError(403, 'opt_in_required', 'Die Vereinsliste sehen Admins und wer selbst teilnimmt.');
  }
  const raw = new URL(request.url).searchParams.get('saison');
  const season = raw && /^\d{4}$/.test(raw) ? Number(raw) : clubListSeason(Date.now());
  const [from, to] = seasonRange(season);
  const templates = await clubTemplates(env, club.id);
  const [people, rows] = await env.DB.batch<Participant & LogbookRow & { uid: string }>([
    env.DB.prepare(
      `SELECT m.user_id, p.display_name AS name, CASE WHEN ${publicSql('p')} THEN p.handle END AS handle
       FROM group_members m LEFT JOIN profiles p ON p.user_id = m.user_id AND p.hidden_at IS NULL
       WHERE m.group_id = ?1 AND m.scoring_opt_in_at IS NOT NULL AND ${notSuspendedSql('m.user_id')}`,
    ).bind(club.id),
    env.DB.prepare(
      `SELECT ${OWN_COLS}, s.user_id AS uid FROM shares s ${LOGBOOK_JOINS}
       WHERE ${clubListSql('?1')} AND COALESCE(s.started_at, s.created_at) >= ?2 AND COALESCE(s.started_at, s.created_at) < ?3
       LIMIT ?4`,
    ).bind(club.id, from, to, CLUB_LIST_MAX_ENTRIES),
  ]);
  const byUser = new Map<string, ReturnType<typeof logbookShape>[]>();
  for (const r of rows.results) byUser.set(r.uid, [...(byUser.get(r.uid) ?? []), logbookShape(r, true)]);
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
      templates: templates.filter((t) => t.listWeight !== null).map((t) => ({ id: t.id, name: t.name, listWeight: t.listWeight })),
      members: list,
      truncated: rows.results.length >= CLUB_LIST_MAX_ENTRIES,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
