import { LitElement, css, html, type PropertyValues } from 'lit';
import { MAP_STYLES, MAP_STYLE_IDS, type MapStyleId } from '../domain/map-style';
import { rampCss } from '../domain/metrics';
import { icon } from './icons';
import { base, emit, menuStyles } from './shared';

/** now: für diese Ansicht (weg nach dem Neuladen), profile: als Standard im Profil, reset: Profil-Standard entfernen */
export type MapStyleScope = 'now' | 'profile' | 'reset';

/**
 * Kartenstil: Ebenen-Knopf unten rechts über der Karte, klappt ein Menü mit den Stilen auf (Knöpfe mit aria-pressed).
 * Ein Klick wendet den Stil sofort an (bis zum Neuladen); angemeldet lässt sich der geltende Stil als Standard setzen
 * oder der Standard entfernen.
 * Dazu der Schalter „Revier“ (Wärmekarte der öffentlichen Törns, Konzept 37, F-584) – bleibt offen beim Umschalten.
 * Reine Darstellung – Events `sx-map-style-apply` { id, scope }, `sx-map-heat` { on }.
 */
export class SxMapStyle extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    current: { type: String },
    profileStyle: { attribute: false },
    signedIn: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    heat: { type: Boolean },
  };
  declare open: boolean;
  /** gerade geltender Stil */
  declare current: MapStyleId;
  /** im Profil gespeicherter Standard (null: keiner oder Gast) */
  declare profileStyle: MapStyleId | null;
  declare signedIn: boolean;
  declare busy: boolean;
  declare error: string;
  /** Ebene „Revier“ (Konzept 37) an */
  declare heat: boolean;

  constructor() {
    super();
    this.open = false;
    this.current = 'classic';
    this.profileStyle = null;
    this.signedIn = false;
    this.busy = false;
    this.error = '';
    this.heat = false;
  }

  static styles = [
    base,
    menuStyles,
    css`
      :host {
        display: block;
        position: relative;
      }
      .toggle {
        box-shadow: var(--shadow-1);
      }
      /* über dem Zahnrad (unten rechts auf der Karte); mobil als Sheet (menuStyles) */
      @media (min-width: 761px) {
        .menu {
          bottom: calc(100% + var(--s-2));
          width: min(280px, calc(100vw - 24px));
        }
      }
      .bar {
        grid-column: 2;
        height: 6px;
        border-radius: 999px;
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
      <button class="btn icon toggle" type="button" aria-label="Kartenstil" title="Kartenstil"
        aria-expanded=${this.open} aria-controls="ms" @click=${() => (this.open ? this.close() : (this.open = true))}>
        ${icon('layers')}
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
        <button class="item heat" type="button" aria-pressed=${this.heat} title="Wärmekarte der öffentlichen Törns – ohne Namen, Zeiten, Anfang und Ende"
          @click=${() => emit(this, 'sx-map-heat', { on: !this.heat })}>
          <span class="mark">${this.heat ? icon('check') : ''}</span>
          <span>Revier<small>wo gesegelt wird</small></span>
        </button>
        <hr />
        ${this.profileActions()}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      </div>
    </div>`;
  }
}
customElements.define('sx-map-style', SxMapStyle);
