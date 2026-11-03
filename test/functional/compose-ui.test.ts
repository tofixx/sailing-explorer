// @vitest-environment happy-dom
// Oberfläche Phase 2 (Konzept 21.12): „+ Neu“ als ein Einstieg (F-405), Text-Dialog mit „Wo steht es?“ und „Sichtbar
// bis“ (F-405, F-409), Beitragskarte mit Anker, Permalink und Anhang (F-406, F-425, F-426), Konto-Menü (F-428).
// Komponenten zeigen nur an und melden Absichten.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-compose';
import '../../src/components/sx-compose-dialog';
import '../../src/components/sx-account-menu';
import '../../src/components/sx-stream';
import '../../src/components/sx-reach-picker';
import type { ComposeTarget } from '../../src/domain/posts';
import type { StreamItem } from '../../src/domain/groups';

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
  for (const child of el.shadowRoot.querySelectorAll('*')) if ('updateComplete' in child) await (child as LitEl).updateComplete;
};
const text = (root: ShadowRoot | Element) => (root.textContent ?? '').replace(/\s+/g, ' ');
const button = (root: ParentNode, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
const inner = (el: LitEl, tag: string) => el.shadowRoot.querySelector(tag) as LitEl;

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

const T = Date.UTC(2026, 10, 2, 10);

describe('sx-compose', () => {
  it('[F-405] [F-480] „+ Neu“: Menü mit Törn (GPX), Fahrtenbuch-Eintrag, Text, Veranstaltung – noch keine Fotos; ein Event je Wahl; Escape schließt', async () => {
    const opens = listen('sx-compose-open');
    const el = await mount('sx-compose', {});
    const toggle = button(el.shadowRoot, /Neu anlegen/)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await el.updateComplete;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const t = text(el.shadowRoot);
    expect(t).toContain('Törn (GPX)');
    expect(t).toContain('Fahrtenbuch-Eintrag');
    expect(t).toContain('Text');
    // Umfrage seit Phase 4 (Konzept 29, polls-ui.test.ts), Veranstaltung seit Phase 5 (Konzept 30), Fotos seit Phase 7
    expect(t).toContain('Veranstaltung');
    for (const label of [/Törn \(GPX\)/, /Fahrtenbuch-Eintrag/, /^\s*Text/, /^\s*Veranstaltung/]) {
      el.open = true;
      await el.updateComplete;
      [...el.shadowRoot.querySelectorAll('.item')].find((b) => label.test(b.textContent ?? ''))!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    expect(opens).toEqual([{ kind: 'gpx' }, { kind: 'logbook' }, { kind: 'text' }, { kind: 'event' }]);
    el.open = true;
    await el.updateComplete;
    el.shadowRoot.querySelector('div')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.open).toBe(false);
  });
});

const targets: ComposeTarget[] = [
  { ref: { kind: 'user' }, id: '', choices: ['public'], reaches: [{ reach: 'here', label: 'Nur hier', chain: 'nur dein Profil' }, { reach: 'all', label: 'Überall', chain: 'dein Profil → überall' }] },
  {
    ref: { kind: 'group', slug: 'reg', name: 'Mittwochsregatta', groupKind: 'team' }, id: 'G1', choices: ['public', 'members'],
    reaches: [
      { reach: 'here', label: 'Nur hier', chain: 'nur Mittwochsregatta' },
      { reach: 'club', label: 'Bis Verein', chain: 'Mittwochsregatta → PYC' },
      { reach: 'all', label: 'Überall', chain: 'Mittwochsregatta → PYC → überall' },
    ],
  },
  { ref: { kind: 'harbor', slug: 'potsdam', name: 'Potsdam' }, id: 'H1', choices: ['public'], reaches: [{ reach: 'here', label: 'Nur hier', chain: 'nur Hafen Potsdam' }, { reach: 'all', label: 'Überall', chain: 'Hafen Potsdam → überall' }] },
];

describe('sx-compose-dialog', () => {
  it('[F-405] [F-409] [F-445] „Wo steht es?“ vorausgewählt, in Gruppen „Nur Mitglieder“ vorgewählt, Stufen des Verlaufs mit Kette (Vorschlag „überall“), Anhang; meldet den Verlauf', async () => {
    const submits = listen('sx-compose-submit');
    const el = await mount('sx-compose-dialog', { open: true, targets, shares: [{ id: 'S1', title: 'Rügen', startedAt: T }], selected: 'group:reg' });
    await settle(el);
    const where = el.shadowRoot.querySelector('select') as HTMLSelectElement;
    expect([...where.options].map((o) => o.textContent!.trim())).toEqual(['Mein Profil', 'Team Mittwochsregatta', 'Hafen Potsdam']);
    expect(where.value).toBe('group:reg');
    const c = inner(el, 'sx-post-composer');
    await settle(c);
    // in Gruppen vorgewählt „Nur Mitglieder“ (F-445) – „Öffentlich“ wählt man bewusst
    const radios = c.shadowRoot.querySelectorAll('input[type="radio"]');
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    (radios[0] as HTMLInputElement).click();
    await settle(c);
    const picker = c.shadowRoot.querySelector('sx-reach-picker') as LitEl;
    await picker.updateComplete;
    expect(text(picker.shadowRoot)).toContain('Mittwochsregatta → PYC → überall');
    const reach = picker.shadowRoot.querySelector('select') as HTMLSelectElement;
    reach.value = 'club';
    reach.dispatchEvent(new Event('change'));
    const ta = c.shadowRoot.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Training heute';
    ta.dispatchEvent(new Event('input'));
    const att = [...c.shadowRoot.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'S1')) as HTMLSelectElement;
    att.value = 'S1';
    att.dispatchEvent(new Event('change'));
    await c.updateComplete;
    // Zähler erst ab 90 % ansagen
    expect(c.shadowRoot.querySelector('.counter')!.getAttribute('aria-live')).toBe('off');
    (c.shadowRoot.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(submits).toEqual([{ channel: { kind: 'group', id: 'G1' }, kind: 'text', body: 'Training heute', link: '', visibility: 'public', reach: 'club', shareId: 'S1' }]);
  });

  it('[F-409] nicht öffentlich: kein „Sichtbar bis“, nur der Hinweis; anderer Verlauf → seine Stufen', async () => {
    const submits = listen('sx-compose-submit');
    const el = await mount('sx-compose-dialog', { open: true, targets, shares: [], selected: 'group:reg' });
    await settle(el);
    const c = inner(el, 'sx-post-composer');
    await settle(c);
    (c.shadowRoot.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click();
    await settle(c);
    expect(text((c.shadowRoot.querySelector('sx-reach-picker') as LitEl).shadowRoot)).toContain('bleiben nur hier');
    const ta = c.shadowRoot.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Intern';
    ta.dispatchEvent(new Event('input'));
    await c.updateComplete;
    (c.shadowRoot.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(submits).toEqual([{ channel: { kind: 'group', id: 'G1' }, kind: 'text', body: 'Intern', link: '', visibility: 'members', shareId: null }]);
    const where = el.shadowRoot.querySelector('select') as HTMLSelectElement;
    where.value = 'harbor:potsdam';
    where.dispatchEvent(new Event('change'));
    await settle(el);
    expect(inner(el, 'sx-post-composer').reaches).toEqual(targets[2].reaches);
  });
});

describe('sx-stream: Beitragskarte', () => {
  const post = (o: Partial<NonNullable<StreamItem['post']>> = {}): StreamItem => ({
    id: 'A1', kind: 'post', createdAt: T, actor: { handle: 'anna', displayName: 'Anna' }, group: null,
    post: { id: 'P1', body: 'Kran defekt', link: null, canDelete: false, path: '/p/P1', where: { kind: 'harbor', slug: 'potsdam', name: 'Potsdam' }, voyage: { id: 'S1', title: 'Rügen', distNm: 12.5 }, ...o },
  });

  it('[F-406] [F-425] [F-426] Anker p-<id>, Zeit als Permalink, Hafen als „Wo steht es“, Anhang; hervorgehoben', async () => {
    const el = await mount('sx-stream', { items: [post()], scope: 'home', highlight: 'P1' });
    const li = el.shadowRoot.querySelector('li#p-P1')!;
    expect(li).not.toBeNull();
    expect(li.classList.contains('hl')).toBe(true);
    expect(el.shadowRoot.querySelector('a.when')!.getAttribute('href')).toBe('/p/P1');
    expect(el.shadowRoot.querySelector('a[href="/h/potsdam"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/s/S1"]')!.textContent).toBe('Rügen');
    expect(text(el.shadowRoot)).toContain('Beitrag im Hafen');
    // kein eigener Teilen-Knopf an der Karte (Teilen über den Permalink)
    expect(button(el.shadowRoot, /teilen/i)).toBeUndefined();
    // Törnkarte: Zeit führt zum Törn
    const voyage: StreamItem = { id: 'A2', kind: 'voyage', createdAt: T, actor: null, group: null, voyage: { id: 'S9', title: 'X', distNm: 1, startedAt: T, hasImage: false, boat: null } };
    const v = await mount('sx-stream', { items: [voyage] });
    expect(v.shadowRoot.querySelector('a.when')!.getAttribute('href')).toBe('/s/S9');
  });
});

describe('sx-stream: Pins (F-403)', () => {
  it('[F-403] Angepinnt über dem Stream; Verwalter pinnen, lösen und löschen fremde Beiträge im Hafen', async () => {
    const pins = listen('sx-pin');
    const deletes = listen('sx-post-delete');
    const item: StreamItem = {
      id: 'A1', kind: 'post', createdAt: T, actor: null, group: null,
      post: { id: 'P1', body: 'Kran', link: null, canDelete: false, path: '/p/P1', where: { kind: 'harbor', slug: 'potsdam', name: 'Potsdam' } },
    };
    const other: StreamItem = { ...item, id: 'A2', post: { ...item.post!, id: 'P2' } };
    const el = await mount('sx-stream', { scope: 'harbor', items: [item, other], pins: [item], manage: true });
    const section = el.shadowRoot.querySelector('section.pins')!;
    expect(text(section)).toContain('Angepinnt');
    expect(section.querySelectorAll('li')).toHaveLength(1);
    const list = [...el.shadowRoot.children].find((c) => c.tagName === 'OL')!;
    const lis = list.querySelectorAll('li');
    button(lis[0], /Lösen/)!.click();
    button(lis[1], /Anpinnen/)!.click();
    expect(pins).toEqual([{ postId: 'P1', pinned: false }, { postId: 'P2', pinned: true }]);
    button(lis[1], /Beitrag löschen/)!.click();
    expect(deletes).toEqual([{ id: 'P2' }]);
    const reader = await mount('sx-stream', { scope: 'harbor', items: [item], pins: [] });
    expect(button(reader.shadowRoot, /Anpinnen|Lösen/)).toBeUndefined();
    expect(button(reader.shadowRoot, /Beitrag löschen/)).toBeUndefined();
  });
});

describe('sx-account-menu', () => {
  it('[F-428] [F-459] Meine Seite, Mein Fahrtenbuch (Verwaltungsbereich), Konto & Einstellungen; Avatar mit dem Profilnamen', async () => {
    const accounts = listen('sx-account');
    const el = await mount('sx-account-menu', { user: { id: 'U1', email: 'x@example.org', handle: 'anna', displayName: 'Anna' } });
    expect(el.shadowRoot.querySelector('.avatar')!.textContent).toBe('A');
    button(el.shadowRoot, /Mein Bereich/)!.click();
    await el.updateComplete;
    const links = [...el.shadowRoot.querySelectorAll('a.item')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toEqual([['Meine Seite', '/u/anna'], ['Mein Fahrtenbuch', '/konto/fahrtenbuch'], ['Wertung', '/konto/wertung']]);
    button(el.shadowRoot, /Konto & Einstellungen/)!.click();
    expect(accounts).toEqual([null]);
  });

  it('[F-428] ohne Profil führt „Meine Seite“ zum Anlegen des Profils; das Fahrtenbuch braucht keins (F-459)', async () => {
    const accounts = listen('sx-account');
    const el = await mount('sx-account-menu', { user: { id: 'U1', email: 'bo@example.org', handle: null, displayName: null }, open: true });
    expect(el.shadowRoot.querySelector('.avatar')!.textContent).toBe('b');
    expect([...el.shadowRoot.querySelectorAll('a.item')].map((a) => a.getAttribute('href'))).toEqual(['/konto/fahrtenbuch', '/konto/wertung']);
    button(el.shadowRoot, /Meine Seite/)!.click();
    expect(accounts).toEqual(['profile']);
  });
});
