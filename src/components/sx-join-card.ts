import { LitElement, css, html } from 'lit';
import { icon, type IconName } from './icons';
import { base, emit } from './shared';

interface Perk {
  icon: IconName;
  title: string;
  text: string;
}

/** Wozu man sich anmeldet (Konzept 12.6) – Reihenfolge = Gewicht. */
export const PERKS: Perk[] = [
  { icon: 'share', title: 'Törns speichern und teilen', text: 'als Link oder Bild – öffentlich, nur mit Link oder nur für dich' },
  { icon: 'pennant', title: 'Verein oder Team', text: 'beitreten oder gründen: Neuigkeiten, Beiträge, gemeinsame Boote' },
  { icon: 'anchor', title: 'Heimathafen', text: 'sehen, was in deinem Hafen gesegelt wird' },
  { icon: 'heart', title: 'Folgen und reagieren', text: 'Seglerinnen, Booten und Häfen folgen, Törns feiern' },
  { icon: 'mail', title: 'Freunde einladen', text: 'mit einem Link, ihr folgt euch dann gegenseitig' },
  { icon: 'camera', title: 'Fotos zum Törn', text: 'auf der Karte am Track – für Unterstützer:innen' },
  { icon: 'lock', title: 'Ohne Passwort', text: 'Anmeldung per E-Mail-Link, Code oder Passkey' },
];

/**
 * Seitenleiste der Startseite „Mitmachen“ (Konzept 12.6, F-224): Gästen, wozu die Anmeldung gut ist (mit Knopf),
 * Angemeldeten die nächsten Schritte. Rein präsentational; meldet `sx-login` bzw. `sx-account` (Reiter).
 */
export class SxJoinCard extends LitElement {
  static properties = {
    signedIn: { type: Boolean, attribute: 'signed-in' },
  };
  declare signedIn: boolean;

  constructor() {
    super();
    this.signedIn = false;
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
        ${PERKS.map((p) => html`<li>${icon(p.icon)}<span><strong>${p.title}</strong>${p.text}</span></li>`)}
      </ul>
      <button class="btn primary" @click=${() => emit(this, 'sx-login')}>${icon('user')} Anmelden &amp; mitmachen</button>
    </section>`;
  }

  private member() {
    const account = (tab: string) => () => emit(this, 'sx-account', tab);
    return html`<section aria-labelledby="join-t">
      <h2 id="join-t">Was du hier tun kannst</h2>
      <div class="steps">
        <button @click=${account('profile')}>${icon('anchor')} Verein und Heimathafen wählen</button>
        <a href="/entdecken#vereine">${icon('pennant')} Vereine und Teams entdecken</a>
        <a href="/g/neu">${icon('plus')} Verein oder Team gründen</a>
        <button @click=${account('shares')}>${icon('share')} Deine Törns und Freigaben</button>
        <button @click=${account('settings')}>${icon('lock')} Passkey einrichten</button>
      </div>
    </section>`;
  }

  render() {
    return this.signedIn ? this.member() : this.guest();
  }
}
customElements.define('sx-join-card', SxJoinCard);
