import { LitElement, css, html } from 'lit';
import { NEAR_RADII, fmtKm, type NearRadius } from '../domain/near';
import { ifDefined } from 'lit/directives/if-defined.js';
import {
  shareImageUrl,
  type CoverRef,
  type DiscoverBoat,
  type DiscoverData,
  type DiscoverGroup,
  type DiscoverHarbor,
  type DiscoverMembership,
  type DiscoverPerson,
  type DiscoverVoyage,
} from '../services/api';
import { GROUP_KIND_LABEL, JOIN_ACTION_LABEL, joinAction } from '../domain/groups';
import { SEARCH_LIMITS } from '../domain/search';
import { fmtDate, fmtNum, plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/** Abschnitte der Seite /entdecken – „Alle“ oder einer allein (F-332). */
export const DISCOVER_SECTIONS = [
  ['all', 'Alle'],
  ['voyages', 'Törns'],
  ['boats', 'Boote'],
  ['people', 'Segler'],
  ['harbors', 'Häfen'],
  ['groups', 'Vereine und Teams'],
] as const;
export type DiscoverSection = (typeof DISCOVER_SECTIONS)[number][0];

/**
 * Entdecken: zuletzt gesegelte Törns, Boote und Segler (F-70 ff.).
 * variant="strip" – Entdecken-Vorschau auf der Startseite (F-260); variant="page" – Seite /entdecken (alles).
 * Rein präsentational: Daten kommen vom Controller, Links sind normale Seitenwechsel.
 * Seite: Suchfeld meldet `sx-discover-search` { query } (der Controller sucht verzögert, F-331); Beitreten-Knöpfe auf
 * Vereinskarten melden `sx-group-join` { id } wie die Gruppenseite (F-333).
 */
export class SxDiscover extends LitElement {
  static properties = {
    data: { attribute: false },
    variant: { type: String, reflect: true },
    loading: { type: Boolean },
    error: { type: String },
    query: { type: String },
    membership: { attribute: false },
    joining: { type: String },
    show: { type: String },
    near: { attribute: false },
  };
  declare data: DiscoverData | null;
  declare variant: 'strip' | 'page';
  declare loading: boolean;
  declare error: string;
  /** Text im Suchfeld (vom Controller, z. B. aus ?q=) */
  declare query: string;
  /** eigene Mitgliedschaften und Anfragen (angemeldet), sonst null */
  declare membership: DiscoverMembership | null;
  /** ID der Gruppe, deren Beitritt gerade läuft */
  declare joining: string;
  /** gewählter Abschnitt (Chips) */
  declare show: DiscoverSection;
  /** Umgebung (F-344): an/aus, Umkreis, Mittelpunkt („deinen Standort“ bzw. Hafenname; null = keiner bekannt) */
  declare near: { on: boolean; radius: NearRadius; center: string | null } | null;

  constructor() {
    super();
    this.data = null;
    this.variant = 'page';
    this.loading = false;
    this.error = '';
    this.query = '';
    this.membership = null;
    this.joining = '';
    this.show = 'all';
    this.near = null;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      :host([variant='page']) {
        overflow-y: auto;
        background: var(--bg);
      }
      a {
        color: inherit;
      }

      /* ---------- Karten (gemeinsam) */
      .voyage {
        position: relative;
        display: grid;
        grid-template-rows: auto 1fr;
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
        overflow: hidden;
        transition: border-color 0.15s var(--ease), transform 0.15s var(--ease);
      }
      .voyage:hover,
      .voyage:focus-within {
        border-color: var(--accent);
        transform: translateY(-1px);
      }
      .thumb {
        aspect-ratio: 1200 / 630;
        background: linear-gradient(135deg, var(--accent-soft), var(--surface-2));
        color: var(--accent);
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .thumb svg {
        width: 34px;
        height: 34px;
        opacity: 0.6;
      }
      .info {
        display: grid;
        gap: var(--s-1);
        align-content: start;
        padding: var(--s-2) var(--s-3) var(--s-3);
        min-width: 0;
      }
      a.main {
        font-weight: 650;
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* ganze Karte klickbar, Chips liegen darüber */
      a.main::after {
        content: '';
        position: absolute;
        inset: 0;
      }
      a.main:focus-visible {
        box-shadow: none;
      }
      .voyage:has(a.main:focus-visible),
      .card:has(a.main:focus-visible) {
        box-shadow: var(--focus);
      }
      .meta {
        font-size: var(--fs-s);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1);
        margin-top: var(--s-1);
      }
      .chip {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        min-height: 26px;
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--surface-2);
        border: 1px solid var(--border-soft);
        font-size: var(--fs-xs);
        font-weight: 600;
        color: var(--text-2);
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      a.chip:hover {
        color: var(--accent);
        border-color: var(--accent);
      }
      .chip.anon {
        border-style: dashed;
      }
      .chip svg {
        width: 14px;
        height: 14px;
      }

      /* ---------- Leiste auf der Startseite */
      .strip {
        background: var(--overlay);
        backdrop-filter: blur(10px) saturate(1.2);
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
        box-shadow: var(--shadow-2);
        padding: var(--s-3) var(--s-4) var(--s-4);
      }
      .strip header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s-2);
        margin-bottom: var(--s-2);
      }
      .strip header a {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 32px;
        font-size: var(--fs-s);
        font-weight: 600;
        color: var(--accent);
        text-decoration: none;
      }
      .row {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(180px, 1fr);
        gap: var(--s-2);
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        overscroll-behavior-x: contain;
        padding-bottom: 2px;
      }
      .row > * {
        scroll-snap-align: start;
      }
      .strip .info {
        padding: var(--s-2);
      }
      /* kompakter als auf der Seite – die Leiste soll die Einstiegskarte nicht verdrängen */
      .strip .thumb {
        aspect-ratio: 5 / 2;
      }
      .strip a.main {
        font-size: var(--fs-s);
      }
      .strip h2 {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .strip h2 svg {
        width: 15px;
        height: 15px;
      }
      .invite {
        display: grid;
        gap: 4px;
        padding: var(--s-4);
      }
      .crew {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s-1) var(--s-2);
        margin-top: var(--s-3);
        font-size: var(--fs-s);
      }

      /* ---------- Seite /entdecken */
      .page {
        max-width: 980px;
        margin: 0 auto;
        padding: var(--s-5) var(--s-4) var(--s-6);
        display: grid;
        gap: var(--s-5);
      }
      .hero {
        position: relative;
        display: flex;
        gap: var(--s-4);
        align-items: center;
        padding: var(--s-5);
        border-radius: var(--radius-l);
        background: linear-gradient(135deg, var(--accent-soft), var(--surface) 70%);
        border: 1px solid var(--border-soft);
        overflow: hidden;
      }
      .mark {
        flex: none;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--accent);
        color: var(--on-accent);
        box-shadow: var(--shadow-1);
      }
      .mark svg {
        width: 34px;
        height: 34px;
      }
      h1 {
        margin: 0;
        font-size: var(--fs-xl);
        letter-spacing: -0.02em;
        line-height: 1.2;
      }
      .lead {
        color: var(--text-2);
        margin-top: var(--s-1);
      }
      section {
        display: grid;
        gap: var(--s-3);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--s-3);
      }
      .card {
        position: relative;
        display: flex;
        gap: var(--s-3);
        align-items: flex-start;
        padding: var(--s-3) var(--s-4);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
        text-decoration: none;
        min-width: 0;
        transition: border-color 0.15s var(--ease), transform 0.15s var(--ease);
      }
      a.card:hover,
      a.card:focus-visible,
      .card:has(a.main:hover),
      .card:has(a.main:focus-visible) {
        border-color: var(--accent);
        transform: translateY(-1px);
      }
      /*
       * Titelbild über der Karte: derselbe breite 3:1-Streifen wie im Seitenkopf (COVER_BANNER_RATIO) mit dem
       * gespeicherten Ausschnitt – nie hochkant oder quadratisch beschnitten (F-330).
       */
      .card.has-cover {
        flex-wrap: wrap;
        overflow: hidden;
      }
      .card.has-cover .txt {
        flex: 1 1 0;
      }
      .card .cv {
        flex: 0 0 auto;
        /* feste Breite und min-width 0: sonst gilt die Pixelbreite der Datei als Mindestbreite – das Bild sprengt die
           Karte (Seite seitlich verschiebbar) und wird über das Seitenverhältnis hochkant riesig */
        width: calc(100% + 2 * var(--s-4));
        min-width: 0;
        max-width: none;
        height: auto;
        margin: calc(-1 * var(--s-3)) calc(-1 * var(--s-4)) 0;
        aspect-ratio: 3 / 1;
        object-fit: cover;
        display: block;
        background: var(--surface-2);
      }
      .card .ic {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 700;
        text-transform: uppercase;
      }
      .card .txt {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .card .t {
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .card .bio {
        font-size: var(--fs-s);
        color: var(--text-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      /* Karte mit Knopf (Vereine): der Name deckt als Link die Karte ab, der Knopf liegt darüber */
      .card a.main {
        color: inherit;
      }
      .card .join {
        position: relative;
        z-index: 1;
        justify-self: start;
        margin-top: var(--s-1);
      }
      .join-note {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: var(--s-1);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .join-note svg {
        width: 14px;
        height: 14px;
      }

      /* Suche und Abschnitte (F-331, F-332) */
      .tools {
        display: grid;
        gap: var(--s-2);
      }
      .near-at {
        align-self: center;
        flex: none;
        font-size: var(--fs-s);
      }
      .tools input[type='search'] {
        width: 100%;
        min-height: 44px;
        font-size: 16px; /* kein Zoom auf iOS */
      }
      .tabs {
        display: flex;
        gap: var(--s-1);
        overflow-x: auto;
        overscroll-behavior-x: contain;
        padding-bottom: 2px;
      }
      button.chip {
        flex: none;
        min-height: 32px;
        cursor: pointer;
        font: inherit;
        font-size: var(--fs-xs);
        font-weight: 600;
      }
      button.chip[aria-pressed='true'] {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--on-accent);
      }
      .empty,
      .state {
        padding: var(--s-5);
        text-align: center;
        color: var(--text-2);
        border: 1px dashed var(--border);
        border-radius: var(--radius);
      }
      @media (prefers-reduced-motion: reduce) {
        .voyage,
        .card {
          transition: none;
        }
        .voyage:hover,
        .voyage:focus-within,
        a.card:hover,
        a.card:focus-visible {
          transform: none;
        }
      }
    `,
  ];

  private voyage(v: DiscoverVoyage) {
    return html`<article class="voyage">
      <div class="thumb">
        ${v.hasImage ? html`<img src=${shareImageUrl(v.id)} alt="" loading="lazy" decoding="async" />` : icon('map')}
      </div>
      <div class="info">
        <a class="main" href="/s/${v.id}" title=${v.title}>${v.title}</a>
        <span class="meta">${fmtNum(v.distNm, 1)} sm · ${fmtDate(v.startedAt ?? v.createdAt)}</span>
        <div class="chips">
          ${v.sailor
            ? html`<a class="chip" href="/u/${v.sailor.handle}" title="Profil von ${v.sailor.displayName}">${icon('user')}${v.sailor.displayName}</a>`
            : html`<span class="chip anon" title="Profil nicht öffentlich">${icon('user')}Segler:in</span>`}
          ${v.boat ? html`<a class="chip" href="/b/${v.boat.id}" title="Boot ${v.boat.name}">${icon('sail')}${v.boat.name}</a>` : ''}
        </div>
      </div>
    </article>`;
  }

  /** Karten-Anfang: mit Titelbild (Konzept 13.2) darüber, sonst schlicht. */
  private cardStart(cover: CoverRef | null | undefined) {
    return cover ? html`<img class="cv" src=${cover.src} style="object-position: 50% ${cover.y}%" alt="" loading="lazy" decoding="async" />` : '';
  }

  private boat(b: DiscoverBoat) {
    const facts = [b.boatType, b.lengthM != null ? `${fmtNum(b.lengthM, 1)} m` : '', b.homePort].filter(Boolean).join(' · ');
    return html`<a class="card ${b.cover ? 'has-cover' : ''}" href="/b/${b.id}">
      ${this.cardStart(b.cover)}
      <span class="ic" aria-hidden="true">${icon('sail')}</span>
      <span class="txt">
        <span class="t">${b.name}</span>
        ${facts ? html`<span class="meta">${facts}</span>` : ''}
        <span class="meta">${plural(b.stats.voyages, 'Törn', 'Törns')} · ${fmtNum(b.stats.distNm, 0)} sm</span>
        <span class="meta">Eigner: ${b.owner.displayName}</span>
      </span>
    </a>`;
  }

  private person(p: DiscoverPerson) {
    return html`<a class="card ${p.cover ? 'has-cover' : ''}" href="/u/${p.handle}">
      ${this.cardStart(p.cover)}
      <span class="ic" aria-hidden="true">${p.displayName[0]}</span>
      <span class="txt">
        <span class="t">${p.displayName}</span>
        ${p.bio ? html`<span class="bio">${p.bio}</span>` : ''}
        <span class="meta">${plural(p.stats.voyages, 'Törn', 'Törns')} · ${fmtNum(p.stats.distNm, 0)} sm${p.stats.boats ? ` · ${plural(p.stats.boats, 'Boot', 'Boote')}` : ''}</span>
      </span>
    </a>`;
  }

  /** Beitreten-Knopf bzw. Hinweis je Beitrittsstufe (F-333); Gäste meldet der Controller erst an. */
  private joinControl(g: DiscoverGroup) {
    const m = this.membership;
    const action = joinAction(g.joinMode, { member: !!m?.member.includes(g.slug), requested: !!m?.requested.includes(g.slug) });
    if (!action || !g.id) return '';
    const label = JOIN_ACTION_LABEL[action];
    if (action === 'join' || action === 'request') {
      const id = g.id;
      return html`<button class="btn small join" ?disabled=${this.joining === id} aria-label="${label}: ${g.name}" @click=${() => emit(this, 'sx-group-join', { id })}>
        ${icon('user')} ${label}
      </button>`;
    }
    if (action === 'requested') return html`<button class="btn small join" disabled>${icon('check')} ${label}</button>`;
    return html`<span class="join-note">${action === 'member' ? icon('check') : ''}${label}</span>`;
  }

  /** Vereinskarte: kein Link um die ganze Karte (ein Knopf darf nicht in einem Link liegen) – der Name deckt sie ab. */
  private group(g: DiscoverGroup) {
    return html`<article class="card ${g.cover ? 'has-cover' : ''}">
      ${this.cardStart(g.cover)}
      <span class="ic" aria-hidden="true">${icon(g.kind === 'club' ? 'anchor' : 'sail')}</span>
      <span class="txt">
        <a class="t main" href="/g/${g.slug}">${g.name}</a>
        <span class="meta">${[GROUP_KIND_LABEL[g.kind], g.homePort].filter(Boolean).join(' · ')}</span>
        ${g.description ? html`<span class="bio">${g.description}</span>` : ''}
        <span class="meta">${plural(g.members, 'Mitglied', 'Mitglieder')}</span>
        ${this.joinControl(g)}
      </span>
    </article>`;
  }

  private harbor(h: DiscoverHarbor) {
    return html`<a class="card" href="/h/${h.slug}">
      <span class="ic" aria-hidden="true">${icon('anchor')}</span>
      <span class="txt">
        <span class="t">${h.name}${h.km !== undefined ? html` <span class="faint">· ${fmtKm(h.km)}</span>` : ''}</span>
        <span class="meta">${plural(h.boats, 'Boot', 'Boote')} · ${plural(h.groups, 'Verein/Team', 'Vereine/Teams')}</span>
      </span>
    </a>`;
  }

  private strip() {
    // Ohne Daten (kein Backend, Fehler) bleibt die Leiste leer; die App blendet sie dann aus.
    if (!this.data) return '';
    const list = this.data.voyages.slice(0, 6);
    const crew = [
      ...this.data.boats.slice(0, 4).map((b) => html`<a class="chip" href="/b/${b.id}" title="Boot ${b.name}">${icon('sail')}${b.name}</a>`),
      ...this.data.people.slice(0, 4).map((p) => html`<a class="chip" href="/u/${p.handle}" title="Profil von ${p.displayName}">${icon('user')}${p.displayName}</a>`),
      ...(this.data.groups ?? []).slice(0, 4).map((g) => html`<a class="chip" href="/g/${g.slug}" title="${GROUP_KIND_LABEL[g.kind]} ${g.name}">${icon(g.kind === 'club' ? 'anchor' : 'pennant')}${g.name}</a>`),
    ];
    return html`<section class="strip" aria-labelledby="strip-t">
      <header>
        <h2 class="eyebrow" id="strip-t">${icon('compass')} Entdecken · Zuletzt gesegelt</h2>
        <a href="/entdecken">Alle entdecken</a>
      </header>
      ${list.length
        ? html`<div class="row">${list.map((v) => this.voyage(v))}</div>`
        : html`<div class="empty invite">
            <strong>Noch keine öffentlichen Törns</strong>
            <span>Teile deinen ersten Törn öffentlich – er erscheint dann hier für alle.</span>
          </div>`}
      ${crew.length ? html`<div class="crew"><span class="faint">Neu dabei:</span>${crew}</div>` : ''}
    </section>`;
  }

  private section<T>(key: DiscoverSection, title: string, items: T[], render: (item: T) => unknown, empty: string, cls: string, id = '') {
    // Abschnitts-Filter (F-332); bei einer Suche bleiben unter „Alle“ nur Abschnitte mit Treffern (F-331)
    if (this.show !== 'all' && this.show !== key) return '';
    if (this.show === 'all' && this.data?.query && !items.length) return '';
    return html`<section id=${ifDefined(id || undefined)}>
      <h2 class="eyebrow">${title}</h2>
      ${items.length ? html`<div class=${cls}>${items.map(render)}</div>` : html`<div class="empty">${empty}</div>`}
    </section>`;
  }

  private onSearch(e: Event) {
    emit(this, 'sx-discover-search', { query: (e.target as HTMLInputElement).value });
  }

  /** „In der Nähe | Überall“ mit Umkreis (F-344) – ohne bekannten Mittelpunkt der Knopf „meinen Standort verwenden“. */
  private nearTools() {
    const n = this.near;
    if (!n) return '';
    const locate = html`<button class="chip" type="button" @click=${() => emit(this, 'sx-discover-locate')}>${icon('anchor')} Meinen Standort verwenden</button>`;
    return html`<div class="tabs" role="group" aria-label="Umgebung">
      <button class="chip" aria-pressed=${n.on ? 'true' : 'false'} @click=${() => !n.on && emit(this, 'sx-discover-near', { on: true })}>In der Nähe</button>
      <button class="chip" aria-pressed=${n.on ? 'false' : 'true'} @click=${() => n.on && emit(this, 'sx-discover-near', { on: false })}>Überall</button>
      ${n.on
        ? n.center
          ? html`${NEAR_RADII.map((r) => html`<button class="chip" aria-pressed=${n.radius === r ? 'true' : 'false'} @click=${() => n.radius !== r && emit(this, 'sx-discover-radius', { radius: r })}>${r} km</button>`)}
              <span class="faint near-at">um ${n.center}</span>`
          : locate
        : ''}
    </div>`;
  }

  /** Suchfeld und Abschnitts-Chips (F-331, F-332). */
  private tools() {
    return html`<div class="tools">
      ${this.nearTools()}
      <input
        type="search"
        .value=${this.query}
        maxlength=${SEARCH_LIMITS.max}
        placeholder="Häfen, Vereine, Boote, Segler, Törns suchen …"
        aria-label="Entdecken durchsuchen"
        enterkeyhint="search"
        @input=${this.onSearch}
      />
      <div class="tabs" role="group" aria-label="Abschnitt">
        ${DISCOVER_SECTIONS.map(
          ([key, label]) => html`<button class="chip" aria-pressed=${this.show === key ? 'true' : 'false'} @click=${() => (this.show = key)}>${label}</button>`,
        )}
      </div>
    </div>`;
  }

  /** Suche ohne einen einzigen Treffer (unter „Alle“). */
  private noHits(d: DiscoverData): boolean {
    return !!d.query && this.show === 'all' && ![d.voyages, d.boats, d.people, d.harbors ?? [], d.groups ?? []].some((l) => l.length);
  }

  private page() {
    let body;
    // Während einer Suche bleiben die bisherigen Treffer stehen (kein Flackern beim Tippen).
    if (this.loading && !this.data) body = html`<div class="state">Lade …</div>`;
    else if (this.error || !this.data) body = html`<div class="state">${this.error || 'Entdecken ist gerade nicht verfügbar.'}<br /><br /><a class="btn" href="/">${icon('map')} Zur Karte</a></div>`;
    else {
      const d = this.data;
      const none = d.query ? 'Keine Treffer.' : '';
      const groups = this.show === 'all' || this.show === 'groups';
      body = html`
        ${this.noHits(d) ? html`<div class="state" role="status">Keine Treffer für „${this.query.trim()}“.</div>` : ''}
        ${this.section('voyages', 'Zuletzt gesegelt', d.voyages, (v) => this.voyage(v), none || 'Noch keine öffentlichen Törns.', 'grid')}
        ${this.section('boats', 'Boote', d.boats, (b) => this.boat(b), none || 'Noch keine öffentlichen Boote.', 'grid')}
        ${this.section('people', 'Segler', d.people, (p) => this.person(p), none || 'Noch keine öffentlichen Profile.', 'grid')}
        ${d.harbors ? this.section('harbors', 'Häfen', d.harbors, (h) => this.harbor(h), none || 'Noch keine Häfen mit öffentlichen Booten.', 'grid', 'haefen') : ''}
        ${d.groups ? this.section('groups', 'Vereine und Teams', d.groups, (g) => this.group(g), none || 'Noch keine öffentlichen Vereine.', 'grid', 'vereine') : ''}
        ${d.groups && groups ? html`<p class="faint"><a href="/g/neu">Verein oder Team gründen</a></p>` : ''}
      `;
    }
    return html`<div class="page">
      <header class="hero">
        <div class="mark" aria-hidden="true">${icon('globe')}</div>
        <div>
          <h1>Entdecken</h1>
          <div class="lead">Was die Crew zuletzt öffentlich geteilt hat – Törns, Boote, Segler, Häfen, Vereine und Teams.</div>
        </div>
      </header>
      ${this.tools()} ${body}
    </div>`;
  }

  render() {
    return this.variant === 'strip' ? this.strip() : this.page();
  }
}
customElements.define('sx-discover', SxDiscover);
