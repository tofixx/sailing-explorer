// @vitest-environment happy-dom
// Oberfläche Umfragen (Konzept 29, F-478): „+ Neu → Umfrage“, Formularteil `sx-poll-form` im Beitragsdialog, Karte
// `sx-poll` im Stream (abstimmen, Ergebnis, ändern, zurücknehmen, beenden, Namen). Komponenten melden nur Absichten.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-compose';
import '../../src/components/sx-compose-dialog';
import '../../src/components/sx-stream';
import type { ComposeTarget } from '../../src/domain/posts';
import type { StreamItem } from '../../src/domain/groups';
import type { PollView } from '../../src/domain/polls';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (root: ShadowRoot | Element) => (root.textContent ?? '').replace(/\s+/g, ' ');
const button = (root: ParentNode, label: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;

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

const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('F-478 „+ Neu → Umfrage“ und Formular', () => {
  it('[F-478] Menü bietet „Umfrage“ und meldet die Art', async () => {
    const opens = listen('sx-compose-open');
    const el = await mount('sx-compose', { open: true });
    [...el.shadowRoot.querySelectorAll('.item')].find((b) => /Umfrage/.test(b.textContent ?? ''))!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opens).toEqual([{ kind: 'poll' }]);
  });

  it('[F-478] Dialog „Neue Umfrage“: Frage, Antworten, Mehrfachauswahl, namentlich angekündigt; erst vollständig absendbar; ohne Link und Anhang', async () => {
    const submits = listen('sx-compose-submit');
    const targets: ComposeTarget[] = [{ ref: { kind: 'user' }, id: '', choices: ['public'], reaches: [] }];
    const el = await mount('sx-compose-dialog', { open: true, kind: 'poll', targets, shares: [{ id: 'S1', title: 'Rügen', startedAt: null }] });
    expect(text(el.shadowRoot)).toContain('Neue Umfrage');
    const c = el.shadowRoot.querySelector('sx-post-composer') as LitEl;
    await c.updateComplete;
    const form = el.shadowRoot.querySelector('sx-poll-form') as LitEl;
    await form.updateComplete;
    expect(text(c.shadowRoot)).toContain('Frage');
    expect(text(c.shadowRoot)).not.toContain('Link (optional)');
    expect(text(c.shadowRoot)).not.toContain('Törn anhängen');
    await type(c.shadowRoot.querySelector('textarea')!, 'Wer segelt Mittwoch?');
    await c.updateComplete;
    const submit = () => c.shadowRoot.querySelector('button[type="submit"]') as HTMLButtonElement;
    // Antworten fehlen noch
    expect(submit().disabled).toBe(true);
    const opts = () => [...form.shadowRoot.querySelectorAll<HTMLInputElement>('.opt input')];
    await type(opts()[0], 'Ja');
    await type(opts()[1], 'Nein');
    await form.updateComplete;
    button(form.shadowRoot, /Antwort hinzufügen/)!.click();
    await form.updateComplete;
    await type(opts()[2], 'Vielleicht');
    await form.updateComplete;
    const checks = form.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checks[0].click(); // mehrere Antworten
    await form.updateComplete;
    form.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click(); // namentlich
    await form.updateComplete;
    expect(text(form.shadowRoot)).toMatch(/sieht auch, wer was gewählt hat/);
    await el.updateComplete;
    await c.updateComplete;
    expect(submit().disabled).toBe(false);
    (c.shadowRoot.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({
      channel: { kind: 'user', id: '' }, kind: 'poll', body: 'Wer segelt Mittwoch?', link: '', shareId: null,
      poll: { options: ['Ja', 'Nein', 'Vielleicht'], max: 2, closesAt: null, results: 'voted', named: true },
    });
  });

  it('[F-478] doppelte Antworten: Hinweis, nicht absendbar', async () => {
    const form = await mount('sx-poll-form', {});
    const payloads = listen('sx-payload');
    const opts = [...form.shadowRoot.querySelectorAll<HTMLInputElement>('.opt input')];
    await type(opts[0], 'Ja');
    await type(opts[1], 'ja');
    await form.updateComplete;
    expect(text(form.shadowRoot)).toContain('Jede Antwort nur einmal');
    expect(payloads.at(-1)).toMatchObject({ ok: false, value: null });
  });
});

const T = Date.UTC(2026, 10, 3, 10);
const view = (o: Partial<PollView> = {}): PollView => ({
  options: ['Ja', 'Nein'], max: 1, closesAt: null, results: 'voted', named: false, open: true, counts: null, voters: null, mine: [], canClose: false, ...o,
});
const card = (poll: PollView, path = '/p/P1'): StreamItem => ({
  id: 'A1', kind: 'post', createdAt: T, actor: { handle: 'anna', displayName: 'Anna' }, group: null,
  post: { id: 'P1', body: 'Wer segelt Mittwoch?', link: null, canDelete: false, path, poll },
});
async function pollIn(item: StreamItem) {
  const st = await mount('sx-stream', { items: [item] });
  const p = st.shadowRoot.querySelector('sx-poll') as LitEl;
  await p.updateComplete;
  return { st, p };
}

describe('F-478 Karte im Stream', () => {
  it('[F-478] ohne Stimme: Antworten wählen und abstimmen (Event mit Karte); Schlüssel aus /p/<id>/<schlüssel>', async () => {
    const votes = listen('sx-poll-vote');
    const { st, p } = await pollIn(card(view(), '/p/P1/KEY123'));
    expect(text(st.shadowRoot)).toContain('Wer segelt Mittwoch?');
    const vote = button(p.shadowRoot, /Abstimmen/)!;
    expect(vote.disabled).toBe(true);
    p.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();
    await p.updateComplete;
    button(p.shadowRoot, /Abstimmen/)!.click();
    expect(votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({ postId: 'P1', key: 'KEY123', choices: [1] });
    expect(votes[0].el).toBe(p);
    expect(text(p.shadowRoot)).toContain('anonym');
  });

  it('[F-478] mit Stimme und Ergebnis: Balken in Prozent, eigene markiert, ändern und zurücknehmen; namentlich „Wer hat was gewählt?“', async () => {
    const votes = listen('sx-poll-vote');
    const who = listen('sx-poll-who');
    const { p } = await pollIn(card(view({ counts: [3, 1], voters: 4, mine: [0], named: true })));
    expect(text(p.shadowRoot)).toMatch(/Ja\s*75 %/);
    expect(p.shadowRoot.querySelector('.bar.mine')!.textContent).toContain('Ja');
    expect(text(p.shadowRoot)).toContain('4 Personen haben abgestimmt');
    expect(text(p.shadowRoot)).toContain('namentlich');
    button(p.shadowRoot, /Zurücknehmen/)!.click();
    expect(votes[0]).toMatchObject({ choices: [] });
    button(p.shadowRoot, /Wer hat was gewählt/)!.click();
    expect(who).toHaveLength(1);
    p.people = [{ people: [{ handle: 'bo', displayName: 'Bo' }], others: 2 }, { people: [], others: 1 }];
    await p.updateComplete;
    expect(p.shadowRoot.querySelector('a[href="/u/bo"]')!.textContent).toBe('Bo');
    expect(text(p.shadowRoot)).toContain('+ 2 weitere');
    button(p.shadowRoot, /Stimme ändern/)!.click();
    await p.updateComplete;
    expect(p.shadowRoot.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  });

  it('[F-478] Stimme ohne sichtbares Ergebnis: Dank statt Zahlen; Mehrfachauswahl höchstens n', async () => {
    const { p } = await pollIn(card(view({ results: 'closed', mine: [1] })));
    expect(text(p.shadowRoot)).toContain('nach dem Ende');
    expect(p.shadowRoot.querySelector('.bar')).toBeNull();
    const m = await pollIn(card(view({ options: ['a', 'b', 'c'], max: 2 })));
    const boxes = () => m.p.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    boxes()[0].click();
    await m.p.updateComplete;
    boxes()[1].click();
    await m.p.updateComplete;
    expect(boxes()[2].disabled).toBe(true);
  });

  it('[F-478] Autor:in: Ergebnis vor der Stimme, „Abstimmen“ und „Umfrage beenden“; beendet: nur Ergebnis', async () => {
    const closes = listen('sx-poll-close');
    const { p } = await pollIn(card(view({ counts: [0, 0], voters: 0, canClose: true, closesAt: T + 86_400_000 })));
    expect(text(p.shadowRoot)).toContain('Endet');
    button(p.shadowRoot, /Umfrage beenden/)!.click();
    expect(closes).toHaveLength(1);
    expect(button(p.shadowRoot, /^\s*Abstimmen/)).toBeDefined();
    const done = await pollIn(card(view({ open: false, counts: [2, 1], voters: 3, mine: [0] })));
    expect(text(done.p.shadowRoot)).toContain('Beendet');
    expect(button(done.p.shadowRoot, /Stimme ändern|Zurücknehmen|Umfrage beenden/)).toBeUndefined();
  });
});
