// @vitest-environment happy-dom
// Funktionale Tests der Stammcrew-Oberfläche (F-270 … F-274, Konzept 41): Abschnitt „Stammcrew“ auf der Bootsseite,
// Schalter des Eigners, Titel, Austreten, „Zuordnung lösen“. Die Komponenten zeigen nur an und melden Absichten.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-boat-crew';
import '../../src/components/sx-profile-page';
import { inviteAcceptedText, inviteWhat } from '../../src/domain/invite-text';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const button = (el: LitEl, label: RegExp) =>
  [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;

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

const crew = (over: Record<string, unknown> = {}) => ({
  standing: null, rights: { post: false, invite: false, assign: 'crew' }, canInvite: false, canPost: false, members: [], others: 0, ...over,
});
const member = (over: Record<string, unknown> = {}) => ({ id: null, handle: 'anna', displayName: 'Anna', title: 'Vorschoterin', isSelf: false, ...over });

describe('sx-boat-crew', () => {
  it('[F-270] Besucher: Namen mit Titel und „+ n weitere“, keine Schalter, kein Einladen', async () => {
    const el = await mount('sx-boat-crew', { crew: crew({ members: [member()], others: 2 }), boatName: 'Möwe' });
    expect(text(el)).toContain('Anna');
    expect(text(el)).toContain('Vorschoterin');
    expect(text(el)).toContain('+ 2 weitere Personen');
    expect(el.shadowRoot.querySelector('fieldset')).toBeNull();
    expect(el.shadowRoot.querySelector('sx-invite-box')).toBeNull();
  });

  it('[F-270] Eigner: Schalter melden sx-boat-crew-rights, Entfernen nach Rückfrage, Einladen sichtbar', async () => {
    const rights = listen('sx-boat-crew-rights');
    const removes = listen('sx-boat-crew-remove');
    const el = await mount('sx-boat-crew', { crew: crew({ standing: 'owner', canInvite: true, members: [member({ id: 'U1' })] }), boatName: 'Möwe' });
    const boxes = el.shadowRoot.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    const select = el.shadowRoot.querySelector('select')!;
    select.value = 'anyone';
    select.dispatchEvent(new Event('change'));
    expect(rights).toEqual([{ post: true }, { assign: 'anyone' }]);
    button(el, /Aus der Stammcrew entfernen: Anna/)!.click();
    await el.updateComplete;
    expect(removes).toEqual([]);
    button(el, /Ja, entfernen/)!.click();
    expect(removes).toEqual([{ userId: 'U1' }]);
    expect(el.shadowRoot.querySelector('sx-invite-box')).not.toBeNull();
  });

  it('[F-270] Admin sieht die Schalter nur (gesperrt); Stammcrew ändert den eigenen Titel und tritt aus', async () => {
    const admin = await mount('sx-boat-crew', { crew: crew({ standing: 'admin' }) });
    expect([...admin.shadowRoot.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every((b) => b.disabled)).toBe(true);
    expect(text(admin)).toContain('Das legt der Eigner fest.');

    const titles = listen('sx-boat-crew-title');
    const removes = listen('sx-boat-crew-remove');
    const el = await mount('sx-boat-crew', { crew: crew({ standing: 'crew', members: [member({ id: 'ME', isSelf: true, title: '' })] }), boatName: 'Möwe' });
    expect(el.shadowRoot.querySelector('fieldset')).toBeNull();
    button(el, /Titel ändern/)!.click();
    await el.updateComplete;
    const input = el.shadowRoot.querySelector('form input') as HTMLInputElement;
    input.value = 'Smut';
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(titles).toEqual([{ userId: 'me', title: 'Smut' }]);
    button(el, /Stammcrew verlassen/)!.click();
    await el.updateComplete;
    button(el, /Ja, austreten/)!.click();
    expect(removes).toEqual([{ userId: 'me' }]);
  });

  it('[F-270] Einladungstexte nennen die Stammcrew', () => {
    expect(inviteWhat({ kind: 'boat_member', target: 'Möwe' })).toBe('in die Stammcrew des Boots „Möwe“ ein');
    expect(inviteAcceptedText({ kind: 'boat_member', target: 'Möwe' })).toBe('Du bist jetzt in der Stammcrew von „Möwe“');
  });
});

describe('sx-profile-page: Bootsseite mit Stammcrew', () => {
  const boatData = (over: Record<string, unknown> = {}, crewOver: Record<string, unknown> | null = {}) => ({
    kind: 'boat',
    boat: { id: 'B1', name: 'Möwe', boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '', visibility: 'public', shareKey: null, link: '/b/B1', createdAt: 0, updatedAt: 0, owner: null, role: null, ...over },
    stats: { voyages: 1, distNm: 3 },
    voyages: [{ id: 'S1', title: 'Havel', summary: '', distNm: 3, startedAt: 0, createdAt: 0, boat: null, visibility: 'public' }],
    crew: crewOver === null ? null : crew(crewOver),
  });

  it('[F-271] „Beitrag schreiben“ für die Stammcrew mit Schalter; Abschnitt „Stammcrew“ nur mit Inhalt', async () => {
    const el = await mount('sx-profile-page', { data: boatData({}, { standing: 'crew', canPost: true, members: [member({ isSelf: true, id: 'ME' })] }), signedIn: true });
    expect(el.shadowRoot.querySelector('sx-boat-crew')).not.toBeNull();
    expect(button(el, /Beitrag schreiben|Schreiben/)).toBeDefined();
    const empty = await mount('sx-profile-page', { data: boatData({}, {}), signedIn: false });
    expect(empty.shadowRoot.querySelector('sx-boat-crew')).toBeNull();
  });

  it('[F-274] Eigner sieht „Zuordnung lösen“ je Törn und meldet sx-boat-unassign; Besucher nicht', async () => {
    const unassign = listen('sx-boat-unassign');
    const el = await mount('sx-profile-page', { data: boatData({ role: 'owner' }, { standing: 'owner' }), signedIn: true });
    button(el, /Zuordnung zum Boot lösen: Havel/)!.click();
    expect(unassign).toEqual([{ boatId: 'B1', shareId: 'S1' }]);
    const visitor = await mount('sx-profile-page', { data: boatData({}, null), signedIn: false });
    expect(button(visitor, /Zuordnung/)).toBeUndefined();
  });
});
