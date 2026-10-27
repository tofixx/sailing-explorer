// @vitest-environment happy-dom
// Auswahllisten per Eingabe filtern (F-290).
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-filter-select';
import { filterKey } from '../../src/components/sx-filter-select';

type El = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
const clubs = ['Segelclub Möwe', 'Potsdamer Yacht Club', 'SC Havel', 'Kladower Segler', 'Wannsee Club', 'Tegeler Segler'];

async function mount(names: string[]): Promise<{ el: El; sel: HTMLSelectElement; changes: string[] }> {
  const el = document.createElement('sx-filter-select') as El;
  el.innerHTML = `<select name="clubId"><option value="">– keiner –</option>${names.map((n, i) => `<option value="c${i}">${n}</option>`).join('')}</select>`;
  const form = document.createElement('form');
  form.append(el);
  document.body.append(form);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  const sel = el.querySelector('select')!;
  const changes: string[] = [];
  sel.addEventListener('change', () => changes.push(sel.value));
  return { el, sel, changes };
}
const type = (el: El, q: string) => {
  const input = el.shadowRoot.querySelector('input')!;
  input.value = q;
  input.dispatchEvent(new Event('input'));
};
const visible = (sel: HTMLSelectElement) => [...sel.options].filter((o) => !o.hidden).map((o) => o.text);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Auswahl filtern', () => {
  it('[F-290] ab 6 Einträgen Suchfeld; filtert ohne Groß-/Kleinschreibung und Umlaute, „– keiner –“ bleibt; Enter wählt den ersten Treffer', async () => {
    const { el, sel, changes } = await mount(clubs);
    type(el, 'mowe');
    expect(visible(sel)).toEqual(['– keiner –', 'Segelclub Möwe']);
    type(el, 'SEGLER');
    expect(visible(sel)).toEqual(['– keiner –', 'Kladower Segler', 'Tegeler Segler']);
    const input = el.shadowRoot.querySelector('input')!;
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(sel.value).toBe('c3');
    expect(changes).toEqual(['c3']);
    expect(new FormData(el.closest('form')!).get('clubId')).toBe('c3');
    type(el, '');
    expect(visible(sel)).toHaveLength(clubs.length + 1);
  });

  it('[F-290] fällt die aktuelle Wahl heraus, wird der erste Treffer gewählt; kurze Listen ohne Suchfeld', async () => {
    const { el, sel, changes } = await mount(clubs);
    sel.value = 'c0';
    type(el, 'havel');
    expect(sel.value).toBe('c2');
    expect(changes).toEqual(['c2']);
    const short = await mount(clubs.slice(0, 3));
    expect(short.el.shadowRoot.querySelector('input')).toBeNull();
    expect(filterKey('  Möwe  Club ')).toBe('mowe club');
  });
});
