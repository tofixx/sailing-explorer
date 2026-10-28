// Funktionale Tests: verifizierte Vertretung von Vereinen und Häfen (Konzept 20, F-360 … F-371) – Antrag, Grenzen,
// Prüfung durch Admins, Übertragung, Abzeichen, Sperre gegen Rückübernahme, Benachrichtigungen, Ende und Löschkonzept.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type GroupOut, type Person } from './social-helpers';
import { CLAIM_LIMITS, claimResultText, parseClaimInput, parseDecisionNote, parseEvidenceUrl, transferConsequence } from '../../src/domain/claims';
import { notificationText } from '../../src/domain/notifications';

const DAY = 86_400_000;
const ADMIN_ID = 'ClaimAdmin0000001';
const ADMIN_MAIL = 'claims-admin@example.org';

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  admin = { ...(await login(h, ADMIN_MAIL)), email: ADMIN_MAIL };
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const A = (method: string, path: string, body?: unknown) => s.send(method, path, admin.cookie, body);
const ok = async <T>(res: Response): Promise<T> => {
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return (res.status === 204 ? null : await res.json()) as T;
};
const one = async <T>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const run = async (sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).run();

const INPUT = { role: '1. Vorsitzende', reason: 'Ich bin seit 2024 Vorsitzende des Vereins.', contact: '0331 123456', evidenceUrl: 'https://example.org/impressum' };

interface State { verified: boolean; representing: boolean; blocked: boolean; canClaim: boolean; claim: { id: string; status: string; note: string } | null }
const claim = (p: Person, kind: 'group' | 'harbor', id: string, o: Record<string, unknown> = {}) => s.send('POST', '/api/claims', p.cookie, { kind, id, ...INPUT, ...o });
const state = async (p: Person, kind: string, id: string) => ok<State>(await s.send('GET', `/api/claims/${kind}/${id}`, p.cookie));
const decide = (id: string, body: Record<string, unknown>) => A('POST', `/api/admin/claims/${id}`, body);
async function claimId(p: Person, kind: 'group' | 'harbor', id: string): Promise<string> {
  const st = await ok<State>(await claim(p, kind, id));
  return st.claim!.id;
}
async function harbor(p: Person, name = s.uniq('Hafen')) {
  return (await ok<{ harbor: { id: string; slug: string } }>(await s.send('POST', '/api/harbors', p.cookie, { name }))).harbor;
}
const role = async (g: GroupOut, p: Person) => (await one<{ role: string }>('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', g.id, p.user.id))?.role ?? null;
const bell = async (p: Person) => (await ok<{ items: Array<{ kind: string; title: string; what: string; href: string; text: string }> }>(await s.send('GET', '/api/notifications', p.cookie))).items;
const mails = (to: string) => h.logs.filter((l) => l.includes(`[mail:log] an ${to}:`));

describe('Verifizierung: reine Regeln', () => {
  it('[F-360] Felder werden geprüft und bereinigt', () => {
    expect(parseClaimInput({ ...INPUT, role: '  1.   Vorsitzende ' })).toEqual({ ...INPUT });
    expect(parseClaimInput({ ...INPUT, role: 'ab' })).toEqual({ error: 'role' });
    expect(parseClaimInput({ ...INPUT, reason: 'zu kurz' })).toEqual({ error: 'reason' });
    expect(parseClaimInput({ ...INPUT, contact: '' })).toEqual({ error: 'contact' });
    expect(parseClaimInput({ ...INPUT, evidenceUrl: 'http://example.org' })).toEqual({ error: 'evidenceUrl' });
    expect(parseEvidenceUrl('')).toBe('');
    expect(parseEvidenceUrl('https://user:pw@example.org')).toBeNull();
    expect(parseEvidenceUrl('javascript:alert(1)')).toBeNull();
    expect(parseEvidenceUrl(`https://example.org/${'x'.repeat(CLAIM_LIMITS.evidenceMax)}`)).toBeNull();
    expect(parseDecisionNote('kurz')).toBeNull();
    expect(parseDecisionNote('Nicht bestätigt vom Verein.')).toBe('Nicht bestätigt vom Verein.');
  });

  it('[F-368] Texte für Glocke und Mail', () => {
    expect(claimResultText('rejected', 'SC Möwe')).toBe('Dein Antrag für „SC Möwe“ wurde abgelehnt');
    expect(transferConsequence('group', 'member')).toBe('du bist jetzt einfaches Mitglied');
    expect(transferConsequence('harbor', 'admin')).toBe('du kannst ihn nicht mehr bearbeiten');
    const base = { count: 1, actor: null, title: 'SC Möwe' };
    expect(notificationText({ ...base, kind: 'claim', what: '' })).toBe('Jemand beantragt, „SC Möwe“ zu vertreten');
    expect(notificationText({ ...base, kind: 'claim_result', what: 'accepted' })).toMatch(/angenommen/);
    expect(notificationText({ ...base, kind: 'claim_transfer', what: 'du bleibst Admin' })).toMatch(/verifizierten Vertretung verwaltet – du bleibst Admin/);
  });
});

describe('Verifizierte Vertretung (Konzept 20)', () => {
  it('[F-360] Antrag für Verein und Hafen, auch vom heutigen Eigner; Teams nicht; Gäste und Suspendierte nicht', async () => {
    const owner = await s.person({ supporter: true });
    const p = await s.person();
    const club = await s.group(owner);
    const st = await ok<State>(await claim(p, 'group', club.id));
    expect(st.claim?.status).toBe('open');
    expect(st.canClaim).toBe(false);
    const row = await one<{ role_text: string; contact: string; evidence_url: string }>('SELECT * FROM claims WHERE id = ?', st.claim!.id);
    expect(row).toMatchObject({ role_text: INPUT.role, contact: INPUT.contact, evidence_url: INPUT.evidenceUrl });
    expect((await claim(owner, 'group', club.id)).status).toBe(201);
    const h1 = await harbor(owner);
    expect((await claim(p, 'harbor', h1.id)).status).toBe(201);
    const team = await s.group(owner, { kind: 'team' });
    expect((await claim(p, 'group', team.id)).status).toBe(404);
    expect((await claim(p, 'group', club.id, { reason: 'kurz' })).status).toBe(400);
    expect((await s.send('POST', '/api/claims', undefined, { kind: 'group', id: club.id, ...INPUT })).status).toBe(401);
    const sus = await s.person();
    await run('UPDATE users SET suspended_at = ? WHERE id = ?', Date.now(), sus.user.id);
    expect((await claim(sus, 'group', club.id)).status).toBe(403);
  });

  it('[F-361] Grenzen: sichtbar, einer je Objekt, 3 offene, 5 in 30 Tagen, Wartefrist, je Objekt 10', async () => {
    const owner = await s.person({ supporter: true });
    const p = await s.person();
    const closed = await s.group(owner, { visibility: 'private' });
    expect((await claim(p, 'group', closed.id)).status).toBe(404);
    const hidden = await s.group(owner);
    await run('UPDATE groups SET hidden_at = ? WHERE id = ?', Date.now(), hidden.id);
    expect((await claim(p, 'group', hidden.id)).status).toBe(404);
    const clubs = [await s.group(owner), await s.group(owner), await s.group(owner), await s.group(owner)];
    expect((await claim(p, 'group', clubs[0].id)).status).toBe(201);
    const again = await claim(p, 'group', clubs[0].id);
    expect([again.status, await s.errorOf(again)]).toEqual([409, 'claim_open']);
    expect((await claim(p, 'group', clubs[1].id)).status).toBe(201);
    expect((await claim(p, 'group', clubs[2].id)).status).toBe(201);
    const fourth = await claim(p, 'group', clubs[3].id);
    expect([fourth.status, await s.errorOf(fourth)]).toEqual([429, 'claim_limit']);
    // 5 in 30 Tagen zählen auch Zurückgezogene
    const q = await s.person();
    for (let i = 0; i < 5; i++) {
      const id = await claimId(q, 'group', clubs[i % 4].id);
      expect((await s.send('DELETE', `/api/claims/${id}`, q.cookie)).status).toBe(204);
    }
    expect(await s.errorOf(await claim(q, 'group', clubs[0].id))).toBe('claim_limit');
    // Doppelklick: zwei gleichzeitige Anträge – nur einer wird angelegt
    const dbl = await s.person();
    const both = await Promise.all([claim(dbl, 'group', clubs[1].id), claim(dbl, 'group', clubs[1].id)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    // Wartefrist nach Ablehnung
    const r = await s.person();
    const rid = await claimId(r, 'group', clubs[3].id);
    await ok(await decide(rid, { decision: 'reject', note: 'Keine Bestätigung vom Verein.' }));
    expect(await s.errorOf(await claim(r, 'group', clubs[3].id))).toBe('claim_retry');
    expect((await state(r, 'group', clubs[3].id)).canClaim).toBe(false);
    await run('UPDATE claims SET decided_at = ? WHERE id = ?', Date.now() - 31 * DAY, rid);
    expect((await claim(r, 'group', clubs[3].id)).status).toBe(201);
    // je Objekt höchstens 10 offene
    const busy = await harbor(owner);
    for (let i = 0; i < CLAIM_LIMITS.openPerTarget; i++) {
      await run(`INSERT INTO claims (id, target_kind, target_id, user_id, status, created_at) VALUES (?, 'harbor', ?, NULL, 'open', ?)`, `Busy${i}x${busy.id}`.slice(0, 30), busy.id, Date.now());
    }
    expect(await s.errorOf(await claim(await s.person(), 'harbor', busy.id))).toBe('claim_busy');
  });

  it('[F-362] Stand und Zurückziehen – nur eigene offene', async () => {
    const owner = await s.person();
    const p = await s.person();
    const club = await s.group(owner);
    expect(await state(p, 'group', club.id)).toMatchObject({ verified: false, claim: null, canClaim: true, blocked: false });
    const id = await claimId(p, 'group', club.id);
    const other = await s.person();
    expect((await s.send('DELETE', `/api/claims/${id}`, other.cookie)).status).toBe(404);
    expect((await s.send('DELETE', `/api/claims/${id}`, p.cookie)).status).toBe(204);
    expect(await one('SELECT status, reason, contact FROM claims WHERE id = ?', id)).toEqual({ status: 'withdrawn', reason: '', contact: '' });
    expect((await s.send('DELETE', `/api/claims/${id}`, p.cookie)).status).toBe(404);
    expect((await state(p, 'group', club.id)).canClaim).toBe(true);
  });

  it('[F-363] Admin-Liste mit Kontaktdaten nur für Admins, protokolliert', async () => {
    const owner = await s.person();
    const p = await s.person();
    const club = await s.group(owner);
    const id = await claimId(p, 'group', club.id);
    expect((await s.send('GET', '/api/admin/claims', p.cookie)).status).toBe(404);
    expect((await s.send('POST', `/api/admin/claims/${id}`, p.cookie, { decision: 'accept' })).status).toBe(404);
    const { claims } = await ok<{ claims: Array<Record<string, unknown> & { id: string; holder: { id: string }; applicant: { id: string } }> }>(await A('GET', '/api/admin/claims'));
    const c = claims.find((x) => x.id === id)!;
    expect(c).toMatchObject({ kind: 'group', role: INPUT.role, contact: INPUT.contact, evidenceUrl: INPUT.evidenceUrl, status: 'open' });
    expect(c.holder.id).toBe(owner.user.id);
    expect(c.applicant.id).toBe(p.user.id);
    expect(await one(`SELECT action FROM admin_log WHERE admin_id = ? AND target_kind = 'claims' ORDER BY created_at DESC`, ADMIN_ID)).toEqual({ action: 'list' });
    const decided = await ok<{ claims: Array<{ id: string }> }>(await A('GET', '/api/admin/claims?status=decided'));
    expect(decided.claims.some((x) => x.id === id)).toBe(false);
  });

  it('[F-364] Annehmen beim Verein: Eigner wechselt, bisheriger wird Admin/Mitglied/entfernt, weitere Anträge abgelehnt', async () => {
    for (const previous of ['admin', 'member', 'remove'] as const) {
      const owner = await s.person();
      const p = await s.person();
      const rival = await s.person();
      const club = await s.group(owner);
      await ok(await s.send('PUT', '/api/me/home', owner.cookie, { clubId: club.id }));
      const id = await claimId(p, 'group', club.id);
      const rivalId = await claimId(rival, 'group', club.id);
      expect(await ok<{ status: string }>(await decide(id, { decision: 'accept', previous }))).toEqual({ status: 'accepted' });
      expect(await one('SELECT owner_id FROM groups WHERE id = ?', club.id)).toEqual({ owner_id: p.user.id });
      expect(await role(club, p)).toBe('owner');
      expect(await role(club, owner)).toBe(previous === 'remove' ? null : previous);
      if (previous === 'remove') expect(await one('SELECT home_club_id FROM users WHERE id = ?', owner.user.id)).toEqual({ home_club_id: null });
      expect(await one('SELECT status, previous_user_id, previous_action FROM claims WHERE id = ?', id)).toEqual({ status: 'accepted', previous_user_id: owner.user.id, previous_action: previous });
      expect(await one('SELECT status, contact FROM claims WHERE id = ?', rivalId)).toEqual({ status: 'rejected', contact: '' });
      expect((await decide(id, { decision: 'reject', note: 'zu spät dran hier.' })).status).toBe(409);
    }
    // Hafen: Anleger:in wechselt; Antrag der heutigen Eigner:in verifiziert nur
    const creator = await s.person();
    const rep = await s.person();
    const hb = await harbor(creator);
    await ok(await decide(await claimId(rep, 'harbor', hb.id), { decision: 'accept' }));
    expect(await one('SELECT created_by, verified_at IS NOT NULL AS v FROM harbors WHERE id = ?', hb.id)).toEqual({ created_by: rep.user.id, v: 1 });
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, creator.cookie, { name: s.uniq('Neu') })).status).toBe(403);
    const self = await s.person();
    const own = await s.group(self);
    const sid = await claimId(self, 'group', own.id);
    await ok(await decide(sid, { decision: 'accept', previous: 'member' }));
    expect(await role(own, self)).toBe('owner');
    expect(await one('SELECT previous_user_id FROM claims WHERE id = ?', sid)).toEqual({ previous_user_id: null });
    expect(await one(`SELECT action FROM admin_log WHERE action = 'claim_accept' AND target_id = ?`, own.id)).toEqual({ action: 'claim_accept' });
  });

  it('[F-364] Annehmen scheitert bei ausgeblendetem Ziel, gesperrter Antragsteller:in oder falscher Wahl', async () => {
    const owner = await s.person();
    const p = await s.person();
    const club = await s.group(owner);
    const id = await claimId(p, 'group', club.id);
    expect((await decide(id, { decision: 'accept', previous: 'boss' })).status).toBe(400);
    expect((await decide(id, { decision: 'maybe' })).status).toBe(400);
    await run('UPDATE groups SET hidden_at = ? WHERE id = ?', Date.now(), club.id);
    expect(await s.errorOf(await decide(id, { decision: 'accept' }))).toBe('target_unavailable');
    await run('UPDATE groups SET hidden_at = NULL WHERE id = ?', club.id);
    await run('UPDATE users SET suspended_at = ? WHERE id = ?', Date.now(), p.user.id);
    expect(await s.errorOf(await decide(id, { decision: 'accept' }))).toBe('applicant_inactive');
    expect(await one('SELECT owner_id FROM groups WHERE id = ?', club.id)).toEqual({ owner_id: owner.user.id });
  });

  it('[F-364] geschlossener Verein blockiert die Annahme nicht; gleichzeitige Entscheidungen übertragen nur einmal', async () => {
    const owner = await s.person({ supporter: true });
    const a = await s.person();
    const b = await s.person();
    const club = await s.group(owner);
    const ida = await claimId(a, 'group', club.id);
    const idb = await claimId(b, 'group', club.id);
    await ok(await s.send('PATCH', `/api/groups/${club.id}`, owner.cookie, { visibility: 'private' }));
    const res = await Promise.all([decide(ida, { decision: 'accept' }), decide(idb, { decision: 'accept' })]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await one(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND role = 'owner'`, club.id)).toEqual({ n: 1 });
    expect(await one(`SELECT COUNT(*) AS n FROM claims WHERE target_id = ? AND status = 'accepted'`, club.id)).toEqual({ n: 1 });
    const winner = res[0].status === 200 ? a : b;
    expect(await one('SELECT owner_id FROM groups WHERE id = ?', club.id)).toEqual({ owner_id: winner.user.id });
    // Annehmen und Ablehnen desselben Antrags gleichzeitig: nur eins greift
    const c = await s.person();
    const club2 = await s.group(owner);
    const idc = await claimId(c, 'group', club2.id);
    const two = await Promise.all([decide(idc, { decision: 'accept' }), decide(idc, { decision: 'reject', note: 'Gleichzeitig abgelehnt.' })]);
    expect(two.map((r) => r.status).sort()).toEqual([200, 409]);
    const st = await one<{ status: string }>('SELECT status FROM claims WHERE id = ?', idc);
    expect(await one('SELECT owner_id FROM groups WHERE id = ?', club2.id)).toEqual({ owner_id: st!.status === 'accepted' ? c.user.id : owner.user.id });
  });

  it('[F-365] Ablehnen nur mit Begründung; Angaben sofort geleert', async () => {
    const owner = await s.person();
    const p = await s.person();
    const club = await s.group(owner);
    const id = await claimId(p, 'group', club.id);
    expect(await s.errorOf(await decide(id, { decision: 'reject', note: 'nein' }))).toBe('invalid_note');
    await ok(await decide(id, { decision: 'reject', note: 'Der Verein kennt dich nicht.' }));
    expect(await one('SELECT status, role_text, reason, contact, evidence_url, decision_note FROM claims WHERE id = ?', id)).toEqual({
      status: 'rejected', role_text: '', reason: '', contact: '', evidence_url: '', decision_note: 'Der Verein kennt dich nicht.',
    });
    expect((await state(p, 'group', club.id)).claim).toMatchObject({ status: 'rejected', note: 'Der Verein kennt dich nicht.' });
    expect(await one(`SELECT detail FROM admin_log WHERE action = 'claim_reject' AND target_id = ?`, club.id)).toEqual({ detail: 'Der Verein kennt dich nicht.' });
  });

  it('[F-366] Abzeichen in Gruppe, Hafenseite, Entdecken und Hafen-Suche – ohne Daten der Vertretung', async () => {
    const owner = await s.person();
    const club = await s.group(owner, { name: s.uniq('Verifizierter Club') });
    const hb = await harbor(owner, s.uniq('Verifizierthafen'));
    const groupOf = async () => (await ok<{ group: { verified?: boolean } }>(await s.send('GET', `/api/groups/slug/${club.slug}`, undefined))).group;
    expect((await groupOf()).verified).toBe(false);
    await ok(await decide(await claimId(owner, 'group', club.id), { decision: 'accept' }));
    await ok(await decide(await claimId(owner, 'harbor', hb.id), { decision: 'accept' }));
    const g = await groupOf();
    expect(g.verified).toBe(true);
    expect(JSON.stringify(g)).not.toContain(INPUT.contact);
    expect((await ok<{ harbor: { verified: boolean } }>(await s.send('GET', `/api/harbors/slug/${hb.slug}`, undefined))).harbor.verified).toBe(true);
    const disc = await ok<{ groups: Array<{ slug: string; verified?: boolean }> }>(await s.send('GET', '/api/discover', undefined));
    expect(disc.groups.find((x) => x.slug === club.slug)?.verified).toBe(true);
    const hits = await ok<{ harbors: Array<{ id: string; verified?: boolean }> }>(await s.send('GET', `/api/harbors?q=${encodeURIComponent(hb.slug.slice(0, 12))}`, undefined));
    expect(hits.harbors.find((x) => x.id === hb.id)?.verified).toBe(true);
  });

  it('[F-367] Sperre gegen Rückübernahme: Nachfolge überspringt Verdrängte, kein neuer Antrag, Löschen bei offenem Antrag', async () => {
    const squatter = await s.person();
    const rep = await s.person();
    const member = await s.person();
    const club = await s.group(squatter);
    await s.join(squatter, club, member);
    const id = await claimId(rep, 'group', club.id);
    // offener Antrag: Eigner kann nicht löschen
    expect(await s.errorOf(await s.send('DELETE', `/api/groups/${club.id}`, squatter.cookie))).toBe('claim_pending');
    await ok(await decide(id, { decision: 'accept', previous: 'admin' }));
    expect(await state(squatter, 'group', club.id)).toMatchObject({ blocked: true, canClaim: false });
    expect(await s.errorOf(await claim(squatter, 'group', club.id))).toBe('claim_blocked');
    // Vertretung löscht ihr Konto: der Verdrängte (dienstältester Admin) wird übersprungen, das Mitglied übernimmt
    expect((await s.send('DELETE', '/api/account', rep.cookie)).status).toBe(200);
    expect(await one('SELECT owner_id, verified_at FROM groups WHERE id = ?', club.id)).toEqual({ owner_id: member.user.id, verified_at: null });
    expect(await role(club, squatter)).toBe('admin');
    // … und die Sperre bleibt: kein neuer Antrag, und auch der nächste Wechsel überspringt ihn
    expect(await s.errorOf(await claim(squatter, 'group', club.id))).toBe('claim_blocked');
    expect((await s.send('DELETE', '/api/account', member.cookie)).status).toBe(200);
    expect(await one('SELECT COUNT(*) AS n FROM groups WHERE id = ? AND owner_id = ?', club.id, squatter.user.id)).toEqual({ n: 0 });
    // Hafen: kein Übernehmen per „Position zuerst“ bei je verifizierten Häfen
    // (mayAdoptHarbor in worker/claim-cleanup.ts fragt genau diese SQL ab)
    const { ADOPTABLE_HARBOR_SQL } = await import('../../worker/claim-sql');
    const adoptable = async (id: string) => !!(await one(ADOPTABLE_HARBOR_SQL, id));
    const hb = await harbor(squatter);
    expect(await adoptable(hb.id)).toBe(true);
    const hrep = await s.person();
    await ok(await decide(await claimId(hrep, 'harbor', hb.id), { decision: 'accept' }));
    expect(await adoptable(hb.id)).toBe(false);
    // auch nachdem die Vertretung ihr Konto gelöscht hat (Abzeichen weg) bleibt er „je verifiziert“
    expect((await s.send('DELETE', '/api/account', hrep.cookie)).status).toBe(200);
    expect(await one('SELECT verified_at FROM harbors WHERE id = ?', hb.id)).toEqual({ verified_at: null });
    expect(await adoptable(hb.id)).toBe(false);
  });

  it('[F-368] Glocke für Admins, Antragsteller:in und Verdrängte; Mails mit Begründung und Widerspruch', async () => {
    const owner = await s.person({ profile: 'public' });
    const p = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: s.uniq('Glockenclub') });
    const id = await claimId(p, 'group', club.id);
    const adminBell = (await bell(admin)).find((n) => n.kind === 'claim' && n.title === club.name);
    expect(adminBell).toMatchObject({ href: '/admin?tab=claims' });
    expect(adminBell!.text).toMatch(/beantragt/);
    // die heutige Eigner:in erfährt beim Einreichen nichts
    expect((await bell(owner)).some((n) => n.kind.startsWith('claim'))).toBe(false);
    await ok(await decide(id, { decision: 'accept', previous: 'member' }));
    expect((await bell(admin)).some((n) => n.kind === 'claim' && n.title === club.name)).toBe(false);
    expect((await bell(p)).find((n) => n.kind === 'claim_result')).toMatchObject({ what: 'accepted', href: `/g/${club.slug}` });
    expect((await bell(owner)).find((n) => n.kind === 'claim_transfer')).toMatchObject({ what: 'du bist jetzt einfaches Mitglied' });
    expect(mails(p.email).some((m) => m.includes('wurde angenommen'))).toBe(true);
    const transfer = mails(owner.email).find((m) => m.includes('Verwaltung übertragen'));
    expect(transfer).toMatch(/einfaches Mitglied/);
    expect(transfer).toMatch(/nicht einverstanden/);
    // Ablehnung: Mail mit Begründung
    const q = await s.person();
    await ok(await decide(await claimId(q, 'group', club.id), { decision: 'reject', note: 'Leider nicht bestätigt.' }));
    expect(mails(q.email).find((m) => m.includes('abgelehnt'))).toMatch(/Leider nicht bestätigt/);
    // gesperrter Hafen erscheint nicht in der Glocke
    const hb = await harbor(owner);
    await ok(await decide(await claimId(q, 'harbor', hb.id), { decision: 'reject', note: 'Hafen nicht bestätigt.' }));
    expect((await bell(q)).some((n) => n.kind === 'claim_result' && n.href === `/h/${hb.slug}`)).toBe(true);
    await ok(await A('PUT', `/api/admin/harbors/${hb.id}/lock`, { reason: 'Prüfung' }));
    expect((await bell(q)).some((n) => n.href === `/h/${hb.slug}`)).toBe(false);
    // gelesen mit dem Reiter (kind)
    const r = await s.person();
    await claimId(r, 'group', (await s.group(owner)).id);
    expect((await ok<{ unread: number }>(await A('POST', '/api/notifications/read', { kind: 'claim' }))).unread).toBe(0);
  });

  it('[F-369] Verifizierung entziehen, endet beim Eigner-Wechsel durch Admins; Hafen-Zusammenführen geschützt', async () => {
    const squatter = await s.person();
    const rep = await s.person();
    const club = await s.group(squatter);
    await ok(await decide(await claimId(rep, 'group', club.id), { decision: 'accept' }));
    expect((await A('DELETE', `/api/admin/groups/${club.id}/verification`, { reason: 'x' })).status).toBe(400);
    expect((await s.send('DELETE', `/api/admin/groups/${club.id}/verification`, rep.cookie, { reason: 'Vorstand gewechselt.' })).status).toBe(404);
    await ok(await A('DELETE', `/api/admin/groups/${club.id}/verification`, { reason: 'Vorstand gewechselt.' }));
    expect(await one('SELECT owner_id, verified_at FROM groups WHERE id = ?', club.id)).toEqual({ owner_id: rep.user.id, verified_at: null });
    expect(await state(squatter, 'group', club.id)).toMatchObject({ blocked: false, canClaim: true });
    expect(await s.errorOf(await A('DELETE', `/api/admin/groups/${club.id}/verification`, { reason: 'Vorstand gewechselt.' }))).toBe('not_verified');
    // Admin-Filter
    const items = (await ok<{ items: Array<{ id: string; verified?: boolean }> }>(await A('GET', '/api/admin/list/harbors?filter=verified'))).items;
    expect(items.every((i) => i.verified)).toBe(true);
    // Eigner-Wechsel durch Admins ohne Antrag
    const club2 = await s.group(squatter);
    await ok(await decide(await claimId(squatter, 'group', club2.id), { decision: 'accept' }));
    await ok(await A('POST', `/api/admin/groups/${club2.id}/owner`, { userId: rep.user.id }));
    expect(await one('SELECT verified_at FROM groups WHERE id = ?', club2.id)).toEqual({ verified_at: null });
    // Häfen zusammenführen
    const a = await harbor(squatter);
    const b = await harbor(squatter);
    await ok(await decide(await claimId(rep, 'harbor', a.id), { decision: 'accept' }));
    expect(await s.errorOf(await A('POST', `/api/admin/harbors/${a.id}/merge`, { into: b.id }))).toBe('verified');
    await ok(await A('POST', `/api/admin/harbors/${b.id}/merge`, { into: a.id }));
    // Hafen-Vertretung löscht ihr Konto: Abzeichen weg
    expect((await s.send('DELETE', '/api/account', rep.cookie)).status).toBe(200);
    expect(await one('SELECT verified_at FROM harbors WHERE id = ?', a.id)).toEqual({ verified_at: null });
  });

  it('[F-370] Löschkonzept: Fristen, Ablauf, Objekt und Konto löschen, Konten verbinden', async () => {
    const owner = await s.person({ supporter: true });
    const p = await s.person();
    const club = await s.group(owner);
    const accepted = await claimId(p, 'group', club.id);
    await ok(await decide(accepted, { decision: 'accept' }));
    const club2 = await s.group(owner);
    const rejected = await claimId(p, 'group', club2.id);
    await ok(await decide(rejected, { decision: 'reject', note: 'Nicht bestätigt hier.' }));
    const club3 = await s.group(owner);
    const old = await claimId(p, 'group', club3.id);
    await run('UPDATE claims SET decided_at = ? WHERE id IN (?, ?)', Date.now() - 31 * DAY, accepted, rejected);
    await run('UPDATE claims SET created_at = ? WHERE id = ?', Date.now() - 181 * DAY, old);
    await h.scheduled();
    expect(await one('SELECT status, role_text, reason, contact, evidence_url, previous_user_id FROM claims WHERE id = ?', accepted)).toEqual({
      status: 'accepted', role_text: '', reason: '', contact: '', evidence_url: '', previous_user_id: owner.user.id,
    });
    expect(await one('SELECT id FROM claims WHERE id = ?', rejected)).toBeNull();
    expect(await one('SELECT status, contact FROM claims WHERE id = ?', old)).toEqual({ status: 'expired', contact: '' });
    expect((await bell(p)).some((n) => n.kind === 'claim_result' && n.what === 'expired')).toBe(true);
    // Objekt löschen: Anträge samt Benachrichtigungen weg
    const q = await s.person();
    const club4 = await s.group(owner);
    const qid = await claimId(q, 'group', club4.id);
    await s.send('DELETE', `/api/claims/${qid}`, q.cookie);
    expect((await s.send('DELETE', `/api/groups/${club4.id}`, owner.cookie)).status).toBe(204);
    expect(await one('SELECT id FROM claims WHERE id = ?', qid)).toBeNull();
    const hb = await harbor(owner);
    // Zusammenführen: offene Anträge der Dublette gelten für das Ziel
    const dup = await harbor(owner);
    const did = await claimId(q, 'harbor', dup.id);
    await ok(await A('POST', `/api/admin/harbors/${dup.id}/merge`, { into: hb.id }));
    expect(await one('SELECT target_id, status FROM claims WHERE id = ?', did)).toEqual({ target_id: hb.id, status: 'open' });
    await s.send('DELETE', `/api/claims/${did}`, q.cookie);
    const hid = await claimId(q, 'harbor', hb.id);
    await ok(await A('DELETE', `/api/admin/harbors/${hb.id}`, { confirm: hb.id }));
    expect(await one('SELECT id FROM claims WHERE id = ?', hid)).toBeNull();
    expect(await one(`SELECT id FROM notifications WHERE subject_kind = 'claim' AND subject_id = ?`, hid)).toBeNull();
    // Konten verbinden: Antragsteller:in und Verdrängte:r gehen ans Ziel
    const into = await s.person({ supporter: true });
    await ok(await A('POST', `/api/admin/users/${owner.user.id}/merge`, { into: into.user.id, confirm: owner.user.id }));
    expect(await one('SELECT previous_user_id FROM claims WHERE id = ?', accepted)).toEqual({ previous_user_id: into.user.id });
    // Konto löschen: eigene Anträge weg, als Verdrängte:r geleert
    const other = await s.group(into);
    const pid = await claimId(p, 'group', other.id);
    expect((await s.send('DELETE', '/api/account', into.cookie)).status).toBe(200);
    expect(await one('SELECT previous_user_id FROM claims WHERE id = ?', accepted)).toEqual({ previous_user_id: null });
    expect((await s.send('DELETE', '/api/account', p.cookie)).status).toBe(200);
    expect(await one('SELECT COUNT(*) AS n FROM claims WHERE user_id = ? OR id = ?', p.user.id, pid)).toEqual({ n: 0 });
    // p war letztes Mitglied des übernommenen Vereins: Verein und Antrag sind weg (dass angenommene Anträge sonst ohne
    // Konto-ID bleiben, prüft F-367 mit echter Kontolöschung)
    expect(await one('SELECT id FROM groups WHERE id = ?', club.id)).toBeNull();
    expect(await one('SELECT id FROM claims WHERE id = ?', accepted)).toBeNull();
  });

  it('[F-371] Verein eines verifizierten Hafens ordnen nur Vertretung und Moderation zu', async () => {
    const clubOwner = await s.person();
    const rep = await s.person();
    const club = await s.group(clubOwner);
    const hb = await harbor(clubOwner);
    await ok(await decide(await claimId(rep, 'harbor', hb.id), { decision: 'accept' }));
    expect(await s.errorOf(await s.send('PATCH', `/api/harbors/${hb.id}`, clubOwner.cookie, { clubId: club.id }))).toBe('verified_harbor');
    const page = await ok<{ clubChoices: unknown[]; canClearClub: boolean }>(await s.send('GET', `/api/harbors/slug/${hb.slug}`, clubOwner.cookie));
    expect(page.clubChoices).toEqual([]);
    await ok(await A('PATCH', `/api/harbors/${hb.id}`, { clubId: null }));
    // Vertretung, die einen Verein verwaltet, ordnet zu und löst
    const repClub = await s.group(rep);
    await run('UPDATE harbors SET club_id = ? WHERE id = ?', club.id, hb.id);
    const repPage = await ok<{ clubChoices: Array<{ id: string }>; canClearClub: boolean }>(await s.send('GET', `/api/harbors/slug/${hb.slug}`, rep.cookie));
    expect(repPage.clubChoices.map((c) => c.id)).toEqual([repClub.id]);
    expect(repPage.canClearClub).toBe(true);
    // nicht verifizierter Hafen: die Anleger:in allein bekommt kein „lösen“, das der Server ablehnen würde
    const plain = await harbor(rep);
    await run('UPDATE harbors SET club_id = ? WHERE id = ?', club.id, plain.id);
    expect((await ok<{ canClearClub: boolean }>(await s.send('GET', `/api/harbors/slug/${plain.slug}`, rep.cookie))).canClearClub).toBe(false);
    await ok(await s.send('PATCH', `/api/harbors/${hb.id}`, rep.cookie, { clubId: repClub.id }));
    await run('UPDATE harbors SET club_id = ? WHERE id = ?', club.id, hb.id);
    await ok(await s.send('PATCH', `/api/harbors/${hb.id}`, rep.cookie, { clubId: null }));
    expect(await one('SELECT club_id FROM harbors WHERE id = ?', hb.id)).toEqual({ club_id: null });
  });
});
