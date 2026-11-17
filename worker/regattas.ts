// Regatten (Konzept 42, F-645 … F-654): eigene Ergebnisse als CSV und die Regatta-Übersicht eines Vereins bzw. einer
// Klassenvereinigung. Eine Regatta ist ein Fahrtenbuch-Eintrag mit `log.regatta` (K1); freigegeben wird sie mit der
// vorhandenen Auswahl „In Gruppe zeigen“ (`share_groups`). Gespeichert wird hier nichts, gecacht wird nicht.
import type { Env } from './env';
import { requireUser } from './auth';
import { HttpError, json, withApiHeaders } from './http';
import { entriesOf } from './logbook-list';
import { loadGroup, roleIn } from './groups';
import { IN_LOGBOOK_SQL } from './logbook-sql';
import { liveSql, notSuspendedSql, publicSql } from './visible-sql';
import { funnyName, memberAlias } from '../src/domain/names';
import { voyageRole } from '../src/domain/crew-roles';
import { isBoatClass } from '../src/domain/boat-class';
import { canManageGroup, hasRegattaOverview } from '../src/domain/groups';
import { readLog, seasonRange } from '../src/domain/logbook';
import { filterEntries, parseLogFilter } from '../src/domain/logbook-year';
import { groupRegattas, regattaCsv, regattaCsvName, type ClubRegattaRow } from '../src/domain/regatta';
import { shownSeason } from '../src/domain/support';
import { sharePath, type Visibility } from '../src/domain/visibility';

/** Höchstens so viele freigegebene Regatta-Einträge liest eine Übersicht je Saison. */
export const GROUP_REGATTAS_MAX = 1000;

const seasonParam = (url: URL): number | 'alle' | null => {
  const raw = url.searchParams.get('saison');
  if (raw?.toLowerCase() === 'alle') return 'alle';
  return raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
};

/**
 * GET /api/me/regattas.csv?saison=2026|alle&stand= – eigene Regatta-Ergebnisse (F-648): eigene Einträge und Crew-Törns,
 * auf denen die Eigentümer:in eine Regatta angegeben hat (M1); Stand wie der Meilennachweis. Ohne `saison` die vorgewählte.
 */
export async function getMyRegattasCsv(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const p = seasonParam(new URL(request.url)) ?? shownSeason(Date.now());
  const { entries, truncated } = await entriesOf(env, user.id);
  const shown = filterEntries(entries, parseLogFilter(new URL(request.url).searchParams.get('stand')), p === 'alle' ? null : p);
  return withApiHeaders(
    new Response(regattaCsv(shown, truncated), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${regattaCsvName(p)}"`,
        'Cache-Control': 'private, no-store',
      },
    }),
  );
}

interface GroupRegattaRow {
  id: string;
  visibility: Visibility;
  t: number;
  log: string;
  role: string | null;
  name: string | null;
  handle: string | null;
  open: number;
  uid: string;
  boat: string | null;
  boat_vis: string | null;
  boat_class: string | null;
}

/**
 * GET /api/groups/:id/regattas?saison= – Regatta-Übersicht (F-650): nur für Mitglieder eines Vereins bzw. einer
 * Klassenvereinigung (sonst 404, Teams 404). Es zählen Einträge, die ihre Eigentümer:in in dieser Gruppe zeigt
 * (`share_groups`, wie die Vereinsliste der Wertung nur öffentliche), mit Regatta-Angaben, weder ausgeblendet noch
 * gesperrt, im Fahrtenbuch, Konto nicht gesperrt und die Person ist noch Mitglied. Gezeigt werden Datum, Regatta,
 * Ergebnis, Rolle, öffentliches Boot und Klasse; Namen nach der Regel der Mitgliederliste (sonst Spaßname der Gruppe).
 */
export async function getGroupRegattas(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const g = await loadGroup(env, id);
  const role = g ? await roleIn(env, user.id, g.id) : null;
  if (!g || !role || g.hidden_at || g.locked_at || !hasRegattaOverview(g.kind)) throw new HttpError(404, 'not_found', 'Diese Übersicht gibt es nicht.');
  const p = seasonParam(new URL(request.url));
  const season = typeof p === 'number' ? p : shownSeason(Date.now());
  const [from, to] = seasonRange(season);
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.visibility, COALESCE(s.started_at, s.created_at) AS t, s.log, s.owner_role AS role, s.user_id AS uid,
       pr.display_name AS name, pr.handle, (${publicSql('pr')} AND pr.hidden_at IS NULL) AS open,
       b.name AS boat, b.visibility AS boat_vis, b.boat_class
     FROM share_groups sg JOIN shares s ON s.id = sg.share_id
       LEFT JOIN profiles pr ON pr.user_id = s.user_id
       LEFT JOIN boats b ON b.id = s.boat_id AND ${liveSql('b')}
     WHERE sg.group_id = ?1 AND ${publicSql('s')} AND ${liveSql('s')} AND ${notSuspendedSql('s.user_id')} AND ${IN_LOGBOOK_SQL}
       AND json_extract(s.log, '$.regatta.name') IS NOT NULL
       AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = ?1 AND gm.user_id = s.user_id)
       AND COALESCE(s.started_at, s.created_at) >= ?2 AND COALESCE(s.started_at, s.created_at) < ?3
     ORDER BY t DESC LIMIT ?4`,
  )
    .bind(g.id, from, to, GROUP_REGATTAS_MAX)
    .all<GroupRegattaRow>();
  // Namen wie die Mitgliederliste (F-440, F-441): Eigner und Admins Anzeigenamen; sonst mit öffentlichem Profil der
  // Name, ohne der Spaßname dieser Gruppe – die Übersicht verrät nichts, was die Mitgliederliste nicht zeigt.
  const manager = canManageGroup(role);
  const rows: ClubRegattaRow[] = [];
  for (const r of results) {
    const regatta = readLog(r.log).regatta;
    if (!regatta) continue;
    rows.push({
      path: sharePath('s', r.id, 'public', null),
      startedAt: r.t,
      regatta,
      // Anzeigename aus dem Profil (die Person hat das Ergebnis hier freigegeben), sonst Spaßname; Link nur öffentlich
      person: {
        name: manager ? r.name || funnyName(r.uid) : r.open && r.handle ? (r.name ?? '') : memberAlias(r.uid, g.id),
        handle: r.open ? r.handle : null,
      },
      role: r.role ? voyageRole(r.role) : null,
      // Boot nur, wenn es öffentlich ist (F-82) – wie Törn-Seite und Fahrtenbuch
      boat: r.boat_vis === 'public' ? r.boat : null,
      boatClass: isBoatClass(regatta.boatClass) ? regatta.boatClass : r.boat_vis === 'public' && isBoatClass(r.boat_class) ? r.boat_class : null,
    });
  }
  return json(
    { season, kind: g.kind, regattas: groupRegattas(rows), truncated: results.length >= GROUP_REGATTAS_MAX },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
