// Veranstaltungen (Konzept 21.5, 30, F-408, F-410, F-480 … F-489): Zusage mit atomarer Kapazität, „Wer kommt?“, Ändern
// und Absagen mit Meldung an alle Zusagen, Termin und Zähler für Karten (`attachKindData`) und der Nachtlauf
// (Erinnerung, Frist). Angelegt wird über den einen Weg zum Schreiben (`COMPOSE_KINDS.event`, worker/post-kinds.ts).
// Sichtbarkeit wie überall über `visiblePost`; Regeln rein in src/domain/events.ts.
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { HttpError, json, readJson } from './http';
import { assertActive } from './moderation';
import { visiblePost, removePost } from './posts';
import { roleIn } from './groups';
import { assertQuota } from './reactions';
import { writableChannel } from './post-chain';
import { isChannelKind } from '../src/domain/posts';
import { notifyEventChange, notifyEventReminder, notifyRsvp } from './notifications';
import { notSuspendedSql, publicSql } from './visible-sql';
import { SHARE_ID_RE } from './validate';
import { canManageGroup, type StreamItem } from '../src/domain/groups';
import {
  EVENT_LIMITS, RSVP_PROBLEM_TEXT, emptyCounts, eventChanged, isEventType, isRsvpStatus, parseEventInput, rsvpProblem, type EventView, type RsvpStatus,
} from '../src/domain/events';

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Veranstaltung gibt es nicht (mehr).');
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// ---------------------------------------------------------------- Karte: Termin, Zähler, eigene Zusage

interface EventRow {
  post_id: string;
  type: string;
  starts_at: number;
  ends_at: number;
  place: string;
  capacity: number | null;
  cancelled_at: number | null;
  yes: number;
  maybe: number;
  no: number;
  mine: string | null;
  own: number;
  updated_at: number;
  sequence: number;
}

/** Zusagen nicht gesperrter Konten mit Status `s` (Alias `r`) – dieselbe Zählung für Anzeige und Kapazität. */
const countSql = (post: string, status: string, extra = '') =>
  `(SELECT COUNT(*) FROM event_rsvps r WHERE r.post_id = ${post} AND r.status = ${status} AND ${notSuspendedSql('r.user_id')}${extra})`;

/**
 * Termin, Zähler je Status (ohne gesperrte Konten), eigene Zusage und Autorschaft des Betrachters (`?2`) sowie der
 * Stand für die Kalender-Datei – für mehrere Veranstaltungen in einer Abfrage.
 */
const VIEW_SQL = `SELECT e.post_id, e.type, e.starts_at, e.ends_at, e.place, e.capacity, e.cancelled_at,
    ${countSql('e.post_id', "'yes'")} AS yes, ${countSql('e.post_id', "'maybe'")} AS maybe, ${countSql('e.post_id', "'no'")} AS no,
    (SELECT r.status FROM event_rsvps r WHERE r.post_id = e.post_id AND r.user_id = ?2) AS mine,
    (p.author_id = ?2) AS own, COALESCE(p.updated_at, p.created_at) AS updated_at,
    (COALESCE(p.updated_at, p.created_at) - p.created_at) / 1000 AS sequence
  FROM post_events e JOIN posts p ON p.id = e.post_id WHERE e.post_id IN (SELECT value FROM json_each(?1))`;

const toView = (r: EventRow): EventView | null =>
  isEventType(r.type)
    ? {
        type: r.type, startsAt: r.starts_at, endsAt: r.ends_at, place: r.place, capacity: r.capacity, cancelled: r.cancelled_at !== null,
        counts: { ...emptyCounts(), yes: r.yes, maybe: r.maybe, no: r.no }, mine: isRsvpStatus(r.mine) ? r.mine : null, own: !!r.own,
        updatedAt: r.updated_at, sequence: r.sequence,
      }
    : null;

/** Eine Veranstaltung für diesen Betrachter – null, wenn der Beitrag keine ist. */
export async function eventView(env: Env, postId: string, viewerId: string | null): Promise<EventView | null> {
  const r = await env.DB.prepare(VIEW_SQL).bind(JSON.stringify([postId]), viewerId ?? '').first<EventRow>();
  return r ? toView(r) : null;
}

/**
 * Veranstaltungen einer Seite (F-489, Teil von `attachKindData`): Termin und Zähler, die eigene Zusage nur mit
 * Betrachter. Für gecachte Seiten ruft `addMine` es nach dem Cache je Betrachter noch einmal auf.
 */
export async function attachEvents(env: Env, items: StreamItem[], viewerId: string | null): Promise<void> {
  const posts = items.map((i) => i.post).filter((p): p is NonNullable<StreamItem['post']> => p?.kind === 'event');
  if (!posts.length) return;
  const { results } = await env.DB.prepare(VIEW_SQL).bind(JSON.stringify([...new Set(posts.map((p) => p.id))]), viewerId ?? '').all<EventRow>();
  const byId = new Map(results.map((r) => [r.post_id, toView(r)]));
  for (const p of posts) {
    const v = byId.get(p.id);
    if (v) p.event = v;
    else delete p.event;
  }
}

// ---------------------------------------------------------------- Zusage (F-481, F-482)

/**
 * Zusage setzen bzw. ändern – in **einer** Anweisung mit der Kapazität (R 10): nur, wenn die Veranstaltung nicht
 * abgesagt und nicht vorbei ist und – für „Nehme teil“ – die Zusagen der anderen die Kapazität noch nicht füllen oder
 * man selbst schon „Nehme teil“ hat (eine verkleinerte Kapazität nimmt niemandem den Platz). `meta.changes = 0` heißt:
 * abgelehnt.
 */
const RSVP_SQL = `INSERT INTO event_rsvps (post_id, user_id, status, updated_at)
  SELECT ?1, ?2, ?3, ?4 FROM post_events e
  WHERE e.post_id = ?1 AND e.cancelled_at IS NULL AND e.ends_at > ?4
    AND (?3 <> 'yes' OR e.capacity IS NULL
      OR EXISTS (SELECT 1 FROM event_rsvps x WHERE x.post_id = ?1 AND x.user_id = ?2 AND x.status = 'yes')
      OR ${countSql('?1', "'yes'", ' AND r.user_id <> ?2')} < e.capacity)
  ON CONFLICT(post_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`;

/**
 * PUT /api/posts/:id/rsvp `{ status }` – „Nehme teil“, „Vielleicht“, „Nehme nicht teil“ (B7): angemeldet, nicht
 * gesperrt, wer den Beitrag sehen darf (sonst 404). Jede Änderung zählt in die gemeinsame Tagesgrenze der Interaktionen
 * (Reaktionen, Stimmen; `reaction_log`, im selben Batch). Voll, abgesagt oder vorbei → 409. Antwort: die Veranstaltung
 * mit neuen Zählern.
 */
export async function setRsvp(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const { status } = await readJson<{ status?: unknown }>(request);
  if (!isRsvpStatus(status)) throw new HttpError(400, 'invalid_status', 'Unbekannte Zusage.');
  await visiblePost(request, env, id);
  const now = Date.now();
  await assertQuota(env, user.id, now);
  const before = await env.DB.prepare('SELECT status FROM event_rsvps WHERE post_id = ? AND user_id = ?').bind(id, user.id).first<{ status: string }>();
  // Tageszähler nur, wenn die Zusage gespeichert wurde (`changes()` der Anweisung davor, derselbe Batch)
  const [res] = await env.DB.batch([
    env.DB.prepare(RSVP_SQL).bind(id, user.id, status, now),
    env.DB.prepare('INSERT INTO reaction_log (user_id, created_at) SELECT ?1, ?2 WHERE changes() > 0').bind(user.id, now),
  ]);
  const view = await eventView(env, id, user.id);
  if (!view) throw NOT_FOUND();
  if (!res.meta.changes) {
    const why = rsvpProblem(view, status, now) ?? 'full';
    throw new HttpError(409, `event_${why}`, RSVP_PROBLEM_TEXT[why]);
  }
  // „Nehme teil“/„Vielleicht“ meldet sich bei der Autor:in, solange diese Person noch nicht zugesagt hatte (auch nach
  // „Nehme nicht teil“) – Wechsel zwischen beiden nie; derselbe Name direkt hintereinander bündelt `deliver`
  const wasIn = before?.status === 'yes' || before?.status === 'maybe';
  if (status !== 'no' && !wasIn) await notifyRsvp(env, id, user.id);
  return json({ event: view }, { headers: NO_STORE });
}

/** Ein Name in „Wer kommt?“ – Link nur bei öffentlichem Profil. */
interface RsvpPerson {
  displayName: string;
  handle: string | null;
}

/**
 * GET /api/posts/:id/rsvps – „Wer kommt?“ (F-483): bei „Nehme teil“ und „Vielleicht“ die Namen öffentlicher Profile,
 * der Rest als Anzahl; „Nehme nicht teil“ nur als Anzahl. Autor:in sowie Eigner und Admins der Gruppe sehen alle
 * Anzeigenamen (wie die Mitgliederliste), auch die Absagen. Gesperrte Konten nie, keine Konto-IDs.
 */
export async function listRsvps(request: Request, env: Env, id: string): Promise<Response> {
  const post = await visiblePost(request, env, id);
  const user = await currentUser(request, env);
  const all = !!user && (user.id === post.authorId || (!!post.groupId && canManageGroup(await roleIn(env, user.id, post.groupId))));
  const { results } = await env.DB.prepare(
    `SELECT r.status, pr.display_name, pr.handle, ${publicSql('pr')} AS public, (pr.hidden_at IS NULL) AS shown FROM event_rsvps r
       LEFT JOIN profiles pr ON pr.user_id = r.user_id
     WHERE r.post_id = ? AND ${notSuspendedSql('r.user_id')}
     ORDER BY r.updated_at`,
  )
    .bind(id)
    .all<{ status: string; display_name: string | null; handle: string | null; public: number | null; shown: number | null }>();
  const people: Record<RsvpStatus, RsvpPerson[]> = { yes: [], maybe: [], no: [] };
  const others = emptyCounts();
  for (const r of results) {
    if (!isRsvpStatus(r.status)) continue;
    const visible = all ? !!r.shown : !!r.public && r.status !== 'no';
    if (r.display_name && visible && people[r.status].length < EVENT_LIMITS.whoMax) people[r.status].push({ displayName: r.display_name, handle: r.public ? r.handle : null });
    else others[r.status]++;
  }
  return json({ people, others, all }, { headers: NO_STORE });
}

// ---------------------------------------------------------------- Ändern und Absagen (F-484, F-410)

/**
 * PATCH /api/posts/:id/event – nur die Autor:in, solange die Veranstaltung nicht vorbei ist: `{ type, startsAt, endsAt,
 * place, capacity }` ändert Termin, Ort und Kapazität; `{ cancel: true }` sagt ab (bleibt als Karte). Zeit, Ort oder
 * Absage melden `event` an alle mit Zusage; ein neuer Beginn bekommt eine neue Erinnerung. `posts.updated_at` ist der
 * Stand der Kalender-Datei. Titel und Beschreibung sind wie bei allen Beiträgen nicht änderbar.
 */
export async function updateEvent(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const row = SHARE_ID_RE.test(id)
    ? await env.DB.prepare(
        `SELECT p.author_id, p.channel_kind, p.channel_id, e.starts_at, e.ends_at, e.place, e.cancelled_at, g.locked_at FROM posts p
         JOIN post_events e ON e.post_id = p.id LEFT JOIN groups g ON g.id = p.group_id WHERE p.id = ?`,
      )
        .bind(id)
        .first<{ author_id: string; channel_kind: string; channel_id: string; starts_at: number; ends_at: number; place: string; cancelled_at: number | null; locked_at: number | null }>()
    : null;
  if (!row || row.author_id !== user.id || row.locked_at || !isChannelKind(row.channel_kind)) throw NOT_FOUND();
  // nur mit aktuellem Schreibrecht im Verlauf (wie Erweitern, F-409) – nach Austritt bzw. ohne Boot im Hafen nicht mehr
  if (!(await writableChannel(env, user.id, row.channel_kind, row.channel_id))) throw new HttpError(403, 'forbidden', 'Ändern kannst du nur, wo du noch schreiben darfst.');
  const now = Date.now();
  if (row.ends_at <= now) throw new HttpError(409, 'event_over', RSVP_PROBLEM_TEXT.over);
  if (row.cancelled_at) throw new HttpError(409, 'event_cancelled', RSVP_PROBLEM_TEXT.cancelled);
  const raw = await readJson<Record<string, unknown>>(request);
  const touch = env.DB.prepare('UPDATE posts SET updated_at = ? WHERE id = ?').bind(now, id);
  let changed: boolean;
  if (raw.cancel === true) {
    const [res] = await env.DB.batch([env.DB.prepare('UPDATE post_events SET cancelled_at = ? WHERE post_id = ? AND cancelled_at IS NULL').bind(now, id), touch]);
    changed = !!res.meta.changes;
  } else {
    const r = parseEventInput(raw, now);
    if ('error' in r) throw new HttpError(400, 'invalid_event', r.error);
    const e = r.event;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE post_events SET type = ?1, starts_at = ?2, ends_at = ?3, place = ?4, capacity = ?5,
           reminded_at = CASE WHEN starts_at = ?2 THEN reminded_at END WHERE post_id = ?6`,
      ).bind(e.type, e.startsAt, e.endsAt, e.place, e.capacity, id),
      touch,
    ]);
    changed = eventChanged({ startsAt: row.starts_at, endsAt: row.ends_at, place: row.place }, e);
  }
  if (changed) await notifyEventChange(env, id, user.id, raw.cancel === true);
  return json({ event: await eventView(env, id, user.id) }, { headers: NO_STORE });
}

// ---------------------------------------------------------------- Nachtlauf (Cron 03:17 UTC, F-485, F-488)

/**
 * Erinnerung an Veranstaltungen, die in den nächsten 36 h beginnen (F-485): einmal je Termin (`reminded_at`, bedingt
 * gesetzt – ein doppelter Lauf erinnert nicht doppelt), nicht abgesagt, Beitrag nicht ausgeblendet, Autor:in nicht
 * gesperrt. Nur Glocke und Sammelmail (Konzept 30.3). Höchstens EVENT_LIMITS.remindMax je Nacht.
 */
export async function remindEvents(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT e.post_id FROM post_events e JOIN posts p ON p.id = e.post_id
     WHERE e.starts_at > ?1 AND e.starts_at <= ?2 AND e.reminded_at IS NULL AND e.cancelled_at IS NULL
       AND p.hidden_at IS NULL AND ${notSuspendedSql('p.author_id')}
     ORDER BY e.starts_at LIMIT ?3`,
  )
    .bind(now, now + EVENT_LIMITS.remindAheadMs, EVENT_LIMITS.remindMax)
    .all<{ post_id: string }>();
  let n = 0;
  for (const { post_id } of results) {
    const res = await env.DB.prepare('UPDATE post_events SET reminded_at = ? WHERE post_id = ? AND reminded_at IS NULL').bind(now, post_id).run();
    if (!res.meta.changes) continue;
    await notifyEventReminder(env, post_id);
    n++;
  }
  return n;
}

/**
 * Frist (21.3.3, F-488): Veranstaltungen 12 Monate nach ihrem Ende über den einen Löschpfad `removePost` (Termin und
 * Zusagen per Cascade, Aktivität, Reaktionen, Benachrichtigungen, Meldungen). Gesperrte Gruppen bleiben als Beleg
 * (Konzept 18.3). Übernommene Fahrtenbuch-Einträge sind eigene Törns und bleiben. Höchstens EVENT_LIMITS.expireMax je
 * Nacht. Gesucht wird über den Beginn (Index `post_events_start`, Ende ≤ Beginn + 14 Tage).
 */
export async function expireEvents(env: Env, now: number): Promise<number> {
  const cutoff = now - EVENT_LIMITS.keepMs;
  const { results } = await env.DB.prepare(
    `SELECT e.post_id FROM post_events e JOIN posts p ON p.id = e.post_id
     WHERE e.starts_at < ?1 AND e.ends_at < ?1
       AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = p.group_id AND g.locked_at IS NOT NULL)
     LIMIT ?2`,
  )
    .bind(cutoff, EVENT_LIMITS.expireMax)
    .all<{ post_id: string }>();
  for (const { post_id } of results) await removePost(env, post_id);
  return results.length;
}

/** Nachtlauf der Veranstaltungen: erst die Frist, dann die Erinnerungen (vor der Sammelmail, worker/retention.ts). */
export async function runEventNight(env: Env, now: number): Promise<{ reminded: number; expired: number }> {
  const expired = await expireEvents(env, now);
  const reminded = await remindEvents(env, now);
  return { reminded, expired };
}
