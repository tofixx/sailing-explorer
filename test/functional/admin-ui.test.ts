// @vitest-environment happy-dom
// Funktionale Tests der Admin-Oberfläche (Konzept 18.1, 18.12): Eintrag „Admin“ in der Kopfzeile nur für Admins,
// Admin-Seite mit Reitern, Filtern, Details, Sperren und Bestätigung beim Löschen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-topbar';
import { AdminController } from '../../src/controllers/admin';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown> = {}): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Admin-Seite samt Controller, wie openAdmin in src/app.ts. */
async function adminPage(props: Record<string, unknown> = {}): Promise<LitEl> {
  const el = await mount('sx-admin-page', props);
  new AdminController(el as never).start();
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const button = (el: LitEl, label: RegExp) =>
  [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

const ITEM = {
  id: 'Boot0000000000001', name: 'Möwe', sub: 'Potsdam', visibility: 'private', createdAt: Date.UTC(2026, 5, 1), path: '/b/Boot0000000000001',
  handle: null, owner: { id: 'User000000000001', handle: 'anna', displayName: 'Anna' },
  lock: { until: Date.now() + 5 * 86_400_000, reason: 'Prüfung', since: Date.now(), viaUser: null }, hidden: false, suspended: false,
  counts: { Törns: 3, 'Boots-Admins': 0 },
};

let calls: Array<{ url: string; method: string; body: unknown }>;
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    const body = url.startsWith('/api/admin/list/')
      ? { items: [ITEM], page: 1, more: false }
      : url.startsWith('/api/admin/boats/')
        ? { item: ITEM, extra: {}, isAdmin: false, log: [] }
        : { ok: true };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const settle = async (el: LitEl) => {
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

describe('Admin-Oberfläche', () => {
  it('[F-230] „Admin“ in der Kopfzeile nur für Admins', async () => {
    const plain = await mount('sx-topbar', { backend: true, user: { id: 'u1', email: 'a@example.org' } });
    expect(plain.shadowRoot.querySelector('a[href="/admin"]')).toBeNull();
    const admin = await mount('sx-topbar', { backend: true, user: { id: 'u2', email: 'b@example.org', admin: true } });
    expect(admin.shadowRoot.querySelector('a[href="/admin"]')?.textContent).toContain('Admin');
  });

  it('[F-231] Reiter und Filter laden die Übersicht; Zeilen zeigen Sperre (bald ablaufend hervorgehoben) und Sichtbarkeit', async () => {
    const page = await adminPage();
    await settle(page);
    expect(calls[0].url).toMatch(/^\/api\/admin\/list\/users\?/);
    button(page, /^Boote$/)!.click();
    await settle(page);
    expect(calls.at(-1)!.url).toMatch(/^\/api\/admin\/list\/boats\?.*filter=all/);
    button(page, /Ohne Eigner/)!.click();
    await settle(page);
    expect(calls.at(-1)!.url).toContain('filter=ownerless');
    expect(text(page)).toContain('Möwe');
    expect(page.shadowRoot.querySelector('.badge.locked.due')?.textContent).toContain('gesperrt bis');
    expect(text(page)).toContain('Nur ich');
  });

  it('[F-233] Details: Verlängern mit Begründung, Löschen nur mit eingetippter ID', async () => {
    const page = await adminPage({ tab: 'boats' });
    await settle(page);
    page.shadowRoot.querySelector<HTMLElement>('tr.item')!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.url === `/api/admin/boats/${ITEM.id}`)).toBe(true));
    await vi.waitFor(() => expect(page.shadowRoot.querySelector('section.panel')).not.toBeNull());
    expect(text(page)).toContain('Prüfung');
    button(page, /Sperre verlängern/)!.click();
    await page.updateComplete;
    page.shadowRoot.querySelector<HTMLTextAreaElement>('textarea[name=reason]')!.value = 'Anfrage Polizei';
    button(page, /Um 180 Tage verlängern/)!.click();
    await vi.waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ reason: 'Anfrage Polizei' }));
    // nach der Aktion: Liste und Details neu geladen, Rückmeldung sichtbar
    await vi.waitFor(() => expect(text(page)).toContain('Sperre verlängert'));
    await vi.waitFor(() => expect(page.busy).toBe(false));

    button(page, /Endgültig löschen/)!.click();
    await page.updateComplete;
    page.shadowRoot.querySelector<HTMLInputElement>('input[name=confirm]')!.value = ITEM.id;
    [...page.shadowRoot.querySelectorAll('button')].filter((b) => /Endgültig löschen/.test(b.textContent ?? '')).at(-1)!.click();
    await vi.waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ confirm: ITEM.id }));
  });
});
