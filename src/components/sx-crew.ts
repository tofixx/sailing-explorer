import { LitElement, html, css, type PropertyValues } from 'lit';
import type { Confirmation, Crew, CrewMember, PendingInvite, Visibility } from '../services/api';
import { SELF_ROLES, VOYAGE_ROLES, VOYAGE_ROLE_LABEL, VOYAGE_ROLE_SHORT, type VoyageRole } from '../domain/crew-roles';
import { fmtDate } from '../util/html';
import { icon } from './icons';
import { base, emit, inviteTarget, pendingLabel } from './shared';

/**
 * Crew eines geteilten Törns (Konzept 10.6/10.7) – reine Darstellung, Aktionen gehen als Events raus.
 * Ruhig nach UX-NAVIGATION Abschnitt 8 („Törn-Seitenleiste“): sichtbar sind Namen, Rollen und „bestätigt“, die eigene
 * Rolle als kompakte Zeile (Ändern per Klick, F-511) und für die Eigentümer:in „+ Einladen“ (klappt auf, F-513). Rollen
 * anderer, Entfernen und Bestätigen (Skipper:in, Konzept 15) erscheinen erst im Bearbeiten-Modus (`editing`, F-512),
 * den das Zahnrad-Menü des Törns öffnet; „Crew verlassen“ liegt ebenfalls dort (F-510).
 */
export class SxCrew extends LitElement {
  static properties = {
    crew: { attribute: false },
    isOwner: { type: Boolean },
    visibility: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    newLink: { type: String },
    editing: { type: Boolean },
    confirm: { state: true },
    info: { state: true },
    inviting: { type: Boolean },
    roleOpen: { type: Boolean },
  };
  declare crew: Crew | null;
  declare isOwner: boolean;
  /** Sichtbarkeit des Törns – Crew erscheint für andere nur bei „Öffentlich“ */
  declare visibility: Visibility;
  declare busy: boolean;
  declare error: string;
  /** gerade erzeugter Einladungslink – das Token gibt es nur dieses eine Mal */
  declare newLink: string;
  /** Bearbeiten-Modus (Zahnrad „Crew bearbeiten“): Rollen anderer, Entfernen, Bestätigen */
  declare editing: boolean;
  /** Bestätigung offen: Nutzer-ID (entfernen) oder "skipper" (Skipper-Wahl) */
  declare confirm: string | null;
  /** Name, zu dem der Hinweis „Profil nicht öffentlich“ offen ist (F-134) */
  declare info: string | null;
  /** „+ Einladen“ aufgeklappt */
  declare inviting: boolean;
  /** Auswahl der eigenen Rolle offen */
  declare roleOpen: boolean;

  constructor() {
    super();
    this.crew = null;
    this.isOwner = false;
    this.visibility = 'public';
    this.busy = false;
    this.error = '';
    this.newLink = '';
    this.confirm = null;
    this.info = null;
    this.editing = false;
    this.inviting = false;
    this.roleOpen = false;
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
      .linkish {
        all: unset;
        cursor: pointer;
        color: var(--accent);
        text-decoration: underline dotted;
      }
      .linkish:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      /* Spaßname statt Profilname (F-134): erkennbar, nicht verwechselbar mit einem echten Namen */
      .pseudo {
        font-style: italic;
      }
      li .info {
        flex-basis: 100%;
        margin: 0;
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
      .own {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        min-height: var(--control-h-s);
      }
      .own svg {
        width: 13px;
        height: 13px;
      }
      .tools {
        display: grid;
        gap: var(--s-3);
        padding-top: var(--s-3);
        border-top: 1px solid var(--border-soft);
      }
      /* Tippziele ≥ 44 px (UX N11) */
      @media (pointer: coarse) {
        .btn.small,
        .own,
        select {
          min-height: 44px;
        }
        .btn.small.icon {
          width: 44px;
        }
      }
    `,
  ];

  /** Skipper-Wahl, die auf „Ja“ wartet */
  private pendingSkipper: (() => void) | null = null;

  /** Rolle, als die eingeladen wird (Auswahl im aufgeklappten „Einladen“; gilt auch für den Einladungslink) */
  private inviteRole: VoyageRole = 'crew';

  /** Rollenwahl schließt, während der Fokus in ihr steht (Wahl, Escape): danach zurück auf den Rollen-Knopf */
  private restoreFocus = false;

  willUpdate(changed: PropertyValues<this>) {
    // vor dem Neuzeichnen prüfen – danach ist das fokussierte Element schon weg
    if (changed.has('roleOpen') && changed.get('roleOpen') && !this.roleOpen) this.restoreFocus = !!this.shadowRoot?.activeElement;
  }

  updated(changed: PropertyValues<this>) {
    // Ändern der eigenen Rolle: die Auswahl bekommt gleich den Fokus, beim Schließen der Rollen-Knopf wieder (F-511)
    if (changed.has('roleOpen') && this.roleOpen) this.renderRoot.querySelector<HTMLSelectElement>('select.own-select')?.focus();
    if (this.restoreFocus) {
      this.restoreFocus = false;
      this.renderRoot.querySelector<HTMLButtonElement>('button.own')?.focus();
    }
    // „Crew bearbeiten“ (F-512): Fokus auf das erste Bearbeiten-Element, sonst „Fertig“
    if (changed.has('editing') && this.editing) this.renderRoot.querySelector<HTMLElement>('li select, li button.btn, .tools button')?.focus();
  }

  /** Rollen-Auswahl schließt, wenn der Fokus sie verlässt – nicht, solange die Skipper-Rückfrage offen ist. */
  private onRoleFocusOut = (e: FocusEvent) => {
    if (this.confirm === 'skipper') return;
    const next = e.relatedTarget as Node | null;
    if (next && this.shadowRoot!.contains(next)) return;
    this.roleOpen = false;
  };

  private invite(e: Event) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
    emit(this, 'sx-crew-invite', { to: inviteTarget(input.value), role: this.inviteRole });
    input.value = '';
  }

  /** Auswahl einer Rolle; `roles` begrenzt, was gewählt werden darf. */
  private roleSelect(value: VoyageRole | null, roles: readonly VoyageRole[], label: string, onPick: (r: VoyageRole) => void, allowEmpty = false, cls = '') {
    // `.value` stellt nach einem Fehler (z. B. 409) den gespeicherten Wert wieder her.
    return html`<select class=${cls} aria-label=${label} .value=${value ?? ''} ?disabled=${this.busy} @change=${(e: Event) => {
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
      return html`<p class="sub">${this.isOwner ? 'Noch niemand in der Crew.' : 'Keine Crew eingetragen.'}</p>`;
    }
    return html`<ul>
      ${c.members.map(
        (m) => html`<li>
          <span class="name ${this.pseudonym(m) ? 'pseudo' : ''}">${icon(this.pseudonym(m) ? 'lock' : 'user')}${m.handle
            ? html`<a href="/u/${m.handle}">${m.displayName}</a>`
            : this.isOwner
              ? html`<span>${m.displayName || 'Segler:in'}</span>`
              : html`<button class="linkish" type="button" title="Spaßname – das Profil ist nicht öffentlich" aria-expanded=${this.info === m.displayName} @click=${() => (this.info = this.info === m.displayName ? null : m.displayName)}>${m.displayName || 'Segler:in'}</button>`}</span>
          ${!m.handle && this.info === m.displayName ? html`<p class="sub info" role="status">${icon('lock')} Das Profil ist nicht öffentlich – mehr ist hier nicht zu sehen.</p>` : ''}
          ${this.memberRole(c, m)}
          ${this.editing && this.isOwner && m.id
            ? this.confirm === m.id
              ? this.confirmRow(`${m.displayName || 'Diese Person'} aus der Crew entfernen?`, () => emit(this, 'sx-crew-remove', { userId: m.id }))
              : html`<button class="btn ghost small icon danger" title="Entfernen" aria-label="Aus der Crew entfernen: ${m.displayName}" ?disabled=${this.busy} @click=${() => (this.confirm = m.id)}>${icon('x')}</button>`
            : ''}
        </li>`,
      )}
      ${c.others ? html`<li class="muted-row">+ ${c.others} ${c.others === 1 ? 'weitere Person' : 'weitere Personen'} ohne öffentliches Profil</li>` : ''}
    </ul>`;
  }

  /** Rolle eines Mitglieds: als Chip mit „bestätigt“; im Bearbeiten-Modus Auswahl (Eigentümer) bzw. Bestätigen (Skipper). */
  private memberRole(c: Crew, m: CrewMember) {
    const edit = this.editing && !!m.id;
    return html`${edit && this.isOwner
      ? this.roleSelect(m.role, VOYAGE_ROLES, `Rolle von ${m.displayName || 'Segler:in'}`, (role) => emit(this, 'sx-crew-role', { userId: m.id, role }))
      : m.role ? html`<span class="chip">${VOYAGE_ROLE_SHORT[m.role]}</span>` : ''}
      ${this.confirmed(m.confirmed)}
      ${edit && c.isSkipper && m.role !== 'skipper' ? this.confirmButton(m.id!, m.confirmed, m.displayName) : ''}`;
  }

  /** Spaßname statt Name: kein öffentliches Profil und nicht der Eigentümer (der sieht die echten Namen, F-134). */
  private pseudonym(m: CrewMember): boolean {
    return !m.handle && !this.isOwner;
  }

  /**
   * Eigene Rolle als kompakte Zeile „Deine Rolle: Crew ✎“ (F-511) – erst ein Klick öffnet die Auswahl. Die Eigentümer:in
   * wählt alle Rollen, ein Crew-Mitglied nie Skipper; eine eingetragene Skipper:in aus der Crew sieht nur den Chip.
   */
  private ownRole(c: Crew) {
    if (!this.isOwner && !c.me) return '';
    const role = this.isOwner ? c.ownerRole : c.me!.role;
    const conf = this.isOwner ? c.ownerConfirmed : c.me!.confirmed;
    const fixed = !this.isOwner && role === 'skipper';
    const pick = (r: VoyageRole) => {
      this.roleOpen = false;
      if (this.isOwner) emit(this, 'sx-crew-own-role', { role: r });
      else emit(this, 'sx-crew-role', { userId: 'me', role: r });
    };
    const value = fixed
      ? html`<span class="chip">${VOYAGE_ROLE_SHORT.skipper}</span>`
      : this.roleOpen
        ? html`<span @keydown=${(e: KeyboardEvent) => e.key === 'Escape' && (this.roleOpen = false)} @focusout=${this.onRoleFocusOut}>${this.roleSelect(
            role, this.isOwner ? VOYAGE_ROLES : SELF_ROLES, 'Deine Rolle an Bord', pick, this.isOwner, 'own-select')}</span>`
        : html`<button class="linkish own" type="button" aria-label="Deine Rolle ändern: ${role ? VOYAGE_ROLE_LABEL[role] : 'keine'}" ?disabled=${this.busy}
            @click=${() => (this.roleOpen = true)}>${role ? VOYAGE_ROLE_SHORT[role] : 'Rolle wählen'}${icon('pencil')}</button>`;
    return html`<div class="row"><span class="label">Deine Rolle</span>${value}${this.confirmed(conf)}</div>`;
  }

  /** Rückfrage vor dem Wechsel auf Skipper:in (eigene Rolle oder Rolle eines Mitglieds). */
  private skipperAsk() {
    if (this.confirm !== 'skipper' || !this.pendingSkipper) return '';
    return this.confirmRow('Als Skipper:in eintragen? Bestehende Bestätigungen fallen dann weg.', () => {
      this.roleOpen = false;
      this.pendingSkipper?.();
      this.pendingSkipper = null;
    }, html`${icon('check')} Ja, eintragen`, false);
  }

  /** Bearbeiten-Modus (F-512): Werkzeuge der Skipper:in und „Fertig“. */
  private editTools(c: Crew) {
    if (!this.editing) return '';
    return html`<div class="tools">
      ${c.isSkipper && !this.isOwner && c.ownerRole
        ? html`<div class="row"><span class="sub">Eigentümer:in · ${VOYAGE_ROLE_SHORT[c.ownerRole]}</span>${this.confirmed(c.ownerConfirmed)}${this.confirmButton('owner', c.ownerConfirmed, 'Eigentümer:in')}</div>`
        : ''}
      ${c.isSkipper && c.members.length ? html`<div><button class="btn small" ?disabled=${this.busy} @click=${() => emit(this, 'sx-crew-confirm', { userIds: 'all', owner: true })}>${icon('check')} Alle bestätigen</button></div>` : ''}
      ${c.isSkipper ? html`<p class="note">${icon('info')}<span>Als Skipper:in bestätigst du Rolle und Meilen für den Meilennachweis. Das ersetzt keine Unterschrift; ändern sich Rolle oder Boot, fällt die Bestätigung weg.</span></p>` : ''}
      <div><button class="btn small primary" type="button" @click=${() => (this.editing = false)}>${icon('check')} Fertig</button></div>
    </div>`;
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

  /** „+ Einladen“ (F-513): Rolle, Link, E-Mail/Profilname und offene Einladungen erst nach dem Aufklappen. */
  private inviteBox(c: Crew) {
    const open = this.inviting || !!this.newLink;
    const count = c.invites.length;
    const toggle = html`<div><button class="btn small" type="button" aria-expanded=${open} aria-controls="invite-box" @click=${() => (this.inviting = !open)}>
      ${icon(open ? 'x' : 'plus')} ${open ? 'Einladen schließen' : 'Einladen'}${!open && count ? ` · ${count} offen` : ''}</button></div>`;
    if (!open) return toggle;
    return html`${toggle}<div class="tools" id="invite-box">
      ${this.visibility !== 'public' ? html`<p class="note">${icon('lock')}<span>Die Crew sehen andere erst, wenn der Törn öffentlich ist.</span></p>` : ''}
      <div class="row"><span class="label">Einladen als</span>${this.roleSelect(this.inviteRole, SELF_ROLES, 'Rolle für Einladungen', (r) => (this.inviteRole = r))}</div>
      ${this.newLink
        ? html`<div class="label">Einladungslink (14 Tage gültig, wird nur jetzt angezeigt)</div>
            <div class="linkrow">
              <input type="text" readonly .value=${this.newLink} aria-label="Einladungslink" @focus=${(e: Event) => (e.target as HTMLInputElement).select()} />
              <button class="btn small" type="button" @click=${() => emit(this, 'sx-invite-copy', this.newLink)}>${icon('copy')} Kopieren</button>
            </div>`
        : html`<div><button class="btn small" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-crew-invite', { to: null, role: this.inviteRole })}>${icon('link')} Einladungslink erzeugen</button></div>`}
      <form @submit=${this.invite}>
        <input type="text" required maxlength="254" placeholder="E-Mail oder Profilname" aria-label="E-Mail-Adresse oder Profilname" autocomplete="off" />
        <button class="btn small primary" type="submit" ?disabled=${this.busy}>${icon('mail')} Einladen</button>
      </form>
      <p class="sub">Per E-Mail erreichst du neue und bestehende Konten; wer schon dabei ist, findet die Einladung auch im Konto. Bestehende Segler:innen kannst du auch über ihren Profilnamen einladen.</p>
      ${this.pending(c.invites)}
    </div>`;
  }

  render() {
    const c = this.crew;
    if (!c) return html`<p class="sub">Lade …</p>`;
    return html`
      ${this.ownRole(c)}
      ${this.skipperAsk()}
      ${this.members(c)}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      ${this.editTools(c)}
      ${this.isOwner && !this.editing ? this.inviteBox(c) : ''}
    `;
  }
}
customElements.define('sx-crew', SxCrew);
