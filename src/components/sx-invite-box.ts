import { LitElement, html, css, type PropertyValues } from 'lit';
import type { InviteTo, PendingInvite } from '../services/api';
import { fmtDate } from '../util/html';
import { icon } from './icons';
import { base, emit, inviteTarget, pendingLabel } from './shared';
import { inviteShareText, inviteShareTitle } from '../domain/invite-text';
import { isInviteLink } from '../domain/invite-link';

/** Auswahl „Einladen als …“ (z. B. Rolle in der Crew); die Werte versteht nur die einbettende Komponente. */
export interface InviteRoleChoice {
  value: string;
  label: string;
}

/**
 * Was „Einladen“ meldet: Ziel (null = Einladungslink) und, falls es eine Auswahl gibt, die Rolle. `done` ruft der
 * Ablauf nach Erfolg auf – erst dann leert sich das Adressfeld (bei Fehlern bleibt die Eingabe zum Korrigieren).
 */
export interface InviteCreateDetail {
  to: InviteTo | null;
  role?: string;
  done: () => void;
}

/** Hinweis unter dem Adressfeld, gleich für alle Einladungsarten mit Profilnamen. */
export const RECIPIENT_HINT =
  'Per E-Mail erreichst du neue und bestehende Konten; wer schon dabei ist, findet die Einladung auch im Konto. Bestehende Segler:innen kannst du auch über ihren Profilnamen einladen.';

/** Teilen-Menü des Geräts vorhanden? (am Desktop meist nicht – dann das Mail-Programm) */
const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Ein Einladungsmuster für alle Einladungsarten (UX-NAVIGATION B15, F-590): Crew, Gruppe, Boots-Admin und Freunde.
 * Reihenfolge: Hinweise (Slot) · „Einladen als“ (nur mit `roles`) · Einladungslink erzeugen bzw. der frische Link mit
 * Kopieren und Teilen (Teilen-Menü des Geräts, sonst Mail-Programm, F-591) · per E-Mail oder Profilname · offene
 * Einladungen mit Zurückziehen. Rein darstellend: Daten kommen als Properties, Aktionen gehen als Events raus.
 *
 * Events am Element selbst (ohne bubbles – die einbettende Komponente übersetzt sie in ihr eigenes Event):
 *  `invite-create` { to, role? }, `invite-revoke` { id }.
 * Für alle gleich und global (bubbles, composed): `sx-invite-copy` (Link), `sx-invite-share` { url, title, text }.
 */
export class SxInviteBox extends LitElement {
  static properties = {
    link: { type: String },
    linkNote: { type: String, attribute: 'link-note' },
    noLink: { type: Boolean, attribute: 'no-link' },
    roles: { attribute: false },
    role: { type: String },
    roleLabel: { type: String, attribute: 'role-label' },
    pending: { attribute: false },
    busy: { type: Boolean },
    shareTitle: { type: String, attribute: 'share-title' },
    shareText: { type: String, attribute: 'share-text' },
    recipientLabel: { type: String, attribute: 'recipient-label' },
  };
  /** frisch erzeugter Einladungslink – das Token gibt es nur dieses eine Mal */
  declare link: string;
  /** Gültigkeit und Grenzen des Links („Nur jetzt sichtbar · 14 Tage gültig …“) */
  declare linkNote: string;
  /** keine Einladungslinks (Boots-Admins: nur gezielt per E-Mail oder Profilname) */
  declare noLink: boolean;
  /** Auswahl „Einladen als“; leer = keine Auswahl */
  declare roles: readonly InviteRoleChoice[];
  /** gewählte Rolle (Vorgabe von außen, danach Auswahl hier) */
  declare role: string;
  declare roleLabel: string;
  /** offene Einladungen (mit Zurückziehen); leer = keine Liste */
  declare pending: PendingInvite[];
  declare busy: boolean;
  /** Betreff/Titel und Begleittext beim Teilen (aus `invite-text.ts`) */
  declare shareTitle: string;
  declare shareText: string;
  declare recipientLabel: string;

  constructor() {
    super();
    this.link = '';
    this.linkNote = '';
    this.noLink = false;
    this.roles = [];
    this.role = '';
    this.roleLabel = 'Rolle für Einladungen';
    this.pending = [];
    this.busy = false;
    this.shareTitle = '';
    this.shareText = '';
    this.recipientLabel = 'E-Mail-Adresse oder Profilname';
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
        min-width: 0;
      }
      .row {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        flex-wrap: wrap;
        min-width: 0;
      }
      .label {
        font-size: var(--fs-s);
        font-weight: 600;
        color: var(--text-2);
      }
      .sub {
        margin: 0;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .link-in {
        font-family: var(--font-mono);
        font-size: var(--fs-s);
        flex: 1 1 12rem;
        min-width: 0;
      }
      form {
        display: flex;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      form input {
        flex: 1 1 12rem;
        min-width: 0;
      }
      select {
        width: auto;
        max-width: 100%;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-1);
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      li .name {
        flex: 1 1 10rem;
        min-width: 0;
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        overflow-wrap: anywhere;
      }
      li .name svg {
        width: 15px;
        height: 15px;
        flex: none;
        color: var(--accent);
      }
      a.btn {
        text-decoration: none;
      }
      /* Tippziele ≥ 44 px (UX N11) */
      @media (pointer: coarse), (max-width: 760px) {
        .btn,
        select,
        input {
          min-height: 44px;
        }
      }
    `,
  ];

  /** Rolle, mit der der gezeigte Link erzeugt wurde (Hinweis, wenn danach eine andere gewählt wird) */
  private linkRole = '';

  private currentRole() {
    return this.role || this.roles[0]?.value || '';
  }

  private create(to: InviteTo | null, done: () => void = () => {}) {
    const role = this.currentRole();
    if (!to) this.linkRole = role;
    const detail: InviteCreateDetail = this.roles.length ? { to, role, done } : { to, done };
    this.dispatchEvent(new CustomEvent<InviteCreateDetail>('invite-create', { detail }));
  }

  private submit(e: Event) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
    if (!input.value.trim()) return;
    const sent = input.value;
    // erst nach Erfolg leeren (F-590) – und nur, wenn inzwischen nichts Neues eingetippt wurde
    this.create(inviteTarget(input.value), () => {
      if (input.value === sent) input.value = '';
    });
  }

  /** Neuer Link: Fokus auf „Kopieren“, damit Tastatur und Screenreader beim Ergebnis landen. */
  updated(changed: PropertyValues<this>) {
    if (changed.has('link') && this.link && !changed.get('link')) this.renderRoot.querySelector<HTMLButtonElement>('button.copy')?.focus();
  }

  /** Mail-Programm mit Betreff und Text samt Link – ohne Server, ohne Zählung; nur für eigene Einladungslinks. */
  private mailHref(): string | null {
    if (!isInviteLink(this.link, location.origin)) return null;
    const body = `${this.shareText}\n\n${this.link}`.trim();
    return `mailto:?subject=${encodeURIComponent(this.shareTitle)}&body=${encodeURIComponent(body)}`;
  }

  /** Teilen-Menü des Geräts, sonst Mail-Programm (F-591). */
  private sendButton() {
    if (canShare()) {
      return html`<button class="btn" type="button" @click=${() => emit(this, 'sx-invite-share', { url: this.link, title: this.shareTitle, text: this.shareText })}>${icon('share')} Teilen</button>`;
    }
    const href = this.mailHref();
    return href ? html`<a class="btn" href=${href}>${icon('mail')} Per Mail senden</a>` : '';
  }

  private roleRow() {
    if (!this.roles.length) return '';
    const value = this.role || this.roles[0].value;
    return html`<div class="row"><span class="label">Einladen als</span>
      <select aria-label=${this.roleLabel} .value=${value} ?disabled=${this.busy} @change=${(e: Event) => (this.role = (e.target as HTMLSelectElement).value)}>
        ${this.roles.map((r) => html`<option value=${r.value} ?selected=${r.value === value}>${r.label}</option>`)}
      </select></div>`;
  }

  private linkPart() {
    if (this.noLink) return '';
    if (!this.link) {
      return html`<div><button class="btn" type="button" ?disabled=${this.busy} @click=${() => this.create(null)}>${icon('link')} Einladungslink erzeugen</button></div>`;
    }
    return html`<div class="label">Einladungslink</div>
      <div class="row">
        <input class="link-in" type="text" readonly .value=${this.link} aria-label="Einladungslink" @focus=${(e: Event) => (e.target as HTMLInputElement).select()} />
      </div>
      <div class="row">
        <button class="btn copy" type="button" @click=${() => emit(this, 'sx-invite-copy', this.link)}>${icon('copy')} Kopieren</button>
        ${this.sendButton()}
      </div>
      ${this.linkNote ? html`<p class="sub">${this.linkNote}</p>` : ''}
      ${this.roles.length && this.linkRole && this.linkRole !== this.currentRole()
        ? html`<p class="sub" role="note">Der Link lädt als ${this.roles.find((r) => r.value === this.linkRole)?.label ?? this.linkRole} ein. „Einladen als“ gilt jetzt nur für E-Mail und Profilname.</p>`
        : ''}`;
  }

  private pendingList() {
    if (!this.pending.length) return '';
    return html`<div class="label">Offene Einladungen</div>
      <ul aria-label="Offene Einladungen">
        ${this.pending.map(
          (i) => html`<li>
            <span class="name">${icon(i.invitee ? 'user' : i.email ? 'mail' : 'link')}<span>${pendingLabel(i)}</span></span>
            <span class="sub">bis ${fmtDate(i.expiresAt)}</span>
            <button class="btn ghost" type="button" ?disabled=${this.busy} aria-label="Einladung zurückziehen: ${pendingLabel(i)}"
              @click=${() => this.dispatchEvent(new CustomEvent('invite-revoke', { detail: { id: i.id } }))}>Zurückziehen</button>
          </li>`,
        )}
      </ul>`;
  }

  render() {
    return html`<slot></slot>
      ${this.roleRow()}
      ${this.linkPart()}
      <form @submit=${this.submit}>
        <input type="text" required maxlength="254" placeholder="E-Mail oder Profilname" aria-label=${this.recipientLabel} autocomplete="off" />
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('mail')} Einladen</button>
      </form>
      <p class="sub">${RECIPIENT_HINT}</p>
      ${this.pendingList()}`;
  }
}
customElements.define('sx-invite-box', SxInviteBox);

/**
 * „Freunde einladen“ (Konzept 14.2) – dieselbe Box in der Willkommens-Karte und auf der eigenen Seite (F-592):
 * ohne Rolle und ohne Liste offener Einladungen; meldet `sx-friend-invite` { to, done } am einbettenden Element.
 * `busy` sperrt „Einladungslink erzeugen“, solange ein Aufruf läuft (kein doppelter Link).
 */
export function friendInviteBox(host: HTMLElement, link: string | null, busy = false) {
  return html`<sx-invite-box .link=${link ?? ''} ?busy=${busy}
    link-note="Nur jetzt sichtbar · 14 Tage gültig · bis zu 20 Personen. Wer annimmt, folgt dir – und du ihm."
    share-title=${inviteShareTitle()} share-text=${inviteShareText({ kind: 'friend', target: null })}
    @invite-create=${(e: CustomEvent<InviteCreateDetail>) => emit(host, 'sx-friend-invite', { to: e.detail.to, done: e.detail.done })}></sx-invite-box>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'sx-invite-box': SxInviteBox;
  }
}
