// Funktionale Tests: Benachrichtigungs-Glocke (F-250 … F-255, Konzept 17) – Entstehen und Bündeln, Lesen mit Prüfung,
// Gelesen beim Öffnen (auch über Mail-Links), Kopplung an die Kommentar-Sammelmail und Aufräumen.
// Echter Worker in workerd (Miniflare) – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { NOTIFICATION_LIMITS, type NotificationItem } from '../../src/domain/notifications';

const DAY = 86_400_000;
let h: Harness;
let s: ReturnType<typeof social>;

beforeAll(async () => {
  h = await startWorker({ APP_ORIGIN: 'https://sail.example' });
  s = social(h);
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

type ListOut = { items: NotificationItem[]; unread: number };
const list = async (p: Person) => {
  const res = await s.send('GET', '/api/notifications', p.cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ListOut;
};
const unread = async (p: Person) => ((await (await s.send('GET', '/api/notifications/count', p.cookie)).json()) as { unread: number }).unread;
const read = (p: Person, body: unknown) => s.send('POST', '/api/notifications/read', p.cookie, body);
const rows = async (sql: string, ...args: unknown[]) => (await (await s.db()).prepare(sql).bind(...args).first<{ n: number }>())!.n;
const rowsOf = (p: Person) => rows('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', p.user.id);

const comment = async (p: Person, shareId: string, body = 'Schöner Törn!') => {
  const res = await s.send('POST', `/api/shares/${shareId}/comments`, p.cookie, { body });
  expect(res.status, await res.clone().text()).toBe(201);
};
const react = async (p: Person, subject: string, id: string, kind = 'like') => {
  const res = await s.send('PUT', `/api/reactions/${subject}/${id}`, p.cookie, { kind });
  expect(res.status, await res.clone().text()).toBe(200);
};
const follow = async (p: Person, kind: string, id: string) => {
  const res = await s.send('PUT', `/api/follows/${kind}/${id}`, p.cookie);
  expect(res.status, await res.clone().text()).toBe(200);
};
const post = async (admin: Person, g: { id: string }, body = 'Ansegeln am Samstag') => {
  const res = await s.send('POST', `/api/groups/${g.id}/posts`, admin.cookie, { body });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { post: { id: string } }).post;
};
const requestJoin = async (p: Person, g: { id: string }) => {
  const res = await s.send('POST', `/api/groups/${g.id}/requests`, p.cookie, { message: 'Hallo' });
  expect(res.status, await res.clone().text()).toBe(201);
};
/** Freundes-Einladung per Adresse oder Profilname; liefert den Token (Dev-Link auf localhost). */
const inviteFriend = async (from: Person, to: { email: string } | { handle: string }) => {
  const res = await s.send('POST', '/api/invites', from.cookie, to);
  expect(res.status, await res.clone().text()).toBe(201);
  const body = (await res.json()) as { invite: { id: string }; devLink?: string };
  return { id: body.invite.id, token: /#token=([A-Za-z0-9_-]+)/.exec(body.devLink ?? '')?.[1] ?? '' };
};

// ---------------------------------------------------------------- F-250 Entstehen und Bündeln

describe('F-250 Benachrichtigungen entstehen bei den Ereignissen für genau eine Person', () => {
  it('[F-250] Kommentare auf eigenem Törn: gebündelt, solange ungelesen; eigene Kommentare nicht', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner, { title: 'Rund Rügen' });
    const a = await s.person({ profile: 'public' });
    const b = await s.person({ profile: 'public' });
    await comment(owner, share.id, 'Eigener Kommentar');
    expect(await unread(owner)).toBe(0);
    await comment(a, share.id);
    await comment(b, share.id);
    const out = await list(owner);
    expect(out.unread).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ kind: 'comment', count: 2, title: 'Rund Rügen', href: `/s/${share.id}`, read: false });
    expect(out.items[0].actor?.handle).toBe(b.handle);
    expect(await rowsOf(a)).toBe(1); // als Mitkommentierende:r (Konzept 17.9.1)
    // Gelesen → der nächste Kommentar beginnt eine neue Zeile
    await read(owner, { subjectKind: 'share', subjectId: share.id });
    const c = await s.person({ profile: 'public' });
    await comment(c, share.id);
    const again = await list(owner);
    expect(again.unread).toBe(1);
    expect(again.items.map((i) => [i.count, i.read])).toEqual([[1, false], [2, true]]);
  });

  it('[F-250] Reaktionen auf Törn und Beitrag gehen an Eigentümer bzw. Autor; nie an sich selbst', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner, { title: 'Hiddensee' });
    const club = await s.group(owner, { name: 'Möwen' });
    const p = await post(owner, club);
    const fan = await s.person({ profile: 'public' });
    await react(owner, 'share', share.id);
    expect(await unread(owner)).toBe(0);
    await react(fan, 'share', share.id);
    await react(fan, 'share', share.id, 'mast'); // Art wechseln: keine neue Benachrichtigung
    await react(fan, 'post', p.id);
    const out = await list(owner);
    expect(out.items.map((i) => [i.kind, i.what, i.title]).sort()).toEqual([
      ['reaction', 'deinen Beitrag in', 'Möwen'],
      ['reaction', 'deinen Törn', 'Hiddensee'],
    ]);
    expect(out.items.find((i) => i.title === 'Hiddensee')?.count).toBe(1);
  });

  it('[F-250] neue Follower eines Profils gebündelt; Boote und Gruppen folgen benachrichtigt niemanden', async () => {
    const star = await s.person({ profile: 'public' });
    const boat = await s.boat(star);
    const a = await s.person({ profile: 'public' });
    const b = await s.person({ profile: 'private' });
    await follow(a, 'user', star.handle!);
    await follow(a, 'user', star.handle!); // schon gefolgt → nichts Neues
    // Entfolgen und gleich wieder folgen zählt nicht doppelt
    expect((await s.send('DELETE', `/api/follows/user/${star.handle}`, a.cookie)).status).toBe(200);
    await follow(a, 'user', star.handle!);
    await follow(b, 'user', star.handle!);
    await follow(a, 'boat', boat.id);
    const out = await list(star);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ kind: 'follow', count: 2, actor: null }); // b hat kein öffentliches Profil
  });

  it('[F-250] Einladungen an bestehende Konten (Profilname, Adresse); an unbekannte Adressen keine Zeile', async () => {
    const from = await s.person({ profile: 'public' });
    const byHandle = await s.person({ profile: 'public' });
    const byMail = await s.person();
    await inviteFriend(from, { handle: byHandle.handle! });
    await inviteFriend(from, { email: byMail.email });
    const before = await rows('SELECT COUNT(*) AS n FROM notifications');
    await inviteFriend(from, { email: s.email('neu') });
    expect(await rows('SELECT COUNT(*) AS n FROM notifications')).toBe(before);
    for (const p of [byHandle, byMail]) {
      const [item] = (await list(p)).items;
      expect(item).toMatchObject({ kind: 'invite', what: 'zum gegenseitigen Folgen', href: '/?konto=einladungen' });
    }
  });

  it('[F-250] Beitrittsanfragen an Eigner und Admins, nicht an einfache Mitglieder; „Nur der Eigner“ nur an ihn', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const adm = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: 'Wannsee-Club', approveBy: 'members' });
    await s.join(owner, club, adm);
    await s.join(owner, club, member);
    expect((await s.send('PATCH', `/api/groups/${club.id}/members/${adm.user.id}`, owner.cookie, { role: 'admin' })).status).toBe(200);
    const asker = await s.person({ profile: 'public' });
    await requestJoin(asker, club);
    for (const p of [owner, adm]) {
      const [item] = (await list(p)).items.filter((i) => i.kind === 'request');
      expect(item).toMatchObject({ title: 'Wannsee-Club', href: `/g/${club.slug}` });
      expect(item.actor?.handle).toBe(asker.handle);
    }
    expect((await list(member)).items.filter((i) => i.kind === 'request')).toHaveLength(0);

    // entschieden (von irgendwem) → keine offene Anfrage mehr → verschwindet auch bei den anderen
    expect((await s.send('POST', `/api/groups/${club.id}/requests/${asker.user.id}`, adm.cookie, { approve: false })).status).toBe(200);
    expect((await list(owner)).items.filter((i) => i.kind === 'request')).toHaveLength(0);

    const strict = await s.group(owner, { name: 'Strenger Club', approveBy: 'owner' });
    await s.join(owner, strict, adm);
    await s.send('PATCH', `/api/groups/${strict.id}/members/${adm.user.id}`, owner.cookie, { role: 'admin' });
    await requestJoin(await s.person(), strict);
    expect((await list(owner)).items.some((i) => i.title === 'Strenger Club')).toBe(true);
    expect((await list(adm)).items.some((i) => i.title === 'Strenger Club')).toBe(false);
  });
});

describe('F-250 Kommentare benachrichtigen auch Mitkommentierende (Konzept 17.9.1)', () => {
  const commentRows = (p: Person, shareId: string) =>
    rows(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'comment' AND subject_id = ?`, p.user.id, shareId);

  it('[F-250] Eigentümer:in und alle, die schon kommentiert haben – nie die Autor:in selbst; gebündelt je Törn', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner, { title: 'Bodden-Runde' });
    const [a, b, c] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    await comment(a, share.id);
    expect(await rowsOf(a)).toBe(0);
    await comment(b, share.id);
    await comment(c, share.id);
    const outA = await list(a);
    expect(outA.items).toHaveLength(1);
    expect(outA.items[0]).toMatchObject({ kind: 'comment', count: 2, title: 'Bodden-Runde', href: `/s/${share.id}`, read: false });
    expect(outA.items[0].actor?.handle).toBe(c.handle);
    expect((await list(b)).items[0]).toMatchObject({ count: 1 });
    expect(await rowsOf(c)).toBe(0);
    expect((await list(owner)).items[0]).toMatchObject({ kind: 'comment', count: 3 });
    // Antwort der Eigentümer:in erreicht alle Mitkommentierenden, sie selbst nicht
    await comment(owner, share.id, 'Danke euch!');
    expect((await list(c)).items[0]).toMatchObject({ count: 1 });
    expect((await list(owner)).items[0].count).toBe(3);
    // Öffnen des Törns markiert auch für Mitkommentierende als gelesen
    await read(a, { subjectKind: 'share', subjectId: share.id });
    expect(await unread(a)).toBe(0);
  });

  it('[F-250] ohne ausgeblendete Kommentare und gesperrte Konten; nur bei öffentlichen Törns', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    const [hidden, locked, ok] = [await s.person({ profile: 'public' }), await s.person({ profile: 'public' }), await s.person({ profile: 'public' })];
    for (const p of [hidden, locked, ok]) await comment(p, share.id);
    const db = await s.db();
    await db.prepare('UPDATE comments SET hidden_at = ? WHERE user_id = ? AND share_id = ?').bind(Date.now(), hidden.user.id, share.id).run();
    await db.prepare('UPDATE users SET locked_at = ? WHERE id = ?').bind(Date.now(), locked.user.id).run();
    const before = { hidden: await commentRows(hidden, share.id), locked: await commentRows(locked, share.id), ok: await commentRows(ok, share.id) };
    await comment(owner, share.id, 'Antwort');
    expect(await commentRows(hidden, share.id)).toBe(before.hidden);
    expect(await commentRows(locked, share.id)).toBe(before.locked);
    expect((await list(ok)).items[0].count).toBe(1);
    // Törn nicht mehr öffentlich → keine Mitkommentierenden
    await db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ?').bind(Date.now(), ok.user.id).run();
    await db.prepare(`UPDATE shares SET visibility = 'unlisted' WHERE id = ?`).bind(share.id).run();
    await db.prepare('DELETE FROM comment_log WHERE user_id = ?').bind(owner.user.id).run(); // 20-s-Abstand aufheben
    await comment(owner, share.id, 'Und noch eine');
    expect(await unread(ok)).toBe(0);
  });

  it('[F-250] höchstens 50 Empfänger: Eigentümer:in zuerst, dann die zuletzt Aktiven', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    const db = await s.db();
    const ids = Array.from({ length: 55 }, (_, i) => `fan${s.uniq('x').replace(/[^a-z0-9]/gi, '')}${i}`.slice(0, 30));
    const now = Date.now();
    for (const [i, id] of ids.entries()) {
      await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(id, `${id}@example.org`, now - DAY).run();
      await db.prepare('INSERT INTO comments (id, share_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(`c${id}`.slice(0, 32), share.id, id, 'Hallo', now - 60_000 + i).run();
    }
    const actor = await s.person({ profile: 'public' });
    await comment(actor, share.id);
    expect(await rows(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'comment' AND subject_id = ?`, share.id)).toBe(NOTIFICATION_LIMITS.commentFanOut);
    expect(await rows(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND subject_id = ?`, owner.user.id, share.id)).toBe(1);
    expect(await rows(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND subject_id = ?`, ids[54], share.id)).toBe(1);
    expect(await rows(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND subject_id = ?`, ids[0], share.id)).toBe(0);
  });
});

// ---------------------------------------------------------------- F-251 Lesen mit Prüfung

describe('F-251 Liste und Zähler: nur Eigenes, geprüft beim Lesen, ohne Konto-IDs und Adressen', () => {
  it('[F-251] Gäste 401; Antwort privat, ohne IDs und E-Mail-Adressen; höchstens die neuesten 30', async () => {
    expect((await s.send('GET', '/api/notifications', undefined)).status).toBe(401);
    expect((await s.send('GET', '/api/notifications/count', undefined)).status).toBe(401);
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    const fan = await s.person({ profile: 'public' });
    await comment(fan, share.id);
    const res = await s.send('GET', '/api/notifications', owner.cookie);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const raw = await res.text();
    for (const secret of [owner.user.id, fan.user.id, owner.email, fan.email]) expect(raw).not.toContain(secret);
    const db = await s.db();
    for (let i = 0; i < NOTIFICATION_LIMITS.list + 5; i++) {
      await db
        .prepare(`INSERT INTO notifications (id, user_id, kind, subject_kind, subject_id, created_at, updated_at, read_at) VALUES (?, ?, 'follow', 'user', ?, ?, ?, ?)`)
        .bind(`bulk${i}x${Date.now()}`, owner.user.id, owner.user.id, i, i, i)
        .run();
    }
    const out = await list(owner);
    expect(out.items).toHaveLength(NOTIFICATION_LIMITS.list);
    expect(out.items[0].kind).toBe('comment'); // neueste zuerst
  });

  it('[F-251] Gesperrtes (Konzept 18) erscheint nicht – auch nicht für Eigentümer:innen, Gruppen und Einladungsziele', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    await comment(await s.person({ profile: 'public' }), share.id);
    const club = await s.group(owner, { name: 'Gesperrter Verein' });
    await requestJoin(await s.person(), club);
    expect(await unread(owner)).toBe(2);
    const db = await s.db();
    await db.prepare('UPDATE shares SET locked_at = ?1 WHERE id = ?2').bind(Date.now(), share.id).run();
    await db.prepare('UPDATE groups SET locked_at = ?1 WHERE id = ?2').bind(Date.now(), club.id).run();
    const out = await list(owner);
    expect(out.items).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain('Gesperrter Verein');
  });

  it('[F-251] was nicht mehr gilt, erscheint nicht und zählt nicht mehr (Rolle verloren, Einladung abgelaufen)', async () => {
    const owner = await s.person({ profile: 'public' });
    const adm = await s.person({ profile: 'public' });
    const club = await s.group(owner, { name: 'Kurzzeit-Admin' });
    await s.join(owner, club, adm);
    await s.send('PATCH', `/api/groups/${club.id}/members/${adm.user.id}`, owner.cookie, { role: 'admin' });
    await requestJoin(await s.person(), club);
    const from = await s.person({ profile: 'public' });
    const inv = await inviteFriend(from, { email: adm.email });
    expect(await unread(adm)).toBe(2);
    await s.send('PATCH', `/api/groups/${club.id}/members/${adm.user.id}`, owner.cookie, { role: 'member' });
    await (await s.db()).prepare('UPDATE invites SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, inv.id).run();
    const out = await list(adm);
    expect(out.items).toHaveLength(0);
    expect(out.unread).toBe(0);
  });

  it('[F-251] Mitkommentierende sehen den Kommentar-Hinweis nur, solange der Törn öffentlich ist – nie mit Schlüssel', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const share = await s.share(owner, { title: 'Erst offen' });
    const fan = await s.person({ profile: 'public' });
    await comment(fan, share.id);
    await comment(await s.person({ profile: 'public' }), share.id);
    expect(await unread(fan)).toBe(1);
    // Kommentare nur noch für die Eigentümer:in sichtbar → verschwindet
    const db = await s.db();
    await db.prepare(`UPDATE shares SET comments_mode = 'hidden' WHERE id = ?`).bind(share.id).run();
    expect((await list(fan)).items).toHaveLength(0);
    await db.prepare(`UPDATE shares SET comments_mode = 'on' WHERE id = ?`).bind(share.id).run();
    await comment(await s.person({ profile: 'public' }), share.id);
    expect(await unread(fan)).toBe(1);
    await db.prepare(`UPDATE shares SET visibility = 'unlisted', share_key = ? WHERE id = ?`).bind('NeuerSchluesselAbc123', share.id).run();
    const out = await list(fan);
    expect(out.items).toHaveLength(0);
    expect(out.unread).toBe(0);
    expect(JSON.stringify(out)).not.toContain('NeuerSchluessel');
    // die Eigentümer:in sieht ihren Törn weiter – mit Schlüssel
    expect((await list(owner)).items[0].href).toBe(`/s/${share.id}/NeuerSchluesselAbc123`);
  });

  it('[F-251] gesperrte oder nicht öffentliche Handelnde erscheinen als „Jemand“ (actor null)', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    const fan = await s.person({ profile: 'public' });
    await comment(fan, share.id);
    await (await s.db()).prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), fan.user.id).run();
    expect((await list(owner)).items[0].actor).toBeNull();
  });
});

// ---------------------------------------------------------------- F-253 Gelesen

describe('F-253 Gelesen: beim Anklicken, beim Öffnen des Gegenstands und über den Mail-Link', () => {
  it('[F-253] POST /read: ids, Art, Gegenstand oder alles – nur eigene; ohne Angabe 400', async () => {
    const owner = await s.person({ profile: 'public' });
    const share1 = await s.share(owner, { title: 'Eins' });
    const share2 = await s.share(owner, { title: 'Zwei' });
    const fan = await s.person({ profile: 'public' });
    await comment(fan, share1.id);
    await react(fan, 'share', share2.id);
    await follow(fan, 'user', owner.handle!);
    expect(await unread(owner)).toBe(3);
    expect((await read(owner, {})).status).toBe(400);
    expect((await read(owner, { all: 'ja' })).status).toBe(400);
    expect((await s.send('POST', '/api/notifications/read', undefined, { all: true })).status).toBe(401);

    const { items } = await list(owner);
    // fremde IDs ändern nichts
    expect((await (await read(fan, { ids: items.map((i) => i.id) })).json()) as { unread: number }).toEqual({ unread: 0 });
    expect(await unread(owner)).toBe(3);
    expect(((await (await read(owner, { subjectKind: 'share', subjectId: share1.id })).json()) as { unread: number }).unread).toBe(2);
    expect(((await (await read(owner, { kind: 'follow' })).json()) as { unread: number }).unread).toBe(1);
    expect(((await (await read(owner, { all: true })).json()) as { unread: number }).unread).toBe(0);
  });

  it('[F-253] Einladung über den Link aus der Mail ansehen (peek) markiert sie für dieses Konto als gelesen', async () => {
    const from = await s.person({ profile: 'public' });
    const to = await s.person();
    const other = await s.person();
    const inv = await inviteFriend(from, { email: to.email });
    expect(inv.token).not.toBe('');
    // jemand anderes sieht sich den Link an → bleibt ungelesen
    await s.send('POST', '/api/invites/peek', other.cookie, { token: inv.token });
    expect(await unread(to)).toBe(1);
    expect((await s.send('POST', '/api/invites/peek', to.cookie, { token: inv.token })).status).toBe(200);
    expect(await unread(to)).toBe(0);
    expect((await list(to)).items[0]).toMatchObject({ kind: 'invite', read: true });
  });
});

// ---------------------------------------------------------------- F-254 Kommentar-Sammelmail

describe('F-254 Sammelmail nur über Kommentare, die auf der Seite noch nicht gelesen sind', () => {
  const mails = (to: string) => h.logs.filter((l) => l.includes(`[mail:log] an ${to}:`) && l.includes('Benachrichtigung'));

  it('[F-254] auf der Seite gelesen → nicht in der Mail; ungelesen → in der Mail mit Link zum Törn', async () => {
    const owner = await s.person({ profile: 'public' });
    const seen = await s.share(owner, { title: 'Schon gelesen' });
    const fresh = await s.share(owner, { title: 'Noch offen' });
    await s.send('PATCH', '/api/me/settings', owner.cookie, { notifyComments: 'daily' });
    await (await s.db()).prepare('UPDATE users SET comments_mailed_at = ? WHERE id = ?').bind(Date.now() - DAY, owner.user.id).run();
    const fan = await s.person({ profile: 'public' });
    const fan2 = await s.person({ profile: 'public' });
    await comment(fan, seen.id);
    await comment(fan2, fresh.id);
    await read(owner, { subjectKind: 'share', subjectId: seen.id });
    await h.scheduled();
    const got = mails(owner.email);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('Noch offen');
    expect(got[0]).toContain(`https://sail.example/s/${fresh.id}`);
    expect(got[0]).not.toContain('Schon gelesen');
  });

  it('[F-254] alles gelesen → keine Mail', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner, { title: 'Alles gelesen' });
    await s.send('PATCH', '/api/me/settings', owner.cookie, { notifyComments: 'daily' });
    await (await s.db()).prepare('UPDATE users SET comments_mailed_at = ? WHERE id = ?').bind(Date.now() - DAY, owner.user.id).run();
    await comment(await s.person({ profile: 'public' }), share.id);
    await read(owner, { all: true });
    await h.scheduled();
    expect(mails(owner.email)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- F-255 Aufräumen

describe('F-255 Benachrichtigungen verschwinden auf jedem Löschweg', () => {
  const about = (kind: string, id: string) => rows('SELECT COUNT(*) AS n FROM notifications WHERE subject_kind = ? AND subject_id = ?', kind, id);

  it('[F-255] Törn löschen, Beitrag löschen, Gruppe löschen', async () => {
    const owner = await s.person({ profile: 'public', supporter: true });
    const fan = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    await comment(fan, share.id);
    expect(await about('share', share.id)).toBe(1);
    expect((await s.send('DELETE', `/api/shares/${share.id}`, owner.cookie)).status).toBe(204);
    expect(await about('share', share.id)).toBe(0);

    const club = await s.group(owner);
    const p = await post(owner, club);
    await react(fan, 'post', p.id);
    expect(await about('post', p.id)).toBe(1);
    expect((await s.send('DELETE', `/api/posts/${p.id}`, owner.cookie)).status).toBe(204);
    expect(await about('post', p.id)).toBe(0);

    const p2 = await post(owner, club, 'Zweiter Beitrag');
    await react(fan, 'post', p2.id);
    await requestJoin(await s.person(), club);
    expect(await about('group', club.id)).toBe(1);
    expect((await s.send('DELETE', `/api/groups/${club.id}`, owner.cookie)).status).toBe(204);
    expect(await about('group', club.id)).toBe(0);
    expect(await about('post', p2.id)).toBe(0);
  });

  it('[F-255] Einladung angenommen, abgelehnt oder zurückgezogen', async () => {
    const from = await s.person({ profile: 'public' });
    const [a, b, c] = [await s.person(), await s.person(), await s.person()];
    const ia = await inviteFriend(from, { email: a.email });
    const ib = await inviteFriend(from, { email: b.email });
    const ic = await inviteFriend(from, { email: c.email });
    expect((await s.send('POST', `/api/me/invites/${ia.id}/accept`, a.cookie)).status).toBe(200);
    expect((await s.send('DELETE', `/api/me/invites/${ib.id}`, b.cookie)).status).toBe(204);
    expect((await s.send('DELETE', `/api/invites/${ic.id}`, from.cookie)).status).toBe(204);
    for (const id of [ia.id, ib.id, ic.id]) expect(await about('invite', id)).toBe(0);
  });

  it('[F-255] Konto löschen: eigene Zeilen weg, als Handelnde ohne Namen; Einladungen der Person weg', async () => {
    const owner = await s.person({ profile: 'public' });
    const share = await s.share(owner);
    const leaver = await s.person({ profile: 'public' });
    await comment(leaver, share.id);
    const share2 = await s.share(leaver);
    await comment(owner, share2.id);
    const invitee = await s.person();
    const inv = await inviteFriend(leaver, { email: invitee.email });
    expect((await s.send('DELETE', '/api/account', leaver.cookie)).status).toBe(200);
    expect(await rows('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', leaver.user.id)).toBe(0);
    expect(await rows('SELECT COUNT(*) AS n FROM notifications WHERE actor_id = ?', leaver.user.id)).toBe(0);
    expect(await about('invite', inv.id)).toBe(0);
    const [item] = (await list(owner)).items;
    expect(item).toMatchObject({ kind: 'comment', actor: null });
  });

  it('[F-255] nächtlich: Gelesenes nach 30 Tagen, alles nach 90 Tagen, Einträge ohne Gegenstand', async () => {
    const owner = await s.person({ profile: 'public' });
    const db = await s.db();
    const now = Date.now();
    const ins = (id: string, subjectKind: string, subjectId: string, updated: number, readAt: number | null) =>
      db
        .prepare(`INSERT INTO notifications (id, user_id, kind, subject_kind, subject_id, created_at, updated_at, read_at) VALUES (?, ?, 'follow', ?, ?, ?, ?, ?)`)
        .bind(id, owner.user.id, subjectKind, subjectId, updated, updated, readAt)
        .run();
    const tag = Date.now().toString(36);
    await ins(`keep${tag}`, 'user', owner.user.id, now - 10 * DAY, now - 10 * DAY);
    await ins(`oldread${tag}`, 'user', owner.user.id, now - 40 * DAY, now - 31 * DAY);
    await ins(`ancient${tag}`, 'user', owner.user.id, now - 91 * DAY, null);
    await ins(`orphan${tag}`, 'share', 'GibtEsNichtMehr123', now, null);
    await h.scheduled();
    const { results } = await db.prepare('SELECT id FROM notifications WHERE user_id = ?').bind(owner.user.id).all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual([`keep${tag}`]);
  });
});
