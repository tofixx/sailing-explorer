import { LitElement, css, html } from 'lit';
import { LOG_STATE_LABEL, logStateOn, type LogState } from '../domain/logbook';
import { MY_POST_AREAS, whereLabel, whoSeesLabel, type MyPost, type MyPostArea, type PostVisibility } from '../domain/posts';
import { fmtDate, fmtDateTime, fmtNum } from '../util/html';
import { icon, type IconName } from './icons';
import { POST_VISIBILITY_ICON, base, emit, linkedText, postCardStyles } from './shared';
import './sx-post-composer';
import './sx-title-edit';
import type { SxPostComposer } from './sx-post-composer';

const KIND_ICON: Partial<Record<MyPost['kind'], IconName>> = { voyage: 'map', logbook: 'book', text: 'comment' };

/**
 * „Mein Verlauf“ auf der eigenen Seite (Konzept 21.2, B12, F-401): alle eigenen Törns, Fahrtenbuch-Einträge und
 * Beiträge – jede Sichtbarkeit, jeder Verlauf. Jede Karte trennt „Wer sieht es“ (Sichtbarkeit) und „Wo steht es“
 * (Verlauf); „Nur ich“ steht zusätzlich im Bereich „Privat“. Dazu ein Text-Beitrag im eigenen Profil (F-420) und am
 * Törn der Schalter „Ins Fahrtenbuch“ (F-422). Rein präsentational – Events: `sx-my-posts-area` { area },
 * `sx-my-posts-more`, `sx-my-post-create` { body, link, visibility }, `sx-my-post-delete` { id, kind },
 * `sx-log-state` { id, logState }.
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
  };
  declare items: MyPost[];
  declare cursor: string | null;
  declare area: MyPostArea;
  declare loading: boolean;
  declare busy: boolean;
  declare supporter: boolean;

  constructor() {
    super();
    this.items = [];
    this.cursor = null;
    this.area = 'all';
    this.loading = false;
    this.busy = false;
    this.supporter = false;
  }

  static styles = [
    base,
    postCardStyles,
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

  /** Nach erfolgreichem Posten (vom Controller aufgerufen). */
  clearComposer() {
    this.renderRoot.querySelector<SxPostComposer>('sx-post-composer')?.clear();
  }

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

  /** „Wer sieht es“ und „Wo steht es“ – zwei getrennte Angaben (B12). */
  private meta(p: MyPost) {
    const who = whoSeesLabel(p.visibility as PostVisibility, p.channel.kind === 'group' ? p.channel.name : null);
    return html`<div class="meta">
      <span>${icon(POST_VISIBILITY_ICON[p.visibility])} Wer sieht es: <b>${who}</b></span>
      <span>${icon('map')} Wo steht es: <b>${whereLabel(p.channel, p.groups)}</b></span>
      <span>${fmtDateTime(p.createdAt)}</span>
    </div>`;
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
    return html`<li class="post ${p.visibility === 'private' ? 'private' : ''}" id="p-${p.id}">
      <div class="head">
        ${icon(KIND_ICON[p.kind] ?? 'comment')}
        <span class="t">${voyage
          ? html`<sx-title-edit share-id=${p.id} scope="mine" editable .value=${voyage.title}></sx-title-edit>
              <a href=${voyage.path} aria-label="Törn öffnen: ${voyage.title}">Öffnen</a> <span class="note">${fmtNum(voyage.distNm, 1)} sm · ${fmtDate(voyage.startedAt ?? p.createdAt)}</span>`
          : p.channel.kind === 'group'
            ? html`Beitrag in <a href="/g/${p.channel.slug}">${p.channel.name}</a>`
            : 'Beitrag in deinem Profil'}</span>
      </div>
      ${p.body ? html`<p class="body">${linkedText(p.body)}</p>` : ''}
      ${p.link ? html`<a class="link" href=${p.link} rel="nofollow ugc noopener noreferrer" target="_blank">${icon('open')} ${p.link}</a>` : ''}
      ${this.meta(p)}
      ${p.hidden ? html`<span class="warn" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung</span>` : ''}
      <div class="tools">
        ${voyage ? this.logState(p) : ''}
        <button class="btn small ghost danger" ?disabled=${this.busy} aria-label=${voyage ? `Törn ${voyage.title} löschen` : 'Beitrag löschen'}
          @click=${() => emit(this, 'sx-my-post-delete', { id: p.id, kind: p.kind })}>${icon('trash')} Löschen</button>
      </div>
    </li>`;
  }

  render() {
    const more = this.cursor
      ? html`<div class="more"><button class="btn" ?disabled=${this.loading} @click=${() => emit(this, 'sx-my-posts-more')}>${this.loading ? 'Lade …' : 'Mehr laden'}</button></div>`
      : '';
    return html`
      <sx-post-composer label="Beitrag in deinem Profil" placeholder="Was gibt es Neues?" ?busy=${this.busy}
        .choices=${this.supporter ? ['public', 'private'] : ['public']}
        .choiceHints=${{ public: 'Auf deinem Profil und bei deinen Followern – nur bei öffentlichem Profil.', private: 'Nur du siehst ihn – im Bereich „Privat“.' }}
        hint=${this.supporter ? '' : 'Öffentlich, wenn dein Profil öffentlich ist. „Nur ich“ gibt es für Unterstützer.'}
        @sx-post-submit=${(e: CustomEvent) => {
          e.stopPropagation();
          emit(this, 'sx-my-post-create', e.detail);
        }}></sx-post-composer>
      <div class="tabs" role="tablist" aria-label="Bereich" @keydown=${(e: KeyboardEvent) => this.onTabKey(e)}>
        ${this.tab('all', 'Alles', 'globe')} ${this.tab('private', 'Privat', 'lock')}
      </div>
      <div id="my-list" role="tabpanel" aria-labelledby="tab-${this.area}">
        ${this.items.length
          ? html`<ol class="posts">${this.items.map((p) => this.card(p))}</ol>`
          : html`<div class="empty">${this.loading ? 'Lade …' : this.area === 'private' ? 'Nichts Privates – was nur du siehst, steht hier.' : 'Noch nichts. Deine Törns, Fahrtenbuch-Einträge und Beiträge erscheinen hier.'}</div>`}
        ${more}
      </div>`;
  }
}
customElements.define('sx-my-posts', SxMyPosts);
