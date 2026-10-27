// Unit-Tests der reinen Regeln zu Verein, Hafen, Team und Reaktionen (Konzept 12): Hafen-Normalisierung, Position,
// Reaktionen (Zusammenfassen, Umschalten), Gegenstand eines Stream-Eintrags, Prüfung „Neues Boot im Hafen“,
// Platzhalter im Impressum, Routen.
import { describe, expect, it } from 'vitest';
import { HARBOR_PUNCTUATION, harborKey, harborSlugBase, isHarborSlug, parseHarborPosition } from '../src/domain/harbors';
import { REACTIONS, emptyReactions, isReactionKind, isReactionSubject, reactionCountText, reactionTotal, summarizeReactions, toggleReaction } from '../src/domain/reactions';
import { reactionSubjectOf, streamHeadline, streamPath, type StreamItem } from '../src/domain/groups';
import { shapeItem, type ActivityRow } from '../worker/stream-shape';
import { OPERATOR, PLACEHOLDER_RE, datenschutz, impressum, isLegalSlug, operatorPlaceholders } from '../src/content/legal';
import { parseRoute } from '../src/services/url-state';

describe('harborKey (Konzept 12.2)', () => {
  it('fasst Schreibweisen zusammen: Groß/klein, Umlaute, Satzzeichen, Leerzeichen', () => {
    const same = ['Potsdam-West', 'potsdam west', 'POTSDAM / West', '  Potsdam_West. ', 'Potsdam (West)'];
    for (const s of same) expect(harborKey(s), s).toBe('potsdam west');
    expect(harborKey('Großer Wannsee')).toBe('grosser wannsee');
    expect(harborKey('Ärgernis-Hafen')).toBe(harborKey('aergernis hafen'));
    expect(harborKey('Hafen; Steg 3 & 4 + Boje')).toBe('hafen steg 3 4 boje');
  });

  it('lässt andere Zeichen stehen (gleiche Regel wie SQLite lower())', () => {
    expect(harborKey('Ñandú')).toBe('Ñandú'); // nur A–Z werden klein, wie SQLite ohne ICU
    expect(harborKey('Hafen – Nord')).toBe('hafen – nord'); // Gedankenstrich ist kein Satzzeichen der Regel
    expect(harborKey('...')).toBe('');
    expect(HARBOR_PUNCTUATION).toHaveLength(13);
  });

  it('Slugs und Positionen', () => {
    expect(isHarborSlug('hafen-kiel')).toBe(true);
    expect(isHarborSlug('Hafen')).toBe(false);
    expect(isHarborSlug('')).toBe(false);
    expect(harborSlugBase('Yachthafen Möwe')).toBe('yachthafen-moewe');
    expect(harborSlugBase('!!')).toBe('hafen');
    expect(parseHarborPosition(52.4, 13.05)).toEqual({ lat: 52.4, lon: 13.05 });
    expect(parseHarborPosition('52.123456', '13.1')).toEqual({ lat: 52.12346, lon: 13.1 });
    expect(parseHarborPosition(null, '')).toEqual({ lat: null, lon: null });
    expect(parseHarborPosition(91, 0)).toBeUndefined();
    expect(parseHarborPosition(52, null)).toBeUndefined();
    expect(parseHarborPosition('x', 'y')).toBeUndefined();
  });
});

describe('Reaktionen (Konzept 12.5)', () => {
  it('feste Auswahl mit eigenen Icons', () => {
    expect(REACTIONS.map((r) => r.label)).toEqual(['Gefällt mir', 'Mast- und Schotbruch', 'Starker Schlag']);
    expect(isReactionKind('like')).toBe(true);
    expect(isReactionKind('love')).toBe(false);
    expect(isReactionSubject('activity')).toBe(true);
    expect(isReactionSubject('comment')).toBe(false);
  });

  it('zusammenfassen, zählen, umschalten', () => {
    const s = summarizeReactions([
      { kind: 'like', n: 2, mine: 0 },
      { kind: 'mast', n: 1, mine: 1 },
      { kind: 'boo', n: 9, mine: 1 },
    ]);
    expect(s).toEqual({ counts: { like: 2, mast: 1, tack: 0 }, mine: 'mast' });
    expect(reactionTotal(s)).toBe(3);
    expect(reactionCountText(s)).toBe('3 Reaktionen');
    expect(reactionCountText({ counts: { like: 1, mast: 0, tack: 0 }, mine: null })).toBe('1 Reaktion');
    // andere Art ersetzt
    expect(toggleReaction(s, 'like')).toEqual({ next: 'like', summary: { counts: { like: 3, mast: 0, tack: 0 }, mine: 'like' } });
    // dieselbe nimmt zurück
    expect(toggleReaction(s, 'mast')).toEqual({ next: null, summary: { counts: { like: 2, mast: 0, tack: 0 }, mine: null } });
    // ohne eigene: neu
    expect(toggleReaction(emptyReactions(), 'tack').summary).toEqual({ counts: { like: 0, mast: 0, tack: 1 }, mine: 'tack' });
  });

  it('Gegenstand eines Stream-Eintrags: Törn, Beitrag oder die Aktivität', () => {
    const base = { id: 'A1', createdAt: 0, actor: null, group: null };
    expect(reactionSubjectOf({ ...base, kind: 'voyage', voyage: { id: 'S1' } } as StreamItem)).toEqual({ subject: 'share', id: 'S1' });
    expect(reactionSubjectOf({ ...base, kind: 'photos', voyage: { id: 'S1' } } as StreamItem)).toEqual({ subject: 'share', id: 'S1' });
    expect(reactionSubjectOf({ ...base, kind: 'post', post: { id: 'P1' } } as StreamItem)).toEqual({ subject: 'post', id: 'P1' });
    expect(reactionSubjectOf({ ...base, kind: 'milestone' } as StreamItem)).toEqual({ subject: 'activity', id: 'A1' });
  });
});

describe('„Neues Boot im Hafen“ (Konzept 12.4)', () => {
  const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
    id: 'A1', kind: 'harbor', actor_id: 'U1', subject_kind: 'boat', subject_id: 'B1', group_id: null, data: '{"harbor":"H1"}', created_at: 1,
    actor_handle: null, actor_name: null, actor_public: 0, actor_suspended: 0, actor_exists: 1,
    s_id: null, s_title: null, s_dist: null, s_started: null, s_image: null, s_vis: null, s_hidden: null,
    b_id: 'B1', b_name: 'Möwe', b_vis: 'public', b_hidden: null,
    g_id: null, g_slug: null, g_name: null, g_kind: null, g_vis: null, g_hidden: null, g_role: null,
    p_id: null, p_body: null, p_link: null, p_hidden: null, p_author: null,
    h_slug: 'potsdam', h_name: 'Potsdam', h_hidden: null,
    ...over,
  });

  it('nur öffentliches Boot und nicht ausgeblendeter Hafen; gesperrte Konten nie', () => {
    const item = shapeItem(row(), { id: null })!;
    expect(item).toMatchObject({ kind: 'harbor', boat: { id: 'B1', name: 'Möwe' }, harbor: { slug: 'potsdam', name: 'Potsdam' } });
    expect(streamHeadline(item)).toBe('Neues Boot im Hafen Potsdam: Möwe');
    expect(streamPath(item)).toBe('/b/B1');
    expect(shapeItem(row({ b_vis: 'private' }), { id: null })).toBeNull();
    expect(shapeItem(row({ b_hidden: 5 }), { id: null })).toBeNull();
    expect(shapeItem(row({ h_hidden: 5 }), { id: null })).toBeNull();
    expect(shapeItem(row({ h_slug: null }), { id: null })).toBeNull();
    expect(shapeItem(row({ actor_suspended: 1 }), { id: null })).toBeNull();
  });
});

describe('Impressum und Datenschutz (Konzept 12.7)', () => {
  it('Platzhalter werden erkannt; ausgefüllt keine', () => {
    expect(PLACEHOLDER_RE.test('[NAME DES BETREIBERS]')).toBe(true);
    expect(PLACEHOLDER_RE.test('Erika [Muster]')).toBe(false);
    const open = { ...OPERATOR, name: '[NAME DES BETREIBERS]', street: '[STRASSE UND HAUSNUMMER]', phone: '' };
    expect(operatorPlaceholders(open)).toEqual(['name', 'street']);
    expect(operatorPlaceholders()).toEqual([]); // live: alles ausgefüllt
    const filled = { ...OPERATOR, name: 'A', street: 'B 1', city: '14467 Potsdam', email: 'a@b.de', editor: 'A', reportEmail: 'm@b.de' };
    expect(operatorPlaceholders(filled)).toEqual([]);
  });

  it('Seiten nutzen die Betreiberangaben; Slugs', () => {
    const op = { ...OPERATOR, name: 'Erika Muster', reportEmail: 'melden@example.org' };
    expect(JSON.stringify(impressum(op))).toContain('Erika Muster');
    expect(JSON.stringify(datenschutz(op))).toContain('melden@example.org');
    expect(datenschutz(op).sections.map((s) => s.id)).toEqual(expect.arrayContaining(['hosting', 'konto', 'inhalte', 'browser', 'zahlung', 'fristen', 'loeschen', 'rechte']));
    expect(isLegalSlug('impressum')).toBe(true);
    expect(isLegalSlug('agb')).toBe(false);
  });
});

describe('Routen (Konzept 12)', () => {
  const at = (pathname: string) => parseRoute({ pathname, search: '', hash: '' });
  it('/h/<slug>, /impressum, /datenschutz', () => {
    expect(at('/h/hafen-kiel')).toEqual({ kind: 'harbor', slug: 'hafen-kiel' });
    expect(at('/h/Potsdam/')).toEqual({ kind: 'harbor', slug: 'potsdam' });
    expect(at('/impressum')).toEqual({ kind: 'legal', page: 'impressum' });
    expect(at('/datenschutz/')).toEqual({ kind: 'legal', page: 'datenschutz' });
    expect(at('/h/')).toEqual({ kind: 'home' });
  });
});
