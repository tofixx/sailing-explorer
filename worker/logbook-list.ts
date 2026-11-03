// Fahrtenbuch nach Jahren (Konzept 27, F-411, F-456, F-457): eigene Törns und Crew-Törns anderer (Ausnahme M1) als eine
// Liste – die Seite `/konto/fahrtenbuch` gruppiert und summiert im Browser, der Meilennachweis kommt als CSV aus
// derselben Abfrage. Nur angemeldet, nie gecacht; nichts wird gespeichert.
import type { Env } from './env';
import { requireUser } from './auth';
import { json, withApiHeaders } from './http';
import { CREW_LOGBOOK_SQL } from './logbook-sql';
import { liveSql } from './visible-sql';
import { voyageRole } from '../src/domain/crew-roles';
import { isDistSource, isLogState, readLog, type Logbook } from '../src/domain/logbook';
import {
  LOGBOOK_MAX_ENTRIES, csvFileName, filterEntries, logbookCsv, parseLogFilter, type LogbookEntry,
} from '../src/domain/logbook-year';
import { sharePath, type Visibility } from '../src/domain/visibility';

interface Row {
  id: string;
  title: string;
  visibility: Visibility;
  share_key: string | null;
  t: number;
  ended_at: number | null;
  has_time: number;
  source: string;
  dist_nm: number | null;
  dist_source: string;
  log: string;
  log_state: string;
  role: string | null;
  confirmed: number;
  boat: string | null;
  boat_vis: Visibility | null;
  /** `log.timed` – auch für Crew-Törns, deren Angaben sie sonst nicht sehen */
  log_timed: number | null;
  hf_slug: string | null;
  hf_name: string | null;
  ht_slug: string | null;
  ht_name: string | null;
}

/** Häfen (ausgeblendete nicht) und Boot (ausgeblendete und gesperrte nicht) – gemeinsam für eigene und Crew-Törns. */
const JOINS = `LEFT JOIN boats b ON b.id = s.boat_id AND ${liveSql('b')}
  LEFT JOIN harbors hf ON hf.id = s.from_harbor_id AND hf.hidden_at IS NULL
  LEFT JOIN harbors ht ON ht.id = s.to_harbor_id AND ht.hidden_at IS NULL`;
const COLS = `s.id, s.title, s.visibility, s.share_key, COALESCE(s.started_at, s.created_at) AS t, s.ended_at,
  (s.started_at IS NOT NULL) AS has_time, s.source, s.dist_nm, s.dist_source, b.name AS boat, b.visibility AS boat_vis,
  json_extract(s.log, '$.timed') AS log_timed,
  hf.slug AS hf_slug, hf.name AS hf_name, ht.slug AS ht_slug, ht.name AS ht_name`;

/** Eigene Törns – jede Sichtbarkeit, auch ausgeschlossene (Filter „Ausgeschlossen“); gesperrte nicht (wie „Mein Verlauf“). */
const OWN_SQL = `SELECT ${COLS}, s.log, s.log_state, s.owner_role AS role, (s.role_confirmed_at IS NOT NULL) AS confirmed
  FROM shares s ${JOINS}
  WHERE s.user_id = ?1 AND s.locked_at IS NULL
  ORDER BY t DESC LIMIT ?2`;

/** Crew-Törns anderer nach M1: Stand aus der Bestätigung, nie die Angaben der Eigentümer:in. */
const CREW_SQL = `SELECT ${COLS}, '{}' AS log, CASE WHEN c.confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'suggested' END AS log_state,
    c.role AS role, (c.confirmed_at IS NOT NULL) AS confirmed
  FROM share_crew c JOIN shares s ON s.id = c.share_id ${JOINS}
  WHERE c.user_id = ?1 AND s.user_id <> ?1 AND ${CREW_LOGBOOK_SQL}
  ORDER BY t DESC LIMIT ?2`;

/** Für Liste und Summen: keine Freitexte (Notizen, Liegeplatz, Segelführung, Begründungen der Posten) – die stehen am Törn. */
function listLog(raw: string): Logbook {
  const { notes: _n, berth: _b, sails: _s, items, ...rest } = readLog(raw);
  return items ? { ...rest, items: items.map(({ name, n }) => ({ name, n })) } : rest;
}

function shape(r: Row, own: boolean): LogbookEntry {
  const log = own ? listLog(r.log) : {};
  const manual = r.source === 'manual';
  // Crew-Törns nur mit Link und Titel, wenn sie öffentlich sind – sonst Eckdaten (M1)
  const open = own || r.visibility === 'public';
  // Boot: eigene Törns immer; Crew mit bestätigter Rolle war an Bord (M1); sonst nur öffentliche Boote (F-82)
  const boat = own || r.confirmed || r.boat_vis === 'public' ? r.boat : null;
  return {
    id: r.id,
    own,
    path: open ? sharePath('s', r.id, r.visibility, own ? r.share_key : null) : null,
    title: open ? r.title : null,
    startedAt: r.t,
    endedAt: r.ended_at,
    timed: manual ? r.log_timed === 1 : !!r.has_time && r.ended_at !== null,
    source: manual ? 'manual' : 'gpx',
    distNm: r.dist_nm ?? 0,
    distSource: isDistSource(r.dist_source) ? r.dist_source : 'track',
    from: r.hf_slug ? { slug: r.hf_slug, name: r.hf_name ?? '' } : null,
    to: r.ht_slug ? { slug: r.ht_slug, name: r.ht_name ?? '' } : null,
    role: r.role ? voyageRole(r.role) : null,
    roleConfirmed: !!r.confirmed,
    boat,
    logState: isLogState(r.log_state) ? r.log_state : 'suggested',
    log,
  };
}

/** Alle Einträge des Kontos (eigene und Crew), neueste zuerst; `truncated`: mehr als LOGBOOK_MAX_ENTRIES. */
async function entriesOf(env: Env, userId: string): Promise<{ entries: LogbookEntry[]; truncated: boolean }> {
  const [own, crew] = await env.DB.batch<Row>([
    env.DB.prepare(OWN_SQL).bind(userId, LOGBOOK_MAX_ENTRIES),
    env.DB.prepare(CREW_SQL).bind(userId, LOGBOOK_MAX_ENTRIES),
  ]);
  const all = [...own.results.map((r) => shape(r, true)), ...crew.results.map((r) => shape(r, false))].sort((a, b) => b.startedAt - a.startedAt);
  return { entries: all.slice(0, LOGBOOK_MAX_ENTRIES), truncated: all.length > LOGBOOK_MAX_ENTRIES || own.results.length >= LOGBOOK_MAX_ENTRIES || crew.results.length >= LOGBOOK_MAX_ENTRIES };
}

/** GET /api/me/logbook – das ganze Fahrtenbuch (F-411); Saisons, Filter und Summen rechnet die Seite. */
export async function getMyLogbook(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json(await entriesOf(env, user.id), { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * GET /api/me/logbook.csv?saison=2026&stand=confirmed,suggested – Meilennachweis (F-457). Ohne `saison` alle Jahre
 * (Segellebenslauf); ohne `stand` Bestätigte und Vorschläge.
 */
export async function getMyLogbookCsv(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const url = new URL(request.url);
  const raw = url.searchParams.get('saison');
  const season = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const { entries, truncated } = await entriesOf(env, user.id);
  const csv = logbookCsv(filterEntries(entries, parseLogFilter(url.searchParams.get('stand')), season), truncated);
  return withApiHeaders(
    new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFileName(season)}"`,
        'Cache-Control': 'private, no-store',
      },
    }),
  );
}
