import { LitElement, css, html } from 'lit';
import type { Track } from '../domain/types';
import { fmtDuration, fmtNum, fmtShort, plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/** Datei-Name für den GPX-Export: Track-Name ohne Sonderzeichen. */
export function gpxFileName(name: string): string {
  const base = name.replace(/\.gpx$/i, '').replace(/[^\p{L}\p{N}._ -]+/gu, '').trim().replace(/\s+/g, '-');
  return `${base || 'track'}.gpx`;
}

/** Original-GPX eines Tracks als Datei herunterladen (F-227). */
function downloadGpx(t: Track): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t.raw], { type: 'application/gpx+xml' }));
  a.download = gpxFileName(t.name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * Geladene Tracks: ein-/ausblenden, als GPX herunterladen, entfernen. Die Zeile des im Verlauf bzw. auf der Karte
 * gehoverten Tracks ist hervorgehoben; Hovern über eine Zeile hebt den Track auf der Karte hervor (F-226).
 */
export class SxTrackList extends LitElement {
  static properties = { tracks: { attribute: false }, readonly: { type: Boolean }, focused: { type: String } };
  declare tracks: Track[];
  declare readonly: boolean;
  /** id des hervorgehobenen Tracks */
  declare focused: string | null;

  constructor() {
    super();
    this.tracks = [];
    this.readonly = false;
    this.focused = null;
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
      li:hover,
      li.focus {
        background: var(--surface-2);
      }
      li.focus .sw {
        box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
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
        const multi = this.tracks.length > 1;
        return html`<li
          class="${t.hidden ? 'hidden' : ''} ${multi && t.id === this.focused ? 'focus' : ''}"
          @mouseenter=${() => multi && !t.hidden && emit(this, 'sx-track-focus', t.id)}
          @mouseleave=${() => multi && emit(this, 'sx-track-focus', null)}
        >
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
          ${t.raw
            ? html`<button class="btn ghost small icon dl" title="Als GPX herunterladen" aria-label="Als GPX herunterladen: ${t.name}" @click=${() => downloadGpx(t)}>${icon('download')}</button>`
            : ''}
          ${this.readonly
            ? ''
            : html`<button class="btn ghost small icon" title="Entfernen" aria-label="Entfernen: ${t.name}" @click=${() => emit(this, 'sx-track-remove', t.id)}>${icon('x')}</button>`}
        </li>`;
      })}
    </ul>`;
  }
}
customElements.define('sx-track-list', SxTrackList);
