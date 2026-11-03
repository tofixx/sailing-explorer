import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { pollModeText, pollPercent, type PollPeople, type PollView } from '../domain/polls';
import { fmtDateTime } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/** Detail der Events von `sx-poll` – `el` bekommt die Antwort (`poll`, `people`, `busy`) zurück. */
export interface PollEventDetail {
  postId: string;
  key: string | null;
  el: SxPoll;
  choices?: number[];
}

/**
 * Umfrage an der Stream-Karte (Konzept 29, F-407, F-471 … F-474): Antworten wählen (Einfach- bzw. Mehrfachauswahl),
 * Ergebnis als Balken, sobald der Betrachter es sehen darf (`counts`), eigene Wahl markiert, ändern und zurücknehmen
 * bis zum Ende, „Beenden“ für die Autor:in, bei namentlichen Umfragen „Wer hat was gewählt?“. Rein präsentational –
 * meldet `sx-poll-vote` { postId, key, el, choices }, `sx-poll-close` und `sx-poll-who`; der PollController setzt die
 * Antwort als `poll` bzw. `people`.
 */
export class SxPoll extends LitElement {
  static properties = {
    poll: { attribute: false },
    postId: { type: String, attribute: 'post-id' },
    /** Schlüssel „Nur mit Link“ (Einzelkarte) */
    shareKey: { attribute: false },
    busy: { type: Boolean },
    people: { attribute: false },
    picked: { state: true },
    editing: { state: true },
  };
  declare poll: PollView | null;
  declare postId: string;
  declare shareKey: string | null;
  declare busy: boolean;
  /** Namen je Antwort (namentlich), nach `sx-poll-who` */
  declare people: PollPeople[] | null;
  /** Auswahl vor dem Abschicken */
  declare picked: number[];
  /** Stimme ändern: Auswahl statt Ergebnis */
  declare editing: boolean;

  constructor() {
    super();
    this.poll = null;
    this.postId = '';
    this.shareKey = null;
    this.busy = false;
    this.people = null;
    this.picked = [];
    this.editing = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        margin-top: var(--s-2);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      label.choice {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 44px;
        padding: var(--s-1) var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      label.choice:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .bar {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--s-2);
        align-items: center;
        min-height: 40px;
        padding: var(--s-1) var(--s-3);
        border-radius: var(--radius);
        border: 1px solid var(--border-soft);
        overflow: hidden;
        overflow-wrap: anywhere;
      }
      .fill {
        position: absolute;
        inset: 0 auto 0 0;
        background: var(--accent-soft);
        z-index: 0;
      }
      .bar > :not(.fill) {
        position: relative;
        z-index: 1;
      }
      .bar.mine {
        border-color: var(--accent);
        font-weight: 600;
      }
      .bar svg {
        width: 14px;
        height: 14px;
        vertical-align: -2px;
      }
      .pct {
        font-variant-numeric: tabular-nums;
      }
      .who {
        font-size: var(--fs-s);
        color: var(--text-2);
        margin: 2px 0 0 var(--s-3);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-3);
        margin-top: var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        margin-top: var(--s-2);
      }
      .row .btn {
        min-height: 44px;
      }
    `,
  ];

  willUpdate(changed: PropertyValues<this>) {
    // neue Antwort vom Server: eigene Wahl übernehmen, Bearbeiten beenden
    if (changed.has('poll')) {
      this.picked = [...(this.poll?.mine ?? [])];
      this.editing = false;
    }
  }

  private detail(extra: Partial<PollEventDetail> = {}): PollEventDetail {
    return { postId: this.postId, key: this.shareKey, el: this, ...extra };
  }

  private toggle(i: number) {
    const p = this.poll!;
    if (p.max === 1) this.picked = [i];
    else if (this.picked.includes(i)) this.picked = this.picked.filter((x) => x !== i);
    else if (this.picked.length < p.max) this.picked = [...this.picked, i];
  }

  private choose() {
    const p = this.poll!;
    const multi = p.max > 1;
    return html`<ol role=${multi ? 'group' : 'radiogroup'} aria-label="Antworten">
        ${p.options.map(
          (o, i) => html`<li><label class="choice">
            <input type=${multi ? 'checkbox' : 'radio'} name="c-${this.postId}" .checked=${this.picked.includes(i)}
              ?disabled=${multi && !this.picked.includes(i) && this.picked.length >= p.max} @change=${() => this.toggle(i)} />
            <span>${o}</span></label></li>`,
        )}
      </ol>
      <div class="row">
        <button class="btn primary" type="button" ?disabled=${this.busy || !this.picked.length} @click=${() => emit(this, 'sx-poll-vote', this.detail({ choices: this.picked }))}>
          ${icon('check')} ${p.mine.length ? 'Stimme ändern' : 'Abstimmen'}</button>
        ${this.editing ? html`<button class="btn ghost" type="button" @click=${() => (this.editing = false)}>Abbrechen</button>` : ''}
      </div>`;
  }

  private results() {
    const p = this.poll!;
    const voters = p.voters ?? 0;
    return html`<ol aria-label="Ergebnis">
      ${p.options.map((o, i) => {
        const n = p.counts![i] ?? 0;
        const pct = pollPercent(n, voters);
        const names = this.people?.[i];
        return html`<li>
          <div class="bar ${p.mine.includes(i) ? 'mine' : ''}" aria-label="${o}: ${n} ${n === 1 ? 'Stimme' : 'Stimmen'}, ${pct} %">
            <span class="fill" style="width: ${pct}%"></span>
            <span>${p.mine.includes(i) ? html`${icon('check')} ` : ''}${o}</span><span class="pct">${pct} %</span>
          </div>
          ${names && (names.people.length || names.others)
            ? html`<p class="who">${names.people.map((x, k) => html`${k ? ', ' : ''}<a href="/u/${x.handle}">${x.displayName}</a>`)}${names.others
                ? `${names.people.length ? ' ' : ''}+ ${names.others} weitere`
                : ''}</p>`
            : nothing}
        </li>`;
      })}
    </ol>`;
  }

  render() {
    const p = this.poll;
    if (!p) return nothing;
    // abstimmen, solange offen und (noch) ohne Ergebnis bzw. beim Ändern; sonst das Ergebnis
    const showChoose = p.open && (this.editing || (!p.counts && !p.mine.length));
    const status = !p.open ? 'Beendet' : p.closesAt ? `Endet ${fmtDateTime(p.closesAt)}` : 'Offen';
    return html`${showChoose ? this.choose() : p.counts ? this.results() : html`<p class="muted">Danke für deine Stimme – das Ergebnis siehst du ${p.results === 'closed' ? 'nach dem Ende' : 'bald'}.</p>`}
      <div class="meta">
        <span>${pollModeText(p)}</span>
        <span>${status}</span>
        ${p.voters !== null ? html`<span>${p.voters} ${p.voters === 1 ? 'Person hat' : 'Personen haben'} abgestimmt</span>` : ''}
      </div>
      <div class="row">
        ${p.open && !showChoose
          ? p.mine.length
            ? html`<button class="btn small" type="button" ?disabled=${this.busy} @click=${() => (this.editing = true)}>Stimme ändern</button>
                <button class="btn small ghost" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-poll-vote', this.detail({ choices: [] }))}>Zurücknehmen</button>`
            : html`<button class="btn small" type="button" @click=${() => (this.editing = true)}>Abstimmen</button>`
          : ''}
        ${p.named && p.counts && !this.people && (p.voters ?? 0) > 0
          ? html`<button class="btn small ghost" type="button" @click=${() => emit(this, 'sx-poll-who', this.detail())}>Wer hat was gewählt?</button>`
          : ''}
        ${p.canClose ? html`<button class="btn small ghost" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-poll-close', this.detail())}>Umfrage beenden</button>` : ''}
      </div>`;
  }
}
customElements.define('sx-poll', SxPoll);
