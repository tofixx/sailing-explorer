import { LitElement, css, html } from 'lit';
import { NOTIFY_LEVELS, NOTIFY_LEVEL_HINT, NOTIFY_LEVEL_LABEL, type NotifyLevel } from '../domain/notifications';
import type { FollowKind } from '../domain/groups';
import { icon, type IconName } from './icons';
import { base, emit, menuStyles } from './shared';
import { MenuController } from './menu-controller';

/** Symbol je Stufe (F-449): Glocke, Glocke mit Punkt, kleine Glocke, durchgestrichene Glocke. */
export const NOTIFY_LEVEL_ICON: Record<NotifyLevel, IconName> = { all: 'bell', important: 'bell-dot', direct: 'bell-small', muted: 'bell-off' };

/**
 * Glocke eines Verlaufs (Konzept 24.6, F-449): ein Knopf, dessen Symbol die Stufe zeigt, mit kleinem Menü (gemeinsames
 * `MenuController`/`menuStyles`, mobil als Sheet). Gruppenseite (Mitglieder), „Folgen“ (Follower) und die Übersicht im
 * Konto nutzen denselben Baustein. Rein präsentational – meldet `sx-notify-level` { kind, id, level } und zeigt die
 * Wahl sofort an. `following` (Seitenkopf für Folgende, F-446): Knopf „Folgst du ▾“ mit der Stufe und „Entfolgen“
 * (meldet `sx-follow` { kind, id, follow: false }).
 */
export class SxNotifyBell extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    kind: { type: String },
    targetId: { type: String, attribute: 'target-id' },
    level: { type: String },
    label: { type: String },
    following: { type: Boolean },
  };
  declare open: boolean;
  declare kind: FollowKind;
  declare targetId: string;
  declare level: NotifyLevel;
  declare label: string;
  declare following: boolean;

  constructor() {
    super();
    this.open = false;
    this.kind = 'group';
    this.targetId = '';
    this.level = 'important';
    this.label = '';
    this.following = false;
  }

  static styles = [
    base,
    menuStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      @media (min-width: 761px) {
        .menu {
          top: calc(100% + var(--s-2));
        }
      }
      .btn.toggle.following {
        border-color: var(--accent);
        color: var(--accent);
      }
      .item span small {
        display: block;
        margin: 0;
      }
    `,
  ];

  private menu = new MenuController(this);

  private pick(level: NotifyLevel) {
    this.open = false;
    if (level === this.level) return;
    this.level = level;
    emit(this, 'sx-notify-level', { kind: this.kind, id: this.targetId, level });
  }

  render() {
    const name = this.label ? ` für ${this.label}` : '';
    return html`<div @keydown=${this.menu.onKey} @focusout=${this.menu.onFocusOut}>
      <button class="btn ${this.following ? 'following' : 'icon'} toggle" type="button" aria-haspopup="true" aria-expanded=${this.open} aria-controls="nb"
        aria-label="Benachrichtigungen${name}: ${NOTIFY_LEVEL_LABEL[this.level]}" title="Benachrichtigungen: ${NOTIFY_LEVEL_LABEL[this.level]}"
        @click=${() => (this.open = !this.open)}>${this.following ? html`${icon('check')} Folgst du ${icon(NOTIFY_LEVEL_ICON[this.level])}` : icon(NOTIFY_LEVEL_ICON[this.level])}</button>
      <div class="menu" id="nb" role="group" aria-label="Benachrichtigungen${name}" ?hidden=${!this.open}>
        <p class="title">Benachrichtigungen${name}</p>
        ${NOTIFY_LEVELS.map(
          (l) => html`<button class="item" type="button" aria-pressed=${l === this.level ? 'true' : 'false'} @click=${() => this.pick(l)}>
            <span class="mark">${icon(NOTIFY_LEVEL_ICON[l])}</span><span>${NOTIFY_LEVEL_LABEL[l]}<small>${NOTIFY_LEVEL_HINT[l]}</small></span></button>`,
        )}
        <p class="hint">Automatische Einträge wie Beitritte oder neue Boote benachrichtigen nie.</p>
        ${this.following
          ? html`<hr /><button class="item" type="button" @click=${() => {
              this.open = false;
              emit(this, 'sx-follow', { kind: this.kind, id: this.targetId, follow: false });
            }}><span class="mark">${icon('x')}</span><span>Entfolgen</span></button>`
          : ''}
      </div>
    </div>`;
  }
}
customElements.define('sx-notify-bell', SxNotifyBell);
