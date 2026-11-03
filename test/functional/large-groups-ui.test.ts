// @vitest-environment happy-dom
// Oberfläche Große Gruppen (Konzept 28): Publikums-Hinweis im Plus-Knopf-Dialog (F-465) und Tageskarte im Stream
// (F-466, F-468). Komponenten zeigen nur an und melden Absichten.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-compose-dialog';
import '../../src/components/sx-stream';
import type { ComposeTarget } from '../../src/domain/posts';
import type { StreamItem } from '../../src/domain/groups';
import { dayOfKey, summarizeDay } from '../../src/domain/large-groups';

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
const button = (root: ParentNode, label: RegExp) => [...root.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
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

const reaches = [
  { reach: 'here', label: 'Nur hier', chain: 'nur PYC' },
  { reach: 'harbor', label: 'Bis Hafen', chain: 'PYC → Hafen Potsdam' },
  { reach: 'all', label: 'Überall', chain: 'PYC → Hafen Potsdam → überall' },
] as ComposeTarget['reaches'];
const targets: ComposeTarget[] = [
  { ref: { kind: 'user' }, id: '', choices: ['public'], reaches: [] },
  { ref: { kind: 'group', slug: 'pyc', name: 'PYC', groupKind: 'club' }, id: 'ClubAAAAAAAAAAAAAA', choices: ['public', 'members'], reaches },
  { ref: { kind: 'group', slug: 'mittwoch', name: 'Mittwochsregatta', groupKind: 'team' }, id: 'TeamAAAAAAAAAAAAAA', choices: ['public', 'members'], reaches: [], clubId: 'ClubAAAAAAAAAAAAAA' },
];

describe('F-465 Publikums-Hinweis', () => {
  it('[F-465] ab 100 Personen mit Team und Schnellwahl; Senden bleibt möglich; kleiner kein Hinweis', async () => {
    const picks = listen('sx-compose-channel');
    const el = await mount('sx-compose-dialog', { open: true, targets, selected: 'group:pyc', audience: { here: 140, harbor: 400, members: 120 } });
    await settle(el);
    const composer = inner(el, 'sx-post-composer');
    // Vorwahl in Gruppen: „Nur Mitglieder“ – 120
    expect(text(composer.shadowRoot)).toContain('Geht an ca. 120 Personen – lieber in einer kleineren Gruppe schreiben?');
    expect(button(composer.shadowRoot, /Team Mittwochsregatta/)).toBeTruthy();
    expect(button(composer.shadowRoot, /Veröffentlichen/)!.textContent).toBeTruthy();
    // Öffentlich, „Überall“: 400, Schnellwahl „Nur hier (ca. 140)“ und „Nur Mitglieder (ca. 120)“
    (composer.shadowRoot.querySelectorAll('input[type=radio]')[0] as HTMLInputElement).click();
    await settle(composer);
    expect(text(composer.shadowRoot)).toContain('ca. 400 Personen');
    button(composer.shadowRoot, /Nur hier \(ca\. 140\)/)!.click();
    await settle(composer);
    expect(text(composer.shadowRoot)).toContain('ca. 140 Personen');
    expect(button(composer.shadowRoot, /Nur Mitglieder \(ca\. 120\)/)).toBeTruthy();
    // kleinere Gruppe wählen: Verlauf wechselt, Publikum wird neu geladen
    button(composer.shadowRoot, /Team Mittwochsregatta/)!.click();
    await settle(el);
    expect(el.selected).toBe('group:mittwoch');
    expect(el.audience).toBeNull();
    expect(picks).toEqual([{ ctx: 'group:TeamAAAAAAAAAAAAAA' }]);
    el.audience = { here: 30, members: 20 };
    await settle(el);
    expect(text(inner(el, 'sx-post-composer').shadowRoot)).not.toContain('Personen');
  });
});

describe('F-466 Tageskarte', () => {
  const day = dayOfKey('2026-06-13')!;
  const post = (id: string, at: number): StreamItem => ({ id, kind: 'post', createdAt: at, actor: null, group: null, post: { id: `P${id}`, body: `Text ${id}`, link: null, canDelete: false } });

  it('[F-466] Karte nach Zeit zwischen den Einträgen, Vorschau, „Alle anzeigen“ meldet Tag; aufgeklappt „Weitere laden“', async () => {
    const opens = listen('sx-day-open');
    const pooled = [post('a', day.start + 5000), post('b', day.start + 4000), post('c', day.start + 3000), post('d', day.start + 2000)];
    const card = summarizeDay(day, pooled);
    const items = [post('neu', day.end + 1000), post('admin', day.start + 4500), post('alt', day.start - 1000)];
    const el = await mount('sx-stream', { scope: 'group', items, days: [card] });
    await settle(el);
    const lis = [...el.shadowRoot.querySelector('ol')!.children];
    expect(lis.map((l) => (l.classList.contains('day') ? 'day' : l.textContent!.match(/Text (\w+)/)![1]))).toEqual(['neu', 'day', 'admin', 'alt']);
    expect(text(lis[1])).toContain('Sa, 13.6. – 4 Beiträge');
    expect(lis[1].querySelectorAll('ol li')).toHaveLength(3);
    button(lis[1], /Alle anzeigen \(4\)/)!.click();
    expect(opens).toEqual([{ scope: 'group', day: '2026-06-13', cursor: null }]);
    el.days = [{ ...card, open: { items: pooled, cursor: 'x_AAAAAAAAAAAA' } }];
    await settle(el);
    const open = el.shadowRoot.querySelector('li.day')!;
    expect(open.querySelectorAll('ol li')).toHaveLength(4);
    button(open, /Weitere laden/)!.click();
    expect(opens[1]).toEqual({ scope: 'group', day: '2026-06-13', cursor: 'x_AAAAAAAAAAAA' });
  });
});
