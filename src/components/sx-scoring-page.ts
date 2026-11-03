import { LitElement, css, html, nothing } from 'lit';
import { SCORING_NOTE, rulesSummary, templateLabel, type ScoringTemplate } from '../domain/scoring';
import { fmtNum } from '../domain/format';
import type { ClubList, MyScoring, ScoringClub } from '../services/scoring-api';
import { LOGBOOK_PATH } from '../services/url-state';
import { icon } from './icons';
import { base, emit } from './shared';
import './sx-scoring-editor';
import type { SxScoringEditor } from './sx-scoring-editor';

/**
 * Verwaltungsbereich „Wertung“ (`/konto/wertung`, Konzept 32, F-500 … F-507): je eigenem Verein die Teilnahme an der
 * Vereinsliste (Opt-in) mit der eigenen Summe, für Eigner/Admins die ganze Liste, für Eigner/Admins die Vorlagen des Vereins (übernehmen, bearbeiten,
 * eigene, löschen), dazu die Vorschläge der Plattform (pflegen nur Plattform-Admins). Rein präsentational – Daten setzt
 * der ScoringPageController. Events: `sx-scoring-optin` { groupId, optIn }, `sx-scoring-list` { groupId, season },
 * `sx-scoring-edit` { template, groupId }, `sx-scoring-adopt` { groupId, sourceId }, `sx-scoring-delete` { template },
 * `sx-login`; aus dem Editor `sx-scoring-save`, `sx-scoring-close`.
 */
export class SxScoringPage extends LitElement {
  static properties = {
    data: { attribute: false },
    lists: { attribute: false },
    seasons: { attribute: false },
    season: { type: Number },
    busy: { type: Boolean },
    error: { type: String },
    signedIn: { type: Boolean },
  };
  /** null = noch nicht geladen */
  declare data: MyScoring | null;
  /** geladene Vereinslisten je Verein */
  declare lists: Record<string, ClubList>;
  /** wählbare Saisons der Vereinsliste, neueste zuerst */
  declare seasons: number[];
  /** vorgewählte Saison der Vereinsliste */
  declare season: number;
  declare busy: boolean;
  declare error: string;
  declare signedIn: boolean;

  constructor() {
    super();
    this.data = null;
    this.lists = {};
    this.seasons = [];
    this.season = new Date().getFullYear();
    this.busy = false;
    this.error = '';
    this.signedIn = true;
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
        max-width: 960px;
        margin: 0 auto;
        padding: var(--s-5) var(--s-4) var(--s-6);
        display: grid;
        gap: var(--s-4);
      }
      h1 {
        margin: 0;
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
      }
      h2 {
        margin: 0;
        font-size: var(--fs-l);
      }
      h3 {
        margin: 0;
        font-size: var(--fs-m);
      }
      .lead,
      .faint,
      .empty {
        margin: 0;
        color: var(--text-2);
        max-width: 65ch;
      }
      .faint {
        font-size: var(--fs-s);
      }
      .card {
        display: grid;
        gap: var(--s-3);
        padding: var(--s-4);
        border-radius: var(--radius-l);
        background: var(--surface);
        border: 1px solid var(--border-soft);
        min-width: 0;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
      .btn,
      select {
        min-height: 44px;
      }
      select {
        font: inherit;
        padding: 0 var(--s-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--bg);
        color: var(--text);
        max-width: 100%;
      }
      .check {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        min-height: 44px;
        cursor: pointer;
      }
      .check input {
        margin-top: 4px;
        width: 20px;
        height: 20px;
        flex: none;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      li {
        display: grid;
        gap: var(--s-1);
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        border: 1px solid var(--border-soft);
        min-width: 0;
        overflow-wrap: anywhere;
      }
      li.me {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .line {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-3);
        align-items: baseline;
        justify-content: space-between;
      }
      .pts {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .note {
        font-size: var(--fs-s);
        color: var(--text-2);
        background: var(--surface-2);
        border-radius: var(--radius);
        padding: var(--s-2) var(--s-3);
        margin: 0;
      }
    `,
  ];

  /** Das eine Vorlagen-Formular (für Vorschläge und Vereinsvorlagen). */
  get editor(): SxScoringEditor | null {
    return this.renderRoot.querySelector<SxScoringEditor>('sx-scoring-editor');
  }

  private body() {
    if (!this.signedIn)
      return html`<p class="empty">Melde dich an, um Wertung und Vereinslisten zu sehen.</p>
        <p><button class="btn primary" @click=${() => emit(this, 'sx-login')}>Anmelden</button></p>`;
    if (this.error) return html`<p class="empty" role="alert">${this.error}</p>`;
    const d = this.data;
    if (!d) return html`<p class="empty">Lade …</p>`;
    const global = d.templates.filter((t) => t.groupId === null);
    return html`
      <section aria-labelledby="clubs-h">
        <h2 id="clubs-h">Meine Vereine</h2>
        ${d.clubs.length
          ? d.clubs.map((c) => this.club(c, d))
          : html`<p class="empty">Du bist in keinem Verein. Eine Vereinsliste gibt es nur im Verein – für alle anderen zählt dein Fahrtenbuch mit den Vorschlägen unten.</p>`}
      </section>
      <section class="card" aria-labelledby="global-h">
        <h2 id="global-h">Vorschläge der Plattform</h2>
        <p class="faint">Jede:r kann sie im Fahrtenbuch wählen; Vereine übernehmen sie als eigene Vorlage und passen sie an.${d.admin ? ' Du pflegst sie als Admin.' : ''}</p>
        ${this.templateList(global, d.admin)}
        ${d.admin ? html`<div class="row"><button class="btn" ?disabled=${this.busy} @click=${() => emit(this, 'sx-scoring-edit', { template: null, groupId: null })}>${icon('plus')} Neuer Vorschlag</button></div>` : ''}
      </section>`;
  }

  /** Ein Verein: Teilnahme, Liste und (Eigner/Admins) Vorlagen. */
  private club(c: ScoringClub, d: MyScoring) {
    const own = d.templates.filter((t) => t.groupId === c.id);
    const list = this.lists[c.id];
    const proposals = d.templates.filter((t) => t.groupId === null && t.id !== 'meilen');
    return html`<article class="card" aria-label=${c.name}>
      <h3><a href="/g/${c.slug}">${c.name}</a></h3>
      <label class="check">
        <input type="checkbox" .checked=${c.optIn} ?disabled=${this.busy} @change=${(e: Event) => emit(this, 'sx-scoring-optin', { groupId: c.id, optIn: (e.target as HTMLInputElement).checked })} />
        <span>An der Vereinsliste teilnehmen: Eigner:in und Admins von ${c.name} dürfen meine Punktesumme sehen
          <span class="faint">– mit deinem Namen, ohne Einzelangaben. Es zählen nur öffentliche Törns, die du in ${c.name} zeigst und mit einer Vorlage des Vereins wertest. Andere Mitglieder sehen deine Summe nicht. Jederzeit abschaltbar.</span></span>
      </label>
      ${c.optIn || c.manage
        ? html`<div class="row">
            <label for="season-${c.id}" class="faint">Saison</label>
            <select id="season-${c.id}" @change=${(e: Event) => emit(this, 'sx-scoring-list', { groupId: c.id, season: Number((e.target as HTMLSelectElement).value) })}>
              ${this.seasons.map((s) => html`<option value=${s} ?selected=${(list?.season ?? this.season) === s}>${s}</option>`)}
            </select>
            ${list ? '' : html`<button class="btn" ?disabled=${this.busy} @click=${() => emit(this, 'sx-scoring-list', { groupId: c.id, season: Number(this.renderRoot.querySelector<HTMLSelectElement>(`#season-${c.id}`)?.value ?? this.season) })}>${icon('community')} ${c.manage ? 'Vereinsliste zeigen' : 'Meine Summe zeigen'}</button>`}
          </div>
          ${list ? this.clubList(list) : nothing}`
        : nothing}
      ${c.manage
        ? html`<h3>Vorlagen des Vereins</h3>
            ${own.length ? this.templateList(own, true) : html`<p class="faint">Noch keine – übernimm einen Vorschlag oder lege eine eigene an.</p>`}
            <div class="row">
              <label for="adopt-${c.id}" class="faint">Vorschlag</label>
              <select id="adopt-${c.id}">${proposals.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select>
              <button class="btn" ?disabled=${this.busy || !proposals.length}
                @click=${() => emit(this, 'sx-scoring-adopt', { groupId: c.id, sourceId: this.renderRoot.querySelector<HTMLSelectElement>(`#adopt-${c.id}`)?.value })}>${icon('copy')} Übernehmen</button>
              <button class="btn" ?disabled=${this.busy} @click=${() => emit(this, 'sx-scoring-edit', { template: null, groupId: c.id })}>${icon('plus')} Eigene Vorlage</button>
            </div>`
        : nothing}
    </article>`;
  }

  private clubList(l: ClubList) {
    return html`<p class="note">${SCORING_NOTE} ${l.full ? 'Reihenfolge nach Punkten – ohne Platzziffern, nur für Eigner:in und Admins.' : 'Nur deine Summe – die Liste sehen Eigner:in und Admins.'}
        ${l.templates.length ? `Es zählen: ${l.templates.map((t) => `${t.name} (× ${fmtNum(t.listWeight, t.listWeight % 1 ? 1 : 0)})`).join(', ')}.` : 'Noch zählt keine Vorlage – Admins legen das an der Vorlage fest.'}</p>
      ${l.members.length
        ? html`<ul aria-label="Vereinsliste ${l.season}">
            ${l.members.map(
              (m) => html`<li class=${m.me ? 'me' : ''}>
                <div class="line">
                  <span>${m.handle ? html`<a href="/u/${m.handle}">${m.name}</a>` : m.name}${m.me ? ' (du)' : ''}</span>
                  <span class="pts">${fmtNum(m.points, 1)} Punkte</span>
                </div>
                <span class="faint">${m.entries} ${m.entries === 1 ? 'Eintrag' : 'Einträge'}${m.byTemplate.length ? ` · ${m.byTemplate.map((b) => `${b.template}: ${fmtNum(b.points, 1)}`).join(' · ')}` : ''}</span>
              </li>`,
            )}
          </ul>`
        : html`<p class="faint">${l.full ? 'Noch nimmt niemand teil.' : 'Noch keine Punkte.'}</p>`}
      ${l.truncated ? html`<p class="faint">Nur die ersten 5.000 Törns sind gerechnet.</p>` : ''}`;
  }

  /** Vorlagen mit Kurzbeschreibung; `manage`: Bearbeiten und Löschen („Nur Meilen“ ist eingebaut). */
  private templateList(list: ScoringTemplate[], manage: boolean) {
    return html`<ul>
      ${list.map(
        (t) => html`<li>
          <div class="line">
            <b>${templateLabel({ name: t.name, groupName: null })}</b>
            ${t.groupId && t.listWeight !== null ? html`<span class="faint">zählt in der Vereinsliste × ${fmtNum(t.listWeight, t.listWeight % 1 ? 1 : 0)}</span>` : ''}
          </div>
          <span class="faint">${rulesSummary(t.rules)}${t.sourceName ? ` · übernommen aus „${t.sourceName}“` : ''}</span>
          ${manage && t.id !== 'meilen'
            ? html`<div class="row">
                <button class="btn small ghost" ?disabled=${this.busy} aria-label="Bearbeiten: ${t.name}" @click=${() => emit(this, 'sx-scoring-edit', { template: t, groupId: t.groupId })}>${icon('pencil')} Bearbeiten</button>
                <button class="btn small ghost" ?disabled=${this.busy} aria-label="Löschen: ${t.name}" @click=${() => emit(this, 'sx-scoring-delete', { template: t })}>${icon('trash')} Löschen</button>
              </div>`
            : ''}
        </li>`,
      )}
    </ul>`;
  }

  render() {
    return html`<main>
      <header>
        <h1>Wertung</h1>
        <p class="lead">Punkte nach Vorlagen für Fahrtenpreise im Verein. ${SCORING_NOTE} Keine Rangliste über Vereine hinweg; deine Punkte und den Jahresbericht findest du in deinem <a href=${LOGBOOK_PATH}>Fahrtenbuch</a>.</p>
      </header>
      ${this.body()}
      <sx-scoring-editor></sx-scoring-editor>
    </main>`;
  }
}
customElements.define('sx-scoring-page', SxScoringPage);
