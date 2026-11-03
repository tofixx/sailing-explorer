import { LitElement, css, html } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { EVENT_LIMITS, EVENT_TYPES, EVENT_TYPE_LABEL, parseEventInput, type EventType, type EventView } from '../domain/events';
import type { EventFields } from '../services/api';
import { base, emit } from './shared';

const pad = (n: number) => String(n).padStart(2, '0');
/** Datum bzw. Uhrzeit für `<input type=date|time>` in der Zeit des Geräts. */
const dateOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeOf = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Zeitpunkt aus Datum und Uhrzeit (Zeit des Geräts); unvollständig → NaN. */
const at = (date: string, time: string) => (date && time ? new Date(`${date}T${time}`).getTime() : NaN);

/**
 * Angaben einer Veranstaltung (Konzept 30, F-480, F-484): Art, Beginn, Ende, Ort, Plätze und – beim Anlegen
 * (`with-description`) – die Beschreibung; der Titel ist der Text des Beitrags (`sx-post-composer`). Das eine Formular
 * für Anlegen (Formularteil in `sx-compose-dialog`, `KIND_FORMS`) und Ändern (`sx-event-dialog`). Rein präsentational –
 * meldet bei jeder Eingabe `sx-payload` { value, ok, message }, geprüft mit derselben Regel wie der Server
 * (`parseEventInput`); `clear()` nach dem Veröffentlichen. Mobil: Felder untereinander, volle Breite.
 */
export class SxEventForm extends LitElement {
  static properties = {
    /** vorhandene Veranstaltung (Ändern) – sonst Vorschlag morgen 18–20 Uhr */
    value: { attribute: false },
    /** Beschreibung abfragen (nur beim Anlegen – danach ist sie wie bei allen Beiträgen fest) */
    withDescription: { type: Boolean, attribute: 'with-description' },
  };
  declare value: EventView | null;
  declare withDescription: boolean;
  /** neu aufbauen nach `clear()` */
  private epoch = 0;

  constructor() {
    super();
    this.value = null;
    this.withDescription = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-2);
      }
      .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--s-2);
      }
      label {
        display: grid;
        gap: var(--s-1);
      }
      input[type='date'],
      input[type='time'],
      textarea {
        width: 100%;
        min-height: max(38px, var(--control-h));
        padding: 0 var(--s-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: var(--fs-m) var(--font);
      }
      textarea {
        min-height: 72px;
        padding: var(--s-2);
        resize: vertical;
      }
      @media (max-width: 480px) {
        .row {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  /** Vorbelegung: vorhandene Veranstaltung bzw. morgen 18:00–20:00. */
  private initial() {
    const v = this.value;
    if (v) return { startsAt: v.startsAt, endsAt: v.endsAt };
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(18, 0, 0, 0);
    return { startsAt: d.getTime(), endsAt: d.getTime() + 2 * 3_600_000 };
  }

  private field = (name: string) => this.renderRoot.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? '';

  /** Aktuelle Angaben – das Ende ohne eigenes Datum am Tag des Beginns. */
  read(): EventFields {
    const date = this.field('date');
    const endDate = this.field('endDate') || date;
    const cap = this.field('capacity').trim();
    return {
      type: this.field('type') as EventType,
      startsAt: at(date, this.field('start')),
      endsAt: at(endDate, this.field('end')),
      place: this.field('place'),
      capacity: cap === '' ? null : Number(cap),
      ...(this.withDescription ? { description: this.field('description') } : {}),
    };
  }

  private changed = () => {
    const value = this.read();
    const r = parseEventInput(value, Date.now());
    emit(this, 'sx-payload', 'error' in r ? { value: null, ok: false, message: r.error } : { value, ok: true, message: '' });
  };

  /** Nach dem Veröffentlichen: Vorschlag wie beim Öffnen. */
  clear() {
    this.epoch++;
    this.requestUpdate();
    void this.updateComplete.then(() => this.prime());
  }

  /** Auswahl der Art ausdrücklich setzen (`selected` an der Option allein greift nicht in jedem DOM), dann melden. */
  private prime() {
    const sel = this.renderRoot.querySelector<HTMLSelectElement>('select[name="type"]');
    if (sel) sel.value = this.value?.type ?? 'meet';
    this.changed();
  }

  protected firstUpdated(): void {
    this.prime();
  }

  render() {
    const v = this.value;
    const i = this.initial();
    const multi = dateOf(i.startsAt) !== dateOf(i.endsAt);
    // `epoch` als Schlüssel: nach `clear()` neue Felder mit Vorschlag
    return keyed(this.epoch, html`<div @input=${this.changed} @change=${this.changed} style="display: contents">
      <label><span class="label">Art</span>
        <select name="type">
          ${EVENT_TYPES.map((t) => html`<option value=${t} ?selected=${(v?.type ?? 'meet') === t}>${EVENT_TYPE_LABEL[t]}</option>`)}
        </select></label>
      <div class="row">
        <label><span class="label">Datum</span><input type="date" name="date" required .value=${dateOf(i.startsAt)} /></label>
        <label><span class="label">Beginn</span><input type="time" name="start" required .value=${timeOf(i.startsAt)} /></label>
      </div>
      <div class="row">
        <label><span class="label">Ende (Datum, nur wenn mehrtägig)</span><input type="date" name="endDate" .value=${multi ? dateOf(i.endsAt) : ''} /></label>
        <label><span class="label">Ende (Uhrzeit)</span><input type="time" name="end" required .value=${timeOf(i.endsAt)} /></label>
      </div>
      <label><span class="label">Ort (optional)</span>
        <input type="text" name="place" maxlength=${EVENT_LIMITS.placeMax} placeholder="z. B. Vereinsheim, Steg B" .value=${v?.place ?? ''} /></label>
      <label><span class="label">Plätze (optional)</span>
        <input type="number" name="capacity" inputmode="numeric" min="1" max=${EVENT_LIMITS.capacityMax} placeholder="ohne Grenze" .value=${v?.capacity != null ? String(v.capacity) : ''} />
        <span class="hint">Sind alle Plätze vergeben, geht nur noch „Vielleicht“ – eine Warteliste gibt es nicht.</span></label>
      ${this.withDescription
        ? html`<label><span class="label">Beschreibung (optional)</span>
            <textarea name="description" maxlength=${EVENT_LIMITS.descriptionMax} placeholder="Was ist geplant? Was sollte man mitbringen?" .value=${''}></textarea></label>`
        : ''}
    </div>`);
  }
}
customElements.define('sx-event-form', SxEventForm);
