// @vitest-environment happy-dom
// Passkeys in der Oberfläche (F-208, F-214): Knopf im Anmeldedialog nur mit WebAuthn-Unterstützung, Verwaltung im
// Konto, Angebot nach der Anmeldung per Mail.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-login-dialog';
import '../../src/components/sx-account-dialog';

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
const buttons = (el: LitEl) => [...el.shadowRoot.querySelectorAll('button')];
const events: unknown[] = [];
const listen = (name: string) => document.addEventListener(name, (e) => events.push([name, (e as CustomEvent).detail]));
listen('sx-login-passkey');
listen('sx-passkey-add');
listen('sx-passkey-remove');
listen('sx-passkey-offer');
listen('sx-close');

afterEach(() => {
  document.body.innerHTML = '';
  events.length = 0;
  delete (window as unknown as Record<string, unknown>).PublicKeyCredential;
});

describe('Passkeys in der Oberfläche', () => {
  it('[F-208] Anmeldedialog: „Mit Passkey anmelden“ nur, wenn der Browser WebAuthn kann', async () => {
    const without = await mount('sx-login-dialog', { open: true });
    expect(buttons(without).some((b) => /Passkey/.test(b.textContent ?? ''))).toBe(false);
    (window as unknown as Record<string, unknown>).PublicKeyCredential = function () {};
    const el = await mount('sx-login-dialog', { open: true });
    buttons(el).find((b) => /Mit Passkey anmelden/.test(b.textContent ?? ''))!.click();
    expect(events).toEqual([['sx-login-passkey', null]]);
  });

  it('[F-214] Anmeldedialog nach Mail-Anmeldung: Passkey anlegen, Später, Nicht mehr fragen; Schließen heißt „Später“', async () => {
    const el = await mount('sx-login-dialog', { open: true, offerPasskey: true });
    const t = el.shadowRoot.textContent ?? '';
    expect(t).toContain('Du bist angemeldet');
    expect(el.shadowRoot.querySelector('h2')!.textContent).toBe('Angemeldet');
    const by = (re: RegExp) => buttons(el).find((b) => re.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`))!;
    by(/Passkey anlegen/).click();
    by(/Später/).click();
    by(/Nicht mehr fragen/).click();
    by(/Schließen/).click();
    expect(events).toEqual([
      ['sx-passkey-offer', { answer: 'add' }],
      ['sx-passkey-offer', { answer: 'later' }],
      ['sx-passkey-offer', { answer: 'never' }],
      ['sx-passkey-offer', { answer: 'later' }],
    ]);
  });

  it('[F-208] Konto: Passkeys auflisten, anlegen, entfernen (mit Rückfrage)', async () => {
    (window as unknown as Record<string, unknown>).PublicKeyCredential = function () {};
    window.confirm = () => true;
    const el = await mount('sx-account-dialog', {
      open: true, tab: 'settings', loading: false, user: { id: 'u1', email: 'a@example.org' },
      settings: { notifyComments: 'off', notifyGroups: 'off', suspended: false, isAdmin: false },
      passkeys: [{ id: 'cred1', name: 'iPhone', createdAt: Date.UTC(2026, 9, 1), lastUsedAt: null }],
    });
    const t = el.shadowRoot.textContent ?? '';
    expect(t).toContain('Anmelden mit Passkey');
    expect(t).toContain('iPhone');
    buttons(el).find((b) => /Passkey für dieses Gerät anlegen/.test(b.textContent ?? ''))!.click();
    buttons(el).find((b) => b.getAttribute('aria-label') === 'Passkey iPhone entfernen')!.click();
    expect(events).toEqual([['sx-passkey-add', null], ['sx-passkey-remove', { id: 'cred1' }]]);
  });
});
