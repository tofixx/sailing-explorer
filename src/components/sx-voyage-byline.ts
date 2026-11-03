import { LitElement, css, html } from 'lit';
import type { ShareMeta } from '../services/api';
import { GROUP_KIND_LABEL } from '../domain/groups';
import type { GroupKind } from '../domain/groups';
import { icon } from './icons';
import { base } from './shared';
import './sx-title-edit';

/**
 * Geteilter Törn: Titel (die Eigentümer:in benennt ihn hier um, F-424) und „von <Profil> · in <Verein/Team>“ mit
 * Links – nur, was der Server freigegeben hat (F-228).
 */
export class SxVoyageByline extends LitElement {
  static properties = { share: { attribute: false } };
  declare share: ShareMeta | null;

  constructor() {
    super();
    this.share = null;
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
    `,
  ];

  render() {
    const s = this.share;
    if (!s) return '';
    const title = html`<sx-title-edit heading share-id=${s.id} .value=${s.title} ?editable=${s.isOwner}></sx-title-edit>`;
    if (!s.sailor && !s.groups?.length) return title;
    return html`${title}<p>
      ${s.sailor ? html`<span>von <a href="/u/${s.sailor.handle}" title="Profil von ${s.sailor.displayName}">${icon('user')}${s.sailor.displayName}</a></span>` : ''}
      ${s.groups?.length
        ? html`<span
            >in
            ${s.groups.map(
              (g, i) => html`${i ? ', ' : ''}<a href="/g/${g.slug}">${icon('sail')}${GROUP_KIND_LABEL[g.kind as GroupKind] ?? 'Gruppe'} ${g.name}</a>`,
            )}</span
          >`
        : ''}
    </p>`;
  }
}
customElements.define('sx-voyage-byline', SxVoyageByline);
