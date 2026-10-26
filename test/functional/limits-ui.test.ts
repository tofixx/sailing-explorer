// @vitest-environment happy-dom
// Funktionale Tests der Kontingent-Anzeigen (Phase B, F-123): Konto („x von y Törns · a MB von b MB · c von d Booten“),
// Grenze beim Anlegen von Booten, Speicherhinweis und Notbremse im Teilen-Dialog.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-share-dialog';
import '../../src/components/sx-account-dialog';
import '../../src/components/sx-support';
import { SUPPORT_TIERS } from '../../src/domain/support';
import { limitsFor } from '../../src/domain/limits';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const MB = 1024 * 1024;
const USER = { id: 'U1234567890abcdefg', email: 'skipper@example.org' };
const limits = { free: limitsFor('free'), supporter: limitsFor('supporter') };

function status(o: { supporter?: boolean; sharesUsed?: number; bytesUsed?: number; boatsUsed?: number; storagePaused?: boolean } = {}) {
  const supporter = o.supporter ?? false;
  const l = supporter ? limits.supporter : limits.free;
  return {
    supporter,
    supporterUntil: supporter ? Date.now() + 100 * 86_400_000 : null,
    sharesUsed: o.sharesUsed ?? 1,
    sharesFree: 3,
    sharesMax: l.shares,
    bytesUsed: o.bytesUsed ?? 2 * MB,
    bytesMax: l.bytes,
    boatsUsed: o.boatsUsed ?? 0,
    boatsMax: l.boats,
    limits,
    storagePaused: o.storagePaused ?? false,
  };
}

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

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

afterEach(() => {
  document.body.innerHTML = '';
});

const account = (tab: string, supportStatus: unknown, boats: unknown[] = []) =>
  mount('sx-account-dialog', { open: true, tab, user: USER, shares: [], boats, loading: false, error: '', supportTiers: SUPPORT_TIERS, supportStatus });

const boat = (i: number) => ({ id: `B${i}234567890abcdefg`, name: `Boot ${i}`, boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '', visibility: 'public', role: 'owner', shareKey: null, link: `/b/B${i}` });

describe('F-123 Konto: Kontingent der aktuellen Stufe', () => {
  it('kostenlos: Törns, Speicher und Boote mit den kostenlosen Grenzen', async () => {
    const el = await account('shares', status({ sharesUsed: 2, bytesUsed: 1.2 * MB, boatsUsed: 1 }));
    expect(deepText(el.shadowRoot)).toContain('Kostenlos: 2 von 3 Törns · 1,2 MB von 41 MB · 1 von 3 Booten');
  });

  it('Unterstützer: Grenzen der Unterstützer-Stufe', async () => {
    const el = await account('shares', status({ supporter: true, sharesUsed: 12, bytesUsed: 48 * MB, boatsUsed: 4 }));
    expect(deepText(el.shadowRoot)).toContain('12 von 100 Törns · 48 MB von 200 MB · 4 von 20 Booten');
  });

  it('das Angebot nennt die Grenzen für Unterstützer', async () => {
    const el = await account('shares', status());
    const s = el.shadowRoot.querySelector('sx-support') as LitEl;
    await s.updateComplete;
    expect(deepText(el.shadowRoot)).toContain('bis zu 100 Törns, 200 MB Speicher und 20 Boote');
  });
});

describe('F-121 Boot anlegen an der Grenze', () => {
  it('kostenlos unter 3 Booten: „Boot anlegen“ aktiv, kein Hinweis', async () => {
    const el = await account('boats', status({ boatsUsed: 2 }), [boat(1), boat(2)]);
    expect(button(el.shadowRoot, /Boot anlegen/)!.disabled).toBe(false);
    expect(el.shadowRoot.querySelector('.boat-limit')).toBeNull();
  });

  it('kostenlos mit 3 Booten: Hinweis auf die Grenze, Knopf gesperrt', async () => {
    const el = await account('boats', status({ boatsUsed: 3 }), [boat(1), boat(2), boat(3)]);
    expect(el.shadowRoot.querySelector('.boat-limit')!.textContent).toContain('Kostenlos kannst du 3 Boote anlegen. Als Unterstützer sind es bis zu 20.');
    expect(button(el.shadowRoot, /Boot anlegen/)!.disabled).toBe(true);
  });

  it('ohne eingerichtetes Unterstützen kein Verweis darauf', async () => {
    const el = await mount('sx-account-dialog', { open: true, tab: 'boats', user: USER, shares: [], boats: [], loading: false, error: '', supportTiers: null, supportStatus: status({ boatsUsed: 3 }) });
    expect(el.shadowRoot.querySelector('.boat-limit')!.textContent).toContain('Lösche ein Boot, um ein neues anzulegen.');
  });

  it('Unterstützer: mit 3 Booten weiter aktiv, ab 20 gesperrt', async () => {
    let el = await account('boats', status({ supporter: true, boatsUsed: 3 }));
    expect(button(el.shadowRoot, /Boot anlegen/)!.disabled).toBe(false);
    document.body.innerHTML = '';
    el = await account('boats', status({ supporter: true, boatsUsed: 20 }));
    expect(el.shadowRoot.querySelector('.boat-limit')!.textContent).toContain('Maximal 20 Boote pro Konto');
    expect(button(el.shadowRoot, /Boot anlegen/)!.disabled).toBe(true);
  });
});

describe('F-123 Teilen-Dialog: Speicher und Notbremse', () => {
  const dialog = (supportStatus: unknown) =>
    mount('sx-share-dialog', { open: true, tab: 'link', linkState: 'form', defaultTitle: 'Törn', boats: [], supportStatus, supportTiers: SUPPORT_TIERS });
  const submit = (el: LitEl) => el.shadowRoot.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  it('weit unter der Grenze: kein Speicherhinweis', async () => {
    const el = await dialog(status({ supporter: true, bytesUsed: 20 * MB }));
    expect(el.shadowRoot.querySelector('.storage')).toBeNull();
    expect(submit(el).disabled).toBe(false);
  });

  it('ab 80 % zeigt der Dialog den Speicher an', async () => {
    const el = await dialog(status({ supporter: true, bytesUsed: 170 * MB }));
    expect(el.shadowRoot.querySelector('.storage')!.textContent).toContain('Fast voll: 170 MB von 200 MB Speicher belegt');
  });

  it('Notbremse: Hinweis, „Link erstellen“ gesperrt; kostenlose Konten erfahren, dass Unterstützer weiter speichern', async () => {
    const el = await dialog(status({ storagePaused: true }));
    expect(el.shadowRoot.querySelector('.paused')!.textContent).toContain('neue Törns sind vorübergehend pausiert. Unterstützer können weiter speichern.');
    expect(submit(el).disabled).toBe(true);
    document.body.innerHTML = '';
    const sup = await dialog(status({ supporter: true, storagePaused: true }));
    expect(sup.shadowRoot.querySelector('.paused')!.textContent).not.toContain('Unterstützer können');
  });
});
