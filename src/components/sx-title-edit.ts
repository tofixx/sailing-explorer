import { LitElement, css, html, type PropertyValues } from 'lit';
import { icon } from './icons';
import { base, emit } from './shared';

/** Höchstlänge eines Törn-Titels (wie LIMITS.titleLength im Worker). */
export const TITLE_MAX = 120;

/**
 * Törn-Titel mit Stift zum Umbenennen (F-424) – für die Eigentümer:in überall gleich: Törn-Ansicht, Teilen-Dialog nach
 * dem Speichern bzw. Teilen, „Mein Verlauf“; jede Sichtbarkeit, auch „Nur mit Link“ (der Schlüssel bleibt). Ohne
 * `editable` nur der Titel. Rein präsentational – meldet `sx-title-save` { id, title, scope }.
 */
export class SxTitleEdit extends LitElement {
  static properties = {
    shareId: { type: String, attribute: 'share-id' },
    value: { type: String },
    editable: { type: Boolean },
    /** Wer die Absicht ausführt (z. B. `mine` für „Mein Verlauf“) – der Host leitet danach weiter */
    scope: { type: String },
    /** Überschrift-Ebene des Titels: `h2` (Törn-Ansicht) oder Fließtext */
    heading: { type: Boolean },
    editing: { state: true },
  };
  declare shareId: string;
  declare value: string;
  declare editable: boolean;
  declare scope: string;
  declare heading: boolean;
  declare editing: boolean;

  constructor() {
    super();
    this.shareId = '';
    this.value = '';
    this.editable = false;
    this.scope = '';
    this.heading = false;
    this.editing = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .show {
        display: flex;
        align-items: center;
        gap: var(--s-1);
        min-width: 0;
      }
      h2,
      .t {
        margin: 0;
        overflow-wrap: anywhere;
        min-width: 0;
      }
      h2 {
        font-size: var(--fs-l);
        letter-spacing: -0.01em;
      }
      .t {
        font-weight: 650;
      }
      form {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
      input {
        flex: 1 1 200px;
        min-width: 0;
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    if (changed.has('editing') && this.editing) this.renderRoot.querySelector<HTMLInputElement>('input')?.select();
  }

  private save(e: Event) {
    e.preventDefault();
    const title = String(new FormData(e.target as HTMLFormElement).get('title') ?? '').trim();
    this.editing = false;
    if (title && title !== this.value) emit(this, 'sx-title-save', { id: this.shareId, title, scope: this.scope });
  }

  private onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    this.editing = false;
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLButtonElement>('.edit')?.focus());
  }

  render() {
    if (this.editing) {
      return html`<form @submit=${(e: Event) => this.save(e)} @keydown=${(e: KeyboardEvent) => this.onKey(e)}>
        <input name="title" type="text" maxlength=${TITLE_MAX} required .value=${this.value} aria-label="Neuer Titel" />
        <button class="btn primary small" type="submit">${icon('check')} Speichern</button>
        <button class="btn small" type="button" @click=${() => (this.editing = false)}>Abbrechen</button>
      </form>`;
    }
    const title = this.heading ? html`<h2>${this.value}</h2>` : html`<span class="t">${this.value}</span>`;
    return html`<div class="show">
      ${title}
      ${this.editable
        ? html`<button class="btn ghost small icon edit" type="button" title="Umbenennen" aria-label="Umbenennen: ${this.value}" @click=${() => (this.editing = true)}>${icon('pencil')}</button>`
        : ''}
    </div>`;
  }
}
customElements.define('sx-title-edit', SxTitleEdit);
