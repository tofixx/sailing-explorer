import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import type { SupportStatus } from '../services/api';
import { formatEuro, seasonOf, type SupportTier } from '../domain/support';
import { fmtMB } from '../util/html';
import { limitsFor } from '../domain/limits';
import { icon } from './icons';
import { base, emit } from './shared';

export type SupportVariant = 'offer' | 'required';


/**
 * „Unterstützen“ – reine Darstellung.
 * Ein Slider wählt eine der festen Stufen (Kaffee … Skipper-Dank), der Knopf meldet
 * `sx-support-checkout` mit `{ amount }` (Cent); die Bezahlseite öffnet der Controller.
 * offer: dezentes Angebot (Teilen-Ergebnis, Konto); required: Karte statt Teilen-Formular, wenn das
 * kostenlose Kontingent ausgeschöpft ist. tiers = null heißt: Unterstützen ist nicht eingerichtet.
 */
export class SxSupport extends LitElement {
  static properties = {
    variant: { type: String },
    tiers: { attribute: false },
    status: { attribute: false },
    checking: { type: Boolean },
    busy: { type: Boolean },
    index: { state: true },
    expanded: { state: true },
  };
  declare variant: SupportVariant;
  declare tiers: SupportTier[] | null;
  declare status: SupportStatus | null;
  declare checking: boolean;
  /** Checkout wird angelegt – Knopf gesperrt, bis die Bezahlseite lädt */
  declare busy: boolean;
  /** gewählte Stufe (Index in tiers) */
  declare index: number;
  /** Unterstützer: Slider zum Verlängern aufgeklappt */
  declare expanded: boolean;

  constructor() {
    super();
    this.variant = 'offer';
    this.tiers = null;
    this.status = null;
    this.checking = false;
    this.busy = false;
    this.index = 1;
    this.expanded = false;
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
        display: grid;
        gap: var(--s-3);
      }
      .line {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .line > span {
        flex: 1;
        min-width: 14rem;
        display: flex;
        align-items: center;
        gap: var(--s-2);
      }
      .line svg {
        width: 16px;
        height: 16px;
      }
      .thanks svg {
        color: var(--accent);
      }
      .picker {
        display: grid;
        gap: var(--s-2);
      }
      .current {
        display: flex;
        align-items: center;
        gap: var(--s-3);
        min-height: 44px;
      }
      .current svg {
        width: 36px;
        height: 36px;
        flex: none;
        color: var(--accent);
      }
      .current b {
        font-size: var(--fs-m);
      }
      .current .amount {
        margin-left: auto;
        font-size: var(--fs-l);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--text);
      }
      input[type='range'] {
        width: 100%;
        min-height: 40px;
        margin: 0;
        accent-color: var(--accent);
        background: transparent;
        cursor: pointer;
      }
      input[type='range']:focus-visible {
        outline: none;
        box-shadow: var(--focus);
        border-radius: var(--radius);
      }
      .ticks {
        display: flex;
        justify-content: space-between;
        padding: 0 2px;
        margin-top: calc(-1 * var(--s-2));
      }
      .ticks span {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        color: var(--text-3);
        cursor: pointer;
      }
      .ticks span.on {
        color: var(--accent);
        background: var(--accent-soft);
      }
      .ticks svg {
        width: 18px;
        height: 18px;
      }
      .terms {
        margin: 0;
        padding-left: var(--s-4);
        color: var(--text-2);
        font-size: var(--fs-s);
        line-height: 1.5;
        display: grid;
        gap: var(--s-1);
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

  willUpdate(changed: PropertyValues<this>) {
    // Index bleibt gültig, auch wenn sich die Stufen ändern
    if (changed.has('tiers') || changed.has('index')) {
      const n = this.tiers?.length ?? 0;
      this.index = n ? Math.max(0, Math.min(this.index, n - 1)) : 0;
    }
  }

  private get tier(): SupportTier | null {
    return this.tiers?.[this.index] ?? null;
  }

  private select(i: number) {
    this.index = i;
  }

  private checkout() {
    const t = this.tier;
    if (t && !this.busy) emit(this, 'sx-support-checkout', { amount: t.amount });
  }

  /** Was die Unterstützung bringt – kurz und ehrlich. */
  private terms() {
    const sup = this.status?.limits?.supporter ?? limitsFor('supporter');
    const season = seasonOf(Date.now());
    return html`<ul class="terms">
      <li>Eine Unterstützung gilt für die Saison ${season} (bis 31.12.) – ab November schon für die nächste; jede weitere Zahlung hängt eine Saison an.</li>
      <li>Törns bleiben für ihre Saison gespeichert und werden Ende Januar danach gelöscht – mit Unterstützung nimmst du sie in die nächste Saison mit.</li>
      <li>
        Als Unterstützer speicherst du
        bis zu ${sup.shares.toLocaleString('de-DE')} Törns, ${fmtMB(sup.bytes)} Speicher und ${sup.boats.toLocaleString('de-DE')} Boote.
      </li>
    </ul>`;
  }

  private picker() {
    const tiers = this.tiers;
    const t = this.tier;
    if (!tiers?.length || !t) return nothing;
    const amount = formatEuro(t.amount);
    return html`<div class="picker">
      <label class="label" for="amount">Wie viel möchtest du ausgeben?</label>
      <output class="current" for="amount" aria-hidden="true">
        ${icon(t.icon)}<b>${t.label}</b><span class="amount">${amount}</span>
      </output>
      <input
        id="amount"
        type="range"
        min="0"
        max=${tiers.length - 1}
        step="1"
        .value=${String(this.index)}
        aria-valuetext=${`${t.label}, ${amount}`}
        @input=${(e: Event) => this.select(Number((e.target as HTMLInputElement).value))}
      />
      <div class="ticks" aria-hidden="true">
        ${tiers.map(
          (x, i) => html`<span class=${i === this.index ? 'on' : ''} title=${`${x.label} · ${formatEuro(x.amount)}`} @click=${() => this.select(i)}
            >${icon(x.icon)}</span
          >`,
        )}
      </div>
      <div class="buttons">
        <button class="btn primary" ?disabled=${this.busy} @click=${this.checkout}>
          ${icon(t.icon)} ${this.busy ? 'Bezahlseite wird geöffnet …' : `Jetzt unterstützen (${amount})`}
        </button>
      </div>
      <p>Bezahlt wird über Stripe. Danach kommst du automatisch hierher zurück.</p>
    </div>`;
  }

  private required() {
    const s = this.status;
    const free = s ? (s.sharesFree === 1 ? 'einen Törn' : `${s.sharesFree} Törns`) : 'einige Törns';
    if (!this.tiers?.length) {
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
        Kostenlos kannst du ${free} speichern – die sind belegt. Mit deiner Unterstützung hilfst du, Server und Karten zu
        bezahlen, und kannst danach weitere Törns speichern. Alternativ löschst du einen älteren Törn.
      </p>
      ${this.picker()} ${this.terms()}
      <div class="check">
        <p>Schon bezahlt, aber noch gesperrt? Die Bestätigung kann ein paar Sekunden dauern.</p>
        <button class="btn" ?disabled=${this.checking} @click=${() => emit(this, 'sx-support-check')}>
          ${icon('check')} ${this.checking ? 'Prüfe …' : 'Status prüfen'}
        </button>
      </div>
    </div>`;
  }

  private offer() {
    if (!this.tiers?.length) return nothing;
    const supporter = !!this.status?.supporter;
    const open = !supporter || this.expanded;
    return html`<div class="offer">
      <div class="line ${supporter ? 'thanks' : ''}">
        <span>${supporter
          ? html`${icon('pennant')} Danke, dass du Sail Explorer unterstützt!`
          : html`${icon('sail')} Gefällt dir Sail Explorer? Gib eine Runde aus – und speichere mehr Törns länger.`}</span>
        ${supporter
          ? html`<button class="btn small" aria-expanded=${open} @click=${() => (this.expanded = !this.expanded)}>
              ${icon(open ? 'x' : 'coffee')} ${open ? 'Schließen' : 'Verlängern'}
            </button>`
          : nothing}
      </div>
      ${open ? html`${this.picker()} ${this.terms()}` : nothing}
    </div>`;
  }

  render() {
    return this.variant === 'required' ? this.required() : this.offer();
  }
}
customElements.define('sx-support', SxSupport);
