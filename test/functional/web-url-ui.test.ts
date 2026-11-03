// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche: Webseite von Verein/Team und Hafen (F-540, F-541) – Link im Seitenkopf (neuer Tab,
// rel="noopener nofollow ugc", Anzeige ohne www.), nichts bei ungültiger Adresse, Feld im Bearbeiten-Formular.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-group-page';
import '../../src/components/sx-profile-page';
import type { GroupPageData } from '../../src/services/api';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const menuItem = (el: LitEl, label: RegExp) =>
  [...((el.shadowRoot.querySelector('sx-page-menu') as LitEl).shadowRoot.querySelectorAll('button'))].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement;
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

const T = Date.UTC(2026, 10, 3, 10);
const groupData = (webUrl: string | null, role: string | null = null) =>
  ({
    group: { id: 'G1', kind: 'club', slug: 'svp', name: 'SVP', description: '', homePort: '', webUrl, visibility: 'public', joinMode: 'request', role, shareKey: null, link: null, hiddenAt: null, createdAt: T },
    parent: null,
    teams: [],
    stats: { members: 1, boats: 0, voyages: 0, distNm: 0, seasonNm: 0 },
    members: [],
    others: 0,
    boats: [],
    social: { followers: 0, isFollowing: false },
    membership: { role, requested: false, canRequest: !role },
  }) as unknown as GroupPageData;

const harborData = (webUrl: string | null) => ({
  kind: 'harbor',
  harbor: { id: 'H1', slug: 'potsdam', name: 'Potsdam', lat: 52.4, lon: 13.05, webUrl, canEdit: true, createdAt: T },
  club: null,
  stats: { boats: 0, voyages: 0, distNm: 0, seasonNm: 0 },
  boats: [],
  voyages: [],
  social: { followers: 0, isFollowing: false },
  clubChoices: [],
  canClearClub: false,
});

describe('F-540/F-541 Webseite in der Oberfläche', () => {
  it('[F-540] Gruppenseite: Link zur Webseite in neuem Tab mit rel="noopener nofollow ugc", Host ohne www.', async () => {
    const el = await mount('sx-group-page', { data: groupData('https://www.svp-potsdam.example/verein') });
    const a = el.shadowRoot.querySelector('.facts .web a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://www.svp-potsdam.example/verein');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener nofollow ugc');
    expect(a.textContent).toBe('svp-potsdam.example');
  });

  it('[F-540] ungültige Adresse (etwa javascript:) zeigt keinen Link; ohne Webseite kein Eintrag', async () => {
    for (const url of ['javascript:alert(1)', null]) {
      const el = await mount('sx-group-page', { data: groupData(url) });
      expect(el.shadowRoot.querySelector('.facts .web'), String(url)).toBeNull();
      el.remove();
    }
  });

  it('[F-540] Bearbeiten: Feld „Webseite“ mit aktuellem Wert, Speichern meldet webUrl', async () => {
    const saves = listen('sx-group-save');
    const el = await mount('sx-group-page', { data: groupData('https://svp.example/', 'owner'), signedIn: true });
    menuItem(el, /Bearbeiten/).click();
    await el.updateComplete;
    const input = el.shadowRoot.querySelector('input[type="url"]') as HTMLInputElement;
    expect(input.value).toBe('https://svp.example/');
    input.value = ' https://neu.example/ ';
    input.dispatchEvent(new Event('input'));
    (el.shadowRoot.querySelector('form[aria-label="Gruppe bearbeiten"]') as HTMLFormElement).requestSubmit();
    expect(saves[0]).toMatchObject({ id: 'G1', patch: { webUrl: 'https://neu.example/' } });
  });

  it('[F-541] Hafenseite: Link im Kopf; Bearbeiten (Anleger:in) meldet die Webseite mit sx-harbor-save', async () => {
    const saves = listen('sx-harbor-save');
    const el = await mount('sx-profile-page', { data: harborData('https://hafen.example/') });
    const a = el.shadowRoot.querySelector('.facts .web a') as HTMLAnchorElement;
    expect(a.getAttribute('rel')).toBe('noopener nofollow ugc');
    expect(a.textContent).toBe('hafen.example');
    menuItem(el, /Bearbeiten/).click();
    await el.updateComplete;
    const form = el.shadowRoot.querySelector('form.edit') as HTMLFormElement;
    (form.querySelector('#hw') as HTMLInputElement).value = '';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saves[0]).toMatchObject({ id: 'H1', patch: { webUrl: '' } });
  });
});
