import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { LOG_STATE_LABEL, logStateOn, type LogState } from '../domain/logbook';
import {
  MY_POST_AREAS, POST_VISIBILITY_CHOICE, REACH_LABEL, channelKey, channelName, channelPath, whereLabel, whoSeesLabel,
  type ComposeTarget, type MyPost, type MyPostArea, type PostVisibility, type Reach,
} from '../domain/posts';
import { fmtDate, fmtDateTime, fmtNum } from '../util/html';
import { icon, type IconName } from './icons';
import { POST_VISIBILITY_ICON, base, emit, highlightStyles, linkedText, postCardStyles, revealCard } from './shared';
import './sx-reach-picker';
import './sx-title-edit';

const KIND_ICON: Partial<Record<MyPost['kind'], IconName>> = { voyage: 'map', logbook: 'book', text: 'comment', poll: 'poll' };

/**
 * „Mein Verlauf“ auf der eigenen Seite (Konzept 21.2, B12, F-401): alle eigenen Törns, Fahrtenbuch-Einträge und
 * Beiträge – jede Sichtbarkeit, jeder Verlauf. Jede Karte trennt „Wer sieht es“ (Sichtbarkeit) und „Wo steht es“
 * (Verlauf); „Nur ich“ steht zusätzlich im Bereich „Privat“. Dazu ein Text-Beitrag im eigenen Profil (F-420) und am
 * Törn der Schalter „Ins Fahrtenbuch“ (F-422). Reiter „Alles · Nur ich“; das Fahrtenbuch hat eine eigene Seite
 * (`/konto/fahrtenbuch`, F-459). Neues entsteht nur über „+ Neu“. Text-Beiträge tragen „Sichtbar bis“, Teilen (mit Schlüssel
 * bei „Nur mit Link“) und „Sichtbarkeit“ ändern (F-409). Rein präsentational – Events: `sx-my-posts-area` { area },
 * `sx-my-posts-more`, `sx-my-post-delete` { id, kind }, `sx-my-post-update` { id, visibility, reach }, `sx-log-state`
 * { id, logState }, `sx-page-share` { path, title }.
 */
export class SxMyPosts extends LitElement {
  static properties = {
    items: { attribute: false },
    cursor: { type: String },
    area: { type: String },
    loading: { type: Boolean },
    busy: { type: Boolean },
    /** darf „Nur ich“ wählen (Unterstützer, E1) */
    supporter: { type: Boolean },
    /** Verläufe mit Stufen und Kette (zum Ändern von „Sichtbar bis“, F-409) */
    targets: { attribute: false },
    highlight: { type: String },
    editing: { state: true },
    editVis: { state: true },
    editReach: { state: true },
  };
  declare items: MyPost[];
  declare cursor: string | null;
  declare area: MyPostArea;
  declare loading: boolean;
  declare busy: boolean;
  declare supporter: boolean;
  declare targets: ComposeTarget[];
  declare highlight: string | null;
  /** Beitrag, dessen Sichtbarkeit gerade geändert wird */
  declare editing: string | null;
  declare editVis: PostVisibility;
  declare editReach: Reach;

  constructor() {
    super();
    this.items = [];
    this.cursor = null;
    this.area = 'all';
    this.loading = false;
    this.busy = false;
    this.supporter = false;
    this.targets = [];
    this.highlight = null;
    this.editing = null;
    this.editVis = 'public';
    this.editReach = 'all';
  }

  private shown: string | null = null;

  updated(changed: PropertyValues<this>) {
    if (!this.highlight || (!changed.has('highlight') && !changed.has('items')) || this.shown === this.highlight) return;
    if (revealCard(this.renderRoot as ShadowRoot, this.highlight)) this.shown = this.highlight;
  }

  private target(p: MyPost): ComposeTarget | undefined {
    const key = channelKey(p.channel);
    return this.targets.find((t) => channelKey(t.ref) === key);
  }

  static styles = [
    base,
    postCardStyles,
    highlightStyles,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
      }
      .tabs {
        display: flex;
        gap: var(--s-1);
        padding: 2px;
        border-radius: 999px;
        background: var(--surface-2);
        justify-self: start;
      }
      .tabs button {
        min-height: 40px;
        padding: 0 var(--s-4);
        border: 0;
        border-radius: 999px;
        background: none;
        color: var(--text-2);
        font: 600 var(--fs-s) / 1 var(--font);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
      }
      .tabs button[aria-selected='true'] {
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-1);
      }
      .switch {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        min-height: 40px;
        font-size: var(--fs-s);
        cursor: pointer;
      }
      .note {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .edit {
        display: grid;
        gap: var(--s-2);
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface-2);
      }
      .warn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--fs-s);
        padding: 2px var(--s-2);
        border-radius: var(--radius);
        background: var(--warn-bg);
      }
    `,
  ];

  private tab(area: MyPostArea, label: string, ic: IconName) {
    const on = this.area === area;
    return html`<button role="tab" id="tab-${area}" aria-selected=${on ? 'true' : 'false'} aria-controls="my-list" tabindex=${on ? 0 : -1}
      @click=${() => !on && emit(this, 'sx-my-posts-area', { area })}>${icon(ic)} ${label}</button>`;
  }

  /** Tabs-Muster: Pfeiltasten, Pos1 und Ende wechseln den Reiter und setzen den Fokus. */
  private onTabKey(e: KeyboardEvent) {
    const i = MY_POST_AREAS.indexOf(this.area);
    const last = MY_POST_AREAS.length - 1;
    const next = e.key === 'ArrowRight' ? (i + 1) % (last + 1) : e.key === 'ArrowLeft' ? (i + last) % (last + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    const area = MY_POST_AREAS[next];
    this.renderRoot.querySelector<HTMLButtonElement>(`#tab-${area}`)?.focus();
    if (area !== this.area) emit(this, 'sx-my-posts-area', { area });
  }

  /** „Wer sieht es“ und „Wo steht es“ – zwei getrennte Angaben (B12); bei Text-Beiträgen „Sichtbar bis“ (F-409). */
  private meta(p: MyPost) {
    const who = whoSeesLabel(p.visibility as PostVisibility, p.channel.kind === 'group' ? p.channel.name : null);
    return html`<div class="meta">
      <span>${icon(POST_VISIBILITY_ICON[p.visibility])} Wer sieht es: <b>${who}</b></span>
      <span>${icon('map')} Wo steht es: <b>${whereLabel(p.channel, p.groups)}</b></span>
      ${p.reach && p.visibility === 'public' ? html`<span>${icon('globe')} Sichtbar bis: <b>${REACH_LABEL[p.reach]}</b></span>` : ''}
      <span>${fmtDateTime(p.createdAt)}</span>
    </div>`;
  }

  /** Sichtbarkeit und „Sichtbar bis“ ändern (F-409) – nur mit den Stufen, die es im Verlauf gibt. */
  private editor(p: MyPost, t: ComposeTarget) {
    const choices = t.choices.includes(p.visibility) ? t.choices : [p.visibility, ...t.choices];
    return html`<div class="edit">
      <label><span class="label">Wer sieht es?</span>
        <select @change=${(e: Event) => (this.editVis = (e.target as HTMLSelectElement).value as PostVisibility)}>
          ${choices.map((v) => html`<option value=${v} ?selected=${v === this.editVis}>${POST_VISIBILITY_CHOICE[v]}</option>`)}
        </select></label>
      ${this.editVis === 'public'
        ? html`<sx-reach-picker .options=${t.reaches} .value=${this.editReach} @sx-reach-change=${(e: CustomEvent<{ reach: Reach }>) => (this.editReach = e.detail.reach)}></sx-reach-picker>`
        : html`<span class="note">Nicht öffentliche Beiträge bleiben nur hier.</span>`}
      <div class="tools">
        <button class="btn small primary" ?disabled=${this.busy} @click=${() => {
          emit(this, 'sx-my-post-update', { id: p.id, visibility: this.editVis, reach: this.editReach });
          this.editing = null;
        }}>${icon('check')} Speichern</button>
        <button class="btn small" @click=${() => (this.editing = null)}>Abbrechen</button>
      </div>
    </div>`;
  }

  /** Text-Beitrag: wo er steht (verlinkt). */
  private textHead(p: MyPost) {
    const path = channelPath(p.channel);
    return p.channel.kind === 'user' ? 'Beitrag in deinem Profil' : html`Beitrag in <a href=${path ?? '/'}>${channelName(p.channel)}</a>`;
  }

  /** „Ins Fahrtenbuch“ (F-422): an = Vorschlag bzw. bestätigt, aus = ausgeschlossen; Vorschläge lassen sich bestätigen. */
  private logState(p: MyPost) {
    const v = p.voyage!;
    const on = v.logState !== 'excluded';
    const set = (logState: LogState) => emit(this, 'sx-log-state', { id: p.id, logState });
    return html`<label class="switch" title=${LOG_STATE_LABEL[v.logState]}>
        <input type="checkbox" role="switch" .checked=${on} ?disabled=${this.busy}
          @change=${() => set(on ? 'excluded' : logStateOn(p.kind === 'logbook' ? 'manual' : 'gpx'))} />
        Ins Fahrtenbuch</label>
      ${v.logState === 'suggested' ? html`<button class="btn small" ?disabled=${this.busy} @click=${() => set('confirmed')}>${icon('check')} Bestätigen</button>` : ''}
      ${on ? '' : html`<span class="note">zählt nicht in Seemeilen und Kennzahlen</span>`}`;
  }

  private card(p: MyPost) {
    const voyage = p.voyage;
    const target = voyage ? undefined : this.target(p);
    const hl = p.id === this.highlight;
    return html`<li class="post ${p.visibility === 'private' ? 'private' : ''} ${hl ? 'hl' : ''}" id="p-${p.id}" tabindex=${hl ? -1 : nothing}>
      <div class="head">
        ${icon(KIND_ICON[p.kind] ?? 'comment')}
        <span class="t">${voyage
          ? html`<sx-title-edit share-id=${p.id} scope="mine" editable .value=${voyage.title}></sx-title-edit>
              <a href=${voyage.path} aria-label="Törn öffnen: ${voyage.title}">Öffnen</a> <span class="note">${fmtNum(voyage.distNm, 1)} sm · ${fmtDate(voyage.startedAt ?? p.createdAt)}</span>`
          : this.textHead(p)}</span>
      </div>
      ${p.body ? html`<p class="body">${linkedText(p.body)}</p>` : ''}
      ${p.kind === 'poll' && p.path ? html`<a class="note" href=${p.path}>${icon('poll')} Zur Umfrage – abstimmen und Ergebnis</a>` : ''}
      ${p.link ? html`<a class="link" href=${p.link} rel="nofollow ugc noopener noreferrer" target="_blank">${icon('open')} ${p.link}</a>` : ''}
      ${p.attached ? html`<span class="note">${icon('map')} Törn: <a href="/s/${p.attached.id}">${p.attached.title}</a></span>` : ''}
      ${this.meta(p)}
      ${p.hidden ? html`<span class="warn" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung</span>` : ''}
      ${target && this.editing === p.id ? this.editor(p, target) : ''}
      <div class="tools">
        ${voyage ? this.logState(p) : ''}
        ${!voyage && p.path && p.visibility !== 'private'
          ? html`<button class="btn small ghost" @click=${() => emit(this, 'sx-page-share', { path: p.path, title: 'Beitrag' })}>${icon('share')} Teilen</button>`
          : ''}
        ${!voyage && p.channel.kind === 'user' && p.visibility !== 'private'
          ? html`<button class="btn small ghost" ?disabled=${this.busy} @click=${() => emit(this, 'sx-pin', { postId: p.id, pinned: !p.pinned, own: true })}>
              ${icon('pin')} ${p.pinned ? 'Lösen' : 'Im Profil anpinnen'}</button>`
          : ''}
        ${target && this.editing !== p.id
          ? html`<button class="btn small ghost" ?disabled=${this.busy} @click=${() => {
              this.editing = p.id;
              this.editVis = p.visibility;
              this.editReach = p.reach ?? 'here';
            }}>${icon('pencil')} Sichtbarkeit</button>`
          : ''}
        <button class="btn small ghost danger" ?disabled=${this.busy} aria-label=${voyage ? `Törn ${voyage.title} löschen` : 'Beitrag löschen'}
          @click=${() => emit(this, 'sx-my-post-delete', { id: p.id, kind: p.kind })}>${icon('trash')} Löschen</button>
      </div>
    </li>`;
  }

  render() {
    const more = this.cursor
      ? html`<div class="more"><button class="btn" ?disabled=${this.loading} @click=${() => emit(this, 'sx-my-posts-more')}>${this.loading ? 'Lade …' : 'Mehr laden'}</button></div>`
      : '';
    // Neues entsteht über „+ Neu“ (ein Einstieg, F-405)
    const empty = this.loading
      ? 'Lade …'
      : this.area === 'private'
        ? 'Nichts, was nur du siehst – „Nur ich“ wählst du beim Schreiben bzw. Teilen.'
        : 'Noch nichts. Über „+ Neu“ legst du Törns, Fahrtenbuch-Einträge und Beiträge an.';
    return html`
      <div class="tabs" role="tablist" aria-label="Bereich" @keydown=${(e: KeyboardEvent) => this.onTabKey(e)}>
        ${this.tab('all', 'Alles', 'globe')} ${this.tab('private', 'Nur ich', 'lock')}
      </div>
      <div id="my-list" role="tabpanel" aria-labelledby="tab-${this.area}">
        ${this.items.length ? html`<ol class="posts">${this.items.map((p) => this.card(p))}</ol>` : html`<div class="empty">${empty}</div>`}
        ${more}
      </div>`;
  }
}
customElements.define('sx-my-posts', SxMyPosts);
