import { LitElement, html, type PropertyValues } from 'lit';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

/**
 * Kurze Rückfrage mit zwei Knöpfen (z. B. „Entwurf verwerfen?“, F-434): geteilte Dialog-Stile (`dialogStyles`, mobil
 * randlos), Escape und × heißen „Abbrechen“. Rein präsentational – meldet `sx-confirm-ok` bzw. `sx-confirm-cancel`;
 * wer gefragt hat, entscheidet der Controller.
 */
export class SxConfirm extends LitElement {
  static properties = {
    open: { type: Boolean },
    heading: { type: String },
    text: { type: String },
    confirmLabel: { type: String },
  };
  declare open: boolean;
  declare heading: string;
  declare text: string;
  declare confirmLabel: string;

  constructor() {
    super();
    this.open = false;
    this.heading = '';
    this.text = '';
    this.confirmLabel = 'OK';
  }

  static styles = [base, dialogStyles];

  updated(changed: PropertyValues<this>) {
    if (!changed.has('open')) return;
    const d = this.renderRoot.querySelector('dialog');
    if (this.open && d && !d.open) {
      d.showModal();
      // Fokus auf „Abbrechen“: Enter verwirft nichts aus Versehen
      this.renderRoot.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    } else if (!this.open && d?.open) d.close();
  }

  private cancel = () => emit(this, 'sx-confirm-cancel');

  render() {
    return html`<dialog aria-labelledby="cf-h" aria-describedby="cf-t" @cancel=${(e: Event) => {
        e.preventDefault();
        this.cancel();
      }}>
      <header>
        <h2 id="cf-h">${this.heading}</h2>
        <button class="btn ghost icon" type="button" aria-label="Abbrechen" @click=${this.cancel}>${icon('x')}</button>
      </header>
      <div class="body">
        <p id="cf-t">${this.text}</p>
        <div class="actions">
          <button class="btn" type="button" data-cancel @click=${this.cancel}>Abbrechen</button>
          <button class="btn primary" type="button" @click=${() => emit(this, 'sx-confirm-ok')}>${this.confirmLabel}</button>
        </div>
      </div>
    </dialog>`;
  }
}
customElements.define('sx-confirm', SxConfirm);
