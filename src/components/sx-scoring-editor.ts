import { LitElement, css, html, type PropertyValues } from 'lit';
import {
  BASE_RULES, RULE_FIELDS, RULE_GROUPS, SCORING_LIMITS, SCORING_NOTE, UNIT_LABEL, fieldLabel, parseRules, templateName, listWeight,
  type RuleField, type ScoringItemRule, type ScoringRules, type ScoringTemplate, type ScoringUnit,
} from '../domain/scoring';
import { boatClassOptions } from './boat-class-options';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

/** Ergebnis des Formulars: neue Vorlage (ohne `id`) oder Änderung. */
export interface ScoringSave {
  id: string | null;
  /** Verein bzw. null = Vorschlag der Plattform */
  groupId: string | null;
  name: string;
  rules: ScoringRules;
  /** nur Vereinsvorlagen: Faktor in der Vereinsliste, null = zählt dort nicht */
  listWeight: number | null;
}

const num = (v: number) => String(v).replace('.', ',');

/**
 * Wertungsvorlage anlegen oder bearbeiten (Konzept 32, F-500): ein Formular für Vorschläge der Plattform und Vorlagen
 * der Vereine – Name, die festen Bausteine aus `RULE_FIELDS` nach Gruppen, bis zu zehn Posten und (nur Vereine) der
 * Faktor in der Vereinsliste. Kein Formeltext. Prüft wie der Server (`parseRules`) und meldet `sx-scoring-save`
 * (ScoringSave) bzw. `sx-scoring-close`. Fetcht nicht.
 */
export class SxScoringEditor extends LitElement {
  static properties = {
    open: { type: Boolean },
    template: { attribute: false },
    groupId: { attribute: false },
    busy: { type: Boolean },
    error: { type: String },
    items: { state: true },
    inList: { state: true },
    local: { state: true },
    unit: { state: true },
  };
  declare open: boolean;
  /** vorhandene Vorlage (Bearbeiten) oder null (neu) */
  declare template: ScoringTemplate | null;
  declare groupId: string | null;
  declare busy: boolean;
  declare error: string;
  declare items: ScoringItemRule[];
  declare inList: boolean;
  declare local: string;
  /** Einheit der Strecke – schaltet die Beschriftungen um (sm/km, Konzept 39) */
  declare unit: ScoringUnit;

  constructor() {
    super();
    this.open = false;
    this.template = null;
    this.groupId = null;
    this.busy = false;
    this.error = '';
    this.items = [];
    this.inList = false;
    this.local = '';
    this.unit = 'nm';
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(600px, calc(100vw - 32px));
      }
      form {
        display: grid;
        gap: var(--s-3);
      }
      fieldset {
        border: 1px solid var(--border-soft);
        border-radius: var(--radius);
        padding: var(--s-2) var(--s-3) var(--s-3);
        margin: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--s-2);
        min-width: 0;
      }
      legend {
        font-weight: 600;
        padding: 0 var(--s-1);
      }
      label {
        display: grid;
        gap: 2px;
        font-size: var(--fs-s);
        color: var(--text-2);
        min-width: 0;
      }
      input,
      select {
        width: 100%;
        box-sizing: border-box;
        min-height: 44px;
        font: inherit;
        padding: 0 var(--s-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--bg);
        color: var(--text);
      }
      .item {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
        gap: var(--s-2);
        align-items: end;
        grid-column: 1 / -1;
      }
      .check {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 44px;
        color: var(--text);
        font-size: var(--fs-m);
      }
      .check input {
        width: auto;
        min-height: 0;
      }
      .btn {
        min-height: 44px;
      }
      .hint {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .full {
        grid-column: 1 / -1;
      }
      .start {
        justify-self: start;
      }
      @media (max-width: 480px) {
        .item {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
        }
        .item .name {
          grid-column: 1 / -1;
        }
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open) {
      this.items = (this.template?.rules.items ?? []).map((it) => ({ ...it }));
      this.inList = this.template?.listWeight != null;
      this.local = '';
      this.unit = this.template?.rules.unit ?? 'nm';
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) dlg.showModal();
      else if (!this.open && dlg.open) dlg.close();
    }
  }

  private field = (name: string) => (this.renderRoot.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '').trim();

  private submit(e: Event) {
    e.preventDefault();
    const raw: Record<string, unknown> = { items: this.items, unit: this.unit, boatClass: this.field('boatClass') };
    for (const f of RULE_FIELDS) raw[f.key] = this.field(f.key);
    const r = parseRules(raw);
    const name = templateName(this.field('name'));
    const weight = this.groupId && this.inList ? listWeight(this.field('weight')) : null;
    const problem = !name ? `Bitte einen Namen mit 1 bis ${SCORING_LIMITS.nameMax} Zeichen angeben.` : 'error' in r ? r.error
      : weight === undefined ? `Faktor ${num(SCORING_LIMITS.weightMin)} bis ${SCORING_LIMITS.weightMax}.` : '';
    this.local = problem;
    if (problem || 'error' in r) return;
    emit<ScoringSave>(this, 'sx-scoring-save', { id: this.template?.id ?? null, groupId: this.groupId, name: name!, rules: r.rules, listWeight: weight ?? null });
  }

  private close = () => emit(this, 'sx-scoring-close');

  private setItem(i: number, patch: Partial<ScoringItemRule>) {
    this.items = this.items.map((it, k) => (k === i ? { ...it, ...patch } : it));
  }

  private itemsBlock() {
    const val = (e: Event) => (e.target as HTMLInputElement).value.replace(',', '.') as unknown as number;
    return html`<fieldset>
      <legend>Posten</legend>
      <p class="hint full">Zählt Posten gleichen Namens aus dem Fahrtenbuch (z. B. Training, Arbeitsdienst).</p>
      ${this.items.map(
        (it, i) => html`<div class="item">
          <label class="name">Name<input maxlength=${SCORING_LIMITS.itemNameMax} .value=${it.name} @input=${(e: Event) => this.setItem(i, { name: (e.target as HTMLInputElement).value })} /></label>
          <label>Punkte je Einheit<input inputmode="decimal" .value=${num(it.points)} @input=${(e: Event) => this.setItem(i, { points: val(e) })} /></label>
          <label>Höchstens (0 = ohne)<input inputmode="decimal" .value=${num(it.cap)} @input=${(e: Event) => this.setItem(i, { cap: val(e) })} /></label>
          <button class="btn ghost icon" type="button" aria-label="Posten ${i + 1} entfernen" @click=${() => (this.items = this.items.filter((_, k) => k !== i))}>${icon('trash')}</button>
        </div>`,
      )}
      ${this.items.length < SCORING_LIMITS.items
        ? html`<button class="btn small full start" type="button" @click=${() => (this.items = [...this.items, { name: '', points: 1, cap: 0 }])}>${icon('plus')} Posten</button>`
        : ''}
    </fieldset>`;
  }

  /** Auswahl am Anfang einer Gruppe: Einheit der Strecke bzw. Bootsklasse mit eigenem Faktor (Konzept 39). */
  private groupLead(g: RuleField['group'], rules: ScoringRules) {
    if (g === 'Strecke')
      return html`<label>Einheit<select name="unit" @change=${(e: Event) => (this.unit = (e.target as HTMLSelectElement).value as ScoringUnit)}>
        ${(['nm', 'km'] as const).map((u) => html`<option value=${u} ?selected=${this.unit === u}>${u === 'nm' ? 'Seemeilen (sm)' : 'Kilometer (km)'}</option>`)}
      </select></label>`;
    if (g === 'Bootsklasse')
      return html`<label>Bootsklasse<select name="boatClass"><option value="">keine</option>${boatClassOptions(rules.boatClass)}</select></label>`;
    if (g === 'Langtörn') return html`<p class="hint full">Einmal je Eintrag über die ganze Strecke – mehrtägige Törns als ein Eintrag.</p>`;
    return '';
  }

  private form() {
    const t = this.template;
    const rules = t?.rules ?? BASE_RULES;
    return html`<form @submit=${this.submit}>
      <label>Name<input name="name" required maxlength=${SCORING_LIMITS.nameMax} .value=${t?.name ?? ''} placeholder="z. B. Fahrtenpreis 2026" /></label>
      ${t?.sourceName ? html`<p class="hint">Übernommen aus „${t.sourceName}“ – Änderungen gelten nur hier.</p>` : ''}
      ${RULE_GROUPS.map(
        (g) => html`<fieldset>
          <legend>${g}</legend>
          ${this.groupLead(g, rules)}
          ${RULE_FIELDS.filter((f) => f.group === g).map(
            (f) => html`<label>${fieldLabel(f, this.unit)}<input name=${f.key} inputmode="decimal" .value=${num(rules[f.key])} /></label>`,
          )}
        </fieldset>`,
      )}
      ${this.itemsBlock()}
      ${this.groupId
        ? html`<fieldset>
            <legend>Vereinsliste</legend>
            <label class="check full"><input type="checkbox" .checked=${this.inList} @change=${(e: Event) => (this.inList = (e.target as HTMLInputElement).checked)} /> zählt in der Vereinsliste</label>
            ${this.inList ? html`<label>Faktor (Gewichtung)<input name="weight" inputmode="decimal" .value=${num(t?.listWeight ?? 1)} /></label>` : ''}
          </fieldset>`
        : ''}
      <p class="hint">Einträge stehen in Seemeilen${this.unit === 'km' ? ' und werden umgerechnet (1 sm = 1,852 km)' : ''}. Revier, Bootsklasse und Rolle wirken auf die Strecke (${UNIT_LABEL[this.unit]}), ohne Angabe mit Faktor 1. ${SCORING_NOTE}</p>
      ${this.local || this.error ? html`<p class="error" role="alert">${this.local || this.error}</p>` : ''}
      <div class="actions">
        <button class="btn" type="button" @click=${this.close}>Abbrechen</button>
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} Speichern</button>
      </div>
    </form>`;
  }

  render() {
    return html`<dialog aria-labelledby="se-h" @close=${this.close}>
      <header>
        <h2 id="se-h">${this.template ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <div class="body">${this.open ? this.form() : ''}</div>
    </dialog>`;
  }
}
customElements.define('sx-scoring-editor', SxScoringEditor);
