import { LitElement, css, html } from 'lit';
import type { Kpi } from '../domain/summary';
import { icon } from './icons';
import { base, emit } from './shared';

/** Kennzahlen-Raster. Maxima sind mit der Karte verknüpft (Hover/Fokus zeigt den Ort). */
export class SxKpis extends LitElement {
  static properties = { items: { attribute: false } };
  declare items: Kpi[];

  constructor() {
    super();
    this.items = [];
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--s-2);
      }
      .kpi {
        all: unset;
        box-sizing: border-box;
        display: block;
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        border: 1px solid var(--border-soft);
        background: var(--surface-2);
      }
      button.kpi {
        cursor: pointer;
        transition: border-color 0.15s var(--ease), background 0.15s var(--ease);
      }
      button.kpi:hover,
      button.kpi:focus-visible {
        border-color: var(--tone, var(--accent));
        background: var(--surface);
      }
      button.kpi:focus-visible {
        box-shadow: var(--focus);
      }
      .lbl {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--fs-xs);
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: var(--text-3);
      }
      .lbl i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--tone, transparent);
      }
      .lbl svg {
        width: 12px;
        height: 12px;
        margin-left: auto;
        color: var(--text-3);
      }
      .val {
        font-size: var(--fs-num);
        font-weight: 720;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        line-height: 1.3;
      }
      .note {
        font-size: var(--fs-xs);
        color: var(--text-3);
      }
      .val small {
        font-size: var(--fs-s);
        font-weight: 600;
        color: var(--text-2);
        margin-left: 2px;
      }
    `,
  ];

  render() {
    return html`<div class="grid">
      ${this.items.map((k) => {
        const tone = k.colorVar ? `--tone: var(${k.colorVar})` : '';
        const body = html`<div class="lbl"><i></i>${k.label}${k.point ? icon('map') : ''}</div>
          <div class="val">${k.value}<small>${k.unit}</small></div>${k.note ? html`<div class="note">${k.note}</div>` : ''}`;
        if (!k.point) return html`<div class="kpi" style=${tone}>${body}</div>`;
        const show = () => emit(this, 'sx-kpi-hover', k.point);
        const hide = () => emit(this, 'sx-kpi-hover', null);
        return html`<button class="kpi" style=${tone} title="${k.label} auf der Karte zeigen" @mouseenter=${show} @focus=${show} @mouseleave=${hide} @blur=${hide} @click=${show}>
          ${body}
        </button>`;
      })}
    </div>`;
  }
}
customElements.define('sx-kpis', SxKpis);
