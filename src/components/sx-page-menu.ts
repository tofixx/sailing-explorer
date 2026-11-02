import { LitElement, css, html, nothing } from 'lit';
import { icon, type IconName } from './icons';
import { base, emit, menuStyles } from './shared';
import { MenuController } from './menu-controller';

/** Ein Eintrag im Seiten-Menü – nur, was erlaubt ist, gibt die Seite hinein. */
export interface PageMenuItem {
  id: string;
  label: string;
  icon: IconName;
  /** gewählter Zustand (z. B. laufende Vorschau „Ansehen als …“) */
  pressed?: boolean;
  danger?: boolean;
  /** Trennlinie davor */
  divider?: boolean;
}

/**
 * Das eine Zahnrad-Menü einer Seite (UX-NAVIGATION N6, F-429): Bearbeiten, „Ansehen als …“, Stumm/Austreten, Melden,
 * Löschen – im Kopf bleiben nur Folgen/Beitreten und Teilen (N5). Muster wie sx-map-style (`menuStyles`, mobil als
 * Sheet). Auf Geräten mit Maus erscheint der Knopf erst bei Hover über Kopf bzw. Titelbild (`pageMenuReveal` der Seite).
 * Rein präsentational – meldet `sx-page-menu-pick` { id }.
 */
export class SxPageMenu extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    items: { attribute: false },
    label: { type: String },
  };
  declare open: boolean;
  declare items: PageMenuItem[];
  declare label: string;

  constructor() {
    super();
    this.open = false;
    this.items = [];
    this.label = 'Seite';
  }

  static styles = [
    base,
    menuStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      @media (min-width: 761px) {
        .menu {
          top: calc(100% + var(--s-2));
        }
      }
      .item.danger {
        color: var(--err);
      }
    `,
  ];

  /** Klick daneben, Fokus weg, Escape schließen; Fokus beim Öffnen und Schließen. */
  private menu = new MenuController(this);

  private pick(id: string) {
    this.open = false;
    emit(this, 'sx-page-menu-pick', { id });
  }

  render() {
    if (!this.items.length) return nothing;
    return html`<div @keydown=${this.menu.onKey} @focusout=${this.menu.onFocusOut}>
      <button class="btn icon toggle" type="button" aria-label="Mehr zu ${this.label}" title="Mehr" aria-haspopup="true" aria-expanded=${this.open} aria-controls="pm"
        @click=${() => (this.open = !this.open)}>${icon('gear')}</button>
      <div class="menu" id="pm" role="group" aria-label=${this.label} ?hidden=${!this.open}>
        ${this.items.map(
          (i) => html`${i.divider ? html`<hr />` : ''}<button class="item ${i.danger ? 'danger' : ''}" type="button" aria-pressed=${i.pressed ? 'true' : nothing}
              @click=${() => this.pick(i.id)}><span class="mark">${icon(i.icon)}</span><span>${i.label}</span></button>`,
        )}
      </div>
    </div>`;
  }
}
customElements.define('sx-page-menu', SxPageMenu);
