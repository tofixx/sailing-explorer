import { LitElement, css, html, nothing } from 'lit';
import type { AdminDetail, AdminItem, AdminLogEntry, AdminOp, MergePreview } from '../services/admin-api';
import {
  ADMIN_FILTER_LABEL, ADMIN_KINDS, ADMIN_KIND_LABEL, FILTERS_FOR, LOCK_WARN_MS,
  type AdminFilter, type AdminKind,
} from '../domain/admin';
import { VISIBILITY_LABEL } from '../domain/visibility';
import { fmtDate, fmtDateTime } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

export type Tab = AdminKind | 'log';
/** offene Aktion in der Detailansicht */
type Form = 'lock' | 'rename' | 'owner' | 'merge' | 'delete' | 'support' | null;

/** Abfrage der Übersicht bzw. des Protokolls */
export interface AdminQuery {
  tab: Tab;
  q: string;
  filter: AdminFilter;
  page: number;
}

/**
 * Admin-Bereich (Konzept 18, F-230 ff.): Reiter je Objektart und Protokoll, Suche, Filter, Blättern, Details mit
 * Sperren, Umbenennen, Eigner, Zusammenführen und Löschen. Wird erst auf /admin nachgeladen. Reine Darstellung – Daten
 * setzt der AdminController (src/controllers/admin.ts); Events: `sx-admin-query` AdminQuery, `sx-admin-open`
 * { kind, id }, `sx-admin-act` { op, done }, `sx-admin-preview` { id, into }.
 */
export class SxAdminPage extends LitElement {
  static properties = {
    tab: { state: true },
    q: { state: true },
    filter: { state: true },
    page: { state: true },
    items: { state: true },
    log: { state: true },
    more: { state: true },
    loading: { state: true },
    error: { state: true },
    detail: { state: true },
    form: { state: true },
    busy: { state: true },
    note: { state: true },
    preview: { state: true },
  };
  declare tab: Tab;
  declare q: string;
  declare filter: AdminFilter;
  declare page: number;
  declare items: AdminItem[];
  declare log: AdminLogEntry[];
  declare more: boolean;
  declare loading: boolean;
  declare error: string;
  declare detail: AdminDetail | null;
  declare form: Form;
  declare busy: boolean;
  /** Rückmeldung der letzten Aktion */
  declare note: string;
  declare preview: MergePreview | null;

  constructor() {
    super();
    this.tab = 'users';
    this.q = '';
    this.filter = 'all';
    this.page = 1;
    this.items = [];
    this.log = [];
    this.more = false;
    this.loading = false;
    this.error = '';
    this.detail = null;
    this.form = null;
    this.busy = false;
    this.note = '';
    this.preview = null;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        overflow-y: auto;
        background: var(--bg);
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: var(--s-4);
        display: grid;
        gap: var(--s-3);
      }
      h1 {
        margin: 0;
        font-size: var(--fs-xl);
      }
      nav,
      .chips,
      .row-actions,
      .pager {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
      nav .btn[aria-current='page'] {
        background: var(--accent-soft);
        color: var(--accent);
        border-color: transparent;
      }
      .chip {
        border: 1px solid var(--border-soft);
        border-radius: 999px;
        padding: 2px var(--s-3);
        background: var(--surface);
        font: inherit;
        font-size: var(--fs-s);
        cursor: pointer;
        color: var(--text-2);
      }
      .chip[aria-pressed='true'] {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
      }
      form.search {
        display: flex;
        gap: var(--s-2);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--fs-s);
      }
      th,
      td {
        text-align: left;
        padding: var(--s-2);
        border-bottom: 1px solid var(--border-soft);
        vertical-align: top;
      }
      tr.item {
        cursor: pointer;
      }
      tr.item:hover,
      tr.item[aria-selected='true'] {
        background: var(--surface-2);
      }
      .sub {
        color: var(--text-3);
        word-break: break-all;
      }
      .badge {
        display: inline-block;
        border-radius: 999px;
        padding: 0 var(--s-2);
        font-size: 11px;
        font-weight: 650;
        margin: 1px 2px 1px 0;
        background: var(--surface-2);
        color: var(--text-2);
      }
      .badge.locked {
        background: var(--danger, #b42318);
        color: #fff;
      }
      .badge.due {
        outline: 2px solid var(--warn);
      }
      .badge.hidden,
      .badge.suspended {
        background: var(--warn-bg);
        color: var(--warn);
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        padding: var(--s-3);
        display: grid;
        gap: var(--s-3);
      }
      .panel h2 {
        margin: 0;
        font-size: var(--fs-l);
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 2px var(--s-3);
        margin: 0;
        font-size: var(--fs-s);
      }
      dt {
        color: var(--text-3);
      }
      dd {
        margin: 0;
        word-break: break-all;
      }
      .form {
        display: grid;
        gap: var(--s-2);
        border-top: 1px solid var(--border-soft);
        padding-top: var(--s-3);
      }
      textarea {
        font: inherit;
        min-height: 4em;
        padding: var(--s-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
      }
      .error {
        color: var(--danger, #b42318);
      }
      .ok {
        color: var(--ok);
      }
      ul.log {
        margin: 0;
        padding-left: var(--s-4);
        font-size: var(--fs-s);
      }
      @media (max-width: 760px) {
        .hide-s {
          display: none;
        }
      }
    `,
  ];

  private get kind(): AdminKind | null {
    return this.tab === 'log' ? null : this.tab;
  }

  /** Liste bzw. Protokoll mit dem aktuellen Reiter, Suchbegriff, Filter und der Seite neu anfordern. */
  reload(): void {
    emit<AdminQuery>(this, 'sx-admin-query', { tab: this.tab, q: this.q, filter: this.filter, page: this.page });
  }

  private switchTab(tab: Tab) {
    Object.assign(this, { tab, filter: 'all', page: 1, q: '', detail: null, form: null, note: '' });
    this.reload();
  }

  private open(id: string) {
    const kind = this.kind;
    if (!kind) return;
    Object.assign(this, { form: null, preview: null, note: '' });
    emit(this, 'sx-admin-open', { kind, id });
  }

  /** Aktion anfordern; der Controller führt sie aus, lädt neu und setzt `note` (bei Erfolg schließt er das Formular). */
  private act(op: AdminOp, done: string) {
    emit(this, 'sx-admin-act', { op, done });
  }

  private value(name: string): string {
    return (this.renderRoot.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? '').trim();
  }

  private badges(i: AdminItem) {
    const due = i.lock && i.lock.until - Date.now() < LOCK_WARN_MS;
    return html`${i.lock
      ? html`<span class="badge locked ${due ? 'due' : ''}" title=${i.lock.reason}>gesperrt bis ${fmtDate(i.lock.until)}${i.lock.viaUser ? ' (mit Konto)' : ''}</span>`
      : nothing}${i.hidden && !i.lock ? html`<span class="badge hidden">ausgeblendet</span>` : nothing}${i.suspended && !i.lock
      ? html`<span class="badge suspended">suspendiert</span>`
      : nothing}${i.visibility && i.visibility !== 'public' ? html`<span class="badge">${VISIBILITY_LABEL[i.visibility]}</span>` : nothing}`;
  }

  private renderList(kind: AdminKind) {
    const [c1, c2] = Object.keys(this.items[0]?.counts ?? {});
    return html`
      <div class="chips" role="group" aria-label="Filter">
        ${FILTERS_FOR[kind].map(
          (f) => html`<button class="chip" aria-pressed=${this.filter === f} @click=${() => {
            Object.assign(this, { filter: f, page: 1 });
            this.reload();
          }}>${ADMIN_FILTER_LABEL[f]}</button>`,
        )}
      </div>
      ${this.items.length
        ? html`<table>
            <thead><tr><th>Name</th><th>Status</th><th class="hide-s">Eigner</th><th class="hide-s">${c1 ?? ''}</th><th class="hide-s">${c2 ?? ''}</th><th class="hide-s">Angelegt</th></tr></thead>
            <tbody>
              ${this.items.map(
                (i) => html`<tr class="item" aria-selected=${this.detail?.item.id === i.id} @click=${() => this.open(i.id)}>
                  <td><strong>${i.name || '–'}</strong><div class="sub">${i.sub}</div></td>
                  <td>${this.badges(i)}</td>
                  <td class="hide-s">${i.owner ? i.owner.displayName : html`<span class="badge">ohne</span>`}</td>
                  <td class="hide-s num">${c1 ? i.counts[c1] : ''}</td>
                  <td class="hide-s num">${c2 ? i.counts[c2] : ''}</td>
                  <td class="hide-s">${fmtDate(i.createdAt)}</td>
                </tr>`,
              )}
            </tbody>
          </table>`
        : this.loading
          ? nothing
          : html`<p class="muted">Nichts gefunden.</p>`}
    `;
  }

  private renderLog() {
    return this.log.length
      ? html`<table>
          <thead><tr><th>Zeit</th><th>Admin</th><th>Aktion</th><th>Ziel</th><th>Detail</th></tr></thead>
          <tbody>
            ${this.log.map(
              (e) => html`<tr>
                <td>${fmtDateTime(e.createdAt)}</td>
                <td class="sub">${e.adminId ?? 'System'}</td>
                <td>${e.action}</td>
                <td class="sub">${e.targetKind ?? ''} ${e.targetId ?? ''}</td>
                <td>${e.detail}</td>
              </tr>`,
            )}
          </tbody>
        </table>`
      : html`<p class="muted">${this.loading ? '' : 'Keine Einträge.'}</p>`;
  }

  private renderForm(kind: AdminKind, d: AdminDetail) {
    const i = d.item;
    switch (this.form) {
      case 'lock':
        return html`<div class="form">
          <label class="label" for="reason">Begründung (steht im Protokoll)</label>
          <textarea id="reason" name="reason" maxlength="500"></textarea>
          <p class="hint">Gesperrt ist es nur noch für Admins sichtbar, für niemanden änderbar und von den normalen Löschfristen ausgenommen. Nach 180 Tagen wird es endgültig gelöscht, wenn niemand verlängert.</p>
          <div class="row-actions">
            <button class="btn danger" ?disabled=${this.busy} @click=${() =>
              this.act({ kind, id: i.id, type: 'lock', reason: this.value('reason') }, i.lock ? 'Sperre verlängert' : 'Gesperrt')}>${i.lock ? 'Um 180 Tage verlängern' : 'Sperren'}</button>
          </div>
        </div>`;
      case 'rename': {
        const fields: Array<[string, string, string]> =
          kind === 'users'
            ? [['displayName', 'Anzeigename', i.name], ['handle', 'Profilname (Adresse)', i.handle ?? '']]
            : kind === 'groups'
              ? [['name', 'Name', i.name], ['slug', 'Adresse', i.path?.split('/')[2] ?? '']]
              : [['name', 'Name', i.name]];
        return html`<div class="form">
          ${fields.map(([n, l, v]) => html`<label class="label" for=${n}>${l}</label><input type="text" id=${n} name=${n} .value=${v} />`)}
          <div class="row-actions">
            <button class="btn primary" ?disabled=${this.busy} @click=${() =>
              this.act({ kind, id: i.id, type: 'rename', patch: Object.fromEntries(fields.map(([n]) => [n, this.value(n)])) }, 'Umbenannt')}>Speichern</button>
          </div>
        </div>`;
      }
      case 'owner':
        return html`<div class="form">
          <label class="label" for="owner">Konto-ID des neuen Eigners (aus dem Reiter „Konten“)</label>
          <input type="text" id="owner" name="owner" />
          <p class="hint">${kind === 'boats' ? 'Das bisherige Konto bleibt Boots-Admin.' : kind === 'groups' ? 'Das bisherige Konto wird Admin der Gruppe.' : 'Die neue Anleger:in darf Name und Position pflegen.'}</p>
          <div class="row-actions">
            <button class="btn primary" ?disabled=${this.busy} @click=${() => this.act({ kind, id: i.id, type: 'owner', userId: this.value('owner') }, 'Eigner geändert')}>Übertragen</button>
          </div>
        </div>`;
      case 'merge':
        return kind === 'harbors'
          ? html`<div class="form">
              <label class="label" for="into">ID des Hafens, in den „${i.name}“ aufgeht</label>
              <input type="text" id="into" name="into" />
              <p class="hint">Boote, Gruppen, Heimathäfen, Folgende und Neuigkeiten wandern mit; /h/… leitet danach weiter. „${i.name}“ wird gelöscht.</p>
              <div class="row-actions">
                <button class="btn danger" ?disabled=${this.busy} @click=${() => this.act({ kind, id: i.id, type: 'mergeHarbor', into: this.value('into') }, 'Häfen zusammengeführt')}>Zusammenführen</button>
              </div>
            </div>`
          : html`<div class="form">
              <label class="label" for="into">ID des Kontos, das bleibt (Mail-Adresse und Anmeldung bleiben dort)</label>
              <input type="text" id="into" name="into" />
              <div class="row-actions">
                <button class="btn" ?disabled=${this.busy} @click=${() => {
                  this.note = '';
                  emit(this, 'sx-admin-preview', { id: i.id, into: this.value('into') });
                }}>Vorschau</button>
              </div>
              ${this.preview
                ? html`<p>„${this.preview.from.name}“ geht in „${this.preview.into.name}“ auf:
                      ${Object.entries(this.preview.counts)
                        .filter(([k]) => !k.endsWith('Profile'))
                        .map(([k, v]) => `${k} ${v}`)
                        .join(' · ')}.
                      Profil: ${this.preview.profile === 'keep' ? 'das des bleibenden Kontos' : this.preview.profile === 'take' ? 'wird übernommen' : 'keins'}.</p>
                    <label class="label" for="confirm">Zur Bestätigung die ID des aufzulösenden Kontos eingeben: ${i.id}</label>
                    <input type="text" id="confirm" name="confirm" />
                    <div class="row-actions">
                      <button class="btn danger" ?disabled=${this.busy} @click=${() =>
                        this.act({ kind, id: i.id, type: 'mergeUsers', into: this.preview!.into.id, confirm: this.value('confirm') }, 'Konten verbunden')}>Konten verbinden</button>
                    </div>`
                : nothing}
            </div>`;
      case 'support':
        return html`<div class="form">
          <label class="label" for="seasons">Unterstützer-Gutschein: Saisons</label>
          <select id="seasons" name="seasons">
            <option value="1">1 Saison</option><option value="2">2 Saisons</option><option value="3">3 Saisons</option>
          </select>
          <label class="label" for="note">Anlass (steht im Protokoll)</label>
          <input type="text" id="note" name="note" />
          <p class="hint">Wirkt wie eine Zahlung: Fotos, „Nur mit Link“/„Nur ich“ und die höheren Kontingente, angehängt an eine laufende Unterstützung.</p>
          <div class="row-actions">
            <button class="btn primary" ?disabled=${this.busy} @click=${() =>
              this.act({ kind, id: i.id, type: 'grantSupport', seasons: Number(this.value('seasons')), note: this.value('note') }, 'Gutschein zugewiesen')}>Zuweisen</button>
            <button class="btn ghost" ?disabled=${this.busy} @click=${() => this.act({ kind, id: i.id, type: 'revokeSupport' }, 'Gutschein entzogen')}>Gutscheine entziehen</button>
          </div>
        </div>`;
      case 'delete':
        return html`<div class="form">
          <label class="label" for="confirm">Endgültig löschen – zur Bestätigung die ID eingeben: ${i.id}</label>
          <input type="text" id="confirm" name="confirm" />
          <div class="row-actions">
            <button class="btn danger" ?disabled=${this.busy} @click=${() => this.act({ kind, id: i.id, type: 'remove', confirm: this.value('confirm') }, 'Gelöscht')}>Endgültig löschen</button>
          </div>
        </div>`;
      default:
        return nothing;
    }
  }

  private renderDetail(kind: AdminKind, d: AdminDetail) {
    const i = d.item;
    const locked = !!i.lock;
    const canOwner = kind === 'boats' || kind === 'groups' || kind === 'harbors';
    const button = (form: Form, label: string, cls = 'btn small') =>
      html`<button class=${cls} aria-pressed=${this.form === form} @click=${() => (this.form = this.form === form ? null : form)}>${label}</button>`;
    return html`<section class="panel" aria-label="Details">
      <h2>${i.name || '–'} ${this.badges(i)}</h2>
      <dl>
        <dt>ID</dt><dd>${i.id}</dd>
        ${i.sub ? html`<dt>${kind === 'users' ? 'E-Mail' : 'Angabe'}</dt><dd>${i.sub}</dd>` : nothing}
        ${i.owner ? html`<dt>${kind === 'harbors' ? 'Angelegt von' : 'Eigner'}</dt><dd>${i.owner.displayName} (${i.owner.id})</dd>` : nothing}
        <dt>Angelegt</dt><dd>${fmtDateTime(i.createdAt)}</dd>
        ${Object.entries(i.counts).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
        ${Object.entries(d.extra)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => html`<dt>${k}</dt><dd>${typeof v === 'number' && v > 1e12 ? fmtDateTime(v) : v}</dd>`)}
        ${i.lock
          ? html`<dt>Sperre</dt><dd>seit ${i.lock.since ? fmtDate(i.lock.since) : '?'} bis ${fmtDate(i.lock.until)}${i.lock.reason ? ` – ${i.lock.reason}` : ''}</dd>`
          : nothing}
      </dl>
      <div class="row-actions">
        ${i.path ? html`<a class="btn small ghost" href=${i.path} target="_blank" rel="noopener">${icon('open')} Seite öffnen</a>` : nothing}
        ${d.isAdmin
          ? html`<span class="muted">Admin-Konto – nicht sperr- oder löschbar</span>`
          : html`
              ${i.lock?.viaUser ? nothing : button('lock', locked ? 'Sperre verlängern' : 'Sperren', 'btn small danger')}
              ${locked && !i.lock?.viaUser
                ? html`<button class="btn small" ?disabled=${this.busy} @click=${() => this.act({ kind, id: i.id, type: 'unlock' }, 'Entsperrt')}>Entsperren</button>`
                : nothing}
              ${!locked && kind !== 'shares' ? button('rename', 'Umbenennen') : nothing}
              ${!locked && canOwner ? button('owner', 'Eigner ändern') : nothing}
              ${!locked && kind === 'users' ? button('support', 'Unterstützer-Gutschein') : nothing}
              ${!locked && (kind === 'harbors' || kind === 'users') ? button('merge', kind === 'users' ? 'Konto verbinden' : 'Zusammenführen') : nothing}
              ${button('delete', 'Endgültig löschen', 'btn small ghost danger')}
            `}
      </div>
      ${this.renderForm(kind, d)}
      ${this.note ? html`<p class=${this.note.match(/^(Gesperrt|Sperre|Entsperrt|Umbenannt|Eigner|Häfen|Konten|Gelöscht|Gutschein)/) ? 'ok' : 'error'} role="status">${this.note}</p>` : nothing}
      ${d.log.length
        ? html`<div><strong>Protokoll</strong><ul class="log">${d.log.map((e) => html`<li>${fmtDateTime(e.createdAt)} · ${e.action}${e.detail ? ` · ${e.detail}` : ''} · ${e.adminId ?? 'System'}</li>`)}</ul></div>`
        : nothing}
    </section>`;
  }

  render() {
    const kind = this.kind;
    return html`<main>
      <h1>Admin-Bereich</h1>
      <nav aria-label="Bereiche">
        ${ADMIN_KINDS.map((k) => html`<button class="btn small" aria-current=${this.tab === k ? 'page' : 'false'} @click=${() => this.switchTab(k)}>${ADMIN_KIND_LABEL[k]}</button>`)}
        <button class="btn small" aria-current=${this.tab === 'log' ? 'page' : 'false'} @click=${() => this.switchTab('log')}>Protokoll</button>
      </nav>
      <form
        class="search"
        role="search"
        @submit=${(e: Event) => {
          e.preventDefault();
          Object.assign(this, { q: this.value('q'), page: 1 });
          this.reload();
        }}
      >
        <input type="text" name="q" .value=${this.q} placeholder=${kind ? 'Name, Adresse, ID' + (kind === 'users' ? ', E-Mail' : '') : 'Ziel-ID, Admin-ID oder Aktion'} aria-label="Suchen" />
        <button class="btn" type="submit">Suchen</button>
      </form>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${kind && this.detail ? this.renderDetail(kind, this.detail) : nothing}
      ${kind ? this.renderList(kind) : this.renderLog()}
      <div class="pager">
        <button class="btn small" ?disabled=${this.page <= 1 || this.loading} @click=${() => {
          this.page--;
          this.reload();
        }}>${icon('left')} Zurück</button>
        <span class="muted">Seite ${this.page}</span>
        <button class="btn small" ?disabled=${!this.more || this.loading} @click=${() => {
          this.page++;
          this.reload();
        }}>Weiter ${icon('right')}</button>
      </div>
    </main>`;
  }
}
customElements.define('sx-admin-page', SxAdminPage);
