// @vitest-environment happy-dom
// Funktionale Tests der Seite /entdecken (F-330 … F-333): Titelbilder als breiter Streifen, Suche, Abschnitte mit
// Häfen, Beitreten-Knöpfe je Beitrittsstufe – Komponente, reine Regeln und Controller (Netz gefälscht).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-discover';
import '../../src/components/sx-page-media';
import type { SxCover } from '../../src/components/sx-page-media';
import { coverBannerStyles, coverPosition } from '../../src/components/shared';
import { SxDiscover } from '../../src/components/sx-discover';
import { DiscoverController, SEARCH_DELAY_MS } from '../../src/controllers/discover';
import { Store, initialState } from '../../src/services/store';
import { joinAction } from '../../src/domain/groups';
import { searchKey, searchLike, sqlSearchFold } from '../../src/domain/search';
import type { DiscoverData, DiscoverGroup } from '../../src/services/api';

type LitEl = SxDiscover & { shadowRoot: ShadowRoot };

async function mount(props: Partial<SxDiscover>): Promise<LitEl> {
  const el = document.createElement('sx-discover') as LitEl;
  Object.assign(el, { variant: 'page', ...props });
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const data = (o: Partial<DiscoverData> = {}): DiscoverData => ({ voyages: [], boats: [], people: [], ...o });
const club = (o: Partial<DiscoverGroup> = {}): DiscoverGroup => ({
  id: 'G1', slug: 'pyc', name: 'PYC', kind: 'club', homePort: 'Potsdam', description: '', createdAt: 0, members: 3, joinMode: 'open', ...o,
});

let cleanups: Array<() => void> = [];
function listen(name: string) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  document.addEventListener(name, fn);
  cleanups.push(() => document.removeEventListener(name, fn));
  return got;
}
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- F-330 Titelbilder

describe('F-330 Titelbilder auf /entdecken', () => {
  const boat = { id: 'B1', name: 'Möwe', boatType: '', lengthM: null, homePort: '', createdAt: 0, owner: { handle: 'a', displayName: 'A' }, stats: { voyages: 0, distNm: 0 } };

  it('[F-330] Boots-Titelbild als breiter 3:1-Streifen mit gespeichertem Ausschnitt, nie hochkant', async () => {
    const el = await mount({ data: data({ boats: [{ ...boat, cover: { src: '/api/covers/b/B1/v1', y: 20 } }] }) });
    const img = el.shadowRoot.querySelector<HTMLImageElement>('.card img.cv')!;
    expect(img.classList.contains('cover-banner')).toBe(true);
    expect(img.style.objectPosition).toBe('50% 20%');
    // derselbe Streifen wie im Kopf der Bootsseite (COVER_BANNER_RATIO = 3), über die volle Kartenbreite
    const css = SxDiscover.styles.map((s) => String(s)).join('\n');
    expect(css).toContain(String(coverBannerStyles));
    expect(String(coverBannerStyles)).toMatch(/aspect-ratio: 3 \/ 1;[^}]*object-fit: cover/);
    const rule = /\.card \.cv \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('width: calc(100% + 2 * var(--s-4))');
    expect(rule).toContain('min-width: 0');
    expect(rule).not.toContain('aspect-ratio');
  });

  it('[F-330] gleicher Ausschnitt wie im Seitenkopf: Karte und sx-cover setzen dieselbe Position', async () => {
    const el = await mount({ data: data({ boats: [{ ...boat, cover: { src: '/api/covers/b/B1/v1', y: 73 } }] }) });
    const card = el.shadowRoot.querySelector<HTMLImageElement>('.card img.cv')!;
    const head = document.createElement('sx-cover') as SxCover;
    Object.assign(head, { kind: 'b', targetId: 'B1', src: '/api/covers/b/B1/v1', focusY: 73 });
    document.body.append(head);
    await head.updateComplete;
    const headImg = head.shadowRoot!.querySelector<HTMLImageElement>('.frame img')!;
    expect(card.style.objectPosition).toBe(headImg.style.objectPosition);
    expect(card.getAttribute('style')).toBe(coverPosition(73));
  });
});

// ---------------------------------------------------------------- F-331 Suche

describe('F-331 Suche', () => {
  it('[F-331] Suchschlüssel: klein, ohne Akzente, ß → ss; die SQL-Faltung kennt dieselben Zeichen', () => {
    expect(searchKey('  Möwe  ÆRØ Straße ')).toBe('mowe aero strasse');
    expect(searchKey('Élan À')).toBe('elan a');
    const fold = sqlSearchFold('x');
    for (const c of ['ä', 'Ä', 'ö', 'Ö', 'ü', 'Ü', 'ß', 'é', 'ø', 'Æ']) expect(fold).toContain(`'${c}'`);
    expect(fold.startsWith('REPLACE(')).toBe(true);
    expect(searchLike('50%_a\\')).toBe('%50\\%\\_a\\\\%');
  });

  it('[F-331] Suchfeld meldet die Eingabe; ohne Treffer ein Hinweis statt leerer Abschnitte', async () => {
    const got = listen('sx-discover-search');
    const el = await mount({ query: 'xyz', data: data({ query: 'xyz', groups: [], harbors: [] }) });
    const input = el.shadowRoot.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.value).toBe('xyz');
    input.value = 'Möwe';
    input.dispatchEvent(new Event('input'));
    expect(got).toEqual([{ query: 'Möwe' }]);
    expect(text(el)).toContain('Keine Treffer für „xyz“');
    expect(el.shadowRoot.querySelectorAll('section')).toHaveLength(0);
  });

  it('[F-331] Controller: sucht verzögert serverseitig, merkt die Suche in der Adresse, verwirft kurze Eingaben', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
      return new Response(JSON.stringify(data({ query: q.toLowerCase() })), { headers: { 'Content-Type': 'application/json' } });
    });
    history.replaceState(null, '', '/entdecken?q=Kiel');
    const page = document.createElement('sx-discover') as SxDiscover;
    document.body.append(page);
    const c = new DiscoverController(new Store({ ...initialState, user: null, backend: true } as typeof initialState), page);
    await c.open();
    expect(urls).toEqual(['/api/discover?limit=24&q=Kiel']);
    expect(page.query).toBe('Kiel');

    vi.useFakeTimers();
    c.search('Pot');
    c.search('Potsdam');
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS + 10);
    expect(urls.slice(1)).toEqual(['/api/discover?limit=24&q=Potsdam']);
    expect(location.search).toBe('?q=Potsdam');

    c.search('P');
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS + 10);
    expect(urls.at(-1)).toBe('/api/discover?limit=24');
    expect(page.data?.query).toBe('');
  });
});

// ---------------------------------------------------------------- F-332 Häfen und Abschnitte

describe('F-332 Häfen und Abschnitte', () => {
  it('[F-332] Abschnitt Häfen mit Link und Zahlen; Chips zeigen einen Abschnitt allein', async () => {
    const el = await mount({ data: data({ harbors: [{ slug: 'potsdam', name: 'Potsdam', boats: 2, groups: 1 }], groups: [club()] }) });
    const card = el.shadowRoot.querySelector('#haefen a[href="/h/potsdam"]')!;
    expect(card.textContent).toMatch(/2 Boote · 1 Verein\/Team/);
    const chip = [...el.shadowRoot.querySelectorAll<HTMLButtonElement>('.tabs button')].find((b) => b.textContent === 'Häfen')!;
    chip.click();
    await el.updateComplete;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect([...el.shadowRoot.querySelectorAll('section')].map((s) => s.id)).toEqual(['haefen']);
  });
});

// ---------------------------------------------------------------- F-333 Beitreten

describe('F-333 Beitreten auf Vereinskarten', () => {
  it('[F-333] Regel: offen → Beitreten, Anfrage → Anfragen/Angefragt, Einladung → Hinweis, Mitglied zuerst', () => {
    const none = { member: false, requested: false };
    expect(joinAction('open', none)).toBe('join');
    expect(joinAction('request', none)).toBe('request');
    expect(joinAction('request', { member: false, requested: true })).toBe('requested');
    expect(joinAction('invite', none)).toBe('invite');
    expect(joinAction('open', { member: true, requested: true })).toBe('member');
    expect(joinAction(undefined, none)).toBeNull();
  });

  it('[F-333] Karten zeigen den Knopf je Stufe und melden sx-group-join; kein Knopf in einem Link', async () => {
    const got = listen('sx-group-join');
    const groups = [
      club(),
      club({ id: 'G2', slug: 'req', name: 'Req', joinMode: 'request' }),
      club({ id: 'G3', slug: 'inv', name: 'Inv', joinMode: 'invite' }),
      club({ id: 'G4', slug: 'asked', name: 'Asked', joinMode: 'request' }),
      club({ id: 'G5', slug: 'mine', name: 'Mine', joinMode: 'open' }),
    ];
    const el = await mount({ data: data({ groups }), membership: { member: ['mine'], requested: ['asked'] } });
    const cards = [...el.shadowRoot.querySelectorAll('#vereine .card')];
    const label = (i: number) => (cards[i].querySelector('.join, .join-note')?.textContent ?? '').trim();
    expect([0, 1, 2, 3, 4].map(label)).toEqual(['Beitreten', 'Anfragen', 'Nur auf Einladung', 'Angefragt', 'Mitglied']);
    expect(el.shadowRoot.querySelector('a button')).toBeNull();
    expect(cards[3].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    cards[1].querySelector<HTMLButtonElement>('button')!.click();
    expect(got).toEqual([{ id: 'G2' }]);
    el.joining = 'G1';
    await el.updateComplete;
    expect(cards[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  });

  it('[F-333] Controller: Gäste ohne Mitgliedschaften; nach dem Beitritt wird der Stand neu geladen', async () => {
    let requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const body = url === '/api/groups' ? { groups: [{ slug: 'pyc' }], requests: requested.map((slug) => ({ slug })) } : data();
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    });
    const page = document.createElement('sx-discover') as SxDiscover;
    document.body.append(page);
    const guest = new DiscoverController(new Store({ ...initialState, user: null, backend: true } as typeof initialState), page);
    await guest.loadMembership();
    expect(page.membership).toBeNull();
    const c = new DiscoverController(new Store({ ...initialState, user: { id: 'u', email: 'a@b.de' }, backend: true } as typeof initialState), page);
    let during = '';
    await c.join('G2', async () => {
      during = page.joining;
      requested = ['req'];
    });
    expect(during).toBe('G2');
    expect(page.joining).toBe('');
    expect(page.membership).toEqual({ member: ['pyc'], requested: ['req'] });
  });
});

beforeEach(() => {
  history.replaceState(null, '', '/entdecken');
});
