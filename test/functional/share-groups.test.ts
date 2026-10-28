// Funktionale Tests: Törns in Gruppen – Auswahl beim Speichern bzw. Teilen statt automatisch (Konzept 11.12,
// F-373 … F-377). Echter Worker in workerd (Miniflare) – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person, type StreamOut } from './social-helpers';

let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker();
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

interface Choice {
  id: string;
  slug: string;
  name: string;
  kind: string;
  boatIds: string[];
}
type Meta = { groupIds?: string[]; groups: Array<{ name: string }> };

const choices = async (p: Person) => {
  const res = await s.send('GET', '/api/me/share-groups', p.cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { groups: Choice[] }).groups;
};
const selected = async (shareId: string) =>
  (await (await s.db()).prepare('SELECT group_id FROM share_groups WHERE share_id = ? ORDER BY group_id').bind(shareId).all<{ group_id: string }>()).results.map(
    (r) => r.group_id,
  );
const groupTargets = async (shareId: string) =>
  (
    await (await s.db())
      .prepare(
        `SELECT a.kind, t.target_id FROM activity a JOIN activity_target t ON t.activity_id = a.id AND t.target_kind = 'group'
         WHERE a.subject_kind = 'share' AND a.subject_id = ? ORDER BY a.kind, t.target_id`,
      )
      .bind(shareId)
      .all<{ kind: string; target_id: string }>()
  ).results;
const groupVoyages = async (g: { id: string }, p?: Person) => {
  const res = await h.fetch(`/api/groups/${g.id}/stream`, { cookie: p?.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as StreamOut).items.filter((i) => i.voyage).map((i) => i.voyage!.id);
};
const patch = (p: Person, id: string, body: unknown) => s.send('PATCH', `/api/shares/${id}`, p.cookie, body);
const sorted = (...ids: string[]) => [...ids].sort();

/** Segler:in, Mitglied in Verein und Team; das Boot ist nur dem Verein zugeordnet. */
async function setup() {
  const sailor = await s.person({ profile: 'public', supporter: true });
  const club = await s.group(sailor, { name: 'Verein Auswahl' });
  const team = await s.group(sailor, { name: 'Mittwochsregatta', kind: 'team' });
  const boat = await s.boat(sailor, { name: 'Auswahlboot' });
  const add = await s.send('POST', `/api/groups/${club.id}/boats`, sailor.cookie, { boatId: boat.id });
  expect(add.status, await add.clone().text()).toBeLessThan(300);
  return { sailor, club, team, boat };
}

// ---------------------------------------------------------------- F-373 Auswahl beim Speichern bzw. Teilen

describe('F-373 In Gruppen zeigen: Auswahl beim Speichern', () => {
  it('[F-373] wählbar sind nur eigene Gruppen (nicht ausgeblendet, nicht gesperrt), mit den eigenen Booten darin; ohne Anmeldung 401', async () => {
    const { sailor, club, team, boat } = await setup();
    const stranger = await s.person({ profile: 'public' });
    await s.group(stranger, { name: 'Fremder Club' });
    const hidden = await s.group(sailor, { name: 'Ausgeblendet', kind: 'team' });
    await (await s.db()).prepare('UPDATE groups SET hidden_at = 1 WHERE id = ?').bind(hidden.id).run();
    const list = await choices(sailor);
    expect(list.map((g) => g.name).sort()).toEqual(['Mittwochsregatta', 'Verein Auswahl']);
    expect(list.find((g) => g.id === club.id)).toMatchObject({ slug: club.slug, kind: 'club', boatIds: [boat.id] });
    expect(list.find((g) => g.id === team.id)?.boatIds).toEqual([]);
    expect((await s.send('GET', '/api/me/share-groups', undefined)).status).toBe(401);
  });

  it('[F-373] ohne Angabe: die Gruppen des Boots sind ausgewählt, ohne Boot keine; mit Angabe genau die Auswahl', async () => {
    const { sailor, club, team, boat } = await setup();
    const withBoat = await s.share(sailor, { boatId: boat.id });
    expect(await selected(withBoat.id)).toEqual([club.id]);
    const noBoat = await s.share(sailor);
    expect(await selected(noBoat.id)).toEqual([]);
    const chosen = await s.share(sailor, { boatId: boat.id, groups: [team.id] });
    expect(await selected(chosen.id)).toEqual([team.id]);
    const none = await s.share(sailor, { boatId: boat.id, groups: [] });
    expect(await selected(none.id)).toEqual([]);
  });

  it('[F-373] Vorauswahl nur aus Gruppen, in denen die Eigentümer:in Mitglied ist', async () => {
    const { club, boat } = await setup();
    // Ein Admin des Boots ist nicht Mitglied des Vereins: kein Verein vorausgewählt
    const admin = await s.person();
    const other = await s.group(admin, { name: 'Club des Admins' });
    await (await s.db()).prepare('INSERT INTO boat_admins (boat_id, user_id, created_at) VALUES (?, ?, ?)').bind(boat.id, admin.user.id, Date.now()).run();
    const share = await s.share(admin, { boatId: boat.id });
    expect(await selected(share.id)).toEqual([]);
    expect((await choices(admin)).map((g) => g.id)).toEqual([other.id]);
    expect(club.id).not.toBe(other.id);
  });

  it('[F-373] fremde, ausgeblendete, gesperrte oder unbekannte Gruppen → 403; kaputte Angaben → 400; nichts gespeichert', async () => {
    const { sailor } = await setup();
    const stranger = await s.person({ profile: 'public' });
    const foreign = await s.group(stranger, { name: 'Fremd' });
    const locked = await s.group(sailor, { name: 'Gesperrt', kind: 'team' });
    await (await s.db()).prepare('UPDATE groups SET locked_at = 1 WHERE id = ?').bind(locked.id).run();
    const before = (await (await s.db()).prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').bind(sailor.user.id).first<{ n: number }>())?.n;
    for (const id of [foreign.id, locked.id, 'AAAAAAAAAAAAAAAAAA']) {
      const res = await h.fetch('/api/shares', { method: 'POST', cookie: sailor.cookie, headers: { 'Content-Type': 'application/gzip', 'X-Share-Groups': JSON.stringify([id]) }, body: new Uint8Array([0x1f, 0x8b]) });
      expect(res.status).toBe(403);
      expect(await s.errorOf(res)).toBe('group_forbidden');
    }
    const bad = await h.fetch('/api/shares', { method: 'POST', cookie: sailor.cookie, headers: { 'Content-Type': 'application/gzip', 'X-Share-Groups': '["kurz"]' }, body: new Uint8Array([0x1f, 0x8b]) });
    expect(bad.status).toBe(400);
    expect(await s.errorOf(bad)).toBe('invalid_groups');
    const after = (await (await s.db()).prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').bind(sailor.user.id).first<{ n: number }>())?.n;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------- F-374 Nur ausgewählte Törns in der Gruppe

describe('F-374 Gruppen-Stream: nur ausgewählte Törns', () => {
  it('[F-374] öffentlicher Törn erscheint nur in den ausgewählten Gruppen; andere Törns der Mitglieder nicht; Hafen bleibt automatisch', async () => {
    const { sailor, club, team, boat } = await setup();
    const reader = await s.person();
    await s.join(sailor, team, reader);
    const inTeam = await s.share(sailor, { title: 'Mittwoch', boatId: boat.id, groups: [team.id] });
    const nowhere = await s.share(sailor, { title: 'Für mich', groups: [] });
    expect(await groupTargets(inTeam.id)).toEqual([{ kind: 'voyage', target_id: team.id }]);
    expect(await groupTargets(nowhere.id)).toEqual([]);
    expect(await groupVoyages(team)).toContain(inTeam.id);
    expect(await groupVoyages(club)).not.toContain(inTeam.id);
    expect(await groupVoyages(team)).not.toContain(nowhere.id);
    // Persönlicher Stream des Teammitglieds: über das Team; der Törn ohne Gruppe nur über „Teammitglieder“ (F-176)
    const st = (await (await s.send('GET', '/api/stream', reader.cookie)).json()) as StreamOut;
    expect(st.items.map((i) => i.voyage?.id)).toContain(inTeam.id);
    // Hafen: unverändert automatisch über den Heimathafen des öffentlichen Boots
    const db = await s.db();
    const harbor = await db.prepare('SELECT COUNT(*) AS n FROM activity a JOIN activity_target t ON t.activity_id = a.id WHERE a.subject_id = ? AND t.target_kind = ?').bind(inTeam.id, 'harbor').first<{ n: number }>();
    const boatHarbor = await db.prepare('SELECT harbor_id FROM boats WHERE id = ?').bind(boat.id).first<{ harbor_id: string | null }>();
    expect(harbor?.n).toBe(boatHarbor?.harbor_id ? 1 : 0);
  });

  it('[F-374] nicht öffentliche Törns erscheinen trotz Auswahl in keiner Gruppe', async () => {
    const { sailor, team } = await setup();
    const linked = await s.share(sailor, { visibility: 'unlisted', groups: [team.id] });
    expect(await selected(linked.id)).toEqual([team.id]);
    expect(await groupVoyages(team, sailor)).not.toContain(linked.id);
    expect(((await (await h.fetch(`/api/shares/${linked.id}`, { cookie: sailor.cookie })).json()) as { share: Meta }).share.groups).toEqual([]);
  });
});

// ---------------------------------------------------------------- F-375 Später ändern

describe('F-375 Auswahl später ändern', () => {
  it('[F-375] Eigentümer:in sieht groupIds (GET und PATCH), andere nie; PATCH ersetzt die Auswahl samt Stream-Zielen von Törn und Fotos', async () => {
    const { sailor, club, team, boat } = await setup();
    const share = await s.share(sailor, { boatId: boat.id });
    const own = ((await (await h.fetch(`/api/shares/${share.id}`, { cookie: sailor.cookie })).json()) as { share: Meta }).share;
    expect(own.groupIds).toEqual([club.id]);
    const guest = ((await (await h.fetch(`/api/shares/${share.id}`)).json()) as { share: Meta }).share;
    expect(guest.groupIds).toBeUndefined();
    // Foto-Bündel wie recordPhotos (mit dem Ziel des Vereins)
    const db = await s.db();
    const now = Date.now();
    await db.prepare(`INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, data, bucket, created_at, updated_at) VALUES (?, 'photos', ?, 'share', ?, '{"count":1}', ?, ?, ?)`)
      .bind(`PH${share.id}`.slice(0, 20), sailor.user.id, share.id, `photos:${share.id}:x`, now, now).run();
    await db.prepare(`INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) VALUES (?, 'group', ?, ?)`).bind(`PH${share.id}`.slice(0, 20), club.id, now).run();

    const res = await patch(sailor, share.id, { groupIds: [team.id] });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = ((await res.json()) as { share: Meta }).share;
    expect(body.groupIds).toEqual([team.id]);
    expect(body.groups.map((g) => g.name)).toEqual(['Mittwochsregatta']);
    expect(await groupTargets(share.id)).toEqual([
      { kind: 'photos', target_id: team.id },
      { kind: 'voyage', target_id: team.id },
    ]);
    // Zeit der Aktivität: der Törn springt nicht nach oben
    const t = await db.prepare(`SELECT t.created_at, a.created_at AS a_at FROM activity a JOIN activity_target t ON t.activity_id = a.id WHERE a.subject_id = ? AND a.kind = 'voyage' AND t.target_kind = 'group'`).bind(share.id).first<{ created_at: number; a_at: number }>();
    expect(t?.created_at).toBe(t?.a_at);
    expect(await groupVoyages(club)).not.toContain(share.id);
    expect(await groupVoyages(team)).toContain(share.id);

    expect((await patch(sailor, share.id, { groupIds: [] })).status).toBe(200);
    expect(await selected(share.id)).toEqual([]);
    expect(await groupTargets(share.id)).toEqual([]);
    // Boot wechseln ändert die Auswahl nicht
    expect((await patch(sailor, share.id, { boatId: null })).status).toBe(200);
    expect((await patch(sailor, share.id, { boatId: boat.id })).status).toBe(200);
    expect(await selected(share.id)).toEqual([]);
  });

  it('[F-375] erst später öffentlich: die Auswahl gilt ab dem Veröffentlichen', async () => {
    const { sailor, team } = await setup();
    const share = await s.share(sailor, { visibility: 'private', groups: [] });
    expect((await patch(sailor, share.id, { groupIds: [team.id], visibility: 'public' })).status).toBe(200);
    expect(await groupTargets(share.id)).toEqual([{ kind: 'voyage', target_id: team.id }]);
    expect(await groupVoyages(team)).toContain(share.id);
  });

  it('[F-375] fremde Gruppe 403, kaputte Liste 400, fremder Törn 404; ausgeblendete Gruppe bleibt beim Ersetzen unberührt', async () => {
    const { sailor, club, team, boat } = await setup();
    const share = await s.share(sailor, { boatId: boat.id, groups: [club.id, team.id] });
    const stranger = await s.person({ profile: 'public' });
    const foreign = await s.group(stranger, { name: 'Fremd' });
    const r403 = await patch(sailor, share.id, { groupIds: [foreign.id] });
    expect(r403.status).toBe(403);
    expect(await s.errorOf(r403)).toBe('group_forbidden');
    for (const bad of ['x', [1], ['kurz'], Array.from({ length: 51 }, (_, i) => `G${String(i).padStart(17, '0')}`)]) {
      const r = await patch(sailor, share.id, { groupIds: bad });
      expect(r.status).toBe(400);
      expect(await s.errorOf(r)).toBe('invalid_groups');
    }
    expect((await patch(stranger, share.id, { groupIds: [] })).status).toBe(404);
    expect(await selected(share.id)).toEqual(sorted(club.id, team.id));
    await (await s.db()).prepare('UPDATE groups SET hidden_at = 1 WHERE id = ?').bind(team.id).run();
    expect((await patch(sailor, share.id, { groupIds: [] })).status).toBe(200);
    expect(await selected(share.id)).toEqual([team.id]);
  });
});

// ---------------------------------------------------------------- F-376 Kennzahlen, Meilensteine, Galerie, Mail

describe('F-376 Gruppen zählen nur ausgewählte Törns', () => {
  it('[F-376] Kennzahlen und Galerie der Gruppe nur aus ausgewählten öffentlichen Törns', async () => {
    const { sailor, team } = await setup();
    const inTeam = await s.share(sailor, { distNm: 12, groups: [team.id] });
    await s.share(sailor, { distNm: 30, groups: [] });
    const db = await s.db();
    await db.prepare(`INSERT INTO photos (id, share_id, user_id, width, height, bytes, created_at) VALUES (?, ?, ?, 10, 10, 100, ?)`).bind(`F${inTeam.id}`.slice(0, 18), inTeam.id, sailor.user.id, Date.now()).run();
    const page = async () => (await (await h.fetch(`/api/groups/${team.id}`, { cookie: sailor.cookie })).json()) as { stats: { voyages: number; distNm: number; seasonNm: number }; photos: Array<{ shareId: string }> };
    const p1 = await page();
    expect(p1.stats).toMatchObject({ voyages: 1, distNm: 12 });
    expect(p1.photos.map((p) => p.shareId)).toEqual([inTeam.id]);
    await patch(sailor, inTeam.id, { groupIds: [] });
    const p2 = await page();
    expect(p2.stats).toMatchObject({ voyages: 0, distNm: 0, seasonNm: 0 });
    expect(p2.photos).toEqual([]);
  });

  it('[F-376] Meilenstein der Gruppe zählt nur ausgewählte Törns', async () => {
    const { sailor, team } = await setup();
    await s.share(sailor, { distNm: 90, groups: [] });
    await s.share(sailor, { distNm: 20, groups: [team.id] });
    const db = await s.db();
    const ms = async () => (await db.prepare(`SELECT COUNT(*) AS n FROM activity WHERE kind = 'milestone' AND subject_kind = 'group' AND subject_id = ?`).bind(team.id).first<{ n: number }>())?.n;
    expect(await ms()).toBe(0);
    await s.share(sailor, { distNm: 85, groups: [team.id] });
    expect(await ms()).toBe(1);
  });

  it('[F-376] Wochenmail zählt nur Törns, die in der Gruppe gezeigt werden', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { name: 'Digest Auswahl' });
    const reader = await s.person();
    await s.join(owner, g, reader);
    await s.send('PATCH', '/api/me/settings', reader.cookie, { notifyGroups: 'weekly' });
    await s.share(owner, { title: 'gezeigt', groups: [g.id] });
    await s.share(owner, { title: 'nicht gezeigt', groups: [] });
    await (await s.db()).prepare('UPDATE users SET groups_mailed_at = ? WHERE id = ?').bind(Date.now() - 8 * 86_400_000, reader.user.id).run();
    const before = h.logs.length;
    await h.scheduled();
    const mails = h.logs.slice(before).filter((l) => l.includes(`an ${reader.email}:`));
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain('Digest Auswahl: 1 neuer Törn');
  });
});

// ---------------------------------------------------------------- F-377 Löschpfade

describe('F-377 Auswahl verschwindet mit Törn, Gruppe, Mitgliedschaft und Konto', () => {
  const count = async (sql: string, ...args: unknown[]) => (await (await s.db()).prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;

  it('[F-377] Austreten bzw. Entfernen nimmt die eigenen Törns aus der Gruppe (Zeilen und Stream-Ziele); andere bleiben', async () => {
    const owner = await s.person({ profile: 'public' });
    const g = await s.group(owner, { name: 'Austritt' });
    const a = await s.person();
    const b = await s.person();
    await s.join(owner, g, a);
    await s.join(owner, g, b);
    const sa = await s.share(a, { groups: [g.id] });
    const sb = await s.share(b, { groups: [g.id] });
    const so = await s.share(owner, { groups: [g.id] });
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/me`, a.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/groups/${g.id}/members/${b.user.id}`, owner.cookie)).status).toBe(204);
    expect(await selected(sa.id)).toEqual([]);
    expect(await selected(sb.id)).toEqual([]);
    expect(await groupTargets(sa.id)).toEqual([]);
    expect(await groupTargets(sb.id)).toEqual([]);
    expect(await selected(so.id)).toEqual([g.id]);
    const ids = await groupVoyages(g);
    expect(ids).toContain(so.id);
    expect(ids).not.toContain(sa.id);
  });

  it('[F-377] Gruppe löschen, Törn löschen, Törn abgelaufen, Konto löschen: keine Zeilen bleiben', async () => {
    const sailor = await s.person({ profile: 'public' });
    const g1 = await s.group(sailor, { name: 'Wird gelöscht' });
    const helper = await s.person({ supporter: true });
    const g2 = await s.group(helper, { name: 'Bleibt' });
    await s.join(helper, g2, sailor);
    const deleted = await s.share(sailor, { groups: [g1.id, g2.id] });
    const expired = await s.share(sailor, { groups: [g2.id] });
    const kept = await s.share(sailor, { groups: [g1.id, g2.id] });

    expect((await s.send('DELETE', `/api/groups/${g1.id}`, sailor.cookie)).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM share_groups WHERE group_id = ?', g1.id)).toBe(0);
    expect(await selected(kept.id)).toEqual([g2.id]);

    expect((await s.send('DELETE', `/api/shares/${deleted.id}`, sailor.cookie)).status).toBe(204);
    expect(await selected(deleted.id)).toEqual([]);

    await (await s.db()).prepare('UPDATE shares SET created_at = ? WHERE id = ?').bind(Date.UTC(2020, 5, 1), expired.id).run();
    await h.scheduled();
    expect(await count('SELECT COUNT(*) AS n FROM shares WHERE id = ?', expired.id)).toBe(0);
    expect(await selected(expired.id)).toEqual([]);

    expect((await s.send('DELETE', '/api/account', sailor.cookie)).status).toBe(200);
    expect(await selected(kept.id)).toEqual([]);
    expect(await count('SELECT COUNT(*) AS n FROM share_groups WHERE group_id = ?', g2.id)).toBe(0);
  });
});
