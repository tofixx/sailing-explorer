import { LitElement, css, html } from 'lit';
import { photoImageUrl, shareImageUrl, type StreamItem } from '../services/api';
import { linkify } from '../domain/comment-text';
import { GROUP_KIND_LABEL, streamHeadline } from '../domain/groups';
import { fmtDate, fmtDateTime, fmtNum } from '../util/html';
import { icon, type IconName } from './icons';
import { base, coverBanner, coverBannerStyles, emit } from './shared';
import './sx-reactions';

const KIND_ICON: Record<StreamItem['kind'], IconName> = {
  voyage: 'map',
  photos: 'camera',
  member: 'user',
  boat: 'sail',
  post: 'comment',
  milestone: 'pennant',
  harbor: 'anchor',
};

/**
 * Neuigkeiten (Konzept 11.3, F-160): Liste der Einträge, „Mehr laden“ per Cursor. Rein präsentational – Fremdtext
 * (Titel, Namen, Beiträge) geht nur durch Lit-Templates, Links in Beiträgen aus `linkify`, nie `innerHTML`.
 * Meldet `sx-stream-more` { scope } und `sx-post-delete` { id }.
 */
export class SxStream extends LitElement {
  static properties = {
    items: { attribute: false },
    cursor: { type: String },
    loading: { type: Boolean },
    scope: { type: String },
    emptyText: { type: String, attribute: 'empty-text' },
    /** Gruppe als Kontext (Gruppenseite): Gruppennamen nicht wiederholen */
    inGroup: { type: Boolean, attribute: 'in-group' },
  };
  declare items: StreamItem[];
  declare cursor: string | null;
  declare loading: boolean;
  /** wer „Mehr laden“ bedient: Startseite (persönlich bzw. öffentlich), Gruppen- oder Hafenseite */
  declare scope: 'home' | 'group' | 'harbor' | 'public';
  declare emptyText: string;
  declare inGroup: boolean;

  constructor() {
    super();
    this.items = [];
    this.cursor = null;
    this.loading = false;
    this.scope = 'home';
    this.emptyText = 'Noch keine Neuigkeiten.';
    this.inGroup = false;
  }

  static styles = [
    base,
    coverBannerStyles,
    css`
      /* Spaßname (F-349): kursiv mit Schloss, nicht mit einem echten Namen verwechselbar */
      .pseudo {
        font-style: italic;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .pseudo svg {
        width: 14px;
        height: 14px;
      }
      :host {
        display: block;
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
      }
      li {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr);
        gap: var(--s-3);
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
      }
      .ic {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--accent-soft);
        color: var(--accent);
      }
      .ic svg {
        width: 18px;
        height: 18px;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-2);
        align-items: baseline;
      }
      .head a {
        color: inherit;
        font-weight: 650;
      }
      .what {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      time {
        display: block;
        margin-top: var(--s-1);
        font-size: var(--fs-xs);
        color: var(--text-3);
      }
      .ctx {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .ctx a {
        color: var(--accent);
        text-decoration: none;
      }
      .body {
        margin: var(--s-2) 0 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        line-height: 1.5;
      }
      .body a,
      .link {
        color: var(--accent);
      }
      .thumbs {
        display: flex;
        gap: var(--s-1);
        margin-top: var(--s-2);
        overflow-x: auto;
      }
      .thumbs img,
      .cover,
      .banner {
        border-radius: var(--radius-s, 6px);
        object-fit: cover;
        display: block;
        background: var(--surface-2);
      }
      .thumbs img {
        width: 72px;
        height: 72px;
      }
      /* Übersichtsbild des Törns (1200 × 630, Karte mit Kennzahlen): ganz zeigen, nicht beschneiden */
      .cover,
      .banner {
        width: 100%;
        height: auto;
        margin-top: var(--s-2);
      }
      .cover {
        aspect-ratio: 1200 / 630;
      }
      .tools {
        margin-left: auto;
      }
      .reactions {
        margin-top: var(--s-2);
      }
      .more {
        margin-top: var(--s-3);
        display: flex;
        justify-content: center;
      }
      .empty {
        padding: var(--s-4);
        text-align: center;
        color: var(--text-2);
        border: 1px dashed var(--border);
        border-radius: var(--radius);
      }
    `,
  ];

  /** Text mit klickbaren http(s)-Links – Lit escaped alle Textstücke. */
  private text(t: string) {
    return linkify(t).map((p) => (p.href ? html`<a href=${p.href} rel="nofollow ugc noopener noreferrer" target="_blank">${p.text}</a>` : p.text));
  }

  private who(i: StreamItem) {
    return i.actor ? html`<a href="/u/${i.actor.handle}">${i.actor.displayName}</a>` : '';
  }

  private groupLink(i: StreamItem) {
    if (!i.group || this.inGroup) return '';
    return html`<span class="ctx">in <a href="/g/${i.group.slug}">${GROUP_KIND_LABEL[i.group.kind] ?? 'Gruppe'} ${i.group.name}</a></span>`;
  }

  private content(i: StreamItem) {
    switch (i.kind) {
      case 'voyage':
      case 'photos': {
        const v = i.voyage!;
        const facts = [`${fmtNum(v.distNm, 1)} sm`, fmtDate(v.startedAt ?? i.createdAt)];
        return html`<div class="head">
            ${this.who(i)}
            <span class="what">${i.kind === 'voyage' ? 'hat einen Törn geteilt:' : `${i.photos!.count === 1 ? '1 neues Foto' : `${i.photos!.count} neue Fotos`} zu`}
              <a href="/s/${v.id}">${v.title}</a></span>
          </div>
          <div class="ctx">${facts.join(' · ')}${v.boat ? html` · ${icon('sail')} <a href="/b/${v.boat.id}">${v.boat.name}</a>` : ''}</div>
          ${i.kind === 'photos'
            ? html`<div class="thumbs">${i.photos!.thumbs.map((id) => html`<a href="/s/${v.id}?foto=${id}"><img src=${photoImageUrl(id, 't')} alt="" loading="lazy" decoding="async" /></a>`)}</div>`
            : v.hasImage
              ? html`<a href="/s/${v.id}"><img class="cover" src=${shareImageUrl(v.id)} alt="" loading="lazy" decoding="async" /></a>`
              : ''}`;
      }
      case 'post': {
        const p = i.post!;
        return html`<div class="head">
            <span class="what">${this.inGroup ? 'Neuigkeit' : html`Neuigkeit von <a href="/g/${i.group!.slug}">${i.group!.name}</a>`}</span>
            ${i.actor ? html`<span class="ctx">von ${this.who(i)}</span>` : ''}
            ${p.canDelete
              ? html`<span class="tools"><button class="btn small ghost danger" aria-label="Beitrag löschen" @click=${() => emit(this, 'sx-post-delete', { id: p.id })}>${icon('trash')}</button></span>`
              : html`<span class="tools"><button class="btn small ghost" aria-label="Beitrag melden" @click=${() => emit(this, 'sx-report', { kind: 'post', id: p.id, label: 'diesen Beitrag' })}>${icon('flag')}</button></span>`}
          </div>
          <p class="body">${this.text(p.body)}</p>
          ${p.link ? html`<a class="link" href=${p.link} rel="nofollow ugc noopener noreferrer" target="_blank">${icon('open')} ${p.link}</a>` : ''}`;
      }
      case 'member': {
        // „<Name> ist dem Team <Gruppe> beigetreten“ (F-349); ohne öffentliches Profil der Spaßname mit Schloss
        const name = i.actor
          ? this.who(i)
          : html`<span class="pseudo" title="Spaßname – das Profil ist nicht öffentlich">${icon('lock')}${i.alias ?? 'Ein neues Mitglied'}</span>`;
        const g = i.group;
        return html`<div class="head">${name} <span class="what">ist${g && !this.inGroup
            ? html` ${g.kind === 'club' ? 'dem Verein' : 'dem Team'} <a href="/g/${g.slug}">${g.name}</a>`
            : ''} beigetreten</span></div>`;
      }
      case 'boat':
        return html`<div class="head"><span class="what">Neues Boot: <a href="/b/${i.boat!.id}">${i.boat!.name}</a></span> ${this.groupLink(i)}</div>`;
      case 'milestone': {
        const m = i.milestone!;
        return html`<div class="head"><span class="what"><a href=${m.path}>${m.name}</a> hat ${fmtNum(m.nm, 0)} Seemeilen in der Saison ${m.year} erreicht</span></div>`;
      }
      case 'harbor':
        return html`<div class="head"><span class="what">Neues Boot im Hafen <a href="/h/${i.harbor!.slug}">${i.harbor!.name}</a>: <a href="/b/${i.boat!.id}">${i.boat!.name}</a></span></div>`;
    }
  }

  /** Titelbild des Boots, der Person oder der Gruppe, um die es geht (Konzept 13.2) – verlinkt wie der Eintrag. */
  private banner(i: StreamItem) {
    if (!i.cover) return '';
    const href = i.milestone?.path ?? (i.boat ? `/b/${i.boat.id}` : i.actor ? `/u/${i.actor.handle}` : null);
    const img = coverBanner(i.cover, 'banner');
    return href ? html`<a href=${href} tabindex="-1" aria-hidden="true">${img}</a>` : img;
  }

  private item(i: StreamItem) {
    return html`<li aria-label=${streamHeadline(i)}>
      <span class="ic" aria-hidden="true">${icon(KIND_ICON[i.kind] ?? 'info')}</span>
      <div>
        ${this.content(i)} ${this.banner(i)}
        <time datetime=${new Date(i.createdAt).toISOString()}>${fmtDateTime(i.createdAt)}</time>
        ${i.reactions ? html`<sx-reactions class="reactions" .value=${i.reactions}></sx-reactions>` : ''}
      </div>
    </li>`;
  }

  render() {
    if (!this.items.length) return this.loading ? html`<div class="empty">Lade …</div>` : html`<div class="empty">${this.emptyText}</div>`;
    return html`<ol>
        ${this.items.map((i) => this.item(i))}
      </ol>
      ${this.cursor
        ? html`<div class="more"><button class="btn" ?disabled=${this.loading} @click=${() => emit(this, 'sx-stream-more', { scope: this.scope })}>${this.loading ? 'Lade …' : 'Mehr laden'}</button></div>`
        : ''}`;
  }
}
customElements.define('sx-stream', SxStream);
