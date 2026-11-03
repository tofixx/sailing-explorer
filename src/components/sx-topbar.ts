import { LitElement, css, html, nothing } from 'lit';
import type { User } from '../services/api';
import type { Mode } from '../services/store';
import { icon, logo, type IconName } from './icons';
import { badgeStyles, base, emit } from './shared';
import './sx-compose';
import './sx-account-menu';
import { APP_NAME } from '../domain/brand';

/** Angezeigter Bereich: Törn-Ansicht, Community (Startseite), Entdecken oder eine andere Seite (Profil, Gruppe …). */
export type TopbarSection = 'track' | 'community' | 'discover' | 'page';

/** Offener Törn (Konzept 23, F-433): Titel, Zustand (lang und kurz für schmale Breiten), Farbe und Symbol. */
export interface ToernLabel {
  title: string;
  status: string;
  short: string;
  tone: 'draft' | 'saved' | 'view';
  icon: IconName;
}

/** Community von einer Seite aus: Startseite mit Stream, auch wenn Tracks im Browser liegen (F-220). */
export const COMMUNITY_HREF = '/?community';

/** Kopfzeile: Marke, Bereiche (Törn · Community · Entdecken, Konzept 12.10), Sitzungsstatus, Hauptaktionen. */
export class SxTopbar extends LitElement {
  static properties = {
    user: { attribute: false },
    mode: { attribute: false },
    hasTracks: { type: Boolean },
    backend: { type: Boolean },
    home: { type: Boolean, reflect: true },
    saved: { type: Boolean },
    toern: { attribute: false },
    draft: { attribute: false },
    section: { attribute: false },
    unread: { attribute: false },
    bell: { attribute: false },
    bellOpen: { attribute: false },
  };
  declare user: User | null;
  declare mode: Mode;
  declare hasTracks: boolean;
  declare backend: boolean;
  /** Startseite wird gerade angezeigt */
  declare home: boolean;
  /** geladene Tracks sind als Freigabe gespeichert */
  declare saved: boolean;
  /** offener Törn für den Chip neben dem Logo (null = keiner) */
  declare toern: ToernLabel | null;
  /** Titel des Entwurfs, der sich über „+ Neu“ fortsetzen lässt (F-436) */
  declare draft: string | null;
  declare section: TopbarSection;
  /** Badge an „Community“ (F-221): leer = keins, sonst Zahl bzw. „99+“ */
  declare unread: string;
  /** Badge an der Glocke (Konzept 17, F-252): leer = keins, sonst Zahl bzw. „99+“ */
  declare bell: string;
  /** Liste der Benachrichtigungen offen (aria-expanded) */
  declare bellOpen: boolean;

  constructor() {
    super();
    this.user = null;
    this.mode = { kind: 'local' };
    this.hasTracks = false;
    this.backend = false;
    this.home = false;
    this.saved = false;
    this.toern = null;
    this.draft = null;
    this.section = 'track';
    this.unread = '';
    this.bell = '';
    this.bellOpen = false;
  }

  static styles = [
    base,
    badgeStyles,
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
      /* Bereiche: sichtbare Reiter statt Umschalten über das Logo (F-220) */
      .nav {
        display: flex;
        align-items: center;
        gap: var(--s-1);
      }
      .tab {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: var(--control-h);
        padding: 0 var(--s-3);
        border: 0;
        border-radius: var(--radius);
        background: transparent;
        color: var(--text-2);
        font: 600 var(--fs-m) / 1 var(--font);
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
      }
      .tab svg {
        width: 20px;
        height: 20px;
      }
      .tab:hover {
        background: var(--surface-hover);
        color: var(--text);
      }
      .tab[aria-current] {
        background: var(--accent-soft);
        color: var(--accent);
      }
      /* Neben den Reitern ist für die Statuspille kein Platz mehr: mittig unter der Kopfzeile, über der Karte */
      @media (max-width: 1150px) {
        .chip.status {
          position: absolute;
          top: calc(100% + var(--s-2));
          left: 50%;
          transform: translateX(-50%);
          max-width: calc(100vw - 2 * var(--s-4));
          box-shadow: var(--shadow-1);
        }
      }
      /* Törn-Ansicht mit Seitenleiste: mittig über der Karte statt über der ganzen Breite; auf der Community-Ansicht
         läge sie über dem Stream – dort genügt der Reiter „Törn“ */
      @media (max-width: 1150px) and (min-width: 761px) {
        :host(:not([home])) .chip.status {
          left: calc((100% - var(--sidebar-w)) / 2);
        }
        :host([home]) .chip.status {
          display: none;
        }
      }
      @media (max-width: 900px) and (min-width: 761px) {
        .brand .name {
          display: none;
        }
        }
      }
      /* Glocke (Konzept 17): Zähler oben rechts am Knopf */
      .bell {
        position: relative;
      }
      .bell .badge {
        position: absolute;
        top: 2px;
        right: 0;
        pointer-events: none;
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
        max-width: min(60ch, calc(100vw - 2 * var(--s-4)));
      }
      /* Törn-Chip (F-433): Titel kürzt sich, Zustand und × bleiben stehen */
      .chip .st {
        flex: none;
        font-weight: 500;
      }
      .chip .st .short {
        display: none;
      }
      /* × (F-433): sichtbar 24 px, Tippfläche 44 px (Prinzip N11) */
      .chip .x {
        position: relative;
        display: inline-grid;
        place-items: center;
        flex: none;
        width: 24px;
        height: 24px;
        margin: -2px calc(-1 * var(--s-2)) -2px 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .chip .x::after {
        content: '';
        position: absolute;
        inset: -10px;
      }
      .chip .x:hover {
        background: color-mix(in srgb, currentColor 14%, transparent);
      }
      .chip .x:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      @media (max-width: 760px) {
        /* Handy: die Bereiche als eigene Reiterzeile über die volle Breite unter der Kopfzeile */
        :host {
          flex-wrap: wrap;
          row-gap: 0;
          align-content: flex-start;
        }
        .brand {
          height: var(--topbar-h);
        }
        .nav {
          order: 10;
          flex: 0 0 calc(100% + 2 * var(--s-4));
          margin: 0 calc(-1 * var(--s-4));
          gap: 0;
          border-top: 1px solid var(--border-soft);
        }
        .tab {
          flex: 1;
          min-height: 44px;
          border-radius: 0;
          font-size: var(--fs-s);
        }
        .tab[aria-current] {
          background: transparent;
          box-shadow: inset 0 -2px 0 var(--accent);
        }
        .label-text {
          display: none;
        }
        .keep .label-text {
          display: inline;
        }
        .btn.collapse {
          padding: 0;
          width: var(--control-h);
        }
      }
      /* Handy: der Chip liegt über der Karte – auf der Startseite (Stream) zeigt der Reiter „Törn“ den Weg zurück;
         × als Touch-Ziel mit 44 px */
      @media (max-width: 760px) {
        :host([home]) .chip.status {
          display: none;
        }
        /* F-617: rechts bleibt die Grundkarten-Wahl (Leaflet, oben rechts: 10 px Rand + 46 px Knopf) frei –
           mittig mit je 64 px Abstand zu beiden Rändern */
        .chip.toern {
          min-height: 44px;
          padding-block: 0;
          max-width: calc(100vw - 2 * 64px);
        }
        .chip .x {
          width: 44px;
          height: 44px;
          margin-block: 0;
        }
        .chip .x::after {
          inset: 0;
        }
      }
      @media (max-width: 480px) {
        .chip .st .full {
          display: none;
        }
        .chip .st .short {
          display: inline;
        }
      }
      @media (max-width: 420px) {
        .brand .name {
          display: none;
        }
        /* Sonst wird die Leiste breiter als das Handy und zieht die ganze Seite mit (F-291) */
        .share .label-text {
          display: none;
        }
      }
      @media (max-width: 380px) {
        .login .label-text {
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

  /** Community: aus der Törn-Ansicht ohne Neuladen (Tracks bleiben), sonst als Link zur Startseite. */
  private onCommunity = (e: MouseEvent) => {
    if (this.section !== 'track' && this.section !== 'community') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    emit(this, 'sx-home');
  };

  private nav() {
    // Ohne Backend gibt es weder Community noch Entdecken – dann bleibt es beim Logo und „Mein Törn“.
    if (!this.backend) return nothing;
    const current = (s: TopbarSection) => (this.section === s ? 'page' : nothing);
    const badge = this.user && this.unread ? this.unread : '';
    return html`<nav class="nav" aria-label="Bereiche">
      ${this.hasTracks
        ? html`<button class="tab" aria-current=${current('track')} @click=${() => emit(this, 'sx-track-view')} title="Zur Törn-Ansicht mit Karte">
            ${icon('map')}<span>Törn</span>
          </button>`
        : nothing}
      <a class="tab" href=${COMMUNITY_HREF} aria-current=${current('community')} @click=${this.onCommunity}
        title=${badge ? `Community – ${badge} neue Einträge${this.section === 'community' ? ' (klicken zum Neuladen)' : ''}` : 'Community – Neuigkeiten aus Verein, Hafen und Team'}
        aria-label=${badge ? `Community, ${badge} neue Einträge` : 'Community'}>
        ${icon('community')}<span>Community</span>${badge ? html`<span class="badge" aria-hidden="true">${badge}</span>` : nothing}
      </a>
      <a class="tab" href="/entdecken" aria-current=${current('discover')} title="Öffentliche Törns, Boote, Segler und Vereine entdecken">
        ${icon('compass')}<span>Entdecken</span>
      </a>
    </nav>`;
  }

  /** Welcher Törn offen ist (F-433): Titel · Zustand · × „Törn schließen“. Speichern und Anmelden sind eigene Knöpfe. */
  private chip() {
    const t = this.toern;
    if (!t) return nothing;
    const hint =
      t.tone === 'saved' ? 'In deinem Konto gespeichert.'
      : t.tone === 'view' ? 'Ansicht – nicht dein Entwurf. Eigene Tracks beginnen über „+ Neu“ einen neuen Törn.'
      : !this.backend ? 'Liegt nur in diesem Browser.'
      : this.user ? 'Liegt nur in diesem Browser – „Speichern“ legt ihn in deinem Konto ab, dann kannst du ihn teilen.'
      : 'Liegt nur in diesem Browser. Melde dich an, um ihn zu speichern, zu teilen und in der Community zu zeigen.';
    const tone = t.tone === 'draft' ? 'warn' : t.tone === 'saved' ? 'ok' : 'shared';
    return html`<span class="chip status toern ${tone}" title=${`${t.title} – ${t.status}. ${hint}`}>
      ${icon(t.icon)}<span class="t">${t.title}</span><span class="st"><span class="full">· ${t.status}</span><span class="short">· ${t.short}</span></span>
      <button class="x" type="button" title="Törn schließen" aria-label=${`Törn schließen: ${t.title}`} @click=${() => emit(this, 'sx-toern-close')}>${icon('x')}</button>
    </span>`;
  }

  render() {
    return html`
      <a class="brand" href="/" aria-label="${APP_NAME} – Startseite" @click=${this.onBrand}>
        <span class="mark">${logo()}</span><span class="name">${APP_NAME}</span>
      </a>
      ${this.nav()}
      ${this.chip()}
      <span class="spacer"></span>
      <div class="actions">
        <sx-compose .draft=${this.draft}></sx-compose>
        ${this.hasTracks && this.home && !this.backend
          ? html`<button class="btn collapse" @click=${() => emit(this, 'sx-track-view')} title="Zurück zur Törn-Ansicht">
              ${icon('map')}<span class="label-text">Mein Törn</span>
            </button>`
          : nothing}
        ${this.hasTracks && this.backend && !this.saved && this.mode.kind === 'local'
          ? html`<button class="btn collapse save" @click=${() => emit(this, 'sx-save')} title="Im Konto speichern – teilen kannst du danach">
              ${icon('check')}<span class="label-text">Speichern</span>
            </button>`
          : nothing}
        ${this.hasTracks
          ? html`<button class="btn primary share keep" @click=${() => emit(this, 'sx-share')} title="Als Link oder Bild teilen">
              ${icon('share')}<span class="label-text">Teilen</span>
            </button>`
          : nothing}
        ${this.user?.admin
          ? html`<a class="btn ghost collapse" href="/admin" title="Admin-Bereich" aria-label="Admin-Bereich">${icon('lock')}<span class="label-text">Admin</span></a>`
          : nothing}
        ${this.backend
          ? this.user
            ? html`<button
                  class="btn ghost icon bell"
                  data-bell
                  aria-expanded=${this.bellOpen ? 'true' : 'false'}
                  @click=${() => emit(this, 'sx-notifications')}
                  title="Benachrichtigungen"
                  aria-label=${this.bell ? `Benachrichtigungen, ${this.bell} ungelesen` : 'Benachrichtigungen'}
                >
                  ${icon('bell')}${this.bell ? html`<span class="badge" aria-hidden="true">${this.bell}</span>` : nothing}
                </button>
                <sx-account-menu .user=${this.user}></sx-account-menu>`
            : html`<button class="btn login keep" @click=${() => emit(this, 'sx-login')} title="Per E-Mail-Link anmelden – Tracks speichern und teilen">
                ${icon('user')}<span class="label-text">Anmelden</span>
              </button>`
          : nothing}
      </div>
    `;
  }
}
customElements.define('sx-topbar', SxTopbar);
