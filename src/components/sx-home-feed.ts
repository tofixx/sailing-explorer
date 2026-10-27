import { LitElement, css, html } from 'lit';
import type { DiscoverGroup, MyGroup, StreamFilter, StreamFilters, StreamPage, Suggestion } from '../services/api';
import { GROUP_KIND_LABEL } from '../domain/groups';
import { plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';
import './sx-stream';

/**
 * Herzstück der Startseite (Konzept 12.6, F-182): der Community-Stream.
 * - Gäste: „Neues aus der Community“ (öffentlicher Stream) mit Filter-Chips nach Hafen und Verein und „Anmelden &
 *   mitmachen“.
 * - Angemeldete: „Neuigkeiten aus deinem Verein, Hafen und Team“, Heimat (Verein, Hafen), eigene Gruppen,
 *   „Leute, die du kennen könntest“; ohne Gruppen „Tritt deinem Verein bei“.
 * Rein präsentational; meldet `sx-stream-more`, `sx-stream-filter`, `sx-follow`, `sx-login`, `sx-account`.
 */
export class SxHomeFeed extends LitElement {
  static properties = {
    signedIn: { type: Boolean, attribute: 'signed-in' },
    stream: { attribute: false },
    filters: { attribute: false },
    filter: { attribute: false },
    groups: { attribute: false },
    suggestions: { attribute: false },
    publicGroups: { attribute: false },
    loading: { type: Boolean },
    followBusy: { attribute: false },
  };
  declare signedIn: boolean;
  /** persönlicher (angemeldet) bzw. öffentlicher Stream (Gäste) */
  declare stream: StreamPage | null;
  /** Filter-Chips des öffentlichen Streams */
  declare filters: StreamFilters | null;
  /** aktiver Filter (null = alle) */
  declare filter: StreamFilter;
  declare groups: MyGroup[];
  declare suggestions: Suggestion[];
  declare publicGroups: DiscoverGroup[];
  declare loading: boolean;
  /** Profilnamen, für die gerade ein Folgen läuft */
  declare followBusy: string[];

  constructor() {
    super();
    this.signedIn = false;
    this.stream = null;
    this.filters = null;
    this.filter = null;
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
        align-items: flex-start;
        gap: var(--s-2);
        justify-content: space-between;
        flex-wrap: wrap;
      }
      h2 {
        margin: 0;
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
        line-height: 1.2;
      }
      .intro {
        margin: var(--s-1) 0 0;
        color: var(--text-2);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
      }
      a.chip,
      button.chip {
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
        font: inherit;
        font-size: var(--fs-s);
        cursor: pointer;
      }
      a.chip:hover,
      button.chip:hover {
        border-color: var(--accent);
      }
      button.chip[aria-pressed='true'] {
        background: var(--accent-soft);
        border-color: var(--accent);
        color: var(--accent);
        font-weight: 650;
      }
      a.chip:focus-visible,
      button.chip:focus-visible {
        outline: none;
        box-shadow: var(--focus);
      }
      @media (pointer: coarse) {
        a.chip,
        button.chip {
          min-height: 40px;
        }
      }
      .filters {
        display: flex;
        gap: var(--s-2);
        overflow-x: auto;
        padding-bottom: 2px;
        scrollbar-width: thin;
      }
      .filters .chip {
        flex: none;
      }
      .join {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s-2) var(--s-3);
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--accent-soft);
      }
      .join p {
        margin: 0;
        flex: 1;
        min-width: 200px;
        color: var(--text-2);
      }
      .join .btn.primary {
        min-height: max(44px, var(--control-h));
        font-size: var(--fs-l);
        padding: 0 var(--s-5);
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
      .home {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .home a {
        color: var(--accent);
        font-weight: 600;
        text-decoration: none;
      }
      .home .link {
        border: 0;
        padding: 0;
        background: none;
        color: var(--accent);
        font: inherit;
        cursor: pointer;
        text-decoration: underline;
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
      @media (max-width: 760px) {
        .wrap {
          padding: var(--s-3);
          border-radius: var(--radius);
        }
        h2 {
          font-size: var(--fs-l);
        }
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

  /** Heimatverein und Heimathafen – oder der Hinweis, sie zu wählen. */
  private homeLine() {
    const home = this.stream?.home;
    if (!home) return '';
    const set = () => emit(this, 'sx-account', 'profile');
    if (!home.club && !home.harbor) {
      return html`<div class="home">${icon('info')}<span>Wähle <button class="link" @click=${set}>deinen Verein und Heimathafen</button> – dann siehst du hier, was dort los ist.</span></div>`;
    }
    return html`<div class="home">
      ${home.club ? html`<span>${icon('pennant')} Mein Verein: <a href="/g/${home.club.slug}">${home.club.name}</a></span>` : html`<button class="link" @click=${set}>Verein wählen</button>`}
      ${home.harbor ? html`<span>${icon('anchor')} Heimathafen: <a href="/h/${home.harbor.slug}">${home.harbor.name}</a></span>` : html`<button class="link" @click=${set}>Heimathafen wählen</button>`}
    </div>`;
  }

  private filterChips() {
    const f = this.filters;
    if (!f || (!f.harbors.length && !f.clubs.length)) return '';
    const active = this.filter;
    const pick = (filter: StreamFilter) => emit(this, 'sx-stream-filter', { filter });
    const is = (kind: 'harbor' | 'club', slug: string) => active?.kind === kind && active.slug === slug;
    return html`<div class="filters" role="toolbar" aria-label="Neuigkeiten filtern">
      <button class="chip" aria-pressed=${active ? 'false' : 'true'} @click=${() => pick(null)}>Alle</button>
      ${f.harbors.map((h) => html`<button class="chip" aria-pressed=${is('harbor', h.slug) ? 'true' : 'false'} @click=${() => pick(is('harbor', h.slug) ? null : { kind: 'harbor', slug: h.slug })}>${icon('anchor')} ${h.name}</button>`)}
      ${f.clubs.map((c) => html`<button class="chip" aria-pressed=${is('club', c.slug) ? 'true' : 'false'} @click=${() => pick(is('club', c.slug) ? null : { kind: 'club', slug: c.slug })}>${icon('pennant')} ${c.name}</button>`)}
    </div>`;
  }

  private guest() {
    return html`<section class="wrap" aria-labelledby="feed-t">
      <header>
        <div>
          <h2 id="feed-t">Neues aus der Community</h2>
          <p class="intro">Was Seglerinnen und Segler aus Vereinen, Häfen und Teams gerade teilen.</p>
        </div>
      </header>
      <div class="join">
        <p>Speichere deine Törns, tritt deinem Verein bei, folge deinem Hafen und reagiere auf die Törns der anderen.</p>
        <button class="btn primary" @click=${() => emit(this, 'sx-login')}>${icon('user')} Anmelden &amp; mitmachen</button>
      </div>
      ${this.filterChips()}
      <sx-stream scope="public" .items=${this.stream?.items ?? []} .cursor=${this.stream?.cursor ?? null} ?loading=${this.loading}
        empty-text="Hier ist noch nichts los. Teile den ersten öffentlichen Törn – er erscheint sofort in der Community."></sx-stream>
    </section>`;
  }

  private member() {
    const hasGroups = this.groups.length > 0 || !!this.stream?.hasGroups;
    return html`<section class="wrap" aria-labelledby="feed-t">
      <header>
        <h2 id="feed-t">Neuigkeiten aus deinem Verein, Hafen und Team</h2>
        ${hasGroups ? html`<a class="btn small ghost" href="/g/neu">${icon('pennant')} Gruppe gründen</a>` : ''}
      </header>
      ${this.homeLine()}
      ${hasGroups
        ? html`<div class="chips" aria-label="Deine Gruppen">
            ${this.groups.map((g) => html`<a class="chip" href="/g/${g.slug}" title=${GROUP_KIND_LABEL[g.kind]}>${icon(g.kind === 'club' ? 'anchor' : 'sail')} ${g.name}</a>`)}
          </div>`
        : this.cta()}
      <sx-stream scope="home" .items=${this.stream?.items ?? []} .cursor=${this.stream?.cursor ?? null} ?loading=${this.loading}
        empty-text="Noch nichts Neues. Sobald jemand aus deinem Verein, Hafen oder Team segelt oder postet, steht es hier."></sx-stream>
      ${this.people()}
    </section>`;
  }

  render() {
    return this.signedIn ? this.member() : this.guest();
  }
}
customElements.define('sx-home-feed', SxHomeFeed);
