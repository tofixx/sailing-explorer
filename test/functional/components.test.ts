// @vitest-environment happy-dom
// Funktionale Tests der UI-Komponenten (Lit) im DOM: was der Nutzer sieht und welche Aktionen sie auslösen.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-track-list';
import '../../src/components/sx-metric-picker';
import '../../src/components/sx-topbar';
import '../../src/components/sx-account-dialog';
import '../../src/components/sx-discover';
import type { Track } from '../../src/domain/types';
import { T0, genPoints, makeTrack, P } from './helpers';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const button = (el: LitEl, label: RegExp) =>
  [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;

function listen(name: string) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  document.addEventListener(name, fn);
  cleanups.push(() => document.removeEventListener(name, fn));
  return got;
}
let cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
  document.body.innerHTML = '';
});

function glitchTrack(): Track {
  const pts = genPoints({ n: 121, dt: 10 }).map((p) => P(p.lat, p.lon, p.time));
  pts[60] = P(pts[60].lat, pts[60].lon + 0.03, pts[60].time);
  return makeTrack(pts, { id: 'g', name: 'Mit Sprung' });
}

describe('sx-track-list', () => {
  it('[F-04] zeigt die Zahl der erkannten GPS-Ausreißer je Track', async () => {
    const t = glitchTrack();
    const el = await mount('sx-track-list', { tracks: [t, makeTrack(genPoints().map((p) => P(p.lat, p.lon, p.time)), { id: 'c', name: 'Sauber' })] });
    const items = [...el.shadowRoot.querySelectorAll('li')];
    expect(items[0].textContent).toContain(`${t.stats.nGlitch} Ausreißer`);
    expect(items[1].textContent).not.toContain('Ausreißer');
  });

  it('[F-03] zeigt Distanz in sm und Fahrtdauer je Track', async () => {
    const el = await mount('sx-track-list', { tracks: [makeTrack(genPoints({ n: 61, dt: 60 }).map((p) => P(p.lat, p.lon, p.time)), { name: 'A' })] });
    expect(text(el)).toMatch(/6,0 sm/);
  });

  it('[F-05] Track ohne Zeitstempel wird als solcher gekennzeichnet', async () => {
    const el = await mount('sx-track-list', { tracks: [makeTrack(genPoints({ withTime: false }).map((p) => P(p.lat, p.lon, p.time)), { name: 'Ohne Zeit' })] });
    expect(text(el)).toMatch(/ohne Zeitstempel/);
  });

  it('[F-15] Ein-/Ausblenden und Entfernen lösen die passenden Aktionen aus', async () => {
    const toggles = listen('sx-track-toggle');
    const removes = listen('sx-track-remove');
    const t = makeTrack(genPoints().map((p) => P(p.lat, p.lon, p.time)), { id: 'x1', name: 'Törn' });
    const el = await mount('sx-track-list', { tracks: [t] });
    button(el, /Ausblenden: Törn/)!.click();
    button(el, /Entfernen: Törn/)!.click();
    expect(toggles).toEqual(['x1']);
    expect(removes).toEqual(['x1']);
  });

  it('[F-15] ausgeblendete Tracks werden als solche dargestellt (Einblenden-Schalter)', async () => {
    const t = makeTrack(genPoints().map((p) => P(p.lat, p.lon, p.time)), { id: 'h', name: 'Versteckt', hidden: true });
    const el = await mount('sx-track-list', { tracks: [t] });
    expect(el.shadowRoot.querySelector('li')!.className).toContain('hidden');
    expect(button(el, /Einblenden: Versteckt/)!.getAttribute('aria-pressed')).toBe('false');
  });

  it('[F-34] in geteilten Ansichten (readonly) kann nichts entfernt werden', async () => {
    const t = makeTrack(genPoints().map((p) => P(p.lat, p.lon, p.time)), { name: 'Geteilt' });
    const el = await mount('sx-track-list', { tracks: [t], readonly: true });
    expect(button(el, /Entfernen/)).toBeUndefined();
    expect(button(el, /Ausblenden/)).toBeDefined();
  });
});

describe('sx-metric-picker', () => {
  const layers = { seamarks: true, depth: false, windArrows: true, waveArrows: true };

  it('[F-11] Metriken ohne Daten sind deaktiviert und lassen sich nicht wählen', async () => {
    const picked = listen('sx-metric');
    const el = await mount('sx-metric-picker', { metric: 'speed', layers, range: { lo: 0, hi: 7.5 }, available: { speed: true, wind: false, gust: false, wave: false } });
    const radios = [...el.shadowRoot.querySelectorAll('[role=radio]')] as HTMLButtonElement[];
    expect(radios.map((r) => r.disabled)).toEqual([false, true, true, true]);
    expect(radios[1].title).toMatch(/keine Daten/);
    radios[1].click();
    expect(picked).toEqual([]);
  });

  it('[F-11] Wahl einer verfügbaren Metrik löst sx-metric aus', async () => {
    const picked = listen('sx-metric');
    const el = await mount('sx-metric-picker', { metric: 'speed', layers, range: { lo: 0, hi: 7.5 }, available: { speed: true, wind: true, gust: true, wave: true } });
    ([...el.shadowRoot.querySelectorAll('[role=radio]')][3] as HTMLButtonElement).click();
    expect(picked).toEqual(['wave']);
  });

  it('[F-11] Legende zeigt Bereich und Einheit', async () => {
    const el = await mount('sx-metric-picker', { metric: 'wave', layers, range: { lo: 0.4, hi: 1.6 }, available: { speed: true, wind: true, gust: true, wave: true } });
    const legend = el.shadowRoot.querySelector('.legend')!;
    expect(legend.getAttribute('aria-label')).toMatch(/0,4 bis 1,6 m/);
    expect(legend.textContent!.replace(/\s+/g, ' ')).toMatch(/0,4.*\(m\).*1,6/);
  });

  it('[F-12] Ebenen sind schaltbar; Wind-/Wellenpfeile ohne Wetterdaten deaktiviert', async () => {
    const changes = listen('sx-layers');
    const el = await mount('sx-metric-picker', { metric: 'speed', layers, range: null, available: { speed: true, wind: false, gust: false, wave: false } });
    const switches = [...el.shadowRoot.querySelectorAll('input[role=switch]')] as HTMLInputElement[];
    expect(switches).toHaveLength(4);
    expect(switches.map((s) => s.disabled)).toEqual([false, false, true, true]);
    switches[1].checked = true;
    switches[1].dispatchEvent(new Event('change'));
    expect(changes).toEqual([{ ...layers, depth: true }]);
  });
});

describe('sx-topbar', () => {
  it('[F-30] Gast-Sitzung zeigt den Hinweis „nur dieses Gerät“', async () => {
    const el = await mount('sx-topbar', { user: null, mode: { kind: 'local' }, hasTracks: true, backend: true });
    expect(text(el)).toMatch(/Gast-Sitzung · nur dieses Gerät/);
  });

  it('[F-40] ohne Backend gibt es keinen Anmelden-Knopf, Teilen bleibt möglich', async () => {
    const el = await mount('sx-topbar', { user: null, mode: { kind: 'local' }, hasTracks: true, backend: false });
    expect(button(el, /Anmelden/)).toBeUndefined();
    expect(button(el, /Teilen/)).toBeDefined();
  });

  it('[F-31] mit Backend und ohne Anmeldung: Anmelden-Knopf; Teilen löst sx-share aus', async () => {
    const shares = listen('sx-share');
    const el = await mount('sx-topbar', { user: null, mode: { kind: 'local' }, hasTracks: true, backend: true });
    expect(button(el, /Anmelden/)).toBeDefined();
    button(el, /Teilen/)!.click();
    expect(shares).toHaveLength(1);
  });

  it('[F-34] geteilte Ansicht zeigt den Titel der Freigabe', async () => {
    const el = await mount('sx-topbar', { user: null, mode: { kind: 'share', share: { id: 'x', title: 'Ostsee 2026', visibility: 'unlisted' } }, hasTracks: true, backend: true });
    expect(text(el)).toContain('Ostsee 2026');
  });
});

describe('sx-account-dialog', () => {
  const share = (id: string, title: string, visibility = 'unlisted') => ({
    id, title, summary: '', visibility, view: '', sizeBytes: 1, trackCount: 1, createdAt: T0, updatedAt: T0, isOwner: true, listed: false, boat: null,
  });
  // showModal gibt es in happy-dom nicht überall – für die Darstellung nicht nötig
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };

  async function open(shares = [share('S1', 'Erster Törn')]) {
    return mount('sx-account-dialog', { open: true, tab: 'shares', user: { id: 'u', email: 'skipper@example.org' }, shares, boats: [], loading: false, error: '' });
  }

  it('[F-36] listet eigene Freigaben mit Öffnen und Link kopieren', async () => {
    const opened = listen('sx-share-open');
    const copied = listen('sx-share-copy');
    const el = await open([share('S1', 'Erster Törn'), share('S2', 'Zweiter Törn', 'private')]);
    expect(text(el)).toContain('Erster Törn');
    expect(text(el)).toContain('Zweiter Törn');
    button(el, /Öffnen: Erster Törn/)!.click();
    button(el, /Link kopieren: Zweiter Törn/)!.click();
    expect(opened).toEqual(['S1']);
    expect(copied).toEqual(['S2']);
  });

  it('[F-36] Löschen erst nach Bestätigung', async () => {
    const deleted = listen('sx-share-delete');
    const el = await open();
    button(el, /Löschen: Erster Törn/)!.click();
    await el.updateComplete;
    expect(deleted).toEqual([]);
    const sure = button(el, /Endgültig löschen/)!;
    expect(sure).toBeDefined();
    sure.click();
    expect(deleted).toEqual(['S1']);
  });

  it('[F-36] Bestätigung lässt sich abbrechen', async () => {
    const deleted = listen('sx-share-delete');
    const el = await open();
    button(el, /Löschen: Erster Törn/)!.click();
    await el.updateComplete;
    button(el, /Abbrechen/)!.click();
    await el.updateComplete;
    expect(button(el, /Endgültig löschen/)).toBeUndefined();
    expect(deleted).toEqual([]);
  });

  it('[F-37] Abmelden; Konto löschen erst nach Bestätigung', async () => {
    const logouts = listen('sx-logout');
    const deletes = listen('sx-account-delete');
    const el = await open();
    button(el, /Abmelden/)!.click();
    expect(logouts).toHaveLength(1);
    button(el, /Konto löschen/)!.click();
    await el.updateComplete;
    expect(deletes).toEqual([]);
    button(el, /Ja, alles löschen/)!.click();
    expect(deletes).toHaveLength(1);
  });
});


describe('sx-discover', () => {
  const voyage = (id: string, o: Record<string, unknown> = {}) => ({
    id, title: `Törn ${id}`, summary: '', distNm: 12.5, startedAt: Date.UTC(2026, 5, 13, 10), createdAt: 0, trackCount: 1, hasImage: false,
    boat: null, sailor: { handle: 'anna', displayName: 'Anna' }, ...o,
  });
  const data = (o: Record<string, unknown> = {}) => ({ voyages: [], boats: [], people: [], ...o });
  const links = (el: LitEl) => [...el.shadowRoot.querySelectorAll('a')].map((a) => a.getAttribute('href'));

  it('[F-70] Leiste: höchstens 6 Törns und Link „Alle entdecken“', async () => {
    const el = await mount('sx-discover', { variant: 'strip', data: data({ voyages: Array.from({ length: 9 }, (_, i) => voyage(`v${i}`)) }) });
    expect(el.shadowRoot.querySelectorAll('article')).toHaveLength(6);
    expect(text(el)).toContain('Zuletzt gesegelt');
    expect(links(el)).toContain('/entdecken');
  });

  it('[F-70] Leiste ohne Törns rendert nichts', async () => {
    const el = await mount('sx-discover', { variant: 'strip', data: data() });
    expect(el.shadowRoot.querySelector('section')).toBeNull();
  });

  it('[F-70] Karte: Titel, Distanz, Datum, Links auf Törn, Segler und (öffentliches) Boot', async () => {
    const el = await mount('sx-discover', { variant: 'strip', data: data({ voyages: [voyage('a', { boat: { id: 'BoatId123456', name: 'Möwe' } }), voyage('b')] }) });
    const [a, b] = [...el.shadowRoot.querySelectorAll('article')];
    expect(a.textContent).toContain('Törn a');
    expect(a.textContent).toMatch(/12,5 sm · 13\.06\.2026/);
    expect([...a.querySelectorAll('a')].map((x) => x.getAttribute('href'))).toEqual(['/s/a', '/u/anna', '/b/BoatId123456']);
    expect([...b.querySelectorAll('a')].map((x) => x.getAttribute('href'))).toEqual(['/s/b', '/u/anna']);
  });

  it('[Phase A] Autor:in ohne öffentliches Profil (sailor: null) erscheint als „Segler:in“ ohne Link', async () => {
    const el = await mount('sx-discover', { variant: 'strip', data: data({ voyages: [voyage('a', { sailor: null, boat: { id: 'BoatId123456', name: 'Möwe' } })] }) });
    const card = el.shadowRoot.querySelector('article')!;
    expect(card.textContent).toContain('Segler:in');
    expect([...card.querySelectorAll('a')].map((x) => x.getAttribute('href'))).toEqual(['/s/a', '/b/BoatId123456']);
  });

  it('[F-70] Übersichtsbild nur mit hasImage und lazy geladen, sonst Platzhalter', async () => {
    const el = await mount('sx-discover', { variant: 'page', data: data({ voyages: [voyage('a', { hasImage: true }), voyage('b')] }) });
    const imgs = [...el.shadowRoot.querySelectorAll('img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('/api/shares/a/image');
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
    expect(el.shadowRoot.querySelectorAll('article')[1].querySelector('.thumb svg')).not.toBeNull();
  });

  it('[F-70] Seite: Abschnitte Törns, Boote, Segler mit Links und leeren Zuständen', async () => {
    const el = await mount('sx-discover', {
      variant: 'page',
      data: data({
        boats: [{ id: 'BoatId123456', name: 'Möwe', boatType: 'Folkeboot', lengthM: 7.6, homePort: 'Stralsund', createdAt: 0, owner: { handle: 'anna', displayName: 'Anna' }, stats: { voyages: 2, distNm: 30 } }],
        people: [{ handle: 'anna', displayName: 'Anna', bio: 'Ostsee', createdAt: 0, stats: { voyages: 2, distNm: 30, boats: 1 } }],
      }),
    });
    const t = text(el);
    expect(t).toContain('Zuletzt gesegelt');
    expect(t).toContain('Noch keine öffentlichen Törns.');
    expect(t).toContain('Folkeboot · 7,6 m · Stralsund');
    expect(t).toContain('2 Törns · 30 sm · 1 Boot');
    expect(links(el)).toEqual(expect.arrayContaining(['/b/BoatId123456', '/u/anna']));
  });

  it('[F-70] Seite: Fehler mit Weg zurück zur Karte', async () => {
    const el = await mount('sx-discover', { variant: 'page', error: 'Entdecken ist auf dieser Installation nicht verfügbar.' });
    expect(text(el)).toContain('nicht verfügbar');
    expect(links(el)).toContain('/');
  });
});
