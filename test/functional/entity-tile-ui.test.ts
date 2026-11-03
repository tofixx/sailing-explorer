// @vitest-environment happy-dom
// Große Objekt-Icons im Seitenkopf als Kachel im Stil des Logos (F-620–F-624); kleine Icons bleiben Linien-Icons.
import { render, svg } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-group-page';
import '../../src/components/sx-profile-page';
import '../../src/components/sx-discover';
import { ENTITY_ICON, LOGO_TILE, entityTile, icon, initial, logo } from '../../src/components/icons';
import { tileStyles } from '../../src/components/shared';
import type { GroupPageData } from '../../src/services/api';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
afterEach(() => {
  document.body.innerHTML = '';
});

const T = 1_700_000_000_000;
const group = (kind: 'club' | 'team'): GroupPageData =>
  ({
    group: { id: 'G1', kind, slug: 'sc', name: 'SC', description: '', homePort: '', visibility: 'public', joinMode: 'request', role: null, shareKey: null, link: null, hiddenAt: null, createdAt: T },
    parent: null,
    teams: [],
    stats: { members: 1, boats: 0, voyages: 0, distNm: 0, seasonNm: 0 },
    members: [],
    others: 0,
    boats: [],
    social: { followers: 0, isFollowing: false },
    membership: { role: null, requested: false, canRequest: true },
  }) as unknown as GroupPageData;
const boat = { id: 'B1', name: 'Möwe', boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '', visibility: 'public', createdAt: 0, updatedAt: 0, owner: null, role: null };
const harbor = {
  kind: 'harbor',
  harbor: { id: 'H1', slug: 'potsdam', name: 'Potsdam', lat: 52.4, lon: 13.05, canEdit: false, createdAt: T },
  club: null,
  stats: { boats: 0, voyages: 0, distNm: 0, seasonNm: 0 },
  boats: [],
  voyages: [],
  social: { followers: 0, isFollowing: false },
  clubChoices: [],
  canClearClub: false,
};
const profile = { handle: 'mats', displayName: 'mats', bio: '', visibility: 'public', isSelf: false };

/** Die Kachel im Kopf (`header.hero`) einer Komponente */
const heroTile = (el: LitEl) => el.shadowRoot.querySelector('header.hero svg.sx-tile') as SVGSVGElement | null;
/** Verlauf-Farben, auf die die Hintergrundfläche der Kachel zeigt */
function tileGradient(tile: SVGSVGElement) {
  const id = /url\(#([^)]+)\)/.exec(tile.querySelector('rect.bg')!.getAttribute('fill') ?? '')?.[1];
  const grad = id ? tile.querySelector(`linearGradient[id="${id}"]`) : null;
  return [...(grad?.querySelectorAll('stop') ?? [])].map((s) => s.getAttribute('stop-color'));
}

describe('Logo-Kachel für große Objekt-Icons (F-620)', () => {
  it('[F-620] Kachel: Verlauf Havelblau → Türkis wie das Logo, Ecken 8/32, aria-hidden, feste Verlauf-IDs', () => {
    const host = document.createElement('div');
    render(svg`${entityTile('pennant')}${entityTile('pennant')}`, host);
    const [a, b] = [...host.querySelectorAll('svg.sx-tile')] as SVGSVGElement[];
    expect(tileGradient(a)).toEqual(['#0e6bd8', '#0b8fa6']);
    expect(a.getAttribute('viewBox')).toBe('0 0 32 32');
    expect(a.querySelector('rect.bg')?.getAttribute('rx')).toBe('8');
    expect(a.getAttribute('aria-hidden')).toBe('true');
    expect(a.getAttribute('width')).toBe('72');
    const ids = (t: Element) => [...t.querySelectorAll('linearGradient')].map((g) => g.id);
    // alle Kacheln: dieselben Verläufe unter festen IDs (je Shadow Root gültig)
    expect(ids(a)).toEqual(['sx-tile-bg', 'sx-tile-lt']);
    expect(ids(b)).toEqual(ids(a));
    // gleiche Verlaufsfarben wie die Logo-Kachel
    const logoHost = document.createElement('div');
    render(logo(32, true), logoHost);
    expect([...logoHost.querySelectorAll('linearGradient')[0].querySelectorAll('stop')].map((s) => s.getAttribute('stop-color'))).toEqual(['#0e6bd8', '#0b8fa6']);
  });

  it('[F-620] zweifarbiges Zeichen: heller Verlauf (weiß → Mint) und weiße Flächen/Linien; Buchstabe statt Zeichen möglich', () => {
    const host = document.createElement('div');
    render(svg`${entityTile(ENTITY_ICON.club)}${entityTile(ENTITY_ICON.team)}${entityTile('map')}${entityTile(ENTITY_ICON.user, 72, initial('m'))}`, host);
    const [club, team, generic, letter] = [...host.querySelectorAll('svg.sx-tile')];
    for (const t of [club, team]) {
      const light = t.querySelectorAll('linearGradient')[1];
      expect([...light.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color'))).toEqual(['#fff', '#b9f2ea']);
      expect(t.querySelector('.lt')).not.toBeNull();
    }
    expect(club.getAttribute('data-icon')).toBe('pennant');
    expect(team.getAttribute('data-icon')).toBe('team');
    // ohne eigene Großfassung: das Linien-Icon in Weiß
    expect(generic.querySelector('g.ink path')).not.toBeNull();
    expect(letter.querySelector('text')?.textContent).toBe('M');
  });
  it('[F-620] Verlauf-IDs bleiben über Neu-Renders gleich; Logo-Kachel und Kachel teilen LOGO_TILE', async () => {
    const el = await mount('sx-group-page', { data: group('club'), signedIn: true });
    const before = [...heroTile(el)!.querySelectorAll('linearGradient')].map((g) => g.id);
    el.data = group('team');
    await el.updateComplete;
    el.data = group('club');
    await el.updateComplete;
    const tile = heroTile(el)!;
    expect([...tile.querySelectorAll('linearGradient')].map((g) => g.id)).toEqual(before);
    expect(tile.querySelector('rect.bg')?.getAttribute('fill')).toBe('url(#sx-tile-bg)');
    expect(tileGradient(tile)).toEqual([LOGO_TILE.from, LOGO_TILE.to]);
    expect(tile.querySelector('rect.bg')?.getAttribute('rx')).toBe(String(LOGO_TILE.radius));
  });

  it('[F-620] Anfangsbuchstabe: erstes Schriftzeichen, Emoji ganz, leer → kein Buchstabe', () => {
    expect(initial('mats')).toBe('M');
    expect(initial('  ärmel')).toBe('Ä');
    expect(initial('🙂 Anna')).toBe('🙂');
    expect(initial('⛵Kiel')).toBe('⛵');
    expect(initial('')).toBe('');
  });
});

describe('Seitenköpfe zeigen die Kachel (F-621, F-622)', () => {
  it('[F-621] Gruppenseite: Verein mit Wimpel, Team mit Crew-Kachel; „Verein oder Team gründen“ mit Wimpel', async () => {
    const club = await mount('sx-group-page', { data: group('club'), signedIn: true });
    expect(heroTile(club)?.getAttribute('data-icon')).toBe('pennant');
    expect(tileGradient(heroTile(club)!)).toEqual(['#0e6bd8', '#0b8fa6']);
    const team = await mount('sx-group-page', { data: group('team'), signedIn: true });
    expect(heroTile(team)?.getAttribute('data-icon')).toBe('team');
    const create = await mount('sx-group-page', { mode: 'create', signedIn: false });
    expect(heroTile(create)?.getAttribute('data-icon')).toBe('pennant');
    // keine alte flache Marke mehr
    expect(club.shadowRoot.querySelector('.mark')).toBeNull();
  });

  it('[F-622] Boot, Hafen, Beitrag, Profil (Anfangsbuchstabe, Emoji, leer) und Entdecken nutzen dieselbe Kachel', async () => {
    const b = await mount('sx-profile-page', { data: { kind: 'boat', boat, stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(heroTile(b)?.getAttribute('data-icon')).toBe('sail');
    const h = await mount('sx-profile-page', { data: harbor });
    expect(heroTile(h)?.getAttribute('data-icon')).toBe('anchor');
    const p = await mount('sx-profile-page', { data: { kind: 'profile', profile, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(heroTile(p)?.getAttribute('data-icon')).toBe('letter');
    expect(heroTile(p)?.querySelector('text')?.textContent).toBe('M');
    const post = await mount('sx-profile-page', {
      data: { kind: 'post', item: { id: 'A1', kind: 'post', createdAt: T, actor: null, group: null, post: { id: 'P1', body: 'Hallo', link: null, canDelete: false, visibility: 'public' } }, link: { home: null, where: 'Nur mit Link' } },
    });
    expect(heroTile(post)?.getAttribute('data-icon')).toBe('comment');
    const emoji = await mount('sx-profile-page', { data: { kind: 'profile', profile: { ...profile, displayName: '🙂 Anna' }, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(heroTile(emoji)?.querySelector('text')?.textContent).toBe('🙂');
    const empty = await mount('sx-profile-page', { data: { kind: 'profile', profile: { ...profile, displayName: '' }, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(heroTile(empty)?.getAttribute('data-icon')).toBe('user');
    expect(heroTile(empty)?.querySelector('text')).toBeNull();
    const d = await mount('sx-discover', { data: null });
    expect(heroTile(d)?.getAttribute('data-icon')).toBe('globe');
    expect(heroTile(d)?.getAttribute('width')).toBe('64');
  });
});

describe('Kleine Icons bleiben Linien-Icons (F-623)', () => {
  it('[F-623] icon(): 24er-Linien-Icon in currentColor mit dezenter Fläche – ohne Kachel', () => {
    const host = document.createElement('div');
    render(icon(ENTITY_ICON.club), host);
    const s = host.querySelector('svg')!;
    expect(s.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(s.getAttribute('stroke')).toBe('currentColor');
    expect(s.getAttribute('class')).toBe('i');
    expect(s.querySelector('rect.bg, linearGradient')).toBeNull();
  });

  it('[F-623] Knöpfe im Gruppenkopf tragen weiter das kleine Icon, nur die Kopf-Kachel ist groß', async () => {
    const el = await mount('sx-group-page', { data: group('club'), signedIn: true });
    expect(el.shadowRoot.querySelectorAll('svg.sx-tile')).toHaveLength(1);
    const btn = [...el.shadowRoot.querySelectorAll('button')].find((x) => /Beitritt/.test(x.textContent ?? ''))!;
    expect(btn.querySelector('svg.i')).not.toBeNull();
    expect(btn.querySelector('svg.sx-tile')).toBeNull();
  });
});

describe('Hell, dunkel, erzwungene Farben (F-624)', () => {
  it('[F-624] Kachel ist ihr eigener Hintergrund; bei forced-colors Systemfarben (Canvas/CanvasText), Stile nur unter .tile', () => {
    const css = tileStyles.cssText.replace(/\s+/g, ' ');
    expect(css).toContain('forced-color-adjust: none');
    expect(css).toMatch(/@media \(forced-colors: active\) \{ \.tile \.bg \{ fill: Canvas; stroke: CanvasText; \}/);
    const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(sel.startsWith('.tile')).toBe(true);
  });

  it('[F-624] alle Seiten mit Kachel binden tileStyles ein', async () => {
    for (const tag of ['sx-group-page', 'sx-profile-page', 'sx-discover']) {
      const styles = (customElements.get(tag) as unknown as { styles: unknown[] }).styles.flat(Infinity);
      expect(styles, tag).toContain(tileStyles);
    }
  });
});
