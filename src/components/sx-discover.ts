import { LitElement, css, html } from 'lit';
import { shareImageUrl, type DiscoverBoat, type DiscoverData, type DiscoverPerson, type DiscoverVoyage } from '../services/api';
import { fmtDate, fmtNum, plural } from '../util/html';
import { icon } from './icons';
import { base } from './shared';

/**
 * Entdecken: zuletzt gesegelte Törns, Boote und Segler (F-70 ff.).
 * variant="strip" – kompakte Leiste unter der Einstiegskarte; variant="page" – Seite /entdecken.
 * Rein präsentational: Daten kommen vom Controller, Links sind normale Seitenwechsel.
 */
export class SxDiscover extends LitElement {
  static properties = {
    data: { attribute: false },
    variant: { type: String, reflect: true },
    loading: { type: Boolean },
    error: { type: String },
  };
  declare data: DiscoverData | null;
  declare variant: 'strip' | 'page';
  declare loading: boolean;
  declare error: string;

  constructor() {
    super();
    this.data = null;
    this.variant = 'page';
    this.loading = false;
    this.error = '';
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
      .voyage:has(a.main:focus-visible) {
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
      a.card {
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
      a.card:focus-visible {
        border-color: var(--accent);
        transform: translateY(-1px);
      }
      a.card .ic {
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
      a.card .txt {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      a.card .t {
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      a.card .bio {
        font-size: var(--fs-s);
        color: var(--text-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
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
        a.card {
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

  private boat(b: DiscoverBoat) {
    const facts = [b.boatType, b.lengthM != null ? `${fmtNum(b.lengthM, 1)} m` : '', b.homePort].filter(Boolean).join(' · ');
    return html`<a class="card" href="/b/${b.id}">
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
    return html`<a class="card" href="/u/${p.handle}">
      <span class="ic" aria-hidden="true">${p.displayName[0]}</span>
      <span class="txt">
        <span class="t">${p.displayName}</span>
        ${p.bio ? html`<span class="bio">${p.bio}</span>` : ''}
        <span class="meta">${plural(p.stats.voyages, 'Törn', 'Törns')} · ${fmtNum(p.stats.distNm, 0)} sm${p.stats.boats ? ` · ${plural(p.stats.boats, 'Boot', 'Boote')}` : ''}</span>
      </span>
    </a>`;
  }

  private strip() {
    const list = this.data?.voyages.slice(0, 6) ?? [];
    // Ohne Daten (kein Backend, Fehler, noch nichts Öffentliches) bleibt die Leiste unsichtbar.
    if (!list.length) return '';
    return html`<section class="strip" aria-labelledby="strip-t">
      <header>
        <h2 class="eyebrow" id="strip-t">Zuletzt gesegelt</h2>
        <a href="/entdecken">Alle entdecken</a>
      </header>
      <div class="row">${list.map((v) => this.voyage(v))}</div>
    </section>`;
  }

  private section<T>(title: string, items: T[], render: (item: T) => unknown, empty: string, cls: string) {
    return html`<section>
      <h2 class="eyebrow">${title}</h2>
      ${items.length ? html`<div class=${cls}>${items.map(render)}</div>` : html`<div class="empty">${empty}</div>`}
    </section>`;
  }

  private page() {
    let body;
    if (this.loading) body = html`<div class="state">Lade …</div>`;
    else if (this.error || !this.data) body = html`<div class="state">${this.error || 'Entdecken ist gerade nicht verfügbar.'}<br /><br /><a class="btn" href="/">${icon('map')} Zur Karte</a></div>`;
    else {
      const d = this.data;
      body = html`
        ${this.section('Zuletzt gesegelt', d.voyages, (v) => this.voyage(v), 'Noch keine öffentlichen Törns.', 'grid')}
        ${this.section('Boote', d.boats, (b) => this.boat(b), 'Noch keine öffentlichen Boote.', 'grid')}
        ${this.section('Segler', d.people, (p) => this.person(p), 'Noch keine öffentlichen Profile.', 'grid')}
      `;
    }
    return html`<div class="page">
      <header class="hero">
        <div class="mark" aria-hidden="true">${icon('globe')}</div>
        <div>
          <h1>Entdecken</h1>
          <div class="lead">Was die Crew zuletzt öffentlich geteilt hat – Törns, Boote und Segler.</div>
        </div>
      </header>
      ${body}
    </div>`;
  }

  render() {
    return this.variant === 'strip' ? this.strip() : this.page();
  }
}
customElements.define('sx-discover', SxDiscover);
