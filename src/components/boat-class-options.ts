import { html } from 'lit';
import { BOAT_CLASSES, BOAT_CLASS_GROUPS, boatClassFilterLabel } from '../domain/boat-class';

/**
 * Optionen einer Bootsklassen-Auswahl (Konzept 34), gruppiert wie BOAT_CLASS_GROUPS – geteilt von Bootsformular
 * (`sx-account-dialog`) und Filter auf /entdecken (`sx-discover`). `groups` (Filter): je Gruppe zusätzlich „Alle …“,
 * ohne „Sonstige“ (nur eine Wahl am Boot, F-537).
 * Die erste Option (Wert '') bringt der Aufrufer mit.
 */
export function boatClassOptions(selected: string, groups = false) {
  const opt = (id: string, label: string) => html`<option value=${id} ?selected=${selected === id}>${label}</option>`;
  return html`${BOAT_CLASS_GROUPS.map(
    ([g, label]) => html`<optgroup label=${label}>
      ${groups ? opt(g, boatClassFilterLabel(g)) : ''}${BOAT_CLASSES.filter((c) => c.group === g).map((c) => opt(c.id, c.label))}
    </optgroup>`,
  )}${groups ? '' : BOAT_CLASSES.filter((c) => !c.group).map((c) => opt(c.id, c.label))}`;
}
