import { LitElement, css, html } from 'lit';
import type { DiscoverGroup, MyGroup, StreamFilter, StreamFilters, StreamPage, Suggestion } from '../services/api';
import { GROUP_KIND_LABEL } from '../domain/groups';
import type { SxHarborPicker } from './sx-harbor-picker';
import './sx-harbor-picker';
import { plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';
import './sx-stream';

/**
 * Herzstück der Startseite (Konzept 12.6, F-182): der Community-Stream.
 * - Gäste: „Neues aus der Community“ (öffentlicher Stream) mit Filter-Chips nach Hafen und Verein; „Anmelden &
 *   mitmachen“ steht in der Seitenleiste (sx-join-card, F-261).
 * - Angemeldete: „Neuigkeiten aus deinem Verein, Hafen und Team“, Heimat (Verein, Hafen), eigene Gruppen,
 *   „Leute, die du kennen könntest“; ohne Gruppen „Tritt deinem Verein bei“.
 * - Nach der Anmeldung (ohne Gruppe oder ohne Heimathafen) eine Willkommens-Karte (Konzept 14.3): Heimathafen wählen,
 *   Verein oder Team beitreten bzw. gründen, Freunde einladen.
 * Rein präsentational; meldet `sx-stream-more`, `sx-stream-filter`, `sx-follow`, `sx-account`,
 * `sx-home-harbor` { harbor }, `sx-home-join` { id, name }, `sx-friend-invite` { email | null }, `sx-invite-copy`.
 */
const WELCOME_KEY = 'sx-welcome-dismissed';
function readDismissed(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

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
    inviteLink: { attribute: false },
    requested: { attribute: false },
    dismissed: { state: true },
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
  /** frisch erzeugter Einladungslink (nur einmal sichtbar) */
  declare inviteLink: string | null;
  /** Gruppen-IDs, an die aus der Karte eine Anfrage ging (Knopf „Angefragt“) */
  declare requested: string[];
  /** Willkommens-Karte ausgeblendet („Später“, pro Gerät) */
  declare dismissed: boolean;

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
    this.inviteLink = null;
    this.requested = [];
    this.dismissed = readDismissed();
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
      .cta {
        display: grid;
        gap: var(--s-2);
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--accent-soft);
      }
      .cta .step {
        display: grid;
        gap: var(--s-2);
        padding-top: var(--s-2);
        border-top: 1px solid var(--border-soft);
      }
      code.link {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
        font-size: var(--fs-xs);
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

  private dismiss() {
    this.dismissed = true;
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // ohne Speicher bleibt es für diese Sitzung ausgeblendet
    }
  }

  /** Beitreten-Knopf je nach Beitrittsstufe (offen: direkt, auf Anfrage: anfragen, nur Einladung: ansehen). */
  private joinButton(g: DiscoverGroup) {
    if (!g.id || g.joinMode === 'invite') return html`<a class="btn small ghost" href="/g/${g.slug}">Ansehen</a>`;
    if (this.requested.includes(g.id)) return html`<button class="btn small" disabled>${icon('check')} Angefragt</button>`;
    const label = g.joinMode === 'open' ? 'Beitreten' : 'Anfragen';
    return html`<button class="btn small" @click=${() => emit(this, 'sx-home-join', { id: g.id, name: g.name })}>${icon('user')} ${label}</button>`;
  }

  /**
   * Willkommens-Karte nach der Anmeldung (Konzept 14.3): drei kleine Schritte – Heimathafen, Verein oder Team,
   * Freunde einladen. Erledigte Schritte verschwinden; „Später“ blendet die Karte auf diesem Gerät aus.
   */
  private welcome(hasGroups: boolean) {
    const needHarbor = !this.stream?.home?.harbor;
    if (this.dismissed || (hasGroups && !needHarbor)) return '';
    const groups = this.publicGroups.slice(0, 6);
    let email = '';
    return html`<div class="cta" role="region" aria-labelledby="cta-t">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 id="cta-t">Willkommen an Bord!</h3>
        <button class="btn small ghost" @click=${() => this.dismiss()}>Später</button>
      </div>
      <p>Drei kleine Schritte, dann siehst du hier, was in deinem Hafen, Verein und Team los ist.</p>
      ${needHarbor
        ? html`<form class="step" @submit=${(e: Event) => {
            e.preventDefault();
            const picker = (e.target as HTMLFormElement).querySelector<SxHarborPicker>('sx-harbor-picker');
            if (picker) emit(this, 'sx-home-harbor', { harbor: picker.choice });
          }}>
            <label class="label" for="wh">${icon('anchor')} Dein Heimathafen</label>
            <div class="row"><sx-harbor-picker input-id="wh" label="Heimathafen" style="flex:1;min-width:180px"></sx-harbor-picker>
              <button class="btn small primary" type="submit">Speichern</button></div>
          </form>`
        : ''}
      ${hasGroups
        ? ''
        : html`<div class="step">
            <div class="label">${icon('pennant')} Dein Verein oder Team</div>
            ${groups.length
              ? html`<ul class="people">
                  ${groups.map(
                    (g) => html`<li>
                      <span class="avatar" aria-hidden="true">${icon(g.kind === 'club' ? 'anchor' : 'sail')}</span>
                      <span class="txt"><a href="/g/${g.slug}">${g.name}</a><span class="why">${[GROUP_KIND_LABEL[g.kind], g.homePort, plural(g.members, 'Mitglied', 'Mitglieder')].filter(Boolean).join(' · ')}</span></span>
                      ${this.joinButton(g)}
                    </li>`,
                  )}
                </ul>`
              : ''}
            <div class="row">
              <a class="btn small primary" href="/g/neu">${icon('pennant')} Verein oder Team gründen</a>
              <a class="btn small" href="/entdecken#vereine">Alle Vereine</a>
            </div>
          </div>`}
      <div class="step">
        <div class="label">${icon('mail')} Freunde einladen</div>
        <form class="row" @submit=${(e: Event) => {
            e.preventDefault();
            if (email) emit(this, 'sx-friend-invite', { email });
          }}>
          <input type="email" placeholder="E-Mail-Adresse" aria-label="Freund:in per E-Mail einladen" style="flex:1;min-width:180px" @input=${(e: Event) => (email = (e.target as HTMLInputElement).value)} />
          <button class="btn small" type="submit">Einladen</button>
          <button class="btn small ghost" type="button" @click=${() => emit(this, 'sx-friend-invite', { email: null })}>${icon('link')} Link erzeugen</button>
        </form>
        ${this.inviteLink
          ? html`<div class="row"><code class="link">${this.inviteLink}</code>
              <button class="btn small" @click=${() => emit(this, 'sx-invite-copy', this.inviteLink)}>${icon('copy')} Kopieren</button></div>
              <span class="why">Nur jetzt sichtbar · 14 Tage gültig · bis zu 20 Personen. Wer annimmt, folgt dir – und du ihm.</span>`
          : ''}
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
    if (!f || (!f.harbors.length && !f.clubs.length && !f.teams?.length)) return '';
    const active = this.filter;
    const pick = (filter: StreamFilter) => emit(this, 'sx-stream-filter', { filter });
    const is = (kind: 'harbor' | 'club', slug: string) => active?.kind === kind && active.slug === slug;
    // Ein Klick grenzt ein, ein zweiter hebt es wieder auf
    const chip = (kind: 'harbor' | 'club', slug: string, glyph: Parameters<typeof icon>[0], name: string) =>
      html`<button class="chip" aria-pressed=${is(kind, slug) ? 'true' : 'false'} @click=${() => pick(is(kind, slug) ? null : { kind, slug })}>${icon(glyph)} ${name}</button>`;
    return html`<div class="filters" role="toolbar" aria-label="Neuigkeiten eingrenzen">
      <button class="chip" aria-pressed=${active ? 'false' : 'true'} @click=${() => pick(null)}>Alle</button>
      ${f.harbors.map((h) => chip('harbor', h.slug, 'anchor', h.name))}
      ${f.clubs.map((c) => chip('club', c.slug, 'pennant', c.name))}
      ${(f.teams ?? []).map((t) => chip('club', t.slug, 'sail', t.name))}
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
        : ''}
      ${this.welcome(hasGroups)}
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
