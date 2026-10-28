import { LitElement, css, html, nothing } from 'lit';
import type { NotificationItem, NotificationKind } from '../domain/notifications';
import { notificationText } from '../domain/notifications';
import { fmtShort } from '../util/html';
import { icon, type IconName } from './icons';
import { base, emit } from './shared';

const KIND_ICON: Record<NotificationKind, IconName> = {
  comment: 'comment', reaction: 'heart', follow: 'user', invite: 'mail', request: 'flag', expiry: 'info', passkey: 'lock',
};

/**
 * Liste der Benachrichtigungen (Konzept 17, F-252) – klappt unter der Glocke in der Kopfzeile auf. Ein Klick auf einen
 * Eintrag meldet `sx-notification-open`, „Alle als gelesen“ `sx-notifications-read-all`; Schließen (Esc, außerhalb,
 * ×) `sx-notifications-close`. Daten und Lesestatus hält der NotificationsController.
 */
export class SxNotifications extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    items: { attribute: false },
    loading: { type: Boolean },
    error: { type: String },
  };
  declare open: boolean;
  declare items: NotificationItem[];
  declare loading: boolean;
  declare error: string;

  constructor() {
    super();
    this.open = false;
    this.items = [];
    this.loading = false;
    this.error = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: none;
        position: fixed;
        top: calc(var(--topbar-h) + var(--s-1));
        right: var(--s-3);
        z-index: 1500;
        width: min(380px, calc(100vw - 2 * var(--s-3)));
        max-height: min(70vh, 560px);
        flex-direction: column;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-l, 12px);
        box-shadow: var(--shadow-2, var(--shadow-1));
        overflow: hidden;
      }
      :host([open]) {
        display: flex;
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        padding: var(--s-3) var(--s-4);
        border-bottom: 1px solid var(--border-soft);
      }
      h2 {
        flex: 1;
        margin: 0;
        font-size: var(--fs-m);
      }
      section {
        min-height: 0;
        overflow-y: auto;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: var(--s-1) 0;
      }
      a.item {
        display: grid;
        grid-template-columns: 28px 1fr 10px;
        gap: var(--s-2);
        align-items: start;
        padding: var(--s-2) var(--s-4);
        color: var(--text);
        text-decoration: none;
      }
      a.item:hover,
      a.item:focus-visible {
        background: var(--surface-hover);
      }
      .ic {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--surface-2);
        color: var(--text-2);
      }
      .ic svg {
        width: 16px;
        height: 16px;
      }
      .unread .ic {
        background: var(--accent-soft);
        color: var(--accent);
      }
      .text {
        font-size: var(--fs-s);
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .unread .text {
        font-weight: 600;
      }
      .when {
        display: block;
        color: var(--text-3, var(--text-2));
        font-size: var(--fs-xs);
        font-weight: 400;
      }
      .dot {
        width: 8px;
        height: 8px;
        margin-top: 6px;
        border-radius: 50%;
        background: var(--accent);
      }
      .empty {
        padding: var(--s-5) var(--s-4);
        color: var(--text-2);
        font-size: var(--fs-s);
        text-align: center;
      }
      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      h2:focus {
        outline: none;
      }
      .small {
        min-height: 40px;
        padding: 0 var(--s-2);
        border: 0;
        border-radius: var(--radius);
        background: transparent;
        color: var(--accent);
        font: 600 var(--fs-s) / 1 var(--font);
        cursor: pointer;
      }
      .small:hover {
        background: var(--surface-hover);
      }
      .close {
        display: grid;
        place-items: center;
        width: 40px;
        color: var(--text-2);
      }
      .close svg {
        width: 18px;
        height: 18px;
      }
      @media (max-width: 760px) {
        :host {
          right: var(--s-2);
          width: calc(100vw - 2 * var(--s-2));
        }
      }
    `,
  ];

  private onKey = (e: KeyboardEvent) => {
    if (this.open && e.key === 'Escape') emit(this, 'sx-notifications-close', { focus: true });
  };
  /** Klick außerhalb schließt – außer auf die Glocke selbst (die schaltet um). */
  private onDown = (e: PointerEvent) => {
    if (!this.open) return;
    const path = e.composedPath();
    if (path.includes(this) || path.some((n) => n instanceof HTMLElement && n.dataset?.bell !== undefined)) return;
    emit(this, 'sx-notifications-close');
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('pointerdown', this.onDown, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerdown', this.onDown, true);
  }

  /** Neuer Tab bzw. Fenster (Strg/Cmd/Shift, Mittelklick): der Browser öffnet den Link, hier wird nur gelesen. */
  private onItem(e: MouseEvent, n: NotificationItem) {
    if (e.button > 1) return;
    const newTab = e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1;
    if (!newTab) e.preventDefault();
    emit(this, 'sx-notification-open', { item: n, newTab });
  }

  /** Beim Öffnen springt der Fokus in die Liste (Tastatur, Screenreader). */
  protected updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) (this.renderRoot.querySelector('h2') as HTMLElement | null)?.focus();
  }

  private list() {
    if (this.loading && !this.items.length) return html`<p class="empty">Lade …</p>`;
    if (this.error) return html`<p class="empty">${this.error}</p>`;
    if (!this.items.length) return html`<p class="empty">Nichts Neues. Hier erscheinen Kommentare, Reaktionen, neue Follower, Einladungen und Beitrittsanfragen.</p>`;
    return html`<ul>
      ${this.items.map(
        (n) => html`<li>
          <a
            class="item ${n.read ? '' : 'unread'}"
            href=${n.href}
            @click=${(e: MouseEvent) => this.onItem(e, n)}
            @auxclick=${(e: MouseEvent) => this.onItem(e, n)}
          >
            <span class="ic">${icon(KIND_ICON[n.kind])}</span>
            <span class="text">${n.read ? '' : html`<span class="sr">Ungelesen: </span>`}${notificationText(n)}<span class="when">${fmtShort(n.at)}</span></span>
            ${n.read ? html`<span></span>` : html`<span class="dot" aria-hidden="true"></span>`}
          </a>
        </li>`,
      )}
    </ul>`;
  }

  render() {
    if (!this.open) return nothing;
    const unread = this.items.some((n) => !n.read);
    return html`
      <header>
        <h2 id="h" tabindex="-1">Benachrichtigungen</h2>
        ${unread ? html`<button class="small" @click=${() => emit(this, 'sx-notifications-read-all')}>Alle als gelesen</button>` : nothing}
        <button class="small close" aria-label="Schließen" @click=${() => emit(this, 'sx-notifications-close', { focus: true })}>${icon('x')}</button>
      </header>
      <section id="list" role="region" aria-labelledby="h">${this.list()}</section>
    `;
  }
}
customElements.define('sx-notifications', SxNotifications);
