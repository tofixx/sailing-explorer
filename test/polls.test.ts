// Reine Regeln der Umfragen (src/domain/polls.ts, Konzept 29): Eingabe, offen, wer das Ergebnis sieht, gültige Stimmen.
import { describe, expect, it } from 'vitest';
import { canSeeResults, parsePollData, pollPercent, readPollConfig, validChoices, viewPoll, type PollConfig } from '../src/domain/polls';

const NOW = Date.UTC(2026, 10, 3, 12);
const DAY = 86_400_000;
const cfg = (o: Partial<PollConfig> = {}): PollConfig => ({ options: ['a', 'b', 'c'], max: 1, closesAt: null, results: 'voted', named: false, ...o });

describe('F-470 Eingabe', () => {
  it('[F-470] Standard: Einfachauswahl, offen, „nach eigener Stimme“, anonym; Antworten getrimmt', () => {
    expect(readPollConfig({ options: [' Ja ', 'Nein\n'] }, NOW)).toEqual({ options: ['Ja', 'Nein'], max: 1, closesAt: null, results: 'voted', named: false });
  });
  it('[F-470] Grenzen fail closed', () => {
    const err = (raw: unknown) => ('error' in (readPollConfig(raw, NOW) as object) ? (readPollConfig(raw, NOW) as { error: string }).error : 'ok');
    expect(err(null)).toBe('invalid_poll');
    expect(err({ options: 'a,b' })).toBe('invalid_poll');
    expect(err({ options: ['a', 'b'], named: 'ja' })).toBe('invalid_poll');
    expect(err({ options: ['a', 'b'], max: 1.5 })).toBe('invalid_max');
    expect(err({ options: ['a', 'b'], closesAt: NOW + 90 * DAY })).toBe('ok');
    expect(err({ options: ['a', 'b'], closesAt: NOW })).toBe('invalid_closes_at');
    expect(err({ options: ['a', 'b'], closesAt: '2026-12-01' })).toBe('invalid_closes_at');
    expect(err({ options: [1, 2] })).toBe('invalid_options');
  });
  it('[F-470] gespeicherte Daten: kaputt → null, Unbekanntes → Standard', () => {
    expect(parsePollData('{')).toBeNull();
    expect(parsePollData('{}')).toBeNull();
    expect(parsePollData(JSON.stringify({ poll: { options: ['a', 'b'], results: 'x', max: 0 } }))).toEqual({ options: ['a', 'b'], max: 1, closesAt: null, results: 'voted', named: false });
  });
});

describe('F-471 Stimmen', () => {
  it('[F-471] gültige Auswahl: verschieden, im Bereich, höchstens max, sortiert; leer = zurücknehmen', () => {
    expect(validChoices(cfg({ max: 2 }), [2, 0])).toEqual([0, 2]);
    expect(validChoices(cfg(), [])).toEqual([]);
    expect(validChoices(cfg(), [0, 1])).toBeNull();
    expect(validChoices(cfg({ max: 3 }), [0, 0])).toBeNull();
    expect(validChoices(cfg(), [3])).toBeNull();
    expect(validChoices(cfg(), [-1])).toBeNull();
    expect(validChoices(cfg(), ['0'])).toBeNull();
    expect(validChoices(cfg(), null)).toBeNull();
  });
});

describe('F-473 Ergebnis', () => {
  it('[F-473] Matrix der Regel', () => {
    const v = (results: PollConfig['results'], isAuthor: boolean, voted: boolean, open: boolean) => canSeeResults({ results }, { isAuthor, voted, open });
    expect(v('voted', false, false, true)).toBe(false);
    expect(v('voted', false, true, true)).toBe(true);
    expect(v('voted', false, false, false)).toBe(true);
    expect(v('always', false, false, true)).toBe(true);
    expect(v('closed', false, true, true)).toBe(false);
    expect(v('closed', false, false, false)).toBe(true);
    expect(v('closed', true, false, true)).toBe(true);
  });
  it('[F-473] viewPoll: Zähler nur mit Sicht, eigene Wahl immer, beenden nur Autor:in offen; Prozent der Teilnehmenden', () => {
    const t = { counts: [2, undefined as unknown as number, 1], voters: 3, mine: [0] };
    expect(viewPoll(cfg(), t, { isAuthor: false }, NOW)).toMatchObject({ open: true, counts: [2, 0, 1], voters: 3, mine: [0], canClose: false });
    expect(viewPoll(cfg(), { ...t, mine: [] }, { isAuthor: false }, NOW)).toMatchObject({ counts: null, voters: null });
    expect(viewPoll(cfg({ closesAt: NOW - 1 }), { ...t, mine: [] }, { isAuthor: true }, NOW)).toMatchObject({ open: false, canClose: false, counts: [2, 0, 1] });
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(0, 0)).toBe(0);
  });
});

describe('F-477 Datenschutztext', () => {
  it('[F-477] nennt Stimmen, anonym/namentlich, Frist und Löschwege', async () => {
    const { datenschutz } = await import('../src/content/legal');
    const t = JSON.stringify(datenschutz());
    expect(t).toContain('Stimmen in Umfragen: solange die Umfrage besteht');
    expect(t).toMatch(/Umfragen sind standardmäßig anonym/);
    expect(t).toContain('deine Stimmen in Umfragen anderer');
  });
});

describe('F-476 Texte', () => {
  it('[F-476] neue Umfrage: mit Ort „fragt in …“, im Profil ohne Ort; beendet mit bzw. ohne Gruppe', async () => {
    const { notificationText } = await import('../src/domain/notifications');
    const actor = { name: 'Anna', handle: 'anna' };
    expect(notificationText({ kind: 'post', count: 1, actor, title: 'PYC', what: 'poll' })).toBe('Anna fragt in „PYC“: neue Umfrage');
    expect(notificationText({ kind: 'post', count: 1, actor, title: '', what: 'poll' })).toBe('Anna hat eine Umfrage gestartet');
    expect(notificationText({ kind: 'poll_closed', count: 1, actor: null, title: '', what: 'deinen Beitrag' })).toBe('Deine Umfrage ist beendet – das Ergebnis steht fest');
    expect(notificationText({ kind: 'poll_closed', count: 1, actor: null, title: 'PYC', what: 'deinen Beitrag in' })).toBe('Deine Umfrage in „PYC“ ist beendet – das Ergebnis steht fest');
  });
});

describe('F-478 Arten mit eigener Karte', () => {
  it('[F-478] Schlüssel aus /p/<id>/<schlüssel>; Karte nur für Arten mit Nutzlast; Grenzen je Art an einer Stelle', async () => {
    const { postKeyOf, hasKindCard, COMPOSE_LIMITS } = await import('../src/domain/posts');
    expect(postKeyOf('/p/P1/KEY123')).toBe('KEY123');
    expect(postKeyOf('/p/P1')).toBeNull();
    expect(postKeyOf(undefined)).toBeNull();
    expect([hasKindCard('poll'), hasKindCard('text'), hasKindCard('voyage'), hasKindCard(undefined)]).toEqual([true, false, false, false]);
    expect(COMPOSE_LIMITS.poll).toEqual({ bodyMax: 300, plain: true });
  });
});
