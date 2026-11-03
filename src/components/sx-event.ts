import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import {
  EVENT_TYPE_LABEL, RSVP_LABEL, RSVP_PROBLEM_TEXT, RSVP_STATUSES, applyRsvp, canTakeToLogbook, eventWhen, freePlaces, isOver, logbookPreset, rsvpProblem, splitEventBody,
  type EventView, type RsvpStatus,
} from '../domain/events';
import type { RsvpList } from '../services/api';
import { icon } from './icons';
import { base, emit } from './shared';

const COUNT_LABEL: Record<RsvpStatus, [string, string]> = { yes: ['nimmt teil', 'nehmen teil'], maybe: ['vielleicht', 'vielleicht'], no: ['sagt ab', 'sagen ab'] };

/**
 * Veranstaltung unter dem Text des Beitrags (Titel und Beschreibung, `kindPayload` in sx-stream; Konzept 30, F-408,
 * F-480 … F-487): Datum, Art, Termin, Ort, Zähler und freie Plätze, Zusage-Knöpfe, „Wer kommt?“, Kalender-Datei, „Ins
 * Fahrtenbuch übernehmen“ (nach dem Ende, mit eigener Zusage) und – für die Autor:in – „Ändern oder absagen“. `body`
 * liefert Titel und Beschreibung für Kalender und Fahrtenbuch. Rein präsentational:
 * die Zusage wird sofort angezeigt (optimistisch) und als `sx-rsvp` { id, status, key, el } gemeldet; der Controller
 * setzt `event` bzw. `error` zurück. Weitere Events: `sx-rsvp-who` { id, key, el }, `sx-event-ics`, `sx-event-logbook`
 * { preset }, `sx-event-edit` { id, event, el }. Mobil: Knöpfe umbrechen, Tippziele ≥ 44 px.
 */
export class SxEvent extends LitElement {
  static properties = {
    postId: { type: String, attribute: 'post-id' },
    body: { type: String },
    /** Schlüssel „Nur mit Link“ (Einzelkarte `/p/<id>/<schlüssel>`) */
    shareKey: { attribute: false },
    event: { attribute: false },
    /** Antwort des Servers bei abgelehnter Zusage */
    error: { type: String },
    /** „Wer kommt?“ – vom Controller gesetzt */
    who: { attribute: false },
    whoOpen: { state: true },
    local: { state: true },
  };
  declare postId: string;
  declare body: string;
  declare shareKey: string | null;
  declare event: EventView | null;
  declare error: string;
  declare who: RsvpList | null;
  declare whoOpen: boolean;
  /** sofort angezeigte eigene Zusage, bis der Server antwortet */
  declare local: EventView | null;

  constructor() {
    super();
    this.postId = '';
    this.body = '';
    this.shareKey = null;
    this.event = null;
    this.error = '';
    this.who = null;
    this.whoOpen = false;
    this.local = null;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        margin-top: var(--s-2);
      }
      .top {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr);
        gap: var(--s-3);
        align-items: start;
      }
      .date {
        display: grid;
        place-items: center;
        padding: var(--s-1) 0;
        border-radius: var(--radius);
        background: var(--accent-soft);
        color: var(--accent);
        line-height: 1.1;
        text-align: center;
      }
      .date b {
        font-size: 1.35rem;
      }
      .date small {
        font-size: var(--fs-xs);
        font-weight: 700;
        text-transform: uppercase;
      }
      .meta {
        margin: var(--s-1) 0 0;
        font-size: var(--fs-s);
        color: var(--text-2);
        overflow-wrap: anywhere;
      }
      .cancelled {
        display: inline-block;
        margin-top: var(--s-1);
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--err);
        color: var(--on-accent, #fff);
        font-size: var(--fs-xs);
        font-weight: 700;
      }
      .counts {
        margin: var(--s-2) 0 0;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        margin-top: var(--s-2);
      }
      .rsvp .btn[aria-pressed='true'] {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
      }
      .btn {
        white-space: normal;
        text-align: center;
      }
      ul {
        list-style: none;
        margin: var(--s-2) 0 0;
        padding: var(--s-2);
        border-radius: var(--radius);
        background: var(--surface-2);
        display: grid;
        gap: var(--s-1);
        font-size: var(--fs-s);
      }
      ul a {
        color: inherit;
        font-weight: 600;
      }
      .error {
        margin: var(--s-2) 0 0;
        color: var(--err);
        font-size: var(--fs-s);
      }
      @media (max-width: 480px) {
        .rsvp .btn {
          flex: 1 1 100%;
        }
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    // Neue Daten vom Server ersetzen die sofortige Anzeige
    if (changed.has('event')) this.local = null;
  }

  private current(): EventView | null {
    return this.local ?? this.event;
  }

  private key = () => this.shareKey ?? null;
  private path = () => (this.shareKey ? `/p/${this.postId}/${this.shareKey}` : `/p/${this.postId}`);

  private rsvp(status: RsvpStatus) {
    const e = this.current();
    if (!e || e.mine === status) return;
    this.error = '';
    this.local = applyRsvp(e, status);
    emit(this, 'sx-rsvp', { id: this.postId, status, key: this.key(), el: this });
  }

  private toggleWho() {
    this.whoOpen = !this.whoOpen;
    if (this.whoOpen) emit(this, 'sx-rsvp-who', { id: this.postId, key: this.key(), el: this });
  }

  private whoList() {
    if (!this.whoOpen) return '';
    const w = this.who;
    if (!w) return html`<ul role="status"><li>Lade …</li></ul>`;
    const lines = RSVP_STATUSES.filter((s) => s !== 'no' || w.all).map((s) => {
      const names = w.people[s];
      const more = w.others[s];
      if (!names.length && !more) return '';
      return html`<li><b>${RSVP_LABEL[s]}:</b> ${names.map((p, i) => html`${i ? ', ' : ''}${p.handle ? html`<a href="/u/${p.handle}">${p.displayName}</a>` : p.displayName}`)}${more
          ? html`${names.length ? ' ' : ''}<span class="faint">${names.length ? `+ ${more} weitere` : more === 1 ? '1 Person ohne öffentliches Profil' : `${more} Personen ohne öffentliches Profil`}</span>`
          : ''}</li>`;
    });
    return html`<ul aria-label="Wer kommt">${lines}${lines.every((l) => l === '') ? html`<li class="faint">Noch keine Zusagen.</li>` : ''}</ul>`;
  }

  private counts(e: EventView) {
    const parts = (['yes', 'maybe'] as const).filter((s) => e.counts[s]).map((s) => `${e.counts[s]} ${COUNT_LABEL[s][e.counts[s] === 1 ? 0 : 1]}`);
    const free = freePlaces(e);
    if (free !== null) parts.push(free ? `${free} von ${e.capacity} Plätzen frei` : 'alle Plätze vergeben');
    return parts.length ? parts.join(' · ') : 'Noch keine Zusagen';
  }

  render() {
    const e = this.current();
    const { title, description } = splitEventBody(this.body);
    if (!e) return nothing;
    const now = Date.now();
    const over = isOver(e, now);
    const start = new Date(e.startsAt);
    const open = !e.cancelled && !over;
    return html`<div class="top">
        <div class="date" aria-hidden="true">
          <small>${start.toLocaleDateString('de-DE', { weekday: 'short' })}</small><b>${start.getDate()}</b><small>${start.toLocaleDateString('de-DE', { month: 'short' })}</small>
        </div>
        <div>
          <p class="meta">${icon('calendar')} ${EVENT_TYPE_LABEL[e.type]} · <time datetime=${start.toISOString()}>${eventWhen(e)}</time>${over && !e.cancelled ? ' · vorbei' : ''}</p>
          ${e.place ? html`<p class="meta">${icon('anchor')} ${e.place}</p>` : ''}
          ${e.cancelled ? html`<span class="cancelled">Abgesagt</span>` : ''}
        </div>
      </div>
      <p class="counts">${this.counts(e)}</p>
      ${open
        ? html`<div class="row rsvp" role="group" aria-label="Deine Zusage">
            ${RSVP_STATUSES.map((s) => {
              const blocked = rsvpProblem(e, s, now);
              return html`<button class="btn" type="button" aria-pressed=${e.mine === s ? 'true' : 'false'} ?disabled=${!!blocked}
                title=${blocked ? RSVP_PROBLEM_TEXT[blocked] : nothing} @click=${() => this.rsvp(s)}>${e.mine === s ? icon('check') : ''}${RSVP_LABEL[s]}</button>`;
            })}
          </div>`
        : ''}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      <div class="row">
        <button class="btn ghost" type="button" aria-expanded=${this.whoOpen ? 'true' : 'false'} @click=${() => this.toggleWho()}>${icon('community')} Wer kommt?</button>
        ${open ? html`<button class="btn ghost" type="button" @click=${() => emit(this, 'sx-event-ics', { id: this.postId, title, description, event: e, path: this.path() })}>${icon('download')} In den Kalender</button>` : ''}
        ${canTakeToLogbook(e, now)
          ? html`<button class="btn ghost" type="button" @click=${() => emit(this, 'sx-event-logbook', { preset: logbookPreset(this.postId, title, e) })}>${icon('book')} Ins Fahrtenbuch übernehmen</button>`
          : ''}
        ${e.own && open ? html`<button class="btn ghost" type="button" @click=${() => emit(this, 'sx-event-edit', { id: this.postId, event: e, el: this })}>${icon('pencil')} Ändern oder absagen</button>` : ''}
      </div>
      ${this.whoList()}`;
  }
}
customElements.define('sx-event', SxEvent);
