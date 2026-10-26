import { LitElement, css, html } from 'lit';
import type { Boat, GroupInfo, GroupInput, GroupPageData, MyGroup, PendingInvite, StreamPage } from '../services/api';
import {
  GROUP_KIND_LABEL, GROUP_ROLE_LABEL, GROUP_VISIBILITY_HINT, GROUP_VISIBILITY_LABEL, JOIN_MODE_LABEL, POST_LINK_MAX, POST_MAX,
  canManageGroup, slugFromName, type GroupKind, type JoinMode,
} from '../domain/groups';
import { commentLength } from '../domain/comment-text';
import { VISIBILITIES, sharePath, type Visibility } from '../domain/visibility';
import { fmtDate, fmtNum, plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';
import { VISIBILITY_ICON } from './sx-visibility-picker';
import './sx-stream';
import './sx-follow';

/**
 * Gruppenseite `/g/<slug>` und Anlegen `/g/neu` (Konzept 11.1, 11.5, F-163). Rein präsentational: Daten kommen als
 * Properties, Absichten gehen als Events an den GroupsController. Verwalten erscheint nur nach Rolle.
 */
export class SxGroupPage extends LitElement {
  static properties = {
    mode: { type: String },
    data: { attribute: false },
    stream: { attribute: false },
    streamLoading: { type: Boolean },
    loading: { type: Boolean },
    error: { type: String },
    busy: { type: Boolean },
    signedIn: { type: Boolean },
    supporter: { type: Boolean },
    myBoats: { attribute: false },
    clubs: { attribute: false },
    inviteLink: { type: String },
    formError: { type: String },
    editing: { state: true },
    draft: { state: true },
    post: { state: true },
    postLink: { state: true },
  };
  declare mode: 'view' | 'create';
  declare data: GroupPageData | null;
  declare stream: StreamPage | null;
  declare streamLoading: boolean;
  declare loading: boolean;
  declare error: string;
  declare busy: boolean;
  declare signedIn: boolean;
  /** darf „Nur mit Link“ und „Geschlossen“ wählen (E1) */
  declare supporter: boolean;
  declare myBoats: Boat[];
  /** Vereine, die man verwaltet (für Teams) */
  declare clubs: MyGroup[];
  /** frisch erzeugter Einladungslink – nur einmal sichtbar */
  declare inviteLink: string | null;
  declare formError: string;
  declare editing: boolean;
  declare draft: GroupInput;
  declare post: string;
  declare postLink: string;

  constructor() {
    super();
    this.mode = 'view';
    this.data = null;
    this.stream = null;
    this.streamLoading = false;
    this.loading = false;
    this.error = '';
    this.busy = false;
    this.signedIn = false;
    this.supporter = false;
    this.myBoats = [];
    this.clubs = [];
    this.inviteLink = null;
    this.formError = '';
    this.editing = false;
    this.draft = { kind: 'club', name: '', slug: '', description: '', homePort: '', visibility: 'public', joinMode: 'request', parentId: null };
    this.post = '';
    this.postLink = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        overflow-y: auto;
        background: var(--bg);
      }
      .page {
        max-width: 860px;
        margin: 0 auto;
        padding: var(--s-5) var(--s-4) var(--s-6);
        display: grid;
        gap: var(--s-5);
      }
      .hero {
        display: flex;
        gap: var(--s-4);
        align-items: center;
        padding: var(--s-5);
        border-radius: var(--radius-l);
        background: linear-gradient(135deg, var(--accent-soft), var(--surface) 70%);
        border: 1px solid var(--border-soft);
        flex-wrap: wrap;
      }
      .mark {
        flex: none;
        width: 72px;
        height: 72px;
        border-radius: var(--radius-l);
        display: grid;
        place-items: center;
        background: var(--accent);
        color: var(--on-accent);
        box-shadow: var(--shadow-1);
      }
      .mark svg {
        width: 38px;
        height: 38px;
      }
      .head {
        flex: 1;
        min-width: 220px;
      }
      h1 {
        margin: 0;
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .lead {
        color: var(--text-2);
        margin-top: var(--s-1);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-3);
        margin-top: var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .facts a {
        color: var(--accent);
        font-weight: 600;
        text-decoration: none;
      }
      .facts .vis {
        display: inline-flex;
        gap: 3px;
        align-items: center;
      }
      .facts svg {
        width: 14px;
        height: 14px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: var(--s-2);
      }
      .stat {
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
      }
      .stat .v {
        font-size: var(--fs-num-l);
        font-weight: 720;
        font-variant-numeric: tabular-nums;
      }
      .stat .v small {
        font-size: var(--fs-s);
        color: var(--text-2);
        margin-left: 2px;
      }
      section {
        display: grid;
        gap: var(--s-3);
      }
      .box {
        padding: var(--s-4);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
        display: grid;
        gap: var(--s-3);
      }
      ul.list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      ul.list li {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      ul.list .name {
        flex: 1;
        min-width: 120px;
        overflow-wrap: anywhere;
      }
      ul.list a {
        color: inherit;
        font-weight: 600;
      }
      .role {
        font-size: var(--fs-xs);
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--surface-2);
        color: var(--text-2);
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--s-2);
      }
      .card {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
      }
      .card a {
        color: inherit;
        font-weight: 650;
        text-decoration: none;
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      form,
      .form {
        display: grid;
        gap: var(--s-3);
      }
      textarea {
        width: 100%;
        min-height: 96px;
        padding: var(--s-2) var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: var(--fs-m) / 1.5 var(--font);
        resize: vertical;
      }
      .opts {
        display: grid;
        gap: var(--s-2);
      }
      .opt {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        padding: var(--s-2) var(--s-3);
        border: 1px solid var(--border-soft);
        border-radius: var(--radius);
        min-height: 40px;
      }
      .opt[aria-disabled='true'] {
        opacity: 0.6;
      }
      .opt span {
        display: grid;
      }
      .opt small {
        color: var(--text-3);
      }
      .row {
        display: flex;
        gap: var(--s-2);
        flex-wrap: wrap;
        align-items: center;
      }
      .row > input {
        flex: 1;
        min-width: 180px;
      }
      .note {
        display: flex;
        gap: var(--s-2);
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        background: var(--warn-bg);
        font-size: var(--fs-s);
      }
      .error {
        color: var(--err);
        font-size: var(--fs-s);
      }
      .state,
      .empty {
        padding: var(--s-5);
        text-align: center;
        color: var(--text-2);
        border: 1px dashed var(--border);
        border-radius: var(--radius);
      }
      code.link {
        display: block;
        padding: var(--s-2);
        border-radius: var(--radius);
        background: var(--surface-2);
        overflow-wrap: anywhere;
        font-size: var(--fs-s);
      }
      .counter {
        font-size: var(--fs-xs);
        color: var(--text-3);
        text-align: right;
      }
    `,
  ];

  // ------------------------------------------------------------ Formular (Anlegen und Bearbeiten)

  private set(patch: GroupInput) {
    this.draft = { ...this.draft, ...patch };
  }

  private visibilityOptions(current: Visibility | undefined, canChange: boolean) {
    return html`<fieldset class="opts" style="border:0;padding:0;margin:0">
      <legend class="label">Sichtbarkeit</legend>
      ${VISIBILITIES.map((v) => {
        const locked = !canChange || (v !== 'public' && !this.supporter && v !== current);
        return html`<label class="opt" aria-disabled=${locked ? 'true' : 'false'}>
          <input type="radio" name="vis" .checked=${this.draft.visibility === v} ?disabled=${locked} @change=${() => this.set({ visibility: v })} />
          <span>${icon(VISIBILITY_ICON[v] ?? 'lock')} <b>${GROUP_VISIBILITY_LABEL[v]}</b><small>${GROUP_VISIBILITY_HINT[v]}${v !== 'public' && !this.supporter ? ' Nur für Unterstützer.' : ''}</small></span>
        </label>`;
      })}
    </fieldset>`;
  }

  private fields(create: boolean, g: GroupInfo | null) {
    const d = this.draft;
    const owner = create || g?.role === 'owner';
    return html`
      ${create
        ? html`<fieldset class="opts" style="border:0;padding:0;margin:0">
            <legend class="label">Art</legend>
            ${(['club', 'team'] as GroupKind[]).map(
              (k) => html`<label class="opt"><input type="radio" name="kind" .checked=${d.kind === k} @change=${() => this.set({ kind: k, parentId: k === 'club' ? null : d.parentId })} />
                <span><b>${GROUP_KIND_LABEL[k]}</b><small>${k === 'club' ? 'Segelverein, Hafengemeinschaft, Klassenvereinigung' : 'Regattacrew, Jugendgruppe, Fahrtensegler-Runde – optional in einem Verein'}</small></span></label>`,
            )}
          </fieldset>`
        : ''}
      <label><span class="label">Name</span>
        <input type="text" maxlength="80" required .value=${d.name ?? ''}
          @input=${(e: Event) => {
            const name = (e.target as HTMLInputElement).value;
            // Adresse aus dem Namen vorschlagen, solange sie nicht selbst geändert wurde
            this.set(create && (!d.slug || d.slug === slugFromName(d.name ?? '')) ? { name, slug: slugFromName(name) } : { name });
          }} /></label>
      <label><span class="label">Adresse</span>
        <div class="row"><span class="faint">/g/</span><input type="text" maxlength="30" pattern="[a-z0-9-]{3,30}" .value=${d.slug ?? ''} aria-describedby="slug-hint"
          @input=${(e: Event) => this.set({ slug: (e.target as HTMLInputElement).value.toLowerCase() })} /></div>
        <span class="hint" id="slug-hint">3–30 Zeichen: a–z, 0–9 und Bindestrich.</span></label>
      <label><span class="label">Heimathafen (optional)</span>
        <input type="text" maxlength="80" .value=${d.homePort ?? ''} @input=${(e: Event) => this.set({ homePort: (e.target as HTMLInputElement).value })} /></label>
      <label><span class="label">Beschreibung (optional)</span>
        <textarea maxlength="1000" .value=${d.description ?? ''} @input=${(e: Event) => this.set({ description: (e.target as HTMLTextAreaElement).value })}></textarea></label>
      ${create && d.kind === 'team' && this.clubs.length
        ? html`<label><span class="label">Gehört zum Verein (optional)</span>
            <select .value=${d.parentId ?? ''} @change=${(e: Event) => this.set({ parentId: (e.target as HTMLSelectElement).value || null })}>
              <option value="">– kein Verein –</option>
              ${this.clubs.map((c) => html`<option value=${c.id} ?selected=${d.parentId === c.id}>${c.name}</option>`)}
            </select></label>`
        : ''}
      ${this.visibilityOptions(g?.visibility, owner)}
      ${!owner ? html`<p class="hint">Die Sichtbarkeit ändert nur der Eigner.</p>` : ''}
      <fieldset class="opts" style="border:0;padding:0;margin:0">
        <legend class="label">Beitreten</legend>
        ${(['request', 'invite'] as JoinMode[]).map(
          (m) => html`<label class="opt"><input type="radio" name="join" .checked=${d.joinMode === m} @change=${() => this.set({ joinMode: m })} /><span><b>${JOIN_MODE_LABEL[m]}</b></span></label>`,
        )}
      </fieldset>
      ${this.formError ? html`<p class="error" role="alert">${this.formError}</p>` : ''}
    `;
  }

  private createForm() {
    return html`<div class="page">
      <header class="hero">
        <div class="mark" aria-hidden="true">${icon('pennant')}</div>
        <div class="head"><h1>Verein oder Team gründen</h1><div class="lead">Bring deine Leute zusammen: Mitglieder, Boote, Törns und Neuigkeiten an einem Ort.</div></div>
      </header>
      ${this.signedIn
        ? html`<form class="box" @submit=${(e: Event) => {
            e.preventDefault();
            emit(this, 'sx-group-create', { ...this.draft });
          }}>
            ${this.fields(true, null)}
            <div class="row"><button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} Gruppe anlegen</button><a class="btn ghost" href="/">Abbrechen</a></div>
            <p class="hint">Kostenlos kannst du eine öffentliche Gruppe anlegen, als Unterstützer bis zu zehn – auch geschlossene.</p>
          </form>`
        : html`<div class="state">Zum Gründen bitte anmelden.<br /><br /><button class="btn primary" @click=${() => emit(this, 'sx-login')}>Anmelden</button></div>`}
    </div>`;
  }

  /** Bearbeiten öffnen: Entwurf aus der aktuellen Gruppe. */
  private startEdit(g: GroupInfo) {
    this.draft = { name: g.name, slug: g.slug, description: g.description, homePort: g.homePort, visibility: g.visibility, joinMode: g.joinMode };
    this.editing = true;
  }

  private editForm(g: GroupInfo) {
    return html`<form class="box" aria-label="Gruppe bearbeiten" @submit=${(e: Event) => {
        e.preventDefault();
        const patch: GroupInput = { ...this.draft };
        if (g.role !== 'owner' || patch.visibility === g.visibility) delete patch.visibility;
        emit(this, 'sx-group-save', { id: g.id, patch });
      }}>
      ${this.fields(false, g)}
      <div class="row">
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} Speichern</button>
        <button class="btn ghost" type="button" @click=${() => (this.editing = false)}>Abbrechen</button>
        ${g.visibility === 'unlisted' ? html`<button class="btn" type="button" @click=${() => emit(this, 'sx-group-save', { id: g.id, patch: { rotateKey: true } })}>${icon('link')} Link erneuern</button>` : ''}
        ${g.role === 'owner'
          ? html`<button class="btn danger" type="button" @click=${() => confirm(`„${g.name}“ wirklich löschen? Mitglieder, Beiträge und Neuigkeiten der Gruppe werden gelöscht. Törns und Boote bleiben.`) && emit(this, 'sx-group-delete', { id: g.id })}>${icon('trash')} Gruppe löschen</button>`
          : ''}
      </div>
    </form>`;
  }

  // ------------------------------------------------------------ Ansicht

  private stats(d: GroupPageData) {
    const s = d.stats;
    return html`<div class="stats">
      <div class="stat"><div class="eyebrow">Mitglieder</div><div class="v">${s.members}</div></div>
      <div class="stat"><div class="eyebrow">Boote</div><div class="v">${s.boats}</div></div>
      <div class="stat"><div class="eyebrow">Törns</div><div class="v">${s.voyages}</div></div>
      <div class="stat"><div class="eyebrow">Seemeilen</div><div class="v">${fmtNum(s.distNm, 0)}<small>sm</small></div></div>
      <div class="stat"><div class="eyebrow">Saison ${new Date().getFullYear()}</div><div class="v">${fmtNum(s.seasonNm, 0)}<small>sm</small></div></div>
    </div>`;
  }

  private joinActions(d: GroupPageData) {
    const g = d.group;
    const m = d.membership;
    if (!this.signedIn) return g.joinMode === 'request' ? html`<button class="btn primary" @click=${() => emit(this, 'sx-login')}>${icon('user')} Anmelden und beitreten</button>` : '';
    if (m.role) return m.role === 'owner' ? '' : html`<button class="btn ghost" @click=${() => confirm(`„${g.name}“ verlassen?`) && emit(this, 'sx-group-leave', { id: g.id })}>${icon('logout')} Austreten</button>`;
    if (m.requested) return html`<span class="faint">Anfrage gestellt</span><button class="btn ghost" @click=${() => emit(this, 'sx-group-withdraw', { id: g.id })}>Anfrage zurückziehen</button>`;
    if (m.canRequest) return html`<button class="btn primary" ?disabled=${this.busy} @click=${() => emit(this, 'sx-group-join', { id: g.id })}>${icon('user')} Beitritt anfragen</button>`;
    return html`<span class="faint">Beitritt nur auf Einladung</span>`;
  }

  private hero(d: GroupPageData) {
    const g = d.group;
    const manager = canManageGroup(g.role);
    const path = manager && g.link ? g.link : sharePath('g', g.slug, g.visibility, null);
    const v = g.visibility;
    return html`<header class="hero">
      <div class="mark" aria-hidden="true">${icon(g.kind === 'club' ? 'anchor' : 'sail')}</div>
      <div class="head">
        <h1>${g.name}</h1>
        ${g.description ? html`<div class="lead">${g.description}</div>` : ''}
        <div class="facts">
          <span>${GROUP_KIND_LABEL[g.kind]}</span>
          ${g.homePort ? html`<span>Heimathafen ${g.homePort}</span>` : ''}
          ${d.parent ? html`<span>im Verein <a href="/g/${d.parent.slug}">${d.parent.name}</a></span>` : ''}
          ${manager ? html`<span class="vis">${icon(VISIBILITY_ICON[v] ?? 'lock')} ${GROUP_VISIBILITY_LABEL[v]}</span>` : ''}
          ${g.role ? html`<span>Du: ${GROUP_ROLE_LABEL[g.role]}</span>` : ''}
        </div>
      </div>
      <div class="actions">
        ${this.joinActions(d)}
        ${v === 'public' ? html`<sx-follow kind="group" target-id=${g.id} label=${g.name} .stats=${d.social} ?signed-in=${this.signedIn}></sx-follow>` : ''}
        ${v !== 'private' || manager ? html`<button class="btn" @click=${() => emit(this, 'sx-page-share', { path: v === 'unlisted' && !manager ? location.pathname : path, title: g.name })}>${icon('share')} Teilen</button>` : ''}
        ${manager
          ? html`<button class="btn" @click=${() => this.startEdit(g)}>${icon('pencil')} Bearbeiten</button>`
          : html`<button class="btn ghost" @click=${() => emit(this, 'sx-report', { kind: 'group', id: g.id, label: `die Gruppe ${g.name}` })}>${icon('flag')} Melden</button>`}
      </div>
    </header>`;
  }

  private composer(g: GroupInfo) {
    const len = commentLength(this.post.trim());
    return html`<form class="box" aria-label="Neuigkeit schreiben" @submit=${(e: Event) => {
        e.preventDefault();
        emit(this, 'sx-post-create', { groupId: g.id, body: this.post, link: this.postLink.trim() });
      }}>
      <label><span class="label">Neuigkeit für alle${g.kind === 'club' ? ' (erscheint auch in den Teams)' : ''}</span>
        <textarea maxlength=${POST_MAX + 200} .value=${this.post} @input=${(e: Event) => (this.post = (e.target as HTMLTextAreaElement).value)}
          placeholder="Absegeln am Samstag, Treffpunkt 10 Uhr am Steg …"></textarea></label>
      <div class="counter" aria-live="polite">${len} / ${POST_MAX}</div>
      <label><span class="label">Link (optional)</span>
        <input type="text" inputmode="url" maxlength=${POST_LINK_MAX} placeholder="https://…" .value=${this.postLink} @input=${(e: Event) => (this.postLink = (e.target as HTMLInputElement).value)} /></label>
      <div class="row"><button class="btn primary" type="submit" ?disabled=${this.busy || !len || len > POST_MAX}>${icon('comment')} Veröffentlichen</button>
        <span class="hint">Höchstens 5 Beiträge pro Tag. Reiner Text, Links werden klickbar.</span></div>
    </form>`;
  }

  /** Nach erfolgreichem Posten leert der Controller das Formular. */
  clearComposer() {
    this.post = '';
    this.postLink = '';
  }

  private invites(g: GroupInfo, list: PendingInvite[]) {
    let email = '';
    return html`<div class="box" aria-label="Einladen">
      <h3 class="eyebrow">Einladen</h3>
      <div class="row">
        <button class="btn" ?disabled=${this.busy} @click=${() => emit(this, 'sx-group-invite', { id: g.id, email: null })}>${icon('link')} Einladungslink erzeugen</button>
      </div>
      ${this.inviteLink
        ? html`<div><code class="link">${this.inviteLink}</code>
            <div class="row" style="margin-top:var(--s-2)"><button class="btn small" @click=${() => emit(this, 'sx-invite-copy', this.inviteLink)}>${icon('copy')} Kopieren</button>
              <span class="hint">Nur jetzt sichtbar. 14 Tage gültig, bis zu 100 Personen.</span></div></div>`
        : ''}
      <form class="row" @submit=${(e: Event) => {
          e.preventDefault();
          if (email) emit(this, 'sx-group-invite', { id: g.id, email });
        }}>
        <input type="email" placeholder="E-Mail-Adresse" aria-label="Per E-Mail einladen" @input=${(e: Event) => (email = (e.target as HTMLInputElement).value)} />
        <button class="btn" type="submit" ?disabled=${this.busy}>${icon('mail')} Einladen</button>
      </form>
      ${list.length
        ? html`<ul class="list" aria-label="Offene Einladungen">
            ${list.map(
              (i) => html`<li><span class="name">${i.email ?? `Einladungslink (noch ${i.usesLeft}×)`}</span><span class="faint">bis ${fmtDate(i.expiresAt)}</span>
                <button class="btn small ghost" @click=${() => emit(this, 'sx-group-invite-revoke', { id: i.id })}>Zurückziehen</button></li>`,
            )}
          </ul>`
        : ''}
    </div>`;
  }

  private requests(g: GroupInfo, d: GroupPageData) {
    const list = d.requests ?? [];
    if (!list.length) return '';
    return html`<div class="box" aria-label="Beitrittsanfragen">
      <h3 class="eyebrow">Beitrittsanfragen (${list.length})</h3>
      <ul class="list">
        ${list.map(
          (r) => html`<li>
            <span class="name">${r.handle ? html`<a href="/u/${r.handle}">${r.displayName}</a>` : r.displayName}${r.message ? html`<br /><small class="faint">${r.message}</small>` : ''}</span>
            <button class="btn small primary" ?disabled=${this.busy} @click=${() => emit(this, 'sx-group-request', { id: g.id, userId: r.userId, approve: true })}>Annehmen</button>
            <button class="btn small ghost" ?disabled=${this.busy} @click=${() => emit(this, 'sx-group-request', { id: g.id, userId: r.userId, approve: false })}>Ablehnen</button>
          </li>`,
        )}
      </ul>
    </div>`;
  }

  private members(d: GroupPageData) {
    const g = d.group;
    const owner = g.role === 'owner';
    return html`<section aria-labelledby="mem-t">
      <h2 class="eyebrow" id="mem-t">Mitglieder</h2>
      <ul class="list">
        ${d.members.map(
          (m) => html`<li>
            <span class="avatar" aria-hidden="true">${m.displayName[0]}</span>
            <span class="name">${m.handle ? html`<a href="/u/${m.handle}">${m.displayName}</a>` : m.displayName}${m.isSelf ? html` <span class="faint">(du)</span>` : ''}</span>
            ${m.role !== 'member' ? html`<span class="role">${GROUP_ROLE_LABEL[m.role]}</span>` : ''}
            ${owner && m.id && m.role !== 'owner'
              ? html`<button class="btn small ghost" @click=${() => emit(this, 'sx-group-role', { id: g.id, userId: m.id, role: m.role === 'admin' ? 'member' : 'admin' })}>${m.role === 'admin' ? 'Admin absetzen' : 'Zum Admin'}</button>`
              : ''}
            ${m.id && !m.isSelf && m.role !== 'owner' && (owner || m.role === 'member') && canManageGroup(g.role)
              ? html`<button class="btn small ghost danger" aria-label="${m.displayName} entfernen" @click=${() => confirm(`${m.displayName} aus der Gruppe entfernen?`) && emit(this, 'sx-group-remove', { id: g.id, userId: m.id })}>${icon('x')}</button>`
              : ''}
          </li>`,
        )}
      </ul>
      ${d.others ? html`<p class="faint">+ ${plural(d.others, 'weiteres Mitglied', 'weitere Mitglieder')} ohne öffentliches Profil</p>` : ''}
    </section>`;
  }

  private boats(d: GroupPageData) {
    const g = d.group;
    const inGroup = new Set(d.boats.map((b) => b.id));
    const addable = g.role ? this.myBoats.filter((b) => !inGroup.has(b.id)) : [];
    let pick = addable[0]?.id ?? '';
    return html`<section aria-labelledby="boats-t">
      <h2 class="eyebrow" id="boats-t">Boote</h2>
      ${d.boats.length
        ? html`<div class="cards">
            ${d.boats.map(
              (b) => html`<div class="card">${icon('sail')}<a href="/b/${b.id}">${b.name}${b.public ? '' : html` <span class="faint">(nicht öffentlich)</span>`}</a>
                ${b.canRemove ? html`<button class="btn small ghost" aria-label="${b.name} aus der Gruppe entfernen" @click=${() => emit(this, 'sx-group-boat-remove', { id: g.id, boatId: b.id })}>${icon('x')}</button>` : ''}</div>`,
            )}
          </div>`
        : html`<div class="empty">Noch keine öffentlichen Boote.</div>`}
      ${addable.length
        ? html`<form class="row" @submit=${(e: Event) => {
            e.preventDefault();
            if (pick) emit(this, 'sx-group-boat-add', { id: g.id, boatId: pick });
          }}>
            <select aria-label="Eigenes Boot zuordnen" @change=${(e: Event) => (pick = (e.target as HTMLSelectElement).value)}>
              ${addable.map((b) => html`<option value=${b.id}>${b.name}</option>`)}
            </select>
            <button class="btn" type="submit" ?disabled=${this.busy}>${icon('sail')} Boot zuordnen</button>
          </form>`
        : ''}
    </section>`;
  }

  private view(d: GroupPageData) {
    const g = d.group;
    const manager = canManageGroup(g.role);
    return html`
      ${this.hero(d)}
      ${manager && g.hiddenAt ? html`<p class="note" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung.</p>` : ''}
      ${this.editing && manager ? this.editForm(g) : ''}
      ${this.stats(d)}
      ${manager ? html`${this.requests(g, d)}${this.invites(g, d.invites ?? [])}` : ''}
      ${d.teams.length
        ? html`<section aria-labelledby="teams-t"><h2 class="eyebrow" id="teams-t">Teams</h2>
            <div class="cards">${d.teams.map((t) => html`<div class="card">${icon('sail')}<a href="/g/${t.slug}">${t.name}</a></div>`)}</div></section>`
        : ''}
      <section aria-labelledby="news-t">
        <div class="row" style="justify-content:space-between">
          <h2 class="eyebrow" id="news-t">Neuigkeiten</h2>
          ${g.visibility === 'public' ? html`<a class="btn small ghost" href="/g/${g.slug}/feed.xml" type="application/atom+xml">${icon('link')} RSS</a>` : ''}
        </div>
        ${manager ? this.composer(g) : ''}
        <sx-stream scope="group" in-group .items=${this.stream?.items ?? []} .cursor=${this.stream?.cursor ?? null} ?loading=${this.streamLoading}
          empty-text="Noch keine Neuigkeiten in dieser Gruppe."></sx-stream>
      </section>
      ${this.members(d)}
      ${this.boats(d)}
    `;
  }

  render() {
    if (this.mode === 'create') return this.createForm();
    let body;
    if (this.loading) body = html`<div class="state">Lade …</div>`;
    else if (this.error || !this.data) body = html`<div class="state">${this.error || 'Diese Gruppe gibt es nicht oder sie ist geschlossen.'}<br /><br /><a class="btn" href="/">${icon('map')} Zur Karte</a></div>`;
    else body = this.view(this.data);
    return html`<div class="page">${body}</div>`;
  }
}
customElements.define('sx-group-page', SxGroupPage);
