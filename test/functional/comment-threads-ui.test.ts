// @vitest-environment happy-dom
// Oberfläche der Kommentare an Beiträgen und der Glocke je Verlauf (Konzept 40, F-643): Glocke im Kopf der Kommentare,
// Kommentar-Modus für die Autor:in eines Beitrags, „Kommentare“ zum Aufklappen unter Beitragskarten.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-comments';
import '../../src/components/sx-stream';

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
  const got: Array<Record<string, unknown>> = [];
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

const list = (over: Record<string, unknown> = {}) => ({
  mode: 'on', comments: [], canComment: true, block: null, isOwner: false, subscribed: false, canSetMode: false, limits: { maxLength: 1000, maxLinks: 2 }, ...over,
});

describe('F-643 Glocke und Modus in sx-comments', () => {
  it('[F-643] Glocke zeigt den Zustand (aria-pressed) und meldet das Gegenteil mit der Instanz', async () => {
    const got = listen('sx-comment-subscribe');
    const el = await mount('sx-comments', { thread: { kind: 'post', id: 'P1' }, data: list({ subscribed: false }) });
    const bell = el.shadowRoot.querySelector<HTMLButtonElement>('button.bell')!;
    expect(bell.getAttribute('aria-pressed')).toBe('false');
    expect(bell.textContent).toContain('Stumm');
    bell.click();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ on: true });
    expect(got[0].el).toBe(el);
    el.data = list({ subscribed: true });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('button.bell')!.getAttribute('aria-pressed')).toBe('true');
    expect(text(el)).toContain('Benachrichtigen an');
  });

  it('[F-643] ohne Anmeldung keine Glocke; Texte nennen den Beitrag statt des Törns', async () => {
    const el = await mount('sx-comments', { thread: { kind: 'post', id: 'P1' }, data: list({ subscribed: null, block: 'off', mode: 'off' }) });
    expect(el.shadowRoot.querySelector('button.bell')).toBeNull();
    expect(text(el)).toContain('für diesen Beitrag abgeschaltet');
  });

  it('[F-643] Autor:in eines Beitrags wählt den Kommentar-Modus im Kopf; andere sehen keine Auswahl', async () => {
    const got = listen('sx-comments-mode');
    const el = await mount('sx-comments', { thread: { kind: 'post', id: 'P1' }, data: list({ canSetMode: true, isOwner: true, subscribed: true }) });
    const select = el.shadowRoot.querySelector('select')!;
    select.value = 'hidden';
    select.dispatchEvent(new Event('change'));
    expect(got[0]).toMatchObject({ mode: 'hidden' });
    expect(got[0].el).toBe(el);
    const other = await mount('sx-comments', { thread: { kind: 'post', id: 'P1' }, data: list() });
    expect(other.shadowRoot.querySelector('select')).toBeNull();
  });

  it('[F-643] mit autoload fordert die Komponente ihre Daten einmal an', async () => {
    const got = listen('sx-comments-load');
    const el = await mount('sx-comments', { autoload: true, thread: { kind: 'post', id: 'P1', key: 'K' } });
    expect(got).toHaveLength(1);
    expect(got[0].el).toBe(el);
  });
});

describe('F-643 Kommentare unter Beitragskarten', () => {
  const post = (id: string, over: Record<string, unknown> = {}) => ({
    id: `A${id}`, kind: 'post', createdAt: Date.now(), actor: null, post: { id, body: 'Hallo', link: null, canDelete: false, path: `/p/${id}`, ...over },
  });

  it('[F-643] „Kommentare“ klappt eine sx-comments für genau diesen Beitrag auf (mit Schlüssel bei „Nur mit Link“), Törns haben keinen eigenen Knopf', async () => {
    const loads = listen('sx-comments-load');
    const el = await mount('sx-stream', {
      items: [post('P1'), post('P2', { path: '/p/P2/SchluesselXYZ' }), { id: 'V1', kind: 'voyage', createdAt: Date.now(), actor: null, voyage: { id: 'S1', title: 'T', distNm: 1, startedAt: null, hasImage: false } }],
    });
    const buttons = [...el.shadowRoot.querySelectorAll<HTMLButtonElement>('.talk > button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[1].getAttribute('aria-expanded')).toBe('false');
    buttons[1].click();
    await el.updateComplete;
    const c = el.shadowRoot.querySelector('sx-comments') as LitEl;
    expect(c.thread).toEqual({ kind: 'post', id: 'P2', key: 'SchluesselXYZ' });
    await c.updateComplete;
    expect(loads).toHaveLength(1);
    expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
    buttons[1].click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('sx-comments')).toBeNull();
  });

  it('[F-643] Anker /p/<id> (z. B. aus der Glocke) klappt die Kommentare der Karte auf', async () => {
    const el = await mount('sx-stream', { items: [post('P1'), post('P2')], highlight: 'P2' });
    const c = el.shadowRoot.querySelector('sx-comments') as LitEl;
    expect(c.thread).toMatchObject({ kind: 'post', id: 'P2' });
  });
});
