import { LitElement, css, html, type PropertyValues } from 'lit';
import type { ClaimRequest, ClaimState } from '../services/api';
import { CLAIM_KIND_LABEL, CLAIM_LIMITS, type ClaimKind } from '../domain/claims';
import { fmtDate } from '../util/html';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

/**
 * „Ich vertrete diesen Verein/Hafen“ (Konzept 20.2, F-360, F-362): Knopf mit Dialog für den Antrag bzw. dessen Stand.
 * Reine Darstellung – Events (mit `el`, damit der Controller hier Stand, Fehler und `busy` setzt): `sx-claim-load`
 * { kind, id, el } beim Öffnen, `sx-claim-submit` { req, el }, `sx-claim-withdraw` { claimId, kind, id, el };
 * ohne Anmeldung `sx-login`.
 */
export class SxClaim extends LitElement {
  static properties = {
    kind: { type: String },
    targetId: { type: String, attribute: 'target-id' },
    name: { type: String },
    signedIn: { type: Boolean, attribute: 'signed-in' },
    state: { attribute: false },
    busy: { type: Boolean },
    error: { type: String },
    open: { state: true },
  };
  declare kind: ClaimKind;
  declare targetId: string;
  declare name: string;
  declare signedIn: boolean;
  /** null = noch nicht geladen */
  declare state: ClaimState | null;
  declare busy: boolean;
  declare error: string;
  declare open: boolean;

  constructor() {
    super();
    this.kind = 'group';
    this.targetId = '';
    this.name = '';
    this.signedIn = false;
    this.state = null;
    this.busy = false;
    this.error = '';
    this.open = false;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      :host {
        display: inline-flex;
      }
      form {
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
      textarea:focus {
        border-color: var(--accent);
        outline: none;
        box-shadow: var(--focus);
      }
    `,
  ];

  private get what() {
    return this.kind === 'group' ? 'diesen Verein' : 'diesen Hafen';
  }

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog');
    if (!dlg || !changed.has('open')) return;
    if (this.open && !dlg.open) dlg.showModal();
    else if (!this.open && dlg.open) dlg.close();
  }

  private show() {
    if (!this.signedIn) return emit(this, 'sx-login');
    Object.assign(this, { open: true, error: '' });
    emit(this, 'sx-claim-load', { kind: this.kind, id: this.targetId, el: this });
  }

  private close = () => {
    this.open = false;
  };

  private submit(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    const req: ClaimRequest = { kind: this.kind, id: this.targetId, role: get('role'), reason: get('reason'), contact: get('contact'), evidenceUrl: get('evidence') };
    emit(this, 'sx-claim-submit', { req, el: this });
  }

  private status(s: ClaimState) {
    const c = s.claim;
    if (s.representing) return html`<div class="note" role="status">${icon('check')}<span>Du vertrittst ${this.what} verifiziert.</span></div>`;
    if (s.blocked) {
      return html`<div class="note warn" role="status">${icon('info')}<span>Die Verwaltung wurde dir nach einer Prüfung entzogen. Bei Fragen wende dich an die Moderation (Kontakt im Impressum).</span></div>`;
    }
    if (c?.status === 'open') {
      return html`<div class="note" role="status">${icon('info')}<span>Dein Antrag ist seit ${fmtDate(c.createdAt)} in Prüfung. Die Moderation meldet sich – eventuell über die öffentlichen Kontaktdaten des ${CLAIM_KIND_LABEL[this.kind]}s.</span></div>
        <div class="actions"><button class="btn" ?disabled=${this.busy} @click=${() => emit(this, 'sx-claim-withdraw', { claimId: c.id, kind: this.kind, id: this.targetId, el: this })}>Antrag zurückziehen</button></div>`;
    }
    if (c?.status === 'rejected') {
      return html`<div class="note warn" role="status">${icon('info')}<span>Dein Antrag wurde am ${fmtDate(c.decidedAt ?? c.createdAt)} abgelehnt${c.note ? html`: ${c.note}` : '.'}</span></div>`;
    }
    return '';
  }

  private form() {
    const L = CLAIM_LIMITS;
    return html`<form @submit=${this.submit}>
      <p>Du bist Vorstand, Hafenmeister:in oder Betreiber:in? Dann kann die Moderation dir die Verwaltung von „${this.name}“ übertragen – mit dem Abzeichen „Verifiziert“.
        Wer ${this.what} heute verwaltet, erfährt davon erst, wenn dein Antrag angenommen wird.</p>
      <div><label class="label" for="c-role">Deine Funktion</label>
        <input type="text" id="c-role" name="role" required minlength=${L.roleMin} maxlength=${L.roleMax} placeholder=${this.kind === 'group' ? '1. Vorsitzende' : 'Hafenmeister'} /></div>
      <div><label class="label" for="c-reason">Begründung</label>
        <textarea id="c-reason" name="reason" required minlength=${L.reasonMin} maxlength=${L.reasonMax} placeholder="Warum du ${this.what} vertrittst – und was heute nicht stimmt"></textarea></div>
      <div><label class="label" for="c-contact">Kontakt für Rückfragen</label>
        <input type="text" id="c-contact" name="contact" required minlength=${L.contactMin} maxlength=${L.contactMax} placeholder="Telefon oder Mail-Adresse des ${CLAIM_KIND_LABEL[this.kind]}s" /></div>
      <div><label class="label" for="c-evidence">Beleg-Link <span class="faint">(optional)</span></label>
        <input type="text" inputmode="url" id="c-evidence" name="evidence" maxlength=${L.evidenceMax} placeholder="https://… Impressum, Vereinsregister" /></div>
      <p class="hint">Bitte keine Ausweis- oder Vollmachtskopien schicken. Die Moderation prüft über die öffentlichen Kontaktdaten (Impressum, Vereinsregister) und fragt dort nach.
        Deine Angaben sieht nur die Moderation; sie werden nach der Entscheidung gelöscht (Datenschutzerklärung).</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      <div class="actions">
        <button class="btn" type="button" @click=${this.close}>Abbrechen</button>
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} Antrag stellen</button>
      </div>
    </form>`;
  }

  render() {
    const s = this.state;
    return html`<button class="btn ghost" @click=${() => this.show()}>${icon('check')} Ich vertrete ${this.what}</button>
      <dialog aria-labelledby="ch" @close=${this.close}>
        <header>
          <h2 id="ch">${CLAIM_KIND_LABEL[this.kind]} vertreten</h2>
          <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
        </header>
        <div class="body">
          ${!s ? html`<p class="muted">${this.error || 'Lädt …'}</p>` : html`${this.status(s)}${s.canClaim ? this.form() : ''}`}
        </div>
      </dialog>`;
  }
}
customElements.define('sx-claim', SxClaim);
