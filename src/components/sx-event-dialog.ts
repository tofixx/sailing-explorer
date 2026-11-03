import { LitElement, css, html, type PropertyValues } from 'lit';
import type { EventView } from '../domain/events';
import type { EventFields } from '../services/api';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import './sx-event-form';

/**
 * Veranstaltung ändern oder absagen (Konzept 30, F-484): dasselbe Formular wie beim Anlegen (`sx-event-form`, ohne
 * Titel), mobil randlos (`dialogStyles`). Rein präsentational – meldet `sx-event-save` { id, patch },
 * `sx-event-cancel` { id } und `sx-event-dialog-close`; Rückfrage und Speichern macht der EventsController.
 */
export class SxEventDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    postId: { type: String, attribute: false },
    event: { attribute: false },
  };
  declare open: boolean;
  declare busy: boolean;
  declare error: string;
  declare postId: string;
  declare event: EventView | null;
  private fields: EventFields | null = null;
  /** Grund, warum die Angaben noch nicht gehen (gleiche Regel wie der Server) */
  private hint = '';

  constructor() {
    super();
    this.open = false;
    this.busy = false;
    this.error = '';
    this.postId = '';
    this.event = null;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(520px, calc(100vw - 32px));
      }
      .body {
        display: grid;
        gap: var(--s-3);
      }
      .foot {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        justify-content: space-between;
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    if (!changed.has('open')) return;
    const d = this.renderRoot.querySelector('dialog');
    if (this.open && d && !d.open) d.showModal();
    else if (!this.open && d?.open) d.close();
  }

  private close = () => emit(this, 'sx-event-dialog-close');

  private save(e: Event) {
    e.preventDefault();
    if (this.fields) emit(this, 'sx-event-save', { id: this.postId, patch: this.fields });
  }

  render() {
    return html`<dialog aria-labelledby="ed-h" @close=${() => this.open && this.close()} @cancel=${(e: Event) => {
        e.preventDefault();
        this.close();
      }}>
      <header>
        <h2 id="ed-h">Veranstaltung ändern</h2>
        <button class="btn ghost icon" type="button" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <form class="body" @submit=${(e: Event) => this.save(e)} @sx-payload=${(e: CustomEvent<{ value: EventFields | null; message: string }>) => {
          e.stopPropagation();
          this.fields = e.detail.value;
          this.hint = e.detail.message;
          this.requestUpdate();
        }}>
        <p class="muted">Wer zugesagt hat, bekommt eine Nachricht, wenn sich Zeit oder Ort ändern. Titel und Beschreibung bleiben.</p>
        ${this.open ? html`<sx-event-form .value=${this.event}></sx-event-form>` : ''}
        ${this.error || this.hint ? html`<p class="error" role="alert">${this.error || this.hint}</p>` : ''}
        <div class="foot">
          <button class="btn danger" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-event-cancel', { id: this.postId })}>${icon('x')} Absagen</button>
          <button class="btn primary" type="submit" ?disabled=${this.busy || !this.fields}>${icon('check')} Speichern</button>
        </div>
      </form>
    </dialog>`;
  }
}
customElements.define('sx-event-dialog', SxEventDialog);
