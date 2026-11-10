import { LitElement, css, html, type PropertyValues } from 'lit';
import type { CommentThread } from '../services/api';
import { icon } from './icons';
import { base } from './shared';
import './sx-comments';

/**
 * „Kommentare“ unter einer Beitragskarte (Konzept 40, F-643) – der eine Einstieg in Stream, Profil und „Mein Verlauf“:
 * Knopf zum Aufklappen (`aria-expanded`), darunter eine `sx-comments` für genau diesen Beitrag, die ihre Daten erst dann
 * anfordert (`sx-comments-load`); ihre Ereignisse bedient der CommunityController. `open` klappt von außen auf (Anker
 * `/p/<id>`, z. B. aus der Glocke). `postKey`: Schlüssel bei „Nur mit Link“.
 */
export class SxPostComments extends LitElement {
  static properties = {
    postId: { type: String, attribute: 'post-id' },
    postKey: { attribute: false },
    open: { type: Boolean, reflect: true },
  };
  declare postId: string;
  declare postKey: string | null;
  declare open: boolean;

  constructor() {
    super();
    this.postId = '';
    this.postKey = null;
    this.open = false;
  }

  /** fester Verlauf je Beitrag (gleiches Objekt über Neu-Renders, sonst lüde `sx-comments` erneut) */
  private thread: CommentThread | null = null;

  willUpdate(changed: PropertyValues<this>) {
    if (!this.thread || changed.has('postId') || changed.has('postKey')) this.thread = { kind: 'post', id: this.postId, key: this.postKey };
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-2);
        margin-top: var(--s-2);
        justify-items: start;
        min-width: 0;
      }
      sx-comments {
        justify-self: stretch;
        padding-top: var(--s-2);
        border-top: 1px solid var(--border-soft);
      }
      .btn svg {
        width: 15px;
        height: 15px;
      }
      @media (pointer: coarse) {
        .btn {
          min-height: 44px;
        }
      }
    `,
  ];

  render() {
    return html`<button class="btn small ghost" type="button" aria-expanded=${this.open ? 'true' : 'false'} aria-controls="k"
        @click=${() => (this.open = !this.open)}>${icon('comment')} Kommentare</button>
      ${this.open ? html`<sx-comments id="k" autoload .thread=${this.thread}></sx-comments>` : ''}`;
  }
}
customElements.define('sx-post-comments', SxPostComments);
