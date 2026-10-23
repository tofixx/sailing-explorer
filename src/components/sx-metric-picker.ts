import { LitElement, css, html } from 'lit';
import { METRICS, METRIC_KEYS, RAMP_CSS, type Range } from '../domain/metrics';
import type { MetricKey } from '../domain/types';
import type { Layers } from '../services/store';
import { fmtNum } from '../util/html';
import { icon, type IconName } from './icons';
import { base, emit } from './shared';

const METRIC_ICONS: Record<MetricKey, IconName> = { speed: 'gauge', wind: 'wind', gust: 'gust', wave: 'waves' };

const LAYER_LABELS: Array<[keyof Layers, string, string]> = [
  ['seamarks', 'Seezeichen', 'OpenSeaMap'],
  ['depth', 'Wassertiefe', 'EMODnet'],
  ['windArrows', 'Windfähnchen', 'entlang des Tracks'],
  ['waveArrows', 'Wellenpfeile', 'entlang des Tracks'],
];

/** Wahl der Einfärbung, Farblegende und Kartenebenen. */
export class SxMetricPicker extends LitElement {
  static properties = {
    metric: { type: String },
    range: { attribute: false },
    layers: { attribute: false },
    available: { attribute: false },
  };
  declare metric: MetricKey;
  declare range: Range | null;
  declare layers: Layers;
  declare available: Record<MetricKey, boolean>;

  constructor() {
    super();
    this.metric = 'speed';
    this.range = null;
    this.layers = { seamarks: true, depth: false, windArrows: true, waveArrows: true };
    this.available = { speed: true, wind: false, gust: false, wave: false };
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .seg {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 2px;
        padding: 3px;
        border-radius: var(--radius);
        background: var(--surface-2);
        border: 1px solid var(--border-soft);
      }
      .seg button {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 6px 2px;
        border: 0;
        border-radius: var(--radius-s);
        background: transparent;
        color: var(--text-2);
        font: 600 var(--fs-xs) var(--font);
        cursor: pointer;
      }
      .seg button svg {
        width: 18px;
        height: 18px;
      }
      .seg button:hover:not([disabled]) {
        color: var(--text);
      }
      .seg button[aria-checked='true'] {
        background: var(--surface);
        color: var(--tone);
        box-shadow: var(--shadow-1);
      }
      .seg button[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .legend {
        margin-top: var(--s-3);
      }
      .bar {
        height: 10px;
        border-radius: 5px;
      }
      .scale {
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
        font-size: var(--fs-xs);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }
      .layers {
        margin-top: var(--s-4);
        display: grid;
        gap: 2px;
      }
      label.row {
        display: flex;
        align-items: center;
        gap: var(--s-3);
        min-height: var(--control-h);
        padding: var(--s-1);
        border-radius: var(--radius-s);
        cursor: pointer;
        font-size: var(--fs-m);
      }
      label.row:hover {
        background: var(--surface-2);
      }
      label.row small {
        color: var(--text-3);
        font-size: var(--fs-s);
      }
      label.row .t {
        flex: 1;
      }
      label.row.off {
        opacity: 0.5;
        cursor: not-allowed;
      }
      /* Schalter */
      input[type='checkbox'] {
        appearance: none;
        width: 34px;
        height: 20px;
        border-radius: 999px;
        background: var(--border);
        position: relative;
        cursor: pointer;
        transition: background 0.15s var(--ease);
        flex: none;
        margin: 0;
      }
      input[type='checkbox']::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--surface);
        box-shadow: var(--shadow-1);
        transition: transform 0.15s var(--ease);
      }
      input[type='checkbox']:checked {
        background: var(--accent);
      }
      input[type='checkbox']:checked::after {
        transform: translateX(14px);
      }
      input[type='checkbox']:focus-visible {
        outline: none;
        box-shadow: var(--focus);
      }
    `,
  ];

  private select(m: MetricKey) {
    if (m !== this.metric && this.available[m]) emit(this, 'sx-metric', m);
  }

  /** Pfeiltasten wie bei einer Radiogruppe. */
  private onKey(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const keys = METRIC_KEYS.filter((k) => this.available[k]);
    const i = keys.indexOf(this.metric);
    const next = keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
    this.select(next);
    e.preventDefault();
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('[aria-checked=true]')?.focus());
  }

  render() {
    const m = METRICS[this.metric];
    const f = (v: number) => fmtNum(v, m.decimals);
    // Pfeile entlang des Tracks brauchen Wetterdaten
    const needs: Partial<Record<keyof Layers, MetricKey>> = { windArrows: 'wind', waveArrows: 'wave' };
    return html`
      <div class="seg" role="radiogroup" aria-label="Track einfärben nach" @keydown=${this.onKey}>
        ${METRIC_KEYS.map((k) => {
          const d = METRICS[k];
          const on = k === this.metric;
          return html`<button
            role="radio"
            aria-checked=${on}
            tabindex=${on ? 0 : -1}
            ?disabled=${!this.available[k]}
            title=${this.available[k] ? d.label : `${d.label}: keine Daten`}
            style="--tone: var(${d.colorVar})"
            @click=${() => this.select(k)}
          >
            ${icon(METRIC_ICONS[k])}${d.short}
          </button>`;
        })}
      </div>
      <div class="legend" role="img" aria-label="Farblegende ${m.label}: ${this.range ? `${f(this.range.lo)} bis ${f(this.range.hi)} ${m.unit}` : 'keine Daten'}">
        <div class="bar" style="background:${RAMP_CSS}"></div>
        <div class="scale">
          <span>${this.range ? f(this.range.lo) : '–'}</span>
          <span>${m.label} (${m.unit})</span>
          <span>${this.range ? f(this.range.hi) : '–'}</span>
        </div>
      </div>
      <div class="layers">
        ${LAYER_LABELS.map(([key, label, hint]) => {
          const off = !!needs[key] && !this.available[needs[key]!];
          return html`<label class="row ${off ? 'off' : ''}" title=${off ? 'Keine Wetterdaten für diesen Track' : ''}>
            <span class="t">${label} <small>${hint}</small></span>
            <input
              type="checkbox"
              role="switch"
              ?disabled=${off}
              .checked=${this.layers[key] && !off}
              @change=${(e: Event) => emit(this, 'sx-layers', { ...this.layers, [key]: (e.target as HTMLInputElement).checked })}
            />
          </label>`;
        })}
      </div>
    `;
  }
}
customElements.define('sx-metric-picker', SxMetricPicker);
