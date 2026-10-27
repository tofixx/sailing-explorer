import { LitElement, css, html, type PropertyValues } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { MAP_STYLES, MAP_STYLE_IDS, type MapStyle, type MapStyleId } from '../domain/map-style';
import { rampCss } from '../domain/metrics';
import { waveChevron, windBadge } from '../map/glyphs';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

export type MapStyleScope = 'now' | 'profile';

/**
 * „Ansicht konfigurieren“: Knopf unten rechts über der Karte, öffnet ein Popover mit den Kartenstilen (Vorschau je Set).
 * Nicht modal, damit die Karte die Auswahl sofort zeigt. Reine Darstellung – Events: `sx-map-style-preview` { id },
 * `sx-map-style-apply` { id, scope } (angemeldet: „Nur jetzt“ oder „Als Standard im Profil“, Gast: nur „now“),
 * `sx-map-style-cancel` (Vorschau verwerfen).
 */
export class SxMapStyle extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    current: { type: String },
    profileStyle: { attribute: false },
    signedIn: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    selected: { state: true },
  };
  declare open: boolean;
  /** gerade geltender Stil */
  declare current: MapStyleId;
  /** im Profil gespeicherter Standard (null: keiner oder Gast) */
  declare profileStyle: MapStyleId | null;
  declare signedIn: boolean;
  declare busy: boolean;
  declare error: string;
  declare selected: MapStyleId;

  constructor() {
    super();
    this.open = false;
    this.current = 'classic';
    this.profileStyle = null;
    this.signedIn = false;
    this.busy = false;
    this.error = '';
    this.selected = 'classic';
  }

  static styles = [
    base,
    dialogStyles,
    css`
      :host {
        display: block;
      }
      .toggle {
        box-shadow: var(--shadow-1);
      }
      dialog {
        position: absolute;
        inset: auto 0 calc(100% + var(--s-2)) auto;
        margin: 0;
        width: min(360px, calc(100vw - 24px));
        max-height: min(70dvh, 560px);
        overflow-y: auto;
        z-index: 1;
      }
      /* Mobil ist die Karte über dem Bottom-Sheet zu niedrig: das Popover wird selbst zum Sheet am unteren Rand. */
      @media (max-width: 760px) {
        dialog {
          position: fixed;
          inset: auto 0 0 0;
          width: 100%;
          max-height: 80dvh;
          border-radius: var(--radius-l) var(--radius-l) 0 0;
        }
      }
      header {
        padding: var(--s-3) var(--s-3) var(--s-1) var(--s-4);
      }
      header h2 {
        font-size: var(--fs-m);
      }
      .body {
        padding: var(--s-1) var(--s-3) var(--s-3);
        gap: var(--s-3);
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-1);
      }
      .opt {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--s-1) var(--s-2);
        align-items: center;
        padding: var(--s-2);
        border: 1px solid transparent;
        border-radius: var(--radius);
        cursor: pointer;
      }
      .opt:hover {
        background: var(--surface-hover);
      }
      .opt:has(input:checked) {
        border-color: var(--accent);
        background: var(--surface-2);
      }
      .opt input {
        accent-color: var(--accent);
        width: 18px;
        height: 18px;
        margin: 0;
      }
      .opt .name {
        font-weight: 600;
      }
      .opt .name small {
        font-weight: 500;
        color: var(--text-2);
        margin-left: var(--s-1);
      }
      .preview,
      .desc {
        grid-column: 2;
      }
      .desc {
        font-size: var(--fs-s);
        color: var(--text-2);
        line-height: 1.4;
      }
      .preview {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        padding: var(--s-1) var(--s-2);
        border-radius: var(--radius);
        background: var(--map-bg);
      }
      .bar {
        flex: 1;
        border-radius: 999px;
        box-shadow: 0 0 0 2px var(--map-halo);
      }
      .glyph {
        display: flex;
        flex: none;
      }
      .ask {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
    `,
  ];

  willUpdate(changed: PropertyValues<this>) {
    // Beim Öffnen steht die Auswahl auf dem geltenden Stil.
    if (changed.has('open') && this.open) {
      this.selected = this.current;
      this.error = '';
    }
  }

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) dlg.show();
      else if (!this.open && dlg.open) {
        // Fokus aus dem Popover zurück auf den Knopf (nicht modale Dialoge geben ihn nicht zurück)
        const focusInside = dlg.contains(this.shadowRoot?.activeElement ?? null);
        dlg.close();
        if (focusInside) this.renderRoot.querySelector<HTMLButtonElement>('.toggle')?.focus();
      }
    }
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.onOutside);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.onOutside);
  }

  /** Klick neben das Popover verwirft die Vorschau. */
  private onOutside = (e: PointerEvent) => {
    if (this.open && !e.composedPath().includes(this)) this.cancel();
  };

  private toggle = () => {
    if (this.open) this.cancel();
    else this.open = true;
  };

  /** Während gespeichert wird, bleibt das Popover offen – sonst ginge ein Fehler oder Erfolg unbemerkt verloren. */
  private cancel = () => {
    if (this.busy) return;
    this.open = false;
    emit(this, 'sx-map-style-cancel');
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    this.cancel();
  };

  private pick(id: MapStyleId) {
    this.selected = id;
    emit(this, 'sx-map-style-preview', { id });
  }

  private apply(scope: MapStyleScope) {
    emit(this, 'sx-map-style-apply', { id: this.selected, scope });
  }

  private preview(s: MapStyle) {
    // Beispielwerte: schwacher und kräftiger Wind, kleine und hohe Welle
    const g = (svg: string) => html`<span class="glyph">${unsafeHTML(svg)}</span>`;
    return html`<div class="preview" aria-hidden="true">
      <div class="bar" style="height:${s.lineWeight + 3}px;background:${rampCss(s.ramp)}"></div>
      ${g(windBadge(225, 8, s))}${g(windBadge(250, 24, s))}${g(waveChevron(225, 0.4, s))}${g(waveChevron(250, 2.4, s))}
    </div>`;
  }

  private actions() {
    if (!this.signedIn) {
      return html`<p class="ask">Gilt auf diesem Gerät. Angemeldet kannst du ihn als Standard im Profil speichern – dann auf allen Geräten.</p>
        <div class="actions">
          <button class="btn" type="button" @click=${this.cancel}>Abbrechen</button>
          <button class="btn primary" type="button" ?disabled=${this.selected === this.current} @click=${() => this.apply('now')}>${icon('check')} Übernehmen</button>
        </div>`;
    }
    return html`<p class="ask">Übernehmen – nur jetzt (bis du den Tab schließt) oder als Standard im Profil für alle Geräte?</p>
      <div class="actions">
        <button class="btn" type="button" ?disabled=${this.busy || this.selected === this.current} @click=${() => this.apply('now')}>Nur jetzt</button>
        <button class="btn primary" type="button" ?disabled=${this.busy || (this.selected === this.profileStyle && this.current === this.profileStyle)} @click=${() => this.apply('profile')}>${icon('check')} Als Standard speichern</button>
      </div>`;
  }

  render() {
    const prof = this.signedIn && this.profileStyle ? MAP_STYLES[this.profileStyle].label : '';
    return html`<button class="btn small toggle" type="button" aria-expanded=${this.open} aria-controls="ms" @click=${this.toggle}>
        ${icon('map')} Ansicht konfigurieren
      </button>
      <dialog id="ms" aria-labelledby="ms-h" @keydown=${this.onKey}>
        <header>
          <h2 id="ms-h">Kartenansicht</h2>
          <button class="btn ghost icon small" aria-label="Schließen" ?disabled=${this.busy} @click=${this.cancel}>${icon('x')}</button>
        </header>
        <div class="body">
          <fieldset>
            <legend class="ask">Farbverlauf der Track-Einfärbung und Wind-/Wellen-Symbole</legend>
            ${MAP_STYLE_IDS.map((id) => {
              const s = MAP_STYLES[id];
              return html`<label class="opt">
                <input type="radio" name="style" value=${id} .checked=${this.selected === id} @change=${() => this.pick(id)} />
                <span class="name">${s.label}${prof && id === this.profileStyle ? html`<small>Profil-Standard</small>` : ''}</span>
                ${this.preview(s)}
                <span class="desc">${s.description}</span>
              </label>`;
            })}
          </fieldset>
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          ${this.actions()}
        </div>
      </dialog>`;
  }
}
customElements.define('sx-map-style', SxMapStyle);
