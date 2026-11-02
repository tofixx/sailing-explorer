import { LitElement, html } from 'lit';
import { GROUP_KIND_LABEL } from '../domain/groups';
import { whoSeesLabel, type ProfilePost } from '../domain/posts';
import { fmtDateTime } from '../util/html';
import { icon } from './icons';
import { POST_VISIBILITY_ICON, base, emit, linkedText, postCardStyles } from './shared';

/**
 * Beiträge einer Person für Besucher (F-420): im Profil und in Gruppen, die der Betrachter sehen darf – der Server
 * prüft, hier wird nur gezeigt. „Wo steht es“ nennt die Gruppe; „Nur Mitglieder“ ist gekennzeichnet. Meldet `sx-report`.
 */
export class SxProfilePosts extends LitElement {
  static properties = { items: { attribute: false }, preview: { type: Boolean } };
  declare items: ProfilePost[];
  /** in der Vorschau „Ansehen als …“ kein Melden */
  declare preview: boolean;

  constructor() {
    super();
    this.items = [];
    this.preview = false;
  }

  static styles = [base, postCardStyles];

  render() {
    if (!this.items.length) return '';
    return html`<ol class="posts">
      ${this.items.map(
        (p) => html`<li class="post" id="p-${p.id}">
          <div class="head">
            ${icon('comment')}
            <span class="t">${p.group ? html`Beitrag in <a href="/g/${p.group.slug}">${GROUP_KIND_LABEL[p.group.kind]} ${p.group.name}</a>` : 'Beitrag'}</span>
            ${this.preview
              ? ''
              : html`<button class="btn small ghost" aria-label="Beitrag melden" @click=${() => emit(this, 'sx-report', { kind: 'post', id: p.id, label: 'diesen Beitrag' })}>${icon('flag')}</button>`}
          </div>
          <p class="body">${linkedText(p.body)}</p>
          ${p.link ? html`<a class="link" href=${p.link} rel="nofollow ugc noopener noreferrer" target="_blank">${icon('open')} ${p.link}</a>` : ''}
          <div class="meta">
            ${p.visibility !== 'public' ? html`<span>${icon(POST_VISIBILITY_ICON[p.visibility])} ${whoSeesLabel(p.visibility, p.group?.name)}</span>` : ''}
            <span>${fmtDateTime(p.createdAt)}</span>
          </div>
        </li>`,
      )}
    </ol>`;
  }
}
customElements.define('sx-profile-posts', SxProfilePosts);
