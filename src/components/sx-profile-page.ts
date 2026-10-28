import { LitElement, css, html } from 'lit';
import type { Boat, CrewVoyage, FollowStats, GroupRef, HarborPageData, HarborPatch, Linkable, PageMedia, PageStats, Profile, PublicHome, ShareMeta, StreamPage } from '../services/api';
import { COVER_FOCUS_DEFAULT } from '../domain/cover';
import { VOYAGE_ROLE_SHORT } from '../domain/crew-roles';
import { VISIBILITY_LABEL, sharePath } from '../domain/visibility';
import { fmtDate, fmtNum } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';
import { VISIBILITY_ICON } from './sx-visibility-picker';
import './sx-follow';
import './sx-stream';
import './sx-page-media';
import './sx-filter-select';

/** Kurzer Hinweis für Eigentümer, wer die Seite sieht. */
const PAGE_VISIBILITY: Record<Linkable['visibility'], string> = {
  public: 'für alle sichtbar',
  unlisted: 'nur wer den Link hat',
  private: 'nur du siehst diese Seite',
};

export type PageData =
  | ({ kind: 'profile'; profile: Profile; boats: Boat[]; stats: PageStats; voyages: ShareMeta[]; crewVoyages?: CrewVoyage[]; social?: FollowStats; home?: PublicHome } & PageMedia)
  | ({ kind: 'boat'; boat: Boat; stats: PageStats; voyages: ShareMeta[]; social?: FollowStats; clubs?: GroupRef[] } & PageMedia)
  /** Hafenseite /h/<slug> (Konzept 12.2) mit Neuigkeiten des Hafens */
  | ({ kind: 'harbor'; stream?: StreamPage | null } & HarborPageData);

/** Öffentliche Profil-, Boots- bzw. Hafenseite mit Kennzahlen und gelisteten Törns. */
export class SxProfilePage extends LitElement {
  static properties = {
    data: { attribute: false },
    loading: { type: Boolean },
    error: { type: String },
    signedIn: { type: Boolean },
    streamLoading: { type: Boolean },
    editing: { state: true },
  };
  declare data: PageData | null;
  declare loading: boolean;
  declare error: string;
  /** angemeldet – „Folgen“ ohne Anmeldung öffnet den Anmeldedialog */
  declare signedIn: boolean;
  /** Hafen-Neuigkeiten: „Mehr laden“ läuft */
  declare streamLoading: boolean;
  /** Hafen bearbeiten aufgeklappt */
  declare editing: boolean;

  constructor() {
    super();
    this.data = null;
    this.loading = false;
    this.error = '';
    this.signedIn = false;
    this.streamLoading = false;
    this.editing = false;
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
      form.edit {
        display: grid;
        gap: var(--s-2);
        width: 100%;
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
      }
      form.edit .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
      }
      form.edit .row > span {
        flex: 1;
        min-width: 120px;
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

  private voyages(list: CrewVoyage[]) {
    if (!list.length) return html`<div class="empty">Noch keine öffentlichen Törns.</div>`;
    return html`<div class="cards">
      ${list.map(
        (v) => html`<a class="card" href="/s/${v.id}">
          <span class="t">${icon('map')}${v.title}</span>
          <span class="s">${v.summary || `${fmtNum(v.distNm, 1)} sm`}</span>
          <span class="s">${v.boat ? html`${icon('sail')} ${v.boat.name} · ` : ''}${fmtDate(v.startedAt ?? v.createdAt)}${v.crewRole ? ` · als ${VOYAGE_ROLE_SHORT[v.crewRole]}` : ''}</span>
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
      <sx-cover kind="u" target-id=${p.handle} .src=${d.cover ?? null} .focusY=${d.coverY ?? COVER_FOCUS_DEFAULT} ?can-edit=${p.isSelf} label="Titelbild von ${p.displayName}"></sx-cover>
      <header class="hero">
        <div class="mark" aria-hidden="true">${p.displayName[0]}</div>
        <div>
          <h1>${p.displayName}</h1>
          ${p.bio ? html`<div class="lead">${p.bio}</div>` : ''}
          ${this.homeFacts(d.home, p.isSelf ? this.ownerFacts(p) : '')}
        </div>
        <div class="actions">
          ${!p.isSelf && p.visibility === 'public' && d.social
            ? html`<sx-follow kind="user" target-id=${p.handle} label=${p.displayName} .stats=${d.social} ?signed-in=${this.signedIn}></sx-follow>`
            : ''}
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
      <sx-gallery .photos=${d.photos ?? []} heading="Fotos"></sx-gallery>
      <section><h2 class="eyebrow">Törns</h2>${this.voyages(d.voyages)}</section>
      ${d.crewVoyages?.length ? html`<section><h2 class="eyebrow">Mitgesegelt</h2>${this.voyages(d.crewVoyages)}</section>` : ''}
    `;
  }

  private boat(d: Extract<PageData, { kind: 'boat' }>) {
    const b = d.boat;
    const facts = [b.boatType, b.lengthM != null ? `${fmtNum(b.lengthM, 1)} m` : '', b.sailNumber, !b.harbor && b.homePort && `Heimathafen ${b.homePort}`].filter(Boolean);
    return html`
      <sx-cover kind="b" target-id=${b.id} .src=${d.cover ?? null} .focusY=${d.coverY ?? COVER_FOCUS_DEFAULT} ?can-edit=${!!b.role} label="Titelbild von ${b.name}"></sx-cover>
      <header class="hero">
        <div class="mark" aria-hidden="true">${icon('sail')}</div>
        <div>
          <h1>${b.name}</h1>
          ${b.description ? html`<div class="lead">${b.description}</div>` : ''}
          <div class="facts">
            ${facts.map((f) => html`<span>${f}</span>`)}
            ${b.harbor ? html`<span>Heimathafen <a href="/h/${b.harbor.slug}">${b.harbor.name}</a></span>` : ''}
            ${d.clubs?.length ? html`<span>${d.clubs.length === 1 ? 'Verein' : 'Vereine'} ${d.clubs.map((c, i) => html`${i ? ', ' : ''}<a href="/g/${c.slug}">${c.name}</a>`)}</span>` : ''}
            ${b.ownerLabel ? html`<span>Eigner: ${b.ownerLabel}</span>` : b.owner ? html`<span>Eigner: <a href="/u/${b.owner.handle}">${b.owner.displayName}</a></span>` : ''}
            ${b.role ? this.ownerFacts(b) : ''}
          </div>
        </div>
        <div class="actions">
          ${b.visibility === 'public' && d.social
            ? html`<sx-follow kind="boat" target-id=${b.id} label=${b.name} .stats=${d.social} ?signed-in=${this.signedIn}></sx-follow>`
            : ''}
          ${this.shareButton('b', b.id, b.name, 'Boot teilen', b, !!b.role)}
          ${b.role
            ? html`<button class="btn" @click=${() => emit(this, 'sx-account', 'boats')}>${icon('pencil')} Bearbeiten</button>`
            : html`<button class="btn ghost" @click=${() => emit(this, 'sx-report', { kind: 'boat', id: b.id, label: `das Boot ${b.name}` })}>${icon('flag')} Melden</button>`}
        </div>
      </header>
      ${b.role && b.hiddenAt ? html`<p class="note-hidden" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung.</p>` : ''}
      ${this.stats(d.stats)}
      <sx-gallery .photos=${d.photos ?? []} heading="Fotos"></sx-gallery>
      <section><h2 class="eyebrow">Törns</h2>${this.voyages(d.voyages)}</section>
    `;
  }

  /** Verein und Heimathafen auf dem Profil (nur, was der Server als öffentlich liefert) */
  private homeFacts(home: PublicHome | undefined, extra: unknown) {
    if (!home?.club && !home?.harbor && !extra) return '';
    return html`<div class="facts">
      ${home?.club ? html`<span>Verein <a href="/g/${home.club.slug}">${home.club.name}</a></span>` : ''}
      ${home?.harbor ? html`<span>Heimathafen <a href="/h/${home.harbor.slug}">${home.harbor.name}</a></span>` : ''}
      ${extra}
    </div>`;
  }

  private saveHarbor(e: Event, id: string) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const num = (k: string) => {
      const v = String(f.get(k) ?? '').trim().replace(',', '.');
      return v === '' ? null : Number(v);
    };
    const patch: HarborPatch = {};
    if (f.has('name')) Object.assign(patch, { name: String(f.get('name') ?? ''), lat: num('lat'), lon: num('lon') });
    if (f.has('clubId')) patch.clubId = String(f.get('clubId') ?? '') || null;
    emit(this, 'sx-harbor-save', { id, patch });
    this.editing = false;
  }

  /**
   * Hafen-Position aus dem Gerät übernehmen (F-345) – nur in die Felder des Formulars; gespeichert wird erst mit
   * „Speichern“. Häfen sind öffentliche Orte, deshalb hier genau (5 Stellen wie parseHarborPosition).
   */
  private fillPosition(e: Event) {
    const form = (e.currentTarget as HTMLElement).closest('form');
    if (!form || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const set = (name: string, v: number) => {
          const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
          if (input) input.value = String(Math.round(v * 1e5) / 1e5).replace('.', ',');
        };
        set('lat', pos.coords.latitude);
        set('lon', pos.coords.longitude);
      },
      () => {
        const hint = form.querySelector('.pos-hint');
        if (hint) hint.textContent = 'Standort nicht verfügbar – Position bitte von Hand eintragen.';
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  /** Bearbeiten: Name und Position (Anleger:in), Verein (Verwalter eines Vereins) – sonst kein Knopf. */
  private harborForm(d: Extract<PageData, { kind: 'harbor' }>) {
    const h = d.harbor;
    const clubs = d.clubChoices;
    if (!h.canEdit && !clubs.length && !d.canClearClub) return '';
    if (!this.editing) return html`<button class="btn" @click=${() => (this.editing = true)}>${icon('pencil')} Bearbeiten</button>`;
    return html`<form class="edit" @submit=${(e: Event) => this.saveHarbor(e, h.id)}>
      ${h.canEdit
        ? html`<div><label class="label" for="hn">Name</label><input id="hn" name="name" type="text" maxlength="80" required .value=${h.name} /></div>
            <div class="row">
              <span><label class="label" for="hlat">Breite</label><input id="hlat" name="lat" type="text" inputmode="decimal" placeholder="52,4" .value=${h.lat == null ? '' : String(h.lat).replace('.', ',')} /></span>
              <span><label class="label" for="hlon">Länge</label><input id="hlon" name="lon" type="text" inputmode="decimal" placeholder="13,05" .value=${h.lon == null ? '' : String(h.lon).replace('.', ',')} /></span>
            </div>
            <div class="row">
              <button class="btn small" type="button" @click=${(e: Event) => this.fillPosition(e)}>${icon('anchor')} Position von hier übernehmen</button>
              <span class="hint pos-hint" role="status">Am besten im Hafen. Ohne Position erscheint der Hafen nicht unter „Umgebung“.</span>
            </div>`
        : ''}
      ${clubs.length || d.canClearClub
        ? html`<div><label class="label" for="hc">Verein des Hafens</label>
            <sx-filter-select label="Vereine filtern"><select id="hc" name="clubId">
              <option value="">– kein Verein –</option>
              ${clubs.map((c) => html`<option value=${c.id} ?selected=${d.club?.slug === c.slug}>${c.name}</option>`)}
            </select></sx-filter-select></div>`
        : ''}
      <div class="row">
        <button class="btn" type="button" @click=${() => (this.editing = false)}>Abbrechen</button>
        <button class="btn primary" type="submit">${icon('check')} Speichern</button>
      </div>
    </form>`;
  }

  private harbor(d: Extract<PageData, { kind: 'harbor' }>) {
    const h = d.harbor;
    const pos = h.lat != null && h.lon != null ? `${fmtNum(Math.abs(h.lat), 4)}° ${h.lat >= 0 ? 'N' : 'S'}, ${fmtNum(Math.abs(h.lon), 4)}° ${h.lon >= 0 ? 'O' : 'W'}` : '';
    return html`
      <header class="hero">
        <div class="mark" aria-hidden="true">${icon('anchor')}</div>
        <div>
          <h1>${h.name}</h1>
          <div class="facts">
            <span>Hafen</span>
            ${pos ? html`<span class="num">${pos}</span>` : ''}
            ${d.club ? html`<span>Verein <a href="/g/${d.club.slug}">${d.club.name}</a></span>` : ''}
          </div>
        </div>
        <div class="actions">
          <sx-follow kind="harbor" target-id=${h.id} label=${h.name} .stats=${d.social} ?signed-in=${this.signedIn}></sx-follow>
          <button class="btn primary" @click=${() => emit(this, 'sx-page-share', { path: `/h/${h.slug}`, title: h.name })}>${icon('share')} Teilen</button>
          ${this.harborForm(d)}
          <button class="btn ghost" @click=${() => emit(this, 'sx-report', { kind: 'harbor', id: h.id, label: `den Hafen ${h.name}` })}>${icon('flag')} Melden</button>
        </div>
      </header>
      ${h.hiddenAt ? html`<p class="note-hidden" role="status">${icon('eyeOff')} Gemeldet – für andere ausgeblendet bis zur Prüfung.</p>` : ''}
      <div class="stats">
        <div class="stat"><div class="eyebrow">Boote</div><div class="v">${d.stats.boats}</div></div>
        <div class="stat"><div class="eyebrow">Törns</div><div class="v">${d.stats.voyages}</div></div>
        <div class="stat"><div class="eyebrow">Seemeilen</div><div class="v">${fmtNum(d.stats.distNm, 0)}<small>sm</small></div></div>
        <div class="stat"><div class="eyebrow">Saison</div><div class="v">${fmtNum(d.stats.seasonNm, 0)}<small>sm</small></div></div>
      </div>
      <section>
        <h2 class="eyebrow">Neuigkeiten</h2>
        <sx-stream scope="harbor" .items=${d.stream?.items ?? []} .cursor=${d.stream?.cursor ?? null} ?loading=${this.streamLoading}
          empty-text="Noch nichts los in diesem Hafen. Neue Boote und öffentliche Törns erscheinen hier."></sx-stream>
      </section>
      ${d.groups?.length
        ? html`<section>
            <h2 class="eyebrow">Vereine und Teams</h2>
            <div class="cards">
              ${d.groups.map((g) => html`<a class="card" href="/g/${g.slug}"><span class="t">${icon(g.kind === 'club' ? 'anchor' : 'sail')}${g.name}</span><span class="s">${g.kind === 'club' ? 'Verein' : 'Team'}</span></a>`)}
            </div>
          </section>`
        : ''}
      <section>
        <h2 class="eyebrow">Boote im Hafen</h2>
        ${d.boats.length
          ? html`<div class="cards">
              ${d.boats.map(
                (b) => html`<a class="card" href="/b/${b.id}">
                  <span class="t">${icon('sail')}${b.name}</span>
                  <span class="s">${[b.boatType, b.lengthM != null ? `${fmtNum(b.lengthM, 1)} m` : '', b.owner?.displayName].filter(Boolean).join(' · ') || '–'}</span>
                </a>`,
              )}
            </div>`
          : html`<div class="empty">Noch keine öffentlichen Boote. Wähle den Hafen an deinem Boot (Konto → Boote).</div>`}
      </section>
      <section><h2 class="eyebrow">Törns aus dem Hafen</h2>${this.voyages(d.voyages)}</section>
    `;
  }

  render() {
    let body;
    if (this.loading) body = html`<div class="state">Lade …</div>`;
    else if (this.error) body = html`<div class="state">${this.error}<br /><br /><a class="btn" href="/">${icon('map')} Zur Karte</a></div>`;
    else if (this.data?.kind === 'profile') body = this.profile(this.data);
    else if (this.data?.kind === 'boat') body = this.boat(this.data);
    else if (this.data?.kind === 'harbor') body = this.harbor(this.data);
    return html`<div class="page">${body}</div>`;
  }
}
customElements.define('sx-profile-page', SxProfilePage);
