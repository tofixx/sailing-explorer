import { LitElement, css, html } from 'lit';
import type { ShareMeta } from '../services/api';
import { GROUP_KIND_LABEL } from '../domain/groups';
import type { GroupKind } from '../domain/groups';
import { icon } from './icons';
import { base } from './shared';

/** Geteilter Törn: „von <Profil> · in <Verein/Team>“ mit Links – nur, was der Server freigegeben hat (F-228). */
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
      :host {
        display: block;
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
    if (!s?.sailor && !s?.groups?.length) return '';
    return html`<p>
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
