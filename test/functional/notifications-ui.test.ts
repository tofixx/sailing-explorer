// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche für die Benachrichtigungs-Glocke (F-252, F-253, Konzept 17): Badge in der Kopfzeile,
// Liste, Klick und „Alle als gelesen“, Controller mit Zähler, Liste und Gelesen-Markieren (Netz gefälscht).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-topbar';
import '../../src/components/sx-notifications';
import { NotificationsController } from '../../src/controllers/notifications';
import { Store, initialState } from '../../src/services/store';
import { badgeLabel, notificationText, type NotificationItem } from '../../src/domain/notifications';
import type { SxNotifications } from '../../src/components/sx-notifications';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');

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
  vi.unstubAllGlobals();
});

const item = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1', kind: 'comment', count: 1, actor: { name: 'Anna', handle: 'anna' }, title: 'Rund Rügen', what: 'deinen Törn',
  href: '/s/S1', at: Date.parse('2026-10-20T10:00:00Z'), read: false, text: '', ...over,
});

// ---------------------------------------------------------------- Texte und Badge

describe('Texte und Badge', () => {
  it('[F-252] Sätze je Art, gebündelt und ohne Namen („Jemand“); Badge leer, Zahl oder 99+', () => {
    expect(notificationText(item())).toBe('Anna hat „Rund Rügen“ kommentiert');
    expect(notificationText(item({ count: 3 }))).toBe('3 neue Kommentare zu „Rund Rügen“');
    expect(notificationText(item({ kind: 'reaction', count: 2 }))).toBe('Anna und 1 weitere Person haben auf deinen Törn „Rund Rügen“ reagiert');
    expect(notificationText(item({ kind: 'reaction', actor: null, title: '', what: 'deine Neuigkeit' }))).toBe('Jemand hat auf deine Neuigkeit reagiert');
    expect(notificationText(item({ kind: 'follow', count: 4, title: '' }))).toBe('Anna und 3 weitere folgen dir jetzt');
    expect(notificationText(item({ kind: 'invite', what: 'in den Verein', title: 'Möwen' }))).toBe('Anna lädt dich in den Verein „Möwen“ ein');
    expect(notificationText(item({ kind: 'invite', what: 'zum gegenseitigen Folgen', title: '' }))).toBe('Anna lädt dich zum gegenseitigen Folgen ein');
    expect(notificationText(item({ kind: 'request', title: 'Möwen' }))).toBe('Anna möchte „Möwen“ beitreten');
    expect([badgeLabel(0), badgeLabel(7), badgeLabel(99), badgeLabel(100)]).toEqual(['', '7', '99', '99+']);
  });
});

// ---------------------------------------------------------------- Kopfzeile und Liste

describe('sx-topbar Glocke', () => {
  it('[F-252] nur angemeldet; Badge mit Zahl, Klick meldet sx-notifications', async () => {
    const guest = await mount('sx-topbar', { user: null, mode: { kind: 'local' }, hasTracks: false, backend: true });
    expect(guest.shadowRoot.querySelector('[data-bell]')).toBeNull();
    const opened = listen('sx-notifications');
    const el = await mount('sx-topbar', { user: { id: 'u', email: 'a@b.de' }, mode: { kind: 'local' }, hasTracks: false, backend: true, bell: '3' });
    const bell = el.shadowRoot.querySelector('[data-bell]') as HTMLButtonElement;
    expect(bell.querySelector('.badge')!.textContent).toBe('3');
    expect(bell.getAttribute('aria-label')).toBe('Benachrichtigungen, 3 ungelesen');
    bell.click();
    expect(opened).toHaveLength(1);
    Object.assign(el, { bell: '' });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[data-bell] .badge')).toBeNull();
  });
});

describe('sx-notifications', () => {
  it('[F-252] Liste mit Ungelesen-Markierung und Link; Klick meldet den Eintrag; „Alle als gelesen“; Esc schließt', async () => {
    const opened = listen('sx-notification-open');
    const all = listen('sx-notifications-read-all');
    const closed = listen('sx-notifications-close');
    const el = await mount('sx-notifications', { open: true, items: [item(), item({ id: 'n2', kind: 'follow', read: true, title: '' })] });
    const links = [...el.shadowRoot.querySelectorAll('a.item')] as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/s/S1', '/s/S1']);
    expect(links[0].classList.contains('unread')).toBe(true);
    expect(links[1].classList.contains('unread')).toBe(false);
    expect(text(el)).toContain('Anna hat „Rund Rügen“ kommentiert');
    links[0].click();
    expect(opened[0]).toMatchObject({ item: { id: 'n1' }, newTab: false });
    links[0].dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opened[1]).toMatchObject({ item: { id: 'n1' }, newTab: true });
    (el.shadowRoot.querySelector('button.small') as HTMLButtonElement).click();
    expect(all).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveLength(1);
  });

  it('[F-252] leer: Hinweis, was hier erscheint; geschlossen: nichts', async () => {
    const el = await mount('sx-notifications', { open: true, items: [] });
    expect(text(el)).toMatch(/Nichts Neues/);
    Object.assign(el, { open: false });
    await el.updateComplete;
    expect(text(el).trim()).toBe('');
  });
});

// ---------------------------------------------------------------- Controller

describe('NotificationsController', () => {
  let calls: Array<{ url: string; body: unknown }>;
  let unread: number;
  let items: NotificationItem[];

  beforeEach(() => {
    calls = [];
    unread = 2;
    items = [item(), item({ id: 'n2', kind: 'follow', title: '' })];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url === '/api/notifications/read') {
        if ('ids' in body) unread -= body.ids.length;
        else unread = 0;
      }
      const data = url === '/api/notifications' ? { items, unread } : { unread };
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    });
  });

  function setup(signedIn = true) {
    const store = new Store({ ...initialState, user: signedIn ? { id: 'u', email: 'a@b.de' } : null, backend: true } as typeof initialState);
    const panel = document.createElement('sx-notifications') as SxNotifications;
    document.body.append(panel);
    const badges: string[] = [];
    const went: string[] = [];
    const expanded: boolean[] = [];
    const c = new NotificationsController(store, { panel, badge: (l) => badges.push(l), navigate: (h) => went.push(h), expanded: (o) => expanded.push(o) });
    return { c, panel, badges, went, expanded };
  }

  it('[F-252] Zähler beim Start, danach höchstens alle 2 min; Gäste ohne Anfrage', async () => {
    const { c, badges } = setup();
    await c.refresh(true);
    await c.refresh();
    expect(calls.filter((x) => x.url === '/api/notifications/count')).toHaveLength(1);
    expect(badges.at(-1)).toBe('2');
    const guest = setup(false);
    calls = [];
    await guest.c.refresh(true);
    expect(calls).toHaveLength(0);
    expect(guest.badges.at(-1)).toBe('');
  });

  it('[F-252] Glocke öffnet die Liste; Follower und Reaktionen sind damit gelesen, Kommentare nicht', async () => {
    const { c, panel, badges, expanded } = setup();
    await c.toggle();
    expect(panel.open).toBe(true);
    expect(expanded).toEqual([true]);
    expect(panel.items).toHaveLength(2);
    const read = calls.find((x) => x.url === '/api/notifications/read');
    expect(read?.body).toEqual({ ids: ['n2'] });
    expect(badges.at(-1)).toBe('1');
    await c.toggle();
    expect(panel.open).toBe(false);
    expect(expanded).toEqual([true, false]);
  });

  it('[F-252] schließt jemand die Liste, bevor sie geladen ist, wird nichts als gesehen gewertet', async () => {
    const { c, panel } = setup();
    const pending = c.toggle();
    c.close();
    await pending;
    expect(panel.items).toHaveLength(0);
    expect(calls.some((x) => x.url === '/api/notifications/read')).toBe(false);
  });

  it('[F-253] Strg-Klick: gelesen, aber kein Wechsel der Seite', async () => {
    const { c, panel, went } = setup();
    await c.toggle();
    await c.open(items[0], true);
    expect(went).toEqual([]);
    expect(panel.open).toBe(true);
    expect(panel.items.find((i) => i.id === 'n1')?.read).toBe(true);
  });

  it('[F-253] Klick: gelesen, Liste zu, Ziel öffnen; „Alle als gelesen“', async () => {
    const { c, panel, went, badges } = setup();
    await c.toggle();
    await c.open(items[0]);
    expect(calls.at(-1)).toEqual({ url: '/api/notifications/read', body: { ids: ['n1'] } });
    expect(panel.open).toBe(false);
    expect(went).toEqual(['/s/S1']);
    await c.readAll();
    expect(calls.at(-1)!.body).toEqual({ all: true });
    expect(badges.at(-1)).toBe('');
  });

  it('[F-253] geöffneter Törn: Einträge dazu gelesen – auch wenn der Zähler erst danach ankommt; ohne Ungelesenes keine Anfrage', async () => {
    const { c } = setup();
    c.viewing({ subjectKind: 'share', subjectId: 'S1' }); // Zähler noch unbekannt → noch nichts
    expect(calls).toHaveLength(0);
    await c.refresh(true);
    expect(calls.at(-1)).toEqual({ url: '/api/notifications/read', body: { subjectKind: 'share', subjectId: 'S1' } });
    calls = [];
    c.seen({ kind: 'invite' }); // Zähler jetzt 0
    expect(calls).toHaveLength(0);
  });

  it('[F-258] Live: nach dem Zähler öffnet sich der WebSocket; „changed“ lädt Zähler und offene Liste neu; Abbruch → neu verbinden; Hintergrund-Tab → zu', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      closed = false;
      constructor(public url: string) {
        super();
        sockets.push(this);
      }
      send() {}
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    try {
      const { c, panel } = setup();
      await c.refresh(true);
      expect(sockets).toHaveLength(1);
      expect(sockets[0].url).toMatch(/^ws:\/\/.+\/api\/notifications\/live$/);
      await c.toggle();
      calls = [];
      sockets[0].dispatchEvent(new MessageEvent('message', { data: 'changed' }));
      await vi.waitFor(() => expect(calls.map((x) => x.url)).toEqual(expect.arrayContaining(['/api/notifications/count', '/api/notifications'])));
      expect(panel.open).toBe(true);
      // Abbruch: nach 5 s neu verbinden (über ein Neuladen des Zählers)
      sockets[0].dispatchEvent(new Event('close'));
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(sockets).toHaveLength(2));
      // Tab im Hintergrund: Verbindung zu; wieder sichtbar (innerhalb der 2-min-Bremse) → sofort neu verbunden.
      // (Controller früherer Tests hören auch auf visibilitychange – daher über den Socket dieses Controllers prüfen.)
      const mine = () => (c as unknown as { socket: FakeSocket | null }).socket;
      const second = mine()!;
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(second.closed).toBe(true);
      expect(mine()).toBeNull();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const third = mine()!;
      expect(third).not.toBe(second);
      // offline beim Neuverbinden: es geht mit wachsendem Abstand weiter (5 s, dann 10 s)
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('offline');
      });
      third.dispatchEvent(new Event('open')); // verbunden → Abstand wieder 5 s
      third.dispatchEvent(new Event('close'));
      expect(mine()).toBeNull();
      await vi.advanceTimersByTimeAsync(5_000);
      const fourth = mine()!;
      expect(fourth).not.toBeNull();
      fourth.dispatchEvent(new Event('close'));
      await vi.advanceTimersByTimeAsync(9_000);
      expect(mine()).toBeNull();
      await vi.advanceTimersByTimeAsync(1_000);
      const fifth = mine()!;
      expect(fifth).not.toBeNull();
      // 4000 „zu viele Verbindungen“: kein Neuverbinden
      fifth.dispatchEvent(new CloseEvent('close', { code: 4000 }));
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(mine()).toBeNull();
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      vi.useRealTimers();
    }
  });
});
