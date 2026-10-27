import { LitElement, css, html } from 'lit';
import { icon } from './icons';
import { base } from './shared';

/** Das von Chrome/Edge (Android) gelieferte Installations-Ereignis – nicht in den DOM-Typen enthalten. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'sx-install-dismissed';

// Früh registrieren: Chrome feuert beforeinstallprompt ggf. vor dem ersten Rendern der Komponente.
let deferred: InstallPromptEvent | null = null;
/** „Nicht jetzt“ in dieser Sitzung – falls localStorage fehlt */
let dismissedNow = false;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // eigener, dezenter Hinweis statt der Browser-Leiste
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Läuft die Seite schon als installierte App? */
export const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone/iPad in Safari: kein Installations-Ereignis, Hinzufügen nur über „Teilen“. */
export function isIosSafari(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function dismissed(): boolean {
  if (dismissedNow) return true;
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * „Zum Home-Bildschirm hinzufügen“ auf Handys und Tablets: Android/Chrome mit Installieren-Knopf (eigenes
 * beforeinstallprompt), iOS-Safari mit kurzer Anleitung über „Teilen“. Erscheint nicht in der installierten App, nicht
 * auf Geräten mit Maus und nach „Nicht jetzt“ nie wieder (pro Gerät). Kommt erst nach einigen Sekunden.
 */
export class SxInstallHint extends LitElement {
  static properties = {
    mode: { state: true },
    delayMs: { type: Number, attribute: 'delay-ms' },
  };
  /** android: Installieren-Knopf; ios: Anleitung; null: nichts anzeigen */
  declare mode: 'android' | 'ios' | null;
  declare delayMs: number;
  private ready = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private update$ = () => this.decide();

  constructor() {
    super();
    this.mode = null;
    this.delayMs = 6000;
  }

  static styles = [
    base,
    css`
      /* Über Karte (Leaflet bis 1000), Startseite (800) und „Track anlegen“ (900), unter Toasts (3000); oberhalb des
         runden Knopfs „Track anlegen“ (56 px unten rechts), damit beide bedienbar bleiben. */
      :host {
        position: fixed;
        left: var(--s-3);
        right: var(--s-3);
        bottom: calc(var(--s-4) + 56px + var(--s-3) + env(safe-area-inset-bottom, 0px));
        z-index: 1100;
        display: block;
      }
      :host([hidden]) {
        display: none;
      }
      .card {
        display: flex;
        gap: var(--s-3);
        align-items: center;
        max-width: 520px;
        margin: 0 auto;
        padding: var(--s-3);
        border-radius: var(--radius-l);
        background: var(--surface);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-2);
      }
      img {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        flex: none;
      }
      .txt {
        flex: 1;
        min-width: 0;
        font-size: var(--fs-s);
      }
      .txt b {
        display: block;
      }
      .share {
        display: inline-flex;
        vertical-align: -3px;
      }
      .share svg {
        width: 16px;
        height: 16px;
      }
      .row {
        display: flex;
        gap: var(--s-2);
        flex: none;
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    listeners.add(this.update$);
    this.timer = setTimeout(() => {
      this.ready = true;
      this.decide();
    }, this.delayMs);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    listeners.delete(this.update$);
    if (this.timer) clearTimeout(this.timer);
  }

  /** Welcher Hinweis passt gerade? Nie in Einbettungen (iframe, ?embed). */
  private decide() {
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const embedded = window.top !== window || new URLSearchParams(location.search).has('embed');
    if (!this.ready || !touch || embedded || isStandalone() || dismissed()) {
      this.mode = null;
      return;
    }
    this.mode = deferred ? 'android' : isIosSafari() ? 'ios' : null;
  }

  private dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ohne Speicher bleibt es für diese Sitzung ausgeblendet
      dismissedNow = true;
    }
    this.mode = null;
  }

  private async install() {
    const e = deferred;
    if (!e) return;
    // Das Ereignis gilt nur einmal – danach (oder bei einem Fehler) nicht erneut anbieten.
    deferred = null;
    try {
      await e.prompt();
      if ((await e.userChoice).outcome === 'accepted') this.mode = null;
      else this.dismiss();
    } catch {
      this.mode = null;
    }
  }

  willUpdate() {
    this.hidden = !this.mode;
  }

  render() {
    if (!this.mode) return '';
    return html`<div class="card" role="region" aria-label="App installieren">
      <img src="/icons/icon-192.png" alt="" />
      <div class="txt">
        <b>Sail Explorer als App</b>
        ${this.mode === 'android'
          ? 'Auf den Home-Bildschirm legen – startet wie eine App, ohne Browserleiste.'
          : html`Tippe auf <span class="share" aria-label="Teilen">${icon('iosShare')}</span> „Teilen“ und dann auf „Zum Home-Bildschirm“.`}
      </div>
      <div class="row">
        ${this.mode === 'android' ? html`<button class="btn small primary" @click=${() => this.install()}>Installieren</button>` : ''}
        <button class="btn small ghost icon" aria-label="Nicht jetzt" @click=${() => this.dismiss()}>${icon('x')}</button>
      </div>
    </div>`;
  }
}
customElements.define('sx-install-hint', SxInstallHint);
