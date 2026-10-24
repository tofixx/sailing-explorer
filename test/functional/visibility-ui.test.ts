// @vitest-environment happy-dom
// Funktionale Tests der Sichtbarkeits-Oberfläche (Phase A): sx-visibility-picker, Teilen-Dialog, Konto (Törns, Boote,
// Profil) und Profil-/Bootsseite. Regeln: docs/CONCEPT.md E1–E5, Vertrag: docs/PHASE-A-CONTRACT.md.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-visibility-picker';
import '../../src/components/sx-share-dialog';
import '../../src/components/sx-account-dialog';
import '../../src/components/sx-profile-page';
import { SUPPORT_TIERS } from '../../src/domain/support';
import { VISIBILITY_HINT } from '../../src/domain/visibility';
import { T0 } from './helpers';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const KEY = 'Kq7mPz2xWv9tRb4nHs6dJf';
const USER = { id: 'U1234567890abcdefg', email: 'skipper@example.org' };
const status = (supporter: boolean) => ({ supporter, supporterUntil: null, sharesUsed: 0, sharesFree: 3, sharesMax: 100, bytesUsed: 0, bytesMax: 1 });

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Text inkl. verschachtelter Komponenten. */
function deepText(root: ShadowRoot | Element): string {
  let out = '';
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent;
    else if (n instanceof Element) out += (n.shadowRoot ? deepText(n.shadowRoot) : '') + deepText(n);
  });
  return out.replace(/\s+/g, ' ');
}

const button = (root: ShadowRoot, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;

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

const options = (picker: LitEl) => [...picker.shadowRoot.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const option = (picker: LitEl, v: string) => options(picker).find((o) => o.dataset.value === v)!;
async function pickerIn(host: LitEl): Promise<LitEl> {
  const p = host.shadowRoot.querySelector('sx-visibility-picker') as LitEl;
  await p.updateComplete;
  return p;
}

// ---------------------------------------------------------------- Picker

describe('sx-visibility-picker', () => {
  it('zeigt drei Stufen mit Bezeichnung und Erklärsatz als Radiogruppe', async () => {
    const el = await mount('sx-visibility-picker', { value: 'public', supporter: true });
    expect(el.shadowRoot.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Wer darf es sehen?');
    const opts = options(el);
    expect(opts.map((o) => o.dataset.value)).toEqual(['public', 'unlisted', 'private']);
    expect(opts.map((o) => o.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      `Öffentlich ${VISIBILITY_HINT.public}`,
      `Nur mit Link ${VISIBILITY_HINT.unlisted}`,
      `Nur ich ${VISIBILITY_HINT.private}`,
    ]);
    expect(opts.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    // Roving tabindex: nur die gewählte Stufe ist per Tab erreichbar
    expect(opts.map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    expect(opts.every((o) => o.type === 'button')).toBe(true);
  });

  it('kostenlos: „Nur mit Link“ und „Nur ich“ gesperrt mit „Für Unterstützer“; Aktivieren meldet sx-visibility-locked', async () => {
    const changes = listen('sx-visibility-change');
    const locked = listen('sx-visibility-locked');
    const el = await mount('sx-visibility-picker', { value: 'public', supporter: false });
    const [pub, unl, priv] = options(el);
    expect(pub.getAttribute('aria-disabled')).toBe('false');
    expect([unl, priv].map((o) => o.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    expect(unl.textContent).toContain('Für Unterstützer');
    expect(priv.textContent).toContain('Für Unterstützer');
    expect(pub.textContent).not.toContain('Für Unterstützer');
    unl.click();
    priv.click();
    expect(locked).toEqual([{ value: 'unlisted' }, { value: 'private' }]);
    expect(changes).toEqual([]);
  });

  it('Unterstützer: alle Stufen wählbar, Wahl meldet sx-visibility-change (Wert setzt der Host)', async () => {
    const changes = listen('sx-visibility-change');
    const locked = listen('sx-visibility-locked');
    const el = await mount('sx-visibility-picker', { value: 'public', supporter: true });
    expect(el.shadowRoot.textContent).not.toContain('Für Unterstützer');
    option(el, 'private').click();
    option(el, 'public').click(); // bereits gewählt: kein Event
    expect(changes).toEqual([{ value: 'private' }]);
    expect(locked).toEqual([]);
    await el.updateComplete;
    expect(option(el, 'public').getAttribute('aria-checked')).toBe('true'); // kontrolliert
  });

  it('kostenlos mit bereits gesetzter Stufe (E4/E5): diese bleibt wählbar, die andere gesperrt', async () => {
    const changes = listen('sx-visibility-change');
    const locked = listen('sx-visibility-locked');
    const el = await mount('sx-visibility-picker', { value: 'public', supporter: false, current: 'unlisted' });
    expect(option(el, 'unlisted').getAttribute('aria-disabled')).toBe('false');
    expect(option(el, 'private').getAttribute('aria-disabled')).toBe('true');
    option(el, 'unlisted').click();
    option(el, 'private').click();
    expect(changes).toEqual([{ value: 'unlisted' }]);
    expect(locked).toEqual([{ value: 'private' }]);
  });

  it('Tastatur: Pfeiltasten bewegen den Fokus mit Umlauf, Enter/Leertaste wählt über click', async () => {
    const changes = listen('sx-visibility-change');
    const el = await mount('sx-visibility-picker', { value: 'public', supporter: true });
    const [pub, , priv] = options(el);
    pub.focus();
    pub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(el.shadowRoot.activeElement).toBe(priv);
    expect(priv.tabIndex).toBe(0);
    expect(changes).toEqual([]); // Bewegen wählt nicht
    priv.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(el.shadowRoot.activeElement).toBe(pub);
  });

  it('gesperrt (disabled) meldet nichts', async () => {
    const changes = listen('sx-visibility-change');
    const el = await mount('sx-visibility-picker', { value: 'public', supporter: true, disabled: true });
    option(el, 'private').click();
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------- Teilen-Dialog

describe('sx-share-dialog: Sichtbarkeit', () => {
  const form = (o: Record<string, unknown> = {}) =>
    mount('sx-share-dialog', { open: true, tab: 'link', linkState: 'form', defaultTitle: 'Törn', boats: [], supportStatus: status(false), supportTiers: SUPPORT_TIERS, ...o });

  it('Standard ist „Öffentlich“ mit einem Satz zu den Folgen; das Formular sendet visibility ohne listed', async () => {
    const submits = listen('sx-share-submit');
    const el = await form();
    const p = await pickerIn(el);
    expect(option(p, 'public').getAttribute('aria-checked')).toBe('true');
    expect(el.shadowRoot.querySelector('.consequence')!.textContent).toMatch(/für alle sichtbar.*Profil.*Entdecken/);
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(submits).toEqual([{ title: 'Törn', visibility: 'public', boatId: null, includeView: true }]);
  });

  it('kostenlos: gesperrte Stufe zeigt das Unterstützen-Angebot, die Wahl bleibt „Öffentlich“', async () => {
    const submits = listen('sx-share-submit');
    const el = await form();
    const p = await pickerIn(el);
    option(p, 'unlisted').click();
    await el.updateComplete;
    expect(el.visibility).toBe('public');
    const t = deepText(el.shadowRoot);
    expect(t).toContain('„Nur mit Link“ und „Nur ich“ gibt es für Unterstützer');
    expect(el.shadowRoot.querySelector('sx-support')).not.toBeNull();
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect((submits[0] as { visibility: string }).visibility).toBe('public');
  });

  it('Unterstützer: „Nur mit Link“ wählen ändert den Folgen-Satz und wird gesendet', async () => {
    const submits = listen('sx-share-submit');
    const el = await form({ supportStatus: status(true) });
    option(await pickerIn(el), 'unlisted').click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.consequence')!.textContent).toMatch(/geheimen Link/);
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect((submits[0] as { visibility: string }).visibility).toBe('unlisted');
  });

  it('Ergebnis zeigt den Link samt Schlüssel und die Stufe', async () => {
    const url = `https://sail.example/s/AbCdEfGhJkLmNpQr23/${KEY}`;
    const el = await form({ result: { share: { id: 'AbCdEfGhJkLmNpQr23', title: 'Törn', summary: '', visibility: 'unlisted', isOwner: true }, url } });
    expect(el.shadowRoot.querySelector<HTMLInputElement>('.linkrow input')!.value).toBe(url);
    expect(deepText(el.shadowRoot)).toMatch(/Nur mit Link Wer diesen Link hat/);
  });
});

// ---------------------------------------------------------------- Konto

describe('sx-account-dialog: Sichtbarkeit und Links', () => {
  const share = (o: Record<string, unknown> = {}) => ({
    id: 'S1', title: 'Erster Törn', summary: '', visibility: 'public', shareKey: null, link: '/s/S1', view: '', sizeBytes: 1, trackCount: 1,
    createdAt: T0, updatedAt: T0, isOwner: true, boat: null, ...o,
  });
  const boat = (o: Record<string, unknown> = {}) => ({
    id: 'BoatId1234567890', name: 'Möwe', boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '', visibility: 'public',
    shareKey: null, link: '/b/BoatId1234567890', createdAt: T0, updatedAt: T0, owner: null, role: 'owner', ...o,
  });
  const open = (o: Record<string, unknown> = {}) =>
    mount('sx-account-dialog', { open: true, tab: 'shares', user: USER, shares: [share()], boats: [], loading: false, error: '', supportStatus: status(true), supportTiers: SUPPORT_TIERS, ...o });

  async function expand(el: LitEl, title = 'Erster Törn') {
    button(el.shadowRoot, new RegExp(`Sichtbarkeit und Link: ${title}`))!.click();
    await el.updateComplete;
  }

  it('Törn: Stufe steht in der Zeile; aufgeklappt ändert der Picker die Stufe per sx-share-update', async () => {
    const updates = listen('sx-share-update');
    const el = await open();
    const toggle = button(el.shadowRoot, /Sichtbarkeit und Link: Erster Törn/)!;
    expect(toggle.textContent).toContain('Öffentlich');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await expand(el);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const p = await pickerIn(el);
    expect(p.getAttribute('label')).toBe('Wer darf „Erster Törn“ sehen?');
    option(p, 'unlisted').click();
    expect(updates).toEqual([{ id: 'S1', patch: { visibility: 'unlisted' } }]);
  });

  it('Törn „Nur mit Link“: Link mit Schlüssel, Kopieren und „Link erneuern“ erst nach Bestätigung', async () => {
    const updates = listen('sx-share-update');
    const copies = listen('sx-share-copy');
    const el = await open({ shares: [share({ visibility: 'unlisted', shareKey: KEY, link: `/s/S1/${KEY}` })] });
    await expand(el);
    expect(el.shadowRoot.querySelector<HTMLInputElement>('.panel input')!.value).toBe(`${location.origin}/s/S1/${KEY}`);
    button(el.shadowRoot, /^ *Kopieren$/)!.click();
    expect(copies).toEqual(['S1']);
    button(el.shadowRoot, /Link erneuern/)!.click();
    await el.updateComplete;
    expect(updates).toEqual([]);
    expect(el.shadowRoot.querySelector('.confirm')!.textContent).toMatch(/bisherige Link funktioniert dann sofort nicht mehr/);
    button(el.shadowRoot, /Abbrechen/)!.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.confirm')).toBeNull();
    button(el.shadowRoot, /Link erneuern/)!.click();
    await el.updateComplete;
    button(el.shadowRoot, /Ja, Link erneuern/)!.click();
    expect(updates).toEqual([{ id: 'S1', patch: { rotateKey: true } }]);
  });

  it('„Link erneuern“ gibt es nur bei „Nur mit Link“; „Nur ich“ hat keinen Link', async () => {
    const el = await open({ shares: [share(), share({ id: 'S2', title: 'Privat', visibility: 'private', link: '/s/S2' })] });
    await expand(el);
    expect(button(el.shadowRoot, /Link erneuern/)).toBeUndefined();
    expect(el.shadowRoot.querySelector<HTMLInputElement>('.panel input')!.value).toBe(`${location.origin}/s/S1`);
    await expand(el, 'Privat');
    expect(deepText(el.shadowRoot)).toContain('Nur du siehst diesen Törn');
    expect(el.shadowRoot.querySelector('.panel input')).toBeNull();
  });

  it('kostenlos: eigene gespeicherte Stufe bleibt wählbar, gesperrte Stufe zeigt das Angebot statt PATCH', async () => {
    const updates = listen('sx-share-update');
    const el = await open({ supportStatus: status(false), shares: [share({ visibility: 'unlisted', shareKey: null, link: '/s/S1' })] });
    await expand(el);
    const p = await pickerIn(el);
    expect(option(p, 'unlisted').getAttribute('aria-disabled')).toBe('false');
    option(p, 'private').click();
    await el.updateComplete;
    expect(updates).toEqual([]);
    expect(deepText(el.shadowRoot)).toContain('„Nur mit Link“ und „Nur ich“ gibt es für Unterstützer');
    option(p, 'public').click();
    expect(updates).toEqual([{ id: 'S1', patch: { visibility: 'public' } }]);
  });

  it('Boot anlegen: Picker mit Standard „Öffentlich“; gespeichert wird die gewählte Stufe', async () => {
    const saves = listen('sx-boat-save');
    const el = await open({ tab: 'boats' });
    button(el.shadowRoot, /Boot anlegen/)!.click();
    await el.updateComplete;
    const p = await pickerIn(el);
    expect(option(p, 'public').getAttribute('aria-checked')).toBe('true');
    option(p, 'private').click();
    await el.updateComplete;
    el.shadowRoot.querySelector<HTMLInputElement>('#bn')!.value = 'Möwe';
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saves).toEqual([{ id: null, input: expect.objectContaining({ name: 'Möwe', visibility: 'private' }) }]);
  });

  it('Boot „Nur mit Link“: Link kopieren (sx-link-copy) und erneuern (rotateKey) nach Bestätigung', async () => {
    const saves = listen('sx-boat-save');
    const copies = listen('sx-link-copy');
    const el = await open({ tab: 'boats', boats: [boat({ visibility: 'unlisted', shareKey: KEY, link: `/b/BoatId1234567890/${KEY}` })] });
    expect(deepText(el.shadowRoot)).toContain('Nur mit Link');
    button(el.shadowRoot, /^Link: Möwe/)!.click();
    await el.updateComplete;
    button(el.shadowRoot, /^ *Kopieren$/)!.click();
    expect(copies).toEqual([`/b/BoatId1234567890/${KEY}`]);
    button(el.shadowRoot, /Link erneuern/)!.click();
    await el.updateComplete;
    button(el.shadowRoot, /Ja, Link erneuern/)!.click();
    expect(saves).toEqual([{ id: 'BoatId1234567890', input: { rotateKey: true } }]);
  });

  it('Profil: neues Profil startet „Öffentlich“; gespeichertes Profil zeigt Link und kann ihn erneuern', async () => {
    const saves = listen('sx-profile-save');
    const profile = { handle: 'anna', displayName: 'Anna', bio: '', visibility: 'private', shareKey: null, link: null, isSelf: true };
    const fresh = await open({ tab: 'profile', profile, profileExists: false });
    expect(option(await pickerIn(fresh), 'public').getAttribute('aria-checked')).toBe('true');
    fresh.remove();

    const el = await open({ tab: 'profile', profile: { ...profile, visibility: 'unlisted', shareKey: KEY, link: `/u/anna/${KEY}` }, profileExists: true });
    expect(option(await pickerIn(el), 'unlisted').getAttribute('aria-checked')).toBe('true');
    expect(el.shadowRoot.querySelector<HTMLInputElement>('.panel input')!.value).toBe(`${location.origin}/u/anna/${KEY}`);
    button(el.shadowRoot, /Link erneuern/)!.click();
    await el.updateComplete;
    button(el.shadowRoot, /Ja, Link erneuern/)!.click();
    expect(saves).toEqual([{ handle: 'anna', displayName: 'Anna', bio: '', visibility: 'unlisted', rotateKey: true }]);
  });
});

// ---------------------------------------------------------------- Seiten

describe('sx-profile-page: Stufe für Eigentümer', () => {
  it('eigene „Nur mit Link“-Bootsseite zeigt die Stufe und kopiert den Schlüssel-Link', async () => {
    const copies = listen('sx-link-copy');
    const b = { id: 'BoatId1234567890', name: 'Möwe', boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '', visibility: 'unlisted', shareKey: KEY, link: `/b/BoatId1234567890/${KEY}`, owner: null, role: 'owner' };
    const el = await mount('sx-profile-page', { data: { kind: 'boat', boat: b, stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(deepText(el.shadowRoot)).toContain('Nur mit Link – nur wer den Link hat');
    button(el.shadowRoot, /Link kopieren/)!.click();
    expect(copies).toEqual([`/b/BoatId1234567890/${KEY}`]);
  });

  it('fremde Seiten zeigen keine Stufe und keinen Kopieren-Knopf', async () => {
    const p = { handle: 'anna', displayName: 'Anna', bio: '', visibility: 'unlisted', shareKey: null, link: null, isSelf: false };
    const el = await mount('sx-profile-page', { data: { kind: 'profile', profile: p, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(deepText(el.shadowRoot)).not.toContain('Nur mit Link');
    expect(button(el.shadowRoot, /Link kopieren/)).toBeUndefined();
  });
});
