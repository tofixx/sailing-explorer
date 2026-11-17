// Jahresansicht der Fahrten und Regatten im Profil (Konzept 43, F-665 … F-669). Für sich selbst aus dem ganzen
// Fahrtenbuch (auch nicht öffentliche Einträge und Crew-Törns nach M1); für andere nur, wenn die Person sie zeigt
// (`profiles.season_table = 'public'`) und nur aus öffentlichen Einträgen. Nie gecacht, nichts gespeichert außer dem Schalter.
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { HttpError, countKeyFailure, json, readJson } from './http';
import { canView, requestKey } from './access';
import { isAdmin } from './moderation';
import { entriesOf } from './logbook-list';
import { IN_LOGBOOK_SQL } from './logbook-sql';
import { liveSql, notSuspendedSql } from './visible-sql';
import { normalizeHandle } from './validate';
import { voyageRole } from '../src/domain/crew-roles';
import { countsInLogbook, readLog } from '../src/domain/logbook';
import { SEASON_TABLE_MODES, seasonTableMode, type SeasonRow } from '../src/domain/season-table';
import { sharePath, type Visibility } from '../src/domain/visibility';

/** Höchstens so viele Fahrten je Abfrage (eigene und Crew-Törns je für sich). */
export const SEASON_TABLE_MAX = 2000;

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Jahresansicht gibt es nicht oder sie ist nicht freigegeben.');

interface PublicRow {
  id: string;
  title: string;
  t: number;
  dist_nm: number | null;
  dist_source: string;
  role: string | null;
  boat: string | null;
  log: string;
  own: number;
}

/** Öffentliche Einträge einer Person für andere: eigene und als Crew (wie „Mitgesegelt“), Boot nur, wenn öffentlich. */
const PUBLIC_SQL = (own: boolean) => `SELECT s.id, s.title, COALESCE(s.started_at, s.created_at) AS t, s.dist_nm, s.dist_source,
    ${own ? 's.owner_role' : 'c.role'} AS role, ${own ? 1 : 0} AS own,
    CASE WHEN b.visibility = 'public' THEN b.name END AS boat, ${own ? 's.log' : `json_object('regatta', json_extract(s.log, '$.regatta'))`} AS log
  FROM ${own ? 'shares s' : 'share_crew c JOIN shares s ON s.id = c.share_id'}
    LEFT JOIN boats b ON b.id = s.boat_id AND ${liveSql('b')}
  WHERE ${own ? 's.user_id = ?1' : 'c.user_id = ?1 AND s.user_id <> ?1'} AND s.visibility = 'public' AND ${liveSql('s')}
    AND ${notSuspendedSql('s.user_id')} AND ${IN_LOGBOOK_SQL}
  ORDER BY t DESC LIMIT ?2`;

/**
 * GET /api/profiles/:handle/seasons – Jahresansicht (F-665, F-666). Wer das Profil nicht sehen darf, bekommt dieselbe
 * 404 wie beim Profil; andere als die Person selbst 404, solange sie die Ansicht nicht zeigt.
 */
export async function getSeasonTable(request: Request, env: Env, rawHandle: string): Promise<Response> {
  const key = requestKey(request);
  const handle = normalizeHandle(rawHandle);
  const p = handle
    ? await env.DB.prepare('SELECT user_id, visibility, share_key, hidden_at, season_table FROM profiles WHERE handle = ?')
        .bind(handle)
        .first<{ user_id: string; visibility: Visibility; share_key: string | null; hidden_at: number | null; season_table: string }>()
    : null;
  const user = await currentUser(request, env);
  const self = !!p && user?.id === p.user_id;
  if (!p || !canView({ visibility: p.visibility, shareKey: p.share_key, hiddenAt: p.hidden_at }, { manager: self, key, admin: isAdmin(env, user?.id) })) {
    await countKeyFailure(env, request, key);
    throw NOT_FOUND();
  }
  if (!self && seasonTableMode(p.season_table) !== 'public') throw NOT_FOUND();
  let rows: SeasonRow[];
  let truncated = false;
  if (self) {
    // eigene Sicht: das ganze Fahrtenbuch, ohne ausgeschlossene Einträge (wie die Summen dort)
    const r = await entriesOf(env, p.user_id);
    truncated = r.truncated;
    rows = r.entries.filter((e) => countsInLogbook(e.logState)).map((e) => ({
      path: e.path, title: e.title, startedAt: e.startedAt, distNm: e.distNm, recorded: e.distSource === 'track',
      role: e.role, boat: e.boat, own: e.own, regatta: e.log.regatta ?? null,
    }));
  } else {
    const [own, crew] = await env.DB.batch<PublicRow>([
      env.DB.prepare(PUBLIC_SQL(true)).bind(p.user_id, SEASON_TABLE_MAX),
      env.DB.prepare(PUBLIC_SQL(false)).bind(p.user_id, SEASON_TABLE_MAX),
    ]);
    truncated = own.results.length >= SEASON_TABLE_MAX || crew.results.length >= SEASON_TABLE_MAX;
    rows = [...own.results, ...crew.results].map((r) => ({
      path: sharePath('s', r.id, 'public', null), title: r.title, startedAt: r.t, distNm: r.dist_nm ?? 0, recorded: r.dist_source === 'track',
      role: r.role ? voyageRole(r.role) : null, boat: r.boat, own: !!r.own, regatta: readLog(r.log).regatta ?? null,
    }));
  }
  rows.sort((a, b) => b.startedAt - a.startedAt);
  return json(
    { mode: self ? seasonTableMode(p.season_table) : 'public', self, rows, truncated },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/** PUT /api/me/season-table – `{ mode: 'private' | 'public' }` (F-667): die eigene Jahresansicht im Profil zeigen oder nicht. */
export async function putSeasonTable(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const { mode } = await readJson<{ mode?: unknown }>(request);
  if (typeof mode !== 'string' || !(SEASON_TABLE_MODES as readonly string[]).includes(mode)) {
    throw new HttpError(400, 'invalid_mode', 'Bitte „nur ich“ oder „alle, die mein Profil sehen“ wählen.');
  }
  const res = await env.DB.prepare('UPDATE profiles SET season_table = ? WHERE user_id = ?').bind(mode, user.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'no_profile', 'Lege zuerst dein Profil an.');
  return json({ mode });
}
