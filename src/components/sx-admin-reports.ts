import { LitElement, html, css } from 'lit';
import type { AdminAction, AdminReport } from '../services/api';
import { REPORT_REASON_LABEL, type ReportKind, type ReportReason } from '../domain/comment-text';
import { fmtDate, plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

const KIND: Record<ReportKind, string> = { share: 'Törn', comment: 'Kommentar', profile: 'Profil', boat: 'Boot' };

/**
 * Offene Meldungen für Admins (Konzept 4.4), je Ziel zusammengefasst. Reine Darstellung – Events:
 * `sx-admin-decide` { id, action }, `sx-admin-suspend` { userId, suspended }, `sx-admin-refresh`.
 */
export class SxAdminReports extends LitElement {
  static properties = {
    reports: { attribute: false },
    busy: { type: Boolean },
    confirm: { state: true },
  };
  /** null = lädt */
  declare reports: AdminReport[] | null;
  declare busy: boolean;
  /** "delete:<id>" oder "suspend:<userId>" wartet auf Bestätigung */
  declare confirm: string | null;

  constructor() {
    super();
    this.reports = null;
    this.busy = false;
    this.confirm = null;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
      }
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
        padding: var(--s-3);
        display: grid;
        gap: var(--s-2);
      }
      .top {
        display: flex;
        gap: var(--s-2);
        align-items: baseline;
        flex-wrap: wrap;
      }
      .kind {
        font-size: var(--fs-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-3);
      }
      .title {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .text {
        margin: 0;
        white-space: pre-line;
        overflow-wrap: anywhere;
        max-height: 8em;
        overflow: auto;
        font-size: var(--fs-s);
        background: var(--surface-2);
        border-radius: var(--radius);
        padding: var(--s-2);
      }
      .chips {
        display: flex;
        gap: var(--s-1);
        flex-wrap: wrap;
        font-size: var(--fs-s);
      }
      .chip {
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--surface-2);
        border: 1px solid var(--border-soft);
      }
      .chip.warn {
        background: var(--warn-bg);
        border-color: transparent;
      }
      .sub {
        font-size: var(--fs-s);
        color: var(--text-2);
        margin: 0;
      }
      .notes {
        margin: 0;
        padding-left: var(--s-4);
        font-size: var(--fs-s);
      }
      .actions {
        display: flex;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      a {
        color: var(--accent);
      }
    `,
  ];

  private decide(id: string, action: AdminAction) {
    this.confirm = null;
    emit(this, 'sx-admin-decide', { id, action });
  }

  private item(r: AdminReport) {
    const t = r.target;
    const reasons = Object.entries(r.reasons) as Array<[ReportReason, number]>;
    const owner = t?.owner;
    return html`<li>
      <div class="top">
        <span class="kind">${KIND[r.kind]}</span>
        <span class="title">${t ? t.title : 'Gibt es nicht mehr'}</span>
        ${t?.path ? html`<a href=${t.path} target="_blank" rel="noopener noreferrer">${icon('open')} Ansehen</a>` : ''}
      </div>
      ${t?.text ? html`<p class="text">${t.text}</p>` : ''}
      <div class="chips">
        <span class="chip">${plural(r.count, 'Meldung', 'Meldungen')} von ${plural(r.reporters, 'Konto', 'Konten')}</span>
        ${reasons.map(([k, n]) => html`<span class="chip ${k === 'depicted' || k === 'illegal' ? 'warn' : ''}">${REPORT_REASON_LABEL[k] ?? k}${n > 1 ? ` ×${n}` : ''}</span>`)}
        ${t?.hiddenAt ? html`<span class="chip warn">ausgeblendet seit ${fmtDate(t.hiddenAt)}</span>` : ''}
      </div>
      ${r.notes.length ? html`<ul class="notes" aria-label="Anmerkungen">${r.notes.map((n) => html`<li>${n.note}</li>`)}</ul>` : ''}
      <p class="sub">Erste Meldung ${fmtDate(r.firstAt)}${owner ? html` · Eigentümer: ${owner.displayName}${owner.suspended ? ' (gesperrt)' : ''}` : ''}</p>
      <div class="actions">
        ${this.confirm === `delete:${r.id}`
          ? html`<button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => this.decide(r.id, 'delete')}>${icon('trash')} Endgültig löschen</button>
              <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>`
          : html`<button class="btn small" type="button" ?disabled=${this.busy} @click=${() => this.decide(r.id, 'keep')}>${icon('check')} Behalten${t?.hiddenAt ? ' & einblenden' : ''}</button>
              <button class="btn small" type="button" ?disabled=${this.busy || !t} @click=${() => this.decide(r.id, 'hide')}>${icon('eyeOff')} Ausblenden</button>
              <button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => (this.confirm = `delete:${r.id}`)}>${icon('trash')} Löschen</button>`}
        ${owner
          ? this.confirm === `suspend:${owner.id}:${r.id}`
            ? html`<button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => {
                this.confirm = null;
                emit(this, 'sx-admin-suspend', { userId: owner.id, suspended: !owner.suspended });
              }}>${owner.suspended ? 'Ja, entsperren' : 'Ja, Konto sperren'}</button>
                <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>`
            : html`<button class="btn small ghost danger" type="button" ?disabled=${this.busy} @click=${() => (this.confirm = `suspend:${owner.id}:${r.id}`)}>${icon('lock')} ${owner.suspended ? 'Entsperren' : 'Konto sperren'}</button>`
          : ''}
      </div>
    </li>`;
  }

  render() {
    const list = this.reports;
    return html`
      <div class="actions">
        <p class="sub" style="flex:1">Meldungen sehen nur Admins. Entscheidungen gelten für alle offenen Meldungen zum selben Inhalt; Meldende werden danach nicht gespeichert.</p>
        <button class="btn small ghost" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-admin-refresh')}>Aktualisieren</button>
      </div>
      ${list === null
        ? html`<p class="sub">Lade Meldungen …</p>`
        : list.length
          ? html`<ul aria-label="Offene Meldungen">${list.map((r) => this.item(r))}</ul>`
          : html`<p class="sub">Keine offenen Meldungen.</p>`}
    `;
  }
}
customElements.define('sx-admin-reports', SxAdminReports);
