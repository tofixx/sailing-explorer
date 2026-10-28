import { LitElement, css, html } from 'lit';
import { VERIFIED_LABEL, verifiedHint, type ClaimKind } from '../domain/claims';
import { icon } from './icons';

/**
 * Abzeichen „Verifiziert“ (Konzept 20.4, F-366) für Vereine und Häfen – mit Erklärung als Tooltip und für
 * Screenreader. Erscheint nur, wenn die App es setzt (`verified` aus der API).
 */
export class SxVerifiedBadge extends LitElement {
  static properties = {
    kind: { type: String },
    compact: { type: Boolean },
  };
  declare kind: ClaimKind;
  /** nur das Symbol (Karten, Listen) */
  declare compact: boolean;

  constructor() {
    super();
    this.kind = 'group';
    this.compact = false;
  }

  static styles = css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 8px 1px 4px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--fs-s);
      font-weight: 600;
      line-height: 1.6;
      white-space: nowrap;
    }
    span.compact {
      padding: 1px;
    }
    svg {
      width: 14px;
      height: 14px;
    }
  `;

  render() {
    const hint = verifiedHint(this.kind);
    return html`<span class=${this.compact ? 'compact' : ''} title=${hint} role="img" aria-label="${VERIFIED_LABEL}: ${hint}"
      >${icon('check')}${this.compact ? '' : VERIFIED_LABEL}</span
    >`;
  }
}
customElements.define('sx-verified-badge', SxVerifiedBadge);
