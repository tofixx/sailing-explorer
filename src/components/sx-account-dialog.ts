import { LitElement, html, css, type PropertyValues } from 'lit';
import type { Boat, BoatInput, Profile, ShareMeta, User } from '../services/api';
import { fmtDate, fmtNum, plural } from '../util/html';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

export type AccountTab = 'profile' | 'boats' | 'shares';

const TABS: Array<[AccountTab, string]> = [
  ['profile', 'Profil'],
  ['boats', 'Boote'],
  ['shares', 'Freigaben'],
];

/** Konto: Profil, Boote und Freigaben verwalten. Reine Darstellung – Aktionen gehen als Events raus. */
export class SxAccountDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    tab: { type: String },
    user: { attribute: false },
    profile: { attribute: false },
    profileExists: { type: Boolean },
    boats: { attribute: false },
    shares: { attribute: false },
    loading: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    confirm: { state: true },
    editing: { state: true },
    editBoat: { state: true },
  };
  declare open: boolean;
  declare tab: AccountTab;
  declare user: User | null;
  declare profile: Profile | null;
  declare profileExists: boolean;
  declare boats: Boat[];
  declare shares: ShareMeta[];
  declare loading: boolean;
  declare busy: boolean;
  declare error: string;
  /** ID (Freigabe/Boot) oder "account", deren Löschung bestätigt werden muss */
  declare confirm: string | null;
  /** Freigabe, deren Titel bearbeitet wird */
  declare editing: string | null;
  /** Boot im Formular: ID, "new" oder null */
  declare editBoat: string | null;

  constructor() {
    super();
    this.open = false;
    this.tab = 'shares';
    this.user = null;
    this.profile = null;
    this.profileExists = false;
    this.boats = [];
    this.shares = [];
    this.loading = false;
    this.busy = false;
    this.error = '';
    this.confirm = null;
    this.editing = null;
    this.editBoat = null;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(660px, calc(100vw - 32px));
      }
      .who {
        display: flex;
        align-items: center;
        gap: var(--s-3);
      }
      .who .avatar {
        width: 40px;
        height: 40px;
      }
      .who .mail {
        font-weight: 650;
        word-break: break-all;
      }
      [role='tabpanel'] {
        display: grid;
        gap: var(--s-3);
      }
      .tabs {
        display: flex;
        gap: var(--s-1);
        border-bottom: 1px solid var(--border-soft);
      }
      .tabs button {
        border: 0;
        background: none;
        padding: var(--s-2) var(--s-3);
        min-height: var(--control-h);
        font: 600 var(--fs-m) var(--font);
        color: var(--text-2);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        cursor: pointer;
      }
      .tabs button[aria-selected='true'] {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        border: 1px solid var(--border-soft);
        border-radius: var(--radius);
        overflow: hidden;
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        padding: var(--s-2) var(--s-3);
        border-bottom: 1px solid var(--border-soft);
        flex-wrap: wrap;
      }
      li:last-child {
        border-bottom: 0;
      }
      .meta {
        flex: 1;
        min-width: 12rem;
      }
      .title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub {
        font-size: var(--fs-s);
        color: var(--text-2);
        display: flex;
        gap: var(--s-1);
        align-items: center;
        flex-wrap: wrap;
      }
      .sub svg {
        width: 13px;
        height: 13px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--surface-2);
        border: 1px solid var(--border-soft);
      }
      .chip.on {
        background: var(--accent-soft);
        color: var(--accent);
        border-color: transparent;
      }
      .empty {
        padding: var(--s-5);
        text-align: center;
        color: var(--text-2);
      }
      form.inline {
        display: flex;
        gap: var(--s-2);
        flex: 1;
      }
      form.grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--s-3);
      }
      form.grid .full {
        grid-column: 1 / -1;
      }
      .check {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        cursor: pointer;
      }
      .check input {
        accent-color: var(--accent);
        width: 16px;
        height: 16px;
      }
      textarea {
        width: 100%;
        min-height: 72px;
        padding: var(--s-2) var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: var(--fs-m) / 1.5 var(--font);
        resize: vertical;
      }
      textarea:focus {
        border-color: var(--accent);
        outline: none;
        box-shadow: var(--focus);
      }
      .prefix {
        display: flex;
        align-items: center;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface-2);
        overflow: hidden;
      }
      .prefix span {
        padding: 0 var(--s-2) 0 var(--s-3);
        color: var(--text-3);
        font-size: var(--fs-s);
        white-space: nowrap;
      }
      .prefix input {
        border: 0;
        border-radius: 0;
      }
      .tools {
        display: flex;
        gap: 2px;
        align-items: center;
        flex-wrap: wrap;
      }
      select.small {
        width: auto;
        min-height: var(--control-h-s);
        font-size: var(--fs-s);
        padding: 0 var(--s-2);
      }
      .foot {
        display: flex;
        justify-content: space-between;
        gap: var(--s-2);
        flex-wrap: wrap;
        padding-top: var(--s-2);
        border-top: 1px solid var(--border-soft);
      }
      @media (max-width: 520px) {
        form.grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) {
        this.confirm = null;
        this.editing = null;
        this.editBoat = null;
        dlg.showModal();
      } else if (!this.open && dlg.open) dlg.close();
    }
  }

  private close = () => emit(this, 'sx-close', 'account');

  // ------------------------------------------------------------ Profil

  private saveProfile(e: Event) {
    e.preventDefault();
    const d = new FormData(e.target as HTMLFormElement);
    emit(this, 'sx-profile-save', {
      handle: String(d.get('handle') || ''),
      displayName: String(d.get('displayName') || ''),
      bio: String(d.get('bio') || ''),
      visibility: d.get('public') === 'on' ? 'public' : 'private',
    });
  }

  private profileTab() {
    const p = this.profile;
    if (!p) return html`<div class="empty">Lade …</div>`;
    return html`<form class="grid" @submit=${this.saveProfile}>
      <div class="full note">${icon('info')}<span>Dein Profil zeigt deine öffentlichen Törns und Boote. Deine E-Mail-Adresse ist nie sichtbar.</span></div>
      <div>
        <label class="label" for="dn">Anzeigename</label>
        <input id="dn" name="displayName" type="text" maxlength="80" required .value=${p.displayName} placeholder="z. B. Tobias" />
      </div>
      <div>
        <label class="label" for="hd">Profiladresse</label>
        <div class="prefix"><span>/u/</span><input id="hd" name="handle" type="text" maxlength="30" minlength="3" required .value=${p.handle} /></div>
      </div>
      <div class="full">
        <label class="label" for="bio">Über dich</label>
        <textarea id="bio" name="bio" maxlength="500" .value=${p.bio} placeholder="Revier, Boot, Erfahrung …"></textarea>
      </div>
      <label class="full check"><input type="checkbox" name="public" ?checked=${p.visibility === 'public'} /> Profil öffentlich zeigen</label>
      <div class="full actions">
        ${this.profileExists ? html`<a class="btn" href="/u/${p.handle}">${icon('open')} Ansehen</a>` : ''}
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} ${this.profileExists ? 'Speichern' : 'Profil anlegen'}</button>
      </div>
    </form>`;
  }

  // ------------------------------------------------------------ Boote

  private saveBoat(e: Event, id: string) {
    e.preventDefault();
    const d = new FormData(e.target as HTMLFormElement);
    const len = String(d.get('lengthM') || '').replace(',', '.');
    const input: BoatInput = {
      name: String(d.get('name') || ''),
      boatType: String(d.get('boatType') || ''),
      lengthM: len ? Number(len) : null,
      sailNumber: String(d.get('sailNumber') || ''),
      homePort: String(d.get('homePort') || ''),
      description: String(d.get('description') || ''),
      visibility: d.get('public') === 'on' ? 'public' : 'private',
    };
    emit(this, 'sx-boat-save', { id: id === 'new' ? null : id, input });
    this.editBoat = null;
  }

  private boatForm(b: Boat | null) {
    const id = b?.id ?? 'new';
    return html`<form class="grid" @submit=${(e: Event) => this.saveBoat(e, id)}>
      <div>
        <label class="label" for="bn">Name</label>
        <input id="bn" name="name" type="text" maxlength="80" required .value=${b?.name ?? ''} placeholder="z. B. Albatros" />
      </div>
      <div>
        <label class="label" for="bt">Typ</label>
        <input id="bt" name="boatType" type="text" maxlength="80" .value=${b?.boatType ?? ''} placeholder="z. B. Bavaria 34" />
      </div>
      <div>
        <label class="label" for="bl">Länge (m)</label>
        <input id="bl" name="lengthM" type="text" inputmode="decimal" .value=${b?.lengthM != null ? String(b.lengthM).replace('.', ',') : ''} placeholder="10,4" />
      </div>
      <div>
        <label class="label" for="bs">Segelnummer</label>
        <input id="bs" name="sailNumber" type="text" maxlength="20" .value=${b?.sailNumber ?? ''} placeholder="GER 1234" />
      </div>
      <div class="full">
        <label class="label" for="bh">Heimathafen <span class="faint">(optional – erscheint öffentlich)</span></label>
        <input id="bh" name="homePort" type="text" maxlength="80" .value=${b?.homePort ?? ''} />
      </div>
      <div class="full">
        <label class="label" for="bd">Beschreibung</label>
        <textarea id="bd" name="description" maxlength="500" .value=${b?.description ?? ''}></textarea>
      </div>
      <label class="full check"><input type="checkbox" name="public" ?checked=${b?.visibility === 'public'} /> Bootsseite öffentlich zeigen</label>
      <div class="full actions">
        <button class="btn" type="button" @click=${() => (this.editBoat = null)}>Abbrechen</button>
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} ${b ? 'Speichern' : 'Boot anlegen'}</button>
      </div>
    </form>`;
  }

  private boatsTab() {
    if (this.editBoat) return this.boatForm(this.boats.find((b) => b.id === this.editBoat) ?? null);
    return html`
      ${this.boats.length
        ? html`<ul>
            ${this.boats.map(
              (b) => html`<li>
                <div class="meta">
                  <div class="title">${b.name}</div>
                  <div class="sub">
                    ${[b.boatType, b.lengthM != null ? `${fmtNum(b.lengthM, 1)} m` : '', b.sailNumber].filter(Boolean).join(' · ') || 'Keine Angaben'}
                    <span class="chip ${b.visibility === 'public' ? 'on' : ''}">${icon(b.visibility === 'public' ? 'globe' : 'lock')}${b.visibility === 'public' ? 'Öffentlich' : 'Privat'}</span>
                    ${b.role === 'admin' ? html`<span class="chip">Admin</span>` : ''}
                  </div>
                </div>
                ${this.confirm === b.id
                  ? html`<button class="btn small danger" @click=${() => emit(this, 'sx-boat-delete', b.id)}>${icon('trash')} Boot löschen</button>
                      <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button>`
                  : html`<div class="tools">
                      <a class="btn ghost small icon" href="/b/${b.id}" title="Bootsseite öffnen" aria-label="Bootsseite öffnen: ${b.name}">${icon('open')}</a>
                      <button class="btn ghost small icon" title="Bearbeiten" aria-label="Bearbeiten: ${b.name}" @click=${() => (this.editBoat = b.id)}>${icon('pencil')}</button>
                      ${b.role === 'owner'
                        ? html`<button class="btn ghost small icon danger" title="Löschen" aria-label="Löschen: ${b.name}" @click=${() => (this.confirm = b.id)}>${icon('trash')}</button>`
                        : ''}
                    </div>`}
              </li>`,
            )}
          </ul>`
        : html`<div class="empty">Noch kein Boot angelegt. Boote bündeln deine Törns auf einer eigenen Seite.</div>`}
      <div class="actions"><button class="btn primary" @click=${() => (this.editBoat = 'new')}>${icon('sail')} Boot anlegen</button></div>
    `;
  }

  // ------------------------------------------------------------ Freigaben

  private rename(e: Event, id: string) {
    e.preventDefault();
    const title = new FormData(e.target as HTMLFormElement).get('title');
    emit(this, 'sx-share-update', { id, patch: { title } });
    this.editing = null;
  }

  private shareRow(s: ShareMeta) {
    if (this.editing === s.id) {
      return html`<li>
        <form class="inline" @submit=${(e: Event) => this.rename(e, s.id)}>
          <input name="title" type="text" maxlength="120" required .value=${s.title} aria-label="Neuer Titel" />
          <button class="btn primary small" type="submit">Speichern</button>
          <button class="btn small" type="button" @click=${() => (this.editing = null)}>Abbrechen</button>
        </form>
      </li>`;
    }
    const isPrivate = s.visibility === 'private';
    const update = (patch: object) => emit(this, 'sx-share-update', { id: s.id, patch });
    return html`<li>
      <div class="meta">
        <div class="title" title=${s.title}>${s.title}</div>
        <div class="sub">
          ${s.summary || plural(s.trackCount, 'Track', 'Tracks')} · ${fmtDate(s.createdAt)}
          ${s.listed && !isPrivate ? html`<span class="chip on">${icon('globe')}Auf Profil</span>` : ''}
        </div>
      </div>
      ${this.confirm === s.id
        ? html`<button class="btn small danger" @click=${() => emit(this, 'sx-share-delete', s.id)}>${icon('trash')} Endgültig löschen</button>
            <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button>`
        : html`<div class="tools">
            <select class="small" aria-label="Sichtbarkeit: ${s.title}" @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              update({ visibility: v === 'private' ? 'private' : 'unlisted', listed: v === 'public' });
            }}>
              <option value="public" ?selected=${s.listed && !isPrivate}>Öffentlich</option>
              <option value="unlisted" ?selected=${!s.listed && !isPrivate}>Mit Link</option>
              <option value="private" ?selected=${isPrivate}>Nur ich</option>
            </select>
            ${this.boats.length
              ? html`<select class="small" aria-label="Boot: ${s.title}" @change=${(e: Event) => update({ boatId: (e.target as HTMLSelectElement).value || null })}>
                  <option value="" ?selected=${!s.boat}>Kein Boot</option>
                  ${this.boats.map((b) => html`<option value=${b.id} ?selected=${s.boat?.id === b.id}>${b.name}</option>`)}
                </select>`
              : ''}
            <button class="btn ghost small icon" title="Öffnen" aria-label="Öffnen: ${s.title}" @click=${() => emit(this, 'sx-share-open', s.id)}>${icon('open')}</button>
            <button class="btn ghost small icon" title="Link kopieren" aria-label="Link kopieren: ${s.title}" @click=${() => emit(this, 'sx-share-copy', s.id)}>${icon('copy')}</button>
            <button class="btn ghost small icon" title="Umbenennen" aria-label="Umbenennen: ${s.title}" @click=${() => (this.editing = s.id)}>${icon('pencil')}</button>
            <button class="btn ghost small icon danger" title="Löschen" aria-label="Löschen: ${s.title}" @click=${() => (this.confirm = s.id)}>${icon('trash')}</button>
          </div>`}
    </li>`;
  }

  private sharesTab() {
    return this.shares.length
      ? html`<ul>${this.shares.map((s) => this.shareRow(s))}</ul>`
      : html`<div class="empty">Noch nichts geteilt. Lade einen Track und klicke auf „Teilen“.</div>`;
  }

  // ------------------------------------------------------------ Rahmen

  private count(key: AccountTab) {
    const n = key === 'boats' ? this.boats.length : key === 'shares' ? this.shares.length : 0;
    return n ? ` (${n})` : '';
  }

  render() {
    const u = this.user;
    const name = this.profile?.displayName || u?.email || '';
    return html`<dialog aria-labelledby="h" @close=${this.close}>
      <header>
        <h2 id="h">Konto &amp; Freigaben</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <div class="body">
        ${u
          ? html`<div class="who">
              <span class="avatar">${name[0]}</span>
              <div><div class="mail">${name}</div><div class="hint">${u.email} · angemeldet per E-Mail-Link</div></div>
            </div>`
          : ''}
        <div class="tabs" role="tablist">
          ${TABS.map(
            ([key, label]) => html`<button
              role="tab"
              aria-selected=${this.tab === key}
              @click=${() => {
                this.tab = key;
                this.confirm = null;
                this.editBoat = null;
              }}
            >
              ${label}${this.count(key)}
            </button>`,
          )}
        </div>
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
        <div role="tabpanel">
          ${this.loading ? html`<div class="empty">Lade …</div>` : this.tab === 'profile' ? this.profileTab() : this.tab === 'boats' ? this.boatsTab() : this.sharesTab()}
        </div>
        <div class="foot">
          ${this.confirm === 'account'
            ? html`<span class="error">Konto, Profil, Boote und alle Freigaben unwiderruflich löschen?</span>
                <span><button class="btn small danger" @click=${() => emit(this, 'sx-account-delete')}>Ja, alles löschen</button>
                <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button></span>`
            : html`<button class="btn small ghost danger" @click=${() => (this.confirm = 'account')}>${icon('trash')} Konto löschen</button>
                <button class="btn small" @click=${() => emit(this, 'sx-logout')}>${icon('logout')} Abmelden</button>`}
        </div>
      </div>
    </dialog>`;
  }
}
customElements.define('sx-account-dialog', SxAccountDialog);
