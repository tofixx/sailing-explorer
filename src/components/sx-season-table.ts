import { LitElement, html, css } from 'lit';
import { rowsOfSeason, seasonSummaries, type SeasonRow, type SeasonTableMode } from '../domain/season-table';
import { placeText, resultDetails, roleShort } from '../domain/regatta';
import { fmtDate, fmtNum } from '../domain/format';
import { base, emit } from './shared';

/**
 * Jahresansicht der Fahrten und Regatten im Profil (Konzept 43, F-665 … F-669) – rein darstellend. Oben je Saison
 * Fahrten, Seemeilen (davon aufgezeichnet), Regatten und beste Platzierung; darunter die Fahrten der gewählten Saison.
 * Für sich selbst der Schalter „auch anderen zeigen“ (`sx-season-table-mode` { mode }), Saisonwahl intern.
 */
export class SxSeasonTable extends LitElement {
  static properties = {
    rows: { attribute: false },
    self: { type: Boolean },
    mode: { type: String },
    /** Profil ist privat – „anderen zeigen“ hätte keine Wirkung */
    profilePrivate: { type: Boolean, attribute: 'profile-private' },
    busy: { type: Boolean },
    truncated: { type: Boolean },
    season: { state: true },
  };
  declare rows: SeasonRow[];
  declare self: boolean;
  declare mode: SeasonTableMode;
  declare profilePrivate: boolean;
  declare busy: boolean;
  declare truncated: boolean;
  declare season: number | null;

  constructor() {
    super();
    this.rows = [];
    this.self = false;
    this.mode = 'private';
    this.profilePrivate = false;
    this.busy = false;
    this.truncated = false;
    this.season = null;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
      }
      .scroll {
        overflow-x: auto;
        max-width: 100%;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        font-size: var(--fs-s);
      }
      th,
      td {
        text-align: left;
        padding: var(--s-1) var(--s-2);
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      td.n,
      th.n {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      tbody tr.season {
        cursor: pointer;
      }
      tbody tr[aria-selected='true'] {
        background: var(--surface-2, transparent);
        font-weight: 600;
      }
      button.season {
        all: unset;
        cursor: pointer;
        color: var(--accent);
        font-weight: 600;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
      }
      button.season:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      .sub,
      .note {
        color: var(--text-2);
        font-size: var(--fs-s);
        margin: 0;
      }
      label.check {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        min-height: 44px;
      }
      h3 {
        margin: 0;
        font-size: var(--fs-m);
      }
    `,
  ];

  private chosen(seasons: number[]): number | null {
    return this.season !== null && seasons.includes(this.season) ? this.season : (seasons[0] ?? null);
  }

  private detail(season: number) {
    const rows = rowsOfSeason(this.rows, season);
    return html`<h3>Fahrten ${season}</h3>
      <div class="scroll" data-scroll-x>
        <table>
          <thead><tr><th scope="col">Datum</th><th scope="col">Fahrt</th><th scope="col" class="n">sm</th><th scope="col">Boot · Rolle</th><th scope="col">Regatta</th></tr></thead>
          <tbody>
            ${rows.map(
              (r) => html`<tr>
                <td class="n">${fmtDate(r.startedAt)}</td>
                <td>${r.path && r.title ? html`<a href=${r.path}>${r.title}</a>` : (r.title ?? 'Törn')}${r.own ? '' : html` <span class="sub">(Crew)</span>`}</td>
                <td class="n">${fmtNum(r.distNm, 1)}${r.recorded ? '' : html`<span class="sub" title="angegeben, nicht aufgezeichnet">*</span>`}</td>
                <td>${[r.boat ?? '', roleShort(r.role)].filter(Boolean).join(' · ') || '–'}</td>
                <td>${r.regatta ? html`${r.regatta.name}${placeText(r.regatta) ? html`<br /><span class="sub">${[placeText(r.regatta), resultDetails(r.regatta)].filter(Boolean).join(' · ')}</span>` : ''}` : ''}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <p class="note">* Strecke angegeben, nicht aufgezeichnet.</p>`;
  }

  render() {
    const sums = seasonSummaries(this.rows);
    const season = this.chosen(sums.map((s) => s.season));
    return html`
      ${this.self
        ? html`<label class="check"><input type="checkbox" .checked=${this.mode === 'public'} ?disabled=${this.busy}
              @change=${(e: Event) => emit(this, 'sx-season-table-mode', { mode: (e.target as HTMLInputElement).checked ? 'public' : 'private' })} />
            <span>Auch anderen auf meinem Profil zeigen – nur öffentliche Fahrten und Regatten</span></label>
            ${this.mode === 'public' && this.profilePrivate ? html`<p class="note">Dein Profil ist nicht öffentlich – andere sehen die Ansicht erst, wenn sie dein Profil sehen dürfen.</p>` : ''}
            ${this.mode === 'private' ? html`<p class="note">Nur du siehst diese Ansicht – mit allen Fahrten aus deinem Fahrtenbuch.</p>` : ''}`
        : ''}
      ${sums.length
        ? html`<div class="scroll" data-scroll-x>
              <table>
                <thead><tr><th scope="col">Saison</th><th scope="col" class="n">Fahrten</th><th scope="col" class="n">sm</th><th scope="col" class="n">davon aufgez.</th><th scope="col" class="n">Regatten</th><th scope="col" class="n">bester Platz</th></tr></thead>
                <tbody>
                  ${sums.map(
                    (s) => html`<tr aria-selected=${s.season === season ? 'true' : 'false'}>
                      <th scope="row"><button class="season" aria-pressed=${s.season === season ? 'true' : 'false'} @click=${() => (this.season = s.season)}>${s.season}</button></th>
                      <td class="n">${s.voyages}</td>
                      <td class="n">${fmtNum(s.nm, 1)}</td>
                      <td class="n">${fmtNum(s.recordedNm, 1)}</td>
                      <td class="n">${s.regattas || '–'}</td>
                      <td class="n">${s.bestPlace ?? '–'}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>
            ${season !== null ? this.detail(season) : ''}`
        : html`<p class="note">${this.self ? 'Noch keine Fahrten im Fahrtenbuch.' : 'Noch keine öffentlichen Fahrten.'}</p>`}
      ${this.truncated ? html`<p class="note" role="status">Nur die neuesten Fahrten sind geladen.</p>` : ''}
    `;
  }
}
customElements.define('sx-season-table', SxSeasonTable);

declare global {
  interface HTMLElementTagNameMap {
    'sx-season-table': SxSeasonTable;
  }
}
