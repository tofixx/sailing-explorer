// Unit-Tests der reinen Regeln für Vereine, Teams und Neuigkeiten (Konzept 11): src/domain/groups.ts, Grenzen,
// Prüfung beim Lesen (worker/stream.ts shapeItem), Atom-Escaping (worker/feed.ts) und Mail-Woche.
import { describe, expect, it } from 'vitest';
import {
  canManageGroup, canRemoveMember, crossedMilestones, dayKey, decodeCursor, encodeCursor, normalizeSlug, parsePostLink, seasonOf,
  slugFromName, streamHeadline, streamPath, suggestionReasonText, digestWeekStart, type StreamItem,
} from '../src/domain/groups';
import { GROUP_LIMITS, groupLimitMessage, groupVerdict } from '../src/domain/limits';
import { shapeItem, type ActivityRow } from '../worker/stream-shape';
import { atomFeed, xmlEscape } from '../worker/feed-xml';
import { parseRoute } from '../src/services/url-state';
import { parseInviteKind } from '../worker/validate';

describe('Gruppen-Adressen', () => {
  it('[F-150] normalizeSlug: Regeln wie Profilnamen plus reservierte Gruppenwörter', () => {
    expect(normalizeSlug(' SC-Moewe ')).toBe('sc-moewe');
    for (const bad of ['ab', 'neu', 'feed', 'vereine', 'admin', '-ab', 'ab-', 'a--b', 'a b c', 'möwe', 'x'.repeat(31), 42, null]) expect(normalizeSlug(bad), String(bad)).toBeNull();
  });

  it('[F-150] slugFromName: Umlaute, Sonderzeichen, Länge', () => {
    expect(slugFromName('Segelclub Möwe e.V.')).toBe('segelclub-moewe-e-v');
    expect(slugFromName('Straße & Söhne')).toBe('strasse-soehne');
    expect(slugFromName('Ä')).toBe('');
    expect(slugFromName('Kieler Yacht-Club Jugendabteilung Regatta').length).toBeLessThanOrEqual(30);
    expect(slugFromName('Kieler Yacht-Club Jugendabteilung Regatta')).not.toMatch(/-$/);
  });

  it('[F-153] Einladungsart „group“ ist gültig', () => {
    expect(parseInviteKind('group')).toBe('group');
    expect(parseInviteKind('club')).toBeNull();
  });

  it('[F-163] Routen /g/<slug>, /g/<slug>/<schlüssel> und /g/neu', () => {
    const r = (pathname: string) => parseRoute({ pathname, search: '', hash: '' });
    expect(r('/g/SC-Moewe')).toEqual({ kind: 'group', slug: 'sc-moewe' });
    expect(r('/g/sc-moewe/AbCdEfGhJkLmNpQrStUvWx')).toEqual({ kind: 'group', slug: 'sc-moewe', key: 'AbCdEfGhJkLmNpQrStUvWx' });
    expect(r('/g/neu')).toEqual({ kind: 'group-new' });
    expect(r('/g/x')).toEqual({ kind: 'home' });
  });
});

describe('Rollen und Grenzen', () => {
  it('[F-151] Verwalten und Entfernen nach Rolle', () => {
    expect(canManageGroup('owner')).toBe(true);
    expect(canManageGroup('admin')).toBe(true);
    expect(canManageGroup('member')).toBe(false);
    expect(canManageGroup(null)).toBe(false);
    expect(canRemoveMember('owner', 'admin', false)).toBe(true);
    expect(canRemoveMember('owner', 'owner', true)).toBe(false);
    expect(canRemoveMember('admin', 'member', false)).toBe(true);
    expect(canRemoveMember('admin', 'admin', false)).toBe(false);
    expect(canRemoveMember('member', 'member', false)).toBe(false);
    expect(canRemoveMember('member', 'member', true)).toBe(true);
  });

  it('[F-168] Gruppen anlegen: kostenlos 1, Unterstützer 10', () => {
    expect(GROUP_LIMITS.owned).toEqual({ free: 1, supporter: 10 });
    expect(groupVerdict(false, 0)).toBe('ok');
    expect(groupVerdict(false, 1)).toBe('supporter_required');
    expect(groupVerdict(true, 9)).toBe('ok');
    expect(groupVerdict(true, 10)).toBe('quota');
    expect(groupVerdict(false, 10)).toBe('quota');
    expect(groupLimitMessage('supporter_required', true)).toContain('bis zu 10');
    expect(groupLimitMessage('supporter_required', false)).not.toContain('Unterstützer');
    expect(GROUP_LIMITS).toMatchObject({ members: 500, postsPerDay: 5, follows: 1000 });
  });
});

describe('Neuigkeiten – Hilfen', () => {
  it('[F-166] Meilensteine: nur überschrittene Schwellen, je einmal', () => {
    expect(crossedMilestones(90, 110)).toEqual([100]);
    expect(crossedMilestones(100, 120)).toEqual([]);
    expect(crossedMilestones(0, 1200)).toEqual([100, 500, 1000]);
    expect(crossedMilestones(499.5, 500)).toEqual([500]);
    expect(seasonOf(Date.UTC(2026, 11, 31, 23))).toBe(2026);
    expect(dayKey(Date.UTC(2026, 9, 26, 23, 59))).toBe('2026-10-26');
  });

  it('[F-160] Cursor: Rundreise und Ablehnung kaputter Werte', () => {
    const c = { at: 1_760_000_000_000, id: 'AbCdEfGhJkLmNpQr23' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    for (const bad of ['', 'x', '123', '123_ab', `${'9'.repeat(16)}_AbCdEfGhJkLmNpQr23`, '1_AbCdEfGhJkLmNpQr23;DROP']) expect(decodeCursor(bad)).toBeNull();
  });

  it('[F-161] Beitragslink: nur http(s) mit Host, leer erlaubt', () => {
    expect(parsePostLink('')).toBe('');
    expect(parsePostLink(undefined)).toBe('');
    expect(parsePostLink('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    for (const bad of ['javascript:alert(1)', 'ftp://example.org', 'https://localhost', 'kein link', `https://example.org/${'a'.repeat(500)}`, 7]) expect(parsePostLink(bad)).toBeNull();
  });

  it('[F-164] Gründe für Vorschläge', () => {
    expect(suggestionReasonText('port', 'Laboe')).toBe('Heimathafen Laboe');
    expect(suggestionReasonText('crew')).toBe('Mit dir gesegelt');
  });
});

// ---------------------------------------------------------------- Prüfung beim Lesen

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'Act000000000000001', kind: 'voyage', actor_id: 'User00000000000001', subject_kind: 'share', subject_id: 'Shr000000000000001', group_id: null,
  data: '{}', created_at: 1000, actor_handle: 'anna', actor_name: 'Anna', actor_public: 1, actor_suspended: 0, actor_exists: 1,
  s_id: 'Shr000000000000001', s_title: 'Rügen', s_dist: 42, s_started: 900, s_image: 1, s_vis: 'public', s_hidden: null,
  b_id: 'Boat00000000000001', b_name: 'Möwe', b_vis: 'public', b_hidden: null,
  g_id: null, g_slug: null, g_name: null, g_kind: null, g_vis: null, g_hidden: null, g_role: null,
  p_id: null, p_body: null, p_link: null, p_hidden: null, p_author: null,
  ...over,
});
const viewer = { id: 'Viewer000000000001' };
const groupRow = (over: Partial<ActivityRow> = {}) =>
  row({ kind: 'post', subject_kind: 'post', subject_id: 'Post00000000000001', group_id: 'Grp000000000000001', g_id: 'Grp000000000000001', g_slug: 'sc', g_name: 'SC', g_kind: 'club', g_vis: 'public', p_id: 'Post00000000000001', p_body: 'Hallo', p_author: 'User00000000000001', s_id: null, b_id: null, ...over });

describe('[F-212] shapeItem – Titelbilder nur öffentlicher Objekte', () => {
  const boatRow = (over: Partial<ActivityRow> = {}) =>
    groupRow({ kind: 'boat', subject_kind: 'boat', subject_id: 'Boat00000000000001', b_id: 'Boat00000000000001', b_name: 'Möwe', b_vis: 'public', p_id: null, cb_ver: 'v1abcd', cb_y: 30, ...over });

  it('neues Boot: Titelbild des öffentlichen Boots mit Ausschnitt; ohne Bild kein Feld', () => {
    expect(shapeItem(boatRow(), viewer)!.cover).toEqual({ src: '/api/covers/b/Boat00000000000001/v1abcd', y: 30 });
    expect('cover' in shapeItem(boatRow({ cb_ver: null }), viewer)!).toBe(false);
  });

  it('Mitglied: Titelbild nur mit öffentlichem Profil; Meilenstein einer Gruppe nur bei öffentlicher Gruppe', () => {
    const member = groupRow({ kind: 'member', subject_kind: 'group', p_id: null, cu_ver: 'u1abcd', cu_y: 10 });
    expect(shapeItem(member, viewer)!.cover).toEqual({ src: '/api/covers/u/anna/u1abcd', y: 10 });
    expect(shapeItem({ ...member, actor_public: 0 }, viewer)!.cover).toBeUndefined();
    const milestone = groupRow({ kind: 'milestone', subject_kind: 'group', subject_id: 'Grp000000000000001', p_id: null, data: '{"nm":100,"year":2026}', cg_ver: 'g1abcd', cg_y: null });
    expect(shapeItem(milestone, viewer)!.cover).toEqual({ src: '/api/covers/g/Grp000000000000001/g1abcd', y: 50 });
    // geschlossene Gruppe, als Mitglied sichtbar: Eintrag ja, Bild nein (Adresse bräuchte Anmeldung/Schlüssel)
    const closed = shapeItem({ ...milestone, g_vis: 'private', g_role: 'member' }, viewer)!;
    expect(closed.milestone).toBeDefined();
    expect(closed.cover).toBeUndefined();
  });

  it('Eigner gesperrt: Boot erscheint nicht, Gruppe ohne Titelbild', () => {
    expect(shapeItem(boatRow({ b_owner_suspended: 1 }), viewer)).toBeNull();
    const milestone = groupRow({ kind: 'milestone', subject_kind: 'group', subject_id: 'Grp000000000000001', p_id: null, data: '{"nm":100,"year":2026}', cg_ver: 'g1abcd', g_owner_suspended: 1 });
    expect(shapeItem(milestone, viewer)!.cover).toBeUndefined();
  });

  it('Törns und Beiträge tragen kein Titelbild', () => {
    expect(shapeItem(row({ cb_ver: 'v1abcd', cu_ver: 'u1abcd' }), viewer)!.cover).toBeUndefined();
    expect(shapeItem(groupRow({ cg_ver: 'g1abcd' }), viewer)!.cover).toBeUndefined();
  });
});

describe('[F-160] shapeItem – Sichtbarkeit beim Lesen', () => {
  it('öffentlicher Törn: mit Segler und öffentlichem Boot, ohne IDs der Konten', () => {
    const i = shapeItem(row(), viewer)!;
    expect(i.voyage).toEqual({ id: 'Shr000000000000001', title: 'Rügen', distNm: 42, startedAt: 900, hasImage: true, boat: { id: 'Boat00000000000001', name: 'Möwe' } });
    expect(i.actor).toEqual({ handle: 'anna', displayName: 'Anna' });
    expect(JSON.stringify(i)).not.toContain('User00000000000001');
  });

  it('nicht öffentlich, ausgeblendet, gelöscht, gesperrt oder gelöschtes Konto → null', () => {
    expect(shapeItem(row({ s_vis: 'private' }), viewer)).toBeNull();
    expect(shapeItem(row({ s_vis: 'unlisted' }), viewer)).toBeNull();
    expect(shapeItem(row({ s_hidden: 5 }), viewer)).toBeNull();
    expect(shapeItem(row({ s_id: null }), viewer)).toBeNull();
    expect(shapeItem(row({ actor_suspended: 1 }), viewer)).toBeNull();
    expect(shapeItem(row({ actor_exists: 0 }), viewer)).toBeNull();
    expect(shapeItem(row({ kind: 'unbekannt' }), viewer)).toBeNull();
  });

  it('Profil nicht öffentlich → ohne Namen; Boot nicht öffentlich oder ausgeblendet → ohne Boot', () => {
    expect(shapeItem(row({ actor_public: 0 }), viewer)!.actor).toBeNull();
    expect(shapeItem(row({ b_vis: 'private' }), viewer)!.voyage!.boat).toBeNull();
    expect(shapeItem(row({ b_hidden: 1 }), viewer)!.voyage!.boat).toBeNull();
  });

  it('Fotos nur mit öffentlichen Fotos, höchstens 4 Vorschaubilder', () => {
    const r = row({ kind: 'photos', data: '{"count":7}' });
    expect(shapeItem(r, viewer, [])).toBeNull();
    const i = shapeItem(r, viewer, ['a', 'b', 'c', 'd', 'e'])!;
    expect(i.photos).toEqual({ count: 7, thumbs: ['a', 'b', 'c', 'd'] });
  });

  it('Beiträge: Gruppe öffentlich oder Mitglied; geschlossen ohne Mitgliedschaft, ausgeblendet → null; Löschen nur Autor/Verwalter', () => {
    expect(shapeItem(groupRow(), viewer)!.post).toEqual({ id: 'Post00000000000001', body: 'Hallo', link: null, canDelete: false });
    expect(shapeItem(groupRow({ g_vis: 'private' }), viewer)).toBeNull();
    expect(shapeItem(groupRow({ g_vis: 'unlisted' }), viewer)).toBeNull();
    expect(shapeItem(groupRow({ g_vis: 'private', g_role: 'member' }), viewer)).not.toBeNull();
    expect(shapeItem(groupRow({ p_hidden: 1 }), viewer)).toBeNull();
    expect(shapeItem(groupRow({ g_hidden: 1, g_role: 'member' }), viewer)).toBeNull();
    expect(shapeItem(groupRow({ g_hidden: 1, g_role: 'admin' }), viewer)!.post!.canDelete).toBe(true);
    expect(shapeItem(groupRow({ p_author: viewer.id }), viewer)!.post!.canDelete).toBe(true);
    expect(shapeItem(groupRow(), { id: null })!.post!.canDelete).toBe(false);
  });

  it('Meilensteine: Profil bzw. Boot öffentlich, Gruppe sichtbar', () => {
    const user = row({ kind: 'milestone', subject_kind: 'user', subject_id: 'User00000000000001', data: '{"nm":100,"year":2026}', s_id: null, b_id: null });
    expect(shapeItem(user, viewer)!.milestone).toEqual({ nm: 100, year: 2026, subject: 'user', name: 'Anna', path: '/u/anna' });
    expect(shapeItem({ ...user, actor_public: 0 }, viewer)).toBeNull();
    const boat = row({ kind: 'milestone', subject_kind: 'boat', actor_id: null, data: '{"nm":500,"year":2026}', s_id: null });
    expect(shapeItem(boat, viewer)!.milestone!.path).toBe('/b/Boat00000000000001');
    expect(shapeItem({ ...boat, b_vis: 'unlisted' }, viewer)).toBeNull();
  });
});

describe('[F-162] Atom-Feed und Texte', () => {
  it('xmlEscape: Sonderzeichen und verbotene Steuerzeichen', () => {
    expect(xmlEscape(`<a href="x">'&'</a>\u0000\u0007￿ ok`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt; ok');
  });

  it('atomFeed: Einträge mit escapetem Nutzertext, Links aus der eigenen Origin', () => {
    const item: StreamItem = { id: 'Act1', kind: 'post', createdAt: Date.UTC(2026, 9, 1), actor: { handle: 'a', displayName: '<Anna>' }, group: { slug: 'sc', name: 'S&C', kind: 'club' }, post: { id: 'P1', body: '</content><script>', link: null, canDelete: false } };
    const xml = atomFeed('https://sail.example', { slug: 'sc', name: 'S&C', description: '', updated: 0 }, [item]);
    expect(xml).toContain('<title>S&amp;C · Sail Explorer</title>');
    expect(xml).toContain('<content type="text">&lt;/content&gt;&lt;script&gt;</content>');
    expect(xml).toContain('<name>&lt;Anna&gt;</name>');
    expect(xml).toContain('<link rel="alternate" href="https://sail.example/g/sc"/>');
    expect(xml).toContain('<updated>2026-10-01T00:00:00.000Z</updated>');
  });

  it('streamHeadline und streamPath', () => {
    const v: StreamItem = { id: 'A', kind: 'voyage', createdAt: 0, actor: null, group: null, voyage: { id: 'S1', title: 'Rügen', distNm: 1, startedAt: null, hasImage: false, boat: null } };
    expect(streamHeadline(v)).toBe('Ein:e Segler:in hat einen Törn geteilt: Rügen');
    expect(streamPath(v)).toBe('/s/S1');
    const m: StreamItem = { id: 'B', kind: 'member', createdAt: 0, actor: { handle: 'bo', displayName: 'Bo' }, group: { slug: 'team-x', name: 'X', kind: 'team' } };
    expect(streamHeadline(m)).toBe('Bo ist dem Team X beigetreten');
    expect(streamPath(m)).toBe('/g/team-x');
    const ph: StreamItem = { ...v, kind: 'photos', photos: { count: 3, thumbs: [] } };
    expect(streamHeadline(ph)).toBe('Ein:e Segler:in: 3 neue Fotos zu Rügen');
  });
});

describe('[F-165] Mail-Woche', () => {
  it('beginnt am letzten Sonntag 0 Uhr UTC (am Sonntag selbst heute)', () => {
    const sunday = Date.UTC(2026, 9, 25); // So, 25.10.2026
    expect(digestWeekStart(sunday + 5 * 3_600_000)).toBe(sunday);
    expect(digestWeekStart(Date.UTC(2026, 9, 26, 12))).toBe(sunday);
    expect(digestWeekStart(Date.UTC(2026, 9, 31, 23, 59))).toBe(sunday);
    expect(digestWeekStart(Date.UTC(2026, 10, 1, 0, 1))).toBe(Date.UTC(2026, 10, 1));
  });
});
