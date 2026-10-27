import { LitElement, html, css } from 'lit';
import type { Confirmation, Crew, CrewMember, PendingInvite, Visibility } from '../services/api';
import { SELF_ROLES, VOYAGE_ROLES, VOYAGE_ROLE_LABEL, VOYAGE_ROLE_SHORT, type VoyageRole } from '../domain/crew-roles';
import { fmtDate } from '../util/html';
import { icon } from './icons';
import { base, emit, inviteTarget, pendingLabel } from './shared';

/**
 * Crew eines geteilten Törns (Konzept 10.6/10.7) – reine Darstellung, Aktionen gehen als Events raus.
 * Besucher: Namen mit Profil-Link und „+ n weitere“. Eigentümer: entfernen, Einladungslink, per E-Mail einladen,
 * offene Einladungen. Crew-Mitglieder: „Mich entfernen“. Rollen und Bestätigung durch den Skipper (Konzept 15):
 * Eigentümer setzt alle Rollen, Crew die eigene (nie Skipper), der Skipper bestätigt die anderen.
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
      .chip {
        font-size: var(--fs-s);
        padding: 0 var(--s-2);
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--text-2);
      }
      .ok {
        font-size: var(--fs-s);
        color: var(--ok);
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
      }
      .ok svg {
        width: 13px;
        height: 13px;
      }
      select {
        font: inherit;
        font-size: var(--fs-s);
        min-height: var(--control-h-s);
      }
      .row {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        flex-wrap: wrap;
      }
    `,
  ];

  /** Skipper-Wahl, die auf „Ja“ wartet */
  private pendingSkipper: (() => void) | null = null;

  /** Rolle, als die eingeladen wird (Auswahl neben „Einladen“; gilt auch für den Einladungslink) */
  private inviteRole: VoyageRole = 'crew';

  private invite(e: Event) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
    emit(this, 'sx-crew-invite', { to: inviteTarget(input.value), role: this.inviteRole });
    input.value = '';
  }

  /** Auswahl einer Rolle; `roles` begrenzt, was gewählt werden darf. */
  private roleSelect(value: VoyageRole | null, roles: readonly VoyageRole[], label: string, onPick: (r: VoyageRole) => void, allowEmpty = false) {
    // `.value` stellt nach einem Fehler (z. B. 409) den gespeicherten Wert wieder her.
    return html`<select aria-label=${label} .value=${value ?? ''} ?disabled=${this.busy} @change=${(e: Event) => {
      const v = (e.target as HTMLSelectElement).value as VoyageRole | '';
      if (!v) return;
      // Skipper wechseln hebt alle Bestätigungen auf – erst nach Rückfrage (auch gegen versehentliches Pfeiltasten-Blättern).
      if (v === 'skipper') {
        this.pendingSkipper = () => onPick(v);
        this.confirm = 'skipper';
        return;
      }
      onPick(v);
    }}>
      ${allowEmpty ? html`<option value="" ?selected=${!value}>Rolle wählen …</option>` : ''}
      ${roles.map((r) => html`<option value=${r} ?selected=${r === value}>${VOYAGE_ROLE_LABEL[r]}</option>`)}
    </select>`;
  }

  /** „bestätigt“ mit Name und Datum – der Server liefert das nur Eigentümer, Skipper und der Person selbst. */
  private confirmed(c: Confirmation | null) {
    if (!c) return '';
    return html`<span class="ok" title="Bestätigt am ${fmtDate(c.at)}">${icon('check')} bestätigt${c.by ? ` von ${c.by}` : ''}</span>`;
  }

  /** Skipper: eine Person bestätigen bzw. die Bestätigung zurückziehen (`userId` 'owner' = Eigentümer:in). */
  private confirmButton(userId: string, c: Confirmation | null, name: string) {
    return c
      ? html`<button class="btn ghost small" ?disabled=${this.busy} aria-label="Bestätigung zurückziehen: ${name}" @click=${() => emit(this, 'sx-crew-unconfirm', { userId })}>Zurückziehen</button>`
      : html`<button class="btn small" ?disabled=${this.busy} aria-label="Rolle und Meilen bestätigen: ${name}" @click=${() =>
          emit(this, 'sx-crew-confirm', userId === 'owner' ? { userIds: [], owner: true } : { userIds: [userId], owner: false })}>${icon('check')} Bestätigen</button>`;
  }

  private confirmRow(text: string, action: () => void, yes = html`${icon('trash')} Ja, entfernen`, danger = true) {
    return html`<div class="confirm" role="alert">
      <span>${text}</span>
      <button class="btn small ${danger ? 'danger' : 'primary'}" type="button" @click=${() => {
        this.confirm = null;
        action();
      }}>${yes}</button>
      <button class="btn small" type="button" @click=${() => {
        this.confirm = null;
        this.pendingSkipper = null;
        this.requestUpdate();
      }}>Abbrechen</button>
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
          ${this.memberRole(c, m)}
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

  /** Rolle eines Mitglieds: Auswahl für den Eigentümer, sonst Chip; Bestätigung für Eigentümer und Skipper. */
  private memberRole(c: Crew, m: CrewMember) {
    return html`${this.isOwner && m.id
      ? this.roleSelect(m.role, VOYAGE_ROLES, `Rolle von ${m.displayName || 'Segler:in'}`, (role) => emit(this, 'sx-crew-role', { userId: m.id, role }))
      : m.role ? html`<span class="chip">${VOYAGE_ROLE_SHORT[m.role]}</span>` : ''}
      ${this.confirmed(m.confirmed)}
      ${c.isSkipper && m.id && m.role !== 'skipper' ? this.confirmButton(m.id, m.confirmed, m.displayName) : ''}`;
  }

  /** Eigene Rolle (Eigentümer bzw. Crew-Mitglied) und Werkzeuge des Skippers. */
  private roles(c: Crew) {
    const own = this.isOwner
      ? html`<div class="row"><span class="label">Deine Rolle</span>
          ${this.roleSelect(c.ownerRole, VOYAGE_ROLES, 'Deine Rolle an Bord', (role) => emit(this, 'sx-crew-own-role', { role }), true)}
          ${this.confirmed(c.ownerConfirmed)}</div>`
      : c.me
        ? html`<div class="row"><span class="label">Deine Rolle</span>
            ${c.me.role === 'skipper'
              ? html`<span class="chip">${VOYAGE_ROLE_SHORT.skipper}</span>`
              : this.roleSelect(c.me.role, SELF_ROLES, 'Deine Rolle an Bord', (role) => emit(this, 'sx-crew-role', { userId: 'me', role }))}
            ${this.confirmed(c.me.confirmed)}</div>`
        : '';
    const skipperAsk =
      this.confirm === 'skipper' && this.pendingSkipper
        ? this.confirmRow('Als Skipper:in eintragen? Bestehende Bestätigungen fallen dann weg.', () => {
            this.pendingSkipper?.();
            this.pendingSkipper = null;
          }, html`${icon('check')} Ja, eintragen`, false)
        : '';
    if (!c.isSkipper) return html`${own}${skipperAsk}`;
    return html`${own}${skipperAsk}
      ${!this.isOwner && c.ownerRole
        ? html`<div class="row"><span class="sub">Eigentümer:in · ${VOYAGE_ROLE_SHORT[c.ownerRole]}</span>${this.confirmed(c.ownerConfirmed)}${this.confirmButton('owner', c.ownerConfirmed, 'Eigentümer:in')}</div>`
        : ''}
      ${c.members.length ? html`<div><button class="btn small" ?disabled=${this.busy} @click=${() => emit(this, 'sx-crew-confirm', { userIds: 'all', owner: true })}>${icon('check')} Alle bestätigen</button></div>` : ''}
      <p class="note">${icon('info')}<span>Als Skipper:in bestätigst du Rolle und Meilen für den Meilennachweis. Das ersetzt keine Unterschrift; ändern sich Rolle oder Boot, fällt die Bestätigung weg.</span></p>`;
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
        : html`<div><button class="btn small" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-crew-invite', { to: null, role: this.inviteRole })}>${icon('link')} Einladungslink erzeugen</button></div>`}
      <div class="row"><span class="label">Einladen als</span>${this.roleSelect(this.inviteRole, SELF_ROLES, 'Rolle für Einladungen', (r) => (this.inviteRole = r))}</div>
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
      ${this.roles(c)}
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
