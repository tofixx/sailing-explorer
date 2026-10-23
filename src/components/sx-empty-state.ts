import { LitElement, css, html } from 'lit';
import { icon } from './icons';
import { base, emit, pickGpx } from './shared';

export interface Sample {
  file: string;
  label: string;
}

/** Einstieg über der Karte: Datei wählen, ablegen oder Beispiel öffnen. */
export class SxEmptyState extends LitElement {
  static properties = {
    samples: { attribute: false },
    dragging: { type: Boolean, reflect: true },
  };
  declare samples: Sample[];
  declare dragging: boolean;

  constructor() {
    super();
    this.samples = [];
    this.dragging = false;
  }

  static styles = [
    base,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 800;
        display: grid;
        place-items: center;
        padding: var(--s-4);
        pointer-events: none;
      }
      .card {
        pointer-events: auto;
        width: min(460px, 100%);
        background: var(--overlay);
        backdrop-filter: blur(10px) saturate(1.2);
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
        box-shadow: var(--shadow-2);
        padding: var(--s-6) var(--s-5) var(--s-5);
        text-align: center;
        transition: transform 0.2s var(--ease), border-color 0.2s var(--ease);
      }
      :host([dragging]) .card {
        border: 2px dashed var(--accent);
        transform: scale(1.02);
      }
      .badge {
        width: 56px;
        height: 56px;
        margin: 0 auto var(--s-3);
        border-radius: var(--radius-l);
        background: var(--accent-soft);
        color: var(--accent);
        display: grid;
        place-items: center;
      }
      .badge svg {
        width: 30px;
        height: 30px;
      }
      h1 {
        margin: 0 0 var(--s-2);
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
        line-height: 1.2;
      }
      p {
        margin: 0 auto var(--s-4);
        max-width: 36ch;
        color: var(--text-2);
      }
      .btn.primary {
        min-height: max(44px, var(--control-h));
        padding: 0 var(--s-5);
        font-size: var(--fs-l);
      }
      .hint {
        margin-top: var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-3);
      }
      .samples {
        margin-top: var(--s-5);
        padding-top: var(--s-4);
        border-top: 1px solid var(--border-soft);
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        justify-content: center;
        align-items: center;
        font-size: var(--fs-s);
      }
      .privacy {
        margin-top: var(--s-4);
        font-size: var(--fs-xs);
        color: var(--text-3);
        display: flex;
        gap: var(--s-1);
        justify-content: center;
        align-items: center;
      }
      .privacy svg {
        width: 13px;
        height: 13px;
      }
      @media (pointer: coarse) {
        .drag-hint {
          display: none;
        }
      }
    `,
  ];

  render() {
    return html`
      <section class="card" aria-labelledby="t">
        <div class="badge">${icon('map')}</div>
        <h1 id="t">Deinen Törn auf die Seekarte bringen</h1>
        <p>Lade eine oder mehrere GPX-Dateien. Der Track erscheint auf der OpenSeaMap – mit Speed, Wind und Wellen für genau diese Zeit.</p>
        <button class="btn primary" @click=${() => pickGpx(this)}>${icon('upload')} GPX-Dateien wählen</button>
        <div class="hint drag-hint">oder einfach auf die Karte ziehen</div>
        ${this.samples.length
          ? html`<div class="samples">
              <span class="faint">Beispiel ansehen:</span>
              ${this.samples.map(
                (s) => html`<button class="btn small" @click=${() => emit(this, 'sx-sample', s.file)}>${s.label}</button>`,
              )}
            </div>`
          : ''}
        <div class="privacy">${icon('lock')} Dateien werden lokal im Browser ausgewertet.</div>
      </section>
    `;
  }
}
customElements.define('sx-empty-state', SxEmptyState);
