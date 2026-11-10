import { LitElement, css, html, type PropertyValues } from 'lit';
import type { Boat, HarborInput, ManualShareInput, ShareMeta, SharePatch } from '../services/api';
import {
  DIST_SOURCE_LABEL, LOG_AREAS, LOG_AREA_LABEL, LOG_LIMITS, SEA_LABEL, SEA_STATES, WIND_DIRS, departureError, fieldInArea, logTitle, parseLog,
  plausibleDistance, routeNm, type LatLon, type LogArea, type LogItem, type Logbook,
} from '../domain/logbook';
import type { LogSuggestion } from '../domain/logbook-suggest';
import { VOYAGE_ROLES, VOYAGE_ROLE_SHORT, isVoyageRole, type VoyageRole } from '../domain/crew-roles';
import { fmtNum } from '../domain/format';
import { SCORING_NOTE, defaultTemplateId, templateItemNames, templateLabel, type ScoringTemplate } from '../domain/scoring';
import type { Visibility } from '../domain/visibility';
import type { LogbookPreset } from '../domain/events';
import type { SxHarborPicker } from './sx-harbor-picker';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import './sx-harbor-picker';
import './sx-place-picker';
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

/** Zahl für ein Eingabefeld (Komma), leer ohne Wert. */
const numValue = (v: number | undefined | null) => (v == null ? '' : String(v).replace('.', ','));

/**
 * Fahrtenbuch-Eintrag ohne GPX anlegen oder bearbeiten (Konzept 19, F-300/F-301): Datum, Start- und Zielhafen, Strecke,
 * Boot; aufklappbar Ankunft, Rolle, Wind, Seegang, Segelführung, Liegeplatz, Notizen; Zusatzangaben mit Revier,
 * Stunden, Regatta und Posten (Konzept 27.4, F-412); Titel und Sichtbarkeit. Für GPX-Törns (F-461) nur Häfen und Angaben
 * – Datum und Strecke kommen aus dem Track, Titel und Sichtbarkeit ändert der Teilen-Dialog; Vorschläge aus dem Track
 * (`suggestion`, F-460) übernimmt erst ein Klick. Fehlt einem Hafen die Position, fragt eine kleine Karte danach (L3).
 * Prüft wie der Server vorab (F-304) und meldet `sx-logbook-save` (LogbookSave) bzw. `sx-logbook-close`. Fetcht nicht
 * selbst – Häfen sucht die Verdrahtung.
 */
export class SxLogbookForm extends LitElement {
  static properties = {
    open: { type: Boolean },
    share: { attribute: false },
    preset: { attribute: false },
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
    suggestion: { attribute: false },
    area: { state: true },
    items: { state: true },
    filled: { state: true },
    templates: { attribute: false },
    lastTemplateId: { attribute: false },
  };
  declare open: boolean;
  /** vorhandener Eintrag (Bearbeiten) oder null (neu) */
  declare share: ShareMeta | null;
  /** neuer Eintrag aus einer Veranstaltung (Konzept 30, F-487): Datum, Titel, Verweis */
  declare preset: LogbookPreset | null;
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
  /** Vorschlag aus dem Track (nur GPX-Törns) */
  declare suggestion: LogSuggestion | null;
  /** gewähltes Revier (schaltet Felder um, B10) – '' = keine Angabe */
  declare area: LogArea | '';
  /** Posten (B10), bearbeitbar als Liste */
  declare items: LogItem[];
  /** per „Übernehmen“ gesetzte Vorschläge */
  declare filled: Partial<Logbook>;
  /** wählbare Wertungsvorlagen (Konzept 32, F-501) – leer ohne Verein bzw. solange nicht geladen: kein Feld */
  declare templates: ScoringTemplate[];
  /** zuletzt genutzte Vorlage (Vorbelegung) */
  declare lastTemplateId: string | null;

  constructor() {
    super();
    this.open = false;
    this.share = null;
    this.preset = null;
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
    this.suggestion = null;
    this.area = '';
    this.items = [];
    this.filled = {};
    this.templates = [];
    this.lastTemplateId = null;
  }

  /** GPX-Törn: nur Häfen und Angaben (F-461). */
  private get gpx(): boolean {
    return !!this.share && this.share.source !== 'manual';
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
      .areas {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-3);
        border: 0;
        margin: 0;
        padding: 0;
      }
      .areas label {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        min-height: 44px;
        font-size: var(--fs-s);
      }
      .areas input {
        width: auto;
      }
      .item {
        display: grid;
        grid-template-columns: 2fr 1fr auto;
        gap: var(--s-2);
        align-items: end;
      }
      .item .note {
        grid-column: 1 / -1;
      }
      .suggest {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s-2);
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        background: var(--surface-2);
        font-size: var(--fs-s);
      }
      @media (max-width: 480px) {
        .row {
          grid-template-columns: 1fr;
        }
        .item {
          grid-template-columns: 1fr auto;
        }
        .item .name {
          grid-column: 1 / -1;
        }
      }
    `,
  ];

  /** Beim Öffnen den Zustand aus dem Eintrag setzen – vor dem Rendern, damit kein zweiter Durchlauf nötig ist. */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open) this.reset();
  }

  protected updated(changed: PropertyValues<this>): void {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) dlg.showModal();
      else if (!this.open && dlg.open) dlg.close();
    }
    // Vorbelegung der Vorlage beim Öffnen bzw. wenn die Vorlagen nachkommen (F-501) – danach gilt die Wahl im Formular
    const sel = this.renderRoot.querySelector<HTMLSelectElement>('select[name="templateId"]');
    if (sel && this.open && (changed.has('open') || changed.has('templates') || changed.has('lastTemplateId'))) {
      sel.value = defaultTemplateId(this.share?.log?.templateId, this.lastTemplateId, this.templates);
    }
  }

  private reset() {
    const s = this.share;
    this.fromPos = null;
    this.toPos = null;
    this.local = '';
    this.roundTrip = !!s && !!s.from && s.from.slug === s.to?.slug;
    this.visibility = s?.visibility ?? 'public';
    // neuer Eintrag aus einer Veranstaltung (F-487): Zusatzangaben der Vorlage (Regatta, Posten)
    const l = s ? s.log : this.preset?.log;
    this.area = l?.area ?? '';
    this.items = (l?.items ?? []).map((it) => ({ ...it }));
    this.filled = {};
  }

  private picker = (id: string) => this.renderRoot.querySelector<SxHarborPicker>(`#${id}`);
  private field = (name: string) => (this.renderRoot.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '').trim();

  /** Position eines Hafens: bekannt, von Hand gesetzt oder fehlt (null). */
  private pos(which: 'from' | 'to'): Pos | null {
    return (which === 'from' ? this.fromPos : this.toPos) ?? this.picker(which)?.position ?? null;
  }

  /**
   * Braucht ein vorhandener Hafen eine Position von Hand (L3)? Neue Häfen fragt der Hafen-Picker selbst nach ihrer Lage
   * (F-353).
   */
  private needsPos(which: 'from' | 'to'): boolean {
    const c = this.picker(which)?.choice;
    return !!c && 'harborId' in c && !!c.harborId && !this.picker(which)?.position;
  }

  private harbor(which: 'from' | 'to'): HarborInput | null {
    const c = this.picker(which)?.choice;
    if (!c) return null;
    if ('name' in c) return { name: c.name, ...(c.pos ?? {}) };
    if (!c.harborId) return null;
    const p = which === 'from' ? this.fromPos : this.toPos;
    return { harborId: c.harborId, ...(p ?? {}) };
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
    const regatta = this.field('regattaName');
    const r = parseLog({
      engineH: this.field('engineH').replace(',', '.'),
      wind: bft === '' ? undefined : { bft: Number(bft), dir: this.field('dir') || null },
      sea: this.field('sea'),
      sails: this.field('sails'),
      berth: this.field('berth'),
      notes: this.renderRoot.querySelector<HTMLTextAreaElement>('[name="notes"]')?.value ?? '',
      // Verweis auf die Veranstaltung (F-487) – beim Bearbeiten erhalten
      eventId: this.share ? this.share.log?.eventId : this.preset?.eventId,
      // Zusatzangaben (F-412); Felder anderer Reviere stehen nicht im Formular und verwirft parseLog ohnehin
      area: this.area,
      tidal: this.renderRoot.querySelector<HTMLInputElement>('[name="tidal"]')?.checked === true,
      sailH: this.field('sailH'),
      nightH: this.field('nightH'),
      daysAboard: this.field('daysAboard'),
      locks: this.field('locks'),
      bridges: this.field('bridges'),
      mast: this.field('mast'),
      upstreamNm: this.field('upstreamNm'),
      regatta: regatta ? { name: regatta, place: this.field('regattaPlace'), starters: this.field('regattaStarters') } : undefined,
      items: this.items,
      // ohne Feld (kein Verein, Vorlagen nicht geladen) bleibt die Vorlage des Eintrags unverändert (F-501)
      templateId: this.templates.length ? this.field('templateId') : this.share?.log?.templateId,
    });
    return 'error' in r ? r.error : r.log;
  }

  /** GPX-Törn: nur Häfen und Angaben (Datum und Strecke aus dem Track, 409 `not_manual`). */
  private submitGpx() {
    const log = this.log();
    if (typeof log === 'string') {
      this.local = log;
      return;
    }
    const from = this.harbor('from');
    emit<LogbookSave>(this, 'sx-logbook-save', {
      id: this.share!.id,
      patch: { log, fromHarbor: from, toHarbor: this.roundTrip ? from : this.harbor('to') },
    });
  }

  private submit(e: Event) {
    e.preventDefault();
    this.local = '';
    if (this.gpx) return this.submitGpx();
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
      <sx-place-picker
        label="Wo liegt ${label}? Auf der Karte antippen"
        .value=${value ?? other}
        @sx-place-pick=${(e: CustomEvent<Pos>) => (which === 'from' ? (this.fromPos = e.detail) : (this.toPos = e.detail))}
      ></sx-place-picker>
    </div>`;
  }

  private distHint() {
    const route = this.route();
    if (route.length < 2) return '';
    return html`<p class="hint">Direkte Linie: ${fmtNum(routeNm(route), 1)} sm – leer lassen, um sie zu übernehmen.</p>`;
  }

  /** Vorschlag aus dem Track (F-460): Werte nennen, „Übernehmen“ füllt die Felder – gespeichert wird erst mit „Speichern“. */
  private suggestBox() {
    const g = this.suggestion;
    if (!g || g.sailH === null) return '';
    const parts = [
      `${fmtNum(g.sailH, 1)} h unter Segel`,
      `${fmtNum(g.engineH ?? 0, 1)} h Motor`,
      g.nightH ? `${fmtNum(g.nightH, 1)} h Nacht` : '',
      g.daysAboard ? `${g.daysAboard} ${g.daysAboard === 1 ? 'Tag' : 'Tage'} an Bord` : '',
    ].filter(Boolean);
    const apply = () => {
      // Nullwerte (kein Motor, keine Nacht) bleiben leer statt „0 h“
      this.filled = { sailH: g.sailH ?? undefined, engineH: g.engineH || undefined, daysAboard: g.daysAboard ?? undefined, nightH: g.nightH || undefined };
      // Nachtfahrt gibt es nur an der Küste – ohne Revier ist sie dort am wahrscheinlichsten
      if (g.nightH && !this.area) this.area = 'coastal';
    };
    return html`<div class="suggest" role="note">
      <span>${icon('info')} Vorschlag aus dem Track: ${parts.join(' · ')}</span>
      <button class="btn small" type="button" @click=${apply}>${icon('check')} Übernehmen</button>
    </div>`;
  }

  /** Zahlfeld der Zusatzangaben – Wert aus „Übernehmen“ geht dem gespeicherten vor. */
  private numField(name: 'sailH' | 'engineH' | 'nightH' | 'daysAboard' | 'locks' | 'bridges' | 'mast' | 'upstreamNm', label: string, log: Logbook, placeholder = '') {
    const v = (this.filled[name] ?? log[name]) as number | undefined;
    return html`<div>
      <label class="label" for="lf-${name}">${label}</label>
      <input id="lf-${name}" name=${name} inputmode="decimal" placeholder=${placeholder} .value=${numValue(v)} />
    </div>`;
  }

  private setItem(i: number, patch: Partial<LogItem>) {
    this.items = this.items.map((it, k) => (k === i ? { ...it, ...patch } : it));
  }

  /** Posten (B10): Name, Anzahl, Begründung – höchstens zehn. */
  private itemsBlock() {
    return html`<div>
      <span class="label">Posten <span class="faint">(z. B. Training, Arbeitsdienst, Überführung)</span></span>
      ${this.items.map(
        (it, i) => html`<div class="item">
          <div class="name">
            <label class="label" for="lf-in-${i}">Posten ${i + 1}</label>
            <input id="lf-in-${i}" list="lf-item-names" maxlength=${LOG_LIMITS.itemNameMax} .value=${it.name} @input=${(e: Event) => this.setItem(i, { name: (e.target as HTMLInputElement).value })} />
          </div>
          <div>
            <label class="label" for="lf-ic-${i}">Anzahl</label>
            <input id="lf-ic-${i}" inputmode="decimal" .value=${numValue(it.n)}
              @input=${(e: Event) => this.setItem(i, { n: (e.target as HTMLInputElement).value.replace(',', '.') as unknown as number })} />
          </div>
          <button class="btn ghost icon" type="button" aria-label="Posten ${i + 1} entfernen" @click=${() => (this.items = this.items.filter((_, k) => k !== i))}>${icon('trash')}</button>
          <div class="note">
            <label class="label" for="lf-ib-${i}">Begründung <span class="faint">(optional)</span></label>
            <input id="lf-ib-${i}" maxlength=${LOG_LIMITS.itemNoteMax} .value=${it.note ?? ''} @input=${(e: Event) => this.setItem(i, { note: (e.target as HTMLInputElement).value })} />
          </div>
        </div>`,
      )}
      ${this.items.length < LOG_LIMITS.itemsMax
        ? html`<button class="btn small" type="button" @click=${() => (this.items = [...this.items, { name: '', n: 1 }])}>${icon('plus')} Posten</button>`
        : ''}
      <datalist id="lf-item-names">${templateItemNames(this.templates).map((n) => html`<option value=${n}></option>`)}</datalist>
    </div>`;
  }

  /** Zusatzangaben (Konzept 27.4, F-412): Revier schaltet die Felder um (B10). */
  private extras(log: Logbook) {
    const area = this.area || undefined;
    const r = log.regatta;
    return html`<details ?open=${!!this.suggestion || !!(log.area || log.sailH != null || log.items?.length || log.regatta || log.daysAboard)}>
      <summary>Zusatzangaben (Revier, Stunden, Posten)</summary>
      ${this.suggestBox()}
      <fieldset class="areas">
        <legend class="label">Revier</legend>
        ${(['', ...LOG_AREAS] as const).map(
          (a) => html`<label><input type="radio" name="area" .checked=${this.area === a} @change=${() => (this.area = a)} /> ${a ? LOG_AREA_LABEL[a] : 'keine Angabe'}</label>`,
        )}
      </fieldset>
      <div class="row">${this.numField('sailH', 'Unter Segel (h)', log, '3,5')} ${this.numField('engineH', 'Unter Motor (h)', log, '0,5')}</div>
      ${this.numField('daysAboard', 'Tage an Bord', log, '1')}
      ${fieldInArea('nightH', area)
        ? html`<div class="row">
            ${this.numField('nightH', 'Nachtfahrt (h)', log)}
            <label class="check"><input type="checkbox" name="tidal" .checked=${!!log.tidal} /> Tidengewässer</label>
          </div>`
        : ''}
      ${fieldInArea('locks', area)
        ? html`<div class="row">${this.numField('locks', 'Schleusen', log)} ${this.numField('bridges', 'Brücken', log)}</div>
            <div class="row">${this.numField('mast', 'Mast gelegt/gestellt (legen + stellen = 1)', log)} ${this.numField('upstreamNm', 'Gegen den Strom (sm)', log)}</div>
            <p class="hint">Gegen den Strom: davon unter Segel/gepaddelt gegen den Strom (ab 5 km/h), 1 km ≈ 0,54 sm.</p>`
        : ''}
      <div>
        <label class="label" for="lf-regattaName">Regatta <span class="faint">(optional)</span></label>
        <input id="lf-regattaName" name="regattaName" maxlength=${LOG_LIMITS.regattaNameMax} placeholder="Name der Regatta" .value=${r?.name ?? ''} />
      </div>
      ${this.field('regattaName') || r
        ? html`<div class="row">
            <div><label class="label" for="lf-rp">Platz</label><input id="lf-rp" name="regattaPlace" inputmode="numeric" .value=${numValue(r?.place)} /></div>
            <div><label class="label" for="lf-rs">Starter</label><input id="lf-rs" name="regattaStarters" inputmode="numeric" .value=${numValue(r?.starters)} /></div>
          </div>`
        : ''}
      ${this.itemsBlock()}
      <p class="hint">Alles sind deine Angaben – sie stehen im Fahrtenbuch und im Meilennachweis.</p>
    </details>`;
  }

  /**
   * Wertungsvorlage (Pflicht, F-501) – nur für Mitglieder eines Vereins (dann sind Vorlagen geladen): immer genau eine
   * gewählt, vorbelegt mit der des Eintrags, sonst der zuletzt genutzten, sonst „Nur Meilen“.
   */
  private templateSelect(log: Logbook) {
    if (!this.templates.length) return '';
    const chosen = defaultTemplateId(log.templateId, this.lastTemplateId, this.templates);
    return html`<div>
      <label class="label" for="lf-tpl">Wertungsvorlage</label>
      <select id="lf-tpl" name="templateId" required>
        ${this.templates.map((t) => html`<option value=${t.id} ?selected=${t.id === chosen}>${templateLabel(t)}</option>`)}
      </select>
      <p class="hint">Für Punkte im Jahresbericht und in der Vereinsliste. ${SCORING_NOTE}</p>
    </div>`;
  }

  private form() {
    const s = this.share;
    const p = s ? null : this.preset;
    const log = s?.log ?? p?.log ?? {};
    const timed = !!log.timed;
    const gpx = this.gpx;

    const rerender = () => this.requestUpdate();
    return html`<form @submit=${this.submit} @sx-harbor-change=${rerender} @input=${rerender}>
      ${gpx
        ? html`<p class="muted">Datum, Uhrzeit und Strecke kommen aus dem Track. Titel und Sichtbarkeit änderst du über „Teilen“.</p>`
        : html`<div class="row">
            <div>
              <label class="label" for="lf-date">Datum</label>
              <input id="lf-date" name="date" type="date" required .value=${dateOf(s?.startedAt ?? p?.startedAt ?? Date.now())} />
            </div>
            <div>
              <label class="label" for="lf-time">Abfahrt <span class="faint">(optional)</span></label>
              <input id="lf-time" name="time" type="time" .value=${s?.startedAt && timed ? timeOf(s.startedAt) : ''} />
            </div>
          </div>`}
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
      ${gpx
        ? ''
        : html`<div>
            <label class="label" for="lf-dist">Strecke (sm)${s?.distSource && s.distSource !== 'track' ? html` <span class="faint">· bisher ${DIST_SOURCE_LABEL[s.distSource]}</span>` : ''}</label>
            <input id="lf-dist" name="dist" inputmode="decimal" placeholder="z. B. 14,2" .value=${s && s.distSource === 'stated' ? String(s.distNm).replace('.', ',') : ''} />
            ${this.distHint()}
          </div>`}
      ${this.boats.length && !gpx
        ? html`<div>
            <label class="label" for="lf-boat">Boot</label>
            <select id="lf-boat" name="boat">
              <option value="">– kein Boot –</option>
              ${this.boats.map((b) => html`<option value=${b.id} ?selected=${s?.boat?.id === b.id}>${b.name}</option>`)}
            </select>
          </div>`
        : ''}
      ${this.templateSelect(log)}
      <details ?open=${!!s && !!(log.wind || log.sea || log.sails || log.berth || log.notes || (!gpx && s.endedAt))}>
        <summary>Mehr Angaben</summary>
        ${gpx
          ? ''
          : html`<div class="row">
              <div>
                <label class="label" for="lf-end">Ankunft (Datum)</label>
                <input id="lf-end" name="endDate" type="date" .value=${s?.endedAt ? dateOf(s.endedAt) : ''} />
              </div>
              <div>
                <label class="label" for="lf-endt">Ankunft (Uhrzeit)</label>
                <input id="lf-endt" name="endTime" type="time" .value=${s?.endedAt && timed ? timeOf(s.endedAt) : ''} />
              </div>
            </div>`}
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
            <label class="label" for="lf-bft">Wind (max. Bft)</label>
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
        <div>
          <label class="label" for="lf-sea">Seegang</label>
          <select id="lf-sea" name="sea">
            <option value="">–</option>
            ${SEA_STATES.map((x) => html`<option value=${x} ?selected=${log.sea === x}>${SEA_LABEL[x]}</option>`)}
          </select>
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
      ${this.extras(log)}
      ${gpx
        ? ''
        : html`<div>
              <label class="label" for="lf-title">Titel</label>
              <input id="lf-title" name="title" maxlength="120" placeholder=${this.titleSuggestion()} .value=${s?.title ?? p?.title ?? ''} />
            </div>
            <sx-visibility-picker
              .value=${this.visibility}
              .supporter=${this.supporter}
              .current=${s?.visibility ?? null}
              @sx-visibility-change=${(e: CustomEvent<{ value: Visibility }>) => (this.visibility = e.detail.value)}
            ></sx-visibility-picker>`}
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
        <h2 id="lf-h">${this.gpx ? 'Fahrtenbuch-Angaben' : this.share ? 'Fahrtenbuch-Eintrag bearbeiten' : 'Törn ins Fahrtenbuch eintragen'}</h2>
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
