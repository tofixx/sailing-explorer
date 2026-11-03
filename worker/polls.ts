// Umfragen (Konzept 21.5, 29, F-407, F-471 … F-475): abstimmen, vorzeitig beenden, Stand je Betrachter und „wer hat was
// gewählt“. Die Umfrage selbst ist ein Beitrag (`posts.kind = 'poll'`) – angelegt, gelesen, verbreitet und gelöscht wie
// Text-Beiträge (worker/posts.ts); hier steht nur, was die Art mitbringt. Sichtbarkeit prüft `visiblePost` (fail closed).
import type { Env } from './env';
import { currentUser, requireUser } from './auth';
import { HttpError, json, readJson } from './http';
import { assertActive } from './moderation';
import { visiblePost } from './posts';
import { notSuspendedSql, publicSql } from './visible-sql';
import { POLL_LIMITS, isPollOpen, parsePollData, validChoices, viewPoll, type PollConfig, type PollTally, type PollView } from '../src/domain/polls';
import { REACTION_LIMITS } from '../src/domain/reactions';
import { assertQuota, reactionLogStmt } from './reactions';
import type { StreamItem } from '../src/domain/groups';

const NOT_POLL = () => new HttpError(404, 'not_found', 'Diese Umfrage gibt es nicht (mehr).');

/** Noch offen (Bedingung in SQL, `?1` Beitrag, `?3` jetzt) – dieselbe Regel wie `isPollOpen`. */
const OPEN_SQL = `EXISTS (SELECT 1 FROM posts op WHERE op.id = ?1 AND op.kind = 'poll'
  AND COALESCE(json_extract(op.data, '$.poll.closesAt'), 9e15) > ?3)`;

/**
 * Stimmen mehrerer Umfragen in einem Batch (`ids`): Zähler je Antwort ohne gesperrte Konten, Teilnehmende, eigene Wahl
 * und Autor:in. Für die Stream-Seite und die Antworten einzelner Umfragen dieselbe Abfrage.
 */
async function tallies(env: Env, ids: string[], viewerId: string | null): Promise<Map<string, PollTally & { authorId: string }>> {
  const keys = JSON.stringify(ids);
  const [counts, voters, mine, authors] = await env.DB.batch([
    env.DB.prepare(
      `SELECT v.post_id AS pid, v.choice, COUNT(*) AS n FROM json_each(?1) k CROSS JOIN poll_votes v ON v.post_id = k.value
       WHERE ${notSuspendedSql('v.user_id')} GROUP BY v.post_id, v.choice`,
    ).bind(keys),
    env.DB.prepare(
      `SELECT v.post_id AS pid, COUNT(DISTINCT v.user_id) AS n FROM json_each(?1) k CROSS JOIN poll_votes v ON v.post_id = k.value
       WHERE ${notSuspendedSql('v.user_id')} GROUP BY v.post_id`,
    ).bind(keys),
    env.DB.prepare(`SELECT v.post_id AS pid, v.choice FROM json_each(?1) k CROSS JOIN poll_votes v ON v.post_id = k.value WHERE v.user_id = ?2`).bind(keys, viewerId ?? ''),
    env.DB.prepare(`SELECT p.id AS pid, p.author_id FROM json_each(?1) k JOIN posts p ON p.id = k.value`).bind(keys),
  ]);
  const out = new Map<string, PollTally & { authorId: string }>();
  for (const a of authors.results as Array<{ pid: string; author_id: string }>) out.set(a.pid, { counts: [], voters: 0, mine: [], authorId: a.author_id });
  for (const r of counts.results as Array<{ pid: string; choice: number; n: number }>) {
    const t = out.get(r.pid);
    if (t) t.counts[r.choice] = r.n;
  }
  for (const r of voters.results as Array<{ pid: string; n: number }>) {
    const t = out.get(r.pid);
    if (t) t.voters = r.n;
  }
  for (const r of mine.results as Array<{ pid: string; choice: number }>) out.get(r.pid)?.mine.push(r.choice);
  for (const t of out.values()) t.mine.sort((a, b) => a - b);
  return out;
}

/**
 * Stimmen an die Umfrage-Karten einer Seite hängen (F-473, F-475) – je Betrachter, nach dem öffentlichen Cache
 * (`attachKindData`, worker/stream.ts). Ein Batch für alle Umfragen der Seite.
 */
export async function attachPolls(env: Env, items: StreamItem[], viewerId: string | null): Promise<void> {
  const polls = items.filter((i) => i.post?.poll);
  if (!polls.length) return;
  const by = await tallies(env, [...new Set(polls.map((i) => i.post!.id))], viewerId);
  const now = Date.now();
  for (const i of polls) {
    const t = by.get(i.post!.id);
    if (t) i.post = { ...i.post!, poll: viewPoll(i.post!.poll!, t, { isAuthor: !!viewerId && viewerId === t.authorId }, now) };
  }
}

/** Sichtbare Umfrage für die Anfrage (sonst 404 wie „gibt es nicht“) mit ihren Einstellungen. */
async function visiblePoll(request: Request, env: Env, id: string): Promise<{ id: string; authorId: string; config: PollConfig; hidden: boolean }> {
  const p = await visiblePost(request, env, id);
  const row = await env.DB.prepare(`SELECT kind, data, hidden_at FROM posts WHERE id = ?`).bind(p.id).first<{ kind: string; data: string; hidden_at: number | null }>();
  const config = row?.kind === 'poll' ? parsePollData(row.data) : null;
  if (!config) throw NOT_POLL();
  return { id: p.id, authorId: p.authorId, config, hidden: !!row?.hidden_at };
}

/** Stand einer Umfrage für ein Konto (Antwort auf Abstimmen und Beenden). */
async function viewFor(env: Env, id: string, config: PollConfig, viewerId: string | null): Promise<PollView> {
  const t = (await tallies(env, [id], viewerId)).get(id) ?? { counts: [], voters: 0, mine: [], authorId: '' };
  return viewPoll(config, t, { isAuthor: !!viewerId && viewerId === t.authorId }, Date.now());
}

/**
 * PUT /api/posts/:id/vote `{ choices }` (F-471): eigene Stimme setzen, ändern oder mit `[]` zurücknehmen – nur
 * angemeldet, nicht gesperrt, für wer die Umfrage sehen darf (sonst 404), solange sie offen ist (409 `poll_closed`).
 * Atomar in einem Batch: alte Stimmen weg, neue nur, solange offen und weniger als 1000 andere teilnehmen
 * (409 `poll_full`). Tagesgrenze gemeinsam mit Reaktionen (429).
 */
export async function putVote(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const { config, hidden } = await visiblePoll(request, env, id);
  // ausgeblendet (gemeldet, Moderation sieht es noch): keine Stimmen
  if (hidden) throw NOT_POLL();
  const body = await readJson<{ choices?: unknown }>(request);
  const choices = validChoices(config, body.choices);
  if (!choices) throw new HttpError(400, 'invalid_choices', config.max === 1 ? 'Bitte eine Antwort wählen.' : `Höchstens ${config.max} Antworten.`);
  const now = Date.now();
  if (!isPollOpen(config, now)) throw new HttpError(409, 'poll_closed', 'Diese Umfrage ist beendet.');
  // „nach eigener Stimme“: wer abgestimmt und damit das Ergebnis gesehen hat, nimmt nicht mehr zurück (ändern geht)
  if (!choices.length && config.results === 'voted') throw new HttpError(409, 'vote_kept', 'Bei dieser Umfrage zeigt die Stimme das Ergebnis – ändern geht, zurücknehmen nicht.');
  await assertQuota(env, user.id, now);
  const [, inserted] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM poll_votes WHERE post_id = ?1 AND user_id = ?2 AND ${OPEN_SQL}`).bind(id, user.id, now),
    env.DB.prepare(
      `INSERT INTO poll_votes (post_id, user_id, choice, created_at)
       SELECT ?1, ?2, c.value, ?3 FROM json_each(?4) c
       WHERE ${OPEN_SQL} AND (SELECT COUNT(DISTINCT x.user_id) FROM poll_votes x WHERE x.post_id = ?1 AND x.user_id <> ?2) < ?5`,
    ).bind(id, user.id, now, JSON.stringify(choices), POLL_LIMITS.voters),
    reactionLogStmt(env, user.id, now),
  ]);
  if (choices.length && inserted.meta.changes !== choices.length) {
    // offen war sie eben noch – also beendet in diesem Moment oder voll
    const still = isPollOpen(config, Date.now());
    throw still ? new HttpError(409, 'poll_full', `Diese Umfrage hat schon ${POLL_LIMITS.voters} Teilnehmende.`) : new HttpError(409, 'poll_closed', 'Diese Umfrage ist beendet.');
  }
  return json({ poll: await viewFor(env, id, config, user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * POST /api/posts/:id/close (F-472): die Autor:in beendet ihre offene Umfrage vorzeitig – `closesAt` wird jetzt
 * (bedingtes UPDATE, `meta.changes`); keine Meldung `poll_closed` an sie selbst. Andere bzw. schon beendet → 404/409.
 */
export async function closePoll(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  await assertActive(env, user);
  const { authorId, config } = await visiblePoll(request, env, id);
  if (authorId !== user.id) throw NOT_POLL();
  const now = Date.now();
  const res = await env.DB.prepare(
    `UPDATE posts SET data = json_set(data, '$.poll.closesAt', ?3, '$.poll.notified', 1), updated_at = ?3
     WHERE id = ?1 AND author_id = ?2 AND kind = 'poll' AND COALESCE(json_extract(data, '$.poll.closesAt'), 9e15) > ?3`,
  )
    .bind(id, user.id, now)
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'poll_closed', 'Diese Umfrage ist schon beendet.');
  return json({ poll: await viewFor(env, id, { ...config, closesAt: now }, user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * GET /api/posts/:id/poll – Stand für die Anfrage und bei namentlichen Umfragen (F-474), sobald sie das Ergebnis sieht,
 * je Antwort die Namen öffentlicher Profile nicht gesperrter Konten (höchstens 50) und „+ n weitere“. Anonym nie Namen –
 * auch nicht für die Autor:in. Keine Konto-IDs, nie gecacht.
 */
export async function getPoll(request: Request, env: Env, id: string): Promise<Response> {
  const { config } = await visiblePoll(request, env, id);
  const user = await currentUser(request, env);
  const poll = await viewFor(env, id, config, user?.id ?? null);
  let people: Array<{ people: Array<{ handle: string; displayName: string }>; others: number }> | null = null;
  // `counts` gibt es nur, wenn die Anfrage das Ergebnis sehen darf (viewPoll/canSeeResults)
  if (config.named && poll.counts) {
    const { results } = await env.DB.prepare(
      `SELECT v.choice, p.handle, p.display_name FROM poll_votes v
         JOIN users u ON u.id = v.user_id AND u.suspended_at IS NULL
         LEFT JOIN profiles p ON p.user_id = v.user_id AND ${publicSql('p')}
       WHERE v.post_id = ? ORDER BY v.created_at`,
    )
      .bind(id)
      .all<{ choice: number; handle: string | null; display_name: string | null }>();
    people = config.options.map((_, i) => {
      const rows = results.filter((r) => r.choice === i);
      const named = rows.filter((r) => r.handle).slice(0, REACTION_LIMITS.who);
      return { people: named.map((r) => ({ handle: r.handle!, displayName: r.display_name ?? '' })), others: rows.length - named.length };
    });
  }
  return json({ poll, people }, { headers: { 'Cache-Control': 'private, no-store' } });
}
