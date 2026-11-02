// @vitest-environment happy-dom
// Oberfläche der Beiträge (Konzept 21, Phase 1): „Mein Verlauf“ mit „Wer sieht es“/„Wo steht es“ und Bereich „Privat“
// (F-401), Schalter „Ins Fahrtenbuch“ (F-422), Beitrag schreiben mit Sichtbarkeit (F-402, F-420), Schreibrecht in der
// Gruppe (F-421), Beiträge für Besucher und „Ansehen als …“ (F-423). Komponenten zeigen nur an und melden Absichten.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-my-posts';
import '../../src/components/sx-preview-menu';
import '../../src/components/sx-profile-page';
import '../../src/components/sx-group-page';
import type { GroupPageData, ProfilePageData } from '../../src/services/api';
import type { MyPost } from '../../src/domain/posts';

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

const T = Date.UTC(2026, 9, 20, 10);
const items: MyPost[] = [
  { id: 'P1', kind: 'text', createdAt: T, visibility: 'members', channel: { kind: 'group', slug: 'regatta', name: 'Regatta', groupKind: 'team' }, groups: [], body: 'Training <b>heute</b>', link: null, hidden: false },
  { id: 'P2', kind: 'text', createdAt: T, visibility: 'private', channel: { kind: 'user' }, groups: [], body: 'Notiz', link: null, hidden: false },
  {
    id: 'S1', kind: 'voyage', createdAt: T, visibility: 'unlisted', channel: { kind: 'user' }, groups: [{ slug: 'pyc', name: 'PYC' }], body: '', link: null, hidden: false,
    voyage: { title: 'Rügen', distNm: 42, startedAt: T, path: '/s/S1/key', logState: 'suggested' },
  },
  {
    id: 'S2', kind: 'logbook', createdAt: T, visibility: 'public', channel: { kind: 'user' }, groups: [], body: '', link: null, hidden: true,
    voyage: { title: 'Werder', distNm: 5, startedAt: T, path: '/s/S2', logState: 'excluded' },
  },
];

describe('sx-my-posts', () => {
  it('[F-401] Karten trennen „Wer sieht es“ und „Wo steht es“; Privates und „Nur mit Link“ gekennzeichnet; Bereich „Privat“', async () => {
    const areas = listen('sx-my-posts-area');
    const el = await mount('sx-my-posts', { items, cursor: 'c1', area: 'all' });
    const t = text(el.shadowRoot);
    expect(t).toContain('Wer sieht es: Nur Mitglieder von Regatta');
    expect(t).toContain('Wo steht es: in Team Regatta');
    expect(t).toContain('Wer sieht es: Nur ich');
    expect(t).toContain('Wer sieht es: Nur mit Link');
    expect(t).toContain('Wo steht es: in deinem Profil und in PYC');
    expect(t).toContain('Gemeldet');
    // Fremdtext escaped
    expect(el.shadowRoot.querySelector('.body b')).toBeNull();
    expect(el.shadowRoot.querySelector('li.post.private')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/s/S1/key"]')).not.toBeNull();
    const tabs = [...el.shadowRoot.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs.map((b) => b.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs.map((b) => b.tabIndex)).toEqual([0, -1]);
    tabs[1].click();
    expect(areas).toEqual([{ area: 'private' }]);
    // Tabs-Muster: Pfeiltasten und Pos1/Ende
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(areas).toEqual([{ area: 'private' }, { area: 'private' }, { area: 'private' }]);
    expect(el.shadowRoot.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe('tab-all');
    expect(button(el.shadowRoot, /Mehr laden/)).toBeTruthy();
  });

  it('[F-422] Schalter „Ins Fahrtenbuch“ und „Bestätigen“ an Törns; Löschen meldet die Art', async () => {
    const states = listen('sx-log-state');
    const deletes = listen('sx-my-post-delete');
    const el = await mount('sx-my-posts', { items, cursor: null, area: 'all' });
    const switches = [...el.shadowRoot.querySelectorAll('input[role="switch"]')] as HTMLInputElement[];
    expect(switches.map((s) => s.checked)).toEqual([true, false]);
    switches[0].click();
    switches[1].click();
    button(el.shadowRoot, /Bestätigen/)!.click();
    expect(states).toEqual([{ id: 'S1', logState: 'excluded' }, { id: 'S2', logState: 'confirmed' }, { id: 'S1', logState: 'confirmed' }]);
    expect(text(el.shadowRoot)).toContain('zählt nicht in Seemeilen');
    button(el.shadowRoot, /Törn Rügen löschen/)!.click();
    expect(deletes).toEqual([{ id: 'S1', kind: 'voyage' }]);
  });

  it('[F-420] Profil-Beitrag schreiben: „Nur ich“ nur für Unterstützer; meldet Text, Link und Sichtbarkeit', async () => {
    const creates = listen('sx-my-post-create');
    const el = await mount('sx-my-posts', { items: [], cursor: null, area: 'all', supporter: true });
    await settle(el);
    const c = inner(el, 'sx-post-composer');
    const ta = c.shadowRoot.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Saisonstart';
    ta.dispatchEvent(new Event('input'));
    await c.updateComplete;
    // Zähler erst ab 90 % ansagen
    expect(c.shadowRoot.querySelector('.counter')!.getAttribute('aria-live')).toBe('off');
    const radios = [...c.shadowRoot.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    radios[1].click();
    await c.updateComplete;
    (c.shadowRoot.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(creates).toEqual([{ body: 'Saisonstart', link: '', visibility: 'private' }]);

    const free = await mount('sx-my-posts', { items: [], cursor: null, area: 'all', supporter: false });
    await settle(free);
    expect(inner(free, 'sx-post-composer').shadowRoot.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(text(inner(free, 'sx-post-composer').shadowRoot)).toContain('„Nur ich“ gibt es für Unterstützer');
  });
});

describe('sx-preview-menu', () => {
  it('[F-423] Zahnrad mit aria-expanded, Vorschauen je Hafen und Gruppe, „Vorschau beenden“, Escape schließt', async () => {
    const picks = listen('sx-profile-preview');
    const el = await mount('sx-preview-menu', { options: { harbor: { name: 'Potsdam' }, groups: [{ id: 'G1', name: 'PYC', kind: 'club' }] }, current: null });
    const toggle = button(el.shadowRoot, /Ansehen als/)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await el.updateComplete;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const t = text(el.shadowRoot);
    expect(t).toContain('Jemand aus deinem Hafen Potsdam');
    expect(t).toContain('Mitglied von PYC');
    expect(t).toContain('zeigt in dieser Stufe dasselbe wie Öffentlich');
    expect(button(el.shadowRoot, /Vorschau beenden/)).toBeUndefined();
    button(el.shadowRoot, /Mitglied von PYC/)!.click();
    expect(picks).toEqual([{ preview: { as: 'group', groupId: 'G1' } }]);
    el.current = { as: 'group', groupId: 'G1' };
    el.open = true;
    await el.updateComplete;
    expect(button(el.shadowRoot, /Mitglied von PYC/)!.getAttribute('aria-pressed')).toBe('true');
    button(el.shadowRoot, /Vorschau beenden/)!.click();
    expect(picks.at(-1)).toEqual({ preview: null });
    el.open = true;
    await el.updateComplete;
    el.shadowRoot.querySelector('div')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.open).toBe(false);
  });
});

const profile = (over: Partial<ProfilePageData> = {}): ProfilePageData =>
  ({
    profile: { handle: 'anna', displayName: 'Anna', bio: '', visibility: 'public', shareKey: null, link: null, isSelf: false },
    boats: [],
    stats: { voyages: 0, distNm: 0 },
    voyages: [],
    posts: [{ id: 'P9', createdAt: T, body: 'Hallo', link: null, group: { slug: 'pyc', name: 'PYC', kind: 'club' }, visibility: 'members' }],
    ...over,
  }) as ProfilePageData;

describe('sx-profile-page (Beiträge, Vorschau)', () => {
  it('[F-420] Besucher sehen Beiträge mit Gruppe und Kennzeichnung; eigene Seite zeigt „Mein Verlauf“ und das Zahnrad', async () => {
    const el = await mount('sx-profile-page', { data: { kind: 'profile', ...profile() } });
    await settle(el);
    const list = inner(el, 'sx-profile-posts');
    expect(text(list.shadowRoot)).toContain('Nur Mitglieder von PYC');
    expect(list.shadowRoot.querySelector('a[href="/g/pyc"]')).not.toBeNull();
    expect(inner(el, 'sx-preview-menu')).toBeNull();

    const self = await mount('sx-profile-page', {
      data: { kind: 'profile', ...profile({ profile: { ...profile().profile, isSelf: true }, posts: [], previewOptions: { harbor: null, groups: [] } }) },
      myPosts: { items, cursor: null },
    });
    await settle(self);
    expect(text(self.shadowRoot)).toContain('Mein Verlauf');
    expect(inner(self, 'sx-my-posts')).not.toBeNull();
    expect(inner(self, 'sx-preview-menu')).not.toBeNull();
  });

  it('[F-423] Vorschau deutlich markiert, ohne Folgen/Melden, mit „Vorschau beenden“; unsichtbare Seite erklärt', async () => {
    const picks = listen('sx-profile-preview');
    const el = await mount('sx-profile-page', {
      data: { kind: 'profile', ...profile({ preview: { as: 'public', visible: true }, previewOptions: { harbor: null, groups: [] }, social: { followers: 1, isFollowing: false } }) },
    });
    await settle(el);
    const banner = el.shadowRoot.querySelector('.preview[role="status"]')!;
    expect(text(banner)).toContain('Vorschau – so sieht Öffentlich');
    expect(el.shadowRoot.querySelector('sx-follow')).toBeNull();
    expect(button(el.shadowRoot, /^ *Melden/)).toBeUndefined();
    button(el.shadowRoot, /Vorschau beenden/)!.click();
    expect(picks).toEqual([{ preview: null }]);

    // Handy (F-291): lange Seite ohne eigenen Scrollbereich, Hinweis klebt unter der stehenden Kopfzeile mit Reiterzeile
    const css = ((customElements.get('sx-profile-page') as unknown as { styles: Array<{ cssText?: string }> }).styles).map((x) => x.cssText ?? '').join(' ');
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*:host \{\s*overflow: visible;\s*\}\s*\.preview \{\s*top: var\(--topbar-mobile-h\);/);

    const hidden = await mount('sx-profile-page', {
      data: { kind: 'profile', ...profile({ profile: { ...profile().profile, visibility: 'unlisted' }, preview: { as: 'public', visible: false }, previewOptions: { harbor: null, groups: [] } }) },
    });
    expect(text(hidden.shadowRoot)).toContain('sehen deine Seite nicht');
  });
});

const groupData = (role: string, kind: 'club' | 'team', postBy?: string): GroupPageData =>
  ({
    group: { id: 'G1', kind, slug: 'sc-kiel', name: 'SC', description: '', homePort: '', visibility: 'public', joinMode: 'request', role, postBy, shareKey: null, link: null, hiddenAt: null, createdAt: T },
    parent: null, teams: [], stats: { members: 1, boats: 0, voyages: 0, distNm: 0, seasonNm: 0 }, members: [], others: 0, boats: [],
    social: { followers: 0, isFollowing: false }, membership: { role, requested: false, canRequest: false },
  }) as unknown as GroupPageData;

describe('sx-group-page (Schreibrecht)', () => {
  it('[F-421] Mitglied schreibt im Team, im Verein nur bei „alle Mitglieder“; Eigner stellt es im Bearbeiten-Formular ein', async () => {
    expect(inner(await mount('sx-group-page', { data: groupData('member', 'team', 'members'), signedIn: true }), 'sx-post-composer')).not.toBeNull();
    expect(inner(await mount('sx-group-page', { data: groupData('member', 'club', 'admins'), signedIn: true }), 'sx-post-composer')).toBeNull();
    expect(inner(await mount('sx-group-page', { data: groupData('member', 'club', 'members'), signedIn: true }), 'sx-post-composer')).not.toBeNull();

    const saves = listen('sx-group-save');
    const owner = await mount('sx-group-page', { data: groupData('owner', 'club', 'admins'), signedIn: true });
    button(owner.shadowRoot, /Bearbeiten/)!.click();
    await owner.updateComplete;
    expect(text(owner.shadowRoot)).toContain('Wer darf Beiträge schreiben?');
    const radio = [...owner.shadowRoot.querySelectorAll('input[name="postby"]')] as HTMLInputElement[];
    expect(radio.map((r) => r.checked)).toEqual([true, false]);
    radio[1].click();
    await settle(owner);
    (owner.shadowRoot.querySelector('form[aria-label="Gruppe bearbeiten"]') as HTMLFormElement).requestSubmit();
    expect(owner.formError).toBe('');
    expect((saves[0] as { patch: { postBy: string } }).patch.postBy).toBe('members');

    const admin = await mount('sx-group-page', { data: groupData('admin', 'club', 'admins'), signedIn: true });
    button(admin.shadowRoot, /Bearbeiten/)!.click();
    await admin.updateComplete;
    expect(text(admin.shadowRoot)).not.toContain('Wer darf Beiträge schreiben?');
  });
});
