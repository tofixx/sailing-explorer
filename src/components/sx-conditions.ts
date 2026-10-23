import { LitElement, css, html, svg } from 'lit';
import { beaufort, compassName } from '../domain/geo';
import type { Conditions } from '../domain/types';
import type { Status } from '../services/weather-api';
import { fmtNum } from '../util/html';
import { icon } from './icons';
import { base } from './shared';

/** Wind- und Wellenlage: Reise-Mittel oder der gerade gehoverte Zeitpunkt. */
export class SxConditions extends LitElement {
  static properties = {
    conditions: { attribute: false },
    status: { attribute: false },
  };
  declare conditions: Conditions | null;
  declare status: Status;

  constructor() {
    super();
    this.conditions = null;
    this.status = { level: 'idle', text: '' };
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
      .card {
        border: 1px solid var(--border-soft);
        background: var(--surface-2);
        border-radius: var(--radius);
        padding: var(--s-3);
        display: grid;
        gap: 2px;
        position: relative;
        overflow: hidden;
      }
      .card::before {
        content: '';
        position: absolute;
        inset: 0 auto 0 0;
        width: 3px;
        background: var(--tone);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--fs-s);
        font-weight: 600;
        color: var(--text-2);
      }
      .head svg {
        width: 15px;
        height: 15px;
        color: var(--tone);
      }
      .main {
        display: flex;
        align-items: baseline;
        gap: 4px;
        font-size: var(--fs-num-l);
        font-weight: 720;
        letter-spacing: -0.02em;
        line-height: 1.15;
        font-variant-numeric: tabular-nums;
      }
      .main small {
        font-size: var(--fs-s);
        font-weight: 600;
        color: var(--text-2);
      }
      .bft {
        margin-left: auto;
        align-self: center;
        font-size: var(--fs-xs);
        font-weight: 700;
        color: var(--tone);
        background: color-mix(in srgb, var(--tone) 14%, transparent);
        border-radius: 999px;
        padding: 1px 8px;
      }
      .sub {
        font-size: var(--fs-s);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }
      .dir {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        margin-top: var(--s-1);
        font-size: var(--fs-s);
        font-weight: 600;
      }
      .dir small {
        font-weight: 500;
        color: var(--text-3);
      }
      .status {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        margin-top: var(--s-3);
        font-size: var(--fs-s);
        color: var(--text-2);
        line-height: 1.45;
      }
      .status .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-top: 5px;
        flex: none;
        background: var(--text-3);
      }
      .status[data-level='ok'] .dot {
        background: var(--ok);
      }
      .status[data-level='warn'] .dot {
        background: var(--warn);
      }
      .status[data-level='err'] .dot {
        background: var(--err);
      }
      .status[data-level='loading'] .dot {
        background: var(--accent);
        animation: pulse 1s ease-in-out infinite alternate;
      }
      @keyframes pulse {
        to {
          opacity: 0.3;
        }
      }
    `,
  ];

  /** Pfeil zeigt in Bewegungsrichtung (Wind: Lee, Welle: Laufrichtung). */
  private compass(fromDeg: number) {
    const rot = (fromDeg + 180) % 360;
    return svg`<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15" fill="none" stroke="var(--border)" stroke-width="1.5"/>
      <text x="17" y="8" font-size="6.5" font-weight="700" text-anchor="middle" fill="var(--text-3)">N</text>
      <g transform="rotate(${rot} 17 17)" stroke="var(--tone)" fill="var(--tone)" stroke-width="2.6" stroke-linecap="round">
        <line x1="17" y1="26" x2="17" y2="11"/><path d="M17 7 L12.5 14 L21.5 14 Z" stroke-linejoin="round"/>
      </g></svg>`;
  }

  render() {
    const c = this.conditions;
    const n = (v: number | null | undefined, d: number) => (v != null ? fmtNum(v, d) : '–');
    return html`
      <div class="grid" role="group" aria-label="Wind und Wellen">
        <div class="card" style="--tone: var(--c-wind)">
          <div class="head">${icon('wind')} Wind</div>
          <div class="main">${n(c?.wind, 0)} <small>kn</small>${c?.wind != null ? html`<span class="bft">Bft ${beaufort(c.wind)}</span>` : ''}</div>
          <div class="sub">Böen ${c?.gust != null ? html`${n(c.gust, 0)} kn` : '–'}</div>
          <div class="dir">
            ${c?.dir != null ? html`${this.compass(c.dir)}<span>aus ${compassName(c.dir)} <small>${Math.round(c.dir)}°</small></span>` : html`<span class="faint">Richtung –</span>`}
          </div>
        </div>
        <div class="card" style="--tone: var(--c-wave)">
          <div class="head">${icon('waves')} Wellen</div>
          <div class="main">${n(c?.wave, 1)} <small>m</small></div>
          <div class="sub">Periode ${c?.wper != null ? html`${n(c.wper, 0)} s` : '–'}</div>
          <div class="dir">
            ${c?.wdir != null ? html`${this.compass(c.wdir)}<span>aus ${compassName(c.wdir)} <small>${Math.round(c.wdir)}°</small></span>` : html`<span class="faint">Richtung –</span>`}
          </div>
        </div>
      </div>
      ${this.status.text
        ? html`<div class="status" data-level=${this.status.level} role="status"><span class="dot"></span><span>${this.status.text}</span></div>`
        : ''}
    `;
  }
}
customElements.define('sx-conditions', SxConditions);
