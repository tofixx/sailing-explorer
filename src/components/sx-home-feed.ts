import { LitElement, css, html } from 'lit';
import type { DiscoverGroup, MyGroup, StreamPage, Suggestion } from '../services/api';
import { GROUP_KIND_LABEL } from '../domain/groups';
import { plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';
import './sx-stream';

/**
 * Startseite für Angemeldete (Konzept 11.5, F-163): „Neuigkeiten“ aus Gruppen, Booten und Gefolgten, die eigenen
 * Gruppen und „Leute, die du kennen könntest“. Ohne Gruppen lädt „Tritt deinem Verein bei“ zu öffentlichen Vereinen
 * und zum Gründen ein. Rein präsentational; meldet `sx-stream-more`, `sx-follow`, `sx-post-delete`.
 */
export class SxHomeFeed extends LitElement {
  static properties = {
    stream: { attribute: false },
    groups: { attribute: false },
    suggestions: { attribute: false },
    publicGroups: { attribute: false },
    loading: { type: Boolean },
    followBusy: { attribute: false },
  };
  declare stream: StreamPage | null;
  declare groups: MyGroup[];
  declare suggestions: Suggestion[];
  declare publicGroups: DiscoverGroup[];
  declare loading: boolean;
  /** Profilnamen, für die gerade ein Folgen läuft */
  declare followBusy: string[];

  constructor() {
    super();
    this.stream = null;
    this.groups = [];
    this.suggestions = [];
    this.publicGroups = [];
    this.loading = false;
    this.followBusy = [];
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .wrap {
        display: grid;
        gap: var(--s-3);
        padding: var(--s-4);
        border-radius: var(--radius-l);
        background: var(--overlay);
        backdrop-filter: blur(10px) saturate(1.2);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-2);
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        justify-content: space-between;
        flex-wrap: wrap;
      }
      h2 {
        display: flex;
        gap: var(--s-2);
        align-items: center;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
      }
      a.chip {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        min-height: var(--control-h-s);
        padding: 0 var(--s-2);
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: inherit;
        text-decoration: none;
        font-size: var(--fs-s);
      }
      a.chip:hover {
        border-color: var(--accent);
      }
      .cta {
        display: grid;
        gap: var(--s-2);
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--accent-soft);
      }
      .cta h3 {
        margin: 0;
        font-size: var(--fs-l);
      }
      .cta p {
        margin: 0;
        color: var(--text-2);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
      }
      ul.people {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      ul.people li {
        display: flex;
        gap: var(--s-2);
        align-items: center;
      }
      ul.people .txt {
        flex: 1;
        min-width: 0;
        display: grid;
      }
      ul.people a {
        color: inherit;
        font-weight: 600;
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      ul.people .why {
        font-size: var(--fs-xs);
        color: var(--text-3);
      }
      section {
        display: grid;
        gap: var(--s-2);
      }
    `,
  ];

  private cta() {
    const clubs = this.publicGroups.slice(0, 4);
    return html`<div class="cta" role="region" aria-labelledby="cta-t">
      <h3 id="cta-t">Tritt deinem Verein bei</h3>
      <p>Mit Verein oder Team siehst du hier, was deine Leute segeln – neue Törns, Fotos, Neuigkeiten und Meilensteine.</p>
      ${clubs.length
        ? html`<div class="chips">
            ${clubs.map((g) => html`<a class="chip" href="/g/${g.slug}">${icon('anchor')} ${g.name}<span class="faint">· ${plural(g.members, 'Mitglied', 'Mitglieder')}</span></a>`)}
          </div>`
        : ''}
      <div class="row">
        <a class="btn primary" href="/g/neu">${icon('pennant')} Verein oder Team gründen</a>
        <a class="btn" href="/entdecken#vereine">Alle Vereine</a>
      </div>
    </div>`;
  }

  private people() {
    if (!this.suggestions.length) return '';
    return html`<section aria-labelledby="ppl-t">
      <h3 class="eyebrow" id="ppl-t">Leute, die du kennen könntest</h3>
      <ul class="people">
        ${this.suggestions.map(
          (p) => html`<li>
            <span class="avatar" aria-hidden="true">${p.displayName[0]}</span>
            <span class="txt"><a href="/u/${p.handle}">${p.displayName}</a><span class="why">${p.reasonText}</span></span>
            <button class="btn small" ?disabled=${this.followBusy.includes(p.handle)} aria-label="${p.displayName} folgen"
              @click=${() => emit(this, 'sx-follow', { kind: 'user', id: p.handle, follow: true })}>${icon('user')} Folgen</button>
          </li>`,
        )}
      </ul>
    </section>`;
  }

  render() {
    const hasGroups = this.groups.length > 0 || !!this.stream?.hasGroups;
    return html`<div class="wrap">
      <header>
        <h2 class="eyebrow">${icon('comment')} Neuigkeiten</h2>
        ${hasGroups ? html`<a class="btn small ghost" href="/g/neu">${icon('pennant')} Gruppe gründen</a>` : ''}
      </header>
      ${hasGroups
        ? html`<div class="chips" aria-label="Deine Gruppen">
            ${this.groups.map((g) => html`<a class="chip" href="/g/${g.slug}" title=${GROUP_KIND_LABEL[g.kind]}>${icon(g.kind === 'club' ? 'anchor' : 'sail')} ${g.name}</a>`)}
          </div>`
        : this.cta()}
      ${hasGroups || this.stream?.items.length
        ? html`<sx-stream scope="home" .items=${this.stream?.items ?? []} .cursor=${this.stream?.cursor ?? null} ?loading=${this.loading}
            empty-text="Noch nichts Neues. Sobald jemand aus deinen Gruppen segelt oder postet, steht es hier."></sx-stream>`
        : ''}
      ${this.people()}
    </div>`;
  }
}
customElements.define('sx-home-feed', SxHomeFeed);
