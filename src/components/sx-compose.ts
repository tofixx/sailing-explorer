import { LitElement, css, html, nothing } from 'lit';
import { icon, type IconName } from './icons';
import { base, emit, menuStyles } from './shared';
import { MenuController } from './menu-controller';
import { RECORDING_GUIDE_PATH } from '../content/recording-guide';

/** Arten, die es in Phase 2 gibt (Konzept 21.4) – Umfrage, Veranstaltung und Fotos folgen in späteren Phasen. */
export type ComposeKind = 'gpx' | 'logbook' | 'text';

const KINDS: Array<{ kind: ComposeKind; icon: IconName; label: string; hint: string }> = [
  { kind: 'gpx', icon: 'map', label: 'Törn (GPX)', hint: 'GPX-Datei laden – wird lokal ausgewertet' },
  { kind: 'logbook', icon: 'book', label: 'Fahrtenbuch-Eintrag', hint: 'Törn ohne Track eintragen' },
  { kind: 'text', icon: 'comment', label: 'Text', hint: 'Beitrag in Profil, Gruppe, Hafen oder Boot' },
];

/**
 * Plus-Knopf „+ Neu“ (Konzept 21.4, F-405): ein Einstieg für alles, was man anlegt – ersetzt „Track anlegen“ in der
 * Kopfzeile und den runden Knopf auf dem Handy. Ab 760 px ein Menü am Knopf, mobil ein Bottom-Sheet (Muster
 * `menuStyles`). Meldet genau ein Event `sx-compose-open` { kind } – der ComposeController öffnet die Dateiauswahl
 * (noch im Klick, ohne Anmeldung), das Fahrtenbuch-Formular bzw. den Text-Dialog mit dem Verlauf der offenen Seite.
 */
export class SxCompose extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
  };
  declare open: boolean;

  constructor() {
    super();
    this.open = false;
  }

  static styles = [
    base,
    menuStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      .item {
        grid-template-columns: 22px 1fr;
      }
      .item small {
        display: block;
        margin: 0;
      }
      /* Hinweis unter „Törn (GPX)“ zur Anleitung (F-450) – klein, kein eigener Eintrag */
      .how {
        display: block;
        margin: -2px 0 var(--s-1);
        padding: var(--s-1) var(--s-2) var(--s-1) calc(var(--s-2) * 2 + 22px);
        font-size: var(--fs-s);
        color: var(--accent);
      }
      @media (min-width: 761px) {
        .menu {
          top: calc(100% + var(--s-2));
        }
        .backdrop {
          display: none;
        }
      }
      /* Handy: Bottom-Sheet über einer Abdunklung, Einträge ≥ 44 px */
      @media (max-width: 760px) {
        .menu {
          z-index: 1001;
          padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom, 0px));
        }
        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: var(--backdrop);
        }
      }
      @media (max-width: 600px) {
        .label-text {
          display: none;
        }
      }
    `,
  ];

  /** Klick daneben, Fokus weg, Escape schließen; Fokus beim Öffnen und Schließen. */
  private menu = new MenuController(this);

  /** Synchron im Klick gemeldet – so darf der Controller die Dateiauswahl noch öffnen (Browser verlangen eine Geste). */
  private pick(kind: ComposeKind) {
    this.open = false;
    emit(this, 'sx-compose-open', { kind });
  }

  render() {
    return html`<div @keydown=${this.menu.onKey} @focusout=${this.menu.onFocusOut}>
      <button class="btn primary toggle" type="button" title="Neu anlegen – Törn, Fahrtenbuch-Eintrag oder Beitrag" aria-label="Neu anlegen"
        aria-haspopup="true" aria-expanded=${this.open} aria-controls="nm" @click=${() => (this.open = !this.open)}>${icon('plus')}<span class="label-text">Neu</span></button>
      ${this.open ? html`<div class="backdrop" @click=${() => (this.open = false)}></div>` : nothing}
      <div class="menu" id="nm" role="group" aria-labelledby="nm-h" ?hidden=${!this.open}>
        <p class="title" id="nm-h">Was möchtest du anlegen?</p>
        ${KINDS.map(
          (k) => html`<button class="item" type="button" @click=${() => this.pick(k.kind)}>
            <span class="mark">${icon(k.icon)}</span><span>${k.label}<small>${k.hint}</small></span></button>
            ${k.kind === 'gpx' ? html`<a class="how" href=${RECORDING_GUIDE_PATH}>Wie zeichne ich auf?</a>` : nothing}`,
        )}
      </div>
    </div>`;
  }
}
customElements.define('sx-compose', SxCompose);
