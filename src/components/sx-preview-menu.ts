import { LitElement, css, html, type PropertyValues } from 'lit';
import { previewLabel, previewParam, type PreviewOptions, type ProfilePreview } from '../domain/posts';
import { icon } from './icons';
import { base, emit, menuStyles } from './shared';

/**
 * „Ansehen als …“ auf der eigenen Seite (F-423): Zahnrad mit Aufklapp-Menü (Muster wie `sx-map-style`) – Vorschau
 * als Öffentlichkeit, als jemand aus dem Heimathafen oder als Mitglied einer eigenen Gruppe. Rein präsentational –
 * meldet `sx-profile-preview` { preview } (null = beenden).
 */
export class SxPreviewMenu extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    options: { attribute: false },
    current: { attribute: false },
  };
  declare open: boolean;
  declare options: PreviewOptions | null;
  declare current: ProfilePreview | null;

  constructor() {
    super();
    this.open = false;
    this.options = null;
    this.current = null;
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
    `,
  ];

  updated(changed: PropertyValues<this>) {
    if (!changed.has('open') || changed.get('open') === undefined) return;
    if (this.open) this.renderRoot.querySelector<HTMLButtonElement>('.item')?.focus();
    else if (this.shadowRoot?.activeElement) this.renderRoot.querySelector<HTMLButtonElement>('.toggle')?.focus();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.onOutside);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.onOutside);
  }

  private onOutside = (e: PointerEvent) => {
    if (this.open && !e.composedPath().includes(this)) this.open = false;
  };

  private onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (this.open && next && !this.shadowRoot!.contains(next)) this.open = false;
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.open) return;
    e.preventDefault();
    this.open = false;
  };

  /** Wählbare Vorschauen: öffentlich, Hafen (falls vorhanden), jede eigene Gruppe. */
  private choices(): ProfilePreview[] {
    const o = this.options;
    return [{ as: 'public' }, ...(o?.harbor ? [{ as: 'harbor' as const }] : []), ...(o?.groups ?? []).map((g) => ({ as: 'group' as const, groupId: g.id }))];
  }

  private pick(p: ProfilePreview | null) {
    this.open = false;
    emit(this, 'sx-profile-preview', { preview: p });
  }

  render() {
    const cur = this.current ? previewParam(this.current) : null;
    return html`<div @keydown=${this.onKey} @focusout=${this.onFocusOut}>
      <button class="btn icon toggle" type="button" aria-label="Ansehen als …" title="Ansehen als …" aria-expanded=${this.open} aria-controls="pv"
        @click=${() => (this.open = !this.open)}>${icon('gear')}</button>
      <div class="menu" id="pv" role="group" aria-labelledby="pv-h" ?hidden=${!this.open}>
        <p class="title" id="pv-h">Deine Seite ansehen als …</p>
        ${this.choices().map((p) => {
          const on = cur === previewParam(p);
          return html`<button class="item" type="button" aria-pressed=${on} @click=${() => this.pick(p)}>
            <span class="mark">${on ? icon('check') : ''}</span><span>${previewLabel(p, this.options)}${p.as === 'harbor'
              ? html`<small>zeigt in dieser Stufe dasselbe wie Öffentlich</small>`
              : ''}</span></button>`;
        })}
        ${this.current
          ? html`<hr /><button class="item" type="button" @click=${() => this.pick(null)}><span class="mark">${icon('x')}</span><span>Vorschau beenden</span></button>`
          : ''}
        <p class="hint">Zeigt, was diese Betrachter sehen – nichts wird geändert.</p>
      </div>
    </div>`;
  }
}
customElements.define('sx-preview-menu', SxPreviewMenu);
