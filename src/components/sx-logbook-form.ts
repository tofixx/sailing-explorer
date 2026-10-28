import { LitElement, css, html, type PropertyValues } from 'lit';
import type { Boat, HarborInput, ManualShareInput, ShareMeta, SharePatch } from '../services/api';
import {
  DIST_SOURCE_LABEL, LOG_LIMITS, SEA_LABEL, SEA_STATES, WIND_DIRS, departureError, logTitle, parseLog, plausibleDistance, routeNm,
  type LatLon, type Logbook,
} from '../domain/logbook';
import { VOYAGE_ROLES, VOYAGE_ROLE_SHORT, isVoyageRole, type VoyageRole } from '../domain/crew-roles';
import { fmtNum } from '../domain/format';
import type { Visibility } from '../domain/visibility';
import type { SxHarborPicker } from './sx-harbor-picker';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import './sx-harbor-picker';
import './sx-position-picker';
import './sx-visibility-picker';

type Pos = { lat: number; lon: number };

/** Ergebnis des Formulars: neuer Eintrag oder Änderung eines vorhandenen (`id`). */
export type LogbookSave = { input: ManualShareInput } | { id: string; patch: SharePatch };

const pad = (n: number) => String(n).padStart(2, '0');
/** Datum und Uhrzeit für <input type=date|time> in Ortszeit */
const dateOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeOf = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Ortszeit → ms; ohne Uhrzeit 12 Uhr, damit das Datum in jeder Zeitzone stimmt */
const toMs = (date: string, time: string): number => (date ? new Date(`${date}T${time || '12:00'}`).getTime() : NaN);

/**
 * Fahrtenbuch-Eintrag ohne GPX anlegen oder bearbeiten (Konzept 19, F-300/F-301): Datum, Start- und Zielhafen, Strecke,
 * Boot; aufklappbar Ankunft, Rolle, Wind, Seegang, Motor, Segelführung, Liegeplatz, Notizen; Titel und Sichtbarkeit.
 * Fehlt einem Hafen die Position, fragt eine kleine Karte danach (L3). Prüft wie der Server vorab (F-304) und meldet
 * `sx-logbook-save` (LogbookSave) bzw. `sx-logbook-close`. Fetcht nicht selbst – Häfen sucht die Verdrahtung.
 */
export class SxLogbookForm extends LitElement {
  static properties = {
    open: { type: Boolean },
    share: { attribute: false },
    boats: { attribute: false },
    supporter: { type: Boolean },
    used: { type: Number },
    max: { type: Number },
    busy: { type: Boolean },
    error: { type: String },
    fromPos: { state: true },
    toPos: { state: true },
    roundTrip: { state: true },
    visibility: { state: true },
    local: { state: true },
  };
  declare open: boolean;
  /** vorhandener Eintrag (Bearbeiten) oder null (neu) */
  declare share: ShareMeta | null;
  declare boats: Boat[];
  declare supporter: boolean;
  /** Einträge der laufenden Saison und Grenze (L1) – -1 = unbekannt */
  declare used: number;
  declare max: number;
  declare busy: boolean;
  declare error: string;
  /** von Hand gesetzte Positionen für Häfen ohne Position */
  declare fromPos: Pos | null;
  declare toPos: Pos | null;
  declare roundTrip: boolean;
  declare visibility: Visibility;
  /** Fehler aus der Prüfung im Browser */
  declare local: string;

  constructor() {
    super();
    this.open = false;
    this.share = null;
    this.boats = [];
    this.supporter = false;
    this.used = -1;
    this.max = LOG_LIMITS.perSeason;
    this.busy = false;
    this.error = '';
    this.fromPos = null;
    this.toPos = null;
    this.roundTrip = false;
    this.visibility = 'public';
    this.local = '';
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(560px, calc(100vw - 32px));
      }
      form {
        display: grid;
        gap: var(--s-3);
      }
      .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--s-2);
      }
      input,
      select,
      textarea {
        width: 100%;
        box-sizing: border-box;
        font: inherit;
        padding: var(--s-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
      }
      input:focus,
      select:focus,
      textarea:focus {
        border-color: var(--accent);
        outline: none;
        box-shadow: var(--focus);
      }
      textarea {
        min-height: 80px;
        resize: vertical;
      }
      .check {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        font-size: var(--fs-s);
      }
      .check input {
        width: auto;
      }
      details {
        border-top: 1px solid var(--border-soft);
        padding-top: var(--s-2);
      }
      details[open] {
        display: grid;
        gap: var(--s-3);
      }
      summary {
        cursor: pointer;
        font-weight: 600;
        font-size: var(--fs-s);
      }
      .foot {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        justify-content: space-between;
        flex-wrap: wrap;
      }
      @media (max-width: 480px) {
        .row {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  protected updated(changed: PropertyValues<this>): void {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) {
        this.reset();
        dlg.showModal();
      } else if (!this.open && dlg.open) dlg.close();
    }
  }

  private reset() {
    const s = this.share;
    this.fromPos = null;
    this.toPos = null;
    this.local = '';
    this.roundTrip = !!s && !!s.from && s.from.slug === s.to?.slug;
    this.visibility = s?.visibility ?? 'public';
  }

  private picker = (id: string) => this.renderRoot.querySelector<SxHarborPicker>(`#${id}`);
  private field = (name: string) => (this.renderRoot.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '').trim();

  /** Position eines Hafens: bekannt, von Hand gesetzt oder fehlt (null). */
  private pos(which: 'from' | 'to'): Pos | null {
    return (which === 'from' ? this.fromPos : this.toPos) ?? this.picker(which)?.position ?? null;
  }

  /** Braucht der Hafen eine Position von Hand? (gewählt, aber ohne bekannte Position) */
  private needsPos(which: 'from' | 'to'): boolean {
    const c = this.picker(which)?.choice;
    return !!c && !('harborId' in c && c.harborId === null) && !this.picker(which)?.position;
  }

  private harbor(which: 'from' | 'to'): HarborInput | null {
    const c = this.picker(which)?.choice;
    if (!c || ('harborId' in c && c.harborId === null)) return null;
    const p = which === 'from' ? this.fromPos : this.toPos;
    return { ...c, ...(p ?? {}) } as HarborInput;
  }

  private route(): LatLon[] {
    const a = this.pos('from');
    const b = this.roundTrip ? null : this.pos('to');
    return [a, b].filter((p): p is Pos => !!p).map((p) => [p.lat, p.lon]);
  }

  private titleSuggestion(): string {
    const from = this.picker('from')?.text ?? '';
    return logTitle(from, this.roundTrip ? from : (this.picker('to')?.text ?? ''));
  }

  private log(): Logbook | string {
    const bft = this.field('bft');
    const r = parseLog({
      engineH: this.field('engineH').replace(',', '.'),
      wind: bft === '' ? undefined : { bft: Number(bft), dir: this.field('dir') || null },
      sea: this.field('sea'),
      sails: this.field('sails'),
      berth: this.field('berth'),
      notes: this.renderRoot.querySelector<HTMLTextAreaElement>('[name="notes"]')?.value ?? '',
    });
    return 'error' in r ? r.error : r.log;
  }

  private submit(e: Event) {
    e.preventDefault();
    this.local = '';
    const startedAt = toMs(this.field('date'), this.field('time'));
    const endDate = this.field('endDate');
    const endedAt = endDate || this.field('endTime') ? toMs(endDate || this.field('date'), this.field('endTime')) : null;
    // mit Uhrzeiten nur, wenn beide Zeiten (soweit es eine Ankunft gibt) eine Uhrzeit haben
    const timed = !!this.field('time') && (endedAt === null || !!this.field('endTime'));
    const from = this.harbor('from');
    const to = this.roundTrip ? null : this.harbor('to');
    const rawDist = this.field('dist').replace(',', '.');
    const distNm = rawDist === '' ? null : Number(rawDist);
    const log = this.log();
    const route = this.route();
    const lineNm = route.length > 1 ? routeNm(route) : 0;
    const problem =
      departureError(startedAt, Date.now()) ??
      (!from ? 'Bitte den Starthafen angeben.' : null) ??
      (!route.length ? 'Wo liegt der Hafen? Bitte die Position auf der Karte setzen.' : null) ??
      (typeof log === 'string' ? log : null) ??
      plausibleDistance({ distNm: distNm ?? Math.round(lineNm * 10) / 10, routeNm: lineNm, startedAt, endedAt, hasTime: timed });
    if (problem) {
      this.local = problem;
      return;
    }
    const role = this.field('role');
    const boatId = this.field('boat') || null;
    const title = this.field('title');
    if (this.share) {
      const patch: SharePatch = {
        startedAt, endedAt, timed, distNm, log: log as Logbook, boatId, visibility: this.visibility,
        ...(title ? { title } : {}),
        ...(from ? { fromHarbor: from } : {}),
        toHarbor: to,
      };
      emit<LogbookSave>(this, 'sx-logbook-save', { id: this.share.id, patch });
      return;
    }
    const input: ManualShareInput = {
      startedAt, endedAt, timed, fromHarbor: from!, toHarbor: to, distNm, boatId, visibility: this.visibility, log: log as Logbook,
      ...(title ? { title } : {}),
      ...(isVoyageRole(role) ? { ownerRole: role as VoyageRole } : {}),
    };
    emit<LogbookSave>(this, 'sx-logbook-save', { input });
  }

  private close = () => emit(this, 'sx-logbook-close');

  private positionFor(which: 'from' | 'to', label: string) {
    if (!this.needsPos(which)) return '';
    const other = this.pos(which === 'from' ? 'to' : 'from');
    const value = which === 'from' ? this.fromPos : this.toPos;
    return html`<div>
      <p class="hint">${icon('map')} Wo liegt ${label}? Auf die Karte klicken${value ? ` – gesetzt (${fmtNum(value.lat, 4)}, ${fmtNum(value.lon, 4)})` : ''}.</p>
      <sx-position-picker
        label="Position von ${label}"
        .value=${value}
        .near=${other}
        @sx-position=${(e: CustomEvent<Pos>) => (which === 'from' ? (this.fromPos = e.detail) : (this.toPos = e.detail))}
      ></sx-position-picker>
    </div>`;
  }

  private distHint() {
    const route = this.route();
    if (route.length < 2) return '';
    return html`<p class="hint">Direkte Linie: ${fmtNum(routeNm(route), 1)} sm – leer lassen, um sie zu übernehmen.</p>`;
  }

  private form() {
    const s = this.share;
    const log = s?.log ?? {};
    const timed = !!log.timed;

    const rerender = () => this.requestUpdate();
    return html`<form @submit=${this.submit} @sx-harbor-change=${rerender} @input=${rerender}>
      <div class="row">
        <div>
          <label class="label" for="lf-date">Datum</label>
          <input id="lf-date" name="date" type="date" required .value=${s?.startedAt ? dateOf(s.startedAt) : dateOf(Date.now())} />
        </div>
        <div>
          <label class="label" for="lf-time">Abfahrt <span class="faint">(optional)</span></label>
          <input id="lf-time" name="time" type="time" .value=${s?.startedAt && timed ? timeOf(s.startedAt) : ''} />
        </div>
      </div>
      <div>
        <label class="label" for="from-input">Von</label>
        <sx-harbor-picker id="from" input-id="from-input" label="Von (Starthafen)" .value=${s?.from ?? null}></sx-harbor-picker>
        ${this.positionFor('from', 'der Starthafen')}
      </div>
      <label class="check"><input type="checkbox" .checked=${this.roundTrip} @change=${(e: Event) => (this.roundTrip = (e.target as HTMLInputElement).checked)} /> zurück nach Von (Rundtörn)</label>
      ${this.roundTrip
        ? ''
        : html`<div>
            <label class="label" for="to-input">Nach</label>
            <sx-harbor-picker id="to" input-id="to-input" label="Nach (Zielhafen)" .value=${s?.to ?? null}></sx-harbor-picker>
            ${this.positionFor('to', 'der Zielhafen')}
          </div>`}
      <div>
        <label class="label" for="lf-dist">Strecke (sm)${s?.distSource && s.distSource !== 'track' ? html` <span class="faint">· bisher ${DIST_SOURCE_LABEL[s.distSource]}</span>` : ''}</label>
        <input id="lf-dist" name="dist" inputmode="decimal" placeholder="z. B. 14,2" .value=${s && s.distSource === 'stated' ? String(s.distNm).replace('.', ',') : ''} />
        ${this.distHint()}
      </div>
      ${this.boats.length
        ? html`<div>
            <label class="label" for="lf-boat">Boot</label>
            <select id="lf-boat" name="boat">
              <option value="">– kein Boot –</option>
              ${this.boats.map((b) => html`<option value=${b.id} ?selected=${s?.boat?.id === b.id}>${b.name}</option>`)}
            </select>
          </div>`
        : ''}
      <details ?open=${!!s && Object.keys(log).some((k) => k !== 'timed')}>
        <summary>Mehr Angaben</summary>
        <div class="row">
          <div>
            <label class="label" for="lf-end">Ankunft (Datum)</label>
            <input id="lf-end" name="endDate" type="date" .value=${s?.endedAt ? dateOf(s.endedAt) : ''} />
          </div>
          <div>
            <label class="label" for="lf-endt">Ankunft (Uhrzeit)</label>
            <input id="lf-endt" name="endTime" type="time" .value=${s?.endedAt && timed ? timeOf(s.endedAt) : ''} />
          </div>
        </div>
        ${s
          ? ''
          : html`<div>
              <label class="label" for="lf-role">Deine Rolle an Bord</label>
              <select id="lf-role" name="role">
                <option value="">– keine Angabe –</option>
                ${VOYAGE_ROLES.map((r) => html`<option value=${r}>${VOYAGE_ROLE_SHORT[r]}</option>`)}
              </select>
            </div>`}
        <div class="row">
          <div>
            <label class="label" for="lf-bft">Wind (Bft)</label>
            <select id="lf-bft" name="bft">
              <option value="">–</option>
              ${Array.from({ length: LOG_LIMITS.bftMax + 1 }, (_, b) => html`<option value=${b} ?selected=${log.wind?.bft === b}>${b}</option>`)}
            </select>
          </div>
          <div>
            <label class="label" for="lf-dir">aus</label>
            <select id="lf-dir" name="dir">
              <option value="">–</option>
              ${WIND_DIRS.map((d) => html`<option value=${d} ?selected=${log.wind?.dir === d}>${d}</option>`)}
            </select>
          </div>
        </div>
        <div class="row">
          <div>
            <label class="label" for="lf-sea">Seegang</label>
            <select id="lf-sea" name="sea">
              <option value="">–</option>
              ${SEA_STATES.map((x) => html`<option value=${x} ?selected=${log.sea === x}>${SEA_LABEL[x]}</option>`)}
            </select>
          </div>
          <div>
            <label class="label" for="lf-eng">Motor (h)</label>
            <input id="lf-eng" name="engineH" inputmode="decimal" placeholder="0,5" .value=${log.engineH != null ? String(log.engineH).replace('.', ',') : ''} />
          </div>
        </div>
        <div>
          <label class="label" for="lf-sails">Segelführung</label>
          <input id="lf-sails" name="sails" maxlength=${LOG_LIMITS.sailsMax} placeholder="Groß 1. Reff, Fock" .value=${log.sails ?? ''} />
        </div>
        <div>
          <label class="label" for="lf-berth">Liegeplatz</label>
          <input id="lf-berth" name="berth" maxlength=${LOG_LIMITS.berthMax} placeholder="Steg B, Box 12" .value=${log.berth ?? ''} />
          <p class="hint">Sichtbar für alle, die den Törn sehen.</p>
        </div>
        <div>
          <label class="label" for="lf-notes">Notizen</label>
          <textarea id="lf-notes" name="notes" maxlength=${LOG_LIMITS.notesMax} .value=${log.notes ?? ''}></textarea>
        </div>
      </details>
      <div>
        <label class="label" for="lf-title">Titel</label>
        <input id="lf-title" name="title" maxlength="120" placeholder=${this.titleSuggestion()} .value=${s?.title ?? ''} />
      </div>
      <sx-visibility-picker
        .value=${this.visibility}
        .supporter=${this.supporter}
        .current=${s?.visibility ?? null}
        @sx-visibility-change=${(e: CustomEvent<{ value: Visibility }>) => (this.visibility = e.detail.value)}
      ></sx-visibility-picker>
      ${this.local || this.error ? html`<p class="error" role="alert">${this.local || this.error}</p>` : ''}
      <div class="foot">
        <span class="hint">${!s && this.used >= 0 ? `${this.used} von ${this.max} Fahrtenbuch-Einträgen in dieser Saison` : ''}</span>
        <span class="actions">
          <button class="btn" type="button" @click=${this.close}>Abbrechen</button>
          <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('book')} Speichern</button>
        </span>
      </div>
    </form>`;
  }

  render() {
    return html`<dialog aria-labelledby="lf-h" @close=${this.close}>
      <header>
        <h2 id="lf-h">${this.share ? 'Fahrtenbuch-Eintrag bearbeiten' : 'Törn ins Fahrtenbuch eintragen'}</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <div class="body">
        ${this.share ? '' : html`<p class="muted">Ohne GPX-Datei: Strecke und Angaben wie im Logbuch. Der Törn erscheint als „Fahrtenbuch“, nicht als aufgezeichneter Track.</p>`}
        ${this.open ? this.form() : ''}
      </div>
    </dialog>`;
  }
}
customElements.define('sx-logbook-form', SxLogbookForm);
