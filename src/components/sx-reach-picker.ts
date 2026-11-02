import { LitElement, css, html } from 'lit';
import type { Reach, ReachOption } from '../domain/posts';
import { base, emit } from './shared';

/**
 * „Sichtbar bis“ (Konzept 21.2, B2, F-409, F-427): Auswahl der Stufen, die es für den Verlauf gibt, mit der Kette der
 * gewählten Stufe darunter („Mittwochsregatta → PYC → Hafen Potsdam → überall“). Rein präsentational – meldet
 * `sx-reach-change` { reach }. Mit nur einer Stufe zeigt es nur den Hinweis.
 */
export class SxReachPicker extends LitElement {
  static properties = {
    options: { attribute: false },
    value: { type: String },
    disabled: { type: Boolean },
    /** Hinweis, wenn nichts zu wählen ist (z. B. nicht öffentlich) */
    note: { type: String },
  };
  declare options: ReachOption[];
  declare value: Reach;
  declare disabled: boolean;
  declare note: string;

  constructor() {
    super();
    this.options = [];
    this.value = 'all';
    this.disabled = false;
    this.note = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-1);
      }
      .chain {
        font-size: var(--fs-s);
        color: var(--text-2);
        overflow-wrap: anywhere;
      }
    `,
  ];

  /** Gewählte Stufe – gibt es sie hier nicht, die höchste vorhandene. */
  private current(): ReachOption | undefined {
    return this.options.find((o) => o.reach === this.value) ?? this.options[this.options.length - 1];
  }

  render() {
    const cur = this.current();
    if (this.options.length < 2) {
      const text = this.note || (cur ? `Sichtbar ${cur.chain}` : '');
      return text ? html`<span class="chain">${text}</span>` : '';
    }
    return html`<label class="label" for="reach">Sichtbar bis</label>
      <select id="reach" ?disabled=${this.disabled} @change=${(e: Event) => emit(this, 'sx-reach-change', { reach: (e.target as HTMLSelectElement).value as Reach })}>
        ${this.options.map((o) => html`<option value=${o.reach} ?selected=${o.reach === cur?.reach}>${o.label}</option>`)}
      </select>
      <span class="chain" aria-live="polite">${cur?.chain ?? ''}</span>`;
  }
}
customElements.define('sx-reach-picker', SxReachPicker);
