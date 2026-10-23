import { LitElement, css, html } from 'lit';
import { base } from './shared';

/** Abschnitt der Seitenleiste mit Überschrift und optionalem Zusatz rechts. */
export class SxPanel extends LitElement {
  static properties = { heading: { type: String } };
  declare heading: string;

  constructor() {
    super();
    this.heading = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        padding: var(--s-4) var(--s-4) var(--s-5);
        border-bottom: 1px solid var(--border-soft);
      }
      header {
        display: flex;
        align-items: baseline;
        gap: var(--s-2);
        margin-bottom: var(--s-3);
      }
      .aside {
        margin-left: auto;
        font-size: var(--fs-s);
        color: var(--text-2);
        min-width: 0;
        text-align: right;
      }
    `,
  ];

  render() {
    return html`
      <header><h2 class="eyebrow">${this.heading}</h2><div class="aside"><slot name="aside"></slot></div></header>
      <slot></slot>
    `;
  }
}
customElements.define('sx-panel', SxPanel);
