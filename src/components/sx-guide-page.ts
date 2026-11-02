import { LitElement, css, html } from 'lit';
import { RECORDING_GUIDE, type Guide, type GuideSection, type GuideWay } from '../content/recording-guide';
import { icon } from './icons';
import { base } from './shared';

/**
 * Anleitung „So zeichnest du deinen Törn auf“ (Konzept 25, F-450) aus src/content/recording-guide.ts – wie
 * sx-legal-page ohne Backend. Abschnitte sind aufklappbare Gruppen (`<details>`), die Seite scrollt als Ganzes.
 */
export class SxGuidePage extends LitElement {
  static properties = {
    guide: { attribute: false },
  };
  /** Inhalt (Standard: RECORDING_GUIDE) – für Tests austauschbar */
  declare guide: Guide;

  constructor() {
    super();
    this.guide = RECORDING_GUIDE;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        overflow-y: auto;
        background: var(--bg);
      }
      article {
        max-width: 760px;
        margin: 0 auto;
        padding: var(--s-5) var(--s-4) var(--s-6);
        line-height: 1.55;
      }
      h1 {
        margin: 0 0 var(--s-2);
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
      }
      .lead {
        margin: 0 0 var(--s-4);
        color: var(--text-2);
      }
      details {
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
        background: var(--surface);
        margin-bottom: var(--s-3);
      }
      summary {
        list-style: none;
        cursor: pointer;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0 var(--s-2);
        align-items: center;
        min-height: 44px;
        padding: var(--s-3) var(--s-4);
      }
      summary::-webkit-details-marker {
        display: none;
      }
      summary h2 {
        margin: 0;
        font-size: var(--fs-l);
      }
      summary small {
        grid-column: 1;
        color: var(--text-3);
        font-size: var(--fs-s);
      }
      summary svg {
        grid-row: 1 / span 2;
        grid-column: 2;
        color: var(--text-3);
        transform: rotate(90deg);
      }
      details[open] summary svg {
        transform: rotate(-90deg);
      }
      .body {
        padding: 0 var(--s-4) var(--s-4);
      }
      .body > p {
        margin: 0 0 var(--s-3);
        color: var(--text-2);
      }
      .way + .way {
        margin-top: var(--s-4);
        padding-top: var(--s-3);
        border-top: 1px solid var(--border-soft);
      }
      h3 {
        margin: 0;
        font-size: var(--fs-m);
      }
      .meta {
        margin: 0;
        font-size: var(--fs-s);
        color: var(--text-3);
      }
      ol,
      ul {
        margin: var(--s-2) 0 0;
        padding-left: var(--s-5);
        color: var(--text-2);
        overflow-wrap: anywhere;
      }
      li + li {
        margin-top: var(--s-1);
      }
      .note {
        margin: var(--s-2) 0 0;
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        background: var(--warn-bg);
        font-size: var(--fs-s);
      }
      .src {
        margin: var(--s-2) 0 0;
        font-size: var(--fs-s);
      }
      .tips {
        margin-top: var(--s-4);
      }
      .updated {
        color: var(--text-3);
        font-size: var(--fs-s);
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        margin-top: var(--s-4);
      }
    `,
  ];

  private way(w: GuideWay) {
    return html`<div class="way">
      <h3>${w.title}</h3>
      ${w.meta ? html`<p class="meta">${w.meta}</p>` : ''}
      <ol>${w.steps.map((s) => html`<li>${s}</li>`)}</ol>
      ${w.note ? html`<p class="note">${w.note}</p>` : ''}
      ${w.link ? html`<p class="src"><a href=${w.link.href} target="_blank" rel="noopener">${w.link.text}</a></p>` : ''}
    </div>`;
  }

  private section(s: GuideSection) {
    return html`<details id=${s.id} ?open=${!!s.open}>
      <summary><h2>${s.title}</h2><small>${s.summary}</small>${icon('right')}</summary>
      <div class="body">
        ${s.intro ? html`<p>${s.intro}</p>` : ''} ${(s.ways ?? []).map((w) => this.way(w))}
        ${s.tips?.length ? html`<div class="tips"><h3>Tipps</h3><ul>${s.tips.map((t) => html`<li>${t}</li>`)}</ul></div>` : ''}
      </div>
    </details>`;
  }

  render() {
    const g = this.guide;
    return html`<article aria-labelledby="t">
      <h1 id="t">${g.title}</h1>
      <p class="lead">${g.lead}</p>
      ${g.sections.map((s) => this.section(s))}
      <p class="updated">Stand der App-Angaben: ${g.updated}</p>
      <nav aria-label="Weiter">
        <a class="btn primary" href="/">${icon('map')} Zur Startseite</a>
      </nav>
    </article>`;
  }
}
customElements.define('sx-guide-page', SxGuidePage);
