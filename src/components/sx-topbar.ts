import { LitElement, css, html, nothing } from 'lit';
import type { User } from '../services/api';
import type { Mode } from '../services/store';
import { icon, logo } from './icons';
import { base, emit, pickGpx } from './shared';

/** Kopfzeile: Marke, Sitzungsstatus, Hauptaktionen. */
export class SxTopbar extends LitElement {
  static properties = {
    user: { attribute: false },
    mode: { attribute: false },
    hasTracks: { type: Boolean },
    backend: { type: Boolean },
    home: { type: Boolean, reflect: true },
    saved: { type: Boolean },
  };
  declare user: User | null;
  declare mode: Mode;
  declare hasTracks: boolean;
  declare backend: boolean;
  /** Startseite wird gerade angezeigt */
  declare home: boolean;
  /** geladene Tracks sind als Freigabe gespeichert */
  declare saved: boolean;

  constructor() {
    super();
    this.user = null;
    this.mode = { kind: 'local' };
    this.hasTracks = false;
    this.backend = false;
    this.home = false;
    this.saved = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--s-3);
        padding: 0 var(--s-4);
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        position: relative;
        z-index: 1000;
        min-width: 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        font-weight: 750;
        font-size: var(--fs-l);
        letter-spacing: -0.02em;
        color: var(--text);
        text-decoration: none;
        white-space: nowrap;
      }
      .brand .mark {
        display: grid;
        width: 32px;
        height: 32px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        max-width: 40ch;
        padding: var(--s-1) var(--s-3);
        border-radius: 999px;
        background: var(--surface-2);
        border: 1px solid var(--border-soft);
        color: var(--text-2);
        font-size: var(--fs-s);
        font-weight: 550;
      }
      .chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip svg {
        width: 14px;
        height: 14px;
      }
      .chip.shared {
        background: var(--accent-soft);
        color: var(--accent);
        border-color: transparent;
      }
      .spacer {
        flex: 1;
      }
      .actions {
        display: flex;
        gap: var(--s-2);
        align-items: center;
      }
      /* Teilen ist die Hauptaktion: kräftig und immer mit Text */
      .btn.share {
        padding-inline: var(--s-4);
        font-weight: 700;
        box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
      }
      .btn.share svg {
        width: 20px;
        height: 20px;
      }
      /* Gäste: Anmelden deutlich hervorheben */
      .btn.login {
        border-color: var(--accent);
        color: var(--accent);
        font-weight: 650;
      }
      .btn.login:hover {
        background: var(--accent-soft);
      }
      button.chip {
        cursor: pointer;
        font: inherit;
        font-size: var(--fs-s);
        font-weight: 600;
      }
      button.chip:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      .chip.warn {
        background: var(--warn-bg);
        border-color: color-mix(in srgb, var(--warn) 45%, transparent);
        color: var(--warn);
      }
      .chip.ok {
        background: color-mix(in srgb, var(--ok) 12%, transparent);
        border-color: transparent;
        color: var(--ok);
      }
      .chip.status {
        max-width: none;
      }
      /* Text staffelt sich mit der Breite: lang (Desktop) · kurz (schmaler, Handy) */
      .chip .mid {
        display: none;
      }
      @media (max-width: 1150px) {
        .chip .long {
          display: none;
        }
        .chip .mid {
          display: inline;
        }
      }
      @media (max-width: 760px) {
        .label-text {
          display: none;
        }
        .keep .label-text {
          display: inline;
        }
        /* Handy: kurz, aber neben dem Logo sichtbar */
        .chip .long {
          display: none;
        }
        /* In der vollen Leiste ist kein Platz: Statuspille mittig unter der Kopfzeile, über der Karte */
        .chip.status {
          position: absolute;
          top: calc(100% + var(--s-2));
          left: 50%;
          transform: translateX(-50%);
          max-width: calc(100vw - 2 * var(--s-4));
          box-shadow: var(--shadow-1);
        }
        .chip {
          max-width: 18ch;
        }
        .btn.collapse {
          padding: 0;
          width: var(--control-h);
        }
      }
      /* Startseite mobil: Hochladen ist der runde Knopf unten rechts bzw. die Einstiegskarte (Konzept 12.6) */
      @media (max-width: 760px) {
        :host([home]) .btn.upload {
          display: none;
        }
      }
      @media (max-width: 420px) {
        .brand .name {
          display: none;
        }
      }
    `,
  ];

  /** Mit geladenen Tracks öffnet das Logo die Startseite, ohne die Tracks zu verwerfen. */
  private onBrand = (e: MouseEvent) => {
    if (!this.hasTracks || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    emit(this, this.home ? 'sx-track-view' : 'sx-home');
  };

  private chip() {
    if (this.mode.kind === 'share') {
      const s = this.mode.share;
      return html`<span class="chip shared" title="Geteilte Ansicht">${icon(s.visibility === 'private' ? 'lock' : s.visibility === 'public' ? 'globe' : 'link')}<span>${s.title}</span></span>`;
    }
    if (this.mode.kind === 'link') {
      return html`<span class="chip shared" title="Ansicht aus einem Link – wird nicht gespeichert">${icon('link')}<span>${this.mode.title}</span></span>`;
    }
    if (!this.hasTracks) return nothing;
    // Ohne Backend gibt es kein Speichern – nur der Hinweis auf den Browser.
    if (!this.backend) return html`<span class="chip" title="Deine Tracks werden nur in diesem Browser gespeichert.">${icon('lock')}<span>Gast-Sitzung · nur dieses Gerät</span></span>`;
    if (this.saved) {
      return html`<button class="chip status ok" @click=${() => emit(this, 'sx-account')} title="Gespeichert in deinem Konto – unter „Konto & Freigaben“ verwalten.">
        ${icon('check')}<span>Gespeichert</span>
      </button>`;
    }
    // Nicht gespeichert: Gäste zum Anmelden, Angemeldete zum Teilen anregen – mit Hinweis auf Teilen und Community.
    const guest = !this.user;
    const why = 'Gespeichert ist er in deinem Konto, teilbar per Link oder Bild und – wenn öffentlich – in der Community unter Entdecken.';
    return html`<button
      class="chip status warn"
      @click=${() => emit(this, guest ? 'sx-login' : 'sx-share')}
      title=${guest ? `Dein Törn liegt nur in diesem Browser. Melde dich per E-Mail-Link an: ${why}` : `Noch nicht gespeichert. Teile deinen Törn: ${why}`}
      aria-label=${guest ? 'Nicht gespeichert – anmelden zum Speichern, Teilen und für die Community' : 'Nicht gespeichert – jetzt teilen und speichern'}
    >
      ${icon(guest ? 'lock' : 'info')}<span class="long">Nicht gespeichert – ${guest ? 'anmelden, um zu speichern, zu teilen und in der Community zu zeigen' : 'teilen, um zu speichern und in der Community zu zeigen'}</span><span class="mid">Nicht gespeichert · ${guest ? 'Anmelden' : 'Teilen'}</span>
    </button>`;
  }

  render() {
    return html`
      <a class="brand" href="/" aria-label="Sail Explorer – Startseite" @click=${this.onBrand}>
        <span class="mark">${logo()}</span><span class="name">Sail Explorer</span>
      </a>
      ${this.chip()}
      <span class="spacer"></span>
      <div class="actions">
        <button class="btn collapse upload" @click=${() => pickGpx(this)} title="Track anlegen – GPX-Dateien laden" aria-label="Track anlegen">
          ${icon('upload')}<span class="label-text">Track anlegen</span>
        </button>
        ${this.hasTracks && this.home
          ? html`<button class="btn collapse" @click=${() => emit(this, 'sx-track-view')} title="Zurück zur Törn-Ansicht">
              ${icon('map')}<span class="label-text">Mein Törn</span>
            </button>`
          : nothing}
        ${this.hasTracks
          ? html`<button class="btn primary share keep" @click=${() => emit(this, 'sx-share')} title="Als Link oder Bild teilen">
              ${icon('share')}<span class="label-text">Teilen</span>
            </button>`
          : nothing}
        ${this.backend
          ? this.user
            ? html`<button class="btn ghost icon" @click=${() => emit(this, 'sx-account')} title="Konto & Freigaben (${this.user.email})" aria-label="Konto & Freigaben">
                <span class="avatar">${this.user.email[0]}</span>
              </button>`
            : html`<button class="btn login keep" @click=${() => emit(this, 'sx-login')} title="Per E-Mail-Link anmelden – Tracks speichern und teilen">
                ${icon('user')}<span class="label-text">Anmelden</span>
              </button>`
          : nothing}
      </div>
    `;
  }
}
customElements.define('sx-topbar', SxTopbar);
