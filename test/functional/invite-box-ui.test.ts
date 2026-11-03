// @vitest-environment happy-dom
// Ein Einladungsmuster (UX-NAVIGATION B14/B15, F-590 … F-592): `sx-invite-box` in Crew, Gruppe, Boots-Admins und
// „Freunde einladen“; Teilen mit Begleittext; „Freunde einladen“ auf der eigenen Seite über das Zahnrad.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-invite-box';
import '../../src/components/sx-crew';
import '../../src/components/sx-group-page';
import '../../src/components/sx-account-dialog';
import '../../src/components/sx-home-feed';
import '../../src/components/sx-profile-page';
import { inviteShareText, inviteShareTitle } from '../../src/domain/invite-text';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const DAY = 86_400_000;
const LINK = 'http://localhost/einladung#token=' + 'c'.repeat(43);

async function mount(tag: string, props: Record<string, unknown> = {}): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const text = (root: ShadowRoot) => (root.textContent ?? '').replace(/\s+/g, ' ');
const button = (root: ParentNode, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
async function box(el: LitEl): Promise<LitEl> {
  const b = el.shadowRoot.querySelector('sx-invite-box') as unknown as LitEl;
  await b.updateComplete;
  return b;
}
function submit(b: LitEl, value: string) {
  const form = b.shadowRoot.querySelector('form')!;
  form.querySelector('input')!.value = value;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
}

let cleanups: Array<() => void> = [];
function listen(name: string, target: EventTarget = document) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  target.addEventListener(name, fn);
  cleanups.push(() => target.removeEventListener(name, fn));
  return got;
}
const realShare = Object.getOwnPropertyDescriptor(navigator, 'share');
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
  document.body.innerHTML = '';
  if (realShare) Object.defineProperty(navigator, 'share', realShare);
  else delete (navigator as { share?: unknown }).share;
});

const pending = [
  { id: 'I1', email: 'mate@example.org', invitee: null, usesLeft: 1, createdAt: 0, expiresAt: Date.now() + DAY },
  { id: 'I2', email: null, invitee: { handle: 'mats', displayName: 'Mats' }, usesLeft: 1, createdAt: 0, expiresAt: Date.now() + DAY },
];

describe('F-590 sx-invite-box: ein Einladungsmuster', () => {
  it('[F-590] Link erzeugen, per E-Mail oder Profilname einladen, offene Einladungen zurückziehen – Events am Element, nicht global', async () => {
    const el = await mount('sx-invite-box', { pending });
    const creates = listen('invite-create', el);
    const revokes = listen('invite-revoke', el);
    const global = listen('invite-create');
    button(el.shadowRoot, /Einladungslink erzeugen/)!.click();
    submit(el, ' neu@example.org ');
    submit(el, '@anna');
    submit(el, '   '); // leer: nichts
    expect(creates).toEqual([{ to: null }, { to: { email: 'neu@example.org' } }, { to: { handle: 'anna' } }]);
    expect(global).toEqual([]); // die einbettende Komponente übersetzt in ihr eigenes Event
    expect(text(el.shadowRoot)).toContain('Mats (@mats)');
    expect(text(el.shadowRoot)).toContain('Per E-Mail erreichst du neue und bestehende Konten');
    button(el.shadowRoot, /Einladung zurückziehen: mate@example.org/)!.click();
    expect(revokes).toEqual([{ id: 'I1' }]);
  });

  it('[F-590] Rollenwahl nur mit `roles`, die Wahl geht mit; ohne Link-Möglichkeit kein Link-Knopf', async () => {
    const el = await mount('sx-invite-box', { roles: [{ value: 'co', label: 'Co' }, { value: 'crew', label: 'Crew' }], role: 'crew' });
    const creates = listen('invite-create', el);
    const sel = el.shadowRoot.querySelector('select[aria-label="Rolle für Einladungen"]') as HTMLSelectElement;
    expect(sel.value).toBe('crew');
    sel.value = 'co';
    sel.dispatchEvent(new Event('change'));
    button(el.shadowRoot, /Einladungslink erzeugen/)!.click();
    expect(creates).toEqual([{ to: null, role: 'co' }]);
    const admin = await mount('sx-invite-box', { noLink: true });
    expect(admin.shadowRoot.querySelector('select')).toBeNull();
    expect(button(admin.shadowRoot, /Einladungslink/)).toBeUndefined();
    expect(admin.shadowRoot.querySelector('form')).not.toBeNull();
  });

  it('[F-590] frischer Link: einmal sichtbar mit Hinweis, Kopieren meldet sx-invite-copy, kein zweiter „erzeugen“-Knopf', async () => {
    const copies = listen('sx-invite-copy');
    const el = await mount('sx-invite-box', { link: LINK, linkNote: 'Nur jetzt sichtbar · 14 Tage gültig.' });
    expect((el.shadowRoot.querySelector('input[readonly]') as HTMLInputElement).value).toBe(LINK);
    expect(text(el.shadowRoot)).toContain('Nur jetzt sichtbar · 14 Tage gültig.');
    expect(button(el.shadowRoot, /Einladungslink erzeugen/)).toBeUndefined();
    button(el.shadowRoot, /Kopieren/)!.click();
    expect(copies).toEqual([LINK]);
  });

  it('[F-590] alle vier Einladungsarten nutzen den Baustein und übersetzen in ihre bisherigen Events', async () => {
    // Crew
    const crewInv = listen('sx-crew-invite');
    const crewRev = listen('sx-invite-revoke');
    const crew = await mount('sx-crew', {
      isOwner: true, inviting: true, voyageTitle: 'Havel',
      crew: { members: [], others: 0, isOwner: true, isCrew: false, isSkipper: false, ownerRole: null, ownerConfirmed: null, me: null, invites: pending },
    });
    const cb = await box(crew);
    submit(cb, 'mats');
    button(cb.shadowRoot, /zurückziehen: mate@/)!.click();
    expect(crewInv).toEqual([{ to: { handle: 'mats' }, role: 'crew' }]);
    expect(crewRev).toEqual([{ id: 'I1', scope: 'crew' }]);
    expect(cb.shareText).toBe(inviteShareText({ kind: 'crew', target: 'Havel', role: 'crew' }));

    // Boots-Admins im Konto: kein Link
    const adminInv = listen('sx-boat-admin-invite');
    const acc = await mount('sx-account-dialog', {
      open: true, tab: 'boats', user: { id: 'U1234567890abcdefg', email: 'a@example.org' }, profile: null,
      boats: [{ id: 'B1234567890abcdefg', name: 'Albatros', boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '', visibility: 'public', shareKey: null, link: '/b/B1', createdAt: 0, updatedAt: 0, owner: null, role: 'owner' }],
    });
    button(acc.shadowRoot, /^Admins: Albatros/)!.click();
    acc.admins = { boatId: 'B1234567890abcdefg', data: { role: 'owner', admins: [], invites: [] } };
    await acc.updateComplete;
    const ab = await box(acc);
    expect(ab.noLink).toBe(true);
    submit(ab, 'crew@example.org');
    expect(adminInv).toEqual([{ boatId: 'B1234567890abcdefg', to: { email: 'crew@example.org' } }]);

    // Willkommens-Karte: Freunde einladen
    const friends = listen('sx-friend-invite');
    const feed = await mount('sx-home-feed', { signedIn: true, stream: { items: [], cursor: null, hasGroups: false }, groups: [], publicGroups: [] });
    const fb = await box(feed);
    submit(fb, 'freund@example.org');
    expect(friends).toEqual([{ to: { email: 'freund@example.org' } }]);
    expect(fb.shareText).toBe(inviteShareText({ kind: 'friend', target: null }));
  });
});

describe('F-591 Teilen mit Begleittext', () => {
  it('[F-591] Texte je Einladungsart nennen Ziel und App, ohne den Link', () => {
    expect(inviteShareTitle()).toBe('Einladung zu Luv & Leute');
    expect(inviteShareText({ kind: 'friend', target: null })).toContain('folgen wir einander');
    expect(inviteShareText({ kind: 'group', groupKind: 'team', target: 'Jolle 7' })).toBe('Ich lade dich ins Team „Jolle 7“ bei Luv & Leute ein:');
    expect(inviteShareText({ kind: 'group', groupKind: 'club', target: 'SC Kiel' })).toContain('in den Verein „SC Kiel“');
    expect(inviteShareText({ kind: 'crew', target: 'Havel', role: 'co' })).toBe('Ich lade dich als Co-Skipper:in in die Crew meines Törns „Havel“ bei Luv & Leute ein:');
    expect(inviteShareText({ kind: 'crew', target: null })).toContain('„Törn“');
  });

  it('[F-591] mit Teilen-Menü des Geräts: „Teilen“ meldet sx-invite-share mit Link, Titel und Text', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} });
    const shares = listen('sx-invite-share');
    const el = await mount('sx-invite-box', { link: LINK, shareTitle: 'Einladung zu Luv & Leute', shareText: 'Komm dazu:' });
    expect(el.shadowRoot.querySelector('a[href^="mailto:"]')).toBeNull();
    button(el.shadowRoot, /Teilen/)!.click();
    expect(shares).toEqual([{ url: LINK, title: 'Einladung zu Luv & Leute', text: 'Komm dazu:' }]);
  });

  it('[F-591] ohne Teilen-Menü: „Per Mail senden“ öffnet das Mail-Programm mit Betreff, Text und Link', async () => {
    delete (navigator as { share?: unknown }).share;
    const el = await mount('sx-invite-box', { link: LINK, shareTitle: 'Einladung zu Luv & Leute', shareText: 'Komm dazu:' });
    expect(button(el.shadowRoot, /Teilen/)).toBeUndefined();
    const a = el.shadowRoot.querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    const url = new URL(a.getAttribute('href')!);
    expect(url.searchParams.get('subject')).toBe('Einladung zu Luv & Leute');
    expect(url.searchParams.get('body')).toBe(`Komm dazu:\n\n${LINK}`);
  });

  it('[F-591] Tippziele mindestens 44 px auf Touch und schmalen Bildschirmen', async () => {
    const el = await mount('sx-invite-box');
    const css = (el.constructor as unknown as { styles: Array<{ cssText: string }> }).styles.map((s) => s.cssText).join('\n');
    expect(css).toMatch(/@media \(pointer: coarse\), \(max-width: 760px\)\s*\{[^}]*\.btn,[^}]*min-height: 44px/);
  });
});

describe('F-592 Freunde einladen auf der eigenen Seite', () => {
  const profile = (over: Record<string, unknown> = {}) => ({
    kind: 'profile',
    profile: { handle: 'anna', displayName: 'Anna', bio: '', visibility: 'public', shareKey: null, link: '/u/anna', isSelf: true },
    boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [],
    ...over,
  });
  const menuItems = (el: LitEl) => (el.shadowRoot.querySelector('sx-page-menu') as unknown as { items: Array<{ id: string; label: string }> }).items;
  const pick = (el: LitEl, id: string) => el.shadowRoot.querySelector('sx-page-menu')!.dispatchEvent(new CustomEvent('sx-page-menu-pick', { detail: { id } }));

  it('[F-592] Zahnrad der eigenen Seite: „Freunde einladen“ klappt die Box unter dem Kopf auf; Einladen meldet sx-friend-invite', async () => {
    const friends = listen('sx-friend-invite');
    const el = await mount('sx-profile-page', { data: profile(), signedIn: true });
    expect(el.shadowRoot.querySelector('sx-invite-box')).toBeNull();
    expect(menuItems(el).map((i) => i.id)).toContain('invite');
    pick(el, 'invite');
    await el.updateComplete;
    expect(text(el.shadowRoot)).toContain('Freunde einladen');
    const b = await box(el);
    button(b.shadowRoot, /Einladungslink erzeugen/)!.click();
    expect(friends).toEqual([{ to: null }]);
    // der Link kommt vom Controller und ist nur jetzt sichtbar
    el.inviteLink = LINK;
    await el.updateComplete;
    await b.updateComplete;
    expect((b.shadowRoot.querySelector('input[readonly]') as HTMLInputElement).value).toBe(LINK);
    expect(text(b.shadowRoot)).toContain('bis zu 20 Personen');
    button(el.shadowRoot, /Schließen/)!.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('sx-invite-box')).toBeNull();
    expect(el.inviteLink).toBeNull();
  });

  it('[F-592] nicht auf fremden Seiten und nicht in „Ansehen als …“; Wechsel der Seite klappt zu und vergisst den Link', async () => {
    const other = await mount('sx-profile-page', { data: profile({ profile: { handle: 'mats', displayName: 'Mats', bio: '', visibility: 'public', shareKey: null, link: '/u/mats', isSelf: false } }) });
    expect(menuItems(other).map((i) => i.id)).toEqual(['report']);
    const preview = await mount('sx-profile-page', { data: profile({ preview: { as: 'public', visible: true }, previewOptions: { harbor: null, groups: [] } }) });
    expect(menuItems(preview).map((i) => i.id)).not.toContain('invite');

    const el = await mount('sx-profile-page', { data: profile(), inviteLink: LINK });
    expect(el.shadowRoot.querySelector('sx-invite-box')).not.toBeNull();
    el.data = profile({ profile: { handle: 'mats', displayName: 'Mats', bio: '', visibility: 'public', shareKey: null, link: '/u/mats', isSelf: false } }) as never;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('sx-invite-box')).toBeNull();
    expect(el.inviteLink).toBeNull();
  });

  it('[F-592] „Später“ blendet die Willkommens-Karte aus, sie nennt aber den festen Ort zum Einladen', async () => {
    const el = await mount('sx-home-feed', { signedIn: true, stream: { items: [], cursor: null, hasGroups: false }, groups: [], publicGroups: [] });
    expect(text(el.shadowRoot)).toContain('Später jederzeit auf deiner Seite: Zahnrad → Freunde einladen.');
    button(el.shadowRoot, /Später/)!.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('sx-invite-box')).toBeNull();
  });
});
