import { LitElement, css, html } from 'lit';
import type { Boat, GroupInfo, GroupInput, GroupPageData, MyGroup, PendingInvite, StreamPage } from '../services/api';
import {
  APPROVERS, APPROVERS_LABEL, DEFAULT_MEMBERS_VISIBLE, GROUP_KIND_LABEL, MEMBERS_VISIBLE, MEMBERS_VISIBLE_LABEL, GROUP_ROLE_LABEL, GROUP_VISIBILITY_HINT, GROUP_VISIBILITY_LABEL, JOIN_MODES, JOIN_MODE_LABEL, JOIN_MODE_SHORT,
  canApprove, canManageGroup, slugFromName, type Approvers, type GroupKind, type JoinMode, type MembersVisible,
} from '../domain/groups';
import { COVER_FOCUS_DEFAULT } from '../domain/cover';
import './sx-filter-select';
import { POST_BY, POST_BY_LABEL, canWriteInGroup, defaultPostBy, effectivePostBy, type PostBy } from '../domain/posts';
import { VISIBILITIES, sharePath, type Visibility } from '../domain/visibility';
import { fmtNum, plural } from '../util/html';
import { ENTITY_ICON, entityTile, groupIcon, icon } from './icons';
import { base, emit, offerFollow, onMapStyles, pageMenuReveal, webLink, webLinkStyles, tileStyles, writePostButton } from './shared';
import './sx-page-menu';
import type { PageMenuItem } from './sx-page-menu';
import { recordedNote } from '../domain/logbook';
import { VISIBILITY_ICON } from './sx-visibility-picker';
import type { SxHarborPicker } from './sx-harbor-picker';
import './sx-stream';
import { GROUP_LIMITS } from '../domain/limits';
import './sx-follow';
import './sx-notify-bell';
import './sx-harbor-picker';
import './sx-page-media';
import './sx-claim';
import './sx-verified-badge';
import './sx-invite-box';
import type { InviteCreateDetail } from './sx-invite-box';
import { inviteShareText, inviteShareTitle } from '../domain/invite-text';

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
    /** Beitrag aus `/p/<id>` hervorheben (F-406) */
    highlight: { type: String },
    /** Pins der Gruppe und Verwaltungsrecht (F-403) */
    pins: { attribute: false },
    manage: { type: Boolean },
    /** automatische Einträge ausblenden (Gerät, F-447) */
    hideAuto: { type: Boolean, attribute: 'hide-auto' },
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
  };
  declare mode: 'view' | 'create';
  declare data: GroupPageData | null;
  declare stream: StreamPage | null;
  declare streamLoading: boolean;
  declare highlight: string | null;
  declare pins: StreamPage['items'];
  declare manage: boolean;
  declare hideAuto: boolean;
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

  constructor() {
    super();
    this.mode = 'view';
    this.data = null;
    this.stream = null;
    this.streamLoading = false;
    this.highlight = null;
    this.pins = [];
    this.manage = false;
    this.hideAuto = false;
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
  }

  static styles = [
    base,
    pageMenuReveal,
    webLinkStyles,
    tileStyles,
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
        /* eine Spalte, die nie breiter als die Seite wird (Titelbild-Platzhalter, lange Wörter – 375 px) */
        grid-template-columns: minmax(0, 1fr);
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
      /* Spaßname mit Schloss (F-441) – wie in Stream und Crew */
      .pseudo {
        font-style: italic;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .pseudo svg,
      p.faint svg {
        width: 14px;
        height: 14px;
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
      .counter {
        font-size: var(--fs-xs);
        color: var(--text-3);
        text-align: right;
      }
    `,
    onMapStyles,
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
      <div><label class="label" for="gh">Heimathafen${(create ? d.kind : g?.kind) === 'club' ? ' (Pflicht für Vereine – sein Ort auf der Karte)' : ' (optional)'}</label>
        <sx-harbor-picker input-id="gh" label="Heimathafen" .value=${g?.harbor ?? null}></sx-harbor-picker></div>
      <label><span class="label">Beschreibung (optional)</span>
        <textarea maxlength="1000" .value=${d.description ?? ''} @input=${(e: Event) => this.set({ description: (e.target as HTMLTextAreaElement).value })}></textarea></label>
      <label><span class="label">Webseite (optional)</span>
        <input type="url" inputmode="url" maxlength="500" placeholder="https://" .value=${d.webUrl ?? ''} aria-describedby="web-hint"
          @input=${(e: Event) => this.set({ webUrl: (e.target as HTMLInputElement).value.trim() })} />
        <span class="hint" id="web-hint">Erscheint als Link auf der Seite – nur Adressen mit http:// oder https://.</span></label>
      ${create && d.kind === 'team' && this.clubs.length
        ? html`<label><span class="label">Gehört zum Verein (optional)</span>
            <sx-filter-select label="Vereine filtern"><select .value=${d.parentId ?? ''} @change=${(e: Event) => this.set({ parentId: (e.target as HTMLSelectElement).value || null })}>
              <option value="">– kein Verein –</option>
              ${this.clubs.map((c) => html`<option value=${c.id} ?selected=${d.parentId === c.id}>${c.name}</option>`)}
            </select></sx-filter-select></label>`
        : ''}
      ${this.visibilityOptions(g?.visibility, owner)}
      ${!owner ? html`<p class="hint">Die Sichtbarkeit ändert nur der Eigentümer.</p>` : ''}
      <fieldset class="opts" style="border:0;padding:0;margin:0">
        <legend class="label">Beitreten</legend>
        ${(JOIN_MODES as readonly JoinMode[]).map(
          (m) => html`<label class="opt"><input type="radio" name="join" .checked=${d.joinMode === m} @change=${() => this.set({ joinMode: m })} /><span><b>${JOIN_MODE_LABEL[m]}</b></span></label>`,
        )}
      </fieldset>
      ${owner
        ? html`<fieldset class="opts" style="border:0;padding:0;margin:0">
            <legend class="label">Wer bestätigt Anfragen?</legend>
            ${(APPROVERS as readonly Approvers[]).map(
              (a) => html`<label class="opt"><input type="radio" name="approve" .checked=${(d.approveBy ?? 'admins') === a} @change=${() => this.set({ approveBy: a })} /><span><b>${APPROVERS_LABEL[a]}</b></span></label>`,
            )}
            <p class="hint">Wer bestätigen darf, nimmt mit eigenen Einladungen auch direkt auf. „Offen“ gilt nur für öffentliche Gruppen – sonst wird jeder Beitritt zur Anfrage.</p>
          </fieldset>`
        : ''}
      ${!create && owner && g ? this.postByOptions(g.kind, d.postBy ?? effectivePostBy(g.kind, g.postBy)) : ''}
      ${owner ? this.membersVisibleOptions(d.membersVisible ?? g?.membersVisible ?? DEFAULT_MEMBERS_VISIBLE) : ''}
      ${!create && owner && g ? this.daySummaryOption(d.daySummary ?? g.daySummary ?? true) : ''}
      ${this.formError ? html`<p class="error" role="alert">${this.formError}</p>` : ''}
    `;
  }

  /** Wer sieht die Mitgliederliste (F-440) – nur der Eigner; Standard „Nur Mitglieder“. */
  private membersVisibleOptions(current: MembersVisible) {
    return html`<fieldset class="opts" style="border:0;padding:0;margin:0">
      <legend class="label">Wer sieht die Mitgliederliste?</legend>
      ${(MEMBERS_VISIBLE as readonly MembersVisible[]).map(
        (v) => html`<label class="opt"><input type="radio" name="membersvis" .checked=${current === v} @change=${() => this.set({ membersVisible: v })} />
          <span><b>${MEMBERS_VISIBLE_LABEL[v]}</b>${v === DEFAULT_MEMBERS_VISIBLE ? html` <span class="faint">(Standard)</span>` : ''}</span></label>`,
      )}
      <p class="hint">Die Anzahl der Mitglieder sehen alle. Eigentümer und Admins sehen immer alle Anzeigenamen, nie E-Mail-Adressen. Die Boote der Gruppe folgen dieser Einstellung.</p>
    </fieldset>`;
  }

  /** Tageszusammenfassung großer Verläufe (F-469) – nur der Eigner; Standard an. */
  private daySummaryOption(on: boolean) {
    return html`<fieldset class="opts" style="border:0;padding:0;margin:0">
      <legend class="label">Große Gruppe</legend>
      <label class="opt"><input type="checkbox" .checked=${on} @change=${(e: Event) => this.set({ daySummary: (e.target as HTMLInputElement).checked })} />
        <span><b>Ältere Tage zusammenfassen</b> <span class="faint">(Standard)</span></span></label>
      <p class="hint">Bei mehr als ${GROUP_LIMITS.summaryMembers} Mitgliedern oder mehr als ${GROUP_LIMITS.summaryPerDay} Einträgen an einem Tag zeigen die Neuigkeiten ältere Tage als eine Karte mit „Alle anzeigen“. Beiträge von Eigentümer und Admins, Umfragen und Veranstaltungen bleiben einzeln, für Mitglieder auch die eigenen.</p>
    </fieldset>`;
  }

  /** Wer schreibt Beiträge (F-421) – nur der Eigner; Standard je Art ist markiert. */
  private postByOptions(kind: GroupKind, current: PostBy) {
    return html`<fieldset class="opts" style="border:0;padding:0;margin:0">
      <legend class="label">Wer darf Beiträge schreiben?</legend>
      ${(POST_BY as readonly PostBy[]).map(
        (b) => html`<label class="opt"><input type="radio" name="postby" .checked=${current === b} @change=${() => this.set({ postBy: b })} />
          <span><b>${POST_BY_LABEL[b]}</b>${b === defaultPostBy(kind) ? html` <span class="faint">(Standard für ${kind === 'club' ? 'Vereine' : 'Teams'})</span>` : ''}</span></label>`,
      )}
    </fieldset>`;
  }

  private createForm() {
    return html`<div class="page">
      <header class="hero">
        ${entityTile(ENTITY_ICON.club)}
        <div class="head"><h1>Verein oder Team gründen</h1><div class="lead">Bring deine Leute zusammen: Mitglieder, Boote, Törns und Neuigkeiten an einem Ort.</div></div>
      </header>
      ${this.signedIn
        ? html`<form class="box" @submit=${(e: Event) => {
            e.preventDefault();
            const problem = this.harborProblem(this.draft.kind === 'club');
            if (problem) return void (this.formError = problem);
            emit(this, 'sx-group-create', { ...this.draft, ...this.harborInput() });
          }}>
            ${this.fields(true, null)}
            <div class="row"><button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} Gruppe anlegen</button><a class="btn ghost" href="/">Abbrechen</a></div>
            <p class="hint">Kostenlos kannst du eine öffentliche Gruppe anlegen, als Unterstützer bis zu zehn – auch geschlossene.</p>
          </form>`
        : html`<div class="state">Zum Gründen bitte anmelden.<br /><br /><button class="btn primary" @click=${() => emit(this, 'sx-login')}>Anmelden</button></div>`}
    </div>`;
  }

  /** Hafen aus der Auswahl (Konzept 13.3): vorhandener per ID, neuer Name als Text – der Server erkennt Dubletten. */
  private harborInput(): Pick<GroupInput, 'harborId' | 'homePort' | 'homePortPos'> {
    const picker = this.renderRoot.querySelector<SxHarborPicker>('sx-harbor-picker');
    if (!picker) return {};
    const c = picker.choice;
    return 'name' in c ? { homePort: c.name, homePortPos: c.pos } : { harborId: c.harborId };
  }

  /** Hafen-Pflicht vorab prüfen (F-353/F-354), statt erst auf den Fehler des Servers zu warten. */
  private harborProblem(required: boolean): string | null {
    return this.renderRoot.querySelector<SxHarborPicker>('sx-harbor-picker')?.problem(required) ?? null;
  }

  /** Bearbeiten öffnen: Entwurf aus der aktuellen Gruppe. */
  private startEdit(g: GroupInfo) {
    this.draft = { name: g.name, slug: g.slug, description: g.description, webUrl: g.webUrl ?? '', visibility: g.visibility, joinMode: g.joinMode, approveBy: g.approveBy ?? 'admins', postBy: effectivePostBy(g.kind, g.postBy), membersVisible: g.membersVisible ?? DEFAULT_MEMBERS_VISIBLE, ...(g.daySummary !== undefined ? { daySummary: g.daySummary } : {}) };
    this.editing = true;
  }

  private editForm(g: GroupInfo) {
    return html`<form class="box" aria-label="Gruppe bearbeiten" @submit=${(e: Event) => {
        e.preventDefault();
        // Bearbeiten: nur die Lage eines neuen Hafens prüfen – bestehende Vereine ohne Hafen bleiben bearbeitbar
        const problem = this.harborProblem(false);
        if (problem) return void (this.formError = problem);
        const patch: GroupInput = { ...this.draft, ...this.harborInput() };
        if (g.role !== 'owner' || patch.visibility === g.visibility) delete patch.visibility;
        if (g.role !== 'owner') {
          delete patch.approveBy;
          delete patch.postBy;
          delete patch.membersVisible;
          delete patch.daySummary;
        }
        emit(this, 'sx-group-save', { id: g.id, patch });
      }}>
      ${this.fields(false, g)}
      <div class="row">
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} Speichern</button>
        <button class="btn ghost" type="button" @click=${() => (this.editing = false)}>Abbrechen</button>
        ${g.visibility === 'unlisted' ? html`<button class="btn" type="button" @click=${() => emit(this, 'sx-group-save', { id: g.id, patch: { rotateKey: true } })}>${icon('link')} Link erneuern</button>` : ''}
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
      <div class="stat"><div class="eyebrow">Seemeilen</div><div class="v">${fmtNum(s.distNm, 0)}<small>sm</small></div>${s.recordedNm !== undefined && recordedNote(s.distNm, s.recordedNm) ? html`<div class="hint">${recordedNote(s.distNm, s.recordedNm)}</div>` : ''}</div>
      <div class="stat"><div class="eyebrow">Saison ${new Date().getFullYear()}</div><div class="v">${fmtNum(s.seasonNm, 0)}<small>sm</small></div></div>
    </div>`;
  }

  /**
   * Zahnrad-Menü (N6, F-429): Bearbeiten und Löschen (Verwalter bzw. Eigentümer), Austreten (Mitglieder außer dem
   * Eigentümer), Melden (alle anderen) – nur, was erlaubt ist. Stumm und die anderen Stufen stehen an der Glocke (F-449).
   */
  private menuItems(d: GroupPageData): PageMenuItem[] {
    const g = d.group;
    const m = d.membership;
    const manager = canManageGroup(g.role);
    const items: PageMenuItem[] = [];
    if (manager) items.push({ id: 'edit', label: 'Bearbeiten', icon: 'pencil' });
    if (m.role && m.role !== 'owner') items.push({ id: 'leave', label: 'Austreten', icon: 'logout' });
    if (!manager) items.push({ id: 'report', label: 'Melden', icon: 'flag', divider: items.length > 0 });
    if (g.role === 'owner') items.push({ id: 'delete', label: 'Gruppe löschen', icon: 'trash', danger: true, divider: true });
    return items;
  }

  private onMenu(d: GroupPageData, id: string) {
    const g = d.group;
    if (id === 'edit') this.startEdit(g);
    else if (id === 'leave' && confirm(`„${g.name}“ verlassen?`)) emit(this, 'sx-group-leave', { id: g.id, follow: offerFollow(g) });
    else if (id === 'report') emit(this, 'sx-report', { kind: 'group', id: g.id, label: `die Gruppe ${g.name}`, image: !!d.cover && !d.coverHeldUntil });
    else if (id === 'delete' && confirm(`„${g.name}“ wirklich löschen? Mitglieder, Beiträge und Neuigkeiten der Gruppe werden gelöscht. Törns und Boote bleiben.`)) emit(this, 'sx-group-delete', { id: g.id });
  }

  private joinActions(d: GroupPageData) {
    const g = d.group;
    const m = d.membership;
    // Gäste: erst anmelden; bei „Nur auf Einladung“ nur der Hinweis wie für Angemeldete (F-333)
    if (!this.signedIn) return g.joinMode !== 'invite' ? html`<button class="btn primary" @click=${() => emit(this, 'sx-login')}>${icon('user')} Anmelden und beitreten</button>` : html`<span class="faint">Beitritt nur auf Einladung</span>`;
    // Mitglieder: Glocke mit Stufe (F-449, „Stumm“ = F-346), Austreten im Zahnrad-Menü (N6)
    if (m.role) {
      return html`<sx-notify-bell kind="group" target-id=${g.id} label=${g.name} level=${d.social.notifyLevel ?? (m.muted ? 'muted' : 'important')}></sx-notify-bell>${m.role === 'owner'
        ? html`<span class="faint" title="Übergib die Gruppe in der Mitgliederliste an einen Admin – danach kannst du austreten.">Eigentümer · erst übergeben, dann austreten</span>`
        : ''}`;
    }
    if (m.requested) return html`<span class="faint">Anfrage gestellt</span><button class="btn ghost" @click=${() => emit(this, 'sx-group-withdraw', { id: g.id })}>Anfrage zurückziehen</button>`;
    if (m.canJoin) return html`<button class="btn primary" ?disabled=${this.busy} @click=${() => emit(this, 'sx-group-join', { id: g.id })}>${icon('user')} Beitreten</button>`;
    if (m.canRequest) return html`<button class="btn primary" ?disabled=${this.busy} @click=${() => emit(this, 'sx-group-join', { id: g.id })}>${icon('user')} Beitritt anfragen</button>`;
    return html`<span class="faint">Beitritt nur auf Einladung</span>`;
  }

  private hero(d: GroupPageData) {
    const g = d.group;
    const manager = canManageGroup(g.role);
    const path = manager && g.link ? g.link : sharePath('g', g.slug, g.visibility, null);
    const v = g.visibility;
    return html`<header class="hero">
      ${entityTile(groupIcon(g.kind))}
      <div class="head">
        <h1>${g.name}${g.verified ? html` <sx-verified-badge kind="group"></sx-verified-badge>` : ''}</h1>
        ${g.description ? html`<div class="lead">${g.description}</div>` : ''}
        <div class="facts">
          <span>${GROUP_KIND_LABEL[g.kind]}</span>
          <span>${JOIN_MODE_SHORT[g.joinMode] ?? ''}</span>
          ${g.harbor ? html`<span>Heimathafen <a href="/h/${g.harbor.slug}">${g.harbor.name}</a></span>` : g.homePort ? html`<span>Heimathafen ${g.homePort}</span>` : ''}
          ${d.parent ? html`<span>im Verein <a href="/g/${d.parent.slug}">${d.parent.name}</a></span>` : ''}
          ${webLink(g.webUrl)}
          ${manager ? html`<span class="vis">${icon(VISIBILITY_ICON[v] ?? 'lock')} ${GROUP_VISIBILITY_LABEL[v]}</span>` : ''}
          ${g.role ? html`<span>Du: ${GROUP_ROLE_LABEL[g.role]}</span>` : ''}
        </div>
      </div>
      <div class="actions">
        ${this.joinActions(d)}
        ${v === 'public' && !d.membership.role
          ? html`<sx-follow kind="group" target-id=${g.id} label=${g.name} .stats=${d.social} ?signed-in=${this.signedIn}
              title="Folgen: Neuigkeiten der Gruppe in deinem Stream, ohne Mitglied zu sein"></sx-follow>`
          : ''}
        ${v !== 'private' || manager ? html`<button class="btn" @click=${() => emit(this, 'sx-page-share', { path: v === 'unlisted' && !manager ? location.pathname : path, title: g.name })}>${icon('share')} Teilen</button>` : ''}
        <sx-page-menu label=${g.name} .items=${this.menuItems(d)} @sx-page-menu-pick=${(e: CustomEvent<{ id: string }>) => this.onMenu(d, e.detail.id)}></sx-page-menu>
        ${g.kind === 'club' && !(g.verified && g.role === 'owner')
          ? html`<sx-claim kind="group" target-id=${g.id} name=${g.name} ?signed-in=${this.signedIn}></sx-claim>`
          : ''}
      </div>
    </header>`;
  }

  /** „Leute einladen“ im gemeinsamen `sx-invite-box` (F-590); offene Einladungen sehen nur Verwalter. */
  private invites(g: GroupInfo, list: PendingInvite[]) {
    const approval = !canApprove(g.role, g.approveBy ?? 'admins') && !(g.joinMode === 'open' && g.visibility === 'public');
    return html`<div class="box" aria-label="Einladen">
      <h3 class="eyebrow">Leute einladen</h3>
      <sx-invite-box .link=${this.inviteLink ?? ''} ?busy=${this.busy} .pending=${list}
        link-note="Nur jetzt sichtbar · ${GROUP_LIMITS.inviteDays} Tage gültig · bis zu ${GROUP_LIMITS.linkUses} Personen."
        share-title=${inviteShareTitle()} share-text=${inviteShareText({ kind: 'group', groupKind: g.kind, target: g.name })}
        @invite-create=${(e: CustomEvent<InviteCreateDetail>) => emit(this, 'sx-group-invite', { id: g.id, to: e.detail.to, done: e.detail.done })}
        @invite-revoke=${(e: CustomEvent<{ id: string }>) => emit(this, 'sx-group-invite-revoke', { id: e.detail.id })}>
        ${approval ? html`<p class="hint">Wer deine Einladung annimmt, stellt eine Beitrittsanfrage, die in dieser Gruppe andere bestätigen.</p>` : ''}
      </sx-invite-box>
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

  /**
   * Mitgliederliste (F-441): verborgen nur die Anzahl; sonst Namen mit öffentlichem Profil, alle anderen mit dem
   * Spaßnamen dieser Gruppe (Schloss, kursiv); Eigner und Admins sehen alle Anzeigenamen.
   */
  private members(d: GroupPageData) {
    const g = d.group;
    const owner = g.role === 'owner';
    if (d.membersHidden) {
      return html`<section aria-labelledby="mem-t">
        <h2 class="eyebrow" id="mem-t">Mitglieder</h2>
        <p class="faint">${icon('lock')} ${plural(d.stats.members, 'Mitglied', 'Mitglieder')} – die Liste sehen nur Mitglieder.</p>
      </section>`;
    }
    return html`<section aria-labelledby="mem-t">
      <h2 class="eyebrow" id="mem-t">Mitglieder</h2>
      <ul class="list">
        ${d.members.map(
          (m) => html`<li>
            <span class="avatar" aria-hidden="true">${m.displayName[0]}</span>
            <span class="name">${m.handle ? html`<a href="/u/${m.handle}">${m.displayName}</a>` : m.alias ? html`<span class="pseudo" title="Spaßname – das Profil ist nicht öffentlich">${icon('lock')}${m.displayName}</span>` : m.displayName}${m.isSelf ? html` <span class="faint">(du)</span>` : ''}</span>
            ${m.role !== 'member' ? html`<span class="role">${GROUP_ROLE_LABEL[m.role]}</span>` : ''}
            ${owner && m.id && m.role !== 'owner'
              ? html`<button class="btn small ghost" @click=${() => emit(this, 'sx-group-role', { id: g.id, userId: m.id, role: m.role === 'admin' ? 'member' : 'admin' })}>${m.role === 'admin' ? 'Admin absetzen' : 'Zum Admin'}</button>`
              : ''}
            ${owner && m.id && m.role === 'admin'
              ? html`<button class="btn small ghost" @click=${() => confirm(`„${g.name}“ an ${m.displayName} übergeben? Du bleibst Admin und kannst danach austreten.`) && emit(this, 'sx-group-transfer', { id: g.id, userId: m.id })}>Übergeben</button>`
              : ''}
            ${m.id && !m.isSelf && m.role !== 'owner' && (owner || m.role === 'member') && canManageGroup(g.role)
              ? html`<button class="btn small ghost danger" aria-label="${m.displayName} entfernen" @click=${() => confirm(`${m.displayName} aus der Gruppe entfernen?`) && emit(this, 'sx-group-remove', { id: g.id, userId: m.id })}>${icon('x')}</button>`
              : ''}
          </li>`,
        )}
      </ul>
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
              (b) => html`<div class="card">${icon(ENTITY_ICON.boat)}<a href="/b/${b.id}">${b.name}${b.public ? '' : html` <span class="faint">(nicht öffentlich)</span>`}</a>
                ${b.canRemove ? html`<button class="btn small ghost" aria-label="${b.name} aus der Gruppe entfernen" @click=${() => emit(this, 'sx-group-boat-remove', { id: g.id, boatId: b.id })}>${icon('x')}</button>` : ''}</div>`,
            )}
          </div>`
        : html`<div class="empty">Noch keine öffentlichen Boote.</div>`}
      ${addable.length
        ? html`<form class="row" @submit=${(e: Event) => {
            e.preventDefault();
            if (pick) emit(this, 'sx-group-boat-add', { id: g.id, boatId: pick });
          }}>
            <sx-filter-select label="Boote filtern"><select aria-label="Eigenes Boot zuordnen" @change=${(e: Event) => (pick = (e.target as HTMLSelectElement).value)}>
              ${addable.map((b) => html`<option value=${b.id}>${b.name}</option>`)}
            </select></sx-filter-select>
            <button class="btn" type="submit" ?disabled=${this.busy}>${icon('sail')} Boot zuordnen</button>
          </form>`
        : ''}
    </section>`;
  }

  private view(d: GroupPageData) {
    const g = d.group;
    const manager = canManageGroup(g.role);
    return html`
      <sx-cover kind="g" target-id=${g.id} .src=${d.cover ?? null} .focusY=${d.coverY ?? COVER_FOCUS_DEFAULT} .heldUntil=${d.coverHeldUntil ?? null} ?can-edit=${manager} label="Titelbild von ${g.name}"></sx-cover>
      ${this.hero(d)}
      ${manager && g.hiddenAt ? html`<p class="note" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung.</p>` : ''}
      ${this.editing && manager ? this.editForm(g) : ''}
      ${this.stats(d)}
      ${d.membership.canApprove ?? manager ? this.requests(g, d) : ''}
      ${g.role ? this.invites(g, manager ? (d.invites ?? []) : []) : ''}
      ${d.teams.length
        ? html`<section aria-labelledby="teams-t"><h2 class="eyebrow" id="teams-t">Teams</h2>
            <div class="cards">${d.teams.map((t) => html`<div class="card">${icon(ENTITY_ICON.team)}<a href="/g/${t.slug}">${t.name}</a></div>`)}</div></section>`
        : ''}
      <section aria-labelledby="news-t">
        <div class="row" style="justify-content:space-between">
          <h2 class="eyebrow" id="news-t">Neuigkeiten</h2>
          <span class="row">
            ${g.visibility === 'public' ? html`<a class="btn small ghost" href="/g/${g.slug}/feed.xml" type="application/atom+xml">${icon('link')} RSS</a>` : ''}
            ${canWriteInGroup(g.role, effectivePostBy(g.kind, g.postBy)) ? writePostButton(this) : ''}
          </span>
        </div>
        <sx-stream scope="group" in-group ?hide-auto=${this.hideAuto} .items=${this.stream?.items ?? []} .days=${this.stream?.days ?? []} .cursor=${this.stream?.cursor ?? null} ?loading=${this.streamLoading} .highlight=${this.highlight}
          .pins=${this.pins} ?manage=${this.manage}
          empty-text="Noch keine Neuigkeiten in dieser Gruppe."></sx-stream>
      </section>
      <sx-gallery .photos=${d.photos ?? []} heading="Fotos aus Törns von Mitgliedern und Booten"></sx-gallery>
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
