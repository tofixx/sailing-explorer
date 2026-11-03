import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { photoImageUrl, shareImageUrl, type StreamItem } from '../services/api';
import { GROUP_KIND_LABEL, streamHeadline, isAutomaticKind } from '../domain/groups';
import { dayCardText, withoutAuto } from '../domain/large-groups';
import type { ShownDay } from '../services/day-cards';
import { fmtDate, fmtDateTime, fmtNum } from '../util/html';
import { icon, type IconName } from './icons';
import { POST_KIND_ICON, base, coverBanner, coverBannerStyles, emit, highlightStyles, linkedText, logbookTag, revealCard } from './shared';
import './sx-reactions';
import './sx-poll';
import { postKeyOf } from '../domain/posts';

const KIND_ICON: Record<StreamItem['kind'], IconName> = {
  voyage: 'map',
  photos: 'camera',
  member: 'user',
  boat: 'sail',
  post: 'comment',
  milestone: 'pennant',
  harbor: 'anchor',
  logbook: 'book',
};

/**
 * Neuigkeiten (Konzept 11.3, F-160): Liste der Einträge, „Mehr laden“ per Cursor. Rein präsentational – Fremdtext
 * (Titel, Namen, Beiträge) geht nur durch Lit-Templates, Links in Beiträgen aus `linkify`, nie `innerHTML`.
 * Beiträge tragen den Anker `p-<id>` (F-406), ihre Zeitangabe ist der Permalink `/p/<id>` (bei Törns `/s/<id>`);
 * `highlight` scrollt zur Karte und hebt sie kurz hervor. Meldet `sx-stream-more` { scope } und `sx-post-delete` { id }.
 * Automatische Einträge (Beitritt, Boot, Meilenstein – `isAutomaticKind`, F-447) erscheinen als kompakte graue
 * Systemzeile ohne Kartenrahmen; `hideAuto` blendet sie aus (Schalter „Automatische Einträge“ auf dem Gerät).
 * Tageskarten (`days`, F-466) stehen nach Zeit zwischen den Einträgen: Zähler, die meistbeachteten Einträge und
 * „Alle anzeigen“ – meldet `sx-day-open` { scope, day, cursor } (erste bzw. weitere Seite des Tages, F-468).
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
    /** Beitrag hervorheben (Anker aus `/p/<id>`, neue Karte nach dem Schreiben) */
    highlight: { type: String },
    /** angepinnte Beiträge dieses Verlaufs (F-403) – über dem Stream */
    pins: { attribute: false },
    /** verwaltet den Verlauf: anpinnen, lösen, fremde Beiträge des Hafens bzw. Boots löschen */
    manage: { type: Boolean },
    /** automatische Einträge ausblenden (F-447) */
    hideAuto: { type: Boolean, attribute: 'hide-auto' },
    /** Tageskarten älterer Tage großer Verläufe (F-466) */
    days: { attribute: false },
  };
  declare items: StreamItem[];
  declare cursor: string | null;
  declare loading: boolean;
  /** wer „Mehr laden“ bedient: Startseite (persönlich bzw. öffentlich), Gruppen- oder Hafenseite */
  declare scope: 'home' | 'group' | 'harbor' | 'boat' | 'public';
  declare emptyText: string;
  declare inGroup: boolean;
  declare highlight: string | null;
  declare pins: StreamItem[];
  declare manage: boolean;
  declare hideAuto: boolean;
  declare days: ShownDay[];

  constructor() {
    super();
    this.items = [];
    this.cursor = null;
    this.loading = false;
    this.scope = 'home';
    this.emptyText = 'Noch keine Neuigkeiten.';
    this.inGroup = false;
    this.highlight = null;
    this.pins = [];
    this.manage = false;
    this.hideAuto = false;
    this.days = [];
  }

  /** Hervorgehobene Karte einmal in den Blick holen, sobald sie gerendert ist. */
  private shown: string | null = null;

  updated(changed: PropertyValues<this>) {
    if (!this.highlight || (!changed.has('highlight') && !changed.has('items')) || this.shown === this.highlight) return;
    if (revealCard(this.renderRoot as ShadowRoot, this.highlight)) this.shown = this.highlight;
  }

  static styles = [
    base,
    coverBannerStyles,
    highlightStyles,
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
      /* automatische Einträge (F-447): eine graue Zeile, kein Kartenrahmen */
      li.auto {
        grid-template-columns: 20px minmax(0, 1fr);
        gap: var(--s-2);
        padding: var(--s-1) var(--s-3);
        background: none;
        border: 0;
        color: var(--text-2);
        font-size: var(--fs-s);
      }
      li.auto .ic {
        width: 20px;
        height: 20px;
        background: none;
        color: var(--text-3);
      }
      li.auto .ic svg {
        width: 14px;
        height: 14px;
      }
      li.auto > div {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0 var(--s-2);
        min-width: 0;
      }
      li.auto .head,
      li.auto .what,
      li.auto .head a {
        font-weight: 500;
      }
      li.auto time {
        display: inline;
        margin: 0;
      }
      li.auto .cover {
        display: none;
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
      a.when {
        color: inherit;
        text-decoration: none;
      }
      a.when:hover time {
        text-decoration: underline;
      }
      .attach {
        display: inline-flex;
        gap: var(--s-1);
        align-items: center;
        margin-top: var(--s-2);
        font-size: var(--fs-s);
      }
      .attach a {
        color: var(--accent);
      }
      .pins {
        margin-bottom: var(--s-3);
      }
      .pins .eyebrow {
        display: flex;
        align-items: center;
        gap: var(--s-1);
        margin-bottom: var(--s-2);
      }
      li.pinned {
        border-color: var(--accent);
      }
      /* Tageskarte (F-466): Zähler als Kopf, Vorschau bzw. aufgeklappte Einträge als innere Liste ohne eigenen Rahmen */
      li.day {
        background: var(--surface-2, var(--surface));
      }
      li.day > div {
        display: grid;
        gap: var(--s-2);
        min-width: 0;
      }
      li.day ol li {
        grid-template-columns: minmax(0, 1fr);
        border: 0;
        border-top: 1px solid var(--border-soft);
        border-radius: 0;
        padding: var(--s-2) 0 0;
        background: none;
      }
      li.day ol li > .ic {
        display: none;
      }
      li.day .more {
        margin-top: 0;
        justify-content: flex-start;
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
            <span class="what">${i.kind === 'voyage' ? (v.logbook ? 'hat einen Törn ins Fahrtenbuch eingetragen:' : 'hat einen Törn geteilt:') : `${i.photos!.count === 1 ? '1 neues Foto' : `${i.photos!.count} neue Fotos`} zu`}
              <a href="/s/${v.id}">${v.title}</a></span>
          </div>
          <div class="ctx">${facts.join(' · ')}${v.boat ? html` · ${icon('sail')} <a href="/b/${v.boat.id}">${v.boat.name}</a>` : ''}${v.logbook ? html` ${logbookTag()}` : ''}</div>
          ${i.kind === 'photos'
            ? html`<div class="thumbs" data-scroll-x>${i.photos!.thumbs.map((id) => html`<a href="/s/${v.id}?foto=${id}"><img src=${photoImageUrl(id, 't')} alt="" loading="lazy" decoding="async" /></a>`)}</div>`
            : v.hasImage
              ? html`<a href="/s/${v.id}"><img class="cover" src=${shareImageUrl(v.id)} alt="" loading="lazy" decoding="async" /></a>`
              : ''}`;
      }
      case 'post':
        return this.post(i);
      case 'logbook': {
        // gebündelte Nachträge (F-308): bis zu fünf Einträge verlinkt
        const l = i.logbook!;
        return html`<div class="head">
            ${this.who(i)}
            <span class="what">hat ${l.count === 1 ? 'einen Törn' : `${l.count} Törns`} ins Fahrtenbuch nachgetragen</span>
          </div>
          <div class="ctx">${fmtNum(l.distNm, 0)} sm · ${l.voyages.map((v, n) => html`${n ? ', ' : ''}<a href="/s/${v.id}">${v.title}</a>`)}${l.count > l.voyages.length ? ' …' : ''}
            ${logbookTag()}</div>`;
      }
      case 'member': {
        // „<Name> ist dem Team <Gruppe> beigetreten“ (F-349); ohne öffentliches Profil der Spaßname mit Schloss
        const name = i.actor
          ? this.who(i)
          : i.alias
            ? html`<span class="pseudo" title="Spaßname – das Profil ist nicht öffentlich">${icon('lock')}${i.alias}</span>`
            : html`<span>Ein neues Mitglied</span>`;
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

  /** Wo steht der Beitrag: Gruppe, Hafen, Boot oder Profil der Person (F-425). */
  private postWhat(i: StreamItem) {
    const w = i.post?.where;
    if (i.group) return this.inGroup ? 'Neuigkeit' : html`Neuigkeit von <a href="/g/${i.group.slug}">${i.group.name}</a>`;
    if (w?.kind === 'harbor') return this.scope === 'harbor' ? 'Beitrag im Hafen' : html`Beitrag im Hafen <a href="/h/${w.slug}">${w.name}</a>`;
    if (w?.kind === 'boat') return this.scope === 'boat' ? 'Beitrag am Boot' : html`Beitrag am Boot <a href="/b/${w.id}">${w.name}</a>`;
    return 'Beitrag';
  }

  /** Beitrag (F-406, F-426): Text, Link, angehängter Törn, Teilen, Löschen bzw. Melden. */
  private post(i: StreamItem) {
    const p = i.post!;
    const pinned = this.pins.some((x) => x.post?.id === p.id);
    return html`<div class="head">
        <span class="what">${this.postWhat(i)}</span>
        ${i.actor ? html`<span class="ctx">von ${this.who(i)}</span>` : ''}
        <span class="tools">
          ${this.manage
            ? html`<button class="btn small ghost" aria-label=${pinned ? 'Lösen' : 'Anpinnen'} title=${pinned ? 'Lösen' : 'Anpinnen'}
                @click=${() => emit(this, 'sx-pin', { postId: p.id, pinned: !pinned })}>${icon('pin')}</button>`
            : ''}
          ${p.canDelete || (this.manage && p.where?.kind === this.scope)
            ? html`<button class="btn small ghost danger" aria-label="Beitrag löschen" @click=${() => emit(this, 'sx-post-delete', { id: p.id })}>${icon('trash')}</button>`
            : html`<button class="btn small ghost" aria-label="Beitrag melden" @click=${() => emit(this, 'sx-report', { kind: 'post', id: p.id, label: 'diesen Beitrag' })}>${icon('flag')}</button>`}
        </span>
      </div>
      <p class="body">${linkedText(p.body)}</p>
      ${this.kindPayload(p)}
      ${p.link ? html`<a class="link" href=${p.link} rel="nofollow ugc noopener noreferrer" target="_blank">${icon('open')} ${p.link}</a>` : ''}
      ${p.voyage ? html`<span class="attach">${icon('map')} Törn: <a href="/s/${p.voyage.id}">${p.voyage.title}</a> · ${fmtNum(p.voyage.distNm, 1)} sm</span>` : ''}`;
  }

  /**
   * Nutzlast je Art unter dem Text (Konzept 21.4, 29): Umfrage → `sx-poll`. Neue Arten (Veranstaltung …) eine Zeile.
   * Der Schlüssel „Nur mit Link“ steckt in der Einzelkarte im Pfad `/p/<id>/<schlüssel>`.
   */
  private kindPayload(p: NonNullable<StreamItem['post']>) {
    const key = postKeyOf(p.path);
    if (p.poll) return html`<sx-poll .poll=${p.poll} post-id=${p.id} .shareKey=${key}></sx-poll>`;
    return nothing;
  }

  /** Titelbild des Boots, der Person oder der Gruppe, um die es geht (Konzept 13.2) – verlinkt wie der Eintrag. */
  private banner(i: StreamItem) {
    if (!i.cover) return '';
    const href = i.milestone?.path ?? (i.boat ? `/b/${i.boat.id}` : i.actor ? `/u/${i.actor.handle}` : null);
    const img = coverBanner(i.cover, 'banner');
    return href ? html`<a href=${href} tabindex="-1" aria-hidden="true">${img}</a>` : img;
  }

  /** Zeitangabe als Permalink (Beitrag `/p/<id>`, Törn `/s/<id>`), sonst nur die Zeit. */
  private when(i: StreamItem) {
    const t = html`<time datetime=${new Date(i.createdAt).toISOString()}>${fmtDateTime(i.createdAt)}</time>`;
    const href = i.kind === 'post' && i.post ? (i.post.path ?? `/p/${i.post.id}`) : i.voyage && (i.kind === 'voyage' || i.kind === 'photos') ? `/s/${i.voyage.id}` : null;
    return href ? html`<a class="when" href=${href} title="Link zu diesem Eintrag">${t}</a>` : t;
  }

  /** Systemzeile (F-447): Symbol, ein Satz, Zeit – grau, ohne Rahmen, ohne Titelbild; Reaktionen klein dahinter. */
  private autoItem(i: StreamItem) {
    return html`<li class="auto" aria-label=${streamHeadline(i)}>
      <span class="ic" aria-hidden="true">${icon(KIND_ICON[i.kind] ?? 'info')}</span>
      <div>${this.content(i)} ${this.when(i)}
        ${i.reactions ? html`<sx-reactions class="reactions" .value=${i.reactions}></sx-reactions>` : ''}</div>
    </li>`;
  }

  private item(i: StreamItem, asPin = false) {
    if (!asPin && isAutomaticKind(i.kind)) return this.autoItem(i);
    const pid = i.kind === 'post' ? i.post?.id : undefined;
    const hl = !asPin && !!pid && pid === this.highlight;
    return html`<li aria-label=${streamHeadline(i)} id=${pid && !asPin ? `p-${pid}` : nothing} class=${hl ? 'hl' : asPin ? 'pinned' : nothing} tabindex=${hl ? -1 : nothing}>
      <span class="ic" aria-hidden="true">${icon((i.post?.kind && POST_KIND_ICON[i.post.kind]) || (KIND_ICON[i.kind] ?? 'info'))}</span>
      <div>
        ${this.content(i)} ${this.banner(i)}
        ${this.when(i)}
        ${i.reactions ? html`<sx-reactions class="reactions" .value=${i.reactions}></sx-reactions>` : ''}
      </div>
    </li>`;
  }

  /** Tageskarte (F-466): Zähler, Vorschau der meistbeachteten bzw. alle geladenen Einträge, „Alle anzeigen“. */
  private dayCard(d: ShownDay) {
    const shown = this.visible(d.open ? d.open.items : d.top);
    const next = d.open ? d.open.cursor : null;
    return html`<li class="day" aria-label=${dayCardText(d)}>
      <span class="ic" aria-hidden="true">${icon('book')}</span>
      <div>
        <div class="head"><strong class="what">${dayCardText(d)}</strong></div>
        ${shown.length ? html`<ol>${shown.map((i) => this.item(i))}</ol>` : ''}
        ${!d.open || next
          ? html`<div class="more"><button class="btn" type="button" ?disabled=${this.loading}
              @click=${() => emit(this, 'sx-day-open', { scope: this.scope, day: d.day, cursor: next })}>${d.open ? 'Weitere laden' : `Alle anzeigen (${d.count}${d.more ? '+' : ''})`}</button></div>`
          : ''}
      </div>
    </li>`;
  }

  private visible(items: StreamItem[]) {
    return this.hideAuto ? items.filter((i) => !isAutomaticKind(i.kind)) : items;
  }

  /**
   * Einträge und Tageskarten nach Zeit (neueste zuerst); die Karte steht über den Einzelnen ihres Tages. Ohne
   * automatische Einträge zählen Beitritte, Boote und Meilensteine auch in den Karten nicht (F-447).
   */
  private entries() {
    const days = this.days
      .flatMap((d) => {
        const c = this.hideAuto ? withoutAuto(d) : d;
        return c ? [{ ...d, ...c }] : [];
      })
      .sort((a, b) => b.at - a.at);
    const out: Array<{ item: StreamItem } | { day: ShownDay }> = [];
    let k = 0;
    for (const item of this.visible(this.items)) {
      while (k < days.length && days[k].at >= item.createdAt) out.push({ day: days[k++] });
      out.push({ item });
    }
    while (k < days.length) out.push({ day: days[k++] });
    return out;
  }

  render() {
    // „Mehr laden“ auch bei leerer Liste, solange es weitergeht – sonst bliebe ein ganz weggefilterter Stand stecken (F-350)
    const more = this.cursor
      ? html`<div class="more"><button class="btn" ?disabled=${this.loading} @click=${() => emit(this, 'sx-stream-more', { scope: this.scope })}>${this.loading ? 'Lade …' : 'Mehr laden'}</button></div>`
      : '';
    // Pins (F-403) über dem Stream; ihre Karten stehen unten zusätzlich an ihrer Stelle
    const pinned = this.pins.length
      ? html`<section class="pins" aria-label="Angepinnt"><p class="eyebrow">${icon('pin')} Angepinnt</p><ol>${this.pins.map((i) => this.item(i, true))}</ol></section>`
      : '';
    const items = this.entries();
    if (!items.length) return html`${pinned}${this.loading ? html`<div class="empty">Lade …</div>` : html`<div class="empty">${this.emptyText}</div>`}${more}`;
    return html`${pinned}<ol>
        ${items.map((e) => ('day' in e ? this.dayCard(e.day) : this.item(e.item)))}
      </ol>
      ${more}`;
  }
}
customElements.define('sx-stream', SxStream);
