import { LitElement, html, css } from 'lit';
import type { AdminAction, AdminReport } from '../services/api';
import { COVER_REPORT_KINDS, IMAGE_REASONS, REPORT_KIND_LABEL, REPORT_REASON_LABEL, type ReportKind, type ReportReason } from '../domain/comment-text';
import { fmtDate, plural } from '../util/html';
import { noticeReasons, reportLockTarget, suggestLock } from '../domain/report-decisions';
import { icon } from './icons';
import { base, emit } from './shared';

const KIND: Record<ReportKind, string> = REPORT_KIND_LABEL;

/**
 * Offene Meldungen für Admins (Konzept 4.4), je Ziel zusammengefasst. Reine Darstellung – Events:
 * `sx-admin-decide` { id, action }, `sx-admin-suspend` { userId, suspended }, `sx-admin-lock` { kind, id, reason },
 * `sx-admin-refresh`. „Löschen“ fragt nach und schlägt dabei „Sperren“ vor (F-574): Strafbares sperren statt löschen,
 * Missbrauchsdarstellungen nicht kopieren oder weiterleiten.
 */
export class SxAdminReports extends LitElement {
  static properties = {
    reports: { attribute: false },
    busy: { type: Boolean },
    confirm: { state: true },
    lockReason: { state: true },
  };
  /** null = lädt */
  declare reports: AdminReport[] | null;
  declare busy: boolean;
  /** "delete:<id>", "cover:<id>" oder "suspend:<userId>" wartet auf Bestätigung */
  declare confirm: string | null;
  /** Begründung der Sperre im Lösch-Dialog (geht an die Betroffenen, F-296) */
  declare lockReason: string;

  constructor() {
    super();
    this.reports = null;
    this.busy = false;
    this.confirm = null;
    this.lockReason = '';
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
      .thumb {
        max-width: 200px;
        max-height: 150px;
        border-radius: var(--radius-s);
        object-fit: cover;
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
      .evidence {
        display: grid;
        gap: var(--s-2);
        border-radius: var(--radius);
        padding: var(--s-2) var(--s-3);
        background: var(--surface-2);
        font-size: var(--fs-s);
      }
      .evidence.warn {
        background: var(--warn-bg);
      }
      .evidence p {
        margin: 0;
      }
      .evidence label {
        display: grid;
        gap: var(--s-1);
      }
      .evidence input {
        width: 100%;
        min-width: 0;
        min-height: 44px;
      }
    `,
  ];

  private decide(id: string, action: AdminAction) {
    this.confirm = null;
    emit(this, 'sx-admin-decide', { id, action });
  }

  /** Löschen öffnen: Begründung der Sperre aus den Gründen der Meldungen vorbelegen. */
  private askDelete(r: AdminReport) {
    this.confirm = `delete:${r.id}`;
    this.lockReason = `Gemeldet: ${noticeReasons(r.reasons).join('; ')}`;
  }

  /** Hinweis und Entscheidung „Sperren statt Löschen“ (F-574). */
  private deletePanel(r: AdminReport) {
    const lock = reportLockTarget(r.kind, r.targetId, r.target?.owner.id);
    const warn = suggestLock(r.reasons);
    const reason = this.lockReason.trim();
    return html`<div class="evidence ${warn ? 'warn' : ''}" role="note">
      <p><b>Strafbares sperren statt löschen.</b> Die Sperre sichert den Beleg (nur für Admins sichtbar, 180 Tage) und schickt
        der Eigentümer:in die Begründung; Löschen hebt ihn sofort und endgültig auf.${lock?.account
          ? r.kind === 'profile'
            ? ' Ein Profil lässt sich nur mit dem Konto sperren.'
            : ' Dieser Inhalt lässt sich nur mit dem Konto der Autor:in sperren. Er bleibt dann erhalten, solange Törn bzw. Gruppe bestehen – deren Eigner:in oder der Ablauf des Törns können ihn trotzdem entfernen.'
          : ''}</p>
      <p><b>Missbrauchsdarstellungen von Kindern:</b> nicht weiter ansehen, nicht herunterladen, kopieren oder weiterleiten – auch
        nicht als Beleg. Sperren und nur den Fundort (Link, ID) an die Polizei oder internet-beschwerdestelle.de melden.</p>
      ${lock
        ? html`<label>Begründung der Sperre (geht per Mail an die Betroffenen)
            <input type="text" maxlength="500" .value=${this.lockReason} @input=${(e: Event) => (this.lockReason = (e.target as HTMLInputElement).value)} />
          </label>`
        : ''}
      <div class="actions">
        ${lock
          ? html`<button class="btn small primary" type="button" ?disabled=${this.busy || !reason} @click=${() => {
              this.confirm = null;
              emit(this, 'sx-admin-lock', { kind: lock.kind, id: lock.id, reason });
            }}>${icon('lock')} ${lock.account ? 'Konto sperren' : 'Sperren'}</button>`
          : ''}
        <button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => this.decide(r.id, 'delete')}>${icon('trash')} Endgültig löschen</button>
        <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>
      </div>
    </div>`;
  }

  private item(r: AdminReport) {
    const t = r.target;
    const reasons = Object.entries(r.reasons) as Array<[ReportReason, number]>;
    const owner = t?.owner;
    // Titelbild von Profil, Boot, Gruppe: einzeln entfernbar (F-564)
    const cover = !!t?.imagePath && COVER_REPORT_KINDS.includes(r.kind);
    return html`<li>
      <div class="top">
        <span class="kind">${KIND[r.kind]}</span>
        <span class="title">${t ? t.title : 'Gibt es nicht mehr'}</span>
        ${t?.path ? html`<a href=${t.path} target="_blank" rel="noopener noreferrer">${icon('open')} Ansehen</a>` : ''}
      </div>
      ${t?.imagePath ? html`<img class="thumb" src=${t.imagePath} alt=${cover ? 'Titelbild' : 'Gemeldetes Foto'} loading="lazy" />` : ''}
      ${t?.text ? html`<p class="text">${t.text}</p>` : ''}
      <div class="chips">
        <span class="chip">${plural(r.count, 'Meldung', 'Meldungen')} von ${plural(r.reporters, 'Konto', 'Konten')}</span>
        ${reasons.map(([k, n]) => html`<span class="chip ${IMAGE_REASONS.includes(k) || k === 'illegal' ? 'warn' : ''}">${REPORT_REASON_LABEL[k] ?? k}${n > 1 ? ` ×${n}` : ''}</span>`)}
        ${t?.hiddenAt ? html`<span class="chip warn">ausgeblendet seit ${fmtDate(t.hiddenAt)}</span>` : ''}
        ${t?.coverHeld ? html`<span class="chip warn">Titelbild zurückgehalten</span>` : ''}
        ${r.newReporters ? html`<span class="chip">${r.newReporters === 1 ? 'Meldende:r ist neues Konto' : `${r.newReporters} Meldende sind neue Konten`}</span>` : ''}
      </div>
      ${r.notes.length ? html`<ul class="notes" aria-label="Anmerkungen">${r.notes.map((n) => html`<li>${n.note}</li>`)}</ul>` : ''}
      <p class="sub">Erste Meldung ${fmtDate(r.firstAt)}${owner ? html` · Eigentümer: ${owner.displayName}${owner.suspended ? ' (suspendiert)' : ''}` : ''}</p>
      ${this.confirm === `delete:${r.id}` ? this.deletePanel(r) : this.actions(r, cover)}
    </li>`;
  }

  /** Entscheidungen; „Nur Titelbild entfernen“ (F-564) fragt wie „Löschen“ nach. */
  private actions(r: AdminReport, cover: boolean) {
    const t = r.target;
    const owner = t?.owner;
    return html`<div class="actions">
        ${this.confirm === `cover:${r.id}`
          ? html`<button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => this.decide(r.id, 'cover')}>${icon('trash')} Ja, Titelbild löschen</button>
              <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>`
          : html`<button class="btn small" type="button" ?disabled=${this.busy} @click=${() => this.decide(r.id, 'keep')}>${icon('check')} Behalten${t?.hiddenAt ? ' & einblenden' : ''}</button>
              <button class="btn small" type="button" ?disabled=${this.busy || !t} @click=${() => this.decide(r.id, 'hide')}>${icon('eyeOff')} Ausblenden</button>
              ${cover ? html`<button class="btn small" type="button" ?disabled=${this.busy} @click=${() => (this.confirm = `cover:${r.id}`)}>${icon('image')} Nur Titelbild entfernen</button>` : ''}
              <button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => this.askDelete(r)}>${icon('trash')} Löschen</button>`}
        ${owner
          ? this.confirm === `suspend:${owner.id}:${r.id}`
            ? html`<button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => {
                this.confirm = null;
                emit(this, 'sx-admin-suspend', { userId: owner.id, suspended: !owner.suspended });
              }}>${owner.suspended ? 'Ja, Suspendierung aufheben' : 'Ja, suspendieren'}</button>
                <button class="btn small" type="button" @click=${() => (this.confirm = null)}>Abbrechen</button>`
            : html`<button class="btn small ghost danger" type="button" ?disabled=${this.busy} @click=${() => (this.confirm = `suspend:${owner.id}:${r.id}`)}>${icon('lock')} ${owner.suspended ? 'Suspendierung aufheben' : 'Konto suspendieren'}</button>`
          : ''}
      </div>`;
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
