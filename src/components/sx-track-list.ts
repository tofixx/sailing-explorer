import { LitElement, css, html } from 'lit';
import type { Track } from '../domain/types';
import { fmtDuration, fmtNum, fmtShort, plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/** Geladene Tracks: ein-/ausblenden, entfernen. */
export class SxTrackList extends LitElement {
  static properties = { tracks: { attribute: false }, readonly: { type: Boolean } };
  declare tracks: Track[];
  declare readonly: boolean;

  constructor() {
    super();
    this.tracks = [];
    this.readonly = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px;
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--s-3);
        padding: var(--s-2);
        border-radius: var(--radius);
      }
      li:hover {
        background: var(--surface-2);
      }
      li.hidden .meta,
      li.hidden .sw {
        opacity: 0.45;
      }
      .sw {
        width: 12px;
        height: 32px;
        border-radius: var(--radius-s);
        flex: none;
      }
      .meta {
        flex: 1;
        min-width: 0;
      }
      .name {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub {
        font-size: var(--fs-s);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }
      .glitch {
        color: var(--warn);
      }
    `,
  ];

  render() {
    return html`<ul>
      ${this.tracks.map((t) => {
        const s = t.stats;
        const dur = s.start != null && s.end != null ? `${fmtDuration((s.end - s.start) / 3_600_000)} h` : null;
        return html`<li class=${t.hidden ? 'hidden' : ''}>
          <span class="sw" style="background:var(${t.color})"></span>
          <div class="meta">
            <div class="name" title=${t.name}>${t.name}</div>
            <div class="sub">${fmtNum(s.distNm, 1)} sm${dur ? ` · ${dur}` : ''} · ${plural(s.nPts, 'Punkt', 'Punkte')}</div>
            <div class="sub">
              ${s.start != null ? `${fmtShort(s.start)} → ${s.end != null ? fmtShort(s.end) : '?'}` : 'ohne Zeitstempel'}
              ${s.nGlitch ? html` · <span class="glitch" title="Als GPS-Ausreißer erkannt und aus der Statistik entfernt">${s.nGlitch} Ausreißer</span>` : ''}
            </div>
          </div>
          <button class="btn ghost small icon" title=${t.hidden ? 'Einblenden' : 'Ausblenden'} aria-label="${t.hidden ? 'Einblenden' : 'Ausblenden'}: ${t.name}" aria-pressed=${!t.hidden} @click=${() => emit(this, 'sx-track-toggle', t.id)}>
            ${icon(t.hidden ? 'eyeOff' : 'eye')}
          </button>
          ${this.readonly
            ? ''
            : html`<button class="btn ghost small icon" title="Entfernen" aria-label="Entfernen: ${t.name}" @click=${() => emit(this, 'sx-track-remove', t.id)}>${icon('x')}</button>`}
        </li>`;
      })}
    </ul>`;
  }
}
customElements.define('sx-track-list', SxTrackList);
