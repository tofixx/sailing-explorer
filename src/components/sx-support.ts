import { LitElement, html, css, nothing } from 'lit';
import type { SupportLinks, SupportStatus } from '../services/api';
import { icon } from './icons';
import { base, emit } from './shared';

export type SupportVariant = 'offer' | 'required';

/**
 * „Kaffee/Bier ausgeben“ – reine Darstellung.
 * offer: dezentes Angebot (Teilen-Ergebnis, Konto); required: Karte statt Teilen-Formular, wenn das
 * kostenlose Kontingent ausgeschöpft ist. Die Links kommen fertig personalisiert vom Controller.
 */
export class SxSupport extends LitElement {
  static properties = {
    variant: { type: String },
    links: { attribute: false },
    status: { attribute: false },
    checking: { type: Boolean },
  };
  declare variant: SupportVariant;
  declare links: SupportLinks | null;
  declare status: SupportStatus | null;
  declare checking: boolean;

  constructor() {
    super();
    this.variant = 'offer';
    this.links = null;
    this.status = null;
    this.checking = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .card {
        display: grid;
        gap: var(--s-3);
        padding: var(--s-4);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface-2);
      }
      h3 {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        margin: 0;
        font-size: var(--fs-m);
      }
      h3 svg {
        color: var(--accent);
      }
      p {
        margin: 0;
        color: var(--text-2);
        font-size: var(--fs-s);
        line-height: 1.5;
      }
      .buttons {
        display: flex;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      .offer {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .offer > span {
        flex: 1;
        min-width: 14rem;
        display: flex;
        align-items: center;
        gap: var(--s-2);
      }
      .offer svg {
        width: 16px;
        height: 16px;
      }
      .thanks svg {
        color: var(--accent);
      }
      .check {
        border-top: 1px solid var(--border-soft);
        padding-top: var(--s-3);
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      .check p {
        flex: 1;
        min-width: 12rem;
      }
    `,
  ];

  private payButtons(cls: string) {
    const l = this.links;
    if (!l) return nothing;
    // Echte Links (neuer Tab), damit Tastatur, Mittelklick und Screenreader wie gewohnt funktionieren.
    return html`${l.coffee
      ? html`<a class=${cls} href=${l.coffee} target="_blank" rel="noopener" @click=${() => emit(this, 'sx-support-open', 'coffee')}>${icon('coffee')} Kaffee ausgeben</a>`
      : nothing}
    ${l.beer
      ? html`<a class=${cls} href=${l.beer} target="_blank" rel="noopener" @click=${() => emit(this, 'sx-support-open', 'beer')}>${icon('beer')} Bier ausgeben</a>`
      : nothing}`;
  }

  private required() {
    const s = this.status;
    const free = s ? (s.sharesFree === 1 ? 'einen Törn' : `${s.sharesFree} Törns`) : 'einige Törns';
    if (!this.links) {
      // Unterstützen ist nicht eingerichtet: verständlich ablehnen, Ausweg zeigen.
      return html`<div class="card" role="status">
        <h3>${icon('info')} Kostenloses Kontingent ausgeschöpft</h3>
        <p>Kostenlos kannst du ${free} speichern. Lösche einen älteren Törn, um Platz für diesen zu schaffen.</p>
        <div class="buttons"><button class="btn" @click=${() => emit(this, 'sx-account', 'shares')}>${icon('folder')} Konto &amp; Freigaben</button></div>
      </div>`;
    }
    return html`<div class="card" role="status">
      <h3>${icon('sail')} Für weitere Törns: einmal unterstützen</h3>
      <p>
        Kostenlos kannst du ${free} speichern – die sind belegt. Mit einem Kaffee oder Bier hilfst du, Server und Karten zu
        bezahlen, und kannst danach weitere Törns speichern. Alternativ löschst du einen älteren Törn.
      </p>
      <div class="buttons">${this.payButtons('btn primary')}</div>
      <div class="check">
        <p>Die Zahlung läuft über Stripe in einem neuen Tab. Danach hier prüfen:</p>
        <button class="btn" ?disabled=${this.checking} @click=${() => emit(this, 'sx-support-check')}>
          ${icon('check')} ${this.checking ? 'Prüfe …' : 'Ich habe unterstützt – prüfen'}
        </button>
      </div>
    </div>`;
  }

  private offer() {
    if (!this.links) return nothing;
    const supporter = !!this.status?.supporter;
    return html`<div class="offer ${supporter ? 'thanks' : ''}">
      <span>${supporter
        ? html`${icon('pennant')} Danke, dass du Sail Explorer unterstützt!`
        : html`${icon('sail')} Gefällt dir Sail Explorer? Spendier einen Kaffee oder ein Bier.`}</span>
      ${this.payButtons('btn small')}
    </div>`;
  }

  render() {
    return this.variant === 'required' ? this.required() : this.offer();
  }
}
customElements.define('sx-support', SxSupport);
