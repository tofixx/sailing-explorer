import { LitElement, css, html } from 'lit';
import type { MyGroup } from '../services/api';
import { GROUP_KIND_LABEL, GROUP_ROLE_LABEL } from '../domain/groups';
import { icon } from './icons';
import { NOTIFY_LEVEL_ICON } from './sx-notify-bell';
import { NOTIFY_LEVEL_LABEL, type NotifyLevel } from '../domain/notifications';
import { base, emit, offerFollow } from './shared';

export interface MyRequest {
  id?: string;
  slug: string;
  name: string;
  kind: MyGroup['kind'];
  createdAt: number;
}

/**
 * „Meine Gruppen“ im Konto (F-348): Vereine und Teams mit Rolle, Stufe als Symbol mit Link zur Gruppe (F-449) und
 * Austreten bzw. Hinweis zum Übergeben für Eigentümer (F-347); offene Beitrittsanfragen mit „Zurückziehen“. Rein
 * präsentational; meldet \`sx-group-leave\` { id }, \`sx-group-withdraw\` { id }.
 */
export class SxMyGroups extends LitElement {
  static properties = { groups: { attribute: false }, requests: { attribute: false }, busy: { type: Boolean } };
  declare groups: MyGroup[];
  declare requests: MyRequest[];
  declare busy: boolean;

  constructor() {
    super();
    this.groups = [];
    this.requests = [];
    this.busy = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-4);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s-2);
        padding: var(--s-2) var(--s-3);
        border: 1px solid var(--border-soft);
        border-radius: var(--radius);
      }
      .name {
        flex: 1;
        min-width: 10rem;
        overflow-wrap: anywhere;
      }
      .sub {
        display: block;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
    `,
  ];

  /** Stufe nur als Symbol mit Link zur Gruppe (F-449, UX N9-Ausnahme): bearbeitet wird am Objekt bzw. in der Übersicht. */
  private bell(g: MyGroup, level: NotifyLevel) {
    const label = `Benachrichtigungen für ${g.name}: ${NOTIFY_LEVEL_LABEL[level]} – ändern auf der Gruppenseite`;
    return html`<a class="btn ghost icon small bell" href="/g/${g.slug}" aria-label=${label} title=${label}>${icon(NOTIFY_LEVEL_ICON[level])}</a>`;
  }

  private group(g: MyGroup) {
    const muted = !!g.muted;
    return html`<li>
      <span class="name"><a href="/g/${g.slug}">${g.name}</a>
        <span class="sub">${GROUP_KIND_LABEL[g.kind]} · ${g.role ? GROUP_ROLE_LABEL[g.role] : ''}${muted ? ' · stumm' : ''}</span></span>
      ${this.bell(g, g.notifyLevel ?? (muted ? 'muted' : 'important'))}
      ${g.role === 'owner'
        ? html`<a class="btn small ghost" href="/g/${g.slug}" title="Übergib die Gruppe in der Mitgliederliste an einen Admin – danach kannst du austreten.">Übergeben …</a>`
        : html`<button class="btn small ghost" type="button" ?disabled=${this.busy} @click=${() => confirm(`„${g.name}“ verlassen?`) && emit(this, 'sx-group-leave', { id: g.id, follow: offerFollow(g) })}>${icon('logout')} Austreten</button>`}
    </li>`;
  }

  render() {
    return html`<section aria-labelledby="mg-t">
        <h3 class="eyebrow" id="mg-t">Vereine und Teams</h3>
        ${this.groups.length
          ? html`<ul>${this.groups.map((g) => this.group(g))}</ul>`
          : html`<p class="sub">Noch in keinem Verein oder Team. <a href="/entdecken#vereine">Vereine entdecken</a></p>`}
      </section>
      ${this.requests.length
        ? html`<section aria-labelledby="mr-t">
            <h3 class="eyebrow" id="mr-t">Offene Anfragen</h3>
            <ul>
              ${this.requests.map(
                (r) => html`<li>
                  <span class="name"><a href="/g/${r.slug}">${r.name}</a><span class="sub">${GROUP_KIND_LABEL[r.kind]} · wartet auf Bestätigung</span></span>
                  ${r.id ? html`<button class="btn small ghost" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-group-withdraw', { id: r.id })}>Zurückziehen</button>` : ''}
                </li>`,
              )}
            </ul>
          </section>`
        : ''}`;
  }
}
customElements.define('sx-my-groups', SxMyGroups);
