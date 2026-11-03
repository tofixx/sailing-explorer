// Funktionale Tests: Veranstaltungen (Konzept 30, Phase 5) – Anlegen über den einen Weg (F-480, F-408), Zusage und
// atomare Kapazität (F-481, F-482), „Wer kommt?“ (F-483), Ändern und Absagen mit Meldung (F-484, F-410), Erinnerung im
// Nachtlauf (F-485), Löschwege und Frist (F-488), Cache (F-489), neue Veranstaltung als „Wichtiges“ (F-416).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { berlinDayKey, dayOfKey } from '../../src/domain/large-groups';

const H = 3_600_000;
const DAY = 24 * H;
const ADMIN_ID = 'AdminEventsAAAAAAA1';
let h: Harness;
let s: ReturnType<typeof social>;
let admin: { cookie: string };

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, 'events-admin@example.org', Date.now() - 10 * DAY).run();
  admin = await login(h, 'events-admin@example.org');
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).first<T>();
const run = async (sql: string, ...args: unknown[]) => (await s.db()).prepare(sql).bind(...args).run();
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};

interface EventOut {
  type: string;
  startsAt: number;
  endsAt: number;
  place: string;
  capacity: number | null;
  cancelled: boolean;
  counts: { yes: number; maybe: number; no: number };
  mine: string | null;
  own: boolean;
}
interface Item {
  kind: string;
  post?: { id: string; body: string; kind?: string; event?: EventOut };
}

const inDays = (d: number, hours = 2) => ({ startsAt: Date.now() + d * DAY, endsAt: Date.now() + d * DAY + hours * H });

/** Veranstaltung über den Plus-Knopf (F-480): der Text ist der Titel, die Beschreibung kommt mit dem Termin. */
async function createEvent(p: Person, channel: { kind: string; id?: string }, ev: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, status = 201) {
  const { title = 'Ansegeln', ...rest } = ev;
  const res = await s.send('POST', '/api/posts', p.cookie, {
    channel: { id: '', ...channel },
    kind: 'event',
    body: title,
    visibility: 'public',
    event: { type: 'sail', place: 'Steg B', description: 'Kuchen mitbringen', ...inDays(3), ...rest },
    ...extra,
  });
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 201 ? ((await res.json()) as { post: { id: string } }).post.id : (((await res.json()) as { error: string }).error as string);
}

const rsvp = (p: Person | undefined, id: string, status: string) => s.send('PUT', `/api/posts/${id}/rsvp`, p?.cookie, { status });
const card = async (p: Person | undefined, id: string) => (await ok<{ item: Item }>(await s.send('GET', `/api/posts/${id}`, p?.cookie))).item.post!;
const bell = async (p: Person) => (await ok<{ items: Array<{ kind: string; text: string; href: string }> }>(await s.send('GET', '/api/notifications', p.cookie))).items;

async function clubWith(...members: Person[]) {
  const owner = await s.person({ profile: 'public' });
  const club = await s.group(owner, { name: s.uniq('Verein') });
  for (const m of members) await s.join(owner, club, m);
  return { owner, club };
}

describe('F-480 F-408 Anlegen und Karte', () => {
  it('[F-480] [F-408] Veranstaltung im Verein: Karte mit Termin, Ort, Zählern; Titel in der ersten Zeile; Link-Felder entfallen', async () => {
    const { owner, club } = await clubWith();
    const id = await createEvent(owner, { kind: 'group', id: club.id }, { capacity: 20 }, { link: 'https://example.org', shareId: 'egal' });
    const row = await one<{ kind: string; body: string; link: string | null }>('SELECT kind, body, link FROM posts WHERE id = ?', id);
    expect(row).toEqual({ kind: 'event', body: 'Ansegeln\nKuchen mitbringen', link: null });
    const p = await card(owner, id);
    expect(p.kind).toBe('event');
    expect(p.event).toMatchObject({ type: 'sail', place: 'Steg B', capacity: 20, cancelled: false, counts: { yes: 0, maybe: 0, no: 0 }, mine: null, own: true });
    // im Gruppen-Stream (für Gäste) dieselbe Karte, ohne eigene Zusage und ohne „own“
    const st = await ok<{ items: Item[] }>(await s.send('GET', `/api/groups/${club.id}/stream`, undefined));
    expect(st.items.find((i) => i.post?.id === id)?.post?.event).toMatchObject({ capacity: 20, mine: null, own: false });
  });

  it('[F-480] Fehler: ohne Titel, Ende vor Beginn, vorbei, über 14 Tage, Kapazität außerhalb → 400 invalid_event; unbekannte Art 400; ohne Schreibrecht 403', async () => {
    const { owner, club } = await clubWith();
    const g = { kind: 'group', id: club.id };
    expect(await createEvent(owner, g, { title: '' }, {}, 400)).toBe('empty');
    expect(await createEvent(owner, g, { title: 'x'.repeat(121) }, {}, 400)).toBe('too_long');
    expect(await createEvent(owner, g, { startsAt: Date.now() + DAY, endsAt: Date.now() + DAY - H }, {}, 400)).toBe('invalid_event');
    expect(await createEvent(owner, g, { startsAt: Date.now() - 3 * H, endsAt: Date.now() - H }, {}, 400)).toBe('invalid_event');
    expect(await createEvent(owner, g, { ...inDays(1, 15 * 24) }, {}, 400)).toBe('invalid_event');
    expect(await createEvent(owner, g, { capacity: 501 }, {}, 400)).toBe('invalid_event');
    expect(await createEvent(owner, g, {}, { kind: 'mond' }, 400)).toBe('invalid_kind');
    expect(await createEvent(owner, g, {}, { kind: 'voyage' }, 400)).toBe('invalid_kind');
    // im Profil geht es auch – die Profilseite verlinkt die Karte (`hasKindCard`)
    expect(await createEvent(owner, { kind: 'user' })).toBeTypeOf('string');
    const member = await s.person({ profile: 'public' });
    await s.join(owner, club, member);
    expect(await createEvent(member, g, {}, {}, 403)).toBeTypeOf('string');
    expect(await one('SELECT COUNT(*) AS n FROM post_events e JOIN posts p ON p.id = e.post_id WHERE p.group_id = ?', club.id)).toEqual({ n: 0 });
  });

  it('[F-416] neue Veranstaltung benachrichtigt Mitglieder schon ab „Wichtiges“ (Standard) – ein Text-Beitrag nicht', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const text = await s.send('POST', '/api/posts', owner.cookie, { channel: { kind: 'group', id: club.id }, body: 'Nur Text', visibility: 'public' });
    expect(text.status).toBe(201);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    const items = await bell(m);
    const posts = items.filter((n) => n.kind === 'post');
    expect(posts.map((n) => n.href)).toEqual([`/p/${id}`]);
    expect(posts[0].text).toMatch(/lädt in „.+“ ein: neue Veranstaltung$/);
  });
});

describe('F-481 F-482 Zusage und Kapazität', () => {
  it('[F-481] zusagen, ändern; Gäste 401; unbekannte Zusage 400; „Nur Mitglieder“ für Fremde 404', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    expect((await rsvp(undefined, id, 'yes')).status).toBe(401);
    expect((await rsvp(m, id, 'vielleicht')).status).toBe(400);
    expect((await ok<{ event: EventOut }>(await rsvp(m, id, 'yes'))).event).toMatchObject({ counts: { yes: 1, maybe: 0, no: 0 }, mine: 'yes' });
    expect((await ok<{ event: EventOut }>(await rsvp(m, id, 'maybe'))).event).toMatchObject({ counts: { yes: 0, maybe: 1, no: 0 }, mine: 'maybe' });
    const secret = await createEvent(owner, { kind: 'group', id: club.id }, {}, { visibility: 'members' });
    const stranger = await s.person({ profile: 'public' });
    expect((await rsvp(stranger, secret, 'yes')).status).toBe(404);
    expect((await rsvp(m, secret, 'yes')).status).toBe(200);
    // ein Text-Beitrag ist keine Veranstaltung
    const text = await ok<{ post: { id: string } }>(await s.send('POST', '/api/posts', owner.cookie, { channel: { kind: 'group', id: club.id }, body: 'x', visibility: 'public' }), 201);
    expect((await rsvp(m, text.post.id, 'yes')).status).toBe(404);
  });

  it('[F-481] Tagesgrenze gemeinsam mit Reaktionen und Stimmen: jede Änderung zählt (reaction_log), voll → 429', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    const count = async () => (await one<{ n: number }>('SELECT COUNT(*) AS n FROM reaction_log WHERE user_id = ?', m.user.id))!.n;
    await rsvp(m, id, 'yes');
    await rsvp(m, id, 'maybe');
    expect(await count()).toBe(2);
    const ids = `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 299)`;
    await run(`${ids} INSERT INTO reaction_log (user_id, created_at) SELECT ?1, ?2 FROM n`, m.user.id, Date.now() - H);
    expect(await s.errorOf(await rsvp(m, id, 'no'))).toBe('reaction_quota');
    expect(await one('SELECT status FROM event_rsvps WHERE post_id = ? AND user_id = ?', id, m.user.id)).toEqual({ status: 'maybe' });
  });

  it('[F-481] abgelehnte Zusage (voll, abgesagt) zählt nicht in die Tagesgrenze', async () => {
    const [a, b] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(a, b);
    const id = await createEvent(owner, { kind: 'group', id: club.id }, { capacity: 1 });
    await rsvp(a, id, 'yes');
    expect(await s.errorOf(await rsvp(b, id, 'yes'))).toBe('event_full');
    expect(await one('SELECT COUNT(*) AS n FROM reaction_log WHERE user_id = ?', b.user.id)).toEqual({ n: 0 });
  });

  it('[F-489] gesperrte Konten zählen weder in den Zählern noch für die Kapazität', async () => {
    const [a, b, c] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(a, b, c);
    const id = await createEvent(owner, { kind: 'group', id: club.id }, { capacity: 1 });
    await rsvp(a, id, 'yes');
    await rsvp(c, id, 'maybe');
    expect(await s.errorOf(await rsvp(b, id, 'yes'))).toBe('event_full');
    await run('UPDATE users SET suspended_at = ? WHERE id IN (?, ?)', Date.now(), a.user.id, c.user.id);
    expect((await card(owner, id)).event?.counts).toEqual({ yes: 0, maybe: 0, no: 0 });
    expect((await rsvp(b, id, 'yes')).status).toBe(200);
  });

  it('[F-482] verkleinerte Kapazität nimmt niemandem den Platz; erneutes „Nehme teil“ bleibt möglich, Neue warten', async () => {
    const [a, b, c] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(a, b, c);
    const id = await createEvent(owner, { kind: 'group', id: club.id }, { capacity: 3 });
    for (const p of [a, b]) expect((await rsvp(p, id, 'yes')).status).toBe(200);
    const ev = (await card(owner, id)).event!;
    expect((await s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, { type: ev.type, startsAt: ev.startsAt, endsAt: ev.endsAt, place: ev.place, capacity: 1 })).status).toBe(200);
    expect(await one('SELECT COUNT(*) AS n FROM event_rsvps WHERE post_id = ? AND status = ?', id, 'yes')).toEqual({ n: 2 });
    expect((await rsvp(a, id, 'yes')).status).toBe(200);
    expect(await s.errorOf(await rsvp(c, id, 'yes'))).toBe('event_full');
  });

  it('[F-482] Kapazität: voll → 409 event_full, „Vielleicht“ geht; gleichzeitige Zusagen um den letzten Platz ergeben genau eine', async () => {
    const [a, b, c] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(a, b, c);
    const id = await createEvent(owner, { kind: 'group', id: club.id }, { capacity: 1 });
    expect((await rsvp(a, id, 'yes')).status).toBe(200);
    expect(await s.errorOf(await rsvp(b, id, 'yes'))).toBe('event_full');
    expect((await ok<{ event: EventOut }>(await rsvp(b, id, 'maybe'))).event.counts).toEqual({ yes: 1, maybe: 1, no: 0 });
    // die eigene Zusage hält ihren Platz (erneut „Nehme teil“ geht)
    expect((await rsvp(a, id, 'yes')).status).toBe(200);
    expect((await rsvp(a, id, 'no')).status).toBe(200);
    // zwei gleichzeitig um den frei gewordenen Platz
    const results = await Promise.all([rsvp(b, id, 'yes'), rsvp(c, id, 'yes')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await one('SELECT COUNT(*) AS n FROM event_rsvps WHERE post_id = ? AND status = ?', id, 'yes')).toEqual({ n: 1 });
  });

  it('[F-481] abgesagt bzw. vorbei: 409', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    await run('UPDATE post_events SET ends_at = ?, starts_at = ? WHERE post_id = ?', Date.now() - H, Date.now() - 2 * H, id);
    expect(await s.errorOf(await rsvp(m, id, 'yes'))).toBe('event_over');
    const id2 = await createEvent(owner, { kind: 'group', id: club.id });
    expect((await s.send('PATCH', `/api/posts/${id2}/event`, owner.cookie, { cancel: true })).status).toBe(200);
    expect(await s.errorOf(await rsvp(m, id2, 'maybe'))).toBe('event_cancelled');
  });
});

describe('F-483 Wer kommt?', () => {
  it('[F-483] Namen öffentlicher Profile, der Rest als Anzahl; Autor:in sieht alle Anzeigenamen und auch Absagen; gesperrte nie', async () => {
    const pub = await s.person({ profile: 'public' });
    const priv = await s.person({ profile: 'private' });
    const susp = await s.person({ profile: 'public' });
    const no = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(pub, priv, susp, no);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    for (const p of [pub, priv, susp]) expect((await rsvp(p, id, 'yes')).status).toBe(200);
    expect((await rsvp(no, id, 'no')).status).toBe(200);
    await run('UPDATE users SET suspended_at = ? WHERE id = ?', Date.now(), susp.user.id);
    type Who = { people: Record<string, Array<{ displayName: string; handle: string | null }>>; others: Record<string, number>; all: boolean };
    const guest = await ok<Who>(await s.send('GET', `/api/posts/${id}/rsvps`, undefined));
    expect(guest.all).toBe(false);
    expect(guest.people.yes).toEqual([{ displayName: `Name ${pub.handle}`, handle: pub.handle }]);
    expect(guest.others.yes).toBe(1);
    // Absagen nennen Fremden keine Namen, nur die Anzahl
    expect(guest.people.no).toEqual([]);
    expect(guest.others.no).toBe(1);
    const mine = await ok<Who>(await s.send('GET', `/api/posts/${id}/rsvps`, owner.cookie));
    expect(mine.all).toBe(true);
    expect(mine.people.yes.map((p) => p.displayName).sort()).toEqual([`Name ${priv.handle}`, `Name ${pub.handle}`].sort());
    // privates Profil: Name ja, Link nein
    expect(mine.people.yes.find((p) => p.displayName === `Name ${priv.handle}`)?.handle).toBeNull();
    expect(mine.people.no).toEqual([{ displayName: `Name ${no.handle}`, handle: no.handle }]);
    expect(JSON.stringify(mine)).not.toContain(pub.user.id);
  });
});

describe('F-484 F-410 Ändern und Absagen', () => {
  it('[F-484] [F-410] nur die Autor:in; Zeit geändert → Meldung an „Nehme teil“/„Vielleicht“, neue Erinnerung; Absage → Meldung, Karte bleibt', async () => {
    const [yes, maybe, no] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(yes, maybe, no);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    await rsvp(yes, id, 'yes');
    await rsvp(maybe, id, 'maybe');
    await rsvp(no, id, 'no');
    const ev = { type: 'sail', place: 'Steg B', ...inDays(5), capacity: null };
    expect((await s.send('PATCH', `/api/posts/${id}/event`, yes.cookie, ev)).status).toBe(404);
    expect((await s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, { ...ev, endsAt: ev.startsAt })).status).toBe(400);
    // nur die Kapazität: keine Meldung
    expect((await s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, { ...(await card(owner, id)).event!, capacity: 10 })).status).toBe(200);
    expect((await bell(yes)).filter((n) => n.kind === 'event')).toEqual([]);
    await run('UPDATE post_events SET reminded_at = ? WHERE post_id = ?', Date.now(), id);
    const out = await ok<{ event: EventOut }>(await s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, ev));
    expect(out.event).toMatchObject({ startsAt: ev.startsAt, type: 'sail' });
    expect(await one('SELECT reminded_at FROM post_events WHERE post_id = ?', id)).toEqual({ reminded_at: null });
    for (const p of [yes, maybe]) expect((await bell(p)).find((n) => n.kind === 'event')?.text).toMatch(/„Ansegeln“: Zeit oder Ort wurden geändert/);
    expect((await bell(no)).filter((n) => n.kind === 'event')).toEqual([]);
    expect((await ok<{ event: EventOut }>(await s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, { cancel: true }))).event.cancelled).toBe(true);
    expect((await bell(yes)).find((n) => n.kind === 'event')?.text).toMatch(/abgesagt/);
    expect((await card(yes, id)).event?.cancelled).toBe(true);
    expect((await s.send('PATCH', `/api/posts/${id}/event`, owner.cookie, ev)).status).toBe(409);
  });

  it('[F-416] Zusage meldet `rsvp` gebündelt an die Autor:in (nur Glocke), solange die Person noch nicht zugesagt hatte', async () => {
    const [a, b] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(a, b);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    await rsvp(a, id, 'yes');
    await rsvp(a, id, 'maybe');
    await rsvp(b, id, 'yes');
    // erst „Nehme nicht teil“: kein Hinweis; danach „Nehme teil“: jetzt ja (bisher kein Hinweis zu dieser Person)
    const c = await s.person({ profile: 'public' });
    await s.join(owner, club, c);
    await rsvp(c, id, 'no');
    expect((await bell(owner)).find((x) => x.kind === 'rsvp')?.text).toMatch(/und 1 weitere Person haben/);
    await rsvp(c, id, 'yes');
    const n = (await bell(owner)).filter((x) => x.kind === 'rsvp');
    expect(n).toHaveLength(1);
    expect(n[0].text).toMatch(/und 2 weitere haben auf „Ansegeln“ geantwortet/);
    expect(n[0].href).toBe(`/p/${id}`);
  });
});

describe('F-485 Erinnerung im Nachtlauf', () => {
  it('[F-485] [F-410] einmal je Termin an „Nehme teil“/„Vielleicht“ – auch in stummer Gruppe; nicht für später, abgesagt oder nach „Nehme nicht teil“', async () => {
    const [yes, maybe, muted] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(yes, maybe, muted);
    expect((await s.send('PUT', `/api/notify/group/${club.id}`, muted.cookie, { level: 'muted' })).status).toBe(200);
    const soon = await createEvent(owner, { kind: 'group', id: club.id }, { title: 'Bald', startsAt: Date.now() + 10 * H, endsAt: Date.now() + 12 * H });
    const later = await createEvent(owner, { kind: 'group', id: club.id }, { title: 'Später', startsAt: Date.now() + 48 * H, endsAt: Date.now() + 50 * H });
    const off = await createEvent(owner, { kind: 'group', id: club.id }, { title: 'Abgesagt', startsAt: Date.now() + 5 * H, endsAt: Date.now() + 6 * H });
    for (const id of [soon, later, off]) {
      await rsvp(yes, id, 'yes');
      await rsvp(maybe, id, 'maybe');
      await rsvp(muted, id, 'yes');
    }
    await s.send('PATCH', `/api/posts/${off}/event`, owner.cookie, { cancel: true });
    await run(`DELETE FROM notifications WHERE kind = 'event'`);
    expect((await h.scheduled()).outcome).toBe('ok');
    expect((await h.scheduled()).outcome).toBe('ok');
    for (const p of [yes, maybe, muted]) {
      const ev = (await bell(p)).filter((n) => n.kind === 'event');
      expect(ev.map((n) => n.href), p.email).toEqual([`/p/${soon}`]);
      expect(ev[0].text).toMatch(/„Bald“: Erinnerung/);
    }
    expect(await one('SELECT COUNT(*) AS n FROM notifications WHERE kind = ? AND subject_id = ?', 'event', soon)).toEqual({ n: 3 });
    expect(await one('SELECT reminded_at IS NOT NULL AS r FROM post_events WHERE post_id = ?', later)).toEqual({ r: 0 });
    // ohne eigene Zusage erscheint die Erinnerung nicht mehr
    await rsvp(maybe, soon, 'no');
    expect((await bell(maybe)).filter((n) => n.kind === 'event')).toEqual([]);
  });

  it('[F-485] Sammelmail nur für „Veranstaltungen: Mail“ – im selben Nachtlauf, ohne eigene Mail', async () => {
    const m = await s.person({ profile: 'public' });
    const quiet = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m, quiet);
    expect((await s.send('PATCH', '/api/me/settings', m.cookie, { notify: { event: 'mail' } })).status).toBe(200);
    await run('UPDATE users SET comments_mailed_at = ? WHERE id IN (?, ?)', Date.now() - DAY, m.user.id, quiet.user.id);
    const id = await createEvent(owner, { kind: 'group', id: club.id }, { title: 'Mailtest', startsAt: Date.now() + 8 * H, endsAt: Date.now() + 9 * H });
    await rsvp(m, id, 'yes');
    await rsvp(quiet, id, 'yes');
    const before = h.logs.length;
    expect((await h.scheduled()).outcome).toBe('ok');
    const mails = h.logs.slice(before).filter((l) => l.includes('[mail:log]'));
    // ohne Titel, nur mit dem Verlauf (Konzept 30.3)
    const mine = mails.filter((l) => l.includes(m.email)).join('\n');
    expect(mine).toMatch(/Veranstaltung in „Verein-[^“]+“: Erinnerung/);
    expect(mine).not.toContain('Mailtest');
    expect(mails.filter((l) => l.includes(quiet.email))).toEqual([]);
  });
});

describe('F-488 Löschwege und Frist', () => {
  const rows = async (id: string) => ({
    post: (await one<{ n: number }>('SELECT COUNT(*) AS n FROM posts WHERE id = ?', id))!.n,
    event: (await one<{ n: number }>('SELECT COUNT(*) AS n FROM post_events WHERE post_id = ?', id))!.n,
    rsvps: (await one<{ n: number }>('SELECT COUNT(*) AS n FROM event_rsvps WHERE post_id = ?', id))!.n,
    notes: (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE subject_kind = 'post' AND subject_id = ?`, id))!.n,
  });

  it('[F-488] einzeln gelöscht: Termin, Zusagen und Benachrichtigungen fallen mit', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    await rsvp(m, id, 'yes');
    expect((await rows(id)).rsvps).toBe(1);
    expect((await s.send('DELETE', `/api/posts/${id}`, owner.cookie)).status).toBe(204);
    expect(await rows(id)).toEqual({ post: 0, event: 0, rsvps: 0, notes: 0 });
  });

  it('[F-488] Gruppe gelöscht und Konto der Autor:in (Veranstaltung am eigenen Boot) gelöscht: Termin und Zusagen fallen mit', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const inGroup = await createEvent(owner, { kind: 'group', id: club.id });
    await rsvp(m, inGroup, 'yes');
    expect((await s.send('DELETE', `/api/groups/${club.id}`, owner.cookie)).status).toBe(204);
    expect(await rows(inGroup)).toEqual({ post: 0, event: 0, rsvps: 0, notes: 0 });
    const author = await s.person({ profile: 'public' });
    const boat = await s.boat(author);
    const own = await createEvent(author, { kind: 'boat', id: boat.id });
    await rsvp(m, own, 'maybe');
    expect((await s.send('DELETE', '/api/account', author.cookie)).status).toBe(200);
    expect(await rows(own)).toEqual({ post: 0, event: 0, rsvps: 0, notes: 0 });
  });

  it('[F-488] Konto der Zusagenden gelöscht: nur ihre Zusage fällt; Konten zusammengeführt: Zusagen wandern, die des Ziels gewinnen', async () => {
    const [gone, from, into] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(gone, from, into);
    const a = await createEvent(owner, { kind: 'group', id: club.id });
    const b = await createEvent(owner, { kind: 'group', id: club.id });
    await rsvp(gone, a, 'yes');
    expect((await s.send('DELETE', '/api/account', gone.cookie)).status).toBe(200);
    expect(await rows(a)).toMatchObject({ post: 1, event: 1, rsvps: 0 });
    await rsvp(from, a, 'yes');
    await rsvp(from, b, 'maybe');
    await rsvp(into, b, 'no');
    expect((await s.send('POST', `/api/admin/users/${from.user.id}/merge`, admin.cookie, { into: into.user.id, confirm: from.user.id })).status).toBe(200);
    expect(await one('SELECT status FROM event_rsvps WHERE post_id = ? AND user_id = ?', a, into.user.id)).toEqual({ status: 'yes' });
    expect(await one('SELECT status FROM event_rsvps WHERE post_id = ? AND user_id = ?', b, into.user.id)).toEqual({ status: 'no' });
    expect(await one('SELECT COUNT(*) AS n FROM event_rsvps WHERE user_id = ?', from.user.id)).toEqual({ n: 0 });
  });

  it('[F-488] Moderation: gemeldet und gelöscht über removePost', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    await rsvp(m, id, 'yes');
    const rep = await s.send('POST', '/api/reports', m.cookie, { kind: 'post', id, reason: 'spam' });
    expect(rep.status, await rep.clone().text()).toBe(201);
    const { id: reportId } = (await one<{ id: string }>(`SELECT id FROM reports WHERE target_kind = 'post' AND target_id = ?`, id))!;
    expect((await s.send('POST', `/api/admin/reports/${reportId}`, admin.cookie, { action: 'delete' })).status).toBe(200);
    expect(await rows(id)).toEqual({ post: 0, event: 0, rsvps: 0, notes: 0 });
  });

  it('[F-488] Frist: 12 Monate nach dem Ende löscht der Nachtlauf; jüngere und gesperrte Gruppen bleiben', async () => {
    const m = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith(m);
    const old = await createEvent(owner, { kind: 'group', id: club.id });
    const young = await createEvent(owner, { kind: 'group', id: club.id });
    await rsvp(m, old, 'yes');
    await run('UPDATE post_events SET starts_at = ?, ends_at = ? WHERE post_id = ?', Date.now() - 400 * DAY, Date.now() - 399 * DAY, old);
    await run('UPDATE post_events SET starts_at = ?, ends_at = ? WHERE post_id = ?', Date.now() - 200 * DAY, Date.now() - 199 * DAY, young);
    const locked = await clubWith();
    const kept = await createEvent(locked.owner, { kind: 'group', id: locked.club.id });
    await run('UPDATE post_events SET starts_at = ?, ends_at = ? WHERE post_id = ?', Date.now() - 400 * DAY, Date.now() - 399 * DAY, kept);
    await run('UPDATE groups SET locked_at = ? WHERE id = ?', Date.now(), locked.club.id);
    expect((await h.scheduled()).outcome).toBe('ok');
    expect(await rows(old)).toEqual({ post: 0, event: 0, rsvps: 0, notes: 0 });
    expect((await rows(young)).event).toBe(1);
    expect((await rows(kept)).event).toBe(1);
  });
});

describe('F-489 Cache', () => {
  it('[F-489] eigene Zusage nie im öffentlichen Cache: Gast sieht keine, auch nicht nach dem Abruf eines Mitglieds', async () => {
    const fan = await s.person({ profile: 'public' });
    const { owner, club } = await clubWith();
    const id = await createEvent(owner, { kind: 'group', id: club.id });
    const path = `/api/groups/${club.id}/stream`;
    const ev = async (p?: Person) => {
      const res = await s.send('GET', path, p?.cookie);
      const body = (await res.json()) as { items: Item[] };
      return { cache: res.headers.get('X-Stream-Cache'), cc: res.headers.get('Cache-Control'), event: body.items.find((i) => i.post?.id === id)?.post?.event };
    };
    expect((await ev()).event?.mine).toBeNull();
    // Nicht-Mitglied mit Zusage liest denselben gecachten Stand – mit eigener Zusage, privat ausgeliefert
    await rsvp(fan, id, 'yes');
    const f = await ev(fan);
    expect(f.cache).toBe('hit');
    expect(f.cc).toBe('private, no-store');
    expect(f.event).toMatchObject({ mine: 'yes', counts: { yes: 1 } });
    const g = await ev();
    expect(g.cache).toBe('hit');
    // Zähler stehen wie Reaktionen im 60-s-Cache (für alle gleich), die eigene Zusage nie
    expect(g.event).toMatchObject({ mine: null, own: false });
  });
});

describe('F-485 Glocke je Verlauf, „Nur mit Link“, Ändern nur mit Schreibrecht', () => {
  it('[F-485] Erinnerung auch in Hafen, Boot und Profil; „Nur mit Link“ mit Schlüssel im Ziel', async () => {
    const author = await loginEventSupporter();
    const fan = await s.person({ profile: 'public' });
    const hb = ((await (await s.send('POST', '/api/harbors', author.cookie, { name: s.uniq('Eventhafen'), lat: -40, lon: -160 })).json()) as { harbor: { id: string } }).harbor;
    const boat = await s.boat(author, { harborId: hb.id });
    const soon = { startsAt: Date.now() + 6 * H, endsAt: Date.now() + 7 * H };
    const ids = {
      harbor: await createEvent(author, { kind: 'harbor', id: hb.id }, { title: 'Im Hafen', ...soon }),
      boat: await createEvent(author, { kind: 'boat', id: boat.id }, { title: 'Am Boot', ...soon }),
      user: await createEvent(author, { kind: 'user' }, { title: 'Im Profil', ...soon }),
      unlisted: await createEvent(author, { kind: 'user' }, { title: 'Geheim', ...soon }, { visibility: 'unlisted' }),
    };
    const key = (await one<{ link_key: string }>('SELECT link_key FROM posts WHERE id = ?', ids.unlisted))!.link_key;
    for (const id of [ids.harbor, ids.boat, ids.user]) expect((await rsvp(fan, id, 'yes')).status).toBe(200);
    expect((await rsvp(fan, ids.unlisted, 'yes')).status).toBe(404);
    expect((await s.send('PUT', `/api/posts/${ids.unlisted}/rsvp`, fan.cookie, { status: 'yes' }, { 'X-Share-Key': key })).status).toBe(200);
    await run(`DELETE FROM notifications WHERE kind = 'event'`);
    expect((await h.scheduled()).outcome).toBe('ok');
    const hrefs = (await bell(fan)).filter((n) => n.kind === 'event').map((n) => n.href).sort();
    expect(hrefs).toEqual([`/p/${ids.harbor}`, `/p/${ids.boat}`, `/p/${ids.user}`, `/p/${ids.unlisted}/${key}`].sort());
    // Absage einer „Nur mit Link“-Veranstaltung erreicht die Zusagen ebenfalls
    expect((await s.send('PATCH', `/api/posts/${ids.unlisted}/event`, author.cookie, { cancel: true })).status).toBe(200);
    expect((await bell(fan)).find((n) => n.href === `/p/${ids.unlisted}/${key}`)?.text).toMatch(/abgesagt/);
  });

  it('[F-484] Ändern nur mit aktuellem Schreibrecht im Verlauf (nach dem Austritt 403)', async () => {
    const owner = await s.person({ profile: 'public' });
    const m = await s.person({ profile: 'public' });
    const team = await s.group(owner, { kind: 'team', name: s.uniq('Team'), harborId: null });
    await s.join(owner, team, m);
    const id = await createEvent(m, { kind: 'group', id: team.id });
    expect((await s.send('DELETE', `/api/groups/${team.id}/members/${m.user.id}`, owner.cookie)).status).toBeLessThan(300);
    expect((await s.send('PATCH', `/api/posts/${id}/event`, m.cookie, { cancel: true })).status).toBe(403);
  });

  it('[F-489] Veranstaltung an einem zusammengefassten Tag bleibt einzeln, mit eigener Zusage nach dem Cache', async () => {
    const [m, fan] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    const { owner, club } = await clubWith(m);
    const key = berlinDayKey(Date.now() - 2 * DAY);
    const t0 = dayOfKey(key)!.start + 12 * H;
    const db = await s.db();
    const cte = `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 15)`;
    const tg = `D${Date.now().toString(36)}`;
    await db.prepare(`${cte} INSERT INTO posts (id, author_id, group_id, body, created_at, kind, channel_kind, channel_id, visibility, reach, data) SELECT 'P' || ?1 || printf('%06d', i), ?2, ?3, 'Beitrag', ?4 - i * 60000, 'text', 'group', ?3, 'public', 'here', '{}' FROM n`).bind(tg, m.user.id, club.id, t0).run();
    await db.prepare(`${cte} INSERT INTO activity (id, kind, actor_id, subject_kind, subject_id, group_id, data, created_at, updated_at) SELECT 'A' || ?1 || printf('%06d', i), 'post', ?2, 'post', 'P' || ?1 || printf('%06d', i), ?3, '{}', ?4 - i * 60000, ?4 - i * 60000 FROM n`).bind(tg, m.user.id, club.id, t0).run();
    await db.prepare(`${cte} INSERT INTO activity_target (activity_id, target_kind, target_id, created_at) SELECT 'A' || ?1 || printf('%06d', i), 'group', ?2, ?3 - i * 60000 FROM n`).bind(tg, club.id, t0).run();
    // die Veranstaltung (Verein: Eigner schreibt) liegt am zusammengefassten Tag
    const ev = await createEvent(owner, { kind: 'group', id: club.id });
    await run('UPDATE posts SET created_at = ? WHERE id = ?', t0 - 30 * 60000, ev);
    await run(`UPDATE activity SET created_at = ?1, updated_at = ?1 WHERE subject_kind = 'post' AND subject_id = ?2`, t0 - 30 * 60000, ev);
    await run(`UPDATE activity_target SET created_at = ?1 WHERE activity_id IN (SELECT id FROM activity WHERE subject_kind = 'post' AND subject_id = ?2)`, t0 - 30 * 60000, ev);
    expect((await rsvp(fan, ev, 'yes')).status).toBe(200);
    const guest = (await (await s.send('GET', `/api/groups/${club.id}/stream`, undefined)).json()) as { items: Item[]; days?: Array<{ count: number }> };
    expect(guest.days?.length).toBe(1);
    expect(guest.items.find((i) => i.post?.id === ev)?.post?.event?.mine).toBeNull();
    const mine = (await (await s.send('GET', `/api/groups/${club.id}/stream`, fan.cookie)).json()) as { items: Item[] };
    expect(mine.items.find((i) => i.post?.id === ev)?.post?.event).toMatchObject({ mine: 'yes' });
  });
});

/** Unterstützer:in mit öffentlichem Profil („Nur mit Link“ braucht Unterstützung, E1). */
async function loginEventSupporter(): Promise<Person> {
  return s.person({ profile: 'public', supporter: true });
}
