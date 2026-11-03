import { LitElement, css, html } from 'lit';
import { badgeCaption, badgeText, type SeasonBadge } from '../domain/season-review';
import { fmtNum } from '../domain/format';
import { base } from './shared';

/**
 * Abzeichen-Reihe der Saison (Konzept 33.3, F-521): erreichte hervorgehoben, das nächste mit „noch … sm“ und
 * Fortschritt, die übrigen gedämpft. Rein präsentational; die Reihe bricht um statt seitlich zu scrollen.
 */
export class SxSeasonBadges extends LitElement {
  static properties = { badges: { attribute: false } };
  declare badges: SeasonBadge[];

  constructor() {
    super();
    this.badges = [];
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
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2) var(--s-4);
      }
      li {
        display: grid;
        justify-items: center;
        gap: var(--s-1);
        min-width: 0;
        width: 84px;
        text-align: center;
      }
      .ring {
        --p: 0;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: conic-gradient(var(--accent) calc(var(--p) * 1turn), var(--border-soft) 0);
        line-height: 1;
      }
      .ring b {
        width: 46px;
        height: 46px;
        border-radius: 50%;
        display: grid;
        place-content: center;
        background: var(--surface);
        font-size: var(--fs-s);
        font-variant-numeric: tabular-nums;
      }
      .ring small {
        font-size: 11px;
        font-weight: 600;
      }
      .reached .ring b {
        background: var(--accent);
        color: var(--on-accent);
      }
      .later {
        color: var(--text-3);
      }
      .caption {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .reached .caption {
        color: var(--accent);
        font-weight: 600;
      }
    `,
  ];

  render() {
    return html`<ul aria-label="Abzeichen der Saison">
      ${this.badges.map(
        (b) => html`<li class=${b.reached ? 'reached' : b.next ? 'next' : 'later'}>
          <span class="sr-only">${badgeText(b)}</span>
          <span class="ring" style="--p: ${b.reached ? 1 : b.next ? b.progress : 0}" aria-hidden="true"><b>${fmtNum(b.nm, 0)}<small>sm</small></b></span>
          <span class="caption" aria-hidden="true">${badgeCaption(b) || ' '}</span>
        </li>`,
      )}
    </ul>`;
  }
}
customElements.define('sx-season-badges', SxSeasonBadges);
