// @vitest-environment happy-dom
// Speichern getrennt vom Teilen (F-225): Kopfzeile bietet „Speichern“ für ungespeicherte eigene Tracks, der Dialog
// speichert ohne Reiter und bietet danach „Jetzt teilen“.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-topbar';
import '../../src/components/sx-share-dialog';

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
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const events: string[] = [];
for (const n of ['sx-save', 'sx-share', 'sx-share-submit']) document.addEventListener(n, () => events.push(n));

afterEach(() => {
  document.body.innerHTML = '';
  events.length = 0;
});

const user = { id: 'u1', email: 'a@example.org' };

describe('Speichern getrennt vom Teilen (F-225)', () => {
  it('[F-225] Kopfzeile: „Speichern“ nur für ungespeicherte lokale Tracks mit Backend; der Hinweis-Chip speichert statt zu teilen', async () => {
    const bar = await mount('sx-topbar', { user, mode: { kind: 'local' }, hasTracks: true, backend: true, home: false, saved: false });
    buttons(bar).find((b) => /Speichern/.test(b.textContent ?? '') && b.classList.contains('save'))!.click();
    buttons(bar).find((b) => b.classList.contains('status'))!.click();
    buttons(bar).find((b) => b.classList.contains('share'))!.click();
    expect(events).toEqual(['sx-save', 'sx-save', 'sx-share']);
    const saved = await mount('sx-topbar', { user, mode: { kind: 'local' }, hasTracks: true, backend: true, home: false, saved: true });
    expect(buttons(saved).some((b) => b.classList.contains('save'))).toBe(false);
    const offline = await mount('sx-topbar', { user, mode: { kind: 'local' }, hasTracks: true, backend: false, home: false, saved: false });
    expect(buttons(offline).some((b) => b.classList.contains('save'))).toBe(false);
  });

  it('[F-225] Dialog „Törn speichern“: ohne Reiter, Knopf „Speichern“; danach „Gespeichert“ und „Jetzt teilen“', async () => {
    const dlg = await mount('sx-share-dialog', { open: true, purpose: 'save', tab: 'link', linkState: 'form', defaultTitle: 'Havel' });
    expect(text(dlg)).toContain('Törn speichern');
    expect(dlg.shadowRoot.querySelector('[role=tablist]')).toBeNull();
    (dlg.shadowRoot.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(events).toContain('sx-share-submit');
    expect(buttons(dlg).some((b) => (b.textContent ?? '').trim().endsWith('Speichern'))).toBe(true);

    dlg.result = { share: { id: 's1', title: 'Havel', summary: '', visibility: 'public', isOwner: true }, url: 'https://segeln-potsdam.de/s/s1' };
    await dlg.updateComplete;
    expect(text(dlg)).toContain('Gespeichert');
    buttons(dlg).find((b) => /Jetzt teilen/.test(b.textContent ?? ''))!.click();
    await dlg.updateComplete;
    expect(text(dlg)).toContain('Törn teilen');
    expect(dlg.shadowRoot.querySelector('[role=tablist]')).not.toBeNull();
    expect((dlg.shadowRoot.querySelector('input[readonly]') as HTMLInputElement).value).toBe('https://segeln-potsdam.de/s/s1');
  });

  it('[F-225] Teilen-Dialog für Ungespeichertes nennt beides: „Speichern & Link erstellen“', async () => {
    const dlg = await mount('sx-share-dialog', { open: true, purpose: 'share', tab: 'link', linkState: 'form', defaultTitle: 'Havel' });
    expect(text(dlg)).toContain('Speichern & Link erstellen');
  });
});
