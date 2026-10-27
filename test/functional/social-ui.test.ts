// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche für Verein, Hafen, Team und Reaktionen (F-170 … F-183): Reaktionen, Startseite
// für Gäste und Angemeldete, Hochladen im Hintergrund, Hafenseite, Hafen-Auswahl, Heimat im Konto, Impressum und
// Datenschutz mit Platzhalter-Hinweis. Komponenten zeigen nur an und melden Absichten als Events.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-reactions';
import '../../src/components/sx-stream';
import '../../src/components/sx-home-feed';
import '../../src/components/sx-empty-state';
import '../../src/components/sx-topbar';
import '../../src/components/sx-legal-page';
import '../../src/components/sx-harbor-picker';
import '../../src/components/sx-profile-page';
import '../../src/components/sx-account-dialog';
import type { StreamItem } from '../../src/services/api';
import { OPERATOR, operatorPlaceholders, type Operator } from '../../src/content/legal';

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
const reacted = { subject: 'share' as const, id: 'S1', counts: { like: 2, mast: 1, tack: 0 }, mine: 'like' as const };
const voyage: StreamItem = {
  id: 'a1', kind: 'voyage', createdAt: T, actor: { handle: 'anna', displayName: 'Anna' }, group: null,
  voyage: { id: 'S1', title: 'Rügen', distNm: 12, startedAt: T, hasImage: false, boat: null }, reactions: reacted,
};
const harborItem: StreamItem = {
  id: 'a2', kind: 'harbor', createdAt: T, actor: null, group: null, boat: { id: 'B1', name: 'Möwe' }, harbor: { slug: 'potsdam', name: 'Potsdam <West>' },
  reactions: { subject: 'activity', id: 'a2', counts: { like: 0, mast: 0, tack: 0 }, mine: null },
};

// ---------------------------------------------------------------- Reaktionen

describe('sx-reactions', () => {
  it('[F-179] Zähler, eigene gedrückt; Klick schaltet sofort um und meldet neue und vorherige', async () => {
    const got = listen('sx-react');
    const el = await mount('sx-reactions', { value: reacted, shareKey: 'K1' });
    const like = button(el.shadowRoot, /Gefällt mir/)!;
    expect(like.getAttribute('aria-pressed')).toBe('true');
    expect(like.getAttribute('aria-label')).toBe('Gefällt mir: 2');
    expect(button(el.shadowRoot, /Mast- und Schotbruch/)!.getAttribute('aria-pressed')).toBe('false');
    expect(text(el.shadowRoot)).toContain('3 Reaktionen');
    // andere Art ersetzt
    button(el.shadowRoot, /Starker Schlag/)!.click();
    await el.updateComplete;
    expect(got[0]).toEqual({ subject: 'share', id: 'S1', kind: 'tack', previous: { counts: reacted.counts, mine: 'like', subject: 'share', id: 'S1' }, key: 'K1' });
    expect(button(el.shadowRoot, /Starker Schlag/)!.getAttribute('aria-pressed')).toBe('true');
    expect(button(el.shadowRoot, /Gefällt mir/)!.getAttribute('aria-label')).toBe('Gefällt mir: 1');
    // dieselbe noch einmal nimmt zurück
    button(el.shadowRoot, /Starker Schlag/)!.click();
    await el.updateComplete;
    expect((got[1] as { kind: unknown }).kind).toBeNull();
    expect(text(el.shadowRoot)).toContain('2 Reaktionen');
    // neue Daten von außen ersetzen die optimistische Anzeige
    el.value = { ...reacted, counts: { like: 5, mast: 0, tack: 0 } };
    await el.updateComplete;
    expect(button(el.shadowRoot, /Gefällt mir/)!.getAttribute('aria-label')).toBe('Gefällt mir: 5');
  });

  it('[F-180] „wer hat reagiert“: meldet sx-react-who, zeigt Namen escaped und den Rest als Anzahl', async () => {
    const got = listen('sx-react-who');
    const el = await mount('sx-reactions', { value: reacted });
    button(el.shadowRoot, /3 Reaktionen/)!.click();
    await el.updateComplete;
    expect((got[0] as { subject: string; id: string; el: unknown }).id).toBe('S1');
    expect((got[0] as { el: unknown }).el).toBe(el);
    expect(text(el.shadowRoot)).toContain('Lade');
    el.who = { counts: reacted.counts, mine: 'like', people: [{ handle: 'anna', displayName: '<b>Anna</b>', kind: 'like' }], others: 2 };
    await el.updateComplete;
    expect(text(el.shadowRoot)).toContain('<b>Anna</b>');
    expect(el.shadowRoot.querySelector('b')).toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/u/anna"]')).not.toBeNull();
    expect(text(el.shadowRoot)).toContain('+ 2 weitere');
  });

  it('[F-179] im Stream: jeder Eintrag mit Reaktionen; „Neues Boot im Hafen“ mit Link zum Hafen', async () => {
    const el = await mount('sx-stream', { items: [voyage, harborItem], cursor: null });
    await settle(el);
    const bars = el.shadowRoot.querySelectorAll('sx-reactions');
    expect(bars).toHaveLength(2);
    expect((bars[0] as unknown as { value: { id: string } }).value.id).toBe('S1');
    expect(text(el.shadowRoot)).toContain('Neues Boot im Hafen Potsdam <West>: Möwe');
    expect(el.shadowRoot.querySelector('a[href="/h/potsdam"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------- Startseite

describe('Startseite (F-182)', () => {
  it('[F-182] Gäste: „Neues aus der Community“, „Anmelden & mitmachen“, Filter-Chips nach Hafen und Verein', async () => {
    const login = listen('sx-login');
    const filter = listen('sx-stream-filter');
    const el = await mount('sx-home-feed', {
      signedIn: false,
      stream: { items: [voyage], cursor: null },
      filters: { harbors: [{ slug: 'potsdam', name: 'Potsdam', boats: 3 }], clubs: [{ slug: 'pyc', name: 'PYC', members: 9 }] },
      filter: null,
    });
    await settle(el);
    expect(text(el.shadowRoot)).toContain('Neues aus der Community');
    expect(text(el.shadowRoot)).not.toContain('Neuigkeiten aus deinem Verein');
    button(el.shadowRoot, /Anmelden & mitmachen/)!.click();
    expect(login).toHaveLength(1);
    expect(button(el.shadowRoot, /^ *Alle/)!.getAttribute('aria-pressed')).toBe('true');
    button(el.shadowRoot, /Potsdam/)!.click();
    expect(filter).toEqual([{ filter: { kind: 'harbor', slug: 'potsdam' } }]);
    el.filter = { kind: 'club', slug: 'pyc' };
    await el.updateComplete;
    expect(button(el.shadowRoot, /PYC/)!.getAttribute('aria-pressed')).toBe('true');
    button(el.shadowRoot, /PYC/)!.click(); // nochmal = alle
    expect(filter[1]).toEqual({ filter: null });
    expect(inner(el, 'sx-stream').getAttribute('scope')).toBe('public');
  });

  it('[F-182] Angemeldete: „Neuigkeiten aus deinem Verein, Hafen und Team“, Heimat verlinkt bzw. Hinweis zum Wählen', async () => {
    const acc = listen('sx-account');
    const el = await mount('sx-home-feed', { signedIn: true, stream: { items: [voyage], cursor: null, hasGroups: false, home: { club: null, harbor: null } } });
    expect(text(el.shadowRoot)).toContain('Neuigkeiten aus deinem Verein, Hafen und Team');
    button(el.shadowRoot, /deinen Verein und Heimathafen/)!.click();
    expect(acc).toEqual(['profile']);
    el.stream = { items: [], cursor: null, hasGroups: true, home: { club: { slug: 'pyc', name: 'PYC' }, harbor: { slug: 'potsdam', name: 'Potsdam' } } };
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('a[href="/g/pyc"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/h/potsdam"]')).not.toBeNull();
    expect(inner(el, 'sx-stream').getAttribute('scope')).toBe('home');
  });

  it('[F-182] Hochladen im Hintergrund: kompakte Karte, runder Knopf, Fußzeile; ohne Community die große Karte', async () => {
    const back = listen('sx-track-view');
    const el = await mount('sx-empty-state', { community: true, samples: [{ file: 'f', label: 'Beispiel' }] });
    expect(el.hasAttribute('community')).toBe(true);
    expect(el.shadowRoot.querySelector('.card.compact')).not.toBeNull();
    expect(el.shadowRoot.querySelector('h1')).toBeNull(); // die Überschrift der Seite gehört dem Stream
    expect(button(el.shadowRoot, /GPX-Datei wählen/)).toBeDefined();
    const fab = el.shadowRoot.querySelector('button.fab')!;
    expect(fab.getAttribute('aria-label')).toBe('Track anlegen – GPX-Datei laden');
    expect(el.shadowRoot.querySelector('slot[name="feed"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('footer a[href="/impressum"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('footer a[href="/datenschutz"]')).not.toBeNull();
    // mit geladenen Tracks: zurück zur Törn-Ansicht (F-75)
    el.trackCount = 2;
    await el.updateComplete;
    button(el.shadowRoot, /Zurück zu deinem Törn/)!.click();
    expect(back).toHaveLength(1);
    // ohne Community (kein Backend): große Einstiegskarte wie bisher
    el.community = false;
    el.trackCount = 0;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('h1')?.textContent).toContain('Deinen Törn auf die Seekarte bringen');
    expect(el.shadowRoot.querySelector('button.fab')).toBeNull();
    // Ablagefläche beim Ziehen
    el.dragging = true;
    await el.updateComplete;
    expect(text(el.shadowRoot)).toContain('Loslassen, um die GPX-Dateien zu laden');
  });

  it('[F-182] Kopfzeile: „Track anlegen“ als zweitrangiger Knopf', async () => {
    const el = await mount('sx-topbar', { home: true });
    const b = button(el.shadowRoot, /Track anlegen/)!;
    expect(b).toBeDefined();
    expect(b.classList.contains('primary')).toBe(false);
    expect(el.hasAttribute('home')).toBe(true);
  });
});

// ---------------------------------------------------------------- Impressum und Datenschutz

describe('Impressum und Datenschutz (F-183)', () => {
  const filled: Operator = { ...OPERATOR, name: 'Erika <Muster>', street: 'Hafenweg 1', city: '14467 Potsdam', email: 'kontakt@example.org', phone: '', editor: 'Erika Muster', reportEmail: 'melden@example.org' };

  it('[F-183] Platzhalter in OPERATOR → sichtbarer Warnhinweis auf beiden Seiten', async () => {
    expect(operatorPlaceholders(OPERATOR).length).toBeGreaterThan(0);
    for (const page of ['impressum', 'datenschutz']) {
      const el = await mount('sx-legal-page', { page });
      const warn = el.shadowRoot.querySelector('[role="alert"]');
      expect(warn, page).not.toBeNull();
      expect(text(warn!)).toContain('Platzhalter');
      el.remove();
    }
  });

  it('[F-183] ausgefüllt: kein Hinweis; Angaben escaped; Telefon nur, wenn angegeben', async () => {
    expect(operatorPlaceholders(filled)).toEqual([]);
    const el = await mount('sx-legal-page', { page: 'impressum', operator: filled });
    expect(el.shadowRoot.querySelector('[role="alert"]')).toBeNull();
    const t = text(el.shadowRoot);
    expect(t).toContain('Erika <Muster>');
    expect(el.shadowRoot.querySelector('muster')).toBeNull();
    expect(t).toContain('Hafenweg 1');
    expect(t).toContain('melden@example.org');
    expect(t).not.toContain('Telefon');
    el.operator = { ...filled, phone: '+49 331 1234' };
    await el.updateComplete;
    expect(text(el.shadowRoot)).toContain('Telefon: +49 331 1234');
    expect(el.shadowRoot.querySelector('a[href="/datenschutz"]')).not.toBeNull();
  });

  it('[F-183] Datenschutz beschreibt, was die App tut', async () => {
    const el = await mount('sx-legal-page', { page: 'datenschutz', operator: filled });
    const t = text(el.shadowRoot);
    for (const must of [
      'Cloudflare Workers', 'D1', 'R2', 'Turnstile', '60 Sekunden', 'Resend', 'Stripe', 'Webhook', 'Open-Meteo', 'server.arcgisonline.com', 'OpenSeaMap',
      'EMODnet', 'IndexedDB', 'Sitzungs-Cookie', '3 Monate', '12 Monate', 'Konto löschen', 'Art. 15', 'Art. 21', 'Art. 77', 'Brandenburg', 'melden@example.org',
      'Positionen und Zeitpunkte', 'Reaktionen',
    ]) {
      expect(t, must).toContain(must);
    }
  });
});

// ---------------------------------------------------------------- Hafen

describe('Häfen in der Oberfläche (F-171 … F-174)', () => {
  it('[F-172] Hafen-Auswahl: Suche nach kurzer Pause, Treffer wählen, neuer Name, leer', async () => {
    const search = listen('sx-harbor-search');
    const el = await mount('sx-harbor-picker', { inputId: 'x' });
    const input = el.shadowRoot.querySelector('input')!;
    input.value = 'Pots';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    expect((search[0] as { query: string; el: unknown }).query).toBe('Pots');
    expect((search[0] as { el: unknown }).el).toBe(el);
    expect(el.choice).toEqual({ name: 'Pots' });
    el.results = [{ id: 'H1', slug: 'potsdam', name: 'Potsdam', boats: 4 }];
    await el.updateComplete;
    expect(input.getAttribute('aria-expanded')).toBe('true');
    (el.shadowRoot.querySelector('[role="option"]') as HTMLElement).click();
    await el.updateComplete;
    expect(el.choice).toEqual({ harborId: 'H1' });
    input.value = 'potsdam';
    input.dispatchEvent(new Event('input'));
    expect(el.choice).toEqual({ harborId: 'H1' }); // gleiche Schreibweise in anderer Form → vorhandener
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(el.choice).toEqual({ harborId: null });
  });

  it('[F-173] Hafenseite: Kopf, Kennzahlen, Boote, Neuigkeiten, Folgen, Bearbeiten meldet sx-harbor-save', async () => {
    const save = listen('sx-harbor-save');
    const data = {
      kind: 'harbor',
      harbor: { id: 'H1', slug: 'potsdam', name: 'Potsdam', lat: 52.4, lon: 13.05, canEdit: true, createdAt: T },
      club: { slug: 'pyc', name: 'PYC', kind: 'club' },
      stats: { boats: 1, voyages: 2, distNm: 30, seasonNm: 12 },
      boats: [{ id: 'B1', name: 'Möwe', boatType: 'Folke', lengthM: 7.6, owner: null }],
      voyages: [],
      social: { followers: 3, isFollowing: false },
      clubChoices: [{ id: 'G1', slug: 'pyc', name: 'PYC' }],
      canClearClub: true,
      stream: { items: [harborItem], cursor: null },
    };
    const el = await mount('sx-profile-page', { data });
    await settle(el);
    const t = text(el.shadowRoot);
    expect(t).toContain('Potsdam');
    expect(t).toContain('52,4000° N');
    expect(el.shadowRoot.querySelector('a[href="/g/pyc"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/b/B1"]')).not.toBeNull();
    expect(inner(el, 'sx-stream').getAttribute('scope')).toBe('harbor');
    expect(inner(el, 'sx-follow').getAttribute('kind')).toBe('harbor');
    button(el.shadowRoot, /Bearbeiten/)!.click();
    await el.updateComplete;
    const form = el.shadowRoot.querySelector('form.edit') as HTMLFormElement;
    (form.querySelector('#hlat') as HTMLInputElement).value = '52,5';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(save).toEqual([{ id: 'H1', patch: { name: 'Potsdam', lat: 52.5, lon: 13.05, clubId: 'G1' } }]);
  });

  it('[F-170/F-174] Profil zeigt Verein und Heimathafen verlinkt; Bootsseite Hafen und Vereine', async () => {
    const profile = {
      kind: 'profile',
      profile: { handle: 'anna', displayName: 'Anna', bio: '', visibility: 'public', isSelf: false },
      boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [],
      home: { club: { slug: 'pyc', name: 'PYC' }, harbor: { slug: 'potsdam', name: 'Potsdam' } },
    };
    const el = await mount('sx-profile-page', { data: profile });
    expect(el.shadowRoot.querySelector('a[href="/g/pyc"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('a[href="/h/potsdam"]')).not.toBeNull();
    el.data = {
      kind: 'boat',
      boat: { id: 'B1', name: 'Möwe', boatType: '', lengthM: null, sailNumber: '', homePort: 'Potsdam', harbor: { id: 'H1', slug: 'potsdam', name: 'Potsdam' }, description: '', visibility: 'public', createdAt: 0, updatedAt: 0, owner: null, role: null },
      stats: { voyages: 0, distNm: 0 }, voyages: [], clubs: [{ slug: 'pyc', name: 'PYC', kind: 'club' }],
    };
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('a[href="/h/potsdam"]')).not.toBeNull();
    expect(text(el.shadowRoot)).toContain('Verein PYC');
  });

  it('[F-170] Konto: „Mein Verein“ und Heimathafen wählen meldet sx-home-save', async () => {
    const save = listen('sx-home-save');
    const el = await mount('sx-account-dialog', {
      open: true, tab: 'profile', user: { id: 'U1', email: 'a@example.org' }, profileExists: true,
      profile: { handle: 'anna', displayName: 'Anna', bio: '', visibility: 'public', isSelf: true },
      home: { club: null, harbor: { id: 'H1', slug: 'potsdam', name: 'Potsdam' }, harborExplicit: false, clubs: [{ id: 'G1', slug: 'pyc', name: 'PYC' }] },
    });
    await settle(el);
    expect(text(el.shadowRoot)).toContain('Ohne Wahl: Potsdam');
    expect(el.shadowRoot.querySelector('a[href="/impressum"]')).not.toBeNull();
    const form = el.shadowRoot.querySelector('form.home') as HTMLFormElement;
    (form.querySelector('select[name="clubId"]') as HTMLSelectElement).value = 'G1';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(save).toEqual([{ clubId: 'G1', harbor: { harborId: null } }]);
  });
});
