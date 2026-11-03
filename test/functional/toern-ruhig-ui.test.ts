// @vitest-environment happy-dom
// Ruhigere Törn-Seitenleiste (UX-NAVIGATION Abschnitt 8, F-510 … F-514): Zahnrad-Menü im Törn-Kopf, eigene Rolle
// kompakt, Crew-Verwaltung erst im Bearbeiten-Modus, Einladen und Kommentarfeld erst nach Klick.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-voyage-byline';
import '../../src/components/sx-crew';
import '../../src/components/sx-comments';
import '../../src/components/sx-track-list';
import { voyageMenuItems } from '../../src/components/sx-voyage-byline';
import { P, makeTrack } from './helpers';
import type { Crew, ShareMeta } from '../../src/services/api';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const buttons = (root: ShadowRoot) => [...root.querySelectorAll('button')];
const button = (el: LitEl, label: RegExp) =>
  buttons(el.shadowRoot).find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');

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

const crew = (over: Record<string, unknown> = {}) =>
  ({ members: [], others: 0, isOwner: false, isCrew: false, isSkipper: false, ownerRole: null, ownerConfirmed: null, me: null, invites: [], ...over }) as unknown as Crew;
const tom = { id: 'U1', handle: null, displayName: 'Tom', role: 'crew', confirmed: null };
const share = (over: Record<string, unknown> = {}) => ({ id: 'S1', title: 'Havel', isOwner: false, sailor: null, groups: [], commentsMode: 'on', ...over }) as unknown as ShareMeta;
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

describe('F-510 Zahnrad-Menü im Törn-Kopf', () => {
  it('[F-510] Einträge je Betrachter: Gast nur Melden, Crew verlassen, Eigentümer:in Crew bearbeiten und Kommentar-Einstellung', () => {
    expect(ids(voyageMenuItems(share(), null))).toEqual(['report']);
    expect(ids(voyageMenuItems(share(), crew({ members: [tom], isCrew: true })))).toEqual(['crew-leave', 'report']);
    // Skipper:in aus der Crew bestätigt auch die Eigentümer:in
    expect(ids(voyageMenuItems(share(), crew({ isCrew: true, isSkipper: true, ownerRole: 'co' })))).toEqual(['crew-edit', 'crew-leave', 'report']);
    const owner = voyageMenuItems(share({ isOwner: true, commentsMode: 'off' }), crew({ isOwner: true, members: [tom] }));
    expect(ids(owner)).toEqual(['crew-edit', 'comments-on', 'comments-off', 'comments-hidden']);
    expect(owner.find((i) => i.pressed)!.id).toBe('comments-off');
    // ohne Crew gibt es nichts zu bearbeiten; ohne Einträge kein Zahnrad
    expect(ids(voyageMenuItems(share({ isOwner: true, commentsMode: undefined }), crew({ isOwner: true })))).toEqual([]);
  });

  it('[F-510] Auswahl meldet sx-report, sx-crew-leave, sx-crew-edit bzw. sx-comments-mode; die Panels tragen das nicht mehr', async () => {
    const reports = listen('sx-report');
    const leaves = listen('sx-crew-leave');
    const edits = listen('sx-crew-edit');
    const modes = listen('sx-comments-mode');
    const pick = (el: LitEl, id: string) =>
      el.shadowRoot.querySelector('sx-page-menu')!.dispatchEvent(new CustomEvent('sx-page-menu-pick', { detail: { id } }));
    const guest = await mount('sx-voyage-byline', { share: share(), crew: crew({ members: [tom], isCrew: true }) });
    expect(guest.shadowRoot.querySelector('sx-page-menu')).not.toBeNull();
    pick(guest, 'report');
    pick(guest, 'crew-leave');
    const owner = await mount('sx-voyage-byline', { share: share({ isOwner: true }), crew: crew({ isOwner: true, members: [tom] }) });
    pick(owner, 'crew-edit');
    pick(owner, 'comments-hidden');
    expect(reports).toEqual([{ kind: 'share', id: 'S1', label: 'diesen Törn' }]);
    expect(leaves).toHaveLength(1);
    expect(edits).toHaveLength(1);
    expect(modes).toEqual([{ mode: 'hidden' }]);

    const c = await mount('sx-comments', { shareId: 'S1', data: { mode: 'on', comments: [], canComment: true, block: null, isOwner: true, limits: { maxLength: 1000, maxLinks: 2 } } });
    expect(c.shadowRoot.querySelector('select')).toBeNull();
    const member = await mount('sx-crew', { crew: crew({ members: [tom], isCrew: true, me: { role: 'crew', confirmed: null } }) });
    expect(button(member, /Mich aus der Crew|verlassen/)).toBeUndefined();
  });
});

describe('F-511 eigene Rolle kompakt', () => {
  it('[F-511] „Deine Rolle“ zeigt die Rolle als Text; erst ein Klick öffnet die Auswahl, Wählen schließt sie wieder', async () => {
    const roles = listen('sx-crew-role');
    const el = await mount('sx-crew', { crew: crew({ isCrew: true, members: [tom], me: { role: 'crew', confirmed: { at: Date.now(), by: 'Lisa' } } }) });
    expect(el.shadowRoot.querySelector('select')).toBeNull();
    expect(text(el)).toContain('Deine Rolle');
    expect(text(el)).toContain('bestätigt von Lisa');
    button(el, /Deine Rolle ändern: Crew/)!.click();
    await el.updateComplete;
    const sel = el.shadowRoot.querySelector('select')!;
    sel.value = 'guest';
    sel.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(roles).toEqual([{ userId: 'me', role: 'guest' }]);
    expect(el.shadowRoot.querySelector('select')).toBeNull();
    expect(el.shadowRoot.activeElement).toBe(button(el, /Deine Rolle ändern/)); // Fokus zurück auf die Rolle
    // Fokus verlässt die Auswahl: zu – außer während der Skipper-Rückfrage
    button(el, /Deine Rolle ändern/)!.click();
    await el.updateComplete;
    el.shadowRoot.querySelector('select')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: document.body }));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('select')).toBeNull();
    // eingetragene Skipper:in aus der Crew: nur Anzeige, kein Ändern
    const skipper = await mount('sx-crew', { crew: crew({ isCrew: true, isSkipper: true, me: { role: 'skipper', confirmed: null } }) });
    expect(button(skipper, /Deine Rolle ändern/)).toBeUndefined();
    // Eigentümer:in ohne Rolle: „Rolle wählen“
    const owner = await mount('sx-crew', { isOwner: true, crew: crew({ isOwner: true }) });
    expect(button(owner, /Deine Rolle ändern: keine/)!.textContent).toContain('Rolle wählen');
  });
});

describe('F-512 Crew-Verwaltung im Bearbeiten-Modus', () => {
  it('[F-512] ohne Bearbeiten nur Namen, Rollen und „bestätigt“; im Bearbeiten-Modus Rollen, Entfernen, Bestätigen und „Fertig“', async () => {
    const members = [{ ...tom, confirmed: { at: Date.now(), by: 'Lisa' } }, { id: 'U2', handle: null, displayName: 'Mara', role: 'guest', confirmed: null }];
    const el = await mount('sx-crew', { isOwner: true, crew: crew({ isOwner: true, isSkipper: true, ownerRole: 'skipper', members }) });
    expect(el.shadowRoot.querySelectorAll('select')).toHaveLength(0);
    expect(button(el, /Entfernen|Bestätigen|Alle bestätigen/)).toBeUndefined();
    expect(text(el)).toContain('bestätigt von Lisa');
    el.editing = true;
    await el.updateComplete;
    expect(el.shadowRoot.activeElement?.getAttribute('aria-label')).toBe('Rolle von Tom'); // Fokus aufs erste Bearbeiten-Element
    expect([...el.shadowRoot.querySelectorAll('select')].map((s) => s.getAttribute('aria-label'))).toEqual(['Rolle von Tom', 'Rolle von Mara']);
    expect(button(el, /Aus der Crew entfernen: Mara/)).toBeDefined();
    expect(button(el, /bestätigen: Mara/)).toBeDefined();
    expect(button(el, /Alle bestätigen/)).toBeDefined();
    expect(button(el, /^\s*Einladen/)).toBeUndefined(); // Einladen erst wieder nach „Fertig“
    button(el, /Fertig/)!.click();
    await el.updateComplete;
    expect(el.editing).toBe(false);
    expect(el.shadowRoot.querySelectorAll('select')).toHaveLength(0);
  });
});

describe('F-513 Einladen nach Klick', () => {
  it('[F-513] „+ Einladen“ nennt offene Einladungen und klappt Rolle, Link, E-Mail und Liste auf bzw. zu', async () => {
    const invite = { id: 'I1', email: 'mate@example.org', invitee: null, usesLeft: 1, createdAt: 0, expiresAt: Date.now() + 86_400_000 };
    const el = await mount('sx-crew', { isOwner: true, visibility: 'public', crew: crew({ isOwner: true, invites: [invite] }) });
    const toggle = button(el, /Einladen/)!;
    expect(toggle.textContent).toContain('1 offen');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    expect(text(el)).not.toContain('mate@example.org');
    toggle.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('form')).not.toBeNull();
    expect(text(el)).toContain('mate@example.org');
    expect(button(el, /Einladungslink erzeugen/)).toBeDefined();
    button(el, /Einladen schließen/)!.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    // Besucher und Crew sehen kein Einladen
    const visitor = await mount('sx-crew', { crew: crew({ members: [tom], isCrew: true, me: { role: 'crew', confirmed: null } }) });
    expect(button(visitor, /Einladen/)).toBeUndefined();
  });
});

describe('F-514 Kommentarfeld nach Klick', () => {
  const list = (over: Record<string, unknown> = {}) => ({
    mode: 'on', comments: [], canComment: true, block: null, isOwner: false, limits: { maxLength: 1000, maxLinks: 2 }, ...over,
  });

  it('[F-514] erst „Kommentieren“ zeigt das Feld (mit Fokus), „Abbrechen“ und erfolgreiches Absenden klappen es zu', async () => {
    const el = await mount('sx-comments', { shareId: 'S1', data: list() });
    expect(el.shadowRoot.querySelector('textarea')).toBeNull();
    expect(text(el)).not.toContain('Reiner Text');
    button(el, /Kommentieren/)!.click();
    await el.updateComplete;
    const ta = el.shadowRoot.querySelector('textarea')!;
    expect(el.shadowRoot.activeElement).toBe(ta);
    button(el, /Abbrechen/)!.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('textarea')).toBeNull();
    expect(el.shadowRoot.activeElement).toBe(button(el, /Kommentieren/)); // Fokus zurück auf „Kommentieren“
    // Absenden: der Controller leert den Text und klappt das Formular zu (CommunityController.postComment)
    button(el, /Kommentieren/)!.click();
    await el.updateComplete;
    Object.assign(el, { draft: 'Ahoi', busy: true });
    await el.updateComplete;
    Object.assign(el, { draft: '', busy: false, writing: false });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('textarea')).toBeNull();
    expect(el.shadowRoot.activeElement).toBe(button(el, /Kommentieren/));
    // Fehler beim Absenden: Text und Feld bleiben
    button(el, /Kommentieren/)!.click();
    await el.updateComplete;
    Object.assign(el, { draft: 'Ahoi', busy: true });
    await el.updateComplete;
    Object.assign(el, { busy: false, error: 'Zu schnell' });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('textarea')!.value).toBe('Ahoi');
  });

  it('[F-514] Melden und Löschen je Kommentar erscheinen mit Maus erst bei Hover oder Fokus, auf Touch immer', async () => {
    const el = await mount('sx-comments', { data: list() });
    const css = (el.constructor as unknown as { elementStyles: Array<{ cssText: string }> }).elementStyles.map((s) => s.cssText).join('\n');
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*li \.tools\s*\{\s*opacity: 0/);
    expect(css).toMatch(/li:focus-within \.tools/);
  });

  it('[F-514] lange Track-Namen verbreitern die Seitenleiste nicht (Spalte minmax(0, 1fr), Name mit Ellipse)', async () => {
    const name = 'Potsdam Yachthafen Testlang → Werder an der Havel Steg';
    const el = await mount('sx-track-list', { tracks: [makeTrack([P(52.4, 13, 0), P(52.41, 13.01, 60_000)], { id: 'T1', name })], readonly: true });
    expect(el.shadowRoot.querySelector('.name')!.getAttribute('title')).toBe(name);
    const css = (el.constructor as unknown as { elementStyles: Array<{ cssText: string }> }).elementStyles.map((s) => s.cssText).join('\n');
    expect(css).toMatch(/ul\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.name\s*\{[^}]*text-overflow: ellipsis/);
  });
});
