import { LitElement, css, html } from 'lit';
import type { User } from '../services/api';
import { icon } from './icons';
import { badgeStyles, base, emit, menuStyles } from './shared';
import { openReportsLabel, reportBadge } from '../domain/report-decisions';
import { MenuController } from './menu-controller';
import { LOGBOOK_PATH } from '../services/url-state';


/**
 * Konto-Menü am Avatar oben rechts (F-428): der eine Weg zu „Meine Seite“, „Mein Fahrtenbuch“ (Verwaltungsbereich
 * `/konto/fahrtenbuch`, F-459) und „Konto & Einstellungen“ (Menü-Muster wie sx-page-menu, mobil als Sheet). Ohne Profil
 * führt „Meine Seite“ zum Anlegen des Profils im Konto; das Fahrtenbuch braucht kein Profil. Meldet `sx-account` { tab? }.
 * Admins mit offenen Meldungen (F-571): Zähler am Knopf; „Konto & Einstellungen“ nennt sie und öffnet dann den Reiter
 * „Meldungen“ – kein zusätzlicher Eintrag (UX N1).
 */
export class SxAccountMenu extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    user: { attribute: false },
  };
  declare open: boolean;
  declare user: User | null;

  constructor() {
    super();
    this.open = false;
    this.user = null;
  }

  static styles = [
    base,
    menuStyles,
    badgeStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      .toggle {
        position: relative;
      }
      .toggle .badge {
        position: absolute;
        top: 0;
        right: -4px;
        pointer-events: none;
      }
      .item small.warn {
        color: var(--err);
        font-weight: 650;
      }
      @media (min-width: 761px) {
        .menu {
          top: calc(100% + var(--s-2));
        }
      }
      @media (max-width: 760px) {
        .menu {
          padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom, 0px));
        }
      }
      a.item {
        text-decoration: none;
      }
    `,
  ];

  /** Klick daneben, Fokus weg, Escape schließen; Fokus beim Öffnen und Schließen. */
  private menu = new MenuController(this);

  private account(tab?: string) {
    this.open = false;
    emit(this, 'sx-account', tab);
  }

  /** Eintrag als Link (mit Profil) bzw. Knopf zum Anlegen des Profils (ohne). */
  private item(label: string, ic: 'user' | 'book', href: string | null) {
    const body = html`<span class="mark">${icon(ic)}</span><span>${label}${href ? '' : html`<small>erst Profil anlegen</small>`}</span>`;
    return href
      ? html`<a class="item" href=${href} @click=${() => (this.open = false)}>${body}</a>`
      : html`<button class="item" type="button" @click=${() => this.account('profile')}>${body}</button>`;
  }

  render() {
    const u = this.user;
    if (!u) return '';
    const handle = u.handle ?? null;
    const letter = (u.displayName || u.email)[0] ?? '?';
    const badge = u.admin ? reportBadge(u.openReports) : '';
    const pending = openReportsLabel(badge);
    return html`<div @keydown=${this.menu.onKey} @focusout=${this.menu.onFocusOut}>
      <button class="btn ghost icon toggle" type="button" aria-haspopup="true" aria-expanded=${this.open} aria-controls="am"
        title="Mein Bereich (${u.displayName || u.email})${pending ? ` – ${pending}` : ''}"
        aria-label=${pending ? `Mein Bereich, ${pending}` : 'Mein Bereich'} @click=${() => (this.open = !this.open)}>
        <span class="avatar">${letter}</span>${badge ? html`<span class="badge" aria-hidden="true">${badge}</span>` : ''}
      </button>
      <div class="menu" id="am" role="group" aria-labelledby="am-h" ?hidden=${!this.open}>
        <p class="title" id="am-h">${u.displayName || u.email}</p>
        ${this.item('Meine Seite', 'user', handle ? `/u/${handle}` : null)}
        ${this.item('Mein Fahrtenbuch', 'book', LOGBOOK_PATH)}
        <hr />
        <button class="item" type="button" @click=${() => this.account(badge ? 'reports' : undefined)}>
          <span class="mark">${icon('sliders')}</span><span>Konto &amp; Einstellungen${badge ? html`<small class="warn">${pending}</small>` : ''}</span>
        </button>
      </div>
    </div>`;
  }
}
customElements.define('sx-account-menu', SxAccountMenu);
