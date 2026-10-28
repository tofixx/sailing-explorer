import { LitElement, css, html, type PropertyValues } from 'lit';
import { MAP_STYLES, MAP_STYLE_IDS, type MapStyleId } from '../domain/map-style';
import { rampCss } from '../domain/metrics';
import { icon } from './icons';
import { base, emit } from './shared';

/** now: für diese Ansicht (weg nach dem Neuladen), profile: als Standard im Profil, reset: Profil-Standard entfernen */
export type MapStyleScope = 'now' | 'profile' | 'reset';

/**
 * Kartenstil: Zahnrad unten rechts über der Karte, klappt ein Menü mit den Stilen auf (Knöpfe mit aria-pressed).
 * Ein Klick wendet den Stil sofort an (bis zum Neuladen); angemeldet lässt sich der geltende Stil als Standard setzen
 * oder der Standard entfernen.
 * Reine Darstellung – Event `sx-map-style-apply` { id, scope }.
 */
export class SxMapStyle extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    current: { type: String },
    profileStyle: { attribute: false },
    signedIn: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
  };
  declare open: boolean;
  /** gerade geltender Stil */
  declare current: MapStyleId;
  /** im Profil gespeicherter Standard (null: keiner oder Gast) */
  declare profileStyle: MapStyleId | null;
  declare signedIn: boolean;
  declare busy: boolean;
  declare error: string;

  constructor() {
    super();
    this.open = false;
    this.current = 'classic';
    this.profileStyle = null;
    this.signedIn = false;
    this.busy = false;
    this.error = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        position: relative;
      }
      .toggle {
        box-shadow: var(--shadow-1);
      }
      .menu {
        position: absolute;
        right: 0;
        bottom: calc(100% + var(--s-2));
        width: min(280px, calc(100vw - 24px));
        padding: var(--s-1);
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
        background: var(--surface);
        box-shadow: var(--shadow-2);
        display: grid;
        gap: 2px;
      }
      /* Mobil ist die Karte über dem Bottom-Sheet niedrig: das Menü kommt als Sheet vom unteren Rand. */
      @media (max-width: 760px) {
        .menu {
          position: fixed;
          inset: auto 0 0 0;
          width: 100%;
          border-radius: var(--radius-l) var(--radius-l) 0 0;
          padding-bottom: var(--s-3);
        }
      }
      .title {
        margin: var(--s-2) var(--s-2) var(--s-1);
        font-size: var(--fs-s);
        color: var(--text-2);
        font-weight: 600;
      }
      .item {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 2px var(--s-2);
        align-items: center;
        width: 100%;
        min-height: 44px;
        padding: var(--s-1) var(--s-2);
        border: 0;
        border-radius: var(--radius);
        background: none;
        color: var(--text);
        font: 500 var(--fs-m) / 1.3 var(--font);
        text-align: left;
        cursor: pointer;
      }
      .item:hover:not([disabled]) {
        background: var(--surface-hover);
      }
      .item[aria-pressed='true'] {
        background: var(--surface-2);
        font-weight: 650;
      }
      .item .mark {
        color: var(--accent);
        display: flex;
      }
      .item small {
        font-weight: 500;
        color: var(--text-2);
        margin-left: var(--s-1);
      }
      .bar {
        grid-column: 2;
        height: 6px;
        border-radius: 999px;
      }
      hr {
        border: 0;
        border-top: 1px solid var(--border-soft);
        margin: var(--s-1) 0;
      }
      .hint,
      .error {
        margin: var(--s-1) var(--s-2);
        font-size: var(--fs-s);
        line-height: 1.4;
      }
      .hint {
        color: var(--text-2);
      }
      .error {
        color: var(--err);
      }
      .action {
        justify-content: flex-start;
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    // Fokus beim Öffnen ins Menü, beim Schließen zurück aufs Zahnrad
    if (!changed.has('open') || changed.get('open') === undefined) return;
    if (this.open) this.renderRoot.querySelector<HTMLButtonElement>('.item[aria-pressed="true"]')?.focus();
    else if (this.shadowRoot?.activeElement) this.renderRoot.querySelector<HTMLButtonElement>('.toggle')?.focus();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.onOutside);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.onOutside);
  }

  /** Während gespeichert wird, bleibt das Menü offen – sonst ginge ein Fehler unbemerkt verloren. */
  private close() {
    if (!this.busy) this.open = false;
  }

  private onOutside = (e: PointerEvent) => {
    if (this.open && !e.composedPath().includes(this)) this.close();
  };

  /** Fokus wandert per Tab aus dem Bauteil: Menü schließen */
  private onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (this.open && next && !this.shadowRoot!.contains(next)) this.close();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.open) return;
    e.preventDefault();
    this.close();
  };

  private apply(id: MapStyleId, scope: MapStyleScope) {
    this.error = '';
    emit(this, 'sx-map-style-apply', { id, scope });
  }

  private profileActions() {
    if (!this.signedIn) return html`<p class="hint">Gilt bis zum Neuladen. Angemeldet kannst du einen Stil als Standard setzen.</p>`;
    const isDefault = this.current === this.profileStyle;
    return html`<button class="btn ghost small action" type="button" ?disabled=${this.busy || isDefault} @click=${() => this.apply(this.current, 'profile')}>
        ${icon('check')} ${isDefault ? `„${MAP_STYLES[this.current].label}“ ist dein Standard` : `„${MAP_STYLES[this.current].label}“ als Standard setzen`}
      </button>
      ${this.profileStyle
        ? html`<button class="btn ghost small action" type="button" ?disabled=${this.busy} @click=${() => this.apply(this.current, 'reset')}>
            ${icon('x')} Standard entfernen
          </button>`
        : ''}`;
  }

  render() {
    return html`<div @keydown=${this.onKey} @focusout=${this.onFocusOut}>
      <button class="btn icon toggle" type="button" aria-label="Ansicht konfigurieren" title="Ansicht konfigurieren"
        aria-expanded=${this.open} aria-controls="ms" @click=${() => (this.open ? this.close() : (this.open = true))}>
        ${icon('gear')}
      </button>
      <div class="menu" id="ms" role="group" aria-labelledby="ms-h" ?hidden=${!this.open}>
        <p class="title" id="ms-h">Kartenstil</p>
        ${MAP_STYLE_IDS.map((id) => {
          const s = MAP_STYLES[id];
          const on = id === this.current;
          return html`<button class="item" type="button" aria-pressed=${on} ?disabled=${this.busy} title=${s.description}
            @click=${() => (on ? this.close() : this.apply(id, 'now'))}>
            <span class="mark">${on ? icon('check') : ''}</span>
            <span>${s.label}${this.signedIn && id === this.profileStyle ? html`<small>Standard</small>` : ''}</span>
            <span class="bar" style="background:${rampCss(s.ramp)}" aria-hidden="true"></span>
          </button>`;
        })}
        <hr />
        ${this.profileActions()}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      </div>
    </div>`;
  }
}
customElements.define('sx-map-style', SxMapStyle);
