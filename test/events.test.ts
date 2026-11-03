// Veranstaltungen (Konzept 30): reine Regeln aus src/domain/events.ts – Prüfung der Eingaben, Titel im `body`, Zusage
// und Kapazität, Kalender-Datei, Vorlage für das Fahrtenbuch.
import { describe, expect, it } from 'vitest';
import {
  EVENT_LIMITS, applyRsvp, canTakeToLogbook, emptyCounts, eventBody, eventChanged, eventIcs, eventWhen, freePlaces, icsFileName, logbookPreset, parseEventInput,
  rsvpProblem, splitEventBody, type EventView,
} from '../src/domain/events';
import { parseLog, hasLog } from '../src/domain/logbook';
import { CHOOSABLE, DEFAULT_CHANNELS, mailLine, notificationText } from '../src/domain/notifications';

const NOW = Date.UTC(2026, 5, 1, 10);
const H = 3_600_000;
const ok = { type: 'meet', startsAt: NOW + 24 * H, endsAt: NOW + 26 * H, place: ' Vereinsheim ', capacity: '' };
const view = (o: Partial<EventView> = {}): EventView => ({
  type: 'meet', startsAt: NOW + H, endsAt: NOW + 3 * H, place: '', capacity: null, cancelled: false, counts: emptyCounts(), mine: null, own: false, updatedAt: NOW, sequence: 0, ...o,
});

describe('F-480 Eingaben prüfen', () => {
  it('[F-480] gültig: Art, Beginn/Ende, Ort bereinigt, Kapazität leer = ohne Grenze', () => {
    expect(parseEventInput(ok, NOW)).toEqual({ event: { type: 'meet', startsAt: ok.startsAt, endsAt: ok.endsAt, place: 'Vereinsheim', capacity: null }, description: '' });
    expect(parseEventInput({ ...ok, description: ' Kuchen mitbringen ' }, NOW)).toMatchObject({ description: 'Kuchen mitbringen' });
    expect(parseEventInput({ ...ok, capacity: 12 }, NOW)).toMatchObject({ event: { capacity: 12 } });
  });

  it('[F-480] Fehler: Art, Ende vor Beginn, länger als 14 Tage, vorbei, zu weit voraus, Ort zu lang, Kapazität außerhalb 1–500', () => {
    const bad = [
      { ...ok, type: 'party' },
      { ...ok, endsAt: ok.startsAt },
      { ...ok, endsAt: ok.startsAt + EVENT_LIMITS.maxDurationMs + 1 },
      { ...ok, startsAt: NOW - 3 * H, endsAt: NOW - H },
      { ...ok, startsAt: NOW + EVENT_LIMITS.aheadMs + H, endsAt: NOW + EVENT_LIMITS.aheadMs + 2 * H },
      { ...ok, place: 'x'.repeat(EVENT_LIMITS.placeMax + 1) },
      { ...ok, capacity: 0 },
      { ...ok, capacity: 501 },
      { ...ok, capacity: 2.5 },
      { ...ok, startsAt: 'morgen' },
      { ...ok, description: 'x'.repeat(EVENT_LIMITS.descriptionMax + 1) },
      null,
    ];
    for (const b of bad) expect(parseEventInput(b, NOW), JSON.stringify(b)).toHaveProperty('error');
  });

  it('[F-480] Titel in der ersten Zeile von body, Beschreibung darunter (Konzept 30.3)', () => {
    expect(eventBody('Ansegeln', '')).toBe('Ansegeln');
    // der Titel bleibt eine Zeile
    expect(eventBody('  Ansegeln\n2026 ', '')).toBe('Ansegeln 2026');
    expect(eventBody('Ansegeln', ' Kuchen mitbringen\nab 10 Uhr ')).toBe('Ansegeln\nKuchen mitbringen\nab 10 Uhr');
    expect(splitEventBody('Ansegeln\nKuchen mitbringen\nab 10 Uhr')).toEqual({ title: 'Ansegeln', description: 'Kuchen mitbringen\nab 10 Uhr' });
    expect(splitEventBody('Ansegeln')).toEqual({ title: 'Ansegeln', description: '' });
  });

  it('[F-480] Termin als Text – ein Tag bzw. mehrtägig', () => {
    const a = new Date(2026, 5, 13, 18).getTime();
    expect(eventWhen({ startsAt: a, endsAt: a + 4 * H })).toBe('Sa., 13.06.2026, 18:00–22:00');
    expect(eventWhen({ startsAt: a, endsAt: a + 22 * H })).toBe('Sa., 13.06.2026, 18:00 – So., 14.06.2026, 16:00');
  });
});

describe('F-481 F-482 Zusage und Kapazität', () => {
  it('[F-482] voll: „Nehme teil“ gesperrt, „Vielleicht“ und „Nehme nicht teil“ gehen; die eigene Zusage hält ihren Platz', () => {
    const full = view({ capacity: 2, counts: { yes: 2, maybe: 0, no: 0 } });
    expect(rsvpProblem(full, 'yes', NOW)).toBe('full');
    expect(rsvpProblem(full, 'maybe', NOW)).toBeNull();
    expect(rsvpProblem(full, 'no', NOW)).toBeNull();
    expect(rsvpProblem({ ...full, mine: 'yes' }, 'yes', NOW)).toBeNull();
    expect(freePlaces(full)).toBe(0);
    expect(freePlaces(view())).toBeNull();
  });

  it('[F-481] abgesagt bzw. vorbei: keine Zusage mehr', () => {
    expect(rsvpProblem(view({ cancelled: true }), 'maybe', NOW)).toBe('cancelled');
    expect(rsvpProblem(view({ endsAt: NOW }), 'no', NOW)).toBe('over');
  });

  it('[F-481] sofortige Anzeige: Zähler wandern mit der eigenen Zusage', () => {
    const a = applyRsvp(view(), 'yes');
    expect(a.counts).toEqual({ yes: 1, maybe: 0, no: 0 });
    expect(applyRsvp(a, 'maybe')).toMatchObject({ mine: 'maybe', counts: { yes: 0, maybe: 1, no: 0 } });
  });

  it('[F-484] Änderung für Zusagen: Beginn, Ende oder Ort – nicht Art oder Kapazität', () => {
    const e = { startsAt: 1, endsAt: 2, place: 'A' };
    expect(eventChanged(e, { ...e })).toBe(false);
    expect(eventChanged(e, { ...e, place: 'B' })).toBe(true);
    expect(eventChanged(e, { ...e, startsAt: 0 })).toBe(true);
  });
});

describe('F-486 Kalender-Datei', () => {
  it('[F-486] VEVENT mit UTC-Zeiten, Escaping, Faltung auf 75 Bytes, Stand (LAST-MODIFIED, SEQUENCE)', () => {
    const ics = eventIcs(
      { id: 'abc123', title: 'Ansegeln; mit Grill, Musik', description: 'Zeile 1\nZeile 2', url: 'https://segeln-potsdam.de/p/abc123', host: 'segeln-potsdam.de', place: 'Steg B', updatedAt: Date.UTC(2026, 5, 2, 9), sequence: 3, startsAt: Date.UTC(2026, 5, 13, 16), endsAt: Date.UTC(2026, 5, 13, 20) },
      NOW,
    );
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('DTSTART:20260613T160000Z\r\n');
    expect(ics).toContain('DTEND:20260613T200000Z\r\n');
    expect(ics).toContain('SUMMARY:Ansegeln\\; mit Grill\\, Musik\r\n');
    expect(ics).toContain('UID:abc123@segeln-potsdam.de');
    expect(ics).toContain('LOCATION:Steg B');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('LAST-MODIFIED:20260602T090000Z');
    expect(ics).toContain('SEQUENCE:3');
    for (const l of ics.split('\r\n')) expect(new TextEncoder().encode(l).length, l).toBeLessThanOrEqual(75);
    const long = eventIcs({ id: 'x', title: 'Ä'.repeat(80), description: '', url: 'u', host: 'h', place: '', updatedAt: 0, sequence: 0, startsAt: 0, endsAt: 1 }, NOW);
    expect(long).toContain('\r\n Ä');
    for (const l of long.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(icsFileName('Ansegeln 2026: Grillen!')).toBe('Ansegeln-2026-Grillen.ics');
  });
});

describe('F-487 Ins Fahrtenbuch übernehmen', () => {
  it('[F-487] nur mit „Nehme teil“, nach dem Ende, nicht bei Absage; Vorlage mit Datum, Titel und Verweis', () => {
    const past = view({ endsAt: NOW - H, startsAt: NOW - 3 * H });
    expect(canTakeToLogbook({ ...past, mine: 'yes' }, NOW)).toBe(true);
    expect(canTakeToLogbook({ ...past, mine: 'maybe' }, NOW)).toBe(false);
    expect(canTakeToLogbook({ ...past, mine: 'yes', cancelled: true }, NOW)).toBe(false);
    expect(canTakeToLogbook(view({ mine: 'yes' }), NOW)).toBe(false);
    expect(logbookPreset('PostIdAAAAAAAA1', 'Ansegeln', past)).toEqual({ startedAt: past.startsAt, title: 'Ansegeln', eventId: 'PostIdAAAAAAAA1' });
    // Zusatzangaben aus Phase 8 (Konzept 27.4): Regatta mit Namen, Arbeitsdienst/Training/Kurs als Posten
    expect(logbookPreset('PostIdAAAAAAAA1', 'Mittwochsregatta', { ...past, type: 'regatta' }).log).toEqual({ regatta: { name: 'Mittwochsregatta' } });
    expect(logbookPreset('PostIdAAAAAAAA1', 'Steg', { ...past, type: 'work' }).log).toEqual({ items: [{ name: 'Arbeitsdienst', n: 1 }] });
    // log.eventId: nur eine gültige ID, zählt nicht als Fahrtenbuch-Angabe
    expect(parseLog({ eventId: 'PostIdAAAAAAAA1' })).toEqual({ log: { eventId: 'PostIdAAAAAAAA1' } });
    expect(parseLog({ eventId: '../x' })).toEqual({ log: {} });
    expect(hasLog({ eventId: 'PostIdAAAAAAAA1' })).toBe(false);
  });
});

describe('F-485 Kanal und Texte', () => {
  it('[F-485] Kanal „Veranstaltungen“ wählbar, Standard Glocke; Texte je Anlass, Sammelmail ohne Namen', () => {
    expect(CHOOSABLE).toContain('event');
    expect(DEFAULT_CHANNELS.event).toBe('none');
    const base = { kind: 'event' as const, count: 1, actor: null, title: 'Ansegeln' };
    expect(notificationText({ ...base, what: 'reminder' })).toMatch(/„Ansegeln“: Erinnerung/);
    expect(notificationText({ ...base, what: 'changed' })).toMatch(/geändert/);
    expect(notificationText({ ...base, what: 'cancelled' })).toMatch(/abgesagt/);
    // Sammelmail: nur der Verlauf, nie der Titel (Konzept 30.3)
    expect(mailLine({ ...base, what: 'reminder', where: 'PYC' })).toBe('Veranstaltung in „PYC“: Erinnerung – die Veranstaltung beginnt bald');
    expect(mailLine({ ...base, what: 'changed' })).not.toContain('Ansegeln');
    expect(notificationText({ kind: 'rsvp', count: 3, actor: { name: 'Anna', handle: 'anna' }, title: 'Ansegeln', what: '' })).toBe('Anna und 2 weitere haben auf „Ansegeln“ geantwortet');
  });
});
