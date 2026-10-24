import { LitElement, html, css } from 'lit';
import { VISIBILITIES, VISIBILITY_HINT, VISIBILITY_LABEL, canChooseVisibility, isVisibility, type Visibility } from '../domain/visibility';
import { icon, type IconName } from './icons';
import { base, emit } from './shared';

export const VISIBILITY_ICON: Record<Visibility, IconName> = { public: 'globe', unlisted: 'link', private: 'lock' };

/**
 * Wer darf es sehen? – drei Stufen mit je einem Erklärsatz (Törns, Boote, Profile).
 *
 * Kontrolliert: die Komponente ändert `value` nicht selbst, sondern meldet `sx-visibility-change` mit `{ value }`;
 * der Host setzt den neuen Wert (z. B. erst nach der Antwort des Servers).
 * Für kostenlose Konten sind „Nur mit Link“ und „Nur ich“ gesperrt (E1) – außer der bereits gespeicherten
 * Stufe `current` (E4). Eine gesperrte Stufe bleibt fokussier- und aktivierbar und meldet dann
 * `sx-visibility-locked` mit `{ value }`; der Host zeigt daraufhin das Unterstützen-Angebot.
 *
 * Tastatur: Pfeiltasten bewegen den Fokus (mit Umlauf), Leertaste/Enter wählt. Keine automatische Auswahl beim
 * Bewegen, weil eine Auswahl je nach Host sofort gespeichert wird.
 */
export class SxVisibilityPicker extends LitElement {
  static properties = {
    value: { type: String },
    supporter: { type: Boolean },
    current: { type: String },
    label: { type: String },
    disabled: { type: Boolean },
  };
  declare value: Visibility;
  /** laufender Unterstützer-Status */
  declare supporter: boolean;
  /** bereits gespeicherte Stufe (bleibt auch ohne Unterstützung wählbar); leer bei neuen Objekten */
  declare current: Visibility | null;
  /** Name der Gruppe für Screenreader */
  declare label: string;
  declare disabled: boolean;

  constructor() {
    super();
    this.value = 'public';
    this.supporter = false;
    this.current = null;
    this.label = 'Wer darf es sehen?';
    this.disabled = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      [role='radiogroup'] {
        display: grid;
        gap: var(--s-2);
      }
      .opt {
        display: flex;
        gap: var(--s-3);
        align-items: flex-start;
        width: 100%;
        min-height: 40px;
        padding: var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: var(--fs-m) / 1.4 var(--font);
        text-align: left;
        cursor: pointer;
        transition: border-color 0.15s var(--ease), background 0.15s var(--ease);
      }
      .opt:hover {
        border-color: var(--accent);
      }
      .opt[aria-checked='true'] {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .opt.locked {
        background: var(--surface-2);
        border-style: dashed;
      }
      .opt.locked .txt {
        color: var(--text-2);
      }
      .opt[disabled] {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .dot {
        flex: none;
        width: 16px;
        height: 16px;
        margin-top: 2px;
        border-radius: 50%;
        border: 2px solid var(--border);
        background: var(--surface);
      }
      .opt[aria-checked='true'] .dot {
        border-color: var(--accent);
        box-shadow: inset 0 0 0 3px var(--surface);
        background: var(--accent);
      }
      .txt {
        flex: 1;
        min-width: 0;
      }
      .txt b {
        display: flex;
        align-items: center;
        gap: var(--s-1);
        flex-wrap: wrap;
      }
      .txt b svg {
        width: 15px;
        height: 15px;
      }
      .txt small {
        display: block;
        color: var(--text-2);
        font-size: var(--fs-s);
      }
      .lock {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 0 var(--s-2);
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: var(--fs-xs);
        font-weight: 600;
      }
      .lock svg {
        width: 12px;
        height: 12px;
      }
      @media (prefers-reduced-motion: reduce) {
        .opt {
          transition: none;
        }
      }
    `,
  ];

  /** Ohne Unterstützung nicht wählbar? */
  isLocked(v: Visibility): boolean {
    return !canChooseVisibility(v, this.supporter, this.current ?? undefined);
  }

  private get selected(): Visibility {
    return isVisibility(this.value) ? this.value : 'public';
  }

  private activate(v: Visibility) {
    if (this.disabled) return;
    if (this.isLocked(v)) return emit(this, 'sx-visibility-locked', { value: v });
    if (v !== this.selected) emit(this, 'sx-visibility-change', { value: v });
  }

  private options(): HTMLButtonElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  }

  private keydown(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step) {
      e.preventDefault();
      const opts = this.options();
      const next = opts[(i + step + opts.length) % opts.length];
      opts.forEach((o) => (o.tabIndex = o === next ? 0 : -1));
      next.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const opts = this.options();
      const next = e.key === 'Home' ? opts[0] : opts[opts.length - 1];
      opts.forEach((o) => (o.tabIndex = o === next ? 0 : -1));
      next.focus();
    }
    // Leertaste/Enter lösen auf <button> ohnehin „click“ aus.
  }

  render() {
    const sel = this.selected;
    return html`<div role="radiogroup" aria-label=${this.label}>
      ${VISIBILITIES.map((v, i) => {
        const locked = this.isLocked(v);
        return html`<button
          type="button"
          role="radio"
          class="opt ${locked ? 'locked' : ''}"
          data-value=${v}
          aria-checked=${v === sel ? 'true' : 'false'}
          aria-disabled=${locked ? 'true' : 'false'}
          aria-describedby="hint-${v}"
          tabindex=${v === sel ? 0 : -1}
          ?disabled=${this.disabled}
          @click=${() => this.activate(v)}
          @keydown=${(e: KeyboardEvent) => this.keydown(e, i)}
        >
          <span class="dot" aria-hidden="true"></span>
          <span class="txt">
            <b>${icon(VISIBILITY_ICON[v])} ${VISIBILITY_LABEL[v]}
              ${locked ? html`<span class="lock">${icon('pennant')} Für Unterstützer</span>` : ''}</b>
            <small id="hint-${v}">${VISIBILITY_HINT[v]}</small>
          </span>
        </button>`;
      })}
    </div>`;
  }
}
customElements.define('sx-visibility-picker', SxVisibilityPicker);
