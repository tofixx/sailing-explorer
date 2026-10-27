import { LitElement, html, css, type PropertyValues } from 'lit';
import type { Boat, BoatAdmins, BoatInput, Linkable, MyInvite, Profile, ShareMeta, SupportStatus, User } from '../services/api';
import { WARN_MS, quotaText, type SupportTier } from '../domain/support';
import { DEFAULT_VISIBILITY, VISIBILITY_LABEL, sharePath, type Visibility } from '../domain/visibility';
import { fmtDate, fmtMB, fmtNum, plural } from '../util/html';
import { icon } from './icons';
import { base, dialogStyles, emit, inviteTarget, pendingLabel } from './shared';
import { VISIBILITY_ICON } from './sx-visibility-picker';
import './sx-support';

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
    admins: { attribute: false },
    myInvites: { attribute: false },
    supportTiers: { attribute: false },
    checkoutBusy: { type: Boolean },
    supportStatus: { attribute: false },
    loading: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    confirm: { state: true },
    editing: { state: true },
    editBoat: { state: true },
    expanded: { state: true },
    rotate: { state: true },
    offer: { state: true },
    boatVis: { state: true },
    profileVis: { state: true },
  };
  declare open: boolean;
  declare tab: AccountTab;
  declare user: User | null;
  declare profile: Profile | null;
  declare profileExists: boolean;
  declare boats: Boat[];
  declare shares: ShareMeta[];
  /** Admins des aufgeklappten Boots (data null = lädt) */
  declare admins: { boatId: string; data: BoatAdmins | null } | null;
  /** offene Einladungen an mich (Posteingang) */
  declare myInvites: MyInvite[];
  /** Stufen des Unterstützen-Sliders; null = Unterstützen nicht eingerichtet */
  declare supportTiers: SupportTier[] | null;
  /** Checkout wird angelegt */
  declare checkoutBusy: boolean;
  declare supportStatus: SupportStatus | null;
  declare loading: boolean;
  declare busy: boolean;
  declare error: string;
  /** ID (Freigabe/Boot) oder "account", deren Löschung bestätigt werden muss */
  declare confirm: string | null;
  /** Freigabe, deren Titel bearbeitet wird */
  declare editing: string | null;
  /** Boot im Formular: ID, "new" oder null */
  declare editBoat: string | null;
  /** aufgeklappter Bereich „Sichtbarkeit & Link“: Freigabe-ID, "boat:<id>" oder Admins "admins:<id>" */
  declare expanded: string | null;
  /** „Link erneuern“ wartet auf Bestätigung: "share:<id>", "boat:<id>" oder "profile" */
  declare rotate: string | null;
  /** gesperrte Stufe angetippt – Unterstützen-Angebot an dieser Stelle zeigen ("share:<id>", "boat-form", "profile-form") */
  declare offer: string | null;
  /** gewählte Stufe im Boot-Formular */
  declare boatVis: Visibility;
  /** gewählte Stufe im Profil-Formular; null = gespeicherte (bzw. Standard für neue Profile) */
  declare profileVis: Visibility | null;

  constructor() {
    super();
    this.open = false;
    this.tab = 'shares';
    this.user = null;
    this.profile = null;
    this.profileExists = false;
    this.boats = [];
    this.shares = [];
    this.admins = null;
    this.myInvites = [];
    this.supportTiers = null;
    this.checkoutBusy = false;
    this.supportStatus = null;
    this.loading = false;
    this.busy = false;
    this.error = '';
    this.confirm = null;
    this.editing = null;
    this.editBoat = null;
    this.expanded = null;
    this.rotate = null;
    this.offer = null;
    this.boatVis = DEFAULT_VISIBILITY;
    this.profileVis = null;
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
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-left: var(--s-1);
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: var(--fs-s);
        font-weight: 600;
        vertical-align: middle;
      }
      .badge svg {
        width: 13px;
        height: 13px;
      }
      .quota {
        display: flex;
        align-items: center;
        gap: var(--s-1);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .quota svg {
        width: 14px;
        height: 14px;
        flex: none;
      }
      .status {
        display: grid;
        gap: var(--s-1);
      }
      .status.on .quota b {
        color: var(--text);
      }
      .status.on .quota:first-child svg {
        color: var(--accent);
      }
      .expiry {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .expiry.soon {
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--warn-bg);
        border: 1px solid var(--warn);
        color: var(--text);
        font-weight: 600;
      }
      .expiry.soon svg {
        color: var(--warn);
      }
      .inbox {
        display: grid;
        gap: var(--s-2);
      }
      .inbox .title {
        white-space: normal;
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
      .vis-btn svg {
        width: 15px;
        height: 15px;
      }
      .panel {
        flex-basis: 100%;
        display: grid;
        gap: var(--s-3);
        padding: var(--s-2) 0 var(--s-1);
      }
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
      .confirm span {
        flex: 1;
        min-width: 12rem;
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

  willUpdate(changed: PropertyValues<this>) {
    // Neues Profil vom Server (gespeichert/neu geladen): Formular zeigt wieder die gespeicherte Stufe.
    if (changed.has('profile')) this.profileVis = null;
  }

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) {
        this.confirm = null;
        this.editing = null;
        this.editBoat = null;
        this.expanded = null;
        this.rotate = null;
        this.offer = null;
        this.profileVis = null;
        dlg.showModal();
      } else if (!this.open && dlg.open) dlg.close();
    }
  }

  private close = () => emit(this, 'sx-close', 'account');

  private get supporter() {
    return !!this.supportStatus?.supporter;
  }

  /** Auswahl der Sichtbarkeit; gesperrte Stufen zeigen an Ort und Stelle das Unterstützen-Angebot. */
  private picker(where: string, value: Visibility, current: Visibility | null, label: string, onChange: (v: Visibility) => void) {
    return html`<sx-visibility-picker
        .value=${value}
        .current=${current}
        ?supporter=${this.supporter}
        ?disabled=${this.busy}
        label=${label}
        @sx-visibility-change=${(e: CustomEvent<{ value: Visibility }>) => {
          this.offer = null;
          onChange(e.detail.value);
        }}
        @sx-visibility-locked=${() => (this.offer = where)}
      ></sx-visibility-picker>
      ${this.offer === where ? this.lockedOffer() : ''}`;
  }

  private lockedOffer() {
    return html`<div class="note" role="status">${icon('pennant')}<span>„Nur mit Link“ und „Nur ich“ gibt es für Unterstützer. ${this.supportTiers?.length ? 'Mit einer Unterstützung schaltest du beide frei.' : 'Unterstützen ist auf dieser Installation nicht eingerichtet.'}</span></div>
      ${this.supportTiers?.length ? html`<sx-support variant="offer" .tiers=${this.supportTiers} .status=${this.supportStatus} ?busy=${this.checkoutBusy}></sx-support>` : ''}`;
  }

  /**
   * Link eines eigenen Objekts: anzeigen, kopieren und – nur bei „Nur mit Link“ – erneuern (mit Bestätigung,
   * weil alte Links danach sofort ungültig sind).
   */
  private linkBlock(where: string, kind: 's' | 'b' | 'u', id: string, obj: Linkable, name: string, copy: () => void, rotate: () => void) {
    if (obj.visibility === 'private') return html`<p class="hint">${icon('lock')} Nur du siehst ${name}. Es gibt keinen Link zum Teilen.</p>`;
    const url = location.origin + (obj.link || sharePath(kind, id, obj.visibility, obj.shareKey ?? null));
    return html`<div class="linkrow">
        <input type="text" readonly .value=${url} aria-label="Link: ${name}" @focus=${(e: Event) => (e.target as HTMLInputElement).select()} />
        <button class="btn small" type="button" @click=${copy}>${icon('copy')} Kopieren</button>
      </div>
      ${obj.visibility !== 'unlisted'
        ? ''
        : this.rotate === where
          ? html`<div class="confirm" role="alert">
              <span>Neuen Link erzeugen? Der bisherige Link funktioniert dann sofort nicht mehr – auch bei allen, denen du ihn geschickt hast.</span>
              <button class="btn small danger" type="button" @click=${() => {
                this.rotate = null;
                rotate();
              }}>${icon('link')} Ja, Link erneuern</button>
              <button class="btn small" type="button" @click=${() => (this.rotate = null)}>Abbrechen</button>
            </div>`
          : html`<div><button class="btn small" type="button" ?disabled=${this.busy} @click=${() => (this.rotate = where)}>${icon('link')} Link erneuern</button></div>`}`;
  }

  // ------------------------------------------------------------ Profil

  private saveProfile(e: Event) {
    e.preventDefault();
    const d = new FormData(e.target as HTMLFormElement);
    emit(this, 'sx-profile-save', {
      handle: String(d.get('handle') || ''),
      displayName: String(d.get('displayName') || ''),
      bio: String(d.get('bio') || ''),
      visibility: this.profileVisibility(),
    });
  }

  private profileVisibility(): Visibility {
    return this.profileVis ?? (this.profileExists && this.profile ? this.profile.visibility : DEFAULT_VISIBILITY);
  }

  private profileLink(p: Profile) {
    if (!this.profileExists) return '';
    return html`<div class="full panel">
      <div class="label">Link zu deinem Profil</div>
      ${this.linkBlock(
        'profile',
        'u',
        p.handle,
        p,
        'dein Profil',
        () => emit(this, 'sx-link-copy', p.link || sharePath('u', p.handle, p.visibility, p.shareKey ?? null)),
        () => emit(this, 'sx-profile-save', { handle: p.handle, displayName: p.displayName, bio: p.bio, visibility: p.visibility, rotateKey: true }),
      )}
    </div>`;
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
      <div class="full">
        <div class="label" aria-hidden="true">Wer darf dein Profil sehen?</div>
        ${this.picker('profile-form', this.profileVisibility(), this.profileExists ? p.visibility : null, 'Wer darf dein Profil sehen?', (v) => (this.profileVis = v))}
      </div>
      ${this.profileLink(p)}
      <div class="full actions">
        ${this.profileExists ? html`<a class="btn" href=${p.link || `/u/${p.handle}`}>${icon('open')} Ansehen</a>` : ''}
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
      visibility: this.boatVis,
    };
    emit(this, 'sx-boat-save', { id: id === 'new' ? null : id, input });
    this.editBoat = null;
  }

  private openBoatForm(id: string) {
    this.boatVis = this.boats.find((b) => b.id === id)?.visibility ?? DEFAULT_VISIBILITY;
    this.offer = null;
    this.editBoat = id;
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
      <div class="full">
        <div class="label" aria-hidden="true">Wer darf die Bootsseite sehen?</div>
        ${this.picker('boat-form', this.boatVis, b?.visibility ?? null, 'Wer darf die Bootsseite sehen?', (v) => (this.boatVis = v))}
      </div>
      <div class="full actions">
        <button class="btn" type="button" @click=${() => (this.editBoat = null)}>Abbrechen</button>
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} ${b ? 'Speichern' : 'Boot anlegen'}</button>
      </div>
    </form>`;
  }

  private openAdmins(b: Boat) {
    this.expanded = `admins:${b.id}`;
    this.confirm = null;
    emit(this, 'sx-boat-admins', b.id);
  }

  private inviteAdmin(e: Event, boatId: string) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
    emit(this, 'sx-boat-admin-invite', { boatId, to: inviteTarget(input.value) });
    input.value = '';
  }

  /** Admins eines Boots (Konzept 10.7): Eigner lädt ein, entfernt und zieht zurück; Admins können das Boot verlassen. */
  private adminsPanel(b: Boat) {
    const d = this.admins?.boatId === b.id ? this.admins.data : null;
    if (!d) return html`<div class="panel"><p class="hint">Lade Admins …</p></div>`;
    const owner = d.role === 'owner';
    return html`<div class="panel" id="admins-${b.id}">
      <p class="hint">${owner
        ? 'Admins bearbeiten die Bootsseite und ordnen ihre Törns dem Boot zu. Löschen und weitere Admins einladen kannst nur du.'
        : 'Du verwaltest dieses Boot als Admin. Löschen und Admins einladen kann nur der Eigner.'}</p>
      ${d.admins.length
        ? html`<ul>
            ${d.admins.map(
              (a) => html`<li>
                <div class="meta">
                  <div class="title">${a.displayName}${a.isSelf ? ' (du)' : ''}</div>
                </div>
                ${owner
                  ? this.confirm === `admin:${a.id}`
                    ? html`<button class="btn small danger" @click=${() => emit(this, 'sx-boat-admin-remove', { boatId: b.id, userId: a.id })}>${icon('trash')} Entfernen</button>
                        <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button>`
                    : html`<button class="btn ghost small icon danger" title="Entfernen" aria-label="Admin entfernen: ${a.displayName}" ?disabled=${this.busy} @click=${() => (this.confirm = `admin:${a.id}`)}>${icon('x')}</button>`
                  : ''}
              </li>`,
            )}
          </ul>`
        : html`<p class="hint">Noch keine Admins.</p>`}
      ${owner && d.invites.length
        ? html`<div class="label">Offene Einladungen</div>
            <ul>
              ${d.invites.map(
                (i) => html`<li>
                  <div class="meta"><div class="title">${pendingLabel(i)}</div><div class="sub">gültig bis ${fmtDate(i.expiresAt)}</div></div>
                  <button class="btn small ghost" ?disabled=${this.busy} aria-label="Einladung zurückziehen: ${pendingLabel(i)}" @click=${() => emit(this, 'sx-invite-revoke', { id: i.id, scope: 'boat', boatId: b.id })}>Zurückziehen</button>
                </li>`,
              )}
            </ul>`
        : ''}
      ${owner
        ? html`<form class="inline" @submit=${(e: Event) => this.inviteAdmin(e, b.id)}>
            <input type="text" required maxlength="254" placeholder="E-Mail oder Profilname" aria-label="E-Mail-Adresse oder Profilname des neuen Admins" autocomplete="off" />
            <button class="btn small primary" type="submit" ?disabled=${this.busy}>${icon('mail')} Einladen</button>
          </form>
          <p class="hint">Per E-Mail erreichst du neue und bestehende Konten; wer schon dabei ist, findet die Einladung auch im Konto. Bestehende Segler:innen kannst du auch über ihren Profilnamen einladen.</p>`
        : this.confirm === `leave:${b.id}`
          ? html`<div class="confirm" role="alert">
              <span>„${b.name}“ verlassen? Du kannst das Boot danach nicht mehr bearbeiten.</span>
              <button class="btn small danger" @click=${() => emit(this, 'sx-boat-leave', b.id)}>${icon('logout')} Ja, verlassen</button>
              <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button>
            </div>`
          : html`<div><button class="btn small ghost danger" ?disabled=${this.busy} @click=${() => (this.confirm = `leave:${b.id}`)}>${icon('logout')} Boot verlassen</button></div>`}
    </div>`;
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
                    <span class="chip ${b.visibility === 'public' ? 'on' : ''}">${icon(VISIBILITY_ICON[b.visibility] ?? 'lock')}${VISIBILITY_LABEL[b.visibility] ?? b.visibility}</span>
                    ${b.role === 'admin' ? html`<span class="chip">Admin</span>` : ''}
                  </div>
                </div>
                ${this.confirm === b.id
                  ? html`<button class="btn small danger" @click=${() => emit(this, 'sx-boat-delete', b.id)}>${icon('trash')} Boot löschen</button>
                      <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button>`
                  : this.expanded === `admins:${b.id}`
                  ? html`<button class="btn ghost small icon" title="Admins schließen" aria-label="Admins schließen: ${b.name}" aria-expanded="true" @click=${() => (this.expanded = null)}>${icon('x')}</button>
                      ${this.adminsPanel(b)}`
                  : this.expanded === `boat:${b.id}`
                  ? html`<button class="btn ghost small icon" title="Link schließen" aria-label="Link schließen: ${b.name}" aria-expanded="true" @click=${() => (this.expanded = null)}>${icon('x')}</button>
                      <div class="panel">
                        ${this.linkBlock(
                          `boat:${b.id}`,
                          'b',
                          b.id,
                          b,
                          'die Bootsseite',
                          () => emit(this, 'sx-link-copy', b.link || sharePath('b', b.id, b.visibility, b.shareKey ?? null)),
                          () => emit(this, 'sx-boat-save', { id: b.id, input: { rotateKey: true } }),
                        )}
                      </div>`
                  : html`<div class="tools">
                      <a class="btn ghost small icon" href=${b.link || `/b/${b.id}`} title="Bootsseite öffnen" aria-label="Bootsseite öffnen: ${b.name}">${icon('open')}</a>
                      ${b.visibility !== 'private'
                        ? html`<button class="btn ghost small icon" title="Link" aria-label="Link: ${b.name}" aria-expanded="false" @click=${() => {
                            this.expanded = `boat:${b.id}`;
                            this.rotate = null;
                          }}>${icon('link')}</button>`
                        : ''}
                      <button class="btn ghost small icon" title="Admins" aria-label="Admins: ${b.name}" aria-expanded="false" @click=${() => this.openAdmins(b)}>${icon('user')}</button>
                      <button class="btn ghost small icon" title="Bearbeiten" aria-label="Bearbeiten: ${b.name}" @click=${() => this.openBoatForm(b.id)}>${icon('pencil')}</button>
                      ${b.role === 'owner'
                        ? html`<button class="btn ghost small icon danger" title="Löschen" aria-label="Löschen: ${b.name}" @click=${() => (this.confirm = b.id)}>${icon('trash')}</button>`
                        : ''}
                    </div>`}
              </li>`,
            )}
          </ul>`
        : html`<div class="empty">Noch kein Boot angelegt. Boote bündeln deine Törns auf einer eigenen Seite.</div>`}
      <div class="actions"><button class="btn primary" @click=${() => this.openBoatForm('new')}>${icon('sail')} Boot anlegen</button></div>
    `;
  }

  // ------------------------------------------------------------ Freigaben

  private rename(e: Event, id: string) {
    e.preventDefault();
    const title = new FormData(e.target as HTMLFormElement).get('title');
    emit(this, 'sx-share-update', { id, patch: { title } });
    this.editing = null;
  }

  /** „wird gelöscht am …“ – hervorgehoben, wenn es in den nächsten 14 Tagen so weit ist. */
  private expiry(s: ShareMeta) {
    if (s.expiresAt == null) return '';
    const soon = s.expiresAt - Date.now() <= WARN_MS;
    return html`<span class="expiry ${soon ? 'soon' : ''}">${soon ? icon('info') : ''}wird gelöscht am ${fmtDate(s.expiresAt)}</span>`;
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
    const update = (patch: object) => emit(this, 'sx-share-update', { id: s.id, patch });
    const open = this.expanded === s.id;
    return html`<li>
      <div class="meta">
        <div class="title" title=${s.title}>${s.title}</div>
        <div class="sub">
          ${s.summary || plural(s.trackCount, 'Track', 'Tracks')} · ${fmtDate(s.createdAt)}
          ${this.expiry(s)}
        </div>
      </div>
      ${this.confirm === s.id
        ? html`<button class="btn small danger" @click=${() => emit(this, 'sx-share-delete', s.id)}>${icon('trash')} Endgültig löschen</button>
            <button class="btn small" @click=${() => (this.confirm = null)}>Abbrechen</button>`
        : html`<div class="tools">
            <button
              class="btn small vis-btn ${s.visibility === 'public' ? '' : 'ghost'}"
              aria-expanded=${open ? 'true' : 'false'}
              aria-controls="vis-${s.id}"
              aria-label="Sichtbarkeit und Link: ${s.title} (${VISIBILITY_LABEL[s.visibility] ?? s.visibility})"
              @click=${() => {
                this.expanded = open ? null : s.id;
                this.offer = null;
                this.rotate = null;
              }}
            >${icon(VISIBILITY_ICON[s.visibility] ?? 'lock')} ${VISIBILITY_LABEL[s.visibility] ?? s.visibility}</button>
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
      ${open && this.confirm !== s.id
        ? html`<div class="panel" id="vis-${s.id}">
            ${this.picker(`share:${s.id}`, s.visibility, s.visibility, `Wer darf „${s.title}“ sehen?`, (visibility) => update({ visibility }))}
            ${this.linkBlock(`share:${s.id}`, 's', s.id, s, 'diesen Törn', () => emit(this, 'sx-share-copy', s.id), () => update({ rotateKey: true }))}
          </div>`
        : ''}
    </li>`;
  }

  /** Unterstützer-Status und Kontingent über der Liste. */
  private supportSummary() {
    const st = this.supportStatus;
    if (!st) return '';
    if (st.supporter) {
      return html`<div class="status on">
        <div class="quota">${icon('pennant')} <b>Unterstützer bis ${st.supporterUntil ? fmtDate(st.supporterUntil) : '–'}</b></div>
        <div class="quota">${icon('folder')} ${st.sharesUsed.toLocaleString('de-DE')} von ${st.sharesMax.toLocaleString('de-DE')} Törns ·
          ${fmtMB(st.bytesUsed)} von ${fmtMB(st.bytesMax)}</div>
      </div>`;
    }
    return html`<div class="status">
      ${st.supporterUntil ? html`<div class="quota">${icon('pennant')} Unterstützung abgelaufen am ${fmtDate(st.supporterUntil)}</div>` : ''}
      <div class="quota">${icon('info')} ${quotaText(st)}</div>
    </div>`;
  }

  private sharesTab() {
    return html`
      ${this.supportSummary()}
      ${this.shares.length
        ? html`<ul>${this.shares.map((s) => this.shareRow(s))}</ul>`
        : html`<div class="empty">Noch nichts geteilt. Lade einen Track und klicke auf „Teilen“.</div>`}
      <sx-support variant="offer" .tiers=${this.supportTiers} .status=${this.supportStatus} ?busy=${this.checkoutBusy}></sx-support>
    `;
  }

  // ------------------------------------------------------------ Einladungen an mich

  /** Posteingang: offene Einladungen an mein Konto (per Profilname oder an meine Adresse). */
  private inbox() {
    if (!this.myInvites.length) return '';
    return html`<section class="inbox" aria-label="Einladungen an dich">
      <div class="label">Einladungen an dich</div>
      <ul>
        ${this.myInvites.map(
          (i) => html`<li>
            <div class="meta">
              <div class="title">${i.inviter} lädt dich ein, ${i.kind === 'boat_admin' ? html`das Boot „${i.target ?? ''}“ mitzuverwalten` : html`in die Crew des Törns „${i.target ?? ''}“`}</div>
              <div class="sub">gültig bis ${fmtDate(i.expiresAt)}</div>
            </div>
            <button class="btn small" ?disabled=${this.busy} aria-label="Ablehnen: ${i.target ?? ''}" @click=${() => emit(this, 'sx-my-invite-decline', i.id)}>Ablehnen</button>
            <button class="btn small primary" ?disabled=${this.busy} aria-label="Annehmen: ${i.target ?? ''}" @click=${() => emit(this, 'sx-my-invite-accept', i.id)}>${icon('check')} Annehmen</button>
          </li>`,
        )}
      </ul>
    </section>`;
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
              <div>
                <div class="mail">${name}${this.supportStatus?.supporter ? html`<span class="badge" title="Danke für deine Unterstützung!">${icon('pennant')} Unterstützer</span>` : ''}</div>
                <div class="hint">${u.email} · angemeldet per E-Mail-Link</div>
              </div>
            </div>`
          : ''}
        ${this.inbox()}
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
