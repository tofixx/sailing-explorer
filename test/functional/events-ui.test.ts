// @vitest-environment happy-dom
// Oberfläche Veranstaltungen (Konzept 30): „+ Neu → Veranstaltung“ im einen Dialog (F-480), Karte im Stream mit Zusage,
// Kapazität, „Wer kommt?“, Kalender, Fahrtenbuch und „Ändern oder absagen“ (F-481 … F-487). Komponenten zeigen nur an
// und melden Absichten.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-compose-dialog';
import '../../src/components/sx-stream';
import '../../src/components/sx-event';
import '../../src/components/sx-event-dialog';
import '../../src/components/sx-logbook-form';
import type { ComposeTarget } from '../../src/domain/posts';
import type { StreamItem } from '../../src/domain/groups';
import { emptyCounts, type EventView } from '../../src/domain/events';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const settle = async (el: LitEl) => {
  await el.updateComplete;
  for (const child of el.shadowRoot.querySelectorAll('*')) if ('updateComplete' in child) await settle(child as LitEl);
  for (const child of el.querySelectorAll('*')) if ('updateComplete' in child) await settle(child as LitEl);
};
const text = (root: ShadowRoot | Element) => (root.textContent ?? '').replace(/\s+/g, ' ');
const button = (root: ParentNode, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;

let cleanups: Array<() => void> = [];
function listen(name: string) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  document.addEventListener(name, fn);
  cleanups.push(() => document.removeEventListener(name, fn));
  return got;
}
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
  document.body.innerHTML = '';
});

const H = 3_600_000;
const ev = (o: Partial<EventView> = {}): EventView => ({
  type: 'regatta', startsAt: Date.now() + 24 * H, endsAt: Date.now() + 26 * H, place: 'Steg B', capacity: null, cancelled: false, counts: emptyCounts(), mine: null, own: false, updatedAt: Date.now(), sequence: 0, ...o,
});
const eventCard = (o: Partial<EventView> = {}, shareKey: string | null = null) =>
  mount('sx-event', { postId: 'EvtAAAAAAAAAAAA1', body: 'Mittwochsregatta\nStart 18 Uhr', shareKey, event: ev(o) });

describe('sx-event: Karte', () => {
  it('[F-480] Titel aus der ersten Zeile, Art, Termin, Ort, Beschreibung, Zähler mit freien Plätzen', async () => {
    const el = await eventCard({ capacity: 10, counts: { yes: 3, maybe: 1, no: 2 } });
    const t = text(el.shadowRoot);
    // Titel und Beschreibung stehen im Text des Beitrags darüber (sx-stream), nicht doppelt in der Karte
    expect(text(el.shadowRoot)).not.toContain('Mittwochsregatta');
    expect(t).toContain('Regatta');
    expect(t).toContain('Steg B');
    expect(t).toContain('3 nehmen teil · 1 vielleicht · 7 von 10 Plätzen frei');
  });

  it('[F-481] Zusage: sofort gedrückt und gezählt, ein Event mit Schlüssel aus dem Pfad; dieselbe noch einmal meldet nichts', async () => {
    const got = listen('sx-rsvp');
    const el = await eventCard({}, 'geheimerSchluessel1');
    button(el.shadowRoot, /Nehme teil/)!.click();
    await el.updateComplete;
    expect(button(el.shadowRoot, /^\s*Nehme teil/)!.getAttribute('aria-pressed')).toBe('true');
    expect(text(el.shadowRoot)).toContain('1 nimmt teil');
    expect(got).toMatchObject([{ id: 'EvtAAAAAAAAAAAA1', status: 'yes', key: 'geheimerSchluessel1' }]);
    button(el.shadowRoot, /^\s*Nehme teil/)!.click();
    expect(got).toHaveLength(1);
    // Antwort des Servers ersetzt die sofortige Anzeige
    el.event = ev({ counts: { yes: 5, maybe: 0, no: 0 }, mine: 'yes' });
    await el.updateComplete;
    expect(text(el.shadowRoot)).toContain('5 nehmen teil');
  });

  it('[F-482] voll: „Nehme teil“ gesperrt mit Hinweis, „Vielleicht“ geht', async () => {
    const el = await eventCard({ capacity: 2, counts: { yes: 2, maybe: 0, no: 0 } });
    const yes = button(el.shadowRoot, /^\s*Nehme teil/)!;
    expect(yes.disabled).toBe(true);
    expect(yes.title).toMatch(/Alle Plätze/);
    expect(button(el.shadowRoot, /Vielleicht/)!.disabled).toBe(false);
    expect(text(el.shadowRoot)).toContain('alle Plätze vergeben');
  });

  it('[F-484] abgesagt: Kennzeichen, keine Zusage-Knöpfe, kein Kalender, kein Ändern', async () => {
    const el = await eventCard({ cancelled: true, own: true });
    expect(text(el.shadowRoot)).toContain('Abgesagt');
    expect(button(el.shadowRoot, /Nehme teil/)).toBeUndefined();
    expect(button(el.shadowRoot, /Kalender/)).toBeUndefined();
    expect(button(el.shadowRoot, /Ändern/)).toBeUndefined();
  });

  it('[F-484] [F-486] [F-483] Autor:in sieht „Ändern oder absagen“; Kalender und „Wer kommt?“ melden Events; Namen mit Link nur bei öffentlichem Profil', async () => {
    const edits = listen('sx-event-edit');
    const ics = listen('sx-event-ics');
    const who = listen('sx-rsvp-who');
    const el = await eventCard({ own: true });
    button(el.shadowRoot, /Ändern oder absagen/)!.click();
    button(el.shadowRoot, /In den Kalender/)!.click();
    button(el.shadowRoot, /Wer kommt/)!.click();
    await el.updateComplete;
    expect(edits).toMatchObject([{ id: 'EvtAAAAAAAAAAAA1' }]);
    expect(ics).toMatchObject([{ id: 'EvtAAAAAAAAAAAA1', title: 'Mittwochsregatta', description: 'Start 18 Uhr' }]);
    expect(who).toHaveLength(1);
    expect(text(el.shadowRoot)).toContain('Lade');
    el.who = { people: { yes: [{ displayName: 'Anna', handle: 'anna' }, { displayName: 'Bo', handle: null }], maybe: [], no: [] }, others: { yes: 2, maybe: 0, no: 0 }, all: false };
    await el.updateComplete;
    const list = el.shadowRoot.querySelector('ul')!;
    expect(text(list)).toContain('Nehme teil: Anna, Bo + 2 weitere');
    expect(list.querySelector('a')?.getAttribute('href')).toBe('/u/anna');
    expect(list.querySelectorAll('a')).toHaveLength(1);
    const other = await eventCard({ own: false });
    expect(button(other.shadowRoot, /Ändern/)).toBeUndefined();
  });

  it('[F-487] „Ins Fahrtenbuch übernehmen“ nur mit „Nehme teil“ nach dem Ende – mit Vorlage', async () => {
    const past = { startsAt: Date.now() - 5 * H, endsAt: Date.now() - 3 * H };
    const got = listen('sx-event-logbook');
    const maybe = await eventCard({ ...past, mine: 'maybe' });
    expect(button(maybe.shadowRoot, /Fahrtenbuch/)).toBeUndefined();
    expect(text(maybe.shadowRoot)).toContain('vorbei');
    const el = await eventCard({ ...past, mine: 'yes' });
    expect(button(el.shadowRoot, /Nehme teil/)).toBeUndefined();
    button(el.shadowRoot, /Ins Fahrtenbuch übernehmen/)!.click();
    // Regatta: Name als Zusatzangabe vorbelegt (Phase 8, Konzept 27.4)
    expect(got).toEqual([{ preset: { startedAt: past.startsAt, title: 'Mittwochsregatta', eventId: 'EvtAAAAAAAAAAAA1', log: { regatta: { name: 'Mittwochsregatta' } } } }]);
  });
});

describe('sx-stream: Nutzlast je Art', () => {
  it('[F-480] Beitrag der Art „event“ zeigt die Karte statt des Textes; Text-Beiträge unverändert', async () => {
    const base = { id: 'a1', kind: 'post' as const, createdAt: Date.now(), actor: null, group: null };
    const items: StreamItem[] = [
      { ...base, post: { id: 'EvtAAAAAAAAAAAA1', body: 'Ansegeln\nMit Grill', link: null, canDelete: false, kind: 'event', event: ev(), path: '/p/EvtAAAAAAAAAAAA1' } },
      { ...base, id: 'a2', post: { id: 'TxtAAAAAAAAAAAA1', body: 'Nur Text', link: null, canDelete: false } },
    ];
    const el = await mount('sx-stream', { items });
    await settle(el);
    const cards = el.shadowRoot.querySelectorAll('sx-event');
    expect(cards).toHaveLength(1);
    expect((cards[0] as unknown as LitEl).shadowRoot.querySelector('.rsvp')).not.toBeNull();
    expect([...el.shadowRoot.querySelectorAll('.body')].map((b) => b.textContent)).toEqual(['Ansegeln\nMit Grill', 'Nur Text']);
  });
});

const profile: ComposeTarget = { ref: { kind: 'user' }, id: '', choices: ['public'], reaches: [{ reach: 'here', label: 'Nur hier', chain: 'nur dein Profil' }] };
const team: ComposeTarget = { ref: { kind: 'group', slug: 'reg', name: 'Mittwochsregatta', groupKind: 'team' }, id: 'G1', choices: ['public', 'members'], reaches: [] };
const targets: ComposeTarget[] = [profile, team];

describe('sx-compose-dialog: Veranstaltung', () => {
  it('[F-480] Formularteil im einen Dialog: Text = Titel, Art, Termin, Ort, Plätze, Beschreibung; ohne Link; Senden mit kind und event', async () => {
    const got = listen('sx-compose-submit');
    const el = await mount('sx-compose-dialog', { open: true, targets, selected: 'group:reg', kind: 'event' });
    await settle(el);
    expect(text(el.shadowRoot)).toContain('Neue Veranstaltung');
    const composer = el.shadowRoot.querySelector('sx-post-composer') as LitEl;
    const form = el.shadowRoot.querySelector('sx-event-form') as LitEl;
    expect(form).not.toBeNull();
    expect(text(composer.shadowRoot)).not.toContain('Link (optional)');
    expect(text(composer.shadowRoot)).toContain('Titel');
    expect(text(form.shadowRoot)).toContain('Beschreibung (optional)');
    const cap = form.shadowRoot.querySelector<HTMLInputElement>('[name="capacity"]')!;
    cap.value = '12';
    cap.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    Object.assign(composer, { body: 'Ansegeln' });
    await settle(el);
    const submit = button(composer.shadowRoot, /Veröffentlichen/)!;
    expect(submit.disabled).toBe(false);
    composer.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(got).toHaveLength(1);
    const d = got[0] as { kind: string; body: string; channel: unknown; event: { type: string; capacity: number; startsAt: number; endsAt: number; description: string } };
    expect(d.kind).toBe('event');
    expect(d.channel).toEqual({ kind: 'group', id: 'G1' });
    expect(d.body).toBe('Ansegeln');
    expect(d.event).toMatchObject({ type: 'meet', capacity: 12, description: '' });
    expect(d.event.endsAt - d.event.startsAt).toBe(2 * H);
  });

  it('[F-480] ungültige Angaben (Ende vor Beginn): Veröffentlichen gesperrt', async () => {
    const el = await mount('sx-compose-dialog', { open: true, targets, kind: 'event' });
    await settle(el);
    const composer = el.shadowRoot.querySelector('sx-post-composer') as LitEl;
    const form = el.shadowRoot.querySelector('sx-event-form') as LitEl;
    const end = form.shadowRoot.querySelector<HTMLInputElement>('[name="end"]')!;
    end.value = '17:00';
    end.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    Object.assign(composer, { body: 'Ansegeln' });
    await settle(el);
    expect(button(composer.shadowRoot, /Veröffentlichen/)!.disabled).toBe(true);
  });
});

describe('sx-event-dialog und sx-logbook-form', () => {
  it('[F-484] Ändern: dasselbe Formular ohne Beschreibung, vorbelegt; Speichern und Absagen als Events', async () => {
    const saves = listen('sx-event-save');
    const cancels = listen('sx-event-cancel');
    // Uhrzeiten im Formular sind minutengenau
    const start = Math.ceil(Date.now() / 60_000) * 60_000 + 24 * H;
    const e = ev({ capacity: 8, startsAt: start, endsAt: start + 2 * H });
    const el = await mount('sx-event-dialog', { open: true, postId: 'EvtAAAAAAAAAAAA1', event: e });
    await settle(el);
    const form = el.shadowRoot.querySelector('sx-event-form') as LitEl;
    expect(form.shadowRoot.querySelector('[name="description"]')).toBeNull();
    expect(form.shadowRoot.querySelector<HTMLInputElement>('[name="capacity"]')!.value).toBe('8');
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saves).toMatchObject([{ id: 'EvtAAAAAAAAAAAA1', patch: { type: 'regatta', place: 'Steg B', capacity: 8, startsAt: e.startsAt, endsAt: e.endsAt } }]);
    button(el.shadowRoot, /Absagen/)!.click();
    expect(cancels).toEqual([{ id: 'EvtAAAAAAAAAAAA1' }]);
  });

  it('[F-487] Fahrtenbuch-Formular aus der Veranstaltung: Datum und Titel vorbelegt', async () => {
    const startedAt = new Date(2026, 5, 13, 10).getTime();
    const el = await mount('sx-logbook-form', { preset: { startedAt, title: 'Ansegeln', eventId: 'EvtAAAAAAAAAAAA1' }, open: true });
    await settle(el);
    expect(el.shadowRoot.querySelector<HTMLInputElement>('[name="date"]')!.value).toBe('2026-06-13');
    expect(el.shadowRoot.querySelector<HTMLInputElement>('[name="title"]')!.value).toBe('Ansegeln');
  });
});
