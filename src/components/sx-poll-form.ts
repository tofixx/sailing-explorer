import { LitElement, css, html } from 'lit';
import { POLL_LIMITS, POLL_RESULTS, POLL_RESULTS_LABEL, readPollConfig, type PollConfig, type PollResults } from '../domain/polls';
import { icon } from './icons';
import { base, emit } from './shared';

/** `datetime-local` (Ortszeit) ↔ ms */
const toLocalInput = (ms: number): string => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

/**
 * Formularteil einer Umfrage im Plus-Knopf (Konzept 29, F-470): Antworten (2–10), Einfach- oder Mehrfachauswahl
 * („höchstens n“), optionales Ende (≤ 90 Tage), „Ergebnis sichtbar“ und – angekündigt, nicht umstellbar – namentlich.
 * Frage, Sichtbarkeit und „Sichtbar bis“ kommen aus `sx-post-composer`. Rein präsentational: meldet bei jeder Änderung
 * `sx-payload` { value, ok } (geprüft mit derselben Regel wie der Server); `clear()` nach dem Veröffentlichen.
 */
export class SxPollForm extends LitElement {
  static properties = {
    options: { state: true },
    multi: { state: true },
    max: { state: true },
    ends: { state: true },
    results: { state: true },
    named: { state: true },
  };
  declare options: string[];
  declare multi: boolean;
  declare max: number;
  /** Ende als `datetime-local`-Wert, leer = offen bis zum Beenden */
  declare ends: string;
  declare results: PollResults;
  declare named: boolean;

  constructor() {
    super();
    this.options = ['', ''];
    this.multi = false;
    this.max = 2;
    this.ends = '';
    this.results = 'voted';
    this.named = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-2);
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
        min-width: 0;
      }
      .opt {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--s-2);
        align-items: center;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
      label.check {
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 44px;
        cursor: pointer;
      }
      label.field {
        display: grid;
        gap: var(--s-1);
        min-width: 0;
      }
      input[type='datetime-local'] {
        width: 100%;
        min-height: max(38px, var(--control-h));
        padding: 0 var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: var(--fs-m) var(--font);
      }
      input[type='number'] {
        width: 5.5em;
      }
      .error {
        color: var(--err);
        margin: 0;
      }
      .named {
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        border: 1px solid var(--border-soft);
      }
    `,
  ];

  /** Eingaben als Einstellungen (wie der Server sie prüft) – Ende aus der Ortszeit. */
  private value(): PollConfig | { error: string; message: string } {
    const closesAt = this.ends ? new Date(this.ends).getTime() : null;
    return readPollConfig({ options: this.options, max: this.multi ? this.max : 1, closesAt, results: this.results, named: this.named }, Date.now());
  }

  updated() {
    const v = this.value();
    emit(this, 'sx-payload', 'error' in v ? { value: null, ok: false, message: v.message } : { value: v, ok: true, message: '' });
  }

  clear() {
    this.options = ['', ''];
    this.multi = false;
    this.ends = '';
    this.results = 'voted';
    this.named = false;
  }

  private setOption(i: number, v: string) {
    this.options = this.options.map((o, n) => (n === i ? v : o));
  }

  render() {
    const now = Date.now();
    const v = this.value();
    // Fehler erst zeigen, wenn alle Antworten etwas enthalten (sonst stünde er schon beim Öffnen da)
    const message = 'error' in v && this.options.every((o) => o.trim()) ? v.message : '';
    return html`<fieldset>
        <legend class="label">Antworten</legend>
        ${this.options.map(
          (o, i) => html`<div class="opt">
            <input type="text" maxlength=${POLL_LIMITS.option} .value=${o} placeholder="Antwort ${i + 1}" aria-label="Antwort ${i + 1}"
              @input=${(e: Event) => this.setOption(i, (e.target as HTMLInputElement).value)} />
            <button class="btn ghost icon" type="button" aria-label="Antwort ${i + 1} entfernen" ?disabled=${this.options.length <= POLL_LIMITS.minOptions}
              @click=${() => (this.options = this.options.filter((_, n) => n !== i))}>${icon('x')}</button>
          </div>`,
        )}
        ${this.options.length < POLL_LIMITS.maxOptions
          ? html`<div><button class="btn small" type="button" @click=${() => (this.options = [...this.options, ''])}>${icon('plus')} Antwort hinzufügen</button></div>`
          : ''}
      </fieldset>
      <div class="row">
        <label class="check"><input type="checkbox" .checked=${this.multi} @change=${(e: Event) => (this.multi = (e.target as HTMLInputElement).checked)} /> Mehrere Antworten erlaubt</label>
        ${this.multi
          ? html`<label class="check">höchstens
              <input type="number" min="2" max=${this.options.length} .value=${String(this.max)}
                @input=${(e: Event) => (this.max = Number((e.target as HTMLInputElement).value) || 2)} /></label>`
          : ''}
      </div>
      <label class="field"><span class="label">Ende (optional)</span>
        <input type="datetime-local" .value=${this.ends} min=${toLocalInput(now)} max=${toLocalInput(now + POLL_LIMITS.maxDays * 86_400_000)}
          @input=${(e: Event) => (this.ends = (e.target as HTMLInputElement).value)} />
        <span class="hint">Ohne Ende läuft sie, bis du sie beendest – höchstens ${POLL_LIMITS.maxDays} Tage im Voraus.</span></label>
      <label class="field"><span class="label">Ergebnis sichtbar</span>
        <select @change=${(e: Event) => (this.results = (e.target as HTMLSelectElement).value as PollResults)}>
          ${POLL_RESULTS.map((r) => html`<option value=${r} ?selected=${r === this.results}>${POLL_RESULTS_LABEL[r]}</option>`)}
        </select>
        <span class="hint">Du selbst siehst das Ergebnis immer.</span></label>
      <div class="named">
        <label class="check"><input type="checkbox" .checked=${this.named} @change=${(e: Event) => (this.named = (e.target as HTMLInputElement).checked)} /> Namentlich abstimmen</label>
        <p class="hint">${this.named
          ? 'Wer das Ergebnis sieht, sieht auch, wer was gewählt hat (Namen öffentlicher Profile). Das steht an der Umfrage und lässt sich später nicht ändern.'
          : 'Anonym: alle sehen nur Zahlen – auch du. Lässt sich später nicht ändern.'}</p>
      </div>
      ${message ? html`<p class="error" role="alert">${message}</p>` : ''}`;
  }
}
customElements.define('sx-poll-form', SxPollForm);
