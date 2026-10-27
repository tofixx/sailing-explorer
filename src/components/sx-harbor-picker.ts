import { LitElement, css, html, type PropertyValues } from 'lit';
import type { HarborRef, HarborSearchHit } from '../services/api';
import { HARBOR_LIMITS, harborKey } from '../domain/harbors';
import { icon } from './icons';
import { base, emit } from './shared';

/** Auswahl: vorhandener Hafen, neuer Name (legt der Server an bzw. erkennt die Dublette) oder keiner. */
export type HarborChoice = { harborId: string } | { name: string } | { harborId: null };

/**
 * Hafen wählen (Konzept 12.2): Eingabefeld mit Vorschlägen aus vorhandenen Häfen (Combobox nach ARIA). Tippen meldet
 * nach kurzer Pause `sx-harbor-search` { query, el } – die Verdrahtung setzt `results`. Ein Name ohne Treffer gilt als
 * neuer Hafen (gleiche Schreibweise in anderer Form findet der Server selbst). Fetcht nicht selbst.
 */
export class SxHarborPicker extends LitElement {
  static properties = {
    value: { attribute: false },
    results: { attribute: false },
    label: { type: String },
    inputId: { type: String, attribute: 'input-id' },
    text: { state: true },
    selected: { state: true },
    open: { state: true },
    active: { state: true },
  };
  declare value: HarborRef | null;
  declare results: HarborSearchHit[];
  declare label: string;
  declare inputId: string;
  declare text: string;
  declare selected: HarborRef | null;
  declare open: boolean;
  declare active: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.value = null;
    this.results = [];
    this.label = 'Hafen';
    this.inputId = 'harbor';
    this.text = '';
    this.selected = null;
    this.open = false;
    this.active = -1;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        position: relative;
      }
      ul {
        position: absolute;
        left: 0;
        right: 0;
        top: calc(100% + 2px);
        z-index: 10;
        list-style: none;
        margin: 0;
        padding: var(--s-1);
        border-radius: var(--radius);
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: var(--shadow-2);
        max-height: 240px;
        overflow-y: auto;
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 36px;
        padding: 0 var(--s-2);
        border-radius: var(--radius-s);
        cursor: pointer;
      }
      li[aria-selected='true'],
      li:hover {
        background: var(--surface-hover);
      }
      li svg {
        color: var(--accent);
      }
      li .n {
        margin-left: auto;
        font-size: var(--fs-xs);
        color: var(--text-3);
      }
      .state {
        font-size: var(--fs-xs);
        color: var(--text-3);
        margin-top: var(--s-1);
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('value')) {
      this.selected = this.value;
      this.text = this.value?.name ?? '';
    }
  }

  /** Aktuelle Wahl für das Formular. */
  get choice(): HarborChoice {
    if (this.selected && this.selected.name === this.text) return { harborId: this.selected.id };
    const t = this.text.trim();
    if (!t) return { harborId: null };
    const hit = this.results.find((r) => harborKey(r.name) === harborKey(t));
    return hit ? { harborId: hit.id } : { name: t };
  }

  private onInput(e: Event) {
    this.text = (e.target as HTMLInputElement).value;
    this.selected = null;
    this.active = -1;
    this.open = true;
    if (this.timer) clearTimeout(this.timer);
    const query = this.text.trim();
    if (harborKey(query).length < HARBOR_LIMITS.queryMin) {
      this.results = [];
      return;
    }
    this.timer = setTimeout(() => emit(this, 'sx-harbor-search', { query, el: this }), 250);
  }

  private pick(h: HarborRef) {
    this.selected = { id: h.id, slug: h.slug, name: h.name };
    this.text = h.name;
    this.open = false;
  }

  private onKey(e: KeyboardEvent) {
    const n = this.results.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.open = true;
      this.active = (this.active + 1) % n;
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.active = (this.active - 1 + n) % n;
    } else if (e.key === 'Enter' && this.open && this.active >= 0) {
      e.preventDefault();
      this.pick(this.results[this.active]);
    } else if (e.key === 'Escape') {
      this.open = false;
    }
  }

  render() {
    const listId = `${this.inputId}-list`;
    const show = this.open && this.results.length > 0;
    const c = this.choice;
    return html`<input id=${this.inputId} type="text" maxlength="80" autocomplete="off" role="combobox" aria-autocomplete="list" aria-label=${this.label}
        aria-expanded=${show ? 'true' : 'false'} aria-controls=${listId} aria-activedescendant=${this.active >= 0 ? `${listId}-${this.active}` : ''}
        placeholder="z. B. Potsdam, Yachthafen" .value=${this.text} @input=${this.onInput} @keydown=${this.onKey}
        @blur=${() => setTimeout(() => (this.open = false), 150)} />
      ${show
        ? html`<ul id=${listId} role="listbox" aria-label="Vorhandene Häfen">
            ${this.results.map(
              (h, i) => html`<li id="${listId}-${i}" role="option" aria-selected=${i === this.active ? 'true' : 'false'} @mousedown=${(e: Event) => e.preventDefault()} @click=${() => this.pick(h)}>
                ${icon('anchor')}<span>${h.name}</span><span class="n">${h.boats === 1 ? '1 Boot' : `${h.boats} Boote`}</span>
              </li>`,
            )}
          </ul>`
        : ''}
      <div class="state" aria-live="polite">${'name' in c ? `Neuer Hafen „${c.name}“ wird angelegt.` : c.harborId ? 'Vorhandener Hafen gewählt.' : ''}</div>`;
  }
}
customElements.define('sx-harbor-picker', SxHarborPicker);
