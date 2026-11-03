// Wertungsvorlagen und Opt-in (Konzept 32, F-500, F-501, F-503, F-506): Vorschläge der Plattform (Plattform-Admins),
// Vorlagen der Vereine (Eigner/Admins: übernehmen, erweitern, eigene), die Auswahl je Eintrag (`shares.log.templateId`)
// und die Teilnahme an der Vereinsliste je Mitgliedschaft. Regeln prüft `parseRules` (src/domain/scoring.ts) – nie ein
// Ausdruck. Alles nur angemeldet und `no-store`; nichts davon ist öffentlich.
import type { Env } from './env';
import { requireUser, type User } from './auth';
import { HttpError, json, readJson } from './http';
import { randomId } from './crypto';
import { isAdmin } from './validate';
import { liveSql } from './visible-sql';
import { loadGroup, roleIn } from './groups';
import { canManageGroup, type GroupRole } from '../src/domain/groups';
import {
  BASE_TEMPLATE, BASE_TEMPLATE_ID, SCORING_LIMITS, listWeight, parseRules, readRules, templateName, type ScoringRules, type ScoringTemplate,
} from '../src/domain/scoring';
import { isTemplateId } from '../src/domain/logbook';

interface TemplateRow {
  id: string;
  group_id: string | null;
  name: string;
  rules: string;
  source_id: string | null;
  list_weight: number | null;
  group_name: string | null;
  source_name: string | null;
}

const NOT_FOUND = () => new HttpError(404, 'not_found', 'Diese Vorlage gibt es nicht.');
const FORBIDDEN = () => new HttpError(403, 'forbidden', 'Vorlagen pflegen nur Eigentümer und Admins des Vereins.');

/** Vorlage samt Vereinsname und Herkunft (die übernommene Vorlage, solange es sie gibt). */
const SELECT = `SELECT st.id, st.group_id, st.name, st.rules, st.source_id, st.list_weight, g.name AS group_name, src.name AS source_name
  FROM scoring_templates st
  LEFT JOIN groups g ON g.id = st.group_id
  LEFT JOIN scoring_templates src ON src.id = st.source_id`;

/** Vereine des Kontos, deren Vorlagen es wählen darf: Mitglied, Verein weder ausgeblendet noch gesperrt. */
const MY_CLUBS = `SELECT m.group_id FROM group_members m JOIN groups mg ON mg.id = m.group_id
  WHERE m.user_id = ?1 AND mg.kind = 'club' AND ${liveSql('mg')}`;

export const templateShape = (r: TemplateRow): ScoringTemplate => ({
  id: r.id,
  name: r.name,
  rules: readRules(r.rules),
  groupId: r.group_id,
  groupName: r.group_name,
  sourceName: r.source_name,
  listWeight: r.group_id ? r.list_weight : null,
});

/**
 * Wählbare Vorlagen eines Kontos (F-501): „Nur Meilen“, die Vorschläge der Plattform und die Vorlagen seiner Vereine.
 * Dieselbe Liste rechnet Fahrtenbuch, Jahresbericht und Prüfung beim Speichern.
 */
export async function templatesFor(env: Env, userId: string): Promise<ScoringTemplate[]> {
  const { results } = await env.DB.prepare(
    `${SELECT} WHERE st.group_id IS NULL OR st.group_id IN (${MY_CLUBS}) ORDER BY st.group_id IS NOT NULL, g.name, st.name`,
  )
    .bind(userId)
    .all<TemplateRow>();
  return [BASE_TEMPLATE, ...results.map(templateShape)];
}

/** Vorlagen eines Vereins (für die Vereinsliste). */
export async function clubTemplates(env: Env, groupId: string): Promise<ScoringTemplate[]> {
  const { results } = await env.DB.prepare(`${SELECT} WHERE st.group_id = ? ORDER BY st.name`).bind(groupId).all<TemplateRow>();
  return results.map(templateShape);
}

/**
 * Vorlage beim Speichern eines Eintrags (F-501): „Nur Meilen“, ein Vorschlag der Plattform oder eine Vorlage eines
 * eigenen Vereins – sonst 400. Ohne Angabe gilt „Nur Meilen“.
 */
export async function assertTemplateUsable(env: Env, userId: string, templateId: string | undefined): Promise<void> {
  if (templateId === undefined || templateId === BASE_TEMPLATE_ID) return;
  const ok = isTemplateId(templateId)
    && (await env.DB.prepare(`SELECT 1 AS x FROM scoring_templates st WHERE st.id = ?2 AND (st.group_id IS NULL OR st.group_id IN (${MY_CLUBS}))`)
      .bind(userId, templateId)
      .first());
  if (!ok) throw new HttpError(400, 'invalid_template', 'Diese Wertungsvorlage kannst du nicht wählen.');
}

/** Verein, dessen Mitglied das Konto ist (Verein weder ausgeblendet noch gesperrt) – sonst 404. */
export async function memberClub(env: Env, userId: string, id: string): Promise<{ id: string; role: GroupRole }> {
  const g = await loadGroup(env, id);
  const role = g ? await roleIn(env, userId, g.id) : null;
  if (!g || !role || g.kind !== 'club' || g.hidden_at) throw new HttpError(404, 'not_found', 'Diesen Verein gibt es nicht oder du bist kein Mitglied.');
  return { id: g.id, role };
}

/** Darf das Konto Vorlagen dieses Besitzers pflegen? `null` = Vorschläge der Plattform (nur Plattform-Admins). */
async function assertManage(env: Env, user: User, groupId: string | null): Promise<void> {
  if (groupId === null) {
    if (!isAdmin(env, user.id)) throw new HttpError(403, 'forbidden', 'Vorschläge der Plattform pflegen nur Admins.');
    return;
  }
  const { role } = await memberClub(env, user.id, groupId);
  if (!canManageGroup(role)) throw FORBIDDEN();
}

async function loadTemplate(env: Env, id: string): Promise<TemplateRow> {
  const row = isTemplateId(id) ? await env.DB.prepare(`${SELECT} WHERE st.id = ?`).bind(id).first<TemplateRow>() : null;
  if (!row) throw NOT_FOUND();
  return row;
}

function rulesOrThrow(input: unknown): ScoringRules {
  const r = parseRules(input ?? {});
  if ('error' in r) throw new HttpError(400, 'invalid_rules', r.error);
  return r.rules;
}

function nameOrThrow(v: unknown): string {
  const name = templateName(v);
  if (!name) throw new HttpError(400, 'invalid_name', `Name mit 1 bis ${SCORING_LIMITS.nameMax} Zeichen.`);
  return name;
}

/** Faktor der Vereinsliste: nur Vereinsvorlagen, null = zählt nicht. */
function weightOrThrow(v: unknown, groupId: string | null): number | null {
  if (v === undefined || groupId === null) return null;
  const w = listWeight(v);
  if (w === undefined) throw new HttpError(400, 'invalid_weight', `Faktor ${SCORING_LIMITS.weightMin} bis ${SCORING_LIMITS.weightMax}.`);
  return w;
}

// ---------------------------------------------------------------- Routen

/**
 * GET /api/me/scoring – wählbare Vorlagen, zuletzt genutzte Vorlage, eigene Vereine mit Opt-in und Recht zu pflegen,
 * Plattform-Admin ja/nein. Nur für das Konto selbst.
 */
export async function getMyScoring(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const [templates, last, clubs] = await Promise.all([
    templatesFor(env, user.id),
    env.DB.prepare(
      `SELECT json_extract(log, '$.templateId') AS id FROM shares WHERE user_id = ? AND json_extract(log, '$.templateId') IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(user.id)
      .first<{ id: string }>(),
    env.DB.prepare(
      `SELECT g.id, g.slug, g.name, m.role, m.scoring_opt_in_at FROM group_members m JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = ? AND g.kind = 'club' AND ${liveSql('g')} ORDER BY g.name`,
    )
      .bind(user.id)
      .all<{ id: string; slug: string; name: string; role: GroupRole; scoring_opt_in_at: number | null }>(),
  ]);
  return json(
    {
      templates,
      lastTemplateId: last?.id ?? null,
      clubs: clubs.results.map((c) => ({ id: c.id, slug: c.slug, name: c.name, optIn: c.scoring_opt_in_at !== null, manage: canManageGroup(c.role) })),
      admin: isAdmin(env, user.id),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/**
 * POST /api/scoring/templates `{ groupId?, name?, rules?, sourceId?, listWeight? }` – Vorlage anlegen (F-500): ohne
 * `groupId` ein Vorschlag der Plattform (Admins), sonst eine Vereinsvorlage (Eigner/Admins). Mit `sourceId` übernommen
 * (Kopie eines Vorschlags bzw. einer Vorlage desselben Vereins). Höchstens 10 je Verein bzw. 20 Vorschläge – atomar.
 */
export async function createTemplate(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson<{ groupId?: unknown; name?: unknown; rules?: unknown; sourceId?: unknown; listWeight?: unknown }>(request);
  const groupId = body.groupId === undefined || body.groupId === null ? null : String(body.groupId);
  await assertManage(env, user, groupId);
  let source: TemplateRow | null = null;
  if (body.sourceId !== undefined && body.sourceId !== null) {
    source = await loadTemplate(env, String(body.sourceId));
    // übernehmen: Vorschläge der Plattform oder eine Vorlage desselben Vereins – nie die eines fremden Vereins
    if (source.group_id !== null && source.group_id !== groupId) throw NOT_FOUND();
  }
  const name = nameOrThrow(body.name ?? (source ? source.name : undefined));
  const rules = body.rules !== undefined ? rulesOrThrow(body.rules) : source ? readRules(source.rules) : rulesOrThrow({});
  const weight = weightOrThrow(body.listWeight, groupId);
  const id = randomId();
  const now = Date.now();
  const max = groupId ? SCORING_LIMITS.perClub : SCORING_LIMITS.global;
  const res = await env.DB.prepare(
    `INSERT INTO scoring_templates (id, group_id, name, rules, source_id, list_weight, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7 WHERE (SELECT COUNT(*) FROM scoring_templates WHERE group_id IS ?2) < ?8`,
  )
    .bind(id, groupId, name, JSON.stringify(rules), source?.id ?? null, weight, now, max)
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'template_limit', `Höchstens ${max} Vorlagen – bitte erst eine löschen.`);
  return json({ template: templateShape(await loadTemplate(env, id)) }, { status: 201 });
}

/** PATCH /api/scoring/templates/:id `{ name?, rules?, listWeight? }` – ändern (erweitern) durch dieselben Rechte. */
export async function updateTemplate(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = await loadTemplate(env, id);
  await assertManage(env, user, row.group_id);
  const body = await readJson<{ name?: unknown; rules?: unknown; listWeight?: unknown }>(request);
  const name = body.name !== undefined ? nameOrThrow(body.name) : row.name;
  const rules = body.rules !== undefined ? JSON.stringify(rulesOrThrow(body.rules)) : row.rules;
  const weight = body.listWeight !== undefined ? weightOrThrow(body.listWeight, row.group_id) : row.list_weight;
  await env.DB.prepare('UPDATE scoring_templates SET name = ?, rules = ?, list_weight = ?, updated_at = ? WHERE id = ?')
    .bind(name, rules, weight, Date.now(), row.id)
    .run();
  return json({ template: templateShape(await loadTemplate(env, row.id)) });
}

/**
 * DELETE /api/scoring/templates/:id – Einträge mit dieser Vorlage rechnen danach mit „Nur Meilen“ (beim Lesen, F-501);
 * Kopien in Vereinen bleiben, wenn ein Vorschlag der Plattform gelöscht wird (F-506).
 */
export async function deleteTemplate(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const row = await loadTemplate(env, id);
  await assertManage(env, user, row.group_id);
  await env.DB.prepare('DELETE FROM scoring_templates WHERE id = ?').bind(row.id).run();
  return new Response(null, { status: 204 });
}

/**
 * PUT /api/groups/:id/scoring `{ optIn }` – an der Vereinsliste teilnehmen bzw. nicht mehr (F-503). Nur die eigene
 * Mitgliedschaft in einem Verein; die Zustimmung fällt mit der Mitgliedschaft.
 */
export async function putScoringOptIn(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  const { optIn } = await readJson<{ optIn?: unknown }>(request);
  if (typeof optIn !== 'boolean') throw new HttpError(400, 'invalid_opt_in', 'optIn: true oder false.');
  const club = await memberClub(env, user.id, id);
  await env.DB.prepare('UPDATE group_members SET scoring_opt_in_at = ? WHERE group_id = ? AND user_id = ?')
    .bind(optIn ? Date.now() : null, club.id, user.id)
    .run();
  return json({ optIn });
}
