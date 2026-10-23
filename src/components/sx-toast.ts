import { LitElement, css, html } from 'lit';
import { base } from './shared';

/** Kurze Rückmeldungen und Ladeanzeige. Live-Region für Screenreader. */
export class SxToast extends LitElement {
  static properties = { message: { state: true }, loading: { type: String } };
  declare message: string;
  declare loading: string | null;
  private timer = 0;

  constructor() {
    super();
    this.message = '';
    this.loading = null;
  }

  static styles = [
    base,
    css`
      :host {
        position: fixed;
        inset: auto auto var(--s-5) 50%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        overflow: visible;
        transform: translateX(-50%);
        z-index: 3000;
        display: grid;
        gap: var(--s-2);
        justify-items: center;
        pointer-events: none;
        width: max-content;
        max-width: calc(100vw - 32px);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        padding: var(--s-2) var(--s-4);
        border-radius: 999px;
        background: var(--text);
        color: var(--surface);
        font-size: var(--fs-m);
        font-weight: 550;
        box-shadow: var(--shadow-2);
        animation: in 0.2s var(--ease);
      }
      .loading {
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--border);
      }
      .spin {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid var(--border);
        border-top-color: var(--accent);
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      @keyframes in {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('popover', 'manual');
  }

  /** Neu in die Top-Layer heben – sonst verdecken modale Dialoge die Meldung. */
  private raise() {
    try {
      if (this.matches(':popover-open')) this.hidePopover();
      this.showPopover();
    } catch {
      /* ältere Browser: bleibt ein normales fixed-Element */
    }
  }

  updated() {
    if (this.message || this.loading) this.raise();
  }

  show(message: string, ms = 3600) {
    this.message = message;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.message = ''), ms);
  }

  render() {
    return html`
      ${this.loading ? html`<div class="pill loading" role="status"><span class="spin"></span>${this.loading}</div>` : ''}
      <div role="status" aria-live="polite">${this.message ? html`<div class="pill">${this.message}</div>` : ''}</div>
    `;
  }
}
customElements.define('sx-toast', SxToast);
