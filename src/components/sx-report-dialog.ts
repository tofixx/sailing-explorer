import { LitElement, html, css, type PropertyValues } from 'lit';
import { REPORT_KIND_LABEL, REPORT_NOTE_MAX, REPORT_REASONS, REPORT_REASON_LABEL, type ReportKind, type ReportReason } from '../domain/comment-text';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

export interface ReportTarget {
  kind: ReportKind;
  /** bei Profilen der Profilname, sonst die ID */
  id: string;
  /** für die Überschrift, z. B. „diesen Törn“ oder „Kommentar von Anna“ */
  label: string;
}

const KIND_LABEL: Record<ReportKind, string> = REPORT_KIND_LABEL;

/**
 * Melden (DSA, Konzept 4.4): Grund wählen, optional Anmerkung, absenden. Ohne Anmeldung Hinweis auf Anmelden und
 * auf die Kontaktadresse (Meldungen ohne Konto). Reine Darstellung – Events: `sx-report-submit` { reason, note },
 * `sx-report-login`, `sx-report-close`.
 */
export class SxReportDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    target: { attribute: false },
    signedIn: { type: Boolean },
    contact: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    done: { type: Boolean },
    reason: { state: true },
  };
  declare open: boolean;
  declare target: ReportTarget | null;
  declare signedIn: boolean;
  /** Kontaktadresse für Meldungen ohne Konto (leer = nicht eingerichtet) */
  declare contact: string;
  declare busy: boolean;
  declare error: string;
  /** Meldung angekommen */
  declare done: boolean;
  declare reason: ReportReason | null;

  constructor() {
    super();
    this.open = false;
    this.target = null;
    this.signedIn = false;
    this.contact = '';
    this.busy = false;
    this.error = '';
    this.done = false;
    this.reason = null;
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
        gap: var(--s-1);
      }
      legend {
        padding: 0;
        margin-bottom: var(--s-2);
        font-weight: 600;
      }
      .opt {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        min-height: 40px;
        padding: 0 var(--s-2);
        border-radius: var(--radius);
        cursor: pointer;
      }
      .opt:hover {
        background: var(--surface-hover);
      }
      .opt input {
        accent-color: var(--accent);
        width: 18px;
        height: 18px;
        flex: none;
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
      form {
        display: grid;
        gap: var(--s-3);
      }
      a {
        color: var(--accent);
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) {
        this.reason = null;
        dlg.showModal();
      } else if (!this.open && dlg.open) dlg.close();
    }
  }

  private close = () => emit(this, 'sx-report-close');

  private submit(e: Event) {
    e.preventDefault();
    if (!this.reason) return;
    const note = String(new FormData(e.target as HTMLFormElement).get('note') || '').trim();
    emit(this, 'sx-report-submit', { reason: this.reason, note });
  }

  private contactNote() {
    if (!this.contact) return '';
    return html`<p class="hint">Ohne Konto erreichst du uns unter <a href="mailto:${this.contact}">${this.contact}</a>.</p>`;
  }

  private content() {
    if (this.done) {
      return html`<div class="note" role="status">${icon('check')}<span>Danke für deine Meldung. Wir sehen sie uns an.
          ${this.reason === 'depicted' ? 'Bis zur Prüfung ist der Inhalt ausgeblendet.' : ''}</span></div>
        <div class="actions"><button class="btn primary" type="button" @click=${this.close}>Schließen</button></div>`;
    }
    if (!this.signedIn) {
      return html`<p>Zum Melden meldest du dich mit deiner E-Mail-Adresse an – so lassen sich Missbrauch und Mehrfachmeldungen erkennen.</p>
        ${this.contactNote()}
        <div class="actions">
          <button class="btn" type="button" @click=${this.close}>Abbrechen</button>
          <button class="btn primary" type="button" @click=${() => emit(this, 'sx-report-login')}>${icon('user')} Anmelden</button>
        </div>`;
    }
    return html`<form @submit=${this.submit}>
      <fieldset>
        <legend>Was stimmt damit nicht?</legend>
        ${REPORT_REASONS.map(
          (r) => html`<label class="opt">
            <input type="radio" name="reason" value=${r} .checked=${this.reason === r} @change=${() => (this.reason = r)} />
            <span>${REPORT_REASON_LABEL[r]}</span>
          </label>`,
        )}
      </fieldset>
      <div>
        <label class="label" for="r-note">Anmerkung <span class="faint">(optional, höchstens ${REPORT_NOTE_MAX} Zeichen)</span></label>
        <textarea id="r-note" name="note" maxlength=${REPORT_NOTE_MAX} placeholder="Was sollen wir wissen?"></textarea>
      </div>
      <p class="hint">Deine Meldung sieht nur die Moderation, nicht die gemeldete Person.</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      <div class="actions">
        <button class="btn" type="button" @click=${this.close}>Abbrechen</button>
        <button class="btn primary" type="submit" ?disabled=${this.busy || !this.reason}>${icon('flag')} Melden</button>
      </div>
    </form>`;
  }

  render() {
    const t = this.target;
    return html`<dialog aria-labelledby="rh" @close=${this.close}>
      <header>
        <h2 id="rh">${t ? `${KIND_LABEL[t.kind]} melden` : 'Melden'}</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <div class="body">
        ${t ? html`<p class="muted">Du meldest ${t.label}.</p>` : ''}
        ${this.content()}
      </div>
    </dialog>`;
  }
}
customElements.define('sx-report-dialog', SxReportDialog);
