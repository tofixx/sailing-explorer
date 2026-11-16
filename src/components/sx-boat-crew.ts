import { LitElement, html, css } from 'lit';
import type { BoatCrew, BoatCrewMember } from '../services/boat-crew-api';
import { ASSIGN_MODES, ASSIGN_MODE_LABEL, BOAT_CREW_LIMITS, type AssignMode } from '../domain/boat-crew';
import { inviteShareText, inviteShareTitle } from '../domain/invite-text';
import { icon } from './icons';
import { base, emit } from './shared';
import './sx-invite-box';
import type { InviteCreateDetail } from './sx-invite-box';

/**
 * Stammcrew eines Boots (Konzept 41, F-270 … F-274) – reine Darstellung, Aktionen als Events.
 * Besucher: Namen mit öffentlichem Profil und Titel, „+ n weitere“. Stammcrew: alle Namen, eigener Titel, austreten,
 * einladen nur mit Schalter. Eigner und Admins: Titel setzen, entfernen, einladen; der Eigner stellt die Schalter.
 *
 * Events (bubbles): `sx-boat-crew-invite` { to, done }, `sx-boat-crew-title` { userId, title },
 * `sx-boat-crew-remove` { userId } ('me' = austreten), `sx-boat-crew-rights` { post? | invite? | assign? }.
 */
export class SxBoatCrew extends LitElement {
  static properties = {
    crew: { attribute: false },
    boatName: { type: String, attribute: 'boat-name' },
    busy: { type: Boolean },
    link: { type: String },
    confirm: { state: true },
    editing: { state: true },
  };
  declare crew: BoatCrew | null;
  declare boatName: string;
  declare busy: boolean;
  /** frisch erzeugter Einladungslink */
  declare link: string;
  /** offene Rückfrage: Nutzer-ID (entfernen) oder 'me' (austreten) */
  declare confirm: string | null;
  /** Titel in Bearbeitung: Nutzer-ID oder 'me' */
  declare editing: string | null;

  constructor() {
    super();
    this.crew = null;
    this.boatName = '';
    this.busy = false;
    this.link = '';
    this.confirm = null;
    this.editing = null;
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
        min-height: 44px;
        flex-wrap: wrap;
      }
      .name {
        flex: 1;
        min-width: 8rem;
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        overflow-wrap: anywhere;
      }
      .name svg {
        width: 15px;
        height: 15px;
        color: var(--accent);
        flex: none;
      }
      a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      .title {
        color: var(--text-2);
        font-size: var(--fs-s);
      }
      .sub {
        margin: 0;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      form.inline,
      .row {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        flex-wrap: wrap;
      }
      form.inline input {
        flex: 1;
        min-width: 8rem;
      }
      fieldset {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: var(--s-2) var(--s-3);
        margin: 0;
        display: grid;
        gap: var(--s-2);
        min-width: 0;
      }
      legend {
        font-weight: 600;
        font-size: var(--fs-s);
      }
      label.check {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        min-height: 44px;
        align-items: center;
      }
      select {
        max-width: 100%;
        min-height: 44px;
      }
      .confirm {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        flex-wrap: wrap;
        font-size: var(--fs-s);
      }
    `,
  ];

  private get manager() {
    return this.crew?.standing === 'owner' || this.crew?.standing === 'admin';
  }

  private titleForm(m: BoatCrewMember, who: string) {
    return html`<form class="inline" @submit=${(e: Event) => {
      e.preventDefault();
      const input = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
      emit(this, 'sx-boat-crew-title', { userId: who, title: input.value });
      this.editing = null;
    }}>
      <input type="text" maxlength=${BOAT_CREW_LIMITS.titleMax} .value=${m.title} placeholder="z. B. Vorschoterin" aria-label="Titel von ${m.displayName}" />
      <button class="btn small primary" type="submit" ?disabled=${this.busy}>${icon('check')} Speichern</button>
      <button class="btn small" type="button" @click=${() => (this.editing = null)}>Abbrechen</button>
    </form>`;
  }

  private member(m: BoatCrewMember) {
    const who = m.isSelf ? 'me' : m.id;
    const canEdit = !!who && (this.manager || m.isSelf);
    if (who && this.editing === who) return html`<li>${this.titleForm(m, who)}</li>`;
    return html`<li>
      <span class="name">${icon('user')}${m.handle ? html`<a href="/u/${m.handle}">${m.displayName}</a>` : html`<span>${m.displayName}</span>`}${m.isSelf ? ' (du)' : ''}
        ${m.title ? html`<span class="title">· ${m.title}</span>` : ''}</span>
      ${canEdit ? html`<button class="btn ghost small" ?disabled=${this.busy} aria-label="Titel ändern: ${m.displayName}" @click=${() => (this.editing = who)}>Titel</button>` : ''}
      ${this.manager && m.id && !m.isSelf
        ? this.confirm === m.id
          ? html`<span class="confirm" role="alert">${m.displayName} entfernen?
              <button class="btn small danger" @click=${() => { this.confirm = null; emit(this, 'sx-boat-crew-remove', { userId: m.id }); }}>${icon('trash')} Ja, entfernen</button>
              <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button></span>`
          : html`<button class="btn ghost small icon danger" title="Entfernen" aria-label="Aus der Stammcrew entfernen: ${m.displayName}" ?disabled=${this.busy} @click=${() => (this.confirm = m.id)}>${icon('x')}</button>`
        : ''}
    </li>`;
  }

  /** Schalter des Eigners (F-271, F-272); Admins sehen sie nur. */
  private rights(c: BoatCrew) {
    const owner = c.standing === 'owner';
    const toggle = (key: 'post' | 'invite', label: string) => html`<label class="check">
      <input type="checkbox" .checked=${c.rights[key]} ?disabled=${!owner || this.busy} @change=${(e: Event) => emit(this, 'sx-boat-crew-rights', { [key]: (e.target as HTMLInputElement).checked })} />
      <span>${label}</span></label>`;
    return html`<fieldset>
      <legend>Was darf die Stammcrew?</legend>
      ${toggle('post', 'Beiträge für das Boot schreiben')}
      ${toggle('invite', 'Weitere zur Stammcrew einladen')}
      <label class="label" for="assign">Eigene Törns diesem Boot zuordnen</label>
      <select id="assign" .value=${c.rights.assign} ?disabled=${!owner || this.busy} @change=${(e: Event) => emit(this, 'sx-boat-crew-rights', { assign: (e.target as HTMLSelectElement).value as AssignMode })}>
        ${ASSIGN_MODES.map((m) => html`<option value=${m} ?selected=${m === c.rights.assign}>${ASSIGN_MODE_LABEL[m]}</option>`)}
      </select>
      ${owner ? '' : html`<p class="sub">Das legt der Eigner fest.</p>`}
    </fieldset>`;
  }

  render() {
    const c = this.crew;
    if (!c) return '';
    const inside = !!c.standing;
    return html`
      ${c.members.length || c.others
        ? html`<ul>
            ${c.members.map((m) => this.member(m))}
            ${c.others ? html`<li class="sub">+ ${c.others} ${c.others === 1 ? 'weitere Person' : 'weitere Personen'} ohne öffentliches Profil</li>` : ''}
          </ul>`
        : html`<p class="sub">${inside ? 'Noch niemand in der Stammcrew.' : 'Keine Stammcrew eingetragen.'}</p>`}
      ${this.manager ? html`<p class="sub">Die Stammcrew ordnet ihre Törns dem Boot zu und liest seine Neuigkeiten. Verwalten kann sie nichts.</p>` : ''}
      ${this.manager ? this.rights(c) : ''}
      ${c.canInvite
        ? html`<sx-invite-box .link=${this.link} ?busy=${this.busy}
            link-note="Nur jetzt sichtbar · 14 Tage gültig · bis zu 10 Personen."
            recipient-label="E-Mail-Adresse oder Profilname"
            share-title=${inviteShareTitle()} share-text=${inviteShareText({ kind: 'boat_member', target: this.boatName })}
            @invite-create=${(e: CustomEvent<InviteCreateDetail>) => emit(this, 'sx-boat-crew-invite', { to: e.detail.to, done: e.detail.done })}></sx-invite-box>`
        : ''}
      ${c.standing === 'crew'
        ? this.confirm === 'me'
          ? html`<div class="confirm" role="alert">Die Stammcrew von „${this.boatName}“ verlassen?
              <button class="btn small danger" @click=${() => { this.confirm = null; emit(this, 'sx-boat-crew-remove', { userId: 'me' }); }}>${icon('logout')} Ja, austreten</button>
              <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button></div>`
          : html`<div><button class="btn small ghost danger" ?disabled=${this.busy} @click=${() => (this.confirm = 'me')}>${icon('logout')} Stammcrew verlassen</button></div>`
        : ''}
    `;
  }
}
customElements.define('sx-boat-crew', SxBoatCrew);

declare global {
  interface HTMLElementTagNameMap {
    'sx-boat-crew': SxBoatCrew;
  }
}
