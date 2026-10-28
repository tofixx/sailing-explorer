import { LitElement, css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { AdminClaim, ClaimDecision } from '../services/admin-api';
import { CLAIM_KIND_LABEL, CLAIM_LIMITS, PREVIOUS_ACTIONS, PREVIOUS_ACTION_LABEL, type ClaimStatus, type PreviousAction } from '../domain/claims';
import { fmtDate } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';
import './sx-verified-badge';

const STATUS_LABEL: Record<ClaimStatus, string> = {
  open: 'offen',
  accepted: 'angenommen',
  rejected: 'abgelehnt',
  expired: 'abgelaufen',
  withdrawn: 'zurückgezogen',
};

const DAY = 86_400_000;
const age = (since: number | null) => (since ? `Konto seit ${fmtDate(since)} (${Math.max(0, Math.floor((Date.now() - since) / DAY))} Tage)` : 'Konto gelöscht');

/**
 * Anträge „Ich vertrete …“ für Admins (Konzept 20.3, F-363). Reine Darstellung – Event `sx-admin-claim-decide`
 * { id, decision: ClaimDecision } (der AdminController führt aus und lädt neu).
 */
export class SxAdminClaims extends LitElement {
  static properties = {
    claims: { attribute: false },
    busy: { type: Boolean },
    loading: { type: Boolean },
  };
  declare claims: AdminClaim[];
  declare busy: boolean;
  declare loading: boolean;

  constructor() {
    super();
    this.claims = [];
    this.busy = false;
    this.loading = false;
  }

  static styles = [
    base,
    css`
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-3);
      }
      li {
        border: 1px solid var(--border-soft);
        border-radius: var(--radius);
        background: var(--surface);
        padding: var(--s-3);
        display: grid;
        gap: var(--s-2);
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 2px var(--s-3);
        margin: 0;
        font-size: var(--fs-s);
      }
      dt {
        color: var(--text-2);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
        white-space: pre-line;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
      textarea {
        width: 100%;
        min-height: 60px;
        padding: var(--s-2) var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: var(--fs-m) / 1.5 var(--font);
      }
      a {
        color: var(--accent);
      }
    `,
  ];

  private field(c: AdminClaim, name: string): string {
    return (this.renderRoot.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}-${c.id}"]`)?.value ?? '').trim();
  }

  private decide(c: AdminClaim, decision: 'accept' | 'reject') {
    const note = this.field(c, 'note');
    const d: ClaimDecision =
      decision === 'accept' ? { decision, note, previous: (this.field(c, 'previous') || 'admin') as PreviousAction } : { decision, note };
    emit(this, 'sx-admin-claim-decide', { id: c.id, decision: d });
  }

  private actions(c: AdminClaim) {
    if (c.status !== 'open') return nothing;
    // Wahl für die bisherige Eigner:in nur bei Vereinen mit anderem, noch bestehendem Eigner-Konto
    if (!c.applicant) return nothing;
    const choose = c.kind === 'group' && c.holder && c.holder.id !== c.applicant.id;
    return html`<label class="label" for="note-${c.id}">Begründung (Pflicht beim Ablehnen, ${CLAIM_LIMITS.noteMin}–${CLAIM_LIMITS.noteMax} Zeichen; geht an die Antragsteller:in)</label>
      <textarea id="note-${c.id}" name="note-${c.id}" maxlength=${CLAIM_LIMITS.noteMax}></textarea>
      <div class="row">
        ${choose
          ? html`<label class="label" for="previous-${c.id}">Bisheriger Eigner</label>
              <select id="previous-${c.id}" name="previous-${c.id}" style="width:auto">
                ${PREVIOUS_ACTIONS.map((a) => html`<option value=${a}>${PREVIOUS_ACTION_LABEL[a]}</option>`)}
              </select>`
          : c.kind === 'harbor' && c.holder && c.holder.id !== c.applicant.id
            ? html`<span class="hint">Die bisherige Anleger:in verliert das Bearbeitungsrecht.</span>`
            : nothing}
        <button class="btn primary" ?disabled=${this.busy} @click=${() => this.decide(c, 'accept')}>${icon('check')} Annehmen und übertragen</button>
        <button class="btn danger" ?disabled=${this.busy} @click=${() => this.decide(c, 'reject')}>Ablehnen</button>
      </div>
      <p class="hint">Vor dem Annehmen über einen unabhängigen öffentlichen Kanal prüfen (Impressum, Vereinsregister) – nicht über den angegebenen Kontakt.</p>`;
  }

  private item(c: AdminClaim) {
    const t = c.target;
    return html`<li>
      <div class="row">
        <strong>${CLAIM_KIND_LABEL[c.kind]}: ${t.path ? html`<a href=${t.path} target="_blank" rel="noopener">${t.name || '–'}</a>` : t.name || '–'}</strong>
        ${t.verified ? html`<sx-verified-badge kind=${c.kind}></sx-verified-badge>` : nothing}
        <span class="badge">${STATUS_LABEL[c.status]}</span>
        ${c.otherOpen ? html`<span class="badge">${c.otherOpen} weitere offen</span>` : nothing}
      </div>
      <dl>
        <dt>Antrag</dt><dd>${fmtDate(c.createdAt)}${c.decidedAt ? ` · entschieden ${fmtDate(c.decidedAt)}` : ''}</dd>
        <dt>Antragsteller:in</dt><dd>${c.applicant ? `${c.applicant.displayName}${c.applicant.handle ? ` (@${c.applicant.handle})` : ''} · ${c.applicant.id} · ${age(c.applicant.since)}` : 'Konto gelöscht'}</dd>
        <dt>${c.kind === 'harbor' ? 'Anleger:in heute' : 'Eigner heute'}</dt>
        <dd>${c.holder ? `${c.holder.displayName} · ${c.holder.id} · ${age(c.holder.since)}${c.holder.id === c.applicant?.id ? ' – dieselbe Person' : ''}` : 'niemand'}</dd>
        ${c.role ? html`<dt>Funktion</dt><dd>${c.role}</dd>` : nothing}
        ${c.reason ? html`<dt>Begründung</dt><dd>${c.reason}</dd>` : nothing}
        ${c.contact ? html`<dt>Kontakt</dt><dd>${c.contact}</dd>` : nothing}
        ${c.evidenceUrl ? html`<dt>Beleg</dt><dd><a href=${c.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow">${c.evidenceUrl}</a></dd>` : nothing}
        ${c.note ? html`<dt>Entscheidung</dt><dd>${c.note}</dd>` : nothing}
        ${c.previousAction && c.previousAction !== 'none' ? html`<dt>Bisheriger Eigner</dt><dd>${PREVIOUS_ACTION_LABEL[c.previousAction as PreviousAction] ?? c.previousAction}</dd>` : nothing}
      </dl>
      ${this.actions(c)}
    </li>`;
  }

  render() {
    if (!this.claims.length) return html`<p class="muted">${this.loading ? '' : 'Keine Anträge.'}</p>`;
    // je Antrag eigene Elemente (Schlüssel = ID): Eingaben wandern nach dem Neuladen nie in einen anderen Antrag
    return html`<ul>${repeat(this.claims, (c) => c.id, (c) => this.item(c))}</ul>`;
  }
}
customElements.define('sx-admin-claims', SxAdminClaims);
