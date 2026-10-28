import { LitElement, html, css } from 'lit';
import { GROUP_KIND_LABEL, type ShareGroupChoice } from '../domain/groups';
import { base, emit } from './shared';

/**
 * „In Gruppen zeigen“ (F-373, F-375): ein Haken je eigener Gruppe. Properties rein (`groups`, `selected`), Event raus
 * (`sx-share-groups-change` mit `{ groupIds }`). Ohne Gruppen zeigt die Komponente nichts.
 */
export class SxShareGroups extends LitElement {
  static properties = {
    groups: { attribute: false },
    selected: { attribute: false },
    disabled: { type: Boolean },
  };
  declare groups: ShareGroupChoice[];
  declare selected: string[];
  declare disabled: boolean;

  constructor() {
    super();
    this.groups = [];
    this.selected = [];
    this.disabled = false;
  }

  static styles = [
    base,
    css`
      fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--s-1);
      }
      .list {
        display: grid;
        gap: var(--s-1);
      }
      label {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        min-height: var(--control-h-s);
        font-size: var(--fs-m);
        cursor: pointer;
      }
      input {
        accent-color: var(--accent);
        width: 16px;
        height: 16px;
        flex: none;
      }
      small {
        color: var(--text-3);
        font-size: var(--fs-s);
      }
    `,
  ];

  private toggle(id: string, on: boolean) {
    const ids = on ? [...new Set([...this.selected, id])] : this.selected.filter((x) => x !== id);
    // Reihenfolge wie in der Liste – stabil für Vergleiche und Anfragen
    emit(this, 'sx-share-groups-change', { groupIds: this.groups.map((g) => g.id).filter((g) => ids.includes(g)) });
  }

  render() {
    if (!this.groups.length) return '';
    return html`<fieldset ?disabled=${this.disabled}>
      <legend class="label">In Gruppen zeigen</legend>
      <div class="list">
        ${this.groups.map(
          (g) => html`<label>
            <input type="checkbox" name="group" value=${g.id} .checked=${this.selected.includes(g.id)} @change=${(e: Event) => this.toggle(g.id, (e.target as HTMLInputElement).checked)} />
            <span>${g.name} <small>${GROUP_KIND_LABEL[g.kind]}</small></span>
          </label>`,
        )}
      </div>
      <div class="hint">Nur öffentliche Törns erscheinen in der Gruppe – in ihren Neuigkeiten, Seemeilen und Fotos. Vorausgewählt sind die Gruppen des Boots.</div>
    </fieldset>`;
  }
}
customElements.define('sx-share-groups', SxShareGroups);
