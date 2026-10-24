// @vitest-environment happy-dom
// Funktionale Tests der Unterstützen-Oberfläche (F-63): Kontingent-Anzeige, Karte statt Formular, Abzeichen.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-share-dialog';
import '../../src/components/sx-account-dialog';
import { needsSupport, quotaText, supportUrl } from '../../src/domain/support';
import { T0 } from './helpers';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

// showModal gibt es in happy-dom nicht überall – für die Darstellung nicht nötig
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const USER = { id: 'U1234567890abcdefg', email: 'skipper@example.org' };
const LINKS = {
  coffee: supportUrl('https://buy.stripe.com/test_coffee', USER),
  beer: supportUrl('https://buy.stripe.com/test_beer', USER),
};
const status = (sharesUsed: number, supporter = false) => ({ supporter, sharesUsed, sharesFree: 3, sharesMax: 500 });

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Text inkl. verschachtelter Komponenten (sx-support im Shadow DOM des Dialogs). */
function deepText(root: ShadowRoot | Element): string {
  let out = '';
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent;
    else if (n instanceof Element) out += (n.shadowRoot ? deepText(n.shadowRoot) : '') + deepText(n);
  });
  return out.replace(/\s+/g, ' ');
}

async function supportEl(el: LitEl) {
  const s = el.shadowRoot.querySelector('sx-support') as LitEl | null;
  if (s) await s.updateComplete;
  return s;
}

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

describe('F-63 Unterstützen – Regeln', () => {
  it('[F-63] Payment-Link wird mit client_reference_id und prefilled_email personalisiert', () => {
    const url = new URL(LINKS.coffee);
    expect(url.origin + url.pathname).toBe('https://buy.stripe.com/test_coffee');
    expect(url.searchParams.get('client_reference_id')).toBe(USER.id);
    expect(url.searchParams.get('prefilled_email')).toBe(USER.email);
  });

  it('[F-63] Kontingent-Text und Sperre ab dem 4. Törn, nicht für Unterstützer', () => {
    expect(quotaText(status(2))).toBe('2 von 3 kostenlosen Freigaben genutzt');
    expect(quotaText(status(7))).toBe('3 von 3 kostenlosen Freigaben genutzt');
    expect(quotaText(status(7, true))).toBe('');
    expect(needsSupport(status(2))).toBe(false);
    expect(needsSupport(status(3))).toBe(true);
    expect(needsSupport(status(3, true))).toBe(false);
    expect(needsSupport(null)).toBe(false);
  });
});

describe('F-63 sx-share-dialog', () => {
  const base = { open: true, defaultTitle: 'Törn', summary: '12 sm', boats: [], result: null, busy: false, error: '' };

  it('[F-63] Formular zeigt „2 von 3 kostenlos“', async () => {
    const el = await mount('sx-share-dialog', { ...base, support: LINKS, supportStatus: status(2) });
    expect(el.shadowRoot.querySelector('form')).not.toBeNull();
    expect(deepText(el.shadowRoot)).toContain('2 von 3 kostenlosen Freigaben genutzt');
  });

  it('[F-63] beim 4. Törn: Karte mit Kaffee/Bier (Payment-Link) und „prüfen“ statt Formular', async () => {
    const checks = listen('sx-support-check');
    const el = await mount('sx-share-dialog', { ...base, support: LINKS, supportStatus: status(3) });
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    const card = (await supportEl(el))!;
    expect(deepText(el.shadowRoot)).toContain('Für weitere Törns: einmal unterstützen');
    const links = [...card.shadowRoot.querySelectorAll('a')];
    expect(links.map((a) => a.textContent!.trim())).toEqual(['Kaffee ausgeben', 'Bier ausgeben']);
    expect(links[0].getAttribute('href')).toBe(LINKS.coffee);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    [...card.shadowRoot.querySelectorAll('button')].find((b) => /Ich habe unterstützt/.test(b.textContent!))!.click();
    expect(checks).toHaveLength(1);
  });

  it('[F-62] ohne eingerichtetes Unterstützen: verständlicher Hinweis, keine Zahlungs-Knöpfe', async () => {
    const el = await mount('sx-share-dialog', { ...base, support: null, supportStatus: status(3) });
    const card = (await supportEl(el))!;
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    expect(card.shadowRoot.querySelectorAll('a')).toHaveLength(0);
    expect(deepText(el.shadowRoot)).toMatch(/Lösche einen älteren Törn/);
  });

  it('[F-63] Unterstützer sehen das Formular ohne Kontingent-Hinweis', async () => {
    const el = await mount('sx-share-dialog', { ...base, support: LINKS, supportStatus: status(9, true) });
    expect(el.shadowRoot.querySelector('form')).not.toBeNull();
    expect(deepText(el.shadowRoot)).not.toContain('kostenlosen Freigaben');
  });

  it('[F-63] Teilen-Ergebnis bietet dezent „Kaffee oder Bier“ an', async () => {
    const share = { id: 'S1', title: 'Törn', summary: '', visibility: 'unlisted', isOwner: true };
    const el = await mount('sx-share-dialog', { ...base, support: LINKS, supportStatus: status(1), result: { share, url: 'http://localhost/s/S1' } });
    await supportEl(el);
    expect(deepText(el.shadowRoot)).toContain('Gefällt dir Sail Explorer? Spendier einen Kaffee oder ein Bier.');
  });
});

describe('F-63 sx-account-dialog', () => {
  const props = { open: true, tab: 'shares', user: USER, shares: [], boats: [], loading: false, error: '', support: LINKS };

  it('[F-63] zeigt das genutzte Kontingent und das Angebot zu unterstützen', async () => {
    const el = await mount('sx-account-dialog', { ...props, supportStatus: status(2), shares: [{ id: 'S1', title: 'A', summary: '', visibility: 'unlisted', trackCount: 1, createdAt: T0, listed: false, boat: null }] });
    await supportEl(el);
    const t = deepText(el.shadowRoot);
    expect(t).toContain('2 von 3 kostenlosen Freigaben genutzt');
    expect(t).toContain('Kaffee ausgeben');
    expect(t).not.toContain('Unterstützer');
  });

  it('[F-63] Unterstützer bekommen ein Abzeichen und einen Dank statt Kontingent', async () => {
    const el = await mount('sx-account-dialog', { ...props, supportStatus: status(5, true) });
    await supportEl(el);
    const t = deepText(el.shadowRoot);
    expect(el.shadowRoot.querySelector('.badge')?.textContent).toContain('Unterstützer');
    expect(t).toContain('Danke, dass du Sail Explorer unterstützt!');
    expect(t).not.toContain('kostenlosen Freigaben');
  });
});
