import { LitElement, css, html } from 'lit';
import type { Boat, Linkable, PageStats, Profile, ShareMeta } from '../services/api';
import { VISIBILITY_LABEL, sharePath } from '../domain/visibility';
import { fmtDate, fmtNum } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';
import { VISIBILITY_ICON } from './sx-visibility-picker';

/** Kurzer Hinweis für Eigentümer, wer die Seite sieht. */
const PAGE_VISIBILITY: Record<Linkable['visibility'], string> = {
  public: 'für alle sichtbar',
  unlisted: 'nur wer den Link hat',
  private: 'nur du siehst diese Seite',
};

export type PageData =
  | { kind: 'profile'; profile: Profile; boats: Boat[]; stats: PageStats; voyages: ShareMeta[]; crewVoyages?: ShareMeta[] }
  | { kind: 'boat'; boat: Boat; stats: PageStats; voyages: ShareMeta[] };

/** Öffentliche Profil- bzw. Bootsseite mit Kennzahlen und gelisteten Törns. */
export class SxProfilePage extends LitElement {
  static properties = {
    data: { attribute: false },
    loading: { type: Boolean },
    error: { type: String },
  };
  declare data: PageData | null;
  declare loading: boolean;
  declare error: string;

  constructor() {
    super();
    this.data = null;
    this.loading = false;
    this.error = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        overflow-y: auto;
        background: var(--bg);
      }
      .page {
        max-width: 820px;
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
      .note-hidden {
        margin: 0;
        display: flex;
        gap: var(--s-2);
        align-items: center;
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        background: var(--warn-bg);
        font-size: var(--fs-s);
      }
      .hero::after {
        /* angedeutete Wellenlinie */
        content: '';
        position: absolute;
        inset: auto 0 0 0;
        height: 28px;
        opacity: 0.35;
        background: radial-gradient(14px 8px at 14px 0, transparent 13px, var(--accent) 14px, transparent 15px) 0 6px / 28px 14px repeat-x;
      }
      .mark {
        flex: none;
        width: 72px;
        height: 72px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--accent);
        color: var(--on-accent);
        font-size: 30px;
        font-weight: 750;
        text-transform: uppercase;
        box-shadow: var(--shadow-1);
      }
      .mark svg {
        width: 38px;
        height: 38px;
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
      .facts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-3);
        margin-top: var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .facts a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      .facts .vis {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .facts .vis svg {
        width: 14px;
        height: 14px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        margin-left: auto;
        align-self: flex-start;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: var(--s-2);
      }
      .stat {
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
      }
      .stat .v {
        font-size: var(--fs-num-l);
        font-weight: 720;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .stat .v small {
        font-size: var(--fs-s);
        color: var(--text-2);
        margin-left: 2px;
      }
      section {
        display: grid;
        gap: var(--s-3);
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: var(--s-3);
      }
      a.card {
        display: grid;
        gap: var(--s-1);
        padding: var(--s-3) var(--s-4);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
        color: inherit;
        text-decoration: none;
        transition: border-color 0.15s var(--ease), transform 0.15s var(--ease);
      }
      a.card:hover,
      a.card:focus-visible {
        border-color: var(--accent);
        transform: translateY(-1px);
      }
      .card .t {
        font-weight: 650;
        display: flex;
        gap: var(--s-2);
        align-items: center;
      }
      .card .t svg {
        color: var(--accent);
      }
      .card .s {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .empty,
      .state {
        padding: var(--s-5);
        text-align: center;
        color: var(--text-2);
        border: 1px dashed var(--border);
        border-radius: var(--radius);
      }
      @media (max-width: 560px) {
        .hero {
          flex-wrap: wrap;
        }
        .actions {
          margin-left: 0;
        }
      }
    `,
  ];

  private voyages(list: ShareMeta[]) {
    if (!list.length) return html`<div class="empty">Noch keine öffentlichen Törns.</div>`;
    return html`<div class="cards">
      ${list.map(
        (v) => html`<a class="card" href="/s/${v.id}">
          <span class="t">${icon('map')}${v.title}</span>
          <span class="s">${v.summary || `${fmtNum(v.distNm, 1)} sm`}</span>
          <span class="s">${v.boat ? html`${icon('sail')} ${v.boat.name} · ` : ''}${fmtDate(v.startedAt ?? v.createdAt)}</span>
        </a>`,
      )}
    </div>`;
  }

  /**
   * Eigentümer (bzw. Boots-Admins): Stufe der Seite; bei „Nur mit Link“ den Link kopieren.
   * Ändern und Erneuern geht über „Bearbeiten“ (Konto).
   */
  private ownerFacts(o: Linkable) {
    const v = o.visibility;
    return html`<span class="vis">${icon(VISIBILITY_ICON[v] ?? 'lock')} ${VISIBILITY_LABEL[v] ?? v} – ${PAGE_VISIBILITY[v] ?? ''}</span>
`;
  }

  /**
   * „Profil/Boot teilen“: Eigentümer teilen ihren Link (bei „Nur mit Link“ mit Schlüssel), Besucher die Adresse,
   * über die sie gekommen sind. Private Seiten sieht nur der Eigentümer – dort gibt es nichts zu teilen.
   */
  private shareButton(kind: 'b' | 'u', id: string, title: string, label: string, o: Partial<Linkable> & { visibility?: Linkable['visibility'] }, owner: boolean) {
    if (owner && o.visibility === 'private') return '';
    const path = owner && o.visibility ? o.link || sharePath(kind, id, o.visibility, o.shareKey ?? null) : location.pathname;
    return html`<button class="btn primary" @click=${() => emit(this, 'sx-page-share', { path, title })}>${icon('share')} ${label}</button>`;
  }

  private stats(s: PageStats) {
    const avg = s.voyages ? s.distNm / s.voyages : 0;
    return html`<div class="stats">
      <div class="stat"><div class="eyebrow">Seemeilen</div><div class="v">${fmtNum(s.distNm, 0)}<small>sm</small></div></div>
      <div class="stat"><div class="eyebrow">Törns</div><div class="v">${s.voyages}</div></div>
      <div class="stat"><div class="eyebrow">Ø pro Törn</div><div class="v">${fmtNum(avg, 1)}<small>sm</small></div></div>
    </div>`;
  }

  private profile(d: Extract<PageData, { kind: 'profile' }>) {
    const p = d.profile;
    return html`
      <header class="hero">
        <div class="mark" aria-hidden="true">${p.displayName[0]}</div>
        <div>
          <h1>${p.displayName}</h1>
          ${p.bio ? html`<div class="lead">${p.bio}</div>` : ''}
          ${p.isSelf ? html`<div class="facts">${this.ownerFacts(p)}</div>` : ''}
        </div>
        <div class="actions">
          ${this.shareButton('u', p.handle, p.displayName, 'Profil teilen', p, !!p.isSelf)}
          ${p.isSelf
            ? html`<button class="btn" @click=${() => emit(this, 'sx-account', 'profile')}>${icon('pencil')} Bearbeiten</button>`
            : html`<button class="btn ghost" @click=${() => emit(this, 'sx-report', { kind: 'profile', id: p.handle, label: `das Profil von ${p.displayName}` })}>${icon('flag')} Melden</button>`}
        </div>
      </header>
      ${p.isSelf && p.hiddenAt ? html`<p class="note-hidden" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung.</p>` : ''}
      ${this.stats(d.stats)}
      ${d.boats.length
        ? html`<section>
            <h2 class="eyebrow">Boote</h2>
            <div class="cards">
              ${d.boats.map(
                (b) => html`<a class="card" href="/b/${b.id}">
                  <span class="t">${icon('sail')}${b.name}</span>
                  <span class="s">${[b.boatType, b.lengthM != null ? `${fmtNum(b.lengthM, 1)} m` : ''].filter(Boolean).join(' · ') || '–'}</span>
                </a>`,
              )}
            </div>
          </section>`
        : ''}
      <section><h2 class="eyebrow">Törns</h2>${this.voyages(d.voyages)}</section>
      ${d.crewVoyages?.length ? html`<section><h2 class="eyebrow">Mitgesegelt</h2>${this.voyages(d.crewVoyages)}</section>` : ''}
    `;
  }

  private boat(d: Extract<PageData, { kind: 'boat' }>) {
    const b = d.boat;
    const facts = [b.boatType, b.lengthM != null ? `${fmtNum(b.lengthM, 1)} m` : '', b.sailNumber, b.homePort && `Heimathafen ${b.homePort}`].filter(Boolean);
    return html`
      <header class="hero">
        <div class="mark" aria-hidden="true">${icon('sail')}</div>
        <div>
          <h1>${b.name}</h1>
          ${b.description ? html`<div class="lead">${b.description}</div>` : ''}
          <div class="facts">
            ${facts.map((f) => html`<span>${f}</span>`)}
            ${b.owner ? html`<span>Eigner: <a href="/u/${b.owner.handle}">${b.owner.displayName}</a></span>` : ''}
            ${b.role ? this.ownerFacts(b) : ''}
          </div>
        </div>
        <div class="actions">
          ${this.shareButton('b', b.id, b.name, 'Boot teilen', b, !!b.role)}
          ${b.role
            ? html`<button class="btn" @click=${() => emit(this, 'sx-account', 'boats')}>${icon('pencil')} Bearbeiten</button>`
            : html`<button class="btn ghost" @click=${() => emit(this, 'sx-report', { kind: 'boat', id: b.id, label: `das Boot ${b.name}` })}>${icon('flag')} Melden</button>`}
        </div>
      </header>
      ${b.role && b.hiddenAt ? html`<p class="note-hidden" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung.</p>` : ''}
      ${this.stats(d.stats)}
      <section><h2 class="eyebrow">Törns</h2>${this.voyages(d.voyages)}</section>
    `;
  }

  render() {
    let body;
    if (this.loading) body = html`<div class="state">Lade …</div>`;
    else if (this.error) body = html`<div class="state">${this.error}<br /><br /><a class="btn" href="/">${icon('map')} Zur Karte</a></div>`;
    else if (this.data?.kind === 'profile') body = this.profile(this.data);
    else if (this.data?.kind === 'boat') body = this.boat(this.data);
    return html`<div class="page">${body}</div>`;
  }
}
customElements.define('sx-profile-page', SxProfilePage);
