import { LitElement, css, html } from 'lit';
import { base } from './shared';

/** Vergleichsform: klein, ohne Akzente (ö → o), Leerraum zusammengefasst. */
export const filterKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Lange Auswahllisten per Eingabe filtern (F-290): umschließt ein normales `<select>` (bleibt im Formular, Events wie
 * bisher) und zeigt ab `min` Einträgen ein Suchfeld darüber. Nicht passende Einträge werden ausgeblendet; fällt die
 * aktuelle Wahl heraus, wird der erste Treffer gewählt (mit `change`). Enter im Suchfeld wählt den ersten Treffer, statt
 * das Formular abzuschicken. Der leere Eintrag („– keiner –“) bleibt immer sichtbar.
 */
export class SxFilterSelect extends LitElement {
  static properties = { label: { type: String }, min: { type: Number }, count: { state: true } };
  declare label: string;
  declare min: number;
  declare count: number;
  private query = '';

  constructor() {
    super();
    this.label = 'Liste filtern';
    this.min = 6;
    this.count = 0;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-1);
      }
      input {
        width: 100%;
      }
    `,
  ];

  /** Einträge kommen oft erst später (geladene Listen) – dann neu zählen und filtern. */
  private observer = new MutationObserver(() => this.onSlot());

  connectedCallback(): void {
    super.connectedCallback();
    this.observer.observe(this, { childList: true, subtree: true });
  }

  firstUpdated(): void {
    this.onSlot();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer.disconnect();
  }

  private get select(): HTMLSelectElement | null {
    return this.querySelector('select');
  }

  private options(): HTMLOptionElement[] {
    return [...(this.select?.options ?? [])];
  }

  private onSlot = () => {
    this.count = this.options().filter((o) => o.value !== '').length;
    this.apply(false);
  };

  /** Blendet nicht passende Einträge aus; `pick` wählt bei Bedarf den ersten Treffer. */
  private apply(pick: boolean) {
    const sel = this.select;
    if (!sel) return;
    const q = filterKey(this.query);
    let first: HTMLOptionElement | null = null;
    for (const o of this.options()) {
      const match = o.value === '' || !q || filterKey(o.text).includes(q);
      o.hidden = !match;
      o.disabled = !match;
      if (match && o.value !== '' && !first) first = o;
    }
    const current = sel.selectedOptions[0];
    if (first && (pick || (current && current.hidden))) {
      if (sel.value !== first.value) {
        sel.value = first.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  private onInput(e: Event) {
    this.query = (e.target as HTMLInputElement).value;
    this.apply(false);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    this.apply(true);
    this.select?.focus();
  }

  render() {
    return html`${this.count >= this.min
        ? html`<input type="search" placeholder="Tippen zum Filtern …" aria-label=${this.label} autocomplete="off" @input=${this.onInput} @keydown=${this.onKey} @focus=${() => this.onSlot()} />`
        : ''}
      <slot @slotchange=${this.onSlot}></slot>`;
  }
}
customElements.define('sx-filter-select', SxFilterSelect);
