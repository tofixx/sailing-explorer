import { LitElement, html, css, type PropertyValues } from 'lit';
import type { Boat, ShareMeta, SupportLinks, SupportStatus } from '../services/api';
import { needsSupport, quotaText } from '../domain/support';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import './sx-support';

export interface ShareResult {
  share: ShareMeta;
  url: string;
}

/** Teilen: Titel/Sichtbarkeit wählen, hochladen, Link kopieren. */
export class SxShareDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    defaultTitle: { type: String },
    summary: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    result: { attribute: false },
    boats: { attribute: false },
    support: { attribute: false },
    supportStatus: { attribute: false },
    checking: { type: Boolean },
    copied: { state: true },
  };
  declare open: boolean;
  declare defaultTitle: string;
  declare summary: string;
  declare busy: boolean;
  declare error: string;
  declare result: ShareResult | null;
  declare boats: Boat[];
  /** personalisierte Payment-Links; null = Unterstützen nicht eingerichtet */
  declare support: SupportLinks | null;
  /** Kontingent des Kontos; null = (noch) unbekannt */
  declare supportStatus: SupportStatus | null;
  /** Unterstützer-Status wird gerade neu geladen */
  declare checking: boolean;
  declare copied: boolean;

  constructor() {
    super();
    this.open = false;
    this.defaultTitle = '';
    this.summary = '';
    this.busy = false;
    this.error = '';
    this.result = null;
    this.boats = [];
    this.support = null;
    this.supportStatus = null;
    this.checking = false;
    this.copied = false;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      legend {
        padding: 0;
      }
      .opt {
        display: flex;
        gap: var(--s-3);
        align-items: flex-start;
        padding: var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        cursor: pointer;
      }
      .opt:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .opt input {
        margin-top: 3px;
        accent-color: var(--accent);
      }
      .opt b {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .opt b svg {
        width: 15px;
        height: 15px;
      }
      .opt small {
        display: block;
        color: var(--text-2);
        font-size: var(--fs-s);
      }
      .check {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        font-size: var(--fs-m);
        cursor: pointer;
      }
      .check input {
        accent-color: var(--accent);
        width: 16px;
        height: 16px;
      }
      .linkrow {
        display: flex;
        gap: var(--s-2);
      }
      .linkrow input {
        font-family: var(--font-mono);
        font-size: var(--fs-s);
      }
      .quota {
        display: flex;
        align-items: center;
        gap: var(--s-1);
      }
      .quota svg {
        width: 14px;
        height: 14px;
      }
      .support {
        padding-top: var(--s-3);
        border-top: 1px solid var(--border-soft);
      }
      .done {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        color: var(--ok);
        font-weight: 600;
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) {
        this.copied = false;
        dlg.showModal();
      } else if (!this.open && dlg.open) dlg.close();
    }
  }

  private submit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const v = data.get('visibility');
    emit(this, 'sx-share-submit', {
      title: String(data.get('title') || ''),
      visibility: v === 'private' ? 'private' : 'unlisted',
      listed: v === 'public',
      boatId: String(data.get('boat') || '') || null,
      includeView: data.get('view') === 'on',
    });
  }

  private async copy() {
    if (!this.result) return;
    try {
      await navigator.clipboard.writeText(this.result.url);
      this.copied = true;
    } catch {
      this.renderRoot.querySelector<HTMLInputElement>('.linkrow input')?.select();
    }
  }

  private nativeShare() {
    if (!this.result) return;
    navigator.share?.({ title: this.result.share.title, text: this.result.share.summary, url: this.result.url }).catch(() => {});
  }

  render() {
    const r = this.result;
    return html`<dialog aria-labelledby="h" @close=${() => emit(this, 'sx-close', 'share')}>
      <header>
        <h2 id="h">${r ? 'Link zum Teilen' : 'Törn teilen'}</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${() => emit(this, 'sx-close', 'share')}>${icon('x')}</button>
      </header>
      ${r
        ? html`<div class="body">
            <p class="muted">
              ${r.share.visibility === 'private'
                ? 'Diese Freigabe ist privat – nur du siehst sie, wenn du angemeldet bist.'
                : 'Wer diesen Link hat, sieht den Törn interaktiv: Karte, Wind, Wellen, Diagramme.'}
            </p>
            <div class="linkrow">
              <input type="text" readonly .value=${r.url} aria-label="Freigabe-Link" @focus=${(e: Event) => (e.target as HTMLInputElement).select()} />
              <button class="btn primary" @click=${this.copy}>${icon(this.copied ? 'check' : 'copy')} ${this.copied ? 'Kopiert' : 'Kopieren'}</button>
            </div>
            <div class="actions">
              ${'share' in navigator ? html`<button class="btn" @click=${this.nativeShare}>${icon('share')} Teilen …</button>` : ''}
              <a class="btn" href=${r.url} target="_blank" rel="noopener">${icon('open')} Öffnen</a>
              ${r.share.isOwner ? html`<button class="btn" @click=${() => emit(this, 'sx-account')}>${icon('folder')} Konto &amp; Freigaben</button>` : ''}
            </div>
            ${this.support && !this.supportStatus?.supporter
              ? html`<sx-support class="support" variant="offer" .links=${this.support} .status=${this.supportStatus}></sx-support>`
              : ''}
          </div>`
        : needsSupport(this.supportStatus)
          ? html`<div class="body">
              <sx-support variant="required" .links=${this.support} .status=${this.supportStatus} ?checking=${this.checking}></sx-support>
              ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
              <div class="actions"><button type="button" class="btn" @click=${() => emit(this, 'sx-close', 'share')}>Schließen</button></div>
            </div>`
          : html`<form class="body" @submit=${this.submit}>
            <div>
              <label class="label" for="title">Titel</label>
              <input id="title" name="title" type="text" maxlength="120" .value=${this.defaultTitle} required />
              ${this.summary ? html`<div class="hint">${this.summary}</div>` : ''}
              ${quotaText(this.supportStatus) ? html`<div class="hint quota">${icon('info')} ${quotaText(this.supportStatus)}</div>` : ''}
            </div>
            <fieldset>
              <legend class="label">Wer darf es sehen?</legend>
              <label class="opt"><input type="radio" name="visibility" value="public" />
                <span><b>${icon('globe')} Öffentlich</b><small>Erscheint auf deinem Profil und der Bootsseite (wenn diese öffentlich sind).</small></span></label>
              <label class="opt"><input type="radio" name="visibility" value="unlisted" checked />
                <span><b>${icon('link')} Alle mit dem Link</b><small>Nicht auffindbar, aber jeder mit dem Link kann den Törn ansehen.</small></span></label>
              <label class="opt"><input type="radio" name="visibility" value="private" />
                <span><b>${icon('lock')} Nur ich</b><small>Gespeichert in deinem Konto, später freigebbar.</small></span></label>
            </fieldset>
            ${this.boats.length
              ? html`<div>
                  <label class="label" for="boat">Boot</label>
                  <select id="boat" name="boat">
                    <option value="">Kein Boot</option>
                    ${this.boats.map((b) => html`<option value=${b.id}>${b.name}</option>`)}
                  </select>
                </div>`
              : ''}
            <label class="check"><input type="checkbox" name="view" checked /> Aktuelle Ansicht mitgeben (Einfärbung &amp; Ebenen)</label>
            <div class="note warn">${icon('info')}<span>Die GPX-Dateien werden mit allen Positionen und Zeitstempeln gespeichert. Du kannst die Freigabe jederzeit unter „Konto &amp; Freigaben“ ändern oder löschen.</span></div>
            ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
            <div class="actions">
              <button type="button" class="btn" @click=${() => emit(this, 'sx-close', 'share')}>Abbrechen</button>
              <button type="submit" class="btn primary" ?disabled=${this.busy}>${icon('share')} ${this.busy ? 'Lade hoch …' : 'Link erstellen'}</button>
            </div>
          </form>`}
    </dialog>`;
  }
}
customElements.define('sx-share-dialog', SxShareDialog);
