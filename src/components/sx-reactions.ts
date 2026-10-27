import { LitElement, css, html, type PropertyValues } from 'lit';
import type { ReactionWho } from '../services/api';
import { REACTIONS, REACTION_LABEL, reactionCountText, reactionTotal, toggleReaction, type ReactionKind, type ReactionSubject, type ReactionSummary } from '../domain/reactions';
import { icon } from './icons';
import { base, emit } from './shared';

/** Reaktionen eines Gegenstands: Gegenstand plus Zähler und eigene Reaktion (wie StreamItem.reactions). */
export type ReactionValue = ReactionSummary & { subject: ReactionSubject; id: string };

/** Detail von `sx-react`: neue eigene Reaktion (null = zurücknehmen) und die vorherige Zusammenfassung. */
export interface ReactDetail {
  subject: ReactionSubject;
  id: string;
  kind: ReactionKind | null;
  previous: ReactionSummary;
  /** Schlüssel für „Nur mit Link“-Törns */
  key?: string | null;
}

/**
 * Reaktionen (Konzept 12.5, F-179/F-180): „Gefällt mir“, „Mast- und Schotbruch“, „Starker Schlag“ mit eigenen Icons,
 * Zähler, gedrückt = eigene Reaktion. Klick schaltet sofort um (optimistisch) und meldet `sx-react`; dieselbe Art noch
 * einmal nimmt zurück. „n Reaktionen“ meldet `sx-react-who` { subject, id, key, el } – die Liste setzt die Verdrahtung
 * als `who`. Rein präsentational, Namen nur über Lit-Templates.
 */
export class SxReactions extends LitElement {
  static properties = {
    value: { attribute: false },
    who: { attribute: false },
    shareKey: { attribute: false },
    local: { state: true },
    open: { state: true },
  };
  declare value: ReactionValue | null;
  declare who: ReactionWho | null;
  /** Schlüssel („Nur mit Link“), wird mitgemeldet */
  declare shareKey: string | null;
  /** optimistische Anzeige bis zur nächsten Antwort */
  declare local: ReactionSummary | null;
  declare open: boolean;

  constructor() {
    super();
    this.value = null;
    this.who = null;
    this.shareKey = null;
    this.local = null;
    this.open = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s-1);
      }
      button.r {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: var(--control-h-s);
        min-width: 40px;
        padding: 0 var(--s-2);
        border-radius: 999px;
        border: 1px solid var(--border-soft);
        background: var(--surface);
        color: var(--text-2);
        font: 600 var(--fs-s) / 1 var(--font);
        cursor: pointer;
        transition: background 0.15s var(--ease), border-color 0.15s var(--ease), color 0.15s var(--ease);
      }
      button.r:hover {
        background: var(--surface-hover);
      }
      button.r[aria-pressed='true'] {
        background: var(--accent-soft);
        border-color: var(--accent);
        color: var(--accent);
      }
      button.r:focus-visible,
      button.who:focus-visible {
        outline: none;
        box-shadow: var(--focus);
      }
      button.r svg {
        width: 16px;
        height: 16px;
      }
      @media (pointer: coarse) {
        button.r {
          min-height: 40px;
        }
      }
      button.who {
        border: 0;
        background: none;
        padding: 0 var(--s-1);
        min-height: var(--control-h-s);
        color: var(--text-3);
        font: inherit;
        font-size: var(--fs-xs);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      ul {
        list-style: none;
        margin: var(--s-2) 0 0;
        padding: var(--s-2);
        border-radius: var(--radius);
        background: var(--surface-2);
        display: grid;
        gap: var(--s-1);
        font-size: var(--fs-s);
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--s-2);
      }
      li svg {
        width: 14px;
        height: 14px;
        color: var(--accent);
      }
      li a {
        color: inherit;
        font-weight: 600;
      }
      @media (prefers-reduced-motion: reduce) {
        button.r {
          transition: none;
        }
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    // Neue Daten von außen ersetzen die optimistische Anzeige.
    if (changed.has('value')) this.local = null;
  }

  private current(): ReactionSummary | null {
    return this.local ?? this.value;
  }

  private pick(kind: ReactionKind) {
    const v = this.value;
    const cur = this.current();
    if (!v || !cur) return;
    const { next, summary } = toggleReaction(cur, kind);
    this.local = summary;
    if (this.open) this.open = false;
    emit(this, 'sx-react', { subject: v.subject, id: v.id, kind: next, previous: cur, key: this.shareKey } satisfies ReactDetail);
  }

  private toggleWho() {
    const v = this.value;
    if (!v) return;
    this.open = !this.open;
    if (this.open) emit(this, 'sx-react-who', { subject: v.subject, id: v.id, key: this.shareKey, el: this });
  }

  private whoList() {
    if (!this.open) return '';
    const w = this.who;
    if (!w) return html`<ul role="status"><li>Lade …</li></ul>`;
    const icons = Object.fromEntries(REACTIONS.map((r) => [r.kind, r.icon])) as Record<ReactionKind, (typeof REACTIONS)[number]['icon']>;
    return html`<ul aria-label="Wer hat reagiert">
      ${w.people.map((p) => html`<li><span title=${REACTION_LABEL[p.kind]}>${icon(icons[p.kind] ?? 'heart')}</span><a href="/u/${p.handle}">${p.displayName}</a></li>`)}
      ${w.others ? html`<li class="faint">${w.people.length ? `+ ${w.others} weitere` : w.others === 1 ? '1 Person ohne öffentliches Profil' : `${w.others} Personen ohne öffentliches Profil`}</li>` : ''}
      ${!w.people.length && !w.others ? html`<li class="faint">Noch keine Reaktionen.</li>` : ''}
    </ul>`;
  }

  render() {
    const s = this.current();
    if (!this.value || !s) return '';
    const total = reactionTotal(s);
    return html`<div class="bar" role="group" aria-label="Reaktionen">
        ${REACTIONS.map(
          (r) => html`<button class="r" type="button" aria-pressed=${s.mine === r.kind ? 'true' : 'false'} title=${r.label}
            aria-label="${r.label}: ${s.counts[r.kind] ?? 0}" @click=${() => this.pick(r.kind)}>
            ${icon(r.icon)}<span class="num" aria-hidden="true">${s.counts[r.kind] || ''}</span>
          </button>`,
        )}
        ${total ? html`<button class="who" type="button" aria-expanded=${this.open ? 'true' : 'false'} @click=${this.toggleWho}>${reactionCountText(s)}</button>` : ''}
      </div>
      ${this.whoList()}`;
  }
}
customElements.define('sx-reactions', SxReactions);
