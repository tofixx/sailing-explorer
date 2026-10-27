import { LitElement, css, html } from 'lit';
import { LEGAL_PAGES, OPERATOR, operatorPlaceholders, type LegalBlock, type LegalSlug, type Operator } from '../content/legal';
import { icon } from './icons';
import { base } from './shared';

/**
 * Impressum bzw. Datenschutzerklärung (Konzept 12.7, F-183) aus src/content/legal.ts. Braucht kein Backend. Solange
 * die Betreiberangaben Platzhalter enthalten, steht oben ein deutlicher Warnhinweis.
 */
export class SxLegalPage extends LitElement {
  static properties = {
    page: { type: String },
    operator: { attribute: false },
  };
  declare page: LegalSlug;
  /** Betreiberangaben (Standard: OPERATOR) – für Tests austauschbar */
  declare operator: Operator;

  constructor() {
    super();
    this.page = 'impressum';
    this.operator = OPERATOR;
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
        line-height: 1.6;
      }
      h1 {
        margin: 0 0 var(--s-1);
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
      }
      .updated {
        color: var(--text-3);
        font-size: var(--fs-s);
        margin: 0 0 var(--s-5);
      }
      section {
        margin-bottom: var(--s-5);
      }
      h2 {
        margin: 0 0 var(--s-2);
        font-size: var(--fs-l);
      }
      h3 {
        margin: var(--s-3) 0 var(--s-1);
        font-size: var(--fs-m);
      }
      p,
      ul {
        margin: 0 0 var(--s-2);
        color: var(--text-2);
        overflow-wrap: anywhere;
      }
      ul {
        padding-left: var(--s-5);
      }
      .warn {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        padding: var(--s-3);
        margin-bottom: var(--s-5);
        border-radius: var(--radius);
        background: var(--warn-bg);
        border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
        color: var(--text);
      }
      .warn svg {
        color: var(--warn);
        flex: none;
        margin-top: 2px;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        margin-top: var(--s-5);
        padding-top: var(--s-4);
        border-top: 1px solid var(--border-soft);
      }
    `,
  ];

  private block(b: LegalBlock) {
    switch (b.kind) {
      case 'p':
        return html`<p>${b.text}</p>`;
      case 'h3':
        return html`<h3>${b.text}</h3>`;
      case 'ul':
        return html`<ul>${b.items.map((i) => html`<li>${i}</li>`)}</ul>`;
      case 'link':
        return html`<p><a href=${b.href}>${b.text}</a></p>`;
    }
  }

  render() {
    const page = LEGAL_PAGES[this.page]?.(this.operator) ?? LEGAL_PAGES.impressum(this.operator);
    const missing = operatorPlaceholders(this.operator);
    return html`<article aria-labelledby="t">
      ${missing.length
        ? html`<div class="warn" role="alert">${icon('info')}<span><b>Entwurf – noch nicht gültig.</b> Die Betreiberangaben enthalten noch Platzhalter (${missing.length}). Bitte in <code>src/content/legal.ts</code> (<code>OPERATOR</code>) ausfüllen und die Texte prüfen lassen.</span></div>`
        : ''}
      <h1 id="t">${page.title}</h1>
      <p class="updated">Stand: ${page.updated}</p>
      ${page.sections.map((s) => html`<section id=${s.id} aria-labelledby="h-${s.id}"><h2 id="h-${s.id}">${s.title}</h2>${s.blocks.map((b) => this.block(b))}</section>`)}
      <nav aria-label="Rechtliches">
        <a class="btn" href="/">${icon('map')} Zur Startseite</a>
        ${page.slug === 'impressum' ? html`<a class="btn" href="/datenschutz">${icon('lock')} Datenschutz</a>` : html`<a class="btn" href="/impressum">${icon('scale')} Impressum</a>`}
      </nav>
    </article>`;
  }
}
customElements.define('sx-legal-page', SxLegalPage);
