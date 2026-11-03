import { LitElement, css, html, nothing } from 'lit';
import { DIST_SOURCE_LABEL, LOG_STATES, LOG_STATE_LABEL, type LogState } from '../domain/logbook';
import {
  LOG_FILTER_LABEL, areaText, entrySeason, filterEntries, logbookSeasons, logbookTotals, roleText, type LogbookEntry, type LogbookTotals,
} from '../domain/logbook-year';
import { SCORING_NOTE, pointsByTemplate, scoreEntry, templateFor, templateLabel, usesTemplates, type ScoringTemplate } from '../domain/scoring';
import { SCORING_PATH } from '../services/url-state';
import { fmtDate, fmtNum } from '../domain/format';
import { icon } from './icons';
import { base, emit, logbookTag } from './shared';

/**
 * Verwaltungsbereich „Mein Fahrtenbuch“ (`/konto/fahrtenbuch`, Konzept 27, F-411, F-418, F-455 … F-458): Reiter je
 * Saison, Filter nach Stand (Mehrfachauswahl, B14), Summen der gefilterten Einträge, Liste mit eigenen Törns und
 * Crew-Törns anderer (M1, nur Eckdaten), Punkte je Eintrag und je Vorlage (Konzept 32, F-505), Meilennachweis und
 * Jahresbericht als CSV und Druck. Rein präsentational – Daten setzt der
 * LogbookPageController. Events: `sx-logbook-season` { season }, `sx-logbook-filter` { states },
 * `sx-logbook-state` { id, logState }, `sx-logbook-edit-entry` { id }, `sx-logbook-print`, `sx-logbook-start`, `sx-login`.
 */
export class SxLogbookPage extends LitElement {
  static properties = {
    entries: { attribute: false },
    season: { type: Number },
    states: { attribute: false },
    loading: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    /** false = nicht angemeldet (Hinweis mit „Anmelden“) */
    signedIn: { type: Boolean },
    /** wählbare Wertungsvorlagen (F-501) – leer: alles „Nur Meilen“ */
    templates: { attribute: false },
    /** Link „Wertung“ (F-507): nur für Vereinsmitglieder (und Admins der Vorschläge) */
    scoringLink: { type: Boolean },
  };
  /** null = noch nicht geladen */
  declare entries: LogbookEntry[] | null;
  declare season: number;
  declare states: LogState[];
  declare loading: boolean;
  declare busy: boolean;
  declare error: string;
  declare signedIn: boolean;
  declare templates: ScoringTemplate[];
  declare scoringLink: boolean;

  constructor() {
    super();
    this.entries = null;
    this.season = new Date().getFullYear();
    this.states = ['confirmed', 'suggested'];
    this.loading = false;
    this.busy = false;
    this.error = '';
    this.signedIn = true;
    this.templates = [];
    this.scoringLink = false;
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
      header {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2) var(--s-3);
        align-items: flex-end;
        justify-content: space-between;
      }
      h1 {
        margin: 0;
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
      }
      .lead {
        margin: var(--s-1) 0 0;
        color: var(--text-2);
        max-width: 60ch;
      }
      .tools,
      .filter,
      .row-tools {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
      .tools .btn,
      .filter button,
      .row-tools .btn {
        min-height: 44px;
      }
      .seasons {
        display: flex;
        gap: var(--s-1);
        overflow-x: auto;
        scrollbar-width: thin;
        padding-bottom: 2px;
      }
      .seasons button,
      .filter button {
        min-height: 44px;
        padding: 0 var(--s-4);
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface);
        color: var(--text-2);
        font: 600 var(--fs-s) / 1 var(--font);
        cursor: pointer;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
      }
      .seasons button[aria-selected='true'],
      .filter button[aria-pressed='true'] {
        background: var(--accent-soft);
        border-color: var(--accent);
        color: var(--text);
      }
      .totals {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: var(--s-2);
        margin: 0;
      }
      .totals div {
        overflow-wrap: anywhere;
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
        min-width: 0;
      }
      .totals dt {
        overflow-wrap: anywhere;
        font-size: var(--fs-s);
        color: var(--text-3);
      }
      .totals dd {
        margin: 0;
        font-weight: 700;
        font-size: var(--fs-l);
        overflow-wrap: anywhere;
      }
      .totals small {
        display: block;
        font-weight: 400;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      h2 {
        margin: 0;
        font-size: var(--fs-l);
      }
      h3 {
        margin: var(--s-3) 0 var(--s-2);
        font-size: var(--fs-m);
      }
      .points {
        font-weight: 600;
        color: var(--text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      li {
        display: grid;
        gap: var(--s-1);
        padding: var(--s-3);
        border-radius: var(--radius-l);
        background: var(--surface);
        border: 1px solid var(--border-soft);
        min-width: 0;
      }
      li.excluded {
        opacity: 0.7;
        border-style: dashed;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-2);
        align-items: baseline;
      }
      .head b {
        overflow-wrap: anywhere;
      }
      .date {
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-3);
        font-size: var(--fs-s);
        color: var(--text-2);
        overflow-wrap: anywhere;
      }
      .state {
        font-size: var(--fs-s);
        padding: 2px var(--s-2);
        border-radius: 999px;
        background: var(--surface-2);
      }
      .state.confirmed {
        background: var(--accent-soft);
      }
      .empty,
      .note {
        color: var(--text-2);
      }
      .print-only {
        display: none;
      }
      @media print {
        :host {
          overflow: visible;
          background: none;
        }
        main {
          padding: 0;
          max-width: none;
        }
        .tools,
        .seasons,
        .filter,
        .row-tools,
        .lead {
          display: none !important;
        }
        .print-only {
          display: block;
        }
        li,
        .totals div {
          break-inside: avoid;
          border-color: #999;
        }
      }
    `,
  ];

  /** Punkte zeigen? (in `body()` je Ansicht gesetzt) */
  private scored = false;

  private seasons(): number[] {
    return logbookSeasons(this.entries ?? [], Date.now());
  }

  private filterLabel(): string {
    return this.states.map((s) => LOG_FILTER_LABEL[s]).join(', ');
  }

  /** CSV mit Saison und Filter der Ansicht (F-457). */
  private csvHref(): string {
    return `/api/me/logbook.csv?saison=${this.season}&stand=${this.states.join(',')}`;
  }

  private toggle(s: LogState) {
    const next = this.states.includes(s) ? this.states.filter((x) => x !== s) : LOG_STATES.filter((x) => x === s || this.states.includes(x));
    // mindestens ein Stand bleibt gewählt
    if (next.length) emit(this, 'sx-logbook-filter', { states: next });
  }

  private totals(t: LogbookTotals) {
    const h = (v: number) => `${fmtNum(v, 1)} h`;
    const items: Array<[string, string, string?]> = [
      ['Törns', fmtNum(t.count, 0)],
      ['Seemeilen', `${fmtNum(t.nm, 1)} sm`, t.recordedNm < t.nm - 0.05 ? `davon ${fmtNum(t.recordedNm, 1)} sm aufgezeichnet` : undefined],
    ];
    if (t.sailH) items.push(['Unter Segel', h(t.sailH)]);
    if (t.engineH) items.push(['Unter Motor', h(t.engineH)]);
    if (t.skipperNm) items.push(['Als Skipper:in', `${fmtNum(t.skipperNm, 1)} sm`]);
    if (t.nightH) items.push(['Nachtfahrt', h(t.nightH)]);
    if (t.count) items.push(['Tage an Bord', fmtNum(t.days, 0)]);
    if (t.harbors) items.push(['Häfen', fmtNum(t.harbors, 0)]);
    if (t.coastalNm) items.push(['Küste / offshore', `${fmtNum(t.coastalNm, 1)} sm`, t.tidal ? `${t.tidal} im Tidengewässer` : undefined]);
    if (t.locks) items.push(['Schleusen', fmtNum(t.locks, 0)]);
    if (t.bridges) items.push(['Brücken', fmtNum(t.bridges, 0)]);
    if (t.mast) items.push(['Mast gelegt/gestellt', fmtNum(t.mast, 0)]);
    for (const it of t.items) items.push([it.name, fmtNum(it.n, it.n % 1 ? 1 : 0)]);
    return html`<dl class="totals" aria-label="Summen">
      ${items.map(([k, v, sub]) => html`<div><dt>${k}</dt><dd>${v}${sub ? html`<small>${sub}</small>` : ''}</dd></div>`)}
    </dl>`;
  }

  /** Punkte je Vorlage (Jahresbericht, F-505) – mit dem Hinweis „Vereinshilfe“ und dem Weg zur Wertung. */
  private points(shown: LogbookEntry[]) {
    const by = this.scored ? pointsByTemplate(shown, this.templates) : [];
    if (!by.length) return nothing;
    return html`<h3>Punkte</h3>
      <dl class="totals" aria-label="Punkte je Vorlage">
        ${by.map((b) => html`<div><dt>${templateLabel(b.template)}</dt><dd>${fmtNum(b.points, 1)}<small>${b.count} ${b.count === 1 ? 'Eintrag' : 'Einträge'}</small></dd></div>`)}
      </dl>
      <p class="note">${SCORING_NOTE}</p>`;
  }

  private route(e: LogbookEntry): string {
    const from = e.from?.name ?? '–';
    if (!e.to || e.to.slug === e.from?.slug) return e.from ? `Rundtörn ab ${from}` : '–';
    return `${from} → ${e.to.name}`;
  }

  private entry(e: LogbookEntry) {
    const title = e.title ?? this.route(e);
    const log = e.log;
    const t = templateFor(log.templateId, this.templates);
    const extras = [
      areaText(log),
      ...(log.items ?? []).map((it) => `${it.name}${it.n !== 1 ? ` × ${fmtNum(it.n, it.n % 1 ? 1 : 0)}` : ''}`),
      log.regatta ? `Regatta ${log.regatta.name}${log.regatta.place ? ` (Platz ${log.regatta.place}${log.regatta.starters ? `/${log.regatta.starters}` : ''})` : ''}` : '',
    ].filter(Boolean);
    return html`<li class=${e.logState} data-id=${e.id}>
      <div class="head">
        <span class="date">${fmtDate(e.startedAt)}</span>
        <b>${e.path ? html`<a href=${e.path}>${title}</a>` : title}</b>
        ${e.source === 'manual' ? logbookTag() : ''}
        ${e.own ? '' : html`<span class="state">Crew</span>`}
        <span class="state ${e.logState}" title=${LOG_STATE_LABEL[e.logState]}>${LOG_FILTER_LABEL[e.logState]}</span>
      </div>
      <div class="meta">
        ${e.title && (e.from || e.to) ? html`<span>${this.route(e)}</span>` : ''}
        <span>${fmtNum(e.distNm, 1)} sm (${DIST_SOURCE_LABEL[e.distSource]})</span>
        ${e.role ? html`<span>${roleText(e)}</span>` : ''}
        ${e.boat ? html`<span>${icon('sail')} ${e.boat}</span>` : ''}
        ${extras.length ? html`<span>${extras.join(' · ')}</span>` : ''}
        ${e.logState === 'excluded' || !this.scored ? '' : html`<span class="points">${fmtNum(scoreEntry(e, t.rules), 1)} Punkte · ${templateLabel(t)}</span>`}
      </div>
      ${e.own ? this.tools(e) : nothing}
    </li>`;
  }

  /** Eigene Einträge: bestätigen, aus- bzw. wieder einschließen (F-422), bearbeiten (F-411). */
  private tools(e: LogbookEntry) {
    const set = (logState: LogState) => emit(this, 'sx-logbook-state', { id: e.id, logState });
    return html`<div class="row-tools">
      ${e.logState === 'suggested' ? html`<button class="btn small" ?disabled=${this.busy} @click=${() => set('confirmed')}>${icon('check')} Bestätigen</button>` : ''}
      ${e.logState === 'excluded'
        ? html`<button class="btn small ghost" ?disabled=${this.busy} @click=${() => set(e.source === 'manual' ? 'confirmed' : 'suggested')}>${icon('plus')} Wieder aufnehmen</button>`
        : html`<button class="btn small ghost" ?disabled=${this.busy} @click=${() => set('excluded')}>${icon('x')} Ausschließen</button>`}
      <button class="btn small ghost" ?disabled=${this.busy} aria-label="Bearbeiten: ${e.title ?? this.route(e)}"
        @click=${() => emit(this, 'sx-logbook-edit-entry', { id: e.id })}>${icon('pencil')} Bearbeiten</button>
    </div>`;
  }

  private body() {
    if (!this.signedIn)
      return html`<p class="empty">Melde dich an, um dein Fahrtenbuch zu sehen.</p>
        <p><button class="btn primary" @click=${() => emit(this, 'sx-login')}>Anmelden</button></p>`;
    if (this.error) return html`<p class="empty" role="alert">${this.error}</p>`;
    if (!this.entries) return html`<p class="empty">Lade …</p>`;
    if (!this.entries.length)
      return html`<p class="empty">Noch nichts im Fahrtenbuch. Törns mit GPX und Einträge ohne GPX landen hier – angelegt wird über „+ Neu“.</p>
        <p><button class="btn" @click=${() => emit(this, 'sx-logbook-start')}>${icon('plus')} Eintrag hinzufügen</button></p>`;
    const seasons = this.seasons();
    const season = seasons.includes(this.season) ? this.season : seasons[0];
    const shown = filterEntries(this.entries, this.states, season);
    // Punkte nur, wenn ein gezeigter Eintrag mehr als „Nur Meilen“ zählt (F-505)
    this.scored = usesTemplates(shown, this.templates);
    const inSeason = this.entries.filter((e) => entrySeason(e) === season).length;
    return html`
      <div class="seasons" role="tablist" aria-label="Saison" data-scroll-x>
        ${seasons.map((s) => html`<button role="tab" aria-selected=${s === season ? 'true' : 'false'} @click=${() => s !== season && emit(this, 'sx-logbook-season', { season: s })}>${s}</button>`)}
      </div>
      <div class="filter" role="group" aria-label="Stand im Fahrtenbuch">
        ${LOG_STATES.map((s) => html`<button aria-pressed=${this.states.includes(s) ? 'true' : 'false'} @click=${() => this.toggle(s)}>
          ${this.states.includes(s) ? icon('check') : ''} ${LOG_FILTER_LABEL[s]}</button>`)}
      </div>
      <p class="print-only">Jahresbericht Saison ${season} · ${this.filterLabel()} · Stand ${fmtDate(Date.now())}</p>
      <section aria-labelledby="sum-h">
        <h2 id="sum-h">Saison ${season}</h2>
        <p class="note">Summen der gezeigten Einträge (${this.filterLabel()}); ausgeschlossene zählen nie.</p>
        ${this.totals(logbookTotals(shown))}
        ${this.points(shown)}
      </section>
      <section aria-label="Einträge ${season}">
        ${shown.length
          ? html`<ol>${shown.map((e) => this.entry(e))}</ol>`
          : html`<p class="empty">${inSeason ? 'Keine Einträge mit diesem Filter.' : 'Keine Einträge in dieser Saison.'}</p>`}
      </section>`;
  }

  render() {
    const ready = this.signedIn && !!this.entries?.length;
    return html`<main>
      <header>
        <div>
          <h1>Mein Fahrtenbuch</h1>
          <p class="lead">Deine Törns nach Saison – mit und ohne GPX, dazu Törns, auf denen du als Crew mitgesegelt bist. Als Meilennachweis und Jahresbericht exportieren oder drucken.</p>
        </div>
        ${ready || this.scoringLink
          ? html`<div class="tools">
              ${ready
                ? html`<a class="btn" href=${this.csvHref()} download title="Meilennachweis und Jahresbericht mit Punkten">${icon('download')} CSV</a>
                    <button class="btn" @click=${() => emit(this, 'sx-logbook-print')}>${icon('print')} Drucken</button>`
                : ''}
              ${this.scoringLink ? html`<a class="btn" href=${SCORING_PATH}>${icon('scale')} Wertung</a>` : ''}
            </div>`
          : ''}
      </header>
      ${this.body()}
    </main>`;
  }
}
customElements.define('sx-logbook-page', SxLogbookPage);
