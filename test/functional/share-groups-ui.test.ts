// @vitest-environment happy-dom
// „In Gruppen zeigen“ im Speichern-/Teilen-Dialog (F-378): Haken je eigener Gruppe, vorausgewählt die Gruppen des
// Boots, später am gespeicherten Törn änderbar; ohne Gruppen kein Abschnitt.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-share-dialog';
import { parseGroupIds, presetGroupIds } from '../../src/domain/groups';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

async function mount(props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement('sx-share-dialog') as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const picker = async (dlg: LitEl) => {
  const el = dlg.shadowRoot.querySelector('sx-share-groups') as LitEl | null;
  if (el) await el.updateComplete;
  return el;
};
const boxes = async (dlg: LitEl) => [...((await picker(dlg))?.shadowRoot.querySelectorAll<HTMLInputElement>('input[type=checkbox]') ?? [])];
const checked = async (dlg: LitEl) => (await boxes(dlg)).filter((b) => b.checked).map((b) => b.value);
const events: Array<{ type: string; detail: unknown }> = [];
for (const n of ['sx-share-submit', 'sx-share-update']) document.addEventListener(n, (e) => events.push({ type: n, detail: (e as CustomEvent).detail }));

afterEach(() => {
  document.body.innerHTML = '';
  events.length = 0;
});

const GROUPS = [
  { id: 'ClubAAAAAAAAAAAAAA', slug: 'club', name: 'Segelclub', kind: 'club', boatIds: ['BoatAAAAAAAAAAAAAA'] },
  { id: 'TeamAAAAAAAAAAAAAA', slug: 'mi', name: 'Mittwochsregatta', kind: 'team', boatIds: [] },
];
const BOATS = [{ id: 'BoatAAAAAAAAAAAAAA', name: 'Möwe' }];

describe('F-378 Dialog „In Gruppen zeigen“', () => {
  it('[F-378] reine Regeln: Vorauswahl aus den Gruppen des Boots, ohne Boot keine; Auswahl geprüft', () => {
    expect(presetGroupIds(GROUPS, 'BoatAAAAAAAAAAAAAA')).toEqual(['ClubAAAAAAAAAAAAAA']);
    expect(presetGroupIds(GROUPS, null)).toEqual([]);
    expect(parseGroupIds(['ClubAAAAAAAAAAAAAA', 'ClubAAAAAAAAAAAAAA'], 50)).toEqual(['ClubAAAAAAAAAAAAAA']);
    expect(parseGroupIds('x', 50)).toBeNull();
    expect(parseGroupIds(['kurz'], 50)).toBeNull();
    expect(parseGroupIds(['ClubAAAAAAAAAAAAAA', 'TeamAAAAAAAAAAAAAA'], 1)).toBeNull();
  });

  it('[F-378] ohne eigene Gruppen kein Abschnitt; Absenden schickt dann keine Auswahl (Server nimmt die des Boots)', async () => {
    const dlg = await mount({ open: true, purpose: 'save', tab: 'link', linkState: 'form', defaultTitle: 'Havel', boats: BOATS });
    expect(await boxes(dlg)).toEqual([]);
    (dlg.shadowRoot.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(events.at(-1)?.detail).toMatchObject({ groupIds: null });
  });

  it('[F-378] Boot wählen wählt seine Gruppen vor; Haken setzen und absenden schickt genau die Auswahl', async () => {
    const dlg = await mount({ open: true, purpose: 'save', tab: 'link', linkState: 'form', defaultTitle: 'Havel', boats: BOATS, groupChoices: GROUPS });
    expect((await picker(dlg))?.shadowRoot.textContent).toContain('In Gruppen zeigen');
    expect((await picker(dlg))?.shadowRoot.textContent).toContain('Nur öffentliche Törns');
    expect(await checked(dlg)).toEqual([]);
    const select = dlg.shadowRoot.querySelector('select#boat') as HTMLSelectElement;
    select.value = 'BoatAAAAAAAAAAAAAA';
    select.dispatchEvent(new Event('change'));
    await dlg.updateComplete;
    expect(await checked(dlg)).toEqual(['ClubAAAAAAAAAAAAAA']);
    const team = (await boxes(dlg))[1];
    team.checked = true;
    team.dispatchEvent(new Event('change'));
    await dlg.updateComplete;
    expect(await checked(dlg)).toEqual(['ClubAAAAAAAAAAAAAA', 'TeamAAAAAAAAAAAAAA']);
    (dlg.shadowRoot.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(events.at(-1)).toMatchObject({ type: 'sx-share-submit', detail: { boatId: 'BoatAAAAAAAAAAAAAA', groupIds: ['ClubAAAAAAAAAAAAAA', 'TeamAAAAAAAAAAAAAA'] } });
  });

  it('[F-378] gespeicherter Törn: Eigentümer:in ändert die Gruppen sofort (sx-share-update); Fremde sehen keinen Abschnitt', async () => {
    const share = { id: 'ShareAAAAAAAAAAAAA', title: 'Havel', summary: '', visibility: 'public', isOwner: true, groupIds: ['TeamAAAAAAAAAAAAAA'] };
    const dlg = await mount({ open: true, purpose: 'save', tab: 'link', linkState: 'form', groupChoices: GROUPS, result: { share, url: 'https://x/s/1' } });
    expect(await checked(dlg)).toEqual(['TeamAAAAAAAAAAAAAA']);
    const team = (await boxes(dlg))[1];
    team.checked = false;
    team.dispatchEvent(new Event('change'));
    expect(events.at(-1)).toEqual({ type: 'sx-share-update', detail: { id: share.id, patch: { groupIds: [] } } });

    const shared = await mount({ open: true, purpose: 'share', tab: 'link', linkState: 'form', groupChoices: GROUPS, result: { share, url: 'https://x/s/1' } });
    expect(await checked(shared)).toEqual(['TeamAAAAAAAAAAAAAA']);
    const foreign = await mount({ open: true, purpose: 'share', tab: 'link', linkState: 'form', groupChoices: GROUPS, result: { share: { ...share, isOwner: false, groupIds: undefined }, url: 'https://x/s/1' } });
    expect(await picker(foreign)).toBeNull();
  });
});
