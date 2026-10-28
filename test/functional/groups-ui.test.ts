// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche für Vereine, Teams, Folgen und Neuigkeiten (F-158, F-160, F-163, F-164):
// Neuigkeiten-Liste, Startseiten-Leiste, Gruppenseite und Anlegen, Folgen-Knopf. Komponenten zeigen nur an und
// melden Absichten als Events.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-stream';
import '../../src/components/sx-home-feed';
import '../../src/components/sx-group-page';
import '../../src/components/sx-follow';
import '../../src/components/sx-profile-page';
import '../../src/components/sx-discover';
import '../../src/components/sx-invite-dialog';
import type { GroupPageData, StreamItem } from '../../src/services/api';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

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
const buttons = (root: ParentNode) => [...root.querySelectorAll('button')];
const button = (root: ParentNode, label: RegExp) => buttons(root).find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
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
const items: StreamItem[] = [
  { id: 'a1', kind: 'voyage', createdAt: T, actor: { handle: 'anna', displayName: 'Anna' }, group: null, voyage: { id: 'S1', title: '<b>Rügen</b>', distNm: 42.5, startedAt: T, hasImage: false, boat: { id: 'B1', name: 'Möwe' } } },
  { id: 'a2', kind: 'post', createdAt: T, actor: null, group: { slug: 'sc', name: 'SC Kiel', kind: 'club' }, post: { id: 'P1', body: 'Absegeln <img src=x onerror=alert(1)> https://example.org/termine', link: 'https://example.org/x', canDelete: true } },
  { id: 'a3', kind: 'post', createdAt: T, actor: null, group: { slug: 'sc', name: 'SC Kiel', kind: 'club' }, post: { id: 'P2', body: 'Fremd', link: null, canDelete: false } },
  { id: 'a4', kind: 'member', createdAt: T, actor: null, group: { slug: 'sc', name: 'SC Kiel', kind: 'club' } },
  { id: 'a5', kind: 'photos', createdAt: T, actor: null, group: null, voyage: { id: 'S2', title: 'Fotos', distNm: 1, startedAt: null, hasImage: false, boat: null }, photos: { count: 3, thumbs: ['F1', 'F2'] } },
  { id: 'a6', kind: 'milestone', createdAt: T, actor: null, group: null, boat: { id: 'B1', name: 'Möwe' }, milestone: { nm: 500, year: 2026, subject: 'boat', name: 'Möwe', path: '/b/B1' } },
];

// ---------------------------------------------------------------- Neuigkeiten

describe('sx-stream', () => {
  it('[F-160] zeigt alle Arten, Fremdtext escaped, Links mit nofollow ugc', async () => {
    const el = await mount('sx-stream', { items, cursor: null });
    const t = text(el.shadowRoot);
    expect(t).toContain('hat einen Törn geteilt: <b>Rügen</b>');
    expect(t).toContain('42,5 sm');
    expect(t).toContain('Ein neues Mitglied ist beigetreten');
    expect(t).toContain('3 neue Fotos zu');
    expect(t).toContain('Möwe hat 500 Seemeilen in der Saison 2026 erreicht');
    expect(el.shadowRoot.querySelector('b')).toBeNull();
    expect(el.shadowRoot.querySelector('img[onerror]')).toBeNull();
    const link = el.shadowRoot.querySelector('a[href="https://example.org/termine"]')!;
    expect(link.getAttribute('rel')).toBe('nofollow ugc noopener noreferrer');
    expect(el.shadowRoot.querySelectorAll('.thumbs img')).toHaveLength(2);
    expect(el.shadowRoot.querySelector('a[href="/u/anna"]')).not.toBeNull();
  });

  it('[F-160] „Mehr laden“ nur mit Cursor; Löschen bzw. Melden je nach Recht', async () => {
    const more = listen('sx-stream-more');
    const del = listen('sx-post-delete');
    const rep = listen('sx-report');
    const el = await mount('sx-stream', { items, cursor: 'c1', scope: 'group' });
    button(el.shadowRoot, /Mehr laden/)!.click();
    expect(more).toEqual([{ scope: 'group' }]);
    button(el.shadowRoot, /Beitrag löschen/)!.click();
    expect(del).toEqual([{ id: 'P1' }]);
    button(el.shadowRoot, /Beitrag melden/)!.click();
    expect(rep).toEqual([{ kind: 'post', id: 'P2', label: 'diesen Beitrag' }]);
    const last = await mount('sx-stream', { items, cursor: null });
    expect(button(last.shadowRoot, /Mehr laden/)).toBeUndefined();
    const empty = await mount('sx-stream', { items: [], emptyText: 'Nix los.' });
    expect(text(empty.shadowRoot)).toContain('Nix los.');
  });

  it('[F-213] Titelbild mit Ausschnitt, verlinkt wie der Eintrag; Törn-Übersichtsbild unbeschnitten', async () => {
    const withCover: StreamItem[] = [
      { id: 'b1', kind: 'boat', createdAt: T, actor: null, group: { slug: 'sc', name: 'SC Kiel', kind: 'club' }, boat: { id: 'B1', name: 'Möwe' }, cover: { src: '/api/covers/b/B1/v1', y: 20 } },
      { id: 'v1', kind: 'voyage', createdAt: T, actor: null, group: null, voyage: { id: 'S1', title: 'Rügen', distNm: 4, startedAt: T, hasImage: true, boat: null } },
    ];
    const el = await mount('sx-stream', { items: withCover, cursor: null });
    const banner = el.shadowRoot.querySelector<HTMLImageElement>('img.banner')!;
    expect(banner.getAttribute('src')).toBe('/api/covers/b/B1/v1');
    expect(banner.style.objectPosition).toBe('50% 20%');
    expect(banner.closest('a')!.getAttribute('href')).toBe('/b/B1');
    expect(el.shadowRoot.querySelectorAll('img.banner')).toHaveLength(1);
    expect(el.shadowRoot.querySelector('img.cover')).not.toBeNull();
  });
});

// ---------------------------------------------------------------- Startseite

describe('sx-home-feed', () => {
  const clubs = [{ slug: 'sc-kiel', name: 'SC Kiel', kind: 'club', homePort: 'Kiel', description: '', createdAt: T, members: 12 }];

  it('[F-163] ohne Gruppen: Willkommens-Karte (Konzept 14.3) mit Heimathafen, öffentlichen Vereinen, „gründen“ und Freunde einladen', async () => {
    const el = await mount('sx-home-feed', { signedIn: true, stream: { items: [], cursor: null, hasGroups: false }, groups: [], publicGroups: clubs });
    const t = text(el.shadowRoot);
    expect(t).toContain('Willkommen an Bord!');
    expect(t).toContain('Dein Heimathafen');
    expect(t).toContain('12 Mitglieder');
    expect(t).toContain('Freunde einladen');
    expect(el.shadowRoot.querySelector('sx-harbor-picker')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/g/sc-kiel"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/g/neu"]')).not.toBeNull();
    // Konzept 12.6: der Stream steht immer da (Hafen und Teams liefern auch ohne Verein Neuigkeiten)
    expect(el.shadowRoot.querySelector('sx-stream')).not.toBeNull();
  });

  it('[F-163] mit Gruppen: eigene Gruppen und Neuigkeiten', async () => {
    const el = await mount('sx-home-feed', {
      signedIn: true,
      mode: 'mine',
      shown: 'mine',
      stream: { items, cursor: 'c', hasGroups: true },
      personal: { items, cursor: 'c', hasGroups: true },
      groups: [{ id: 'G1', slug: 'sc-kiel', name: 'SC Kiel', kind: 'club', role: 'member', members: 3 }],
    });
    await settle(el);
    expect(text(el.shadowRoot)).not.toContain('Dein Verein oder Team');
    expect(el.shadowRoot.querySelector('a[href="/g/sc-kiel"]')).not.toBeNull();
    const stream = inner(el, 'sx-stream');
    expect((stream.items as unknown[]).length).toBe(items.length);
    expect(stream.cursor).toBe('c');
  });

  it('[F-205] Willkommens-Karte: Beitreten je nach Stufe, Freunde einladen, „Später“ blendet aus', async () => {
    const joins = listen('sx-home-join');
    const invites = listen('sx-friend-invite');
    const groups = [
      { id: 'GOPEN', slug: 'offen', name: 'Offen', kind: 'team', homePort: '', description: '', createdAt: T, members: 2, joinMode: 'open' },
      { id: 'GREQ', slug: 'anfrage', name: 'Anfrage', kind: 'club', homePort: '', description: '', createdAt: T, members: 2, joinMode: 'request' },
      { id: 'GINV', slug: 'einladung', name: 'Einladung', kind: 'club', homePort: '', description: '', createdAt: T, members: 2, joinMode: 'invite' },
    ];
    const personal = { items: [], cursor: null, hasGroups: false, home: { club: null, harbor: { slug: 'potsdam', name: 'Potsdam' } } };
    const el = await mount('sx-home-feed', { signedIn: true, mode: 'mine', shown: 'mine', stream: personal, personal, groups: [], publicGroups: groups });
    expect(text(el.shadowRoot)).not.toContain('Dein Heimathafen');
    button(el.shadowRoot, /Beitreten/)!.click();
    button(el.shadowRoot, /Anfragen/)!.click();
    expect(joins.map((d) => (d as { id: string }).id)).toEqual(['GOPEN', 'GREQ']);
    expect(el.shadowRoot.querySelector('a[href="/g/einladung"].btn')).not.toBeNull();
    button(el.shadowRoot, /Link erzeugen/)!.click();
    expect(invites).toEqual([{ email: null }]);
    button(el.shadowRoot, /Später/)!.click();
    await settle(el);
    expect(text(el.shadowRoot)).not.toContain('Willkommen an Bord!');
  });

  it('[F-164] Vorschläge mit Grund und „Folgen“', async () => {
    const follows = listen('sx-follow');
    const el = await mount('sx-home-feed', {
      signedIn: true,
      stream: { items: [], cursor: null, hasGroups: false },
      suggestions: [{ handle: 'mats', displayName: 'Mats', reason: 'crew', reasonText: 'Mit dir gesegelt' }],
    });
    expect(text(el.shadowRoot)).toContain('Leute, die du kennen könntest');
    expect(text(el.shadowRoot)).toContain('Mit dir gesegelt');
    button(el.shadowRoot, /Mats folgen/)!.click();
    expect(follows).toEqual([{ kind: 'user', id: 'mats', follow: true }]);
  });
});

// ---------------------------------------------------------------- Folgen

describe('sx-follow', () => {
  it('[F-158] Folgen/Entfolgen, Anzahl; ohne Anmeldung zur Anmeldung', async () => {
    const follows = listen('sx-follow');
    const logins = listen('sx-login');
    const el = await mount('sx-follow', { kind: 'boat', targetId: 'B1', label: 'Möwe', stats: { followers: 1, isFollowing: false }, signedIn: true });
    expect(text(el.shadowRoot)).toContain('1 Follower');
    button(el.shadowRoot, /Möwe folgen/)!.click();
    expect(follows).toEqual([{ kind: 'boat', id: 'B1', follow: true }]);
    el.stats = { followers: 2, following: 5, isFollowing: true };
    await el.updateComplete;
    expect(button(el.shadowRoot, /Folge ich/)!.getAttribute('aria-pressed')).toBe('true');
    expect(text(el.shadowRoot)).toContain('folgt 5');
    button(el.shadowRoot, /Folge ich/)!.click();
    expect(follows[1]).toEqual({ kind: 'boat', id: 'B1', follow: false });
    el.signedIn = false;
    await el.updateComplete;
    button(el.shadowRoot, /Folge/)!.click();
    expect(logins).toHaveLength(1);
  });

  it('[F-158] Profilseite: „Folgen“ nur bei öffentlichen fremden Profilen', async () => {
    const data = (isSelf: boolean, visibility = 'public') => ({
      kind: 'profile', profile: { handle: 'anna', displayName: 'Anna', bio: '', visibility, isSelf }, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [],
      social: { followers: 3, following: 1, isFollowing: false },
    });
    const other = await mount('sx-profile-page', { data: data(false), signedIn: true });
    expect(other.shadowRoot.querySelector('sx-follow')).not.toBeNull();
    const self = await mount('sx-profile-page', { data: data(true) });
    expect(self.shadowRoot.querySelector('sx-follow')).toBeNull();
    const linked = await mount('sx-profile-page', { data: data(false, 'unlisted') });
    expect(linked.shadowRoot.querySelector('sx-follow')).toBeNull();
  });
});

// ---------------------------------------------------------------- Gruppenseite

const pageData = (over: Partial<GroupPageData> = {}, role: string | null = null): GroupPageData =>
  ({
    group: { id: 'G1', kind: 'club', slug: 'sc-kiel', name: 'SC <Kiel>', description: 'Wir segeln.', homePort: 'Kiel', visibility: 'public', joinMode: 'request', role, shareKey: null, link: role ? '/g/sc-kiel' : null, hiddenAt: null, createdAt: T },
    parent: null,
    teams: [{ slug: 'jugend', name: 'Jugend', kind: 'team' }],
    stats: { members: 5, boats: 1, voyages: 3, distNm: 120, seasonNm: 80 },
    members: [
      { id: role ? 'U1' : null, handle: 'anna', displayName: 'Anna', role: 'owner', isSelf: role === 'owner' },
      { id: role ? 'U2' : null, handle: null, displayName: 'Bo', role: 'member', isSelf: false },
    ],
    others: role ? 0 : 3,
    boats: [{ id: 'B1', name: 'Möwe', boatType: '', lengthM: null, homePort: '', mine: false, canRemove: !!role, public: true }],
    social: { followers: 4, isFollowing: false },
    membership: { role, requested: false, canRequest: !role },
    ...(role === 'owner' || role === 'admin'
      ? { requests: [{ userId: 'U9', displayName: 'Neu', handle: null, message: 'Hallo!', createdAt: T }], invites: [{ id: 'I1', email: null, usesLeft: 99, createdAt: T, expiresAt: T + 86_400_000 }] }
      : {}),
    ...over,
  }) as GroupPageData;

describe('sx-group-page', () => {
  it('[F-163] Besucher: Kopf escaped, Kennzahlen, Teams, „Beitritt anfragen“, Folgen, Melden, „+ n weitere“, RSS', async () => {
    const joins = listen('sx-group-join');
    const el = await mount('sx-group-page', { data: pageData(), signedIn: true, stream: { items: [], cursor: null } });
    const t = text(el.shadowRoot);
    expect(t).toContain('SC <Kiel>');
    expect(t).toContain('Heimathafen Kiel');
    expect(t).toContain('+ 3 weitere Mitglieder ohne öffentliches Profil');
    expect(el.shadowRoot.querySelector('a[href="/g/jugend"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/g/sc-kiel/feed.xml"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('sx-follow')).not.toBeNull();
    expect(button(el.shadowRoot, /Melden/)).toBeDefined();
    expect(el.shadowRoot.querySelector('textarea')).toBeNull(); // kein Beitragsformular
    button(el.shadowRoot, /Beitritt anfragen/)!.click();
    expect(joins).toEqual([{ id: 'G1' }]);
  });

  it('[F-163] geschlossene Gruppe ohne Folgen und RSS; „Nur auf Einladung“ ohne Anfrage-Knopf', async () => {
    const d = pageData({ membership: { role: null, requested: false, canRequest: false } });
    d.group.visibility = 'private';
    d.group.joinMode = 'invite';
    const el = await mount('sx-group-page', { data: d, signedIn: true });
    expect(el.shadowRoot.querySelector('sx-follow')).toBeNull();
    expect(el.shadowRoot.querySelector('a[href$="feed.xml"]')).toBeNull();
    expect(text(el.shadowRoot)).toContain('Beitritt nur auf Einladung');
  });

  it('[F-333] Gäste: „Anmelden und beitreten“ öffnet die Anmeldung; „Nur auf Einladung“ als Hinweis', async () => {
    const logins = listen('sx-login');
    const el = await mount('sx-group-page', { data: pageData(), signedIn: false });
    button(el.shadowRoot, /Anmelden und beitreten/)!.click();
    expect(logins).toHaveLength(1);
    const d = pageData();
    d.group.joinMode = 'invite';
    const inv = await mount('sx-group-page', { data: d, signedIn: false });
    expect(button(inv.shadowRoot, /beitreten/i)).toBeUndefined();
    expect(text(inv.shadowRoot)).toContain('Beitritt nur auf Einladung');
  });

  it('[F-163] Eigner: Beitrag schreiben, Anfragen, Einladen (Link einmal), Rollen, Boot zuordnen', async () => {
    const posts = listen('sx-post-create');
    const reqs = listen('sx-group-request');
    const invites = listen('sx-group-invite');
    const roles = listen('sx-group-role');
    const boats = listen('sx-group-boat-add');
    const revoke = listen('sx-group-invite-revoke');
    const el = await mount('sx-group-page', {
      data: pageData({}, 'owner'), signedIn: true, inviteLink: 'http://localhost/einladung#token=abc',
      myBoats: [{ id: 'B1', name: 'Möwe' }, { id: 'B2', name: 'Albatros' }],
    });
    const root = el.shadowRoot;
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Absegeln am Samstag';
    ta.dispatchEvent(new Event('input'));
    await el.updateComplete;
    (root.querySelector('form[aria-label="Neuigkeit schreiben"]') as HTMLFormElement).requestSubmit();
    expect(posts).toEqual([{ groupId: 'G1', body: 'Absegeln am Samstag', link: '' }]);
    expect(text(root)).toContain('Beitrittsanfragen (1)');
    button(root, /Annehmen/)!.click();
    expect(reqs).toEqual([{ id: 'G1', userId: 'U9', approve: true }]);
    expect(root.querySelector('code.link')!.textContent).toBe('http://localhost/einladung#token=abc');
    button(root, /Einladungslink erzeugen/)!.click();
    expect(invites).toEqual([{ id: 'G1', email: null }]);
    button(root, /Zurückziehen/)!.click();
    expect(revoke).toEqual([{ id: 'I1' }]);
    button(root, /Zum Admin/)!.click();
    expect(roles).toEqual([{ id: 'G1', userId: 'U2', role: 'admin' }]);
    // nur Boote, die noch nicht in der Gruppe sind
    expect([...root.querySelectorAll('select[aria-label="Eigenes Boot zuordnen"] option')].map((o) => o.textContent)).toEqual(['Albatros']);
    button(root, /Boot zuordnen/)!.click();
    expect(boats).toEqual([{ id: 'G1', boatId: 'B2' }]);
  });

  it('[F-163] Bearbeiten: Admins ändern die Sichtbarkeit nicht; Eigner kann löschen', async () => {
    const saves = listen('sx-group-save');
    const admin = await mount('sx-group-page', { data: pageData({}, 'admin'), signedIn: true, supporter: true });
    button(admin.shadowRoot, /Bearbeiten/)!.click();
    await admin.updateComplete;
    const radios = [...admin.shadowRoot.querySelectorAll('input[name="vis"]')] as HTMLInputElement[];
    expect(radios.every((r) => r.disabled)).toBe(true);
    expect(text(admin.shadowRoot)).toContain('Die Sichtbarkeit ändert nur der Eigner.');
    expect(button(admin.shadowRoot, /Gruppe löschen/)).toBeUndefined();
    (admin.shadowRoot.querySelector('form[aria-label="Gruppe bearbeiten"]') as HTMLFormElement).requestSubmit();
    expect(saves[0]).toMatchObject({ id: 'G1', patch: { name: 'SC <Kiel>', slug: 'sc-kiel' } });
    expect((saves[0] as { patch: Record<string, unknown> }).patch.visibility).toBeUndefined();
    const owner = await mount('sx-group-page', { data: pageData({}, 'owner'), signedIn: true });
    button(owner.shadowRoot, /Bearbeiten/)!.click();
    await owner.updateComplete;
    expect(button(owner.shadowRoot, /Gruppe löschen/)).toBeDefined();
  });

  it('[F-163] Anlegen: Adresse aus dem Namen, nicht öffentliche Stufen nur für Unterstützer, Ereignis mit allen Feldern', async () => {
    const creates = listen('sx-group-create');
    const el = await mount('sx-group-page', { mode: 'create', signedIn: true, supporter: false });
    const root = el.shadowRoot;
    const name = root.querySelector('input[maxlength="80"]') as HTMLInputElement;
    name.value = 'Segelclub Möwe';
    name.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect((root.querySelector('input[pattern]') as HTMLInputElement).value).toBe('segelclub-moewe');
    const vis = [...root.querySelectorAll('input[name="vis"]')] as HTMLInputElement[];
    expect(vis.map((v) => v.disabled)).toEqual([false, true, true]);
    expect(text(root)).toContain('Nur für Unterstützer');
    (root.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(creates[0]).toMatchObject({ kind: 'club', name: 'Segelclub Möwe', slug: 'segelclub-moewe', visibility: 'public', joinMode: 'request' });
    const anon = await mount('sx-group-page', { mode: 'create', signedIn: false });
    expect(text(anon.shadowRoot)).toContain('Zum Gründen bitte anmelden');
  });

  it('[F-163] Fehler und Laden', async () => {
    const err = await mount('sx-group-page', { error: 'Diese Gruppe gibt es nicht oder sie ist geschlossen.' });
    expect(text(err.shadowRoot)).toContain('geschlossen');
    const loading = await mount('sx-group-page', { loading: true });
    expect(text(loading.shadowRoot)).toContain('Lade');
  });
});

// ---------------------------------------------------------------- Entdecken und Einladung

describe('Entdecken und Einladungsdialog', () => {
  it('[F-163] /entdecken listet Vereine und Teams', async () => {
    const el = await mount('sx-discover', {
      variant: 'page',
      data: { voyages: [], boats: [], people: [], groups: [{ slug: 'sc-kiel', name: 'SC Kiel', kind: 'club', homePort: 'Kiel', description: 'Hallo', createdAt: T, members: 1 }] },
    });
    expect(el.shadowRoot.querySelector('#vereine a[href="/g/sc-kiel"]')!.closest('.card')!.textContent).toContain('1 Mitglied');
  });

  it('[F-153] Einladung in eine Gruppe: Wortlaut und Ergebnis', async () => {
    const el = await mount('sx-invite-dialog', {
      open: true, state: 'ready', signedIn: true,
      peek: { kind: 'group', groupKind: 'club', target: 'SC Kiel', inviter: 'Anna', bound: false, expiresAt: T + 86_400_000, emailMatches: null, isOwner: false, alreadyMember: false },
    });
    expect(text(el.shadowRoot)).toContain('Anna lädt dich in den Verein „SC Kiel“ ein.');
    expect(text(el.shadowRoot)).toContain('Mitgliedschaft öffnet keine nicht öffentlichen Törns');
    const done = await mount('sx-invite-dialog', { open: true, state: 'done', peek: { kind: 'group' }, result: { kind: 'group', path: '/g/sc-kiel', target: 'SC Kiel', already: false } });
    expect(done.shadowRoot.querySelector('a[href="/g/sc-kiel"]')!.textContent).toContain('Zur Gruppe');
  });
});
