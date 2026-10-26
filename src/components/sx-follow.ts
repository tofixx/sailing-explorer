import { LitElement, css, html } from 'lit';
import type { FollowKind, FollowStats } from '../services/api';
import { plural } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/**
 * „Folgen“-Knopf mit Follower-Anzahl (Konzept 11.2). Meldet `sx-follow` { kind, id, follow } – ohne Anmeldung
 * `sx-login`. Folgen öffnet nichts; der Knopf erscheint nur auf öffentlichen Seiten (die App entscheidet).
 */
export class SxFollow extends LitElement {
  static properties = {
    kind: { type: String },
    targetId: { type: String, attribute: 'target-id' },
    stats: { attribute: false },
    signedIn: { type: Boolean, attribute: 'signed-in' },
    busy: { type: Boolean },
    label: { type: String },
  };
  declare kind: FollowKind;
  declare targetId: string;
  declare stats: FollowStats | null;
  declare signedIn: boolean;
  declare busy: boolean;
  /** z. B. „Anna“ – für den zugänglichen Namen des Knopfs */
  declare label: string;

  constructor() {
    super();
    this.kind = 'user';
    this.targetId = '';
    this.stats = null;
    this.signedIn = false;
    this.busy = false;
    this.label = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      .count {
        font-size: var(--fs-s);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }
      .btn[aria-pressed='true'] {
        border-color: var(--accent);
        color: var(--accent);
      }
    `,
  ];

  private toggle() {
    if (!this.signedIn) return emit(this, 'sx-login');
    emit(this, 'sx-follow', { kind: this.kind, id: this.targetId, follow: !this.stats?.isFollowing });
  }

  render() {
    const s = this.stats;
    const on = !!s?.isFollowing;
    const aria = this.label ? `${this.label} folgen` : 'Folgen';
    return html`<button class="btn" aria-pressed=${on ? 'true' : 'false'} ?disabled=${this.busy} @click=${this.toggle} aria-label=${aria}>
        ${icon(on ? 'check' : 'user')} ${on ? 'Folge ich' : 'Folgen'}
      </button>
      ${s ? html`<span class="count">${plural(s.followers, 'Follower', 'Follower')}${s.following !== undefined ? ` · folgt ${s.following}` : ''}</span>` : ''}`;
  }
}
customElements.define('sx-follow', SxFollow);
