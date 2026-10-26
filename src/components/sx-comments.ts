import { LitElement, html, css } from 'lit';
import type { CommentItem, CommentList } from '../services/api';
import { COMMENTS_MODES, COMMENTS_MODE_LABEL, cleanComment, commentLength, countLinks, linkify, type CommentsMode } from '../domain/comment-text';
import { fmtDateTime } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/**
 * Kommentare eines geteilten Törns (Konzept 4.3) – reine Darstellung, Aktionen gehen als Events raus:
 * `sx-comment-post` { body }, `sx-comment-delete` { id }, `sx-comments-mode` { mode }, `sx-report` { kind, id, label },
 * `sx-login`, `sx-account` ('profile'). Text wird nie als HTML ausgewertet; Links entstehen aus dem geparsten Text
 * und tragen rel="nofollow ugc noopener noreferrer".
 */
export class SxComments extends LitElement {
  static properties = {
    data: { attribute: false },
    shareId: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    draft: { type: String },
    confirm: { state: true },
  };
  declare data: CommentList | null;
  /** Törn, zu dem die Kommentare gehören (für „Törn melden“) */
  declare shareId: string;
  declare busy: boolean;
  declare error: string;
  /** Text im Formular – der Controller leert ihn nach dem Absenden */
  declare draft: string;
  /** Löschen eines Kommentars wartet auf Bestätigung */
  declare confirm: string | null;

  constructor() {
    super();
    this.data = null;
    this.shareId = '';
    this.busy = false;
    this.error = '';
    this.draft = '';
    this.confirm = null;
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
      select {
        width: auto;
        min-height: var(--control-h-s);
        font-size: var(--fs-s);
      }
      .mode {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .btn.small.icon svg {
        width: 15px;
        height: 15px;
      }
      @media (pointer: coarse) {
        .btn.small {
          min-height: 40px;
        }
        .btn.small.icon {
          width: 40px;
        }
      }
    `,
  ];

  private submit(e: Event) {
    e.preventDefault();
    const body = cleanComment(this.draft);
    if (!body || this.problem(body)) return;
    emit(this, 'sx-comment-post', { body });
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
                @click=${() => emit(this, 'sx-report', { kind: 'comment', id: c.id, label: `Kommentar von ${c.author.displayName}` })}>${icon('flag')}</button>`
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
              emit(this, 'sx-comment-delete', { id: c.id });
            }}>${icon('trash')} Ja, löschen</button>
            <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>
          </div>`
        : ''}
    </li>`;
  }

  private form(d: CommentList) {
    switch (d.block) {
      case 'login':
        return html`<div class="row">
          <p class="sub">Zum Kommentieren meldest du dich an.</p>
          <button class="btn small" type="button" @click=${() => emit(this, 'sx-login')}>${icon('user')} Anmelden</button>
        </div>`;
      case 'profile':
        return html`<div class="row">
          <p class="sub">Zum Kommentieren brauchst du ein Profil mit Anzeigenamen – deine E-Mail-Adresse bleibt verborgen.</p>
          <button class="btn small" type="button" @click=${() => emit(this, 'sx-account', 'profile')}>${icon('pencil')} Profil anlegen</button>
        </div>`;
      case 'suspended':
        return html`<p class="note">${icon('lock')}<span>Dein Konto ist gesperrt – du kannst nicht kommentieren.</span></p>`;
      case 'off':
        return d.mode === 'off' ? html`<p class="note">${icon('lock')}<span>Neue Kommentare sind für diesen Törn abgeschaltet.</span></p>` : '';
      default: {
        const body = cleanComment(this.draft);
        const len = commentLength(body);
        const problem = this.problem(body);
        return html`<form @submit=${this.submit}>
          <label class="sr-only" for="c-text">Dein Kommentar</label>
          <textarea id="c-text" placeholder="Was sagst du zu diesem Törn?" .value=${this.draft} aria-describedby="c-count c-rules"
            aria-invalid=${problem ? 'true' : 'false'} @input=${(e: Event) => (this.draft = (e.target as HTMLTextAreaElement).value)}></textarea>
          <div class="row">
            <span id="c-count" class="count ${len > d.limits.maxLength ? 'over' : ''}" aria-live="polite">${problem || `${len} / ${d.limits.maxLength}`}</span>
            <button class="btn small primary" type="submit" ?disabled=${this.busy || !body || !!problem}>${icon('comment')} Kommentieren</button>
          </div>
          <p id="c-rules" class="sub">Reiner Text, höchstens ${d.limits.maxLinks} Links. Sichtbar für alle, die den Törn sehen.</p>
        </form>`;
      }
    }
  }

  private modeSelect(d: CommentList) {
    return html`<label class="mode">${icon('comment')}
      <span>Für diesen Törn:</span>
      <select aria-label="Kommentare für diesen Törn" ?disabled=${this.busy}
        @change=${(e: Event) => emit(this, 'sx-comments-mode', { mode: (e.target as HTMLSelectElement).value as CommentsMode })}>
        ${COMMENTS_MODES.map((m) => html`<option value=${m} ?selected=${d.mode === m}>${COMMENTS_MODE_LABEL[m]}</option>`)}
      </select>
    </label>`;
  }

  render() {
    const d = this.data;
    if (!d) return html`<p class="sub">Lade Kommentare …</p>`;
    const hiddenForOthers = d.mode === 'hidden';
    return html`
      ${d.isOwner ? this.modeSelect(d) : ''}
      ${hiddenForOthers && d.isOwner ? html`<p class="note">${icon('eyeOff')}<span>Kommentare sind für andere ausgeblendet – nur du siehst sie.</span></p>` : ''}
      ${hiddenForOthers && !d.isOwner && !d.comments.length
        ? html`<p class="sub">Die Kommentare zu diesem Törn sind ausgeblendet.</p>`
        : d.comments.length
          ? html`<ol aria-label="Kommentare">${d.comments.map((c) => this.item(c))}</ol>`
          : html`<p class="sub">Noch keine Kommentare.</p>`}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      ${this.form(d)}
      ${!d.isOwner && this.shareId
        ? html`<div><button class="btn ghost small" type="button" @click=${() => emit(this, 'sx-report', { kind: 'share', id: this.shareId, label: 'diesen Törn' })}>${icon('flag')} Törn melden</button></div>`
        : ''}
    `;
  }
}
customElements.define('sx-comments', SxComments);
