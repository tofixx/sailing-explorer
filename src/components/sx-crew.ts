import { LitElement, html, css } from 'lit';
import type { Crew, PendingInvite, Visibility } from '../services/api';
import { fmtDate } from '../util/html';
import { icon } from './icons';
import { base, emit, inviteTarget, pendingLabel } from './shared';

/**
 * Crew eines geteilten Törns (Konzept 10.6/10.7) – reine Darstellung, Aktionen gehen als Events raus.
 * Besucher: Namen mit Profil-Link und „+ n weitere“. Eigentümer: entfernen, Einladungslink, per E-Mail einladen,
 * offene Einladungen. Crew-Mitglieder: „Mich entfernen“.
 */
export class SxCrew extends LitElement {
  static properties = {
    crew: { attribute: false },
    isOwner: { type: Boolean },
    visibility: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    newLink: { type: String },
    confirm: { state: true },
  };
  declare crew: Crew | null;
  declare isOwner: boolean;
  /** Sichtbarkeit des Törns – Crew erscheint für andere nur bei „Öffentlich“ */
  declare visibility: Visibility;
  declare busy: boolean;
  declare error: string;
  /** gerade erzeugter Einladungslink – das Token gibt es nur dieses eine Mal */
  declare newLink: string;
  /** Bestätigung offen: Nutzer-ID (entfernen) oder "me" (selbst entfernen) */
  declare confirm: string | null;

  constructor() {
    super();
    this.crew = null;
    this.isOwner = false;
    this.visibility = 'public';
    this.busy = false;
    this.error = '';
    this.newLink = '';
    this.confirm = null;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
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
        min-height: var(--control-h-s);
        flex-wrap: wrap;
      }
      li .name {
        flex: 1;
        min-width: 8rem;
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
      }
      li .name svg {
        width: 15px;
        height: 15px;
        color: var(--accent);
      }
      a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      .muted-row {
        color: var(--text-2);
        font-size: var(--fs-s);
      }
      form,
      .linkrow {
        display: flex;
        gap: var(--s-2);
      }
      .linkrow input {
        font-family: var(--font-mono);
        font-size: var(--fs-s);
      }
      .confirm {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        flex-wrap: wrap;
        font-size: var(--fs-s);
      }
      .error {
        color: var(--err);
        font-size: var(--fs-s);
        margin: 0;
      }
      .note {
        margin: 0;
        font-size: var(--fs-s);
        color: var(--text-2);
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
      }
      .note svg {
        width: 15px;
        height: 15px;
        flex: none;
      }
      .sub {
        margin: 0;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
    `,
  ];

  private invite(e: Event) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
    emit(this, 'sx-crew-invite', { to: inviteTarget(input.value) });
    input.value = '';
  }

  private confirmRow(text: string, action: () => void) {
    return html`<div class="confirm" role="alert">
      <span>${text}</span>
      <button class="btn small danger" type="button" @click=${() => {
        this.confirm = null;
        action();
      }}>${icon('trash')} Ja, entfernen</button>
      <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>
    </div>`;
  }

  private members(c: Crew) {
    if (!c.members.length && !c.others) {
      return html`<p class="sub">${this.isOwner ? 'Noch niemand in der Crew. Lade Mitsegler per Link oder E-Mail ein.' : 'Keine Crew eingetragen.'}</p>`;
    }
    return html`<ul>
      ${c.members.map(
        (m) => html`<li>
          <span class="name">${icon('user')}${m.handle ? html`<a href="/u/${m.handle}">${m.displayName}</a>` : html`<span>${m.displayName || 'Segler:in'}</span>`}</span>
          ${this.isOwner && m.id
            ? this.confirm === m.id
              ? this.confirmRow(`${m.displayName || 'Diese Person'} aus der Crew entfernen?`, () => emit(this, 'sx-crew-remove', { userId: m.id }))
              : html`<button class="btn ghost small icon danger" title="Entfernen" aria-label="Aus der Crew entfernen: ${m.displayName}" ?disabled=${this.busy} @click=${() => (this.confirm = m.id)}>${icon('x')}</button>`
            : ''}
        </li>`,
      )}
      ${c.others ? html`<li class="muted-row">+ ${c.others} ${c.others === 1 ? 'weitere Person' : 'weitere Personen'} ohne öffentliches Profil</li>` : ''}
    </ul>`;
  }

  private pending(list: PendingInvite[]) {
    if (!list.length) return '';
    return html`<div class="label">Offene Einladungen</div>
      <ul>
        ${list.map(
          (i) => html`<li>
            <span class="name">${icon(i.invitee ? 'user' : i.email ? 'mail' : 'link')}<span>${pendingLabel(i)}</span></span>
            <span class="sub">bis ${fmtDate(i.expiresAt)}</span>
            <button class="btn ghost small" ?disabled=${this.busy} aria-label="Einladung zurückziehen: ${pendingLabel(i)}" @click=${() => emit(this, 'sx-invite-revoke', { id: i.id, scope: 'crew' })}>Zurückziehen</button>
          </li>`,
        )}
      </ul>`;
  }

  private ownerTools(c: Crew) {
    return html`
      ${this.visibility !== 'public' ? html`<p class="note">${icon('lock')}<span>Die Crew sehen andere erst, wenn der Törn öffentlich ist.</span></p>` : ''}
      ${this.newLink
        ? html`<div class="label">Einladungslink (14 Tage gültig, wird nur jetzt angezeigt)</div>
            <div class="linkrow">
              <input type="text" readonly .value=${this.newLink} aria-label="Einladungslink" @focus=${(e: Event) => (e.target as HTMLInputElement).select()} />
              <button class="btn small" type="button" @click=${() => emit(this, 'sx-invite-copy', this.newLink)}>${icon('copy')} Kopieren</button>
            </div>`
        : html`<div><button class="btn small" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-crew-invite', { to: null })}>${icon('link')} Einladungslink erzeugen</button></div>`}
      <form @submit=${this.invite}>
        <input type="text" required maxlength="254" placeholder="E-Mail oder Profilname" aria-label="E-Mail-Adresse oder Profilname" autocomplete="off" />
        <button class="btn small primary" type="submit" ?disabled=${this.busy}>${icon('mail')} Einladen</button>
      </form>
      <p class="sub">Per E-Mail erreichst du neue und bestehende Konten; wer schon dabei ist, findet die Einladung auch im Konto. Bestehende Segler:innen kannst du auch über ihren Profilnamen einladen.</p>
      ${this.pending(c.invites)}
    `;
  }

  render() {
    const c = this.crew;
    if (!c) return html`<p class="sub">Lade …</p>`;
    return html`
      ${this.members(c)}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      ${this.isOwner ? this.ownerTools(c) : ''}
      ${!this.isOwner && c.isCrew
        ? this.confirm === 'me'
          ? this.confirmRow('Dich aus der Crew dieses Törns entfernen?', () => emit(this, 'sx-crew-leave'))
          : html`<div><button class="btn small ghost danger" type="button" ?disabled=${this.busy} @click=${() => (this.confirm = 'me')}>${icon('logout')} Mich aus der Crew entfernen</button></div>`
        : ''}
    `;
  }
}
customElements.define('sx-crew', SxCrew);
