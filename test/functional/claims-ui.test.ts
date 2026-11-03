// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche zur verifizierten Vertretung (Konzept 20, F-366, F-372): Knopf und Dialog
// „Ich vertrete …“, Abzeichen, Reiter „Anträge“ im Admin-Bereich mit Annehmen und Ablehnen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-claim';
import '../../src/components/sx-verified-badge';
import { ClaimController } from '../../src/controllers/claims';
import { AdminController } from '../../src/controllers/admin';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown> = {}): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const button = (el: LitEl, label: RegExp) =>
  [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
const tick = async (el: LitEl) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

const OPEN_STATE = { verified: false, representing: false, blocked: false, canClaim: true, claim: null };
const CLAIM = {
  id: 'Claim00000000001', kind: 'group', target: { id: 'Group00000000001', name: 'SC Möwe', path: '/g/sc-moewe', verified: false },
  holder: { id: 'User000000000001', displayName: 'Anna', handle: null, since: Date.now() - 400 * 86_400_000 },
  applicant: { id: 'User000000000002', displayName: 'Bea', handle: 'bea', since: Date.now() - 2 * 86_400_000 },
  role: '1. Vorsitzende', reason: 'Ich bin die Vorsitzende.', contact: '0331 1', evidenceUrl: 'https://example.org/impressum',
  status: 'open', createdAt: Date.now(), decidedAt: null, note: '', previousAction: null, otherOpen: 0,
};

let calls: Array<{ url: string; method: string; body: unknown }>;
let claimState: unknown;
beforeEach(() => {
  calls = [];
  claimState = OPEN_STATE;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    const body = url.startsWith('/api/claims')
      ? init.method === 'POST'
        ? { ...OPEN_STATE, canClaim: false, claim: { id: 'Claim00000000001', status: 'open', createdAt: Date.now(), decidedAt: null, note: '' } }
        : claimState
      : url.startsWith('/api/admin/claims?')
        ? { claims: [CLAIM], page: 1, more: false }
        : { ok: true };
    return new Response(JSON.stringify(body), { status: init.method === 'POST' && url === '/api/claims' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Knopf samt Controller, wie die Verdrahtung in src/app.ts. */
async function claimButton(props: Record<string, unknown> = {}) {
  const el = await mount('sx-claim', { kind: 'group', targetId: 'Group00000000001', name: 'SC Möwe', signedIn: true, ...props });
  const c = new ClaimController(() => undefined);
  el.addEventListener('sx-claim-load', (e) => void c.load((e as CustomEvent).detail));
  el.addEventListener('sx-claim-submit', (e) => void c.submit((e as CustomEvent).detail));
  el.addEventListener('sx-claim-withdraw', (e) => void c.withdraw((e as CustomEvent).detail));
  return el;
}

describe('Verifizierte Vertretung – Oberfläche', () => {
  it('[F-372] Gäste werden zur Anmeldung geschickt', async () => {
    const el = await claimButton({ signedIn: false });
    const login = vi.fn();
    el.addEventListener('sx-login', login);
    button(el, /Ich vertrete diesen Verein/)!.click();
    expect(login).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('[F-372] Dialog lädt den Stand, zeigt das Formular mit Hinweisen und schickt den Antrag', async () => {
    const el = await claimButton();
    button(el, /Ich vertrete diesen Verein/)!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/api/claims/group/Group00000000001')).toBe(true));
    await tick(el);
    expect(text(el)).toMatch(/keine Ausweis- oder Vollmachtskopien/);
    expect(text(el)).toMatch(/erfährt davon erst, wenn dein Antrag angenommen wird/);
    const set = (name: string, v: string) => ((el.shadowRoot.querySelector(`[name="${name}"]`) as HTMLInputElement).value = v);
    set('role', '1. Vorsitzende');
    set('reason', 'Ich bin seit 2024 Vorsitzende des Vereins.');
    set('contact', '0331 123456');
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      kind: 'group', id: 'Group00000000001', role: '1. Vorsitzende', reason: 'Ich bin seit 2024 Vorsitzende des Vereins.', contact: '0331 123456', evidenceUrl: '',
    });
    await tick(el);
    expect(text(el)).toMatch(/in Prüfung/);
    expect(button(el, /zurückziehen/)).toBeTruthy();
  });

  it('[F-372] abgelehnt mit Begründung, entzogen ohne Formular', async () => {
    claimState = { ...OPEN_STATE, canClaim: false, claim: { id: 'C1', status: 'rejected', createdAt: Date.now(), decidedAt: Date.now(), note: 'Nicht bestätigt.' } };
    const el = await claimButton({ kind: 'harbor', name: 'Hafen West' });
    button(el, /diesen Hafen/)!.click();
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await tick(el);
    expect(text(el)).toMatch(/abgelehnt.*Nicht bestätigt\./);
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    document.body.innerHTML = '';
    claimState = { ...OPEN_STATE, blocked: true, canClaim: false };
    const b = await claimButton();
    button(b, /Ich vertrete/)!.click();
    await vi.waitFor(() => expect(calls.length).toBe(2));
    await tick(b);
    expect(text(b)).toMatch(/Verwaltung wurde dir nach einer Prüfung entzogen/);
  });

  it('[F-366] Abzeichen mit Erklärung', async () => {
    const el = await mount('sx-verified-badge', { kind: 'harbor' });
    const span = el.shadowRoot.querySelector('span')!;
    expect(span.textContent).toMatch(/Verifiziert/);
    expect(span.getAttribute('title')).toBe('Von Luv & Leute bestätigt: wird vom Hafen selbst verwaltet.');
    const c = await mount('sx-verified-badge', { kind: 'group', compact: true });
    expect(c.shadowRoot.querySelector('span')!.textContent).not.toMatch(/Verifiziert/);
    expect(c.shadowRoot.querySelector('span')!.getAttribute('aria-label')).toMatch(/Verifiziert: Von Luv & Leute bestätigt/);
  });

  it('[F-372] Eingaben bleiben beim Antrag – nach dem Neuladen nie im nächsten', async () => {
    await import('../../src/components/sx-admin-claims');
    const list = await mount('sx-admin-claims', { claims: [CLAIM] });
    (list.shadowRoot.querySelector('select') as HTMLSelectElement).value = 'remove';
    (list.shadowRoot.querySelector('textarea') as HTMLTextAreaElement).value = 'Notiz zu Antrag 1';
    list.claims = [{ ...CLAIM, id: 'Claim00000000002', applicant: { ...CLAIM.applicant, id: 'User000000000003' } }];
    await list.updateComplete;
    expect((list.shadowRoot.querySelector('select') as HTMLSelectElement).value).toBe('admin');
    expect((list.shadowRoot.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('[F-372] Admin-Reiter „Anträge“: Liste, Annehmen mit Wahl für den bisherigen Eigner, Ablehnen', async () => {
    history.replaceState(null, '', '/admin?tab=claims');
    const page = await mount('sx-admin-page');
    new AdminController(page as never).start();
    await vi.waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/admin/claims?'))).toBe(true));
    await tick(page);
    const list = page.shadowRoot.querySelector('sx-admin-claims') as LitEl;
    await list.updateComplete;
    expect(text(list)).toMatch(/SC Möwe/);
    expect(text(list)).toMatch(/0331 1/);
    expect(calls.some((c) => c.url === '/api/notifications/read' && JSON.stringify(c.body) === '{"kind":"claim"}')).toBe(true);
    (list.shadowRoot.querySelector('select') as HTMLSelectElement).value = 'member';
    button(list, /Annehmen/)!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/api/admin/claims/Claim00000000001')).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/claims/Claim00000000001')!.body).toEqual({ decision: 'accept', note: '', previous: 'member' });
    await tick(page);
    (list.shadowRoot.querySelector('textarea') as HTMLTextAreaElement).value = 'Nicht bestätigt vom Verein.';
    button(list, /Ablehnen/)!.click();
    await vi.waitFor(() => expect(calls.filter((c) => c.url === '/api/admin/claims/Claim00000000001')).toHaveLength(2));
    expect(calls.filter((c) => c.url === '/api/admin/claims/Claim00000000001')[1].body).toEqual({ decision: 'reject', note: 'Nicht bestätigt vom Verein.' });
    // Neuladen nach der Entscheidung abwarten (sonst läuft es nach dem Test gegen echtes fetch)
    await vi.waitFor(() => expect(page.busy).toBe(false));
    await tick(page);
    history.replaceState(null, '', '/');
  });
});
