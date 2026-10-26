import { LitElement, html, css, type PropertyValues } from 'lit';
import { PHOTO_CAPTION_LENGTH } from '../domain/limits';
import { PHOTO_VISIBILITY_LABEL, type PhotoVisibility } from '../domain/visibility';
import { fmtDateTime } from '../util/html';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import { photoLabel, type PhotoView } from './sx-photo-strip';

const PLACEMENT_TEXT = { gps: 'Ort aus dem GPS des Fotos', time: 'Ort aus der Aufnahmezeit', manual: 'Ort von Hand gesetzt', none: 'Ohne Ort' } as const;

/**
 * Großansicht eines Fotos (Konzept 3.3) als modaler Dialog: Fokus bleibt im Dialog (showModal macht den Rest der
 * Seite inert), ←/→ blättern, Esc schließt, danach geht der Fokus zurück. Vollbild lädt erst hier.
 * Events: `sx-photo-close`, `sx-photo-nav` { index }, `sx-photo-show` { id }, `sx-photo-hover` { id },
 * Eigentümer: `sx-photo-save` { id, caption, visibility }, `sx-photo-place` { id }, `sx-photo-delete` { id };
 * andere: `sx-report` { kind: 'photo', id, label }.
 */
export class SxPhotoLightbox extends LitElement {
  static properties = {
    open: { type: Boolean },
    photos: { attribute: false },
    index: { type: Number },
    isOwner: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    confirm: { state: true },
  };
  declare open: boolean;
  declare photos: PhotoView[];
  declare index: number;
  declare isOwner: boolean;
  declare busy: boolean;
  declare error: string;
  /** Löschen wartet auf Bestätigung */
  declare confirm: boolean;

  private opener: Element | null = null;

  constructor() {
    super();
    this.open = false;
    this.photos = [];
    this.index = 0;
    this.isOwner = false;
    this.busy = false;
    this.error = '';
    this.confirm = false;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(1100px, calc(100vw - 24px));
      }
      figure {
        margin: 0;
        display: grid;
        gap: var(--s-2);
      }
      .stage {
        position: relative;
        display: grid;
        place-items: center;
        background: var(--surface-2);
        border-radius: var(--radius);
        min-height: 200px;
      }
      .stage img {
        display: block;
        max-width: 100%;
        max-height: min(70dvh, 900px);
        object-fit: contain;
        border-radius: var(--radius);
      }
      .nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        background: var(--overlay);
      }
      .nav.prev {
        left: var(--s-2);
      }
      .nav.next {
        right: var(--s-2);
      }
      figcaption {
        display: grid;
        gap: 2px;
      }
      .meta {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      form {
        display: grid;
        gap: var(--s-2);
        grid-template-columns: 1fr auto;
        align-items: end;
      }
      form .full {
        grid-column: 1 / -1;
      }
      .row {
        display: flex;
        gap: var(--s-2);
        flex-wrap: wrap;
        align-items: center;
      }
      .row .spacer {
        flex: 1;
      }
      @media (max-width: 560px) {
        form {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  private get photo(): PhotoView | null {
    return this.photos[this.index] ?? null;
  }

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) {
        this.opener = deepActive();
        this.confirm = false;
        dlg.showModal();
        (this.renderRoot.querySelector('.close') as HTMLElement | null)?.focus();
      } else if (!this.open && dlg.open) {
        dlg.close();
        (this.opener as HTMLElement | null)?.focus?.();
        this.opener = null;
      }
    }
    if (changed.has('index')) this.confirm = false;
  }

  private close = () => emit(this, 'sx-photo-close');

  private nav(delta: number) {
    const n = this.photos.length;
    if (n < 2) return;
    const index = (this.index + delta + n) % n;
    emit(this, 'sx-photo-nav', { index });
    emit(this, 'sx-photo-hover', { id: this.photos[index].id });
  }

  private onKey(e: KeyboardEvent) {
    // In Eingabefeldern gehören die Pfeiltasten dem Cursor.
    const t = e.composedPath()[0] as HTMLElement | undefined;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.nav(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.nav(1);
    }
  }

  private save(e: Event) {
    e.preventDefault();
    const p = this.photo;
    if (!p) return;
    const data = new FormData(e.target as HTMLFormElement);
    emit(this, 'sx-photo-save', { id: p.id, caption: String(data.get('caption') ?? '').trim(), visibility: String(data.get('visibility')) as PhotoVisibility });
  }

  private ownerTools(p: PhotoView) {
    return html`
      ${p.hidden ? html`<div class="note warn" role="note">${icon('eyeOff')}<span>Dieses Foto wurde gemeldet und ist bis zur Prüfung für andere ausgeblendet.</span></div>` : ''}
      <form @submit=${this.save}>
        <div class="full">
          <label class="label" for="pl-caption">Bildunterschrift</label>
          <input id="pl-caption" name="caption" type="text" maxlength=${PHOTO_CAPTION_LENGTH} .value=${p.caption} />
        </div>
        <div>
          <label class="label" for="pl-vis">Sichtbarkeit</label>
          <select id="pl-vis" name="visibility" .value=${p.visibility ?? 'public'}>
            ${(['public', 'private'] as const).map((v) => html`<option value=${v} ?selected=${(p.visibility ?? 'public') === v}>${PHOTO_VISIBILITY_LABEL[v]}</option>`)}
          </select>
        </div>
        <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} Speichern</button>
      </form>
      <p class="hint">„Wie der Törn“ heißt: so sichtbar wie der Törn, nie mehr. „Nur ich“ geht immer.</p>
      <div class="row">
        <button class="btn small" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-photo-place', { id: p.id })}>
          ${icon('map')} ${p.lat === null ? 'Auf der Karte setzen' : 'Ort ändern'}
        </button>
        <span class="spacer"></span>
        ${this.confirm
          ? html`<button class="btn small danger" type="button" ?disabled=${this.busy} @click=${() => emit(this, 'sx-photo-delete', { id: p.id })}>${icon('trash')} Endgültig löschen</button>
              <button class="btn small" type="button" @click=${() => (this.confirm = false)}>Abbrechen</button>`
          : html`<button class="btn small ghost danger" type="button" ?disabled=${this.busy} @click=${() => (this.confirm = true)}>${icon('trash')} Löschen</button>`}
      </div>
    `;
  }

  render() {
    // Vollbild erst laden, wenn die Lightbox offen ist (Konzept 3.3).
    const p = this.open ? this.photo : null;
    const n = this.photos.length;
    return html`<dialog aria-labelledby="pl-h" @close=${this.close} @keydown=${this.onKey}>
      <header>
        <h2 id="pl-h">Foto${n > 1 ? html` <span class="faint num">${this.index + 1} / ${n}</span>` : ''}</h2>
        <button class="btn ghost icon close" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <div class="body">
        ${p
          ? html`<figure>
                <div class="stage">
                  <img src=${p.fullUrl} alt=${photoLabel(p)} width=${p.width} height=${p.height} />
                  ${n > 1
                    ? html`<button class="btn icon nav prev" type="button" aria-label="Vorheriges Foto" @click=${() => this.nav(-1)}>${icon('left')}</button>
                        <button class="btn icon nav next" type="button" aria-label="Nächstes Foto" @click=${() => this.nav(1)}>${icon('right')}</button>`
                    : ''}
                </div>
                <figcaption>
                  ${p.caption ? html`<span>${p.caption}</span>` : ''}
                  <span class="meta num">
                    ${p.takenAt !== null ? fmtDateTime(p.takenAt) : 'Aufnahmezeit unbekannt'} · ${PLACEMENT_TEXT[p.placement]}
                  </span>
                </figcaption>
              </figure>
              <div class="row">
                ${p.lat !== null
                  ? html`<button class="btn small" type="button" @click=${() => emit(this, 'sx-photo-show', { id: p.id })}>${icon('map')} Auf Karte zeigen</button>`
                  : ''}
                <span class="spacer"></span>
                ${!this.isOwner
                  ? html`<button class="btn small ghost" type="button" @click=${() => emit(this, 'sx-report', { kind: 'photo', id: p.id, label: 'dieses Foto' })}>
                      ${icon('flag')} Melden
                    </button>`
                  : ''}
              </div>
              ${this.isOwner ? this.ownerTools(p) : ''}
              ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}`
          : html`<p class="muted">Dieses Foto gibt es nicht mehr.</p>`}
      </div>
    </dialog>`;
  }
}
customElements.define('sx-photo-lightbox', SxPhotoLightbox);

/** Fokussiertes Element auch innerhalb von Shadow Roots (Rückkehr des Fokus nach dem Schließen). */
function deepActive(): Element | null {
  let a: Element | null = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}
