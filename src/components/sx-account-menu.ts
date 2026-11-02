import { LitElement, css, html } from 'lit';
import type { User } from '../services/api';
import { icon } from './icons';
import { base, emit, menuStyles } from './shared';
import { MenuController } from './menu-controller';

/** Adresse des Fahrtenbuchs auf der eigenen Seite (Reiter in „Mein Verlauf“, F-428). */
export const logbookPath = (handle: string) => `/u/${handle}?bereich=fahrtenbuch`;

/**
 * Konto-Menü am Avatar oben rechts (F-428): der eine Weg zu „Meine Seite“, „Mein Fahrtenbuch“ und „Konto &
 * Einstellungen“ (Menü-Muster wie sx-page-menu, mobil als Sheet). Ohne Profil führen „Meine Seite“ und „Mein
 * Fahrtenbuch“ zum Anlegen des Profils im Konto. Meldet `sx-account` { tab? }.
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
    return html`<div @keydown=${this.menu.onKey} @focusout=${this.menu.onFocusOut}>
      <button class="btn ghost icon toggle" type="button" aria-haspopup="true" aria-expanded=${this.open} aria-controls="am"
        title="Mein Bereich (${u.displayName || u.email})" aria-label="Mein Bereich" @click=${() => (this.open = !this.open)}>
        <span class="avatar">${letter}</span>
      </button>
      <div class="menu" id="am" role="group" aria-labelledby="am-h" ?hidden=${!this.open}>
        <p class="title" id="am-h">${u.displayName || u.email}</p>
        ${this.item('Meine Seite', 'user', handle ? `/u/${handle}` : null)}
        ${this.item('Mein Fahrtenbuch', 'book', handle ? logbookPath(handle) : null)}
        <hr />
        <button class="item" type="button" @click=${() => this.account()}><span class="mark">${icon('gear')}</span><span>Konto &amp; Einstellungen</span></button>
      </div>
    </div>`;
  }
}
customElements.define('sx-account-menu', SxAccountMenu);
