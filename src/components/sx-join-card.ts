import { LitElement, css, html } from 'lit';
import type { AccountTab } from './sx-account-dialog';
import { icon, type IconName } from './icons';
import { base, emit } from './shared';

interface Perk {
  icon: IconName;
  title: string;
  text: string;
  /** nur zeigen, wenn Unterstützen angeboten wird (Stripe eingerichtet) */
  support?: true;
}

/** Wozu man sich anmeldet (Konzept 12.6) – Reihenfolge = Gewicht. */
export const PERKS: Perk[] = [
  { icon: 'share', title: 'Törns speichern und teilen', text: 'öffentlich als Link oder Bild, in der Community sichtbar' },
  { icon: 'pennant', title: 'Verein oder Team', text: 'beitreten oder gründen: Neuigkeiten, Beiträge, gemeinsame Boote' },
  { icon: 'anchor', title: 'Heimathafen', text: 'sehen, was in deinem Hafen gesegelt wird' },
  { icon: 'heart', title: 'Folgen und reagieren', text: 'Seglerinnen, Booten und Häfen folgen, Törns feiern' },
  { icon: 'mail', title: 'Freunde einladen', text: 'mit einem Link, ihr folgt euch dann gegenseitig' },
  { icon: 'camera', title: 'Als Unterstützer:in mehr', text: 'Fotos am Track, private Törns und Links, mehr Platz', support: true },
  { icon: 'lock', title: 'Ohne Passwort', text: 'Anmeldung per E-Mail-Link, Code oder Passkey' },
];

/**
 * Seitenleiste der Startseite „Mitmachen“ (Konzept 12.6, F-261): Gästen, wozu die Anmeldung gut ist (mit Knopf),
 * Angemeldeten die nächsten Schritte. Rein präsentational; meldet `sx-login` bzw. `sx-account` (Reiter).
 */
export class SxJoinCard extends LitElement {
  static properties = {
    signedIn: { type: Boolean, attribute: 'signed-in' },
    supportOffered: { type: Boolean, attribute: 'support-offered' },
  };
  declare signedIn: boolean;
  /** Unterstützen ist eingerichtet – sonst keine Vorteile bewerben, die man nicht bekommen kann */
  declare supportOffered: boolean;

  constructor() {
    super();
    this.signedIn = false;
    this.supportOffered = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      section {
        padding: var(--s-4);
        border-radius: var(--radius-l);
        background: var(--overlay);
        backdrop-filter: blur(10px) saturate(1.2);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-1);
      }
      h2 {
        margin: 0 0 var(--s-1);
        font-size: var(--fs-l);
      }
      .lead {
        margin: 0 0 var(--s-3);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      ul {
        list-style: none;
        margin: 0 0 var(--s-3);
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      li {
        display: grid;
        grid-template-columns: 22px 1fr;
        gap: var(--s-2);
        align-items: start;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      li svg {
        width: 20px;
        height: 20px;
        color: var(--accent);
      }
      li strong {
        display: block;
        color: var(--text);
        font-weight: 650;
      }
      .btn.primary {
        width: 100%;
        min-height: max(44px, var(--control-h));
      }
      .steps {
        display: grid;
        gap: var(--s-1);
      }
      .steps a,
      .steps button {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 40px;
        padding: 0 var(--s-2);
        border: 0;
        border-radius: var(--radius);
        background: none;
        color: var(--text);
        font: inherit;
        font-size: var(--fs-s);
        text-align: left;
        text-decoration: none;
        cursor: pointer;
      }
      .steps a:hover,
      .steps button:hover {
        background: var(--surface-hover);
      }
      .steps svg {
        width: 18px;
        height: 18px;
        color: var(--accent);
      }
    `,
  ];

  private guest() {
    return html`<section aria-labelledby="join-t">
      <h2 id="join-t">Mitmachen – kostenlos</h2>
      <p class="lead">Ansehen geht ohne Konto. Mit Anmeldung kannst du:</p>
      <ul>
        ${PERKS.filter((p) => !p.support || this.supportOffered).map((p) => html`<li>${icon(p.icon)}<span><strong>${p.title}</strong>${p.text}</span></li>`)}
      </ul>
      <button class="btn primary" @click=${() => emit(this, 'sx-login')}>${icon('user')} Anmelden &amp; mitmachen</button>
    </section>`;
  }

  /** Angemeldet: Wege zum Eigenen – Heimathafen, Verein und Einladen stehen schon in der Willkommens-Karte (14.3). */
  private member() {
    const account = (tab: AccountTab) => () => emit(this, 'sx-account', tab);
    return html`<section aria-labelledby="join-t">
      <h2 id="join-t">Dein Bereich</h2>
      <div class="steps">
        <button @click=${account('shares')}>${icon('share')} Deine Törns und Freigaben</button>
        <button @click=${account('boats')}>${icon('sail')} Deine Boote</button>
        <button @click=${account('profile')}>${icon('user')} Profil, Verein und Heimathafen</button>
        <a href="/entdecken#vereine">${icon('pennant')} Alle Vereine und Teams</a>
      </div>
    </section>`;
  }

  render() {
    return this.signedIn ? this.member() : this.guest();
  }
}
customElements.define('sx-join-card', SxJoinCard);
