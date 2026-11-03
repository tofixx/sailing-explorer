import { LitElement, css, html, type PropertyValues } from 'lit';
import { reviewAltText, type SeasonReview } from '../domain/season-review';
import { FORMATS, type ImageFormat } from '../services/share-image';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

/** Vorschau des Bildes – setzt der LogbookPageController. */
export interface SeasonImageState {
  url: string;
  busy: boolean;
  format: ImageFormat;
}

/**
 * Dialog „Meine Saison <Jahr>“ (Konzept 33.4, F-522, F-523): Vorschau des Saison-Bildes, Format, Teilen und
 * Herunterladen. Rein präsentational – Events: `sx-season-format` { format }, `sx-season-share`,
 * `sx-season-download`, `sx-season-close`.
 */
export class SxSeasonReview extends LitElement {
  static properties = {
    open: { type: Boolean },
    review: { attribute: false },
    image: { attribute: false },
  };
  declare open: boolean;
  declare review: SeasonReview | null;
  declare image: SeasonImageState | null;

  constructor() {
    super();
    this.open = false;
    this.review = null;
    this.image = null;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(560px, calc(100vw - 32px));
      }
      .preview {
        position: relative;
        min-height: 120px;
        border-radius: var(--radius);
        overflow: hidden;
        border: 1px solid var(--border-soft);
        background: var(--surface-2);
        display: grid;
        place-items: center;
      }
      .preview img {
        display: block;
        width: 100%;
        height: auto;
      }
      .preview.square img {
        max-width: 400px;
      }
      .preview .busy {
        position: absolute;
        inset: auto var(--s-2) var(--s-2) auto;
        background: var(--overlay);
        border-radius: 999px;
        padding: 2px var(--s-3);
        font-size: var(--fs-s);
      }
      .formats {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
      }
      .formats legend {
        padding: 0;
        margin-bottom: var(--s-2);
        font-weight: 600;
      }
      .formats label {
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 44px;
        padding: 0 var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        cursor: pointer;
      }
      .formats label:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .formats input {
        accent-color: var(--accent);
      }
      .actions .btn {
        min-height: 44px;
      }
      .hint {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog');
    if (!dlg || !changed.has('open')) return;
    if (this.open && !dlg.open) dlg.showModal();
    else if (!this.open && dlg.open) dlg.close();
  }

  private close = () => emit(this, 'sx-season-close');

  private formats(img: SeasonImageState) {
    return html`<fieldset class="formats">
      <legend>Format</legend>
      ${(['square', 'landscape'] as ImageFormat[]).map(
        (f) => html`<label><input type="radio" name="format" .checked=${img.format === f}
          @change=${() => emit(this, 'sx-season-format', { format: f })} />${FORMATS[f].label}</label>`,
      )}
    </fieldset>`;
  }

  render() {
    const r = this.review;
    const img = this.image;
    const canShareFiles = typeof navigator.canShare === 'function';
    return html`<dialog aria-labelledby="season-h" @close=${this.close}>
      <header>
        <h2 id="season-h">Meine Saison ${r?.season ?? ''}</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <div class="body">
        <div class="preview ${img?.format ?? 'square'}">
          ${img?.url && r ? html`<img src=${img.url} alt=${reviewAltText(r)} />` : html`<p class="hint">Erzeuge Bild …</p>`}
          ${img?.busy && img.url ? html`<span class="busy">Aktualisiere …</span>` : ''}
        </div>
        ${img ? this.formats(img) : ''}
        <p class="hint">Das Bild entsteht nur in deinem Browser und zeigt nur deine eigenen Zahlen – ohne Namen, Titel und Orte.
          Gespeichert oder geteilt wird es erst, wenn du es selbst teilst oder herunterlädst.</p>
        <div class="actions">
          ${canShareFiles ? html`<button class="btn" ?disabled=${!img?.url} @click=${() => emit(this, 'sx-season-share')}>${icon('share')} Teilen …</button>` : ''}
          <button class="btn primary" ?disabled=${!img?.url} @click=${() => emit(this, 'sx-season-download')}>${icon('download')} Herunterladen</button>
        </div>
      </div>
    </dialog>`;
  }
}
customElements.define('sx-season-review', SxSeasonReview);
