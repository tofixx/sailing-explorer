import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { GROUP_KIND_LABEL } from '../domain/groups';
import { whoSeesLabel, type ProfilePost } from '../domain/posts';
import { fmtDateTime } from '../util/html';
import { icon } from './icons';
import { kindCardLink, POST_VISIBILITY_ICON, base, emit, highlightStyles, linkedText, postCardStyles, revealCard } from './shared';
import './sx-post-comments';

/**
 * Beiträge einer Person für Besucher (F-420): im Profil und in Gruppen, die der Betrachter sehen darf – der Server
 * prüft, hier wird nur gezeigt. „Wo steht es“ nennt die Gruppe; „Nur Mitglieder“ ist gekennzeichnet. Meldet `sx-report`.
 * Kommentare zum Aufklappen (`sx-post-comments`, Konzept 40) – nicht in der Vorschau „Ansehen als …“.
 */
export class SxProfilePosts extends LitElement {
  static properties = { items: { attribute: false }, preview: { type: Boolean }, highlight: { type: String } };
  declare items: ProfilePost[];
  /** in der Vorschau „Ansehen als …“ kein Melden */
  declare preview: boolean;
  /** Beitrag aus `/p/<id>` hervorheben (F-406) */
  declare highlight: string | null;

  constructor() {
    super();
    this.items = [];
    this.preview = false;
    this.highlight = null;
  }

  static styles = [base, postCardStyles, highlightStyles];

  private shown: string | null = null;

  updated(changed: PropertyValues<this>) {
    if (!this.highlight || (!changed.has('highlight') && !changed.has('items')) || this.shown === this.highlight) return;
    if (revealCard(this.renderRoot as ShadowRoot, this.highlight)) this.shown = this.highlight;
  }

  render() {
    if (!this.items.length) return '';
    return html`<ol class="posts">
      ${this.items.map(
        (p) => html`<li class="post ${p.id === this.highlight ? 'hl' : ''}" id="p-${p.id}" tabindex=${p.id === this.highlight ? -1 : nothing}>
          <div class="head">
            ${p.pinned ? html`<span title="Angepinnt">${icon('pin')}</span>` : icon('comment')}
            <span class="t">${p.group ? html`Beitrag in <a href="/g/${p.group.slug}">${GROUP_KIND_LABEL[p.group.kind]} ${p.group.name}</a>` : 'Beitrag'}</span>
            ${this.preview
              ? ''
              : html`<button class="btn small ghost" aria-label="Beitrag melden" @click=${() => emit(this, 'sx-report', { kind: 'post', id: p.id, label: 'diesen Beitrag' })}>${icon('flag')}</button>`}
          </div>
          ${p.body ? html`<p class="body">${linkedText(p.body)}</p>` : ''}
          ${kindCardLink(p.kind, `/p/${p.id}`)}
          ${p.link ? html`<a class="link" href=${p.link} rel="nofollow ugc noopener noreferrer" target="_blank">${icon('open')} ${p.link}</a>` : ''}
          <div class="meta">
            ${p.visibility !== 'public' ? html`<span>${icon(POST_VISIBILITY_ICON[p.visibility])} ${whoSeesLabel(p.visibility, p.group?.name)}</span>` : ''}
            <span>${fmtDateTime(p.createdAt)}</span>
          </div>
          ${this.preview ? '' : html`<sx-post-comments post-id=${p.id} ?open=${p.id === this.highlight}></sx-post-comments>`}
        </li>`,
      )}
    </ol>`;
  }
}
customElements.define('sx-profile-posts', SxProfilePosts);
