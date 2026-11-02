import { LitElement, html, type PropertyValues } from 'lit';
import { icon } from './icons';
import { base, dialogStyles } from './shared';

/** Was gefragt wird: Titel, Frage und Beschriftung des Bestätigen-Knopfs. */
export interface ConfirmRequest {
  heading: string;
  text: string;
  confirmLabel: string;
}

/**
 * Kurze Rückfrage mit zwei Knöpfen für alle Abläufe (z. B. „Entwurf verwerfen?“, F-434): geteilte Dialog-Stile
 * (`dialogStyles`, mobil randlos), Fokus startet auf „Abbrechen“, Escape und × heißen „Abbrechen“. Ein Controller fragt
 * mit `ask({ … })` und bekommt `true` bzw. `false`; eine neue Frage beantwortet eine noch offene mit „Abbrechen“.
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
  private resolve: ((ok: boolean) => void) | null = null;

  constructor() {
    super();
    this.open = false;
    this.heading = '';
    this.text = '';
    this.confirmLabel = 'OK';
  }

  static styles = [base, dialogStyles];

  /** Frage stellen; erfüllt mit true („Bestätigen“) bzw. false („Abbrechen“, Escape, ×, `dismiss()`). */
  ask(req: ConfirmRequest): Promise<boolean> {
    this.answer(false);
    Object.assign(this, req, { open: true });
    return new Promise((r) => (this.resolve = r));
  }

  /** offene Frage als „Abbrechen“ schließen (z. B. beim Abmelden) */
  dismiss(): void {
    this.answer(false);
  }

  private answer(ok: boolean) {
    const r = this.resolve;
    this.resolve = null;
    this.open = false;
    r?.(ok);
  }

  updated(changed: PropertyValues<this>) {
    if (!changed.has('open')) return;
    const d = this.renderRoot.querySelector('dialog');
    if (this.open && d && !d.open) {
      d.showModal();
      // Fokus auf „Abbrechen“: Enter verwirft nichts aus Versehen
      this.renderRoot.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    } else if (!this.open && d?.open) d.close();
  }

  render() {
    return html`<dialog aria-labelledby="cf-h" aria-describedby="cf-t" @cancel=${(e: Event) => {
        e.preventDefault();
        this.answer(false);
      }}>
      <header>
        <h2 id="cf-h">${this.heading}</h2>
        <button class="btn ghost icon" type="button" aria-label="Abbrechen" @click=${() => this.answer(false)}>${icon('x')}</button>
      </header>
      <div class="body">
        <p id="cf-t">${this.text}</p>
        <div class="actions">
          <button class="btn" type="button" data-cancel @click=${() => this.answer(false)}>Abbrechen</button>
          <button class="btn primary" type="button" @click=${() => this.answer(true)}>${this.confirmLabel}</button>
        </div>
      </div>
    </dialog>`;
  }
}
customElements.define('sx-confirm', SxConfirm);
