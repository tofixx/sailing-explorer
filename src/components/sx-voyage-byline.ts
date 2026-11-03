import { LitElement, css, html } from 'lit';
import type { Crew, ShareMeta } from '../services/api';
import { GROUP_KIND_LABEL } from '../domain/groups';
import type { GroupKind } from '../domain/groups';
import { COMMENTS_MODES, COMMENTS_MODE_LABEL, type CommentsMode } from '../domain/comment-text';
import { ENTITY_ICON, groupIcon, icon, type IconName } from './icons';
import { base, emit } from './shared';
import './sx-title-edit';
import './sx-page-menu';
import type { PageMenuItem } from './sx-page-menu';
import { offerAttachTrack } from '../domain/track-attach';

const MODE_ICON: Record<CommentsMode, IconName> = { on: 'comment', off: 'lock', hidden: 'eyeOff' };

/**
 * Zahnrad-Menü des Törns (N6, F-510): Verwaltung, die nicht ständig sichtbar sein muss – Crew bearbeiten (Eigentümer:in
 * bzw. Skipper:in, wenn es etwas zu bearbeiten gibt), Crew verlassen (Crew-Mitglied), Kommentar-Einstellung
 * (Eigentümer:in) und Melden (alle anderen). Nur, was erlaubt ist; ohne Einträge kein Zahnrad. „GPX nachreichen“ nur für
 * die Eigentümer:in eines Fahrtenbuch-Eintrags ohne GPX (Konzept 38, F-605) – der einzige Einstieg dafür; er fehlt, wenn der
 * Löschtermin nach Törn-Regel in der Warnfrist läge (F-604, der Eintrag bliebe sonst nur noch Tage).
 */
export function voyageMenuItems(share: Pick<ShareMeta, 'isOwner' | 'commentsMode' | 'source' | 'trackExpiresAt'>, crew: Crew | null): PageMenuItem[] {
  const items: PageMenuItem[] = [];
  if (offerAttachTrack(share)) items.push({ id: 'track-attach', label: 'GPX nachreichen', icon: 'upload' });
  // Skipper:in aus der Crew bestätigt auch die Eigentümer:in – dann gibt es auch ohne weitere Mitglieder etwas zu tun
  const ownerToConfirm = !!crew?.isSkipper && !crew.isOwner && !!crew.ownerRole;
  if (crew && (crew.isOwner || crew.isSkipper) && (crew.members.length > 0 || ownerToConfirm)) items.push({ id: 'crew-edit', label: 'Crew bearbeiten', icon: 'pencil' });
  if (crew && !crew.isOwner && crew.isCrew) items.push({ id: 'crew-leave', label: 'Crew verlassen', icon: 'logout', danger: true });
  const commentsMode = share.commentsMode;
  if (share.isOwner && commentsMode) {
    COMMENTS_MODES.forEach((m, i) =>
      items.push({ id: `comments-${m}`, label: COMMENTS_MODE_LABEL[m], icon: MODE_ICON[m], pressed: m === commentsMode, divider: i === 0 && items.length > 0 }),
    );
  }
  if (!share.isOwner) items.push({ id: 'report', label: 'Törn melden', icon: 'flag', divider: items.length > 0 });
  return items;
}

/**
 * Geteilter Törn: Titel (die Eigentümer:in benennt ihn hier um, F-424), Zahnrad-Menü (F-510) und
 * „von <Profil> auf <Boot> in <Verein/Team>“ mit Links und dem Icon der Objektart – nur, was der Server freigegeben hat
 * (F-228; Boot nur, wenn der Betrachter dessen Seite öffnen darf, F-533).
 * Meldet `sx-crew-edit`, `sx-crew-leave`, `sx-comments-mode` { mode }, `sx-report` { kind, id, label } und
 * `sx-track-attach` { file } (GPX nachreichen: die Dateiauswahl öffnet direkt aus dem Klick, sonst blockt der Browser).
 */
export class SxVoyageByline extends LitElement {
  static properties = {
    share: { attribute: false },
    crew: { attribute: false },
  };
  declare share: ShareMeta | null;
  /** Crew des Törns (null = nicht geladen bzw. ohne Zugriff) – bestimmt die Crew-Einträge im Menü */
  declare crew: Crew | null;

  constructor() {
    super();
    this.share = null;
    this.crew = null;
  }

  static styles = [
    base,
    css`
      /* Steht frei in der Seitenleiste über den Panels – gleicher Seitenabstand wie deren Inhalt (sx-panel) */
      :host {
        display: grid;
        gap: var(--s-1);
        padding: var(--s-4) var(--s-4) 0;
      }
      .head {
        display: flex;
        align-items: flex-start;
        gap: var(--s-2);
      }
      .head sx-title-edit {
        flex: 1;
        min-width: 0;
      }
      p {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s-1) var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      a {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-weight: 600;
      }
      /* lange Namen (Boot, Gruppen) brechen um statt bei 375 px über den Rand zu ragen (F-533) */
      p > span,
      p a {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      input[type='file'] {
        display: none;
      }
    `,
  ];

  private onMenu(s: ShareMeta, id: string) {
    if (id === 'track-attach') this.renderRoot.querySelector<HTMLInputElement>('input[type=file]')?.click();
    else if (id === 'crew-edit') emit(this, 'sx-crew-edit');
    else if (id === 'crew-leave') emit(this, 'sx-crew-leave');
    else if (id === 'report') emit(this, 'sx-report', { kind: 'share', id: s.id, label: 'diesen Törn' });
    else if (id.startsWith('comments-')) emit(this, 'sx-comments-mode', { mode: id.slice('comments-'.length) as CommentsMode });
  }

  private onFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // zurücksetzen, damit dieselbe Datei nach einem Fehler erneut gewählt werden kann
    input.value = '';
    if (file) emit(this, 'sx-track-attach', { file });
  };

  render() {
    const s = this.share;
    if (!s) return '';
    const head = html`<div class="head">
      <sx-title-edit heading share-id=${s.id} .value=${s.title} ?editable=${s.isOwner}></sx-title-edit>
      <sx-page-menu label=${s.title || 'Törn'} .items=${voyageMenuItems(s, this.crew)}
        @sx-page-menu-pick=${(e: CustomEvent<{ id: string }>) => this.onMenu(s, e.detail.id)}></sx-page-menu>
      ${offerAttachTrack(s) ? html`<input type="file" accept=".gpx,application/gpx+xml" aria-hidden="true" tabindex="-1" @change=${this.onFile} />` : ''}
    </div>`;
    const boat = s.boatPage;
    if (!s.sailor && !boat && !s.groups?.length) return head;
    return html`${head}<p>
      ${s.sailor ? html`<span>von <a href="/u/${s.sailor.handle}" title="Profil von ${s.sailor.displayName}">${icon(ENTITY_ICON.user)}${s.sailor.displayName}</a></span>` : ''}
      ${boat ? html`<span>auf <a href="/b/${boat.id}" title="Boot ${boat.name}">${icon(ENTITY_ICON.boat)}${boat.name}</a></span>` : ''}
      ${s.groups?.length
        ? html`<span
            >in
            ${s.groups.map(
              (g, i) => html`${i ? ', ' : ''}<a href="/g/${g.slug}">${icon(groupIcon(g.kind))}${GROUP_KIND_LABEL[g.kind as GroupKind] ?? 'Gruppe'} ${g.name}</a>`,
            )}</span
          >`
        : ''}
    </p>`;
  }
}
customElements.define('sx-voyage-byline', SxVoyageByline);
