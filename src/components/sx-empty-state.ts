import { LitElement, css, html } from 'lit';
import { icon } from './icons';
import { base, emit, pickGpx } from './shared';

export interface Sample {
  file: string;
  label: string;
}

/**
 * Startseite über der Karte (Konzept 12.6, F-182). Mit Community (`community`): der Stream (Slot „feed“) ist der
 * Hauptbereich, „Track anlegen“ eine kompakte Karte in der Seitenspalte (dazu Slot „discover“), mobil ein runder Knopf
 * unten rechts. Ohne Community (kein Backend): die große Einstiegskarte wie bisher. Ziehen & Ablegen geht immer – beim
 * Ziehen erscheint eine Ablagefläche. Unten Impressum und Datenschutz.
 */
export class SxEmptyState extends LitElement {
  static properties = {
    samples: { attribute: false },
    dragging: { type: Boolean, reflect: true },
    trackCount: { type: Number },
    community: { type: Boolean, reflect: true },
  };
  declare samples: Sample[];
  declare dragging: boolean;
  /** > 0: Startseite über geladenen Tracks – mit Weg zurück zur Törn-Ansicht */
  declare trackCount: number;
  /** Community-Stream verfügbar: Stream groß, Hochladen im Hintergrund */
  declare community: boolean;

  constructor() {
    super();
    this.samples = [];
    this.dragging = false;
    this.trackCount = 0;
    this.community = false;
  }

  static styles = [
    base,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 800;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: var(--s-4);
        pointer-events: none;
      }
      ::slotted(*) {
        pointer-events: auto;
        width: 100%;
        min-width: 0;
      }
      .card,
      footer,
      .fab {
        pointer-events: auto;
      }

      /* ---------- mit Community: Stream als Hauptbereich ---------- */
      .layout {
        margin: 0 auto;
        width: min(1180px, 100%);
        display: grid;
        gap: var(--s-3);
        grid-template-columns: minmax(0, 1fr) 340px;
        align-items: start;
      }
      .feed,
      .side {
        min-width: 0;
        display: grid;
        gap: var(--s-3);
      }
      .side {
        position: sticky;
        top: 0;
      }
      @media (max-width: 960px) {
        .layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .side {
          position: static;
        }
      }

      /* ---------- Einstiegskarte (groß ohne Community, kompakt mit) ---------- */
      .solo {
        margin: auto;
        width: min(720px, 100%);
        display: grid;
        gap: var(--s-3);
        justify-items: center;
      }
      .card {
        width: 100%;
        background: var(--overlay);
        backdrop-filter: blur(10px) saturate(1.2);
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
        box-shadow: var(--shadow-2);
        padding: var(--s-6) var(--s-5) var(--s-5);
        text-align: center;
      }
      .solo .card {
        width: min(460px, 100%);
      }
      .badge {
        width: 56px;
        height: 56px;
        margin: 0 auto var(--s-3);
        border-radius: var(--radius-l);
        background: var(--accent-soft);
        color: var(--accent);
        display: grid;
        place-items: center;
      }
      .badge svg {
        width: 30px;
        height: 30px;
      }
      h1 {
        margin: 0 0 var(--s-2);
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
        line-height: 1.2;
      }
      p {
        margin: 0 auto var(--s-4);
        max-width: 36ch;
        color: var(--text-2);
      }
      .solo .btn.primary {
        min-height: max(44px, var(--control-h));
        padding: 0 var(--s-5);
        font-size: var(--fs-l);
      }
      .card.compact {
        text-align: left;
        padding: var(--s-4);
        box-shadow: var(--shadow-1);
      }
      .compact .top {
        display: flex;
        gap: var(--s-3);
        align-items: center;
        margin-bottom: var(--s-2);
      }
      .compact .badge {
        width: 40px;
        height: 40px;
        margin: 0;
        flex: none;
      }
      .compact .badge svg {
        width: 22px;
        height: 22px;
      }
      .compact h2 {
        margin: 0;
        font-size: var(--fs-l);
      }
      .compact p {
        margin: 0 0 var(--s-3);
        max-width: none;
        font-size: var(--fs-s);
      }
      .compact .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
      }
      .hint {
        margin-top: var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-3);
      }
      .hint .link {
        border: 0;
        padding: 0;
        background: none;
        color: var(--accent);
        font: inherit;
        cursor: pointer;
        text-decoration: underline;
      }
      .samples {
        margin-top: var(--s-4);
        padding-top: var(--s-3);
        border-top: 1px solid var(--border-soft);
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        justify-content: center;
        align-items: center;
        font-size: var(--fs-s);
      }
      .compact .samples {
        justify-content: flex-start;
        margin-top: var(--s-3);
      }
      .privacy {
        margin-top: var(--s-3);
        font-size: var(--fs-xs);
        color: var(--text-3);
        display: flex;
        gap: var(--s-1);
        justify-content: center;
        align-items: center;
      }
      .compact .privacy {
        justify-content: flex-start;
      }
      .privacy svg {
        width: 13px;
        height: 13px;
      }
      @media (pointer: coarse) {
        .drag-hint {
          display: none;
        }
      }

      /* ---------- Fußzeile ---------- */
      footer {
        margin: var(--s-4) auto 0;
        padding: var(--s-1) var(--s-3);
        border-radius: 999px;
        background: var(--overlay);
        font-size: var(--fs-xs);
        color: var(--text-3);
        display: flex;
        gap: var(--s-3);
      }
      footer a {
        color: var(--text-2);
      }

      /* ---------- mobil: runder Knopf „Track anlegen“ ---------- */
      .fab {
        display: none;
      }
      @media (max-width: 760px) {
        :host {
          padding: var(--s-2) var(--s-2) calc(var(--s-6) + 56px);
        }
        :host([community]) .side .card.compact {
          display: none;
        }
        :host([community]) .fab {
          position: fixed;
          right: var(--s-4);
          bottom: calc(var(--s-4) + env(safe-area-inset-bottom, 0px));
          z-index: 900;
          display: grid;
          place-items: center;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 0;
          background: var(--accent);
          color: var(--on-accent);
          box-shadow: var(--shadow-2);
          cursor: pointer;
        }
        .fab svg {
          width: 26px;
          height: 26px;
        }
        .fab:focus-visible {
          outline: none;
          box-shadow: var(--focus), var(--shadow-2);
        }
      }

      /* ---------- Ablagefläche beim Ziehen ---------- */
      .drop {
        position: fixed;
        inset: var(--s-3);
        z-index: 950;
        display: grid;
        place-items: center;
        border: 2px dashed var(--accent);
        border-radius: var(--radius-l);
        background: color-mix(in srgb, var(--accent-soft) 85%, transparent);
        color: var(--accent);
        font-size: var(--fs-xl);
        font-weight: 700;
        pointer-events: none;
      }
      .drop span {
        display: flex;
        gap: var(--s-2);
        align-items: center;
      }
      .drop svg {
        width: 32px;
        height: 32px;
      }
      :host([dragging]) .solo .card {
        border: 2px dashed var(--accent);
        transform: scale(1.02);
      }
      @media (prefers-reduced-motion: no-preference) {
        .solo .card {
          transition: transform 0.2s var(--ease), border-color 0.2s var(--ease);
        }
      }
    `,
  ];

  private samplesRow() {
    if (!this.samples.length) return '';
    return html`<div class="samples">
      <span class="faint">Beispiel ansehen:</span>
      ${this.samples.map((s) => html`<button class="btn small" @click=${() => emit(this, 'sx-sample', s.file)}>${s.label}</button>`)}
    </div>`;
  }

  private privacy() {
    return html`<div class="privacy">${icon('lock')} Dateien werden lokal im Browser ausgewertet.</div>`;
  }

  /** Große Einstiegskarte (ohne Community). */
  private bigCard() {
    return html`<section class="card" aria-labelledby="t">
      <div class="badge">${icon('map')}</div>
      <h1 id="t">Deinen Törn auf die Seekarte bringen</h1>
      <p>Lade eine oder mehrere GPX-Dateien. Der Track erscheint auf der OpenSeaMap – mit Speed, Wind und Wellen für genau diese Zeit.</p>
      ${this.trackCount
        ? html`<button class="btn primary" @click=${() => emit(this, 'sx-track-view')}>${icon('map')} Zurück zu deinem Törn</button>
            <div class="hint">${this.trackCount === 1 ? '1 Track geladen' : `${this.trackCount} Tracks geladen`} · <button class="link" @click=${() => pickGpx(this)}>weitere GPX hinzufügen</button></div>`
        : html`<button class="btn primary" @click=${() => pickGpx(this)}>${icon('upload')} GPX-Dateien wählen</button>
            <div class="hint drag-hint">oder einfach auf die Karte ziehen</div>`}
      ${this.samplesRow()} ${this.privacy()}
    </section>`;
  }

  /** Kompakte Karte „Track anlegen“ in der Seitenspalte (mit Community). */
  private compactCard() {
    return html`<section class="card compact" aria-labelledby="t">
      <div class="top">
        <div class="badge">${icon('map')}</div>
        <h2 id="t">${this.trackCount ? 'Dein Törn ist geladen' : 'Eigenen Törn anlegen'}</h2>
      </div>
      <p>GPX-Datei laden: Track auf der Seekarte mit Speed, Wind und Wellen – teilen, wenn du magst.</p>
      <div class="actions">
        ${this.trackCount ? html`<button class="btn primary" @click=${() => emit(this, 'sx-track-view')}>${icon('map')} Zurück zu deinem Törn</button>` : ''}
        <button class="btn" @click=${() => pickGpx(this)}>${icon('upload')} ${this.trackCount ? 'Weitere GPX' : 'GPX-Datei wählen'}</button>
      </div>
      <div class="hint drag-hint">oder einfach auf die Seite ziehen</div>
      ${this.samplesRow()} ${this.privacy()}
    </section>`;
  }

  private footer() {
    return html`<footer aria-label="Rechtliches"><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a></footer>`;
  }

  render() {
    const drop = this.dragging
      ? html`<div class="drop" role="status"><span>${icon('upload')} Loslassen, um die GPX-Dateien zu laden</span></div>`
      : '';
    if (!this.community) {
      return html`<div class="solo">${this.bigCard()}<div class="side"><slot name="discover"></slot></div></div>
        <slot name="feed" hidden></slot>
        ${this.footer()} ${drop}`;
    }
    return html`<div class="layout">
        <div class="feed"><slot name="feed"></slot></div>
        <div class="side">${this.compactCard()}<slot name="discover"></slot></div>
      </div>
      ${this.footer()}
      <button class="fab" type="button" aria-label=${this.trackCount ? 'Weitere GPX-Dateien laden' : 'Track anlegen – GPX-Datei laden'} title="Track anlegen"
        @click=${() => pickGpx(this)}>${icon('plus')}</button>
      ${drop}`;
  }
}
customElements.define('sx-empty-state', SxEmptyState);
