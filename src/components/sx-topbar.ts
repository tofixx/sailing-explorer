import { LitElement, css, html, nothing } from 'lit';
import type { User } from '../services/api';
import type { Mode } from '../services/store';
import { icon } from './icons';
import { base, emit, pickGpx } from './shared';

/** Kopfzeile: Marke, Sitzungsstatus, Hauptaktionen. */
export class SxTopbar extends LitElement {
  static properties = {
    user: { attribute: false },
    mode: { attribute: false },
    hasTracks: { type: Boolean },
    backend: { type: Boolean },
  };
  declare user: User | null;
  declare mode: Mode;
  declare hasTracks: boolean;
  declare backend: boolean;

  constructor() {
    super();
    this.user = null;
    this.mode = { kind: 'local' };
    this.hasTracks = false;
    this.backend = false;
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
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: var(--radius);
        background: var(--accent);
        color: var(--on-accent);
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
      @media (max-width: 760px) {
        .label-text {
          display: none;
        }
        .chip {
          max-width: 18ch;
        }
        .btn.collapse {
          padding: 0;
          width: var(--control-h);
        }
      }
      @media (max-width: 420px) {
        .brand .name {
          display: none;
        }
      }
    `,
  ];

  private chip() {
    if (this.mode.kind === 'share') {
      const s = this.mode.share;
      return html`<span class="chip shared" title="Geteilte Ansicht">${icon(s.visibility === 'private' ? 'lock' : 'link')}<span>${s.title}</span></span>`;
    }
    if (this.mode.kind === 'link') {
      return html`<span class="chip shared" title="Ansicht aus einem Link – wird nicht gespeichert">${icon('link')}<span>${this.mode.title}</span></span>`;
    }
    if (!this.hasTracks) return nothing;
    return this.user
      ? html`<span class="chip" title="Angemeldet als ${this.user.email}">${icon('folder')}<span>Arbeitsbereich</span></span>`
      : html`<span class="chip" title="Deine Tracks werden nur in diesem Browser gespeichert. Zum Teilen meldest du dich per E-Mail an.">${icon('lock')}<span>Gast-Sitzung · nur dieses Gerät</span></span>`;
  }

  render() {
    return html`
      <a class="brand" href="/" aria-label="Sail Explorer – Startseite">
        <span class="mark">${icon('sail')}</span><span class="name">Sail Explorer</span>
      </a>
      ${this.chip()}
      <span class="spacer"></span>
      <div class="actions">
        <button class="btn collapse" @click=${() => pickGpx(this)} title="GPX-Dateien laden">
          ${icon('upload')}<span class="label-text">GPX laden</span>
        </button>
        ${this.hasTracks
          ? html`<button class="btn primary collapse" @click=${() => emit(this, 'sx-share')} title="Link zum Teilen erstellen">
              ${icon('share')}<span class="label-text">Teilen</span>
            </button>`
          : nothing}
        ${this.backend
          ? this.user
            ? html`<button class="btn ghost icon" @click=${() => emit(this, 'sx-account')} title="Konto & Freigaben (${this.user.email})" aria-label="Konto & Freigaben">
                <span class="avatar">${this.user.email[0]}</span>
              </button>`
            : html`<button class="btn ghost collapse" @click=${() => emit(this, 'sx-login')} title="Anmelden">
                ${icon('user')}<span class="label-text">Anmelden</span>
              </button>`
          : nothing}
      </div>
    `;
  }
}
customElements.define('sx-topbar', SxTopbar);
