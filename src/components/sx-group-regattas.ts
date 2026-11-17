import { LitElement, html, css } from 'lit';
import type { GroupRegattas } from '../services/regatta-api';
import { placeText, resultDetails, roleShort } from '../domain/regatta';
import { fmtDate } from '../domain/format';
import { base, emit } from './shared';

/**
 * Regatta-Übersicht eines Vereins bzw. einer Klassenvereinigung (Konzept 42, F-650) – nur für Mitglieder. Je Regatta
 * die freigegebenen Ergebnisse der Mitglieder, nach Platz; keine Rangliste über Regatten hinweg (K6). Saison-Wahl
 * meldet `sx-group-regattas-season` { season }.
 */
export class SxGroupRegattas extends LitElement {
  static properties = {
    data: { attribute: false },
    seasons: { attribute: false },
    loading: { type: Boolean },
  };
  declare data: GroupRegattas | null;
  /** wählbare Saisons, neueste zuerst */
  declare seasons: number[];
  declare loading: boolean;

  constructor() {
    super();
    this.data = null;
    this.seasons = [];
    this.loading = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
        justify-content: space-between;
      }
      h2 {
        margin: 0;
      }
      select {
        min-height: 44px;
        max-width: 100%;
      }
      article {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: var(--s-2) var(--s-3);
        display: grid;
        gap: var(--s-1);
        min-width: 0;
      }
      h3 {
        margin: 0;
        font-size: var(--fs-m);
        overflow-wrap: anywhere;
      }
      .sub,
      .note {
        color: var(--text-2);
        font-size: var(--fs-s);
        margin: 0;
      }
      /* keine Nummern neben „Platz …“ – keine Rangliste (K6) */
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-1);
      }
      li {
        overflow-wrap: anywhere;
        min-height: 44px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0 var(--s-2);
      }
      li a {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
      }
      a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
    `,
  ];

  render() {
    const d = this.data;
    if (!d) return this.loading ? html`<p class="note">Lade …</p>` : '';
    const here = d.kind === 'class' ? 'in dieser Klassenvereinigung' : 'in diesem Verein';
    return html`
      <div class="head">
        <h2 class="eyebrow" id="reg-t">Regatten der Mitglieder</h2>
        ${this.seasons.length > 1
          ? html`<select aria-label="Saison der Regatten" .value=${String(d.season)} @change=${(e: Event) => emit(this, 'sx-group-regattas-season', { season: Number((e.target as HTMLSelectElement).value) })}>
              ${this.seasons.map((s) => html`<option value=${s} ?selected=${s === d.season}>Saison ${s}</option>`)}
            </select>`
          : html`<span class="sub">Saison ${d.season}</span>`}
      </div>
      ${d.regattas.length
        ? d.regattas.map(
            (r) => html`<article>
              <h3>${r.name}</h3>
              <p class="sub">${fmtDate(r.startedAt)}${r.organizer ? ` · ${r.organizer}` : ''}</p>
              <ul>
                ${r.results.map(
                  (x) => html`<li>
                    ${x.person.handle ? html`<a href="/u/${x.person.handle}">${x.person.name}</a>` : html`<span>${x.person.name}</span>`}
                    ${x.path ? html`<a href=${x.path}>${placeText(x.regatta) || 'Ergebnis'}</a>` : placeText(x.regatta) ? html`<span>${placeText(x.regatta)}</span>` : ''}
                    <span class="sub">${[resultDetails({ ...x.regatta, boatClass: x.regatta.boatClass ?? x.boatClass ?? undefined }), x.boat ?? '', roleShort(x.role)].filter(Boolean).join(' · ')}</span>
                  </li>`,
                )}
              </ul>
            </article>`,
          )
        : html`<p class="note">Noch keine Regatten in dieser Saison. Ein Ergebnis erscheint hier, wenn ein Mitglied seinen öffentlichen Fahrtenbuch-Eintrag mit Regatta-Angaben ${here} zeigt.</p>`}
      ${d.truncated ? html`<p class="note" role="status">Nur die neuesten Einträge sind geladen.</p>` : ''}
    `;
  }
}
customElements.define('sx-group-regattas', SxGroupRegattas);

declare global {
  interface HTMLElementTagNameMap {
    'sx-group-regattas': SxGroupRegattas;
  }
}
