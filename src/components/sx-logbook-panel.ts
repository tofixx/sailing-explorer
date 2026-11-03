import { LitElement, css, html } from 'lit';
import type { ShareMeta } from '../services/api';
import { DIST_SOURCE_LABEL, LOG_AREA_LABEL, SEA_LABEL, hasLog } from '../domain/logbook';
import { fmtDate, fmtDateTime, fmtNum } from '../domain/format';
import { icon } from './icons';
import { base, emit, logbookTag } from './shared';

/**
 * Fahrtenbuch-Angaben eines Törns (Konzept 19, F-301/F-302): Von → Nach, Abfahrt/Ankunft, Strecke mit Herkunft und die
 * befüllten Felder samt Zusatzangaben (Konzept 27.4, F-412). Die Eigentümer:in bekommt immer „Bearbeiten“
 * (`sx-logbook-edit`) – bei GPX-Törns für Häfen und Angaben (F-461). Für andere leer, wenn es weder Häfen noch Angaben gibt.
 */
export class SxLogbookPanel extends LitElement {
  static properties = { share: { attribute: false } };
  declare share: ShareMeta | null;

  constructor() {
    super();
    this.share = null;
  }

  /** Gibt es etwas zu zeigen? (für das Ein-/Ausblenden des Panels) */
  static shows(s: ShareMeta | null): boolean {
    return !!s && (s.source === 'manual' || s.isOwner || !!s.from || !!s.to || hasLog(s.log ?? {}));
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      dl {
        margin: 0;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--s-1) var(--s-3);
        font-size: var(--fs-s);
      }
      dt {
        color: var(--text-3);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .notes {
        white-space: pre-line;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s-2);
        margin-bottom: var(--s-2);
      }
    `,
  ];

  private when(t: number, timed: boolean) {
    return timed ? fmtDateTime(t) : fmtDate(t);
  }

  render() {
    const s = this.share;
    if (!SxLogbookPanel.shows(s)) return '';
    const log = s!.log ?? {};
    const timed = !!log.timed;
    const manual = s!.source === 'manual';
    const harbor = (h: ShareMeta['from']) => (h ? html`<a href="/h/${h.slug}">${h.name}</a>` : '–');
    const round = !!s!.from && s!.from.slug === s!.to?.slug;
    return html`
      ${!hasLog(log) && !manual && !s!.from && !s!.to ? html`<p class="faint">Noch keine Fahrtenbuch-Angaben – Häfen, Stunden unter Segel, Revier und Posten ergänzen.</p>` : ''}
      ${manual || s!.isOwner
        ? html`<div class="top">
            ${manual ? logbookTag() : html`<span></span>`}
            ${s!.isOwner ? html`<button class="btn small" @click=${() => emit(this, 'sx-logbook-edit', s)}>${icon('pencil')} Bearbeiten</button>` : ''}
          </div>`
        : ''}
      <dl>
        ${s!.from || s!.to ? html`<dt>${round ? 'Rundtörn ab' : 'Von → Nach'}</dt><dd>${round ? harbor(s!.from) : html`${harbor(s!.from)} → ${harbor(s!.to)}`}</dd>` : ''}
        ${manual && s!.startedAt ? html`<dt>Abfahrt</dt><dd>${this.when(s!.startedAt, timed)}</dd>` : ''}
        ${manual && s!.endedAt ? html`<dt>Ankunft</dt><dd>${this.when(s!.endedAt, timed)}</dd>` : ''}
        ${manual ? html`<dt>Strecke</dt><dd>${fmtNum(s!.distNm, 1)} sm <span class="faint">(${DIST_SOURCE_LABEL[s!.distSource ?? 'stated']})</span></dd>` : ''}
        ${log.wind ? html`<dt>Wind</dt><dd>${log.wind.bft} Bft${log.wind.dir ? ` ${log.wind.dir}` : ''} <span class="faint">(Fahrtenbuch)</span></dd>` : ''}
        ${log.sea ? html`<dt>Seegang</dt><dd>${SEA_LABEL[log.sea]}</dd>` : ''}
        ${log.area ? html`<dt>Revier</dt><dd>${LOG_AREA_LABEL[log.area]}${log.tidal ? ' · Tidengewässer' : ''}</dd>` : ''}
        ${log.sailH != null ? html`<dt>Unter Segel</dt><dd>${fmtNum(log.sailH, 1)} h</dd>` : ''}
        ${log.engineH != null ? html`<dt>Motor</dt><dd>${fmtNum(log.engineH, 1)} h</dd>` : ''}
        ${log.nightH != null ? html`<dt>Nachtfahrt</dt><dd>${fmtNum(log.nightH, 1)} h</dd>` : ''}
        ${log.daysAboard != null ? html`<dt>Tage an Bord</dt><dd>${log.daysAboard}</dd>` : ''}
        ${log.locks || log.bridges || log.mast
          ? html`<dt>Binnen</dt><dd>${[log.locks ? `${log.locks} Schleusen` : '', log.bridges ? `${log.bridges} Brücken` : '', log.mast ? `Mast ${log.mast}×` : ''].filter(Boolean).join(' · ')}</dd>`
          : ''}
        ${log.regatta
          ? html`<dt>Regatta</dt><dd>${log.regatta.name}${log.regatta.place ? ` – Platz ${log.regatta.place}${log.regatta.starters ? ` von ${log.regatta.starters}` : ''}` : ''}</dd>`
          : ''}
        ${(log.items ?? []).map((it) => html`<dt>${it.name}</dt><dd>${fmtNum(it.n, it.n % 1 ? 1 : 0)}${it.note ? html` <span class="faint">– ${it.note}</span>` : ''}</dd>`)}
        ${log.sails ? html`<dt>Segelführung</dt><dd>${log.sails}</dd>` : ''}
        ${log.berth ? html`<dt>Liegeplatz</dt><dd>${log.berth}</dd>` : ''}
        ${log.notes ? html`<dt>Notizen</dt><dd class="notes">${log.notes}</dd>` : ''}
      </dl>
    `;
  }
}
customElements.define('sx-logbook-panel', SxLogbookPanel);
