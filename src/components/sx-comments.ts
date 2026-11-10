import { LitElement, html, css, type PropertyValues } from 'lit';
import type { CommentItem, CommentList, CommentThread } from '../services/api';
import { COMMENTS_MODES, COMMENTS_MODE_LABEL, cleanComment, commentLength, countLinks, linkify, type CommentsMode } from '../domain/comment-text';
import { fmtDateTime } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/**
 * Kommentare eines Verlaufs (Konzept 4.3, 40): Törn (Panel der Törn-Ansicht) oder Beitrag (Karte im Stream) – reine
 * Darstellung, Aktionen gehen als Events mit sich selbst als `el` raus: `sx-comment-post` { body, el },
 * `sx-comment-delete` { id, el }, `sx-comment-subscribe` { on, el } (Glocke, F-639), `sx-comments-mode` { mode, el }
 * (nur Beiträge, F-636), `sx-comments-load` { el } (mit `autoload`, sobald ein Verlauf ohne Daten gesetzt ist),
 * `sx-report` { kind, id, label, key }, `sx-login`, `sx-account` ('profile'). Text wird nie als HTML ausgewertet;
 * Links entstehen aus dem geparsten Text und tragen rel="nofollow ugc noopener noreferrer".
 * Ruhig (F-514): das Formular erscheint erst nach „Kommentieren“, Melden/Löschen je Kommentar mit Maus erst bei Hover.
 * Kommentar-Einstellung und „Törn melden“ liegen beim Törn im Zahnrad-Menü (F-510); beim Beitrag stellt die Autor:in
 * den Modus im Kopf der Kommentare (ein Einstieg je Gegenstand).
 */
export class SxComments extends LitElement {
  static properties = {
    data: { attribute: false },
    thread: { attribute: false },
    autoload: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    draft: { type: String },
    confirm: { state: true },
    writing: { type: Boolean },
  };
  declare data: CommentList | null;
  /** Verlauf, zu dem die Kommentare gehören (Törn oder Beitrag, Konzept 40) */
  declare thread: CommentThread | null;
  /** Daten selbst anfordern (`sx-comments-load`), sobald ein Verlauf ohne Daten gesetzt ist – Beitragskarten */
  declare autoload: boolean;
  declare busy: boolean;
  declare error: string;
  /** Text im Formular – der Controller leert ihn nach dem Absenden */
  declare draft: string;
  /** Löschen eines Kommentars wartet auf Bestätigung */
  declare confirm: string | null;
  /** Formular aufgeklappt („Kommentieren“ geklickt); der Controller klappt es nach dem Absenden zu (F-514) */
  declare writing: boolean;

  constructor() {
    super();
    this.data = null;
    this.thread = null;
    this.autoload = false;
    this.busy = false;
    this.error = '';
    this.draft = '';
    this.confirm = null;
    this.writing = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-3);
      }
      li {
        display: grid;
        gap: var(--s-1);
        padding-bottom: var(--s-3);
        border-bottom: 1px solid var(--border-soft);
      }
      li:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
      li.hidden {
        opacity: 0.75;
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
        font-size: var(--fs-s);
      }
      .who {
        font-weight: 600;
      }
      .when {
        color: var(--text-2);
      }
      .tools {
        margin-left: auto;
        display: flex;
        gap: 2px;
      }
      /* Mit Maus: Melden/Löschen erst bei Hover bzw. Fokus über dem Kommentar (F-514); auf Touch immer sichtbar */
      @media (hover: hover) and (pointer: fine) {
        li .tools {
          opacity: 0;
          transition: opacity 0.12s;
        }
        li:hover .tools,
        li:focus-within .tools {
          opacity: 1;
        }
      }
      .body {
        margin: 0;
        white-space: pre-line;
        overflow-wrap: anywhere;
        line-height: 1.5;
      }
      a {
        color: var(--accent);
      }
      .who a {
        text-decoration: none;
      }
      .flag {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--warn-bg);
        font-size: var(--fs-xs);
        font-weight: 600;
      }
      .flag svg {
        width: 13px;
        height: 13px;
      }
      textarea {
        width: 100%;
        min-height: 84px;
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
      textarea[aria-invalid='true'] {
        border-color: var(--err);
      }
      form {
        display: grid;
        gap: var(--s-2);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      .count {
        font-size: var(--fs-s);
        color: var(--text-2);
        margin-right: auto;
      }
      .count.over {
        color: var(--err);
        font-weight: 600;
      }
      .note,
      .sub {
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
      .error {
        color: var(--err);
        font-size: var(--fs-s);
        margin: 0;
      }
      .confirm {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        flex-wrap: wrap;
        font-size: var(--fs-s);
      }
      .btn.small.icon svg {
        width: 15px;
        height: 15px;
      }
      /* Kopf: Kommentar-Modus (Beitrag) links, Glocke rechts (Konzept 40) */
      .bar {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .mode {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        margin-right: auto;
        min-width: 0;
        max-width: 100%;
        color: var(--text-2);
        font-size: var(--fs-s);
      }
      .mode svg {
        width: 15px;
        height: 15px;
        flex: none;
      }
      .mode select {
        min-width: 0;
        max-width: 100%;
        min-height: 36px;
        padding: 0 var(--s-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: inherit;
      }
      .bell {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
      }
      .bell svg {
        width: 16px;
        height: 16px;
      }
      .bell.on {
        color: var(--accent);
      }
      /* Tippziele ≥ 44 px (UX N11) */
      @media (pointer: coarse) {
        .btn.small {
          min-height: 44px;
        }
        .btn.small.icon {
          width: 44px;
        }
        .mode select {
          min-height: 44px;
        }
      }
    `,
  ];

  /** Formular schließt, während der Fokus darin steht (Abbrechen, abgesendet): danach zurück auf „Kommentieren“ */
  private restoreFocus = false;

  willUpdate(changed: PropertyValues<this>) {
    // anderer Verlauf: Formular zu
    if (changed.has('thread') && changed.get('thread')?.id !== this.thread?.id) this.writing = false;
    // vor dem Neuzeichnen prüfen – danach ist das fokussierte Element schon weg
    if (changed.get('writing') && !this.writing) this.restoreFocus = !!this.shadowRoot?.activeElement;
  }

  updated(changed: PropertyValues<this>) {
    if (this.autoload && this.thread && !this.data && (changed.has('thread') || changed.has('autoload'))) emit(this, 'sx-comments-load', { el: this });
    if (changed.has('writing') && this.writing) this.renderRoot.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    if (this.restoreFocus) {
      this.restoreFocus = false;
      this.renderRoot.querySelector<HTMLButtonElement>('button.start')?.focus();
    }
  }

  private cancel() {
    this.draft = '';
    this.writing = false;
  }

  private submit(e: Event) {
    e.preventDefault();
    const body = cleanComment(this.draft);
    if (!body || this.problem(body)) return;
    emit(this, 'sx-comment-post', { body, el: this });
  }

  private problem(body: string): string {
    const d = this.data;
    if (!d) return '';
    if (commentLength(body) > d.limits.maxLength) return `Höchstens ${d.limits.maxLength} Zeichen.`;
    if (countLinks(body) > d.limits.maxLinks) return `Höchstens ${d.limits.maxLinks} Links pro Kommentar.`;
    return '';
  }

  /** Text mit klickbaren http(s)-Links – Lit escaped alle Textstücke. */
  private body(text: string) {
    return linkify(text).map((p) =>
      p.href ? html`<a href=${p.href} rel="nofollow ugc noopener noreferrer" target="_blank">${p.text}</a>` : p.text,
    );
  }

  private item(c: CommentItem) {
    const name = c.author.handle ? html`<a href="/u/${c.author.handle}">${c.author.displayName}</a>` : c.author.displayName;
    return html`<li class=${c.hidden ? 'hidden' : ''} id="kommentar-${c.id}">
      <div class="head">
        <span class="who">${name}</span>
        <time class="when" datetime=${new Date(c.createdAt).toISOString()}>${fmtDateTime(c.createdAt)}</time>
        ${c.hidden ? html`<span class="flag">${icon('eyeOff')} ausgeblendet bis zur Prüfung</span>` : ''}
        <span class="tools">
          ${!c.isMine
            ? html`<button class="btn ghost small icon" type="button" title="Melden" aria-label="Kommentar von ${c.author.displayName} melden"
                @click=${() => emit(this, 'sx-report', { kind: 'comment', id: c.id, label: `Kommentar von ${c.author.displayName}`, ...(this.thread?.kind === 'post' ? { key: this.thread.key ?? null } : {}) })}>${icon('flag')}</button>`
            : ''}
          ${c.canDelete && this.confirm !== c.id
            ? html`<button class="btn ghost small icon danger" type="button" title="Löschen" aria-label="Kommentar von ${c.author.displayName} löschen"
                ?disabled=${this.busy} @click=${() => (this.confirm = c.id)}>${icon('trash')}</button>`
            : ''}
        </span>
      </div>
      <p class="body">${this.body(c.body)}</p>
      ${this.confirm === c.id
        ? html`<div class="confirm" role="alert">
            <span>Diesen Kommentar löschen?</span>
            <button class="btn small danger" type="button" @click=${() => {
              this.confirm = null;
              emit(this, 'sx-comment-delete', { id: c.id, el: this });
            }}>${icon('trash')} Ja, löschen</button>
            <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>
          </div>`
        : ''}
    </li>`;
  }

  /** „Kommentieren“ – der eine Einstieg; ohne Anmeldung öffnet er gleich die Anmeldung. */
  private startButton(d: CommentList) {
    return html`<div><button class="btn small start" type="button"
      @click=${() => (d.block === 'login' ? emit(this, 'sx-login') : (this.writing = true))}>${icon('comment')} Kommentieren</button></div>`;
  }

  private form(d: CommentList) {
    const open = this.writing || !!this.draft;
    switch (d.block) {
      case 'login':
        return this.startButton(d);
      case 'profile':
        if (!open) return this.startButton(d);
        return html`<div class="row">
          <p class="sub">Zum Kommentieren brauchst du ein Profil mit Anzeigenamen – deine E-Mail-Adresse bleibt verborgen.</p>
          <button class="btn small" type="button" @click=${() => emit(this, 'sx-account', 'profile')}>${icon('pencil')} Profil anlegen</button>
        </div>`;
      case 'suspended':
        return html`<p class="note">${icon('lock')}<span>Dein Konto ist gesperrt – du kannst nicht kommentieren.</span></p>`;
      case 'off':
        return d.mode === 'off' ? html`<p class="note">${icon('lock')}<span>Neue Kommentare sind für ${this.isPost() ? 'diesen Beitrag' : 'diesen Törn'} abgeschaltet.</span></p>` : '';
      default: {
        if (!open) return this.startButton(d);
        const body = cleanComment(this.draft);
        const len = commentLength(body);
        const problem = this.problem(body);
        return html`<form @submit=${this.submit}>
          <label class="sr-only" for="c-text">Dein Kommentar</label>
          <textarea id="c-text" placeholder="Was sagst du zu ${this.isPost() ? 'diesem Beitrag' : 'diesem Törn'}?" .value=${this.draft} aria-describedby="c-count c-rules"
            aria-invalid=${problem ? 'true' : 'false'} @input=${(e: Event) => (this.draft = (e.target as HTMLTextAreaElement).value)}></textarea>
          <div class="row">
            <span id="c-count" class="count ${len > d.limits.maxLength ? 'over' : ''}" aria-live="polite">${problem || `${len} / ${d.limits.maxLength}`}</span>
            <button class="btn small ghost" type="button" @click=${this.cancel}>Abbrechen</button>
            <button class="btn small primary" type="submit" ?disabled=${this.busy || !body || !!problem}>${icon('comment')} Kommentieren</button>
          </div>
          <p id="c-rules" class="sub">Reiner Text, höchstens ${d.limits.maxLinks} Links. Sichtbar für alle, die ${this.isPost() ? 'den Beitrag' : 'den Törn'} sehen.</p>
        </form>`;
      }
    }
  }

  private isPost() {
    return this.thread?.kind === 'post';
  }

  /**
   * Kopf: Glocke des Verlaufs (F-639) für Angemeldete, die die Kommentare sehen – an: „Benachrichtigen an“, stumm:
   * durchgestrichen; beim Beitrag für die Autor:in die Auswahl des Kommentar-Modus (F-636).
   */
  private bar(d: CommentList) {
    const hasBell = typeof d.subscribed === 'boolean';
    if (!hasBell && !d.canSetMode) return '';
    const on = !!d.subscribed;
    const label = on ? 'Benachrichtigungen zu neuen Kommentaren an – stumm schalten' : 'Bei neuen Kommentaren benachrichtigen';
    return html`<div class="bar">
      ${d.canSetMode
        ? html`<label class="mode">${icon('comment')}
            <select aria-label="Kommentare zu diesem Beitrag" ?disabled=${this.busy}
              @change=${(e: Event) => emit(this, 'sx-comments-mode', { mode: (e.target as HTMLSelectElement).value as CommentsMode, el: this })}>
              ${COMMENTS_MODES.map((m) => html`<option value=${m} ?selected=${d.mode === m}>${COMMENTS_MODE_LABEL[m]}</option>`)}
            </select></label>`
        : ''}
      ${hasBell
        ? html`<button class="btn small ghost bell ${on ? 'on' : ''}" type="button" aria-pressed=${on ? 'true' : 'false'} title=${label} aria-label=${label}
            ?disabled=${this.busy} @click=${() => emit(this, 'sx-comment-subscribe', { on: !on, el: this })}>
            ${icon(on ? 'bell' : 'bell-off')}<span>${on ? 'Benachrichtigen an' : 'Stumm'}</span></button>`
        : ''}
    </div>`;
  }

  render() {
    const d = this.data;
    if (!d) return this.error ? html`<p class="error" role="alert">${this.error}</p>` : html`<p class="sub">Lade Kommentare …</p>`;
    const hiddenForOthers = d.mode === 'hidden';
    return html`
      ${this.bar(d)}
      ${hiddenForOthers && d.isOwner ? html`<p class="note">${icon('eyeOff')}<span>Kommentare sind für andere ausgeblendet – nur du siehst sie.</span></p>` : ''}
      ${hiddenForOthers && !d.isOwner && !d.comments.length
        ? html`<p class="sub">Die Kommentare zu ${this.isPost() ? 'diesem Beitrag' : 'diesem Törn'} sind ausgeblendet.</p>`
        : d.comments.length
          ? html`<ol aria-label="Kommentare">${d.comments.map((c) => this.item(c))}</ol>`
          : html`<p class="sub">Noch keine Kommentare.</p>`}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      ${this.form(d)}
    `;
  }
}
customElements.define('sx-comments', SxComments);
