import { LitElement, css, html, type PropertyValues } from 'lit';
import type { CoverKind, GalleryPhoto } from '../services/api';
import { COVER_BANNER_RATIO, COVER_FOCUS_DEFAULT, focusAfterDrag, focusSlack } from '../domain/cover';
import { fmtShort } from '../util/html';
import { icon } from './icons';
import { base, coverPosition, emit } from './shared';

/**
 * Titelbild über Profil-, Boots- und Gruppenseite (Konzept 13.2). Ohne Bild sehen nur Verwalter einen Platzhalter
 * zum Hinzufügen. Das gespeicherte Bild ist meist höher als das 3:1-Banner; Verwalter wählen den sichtbaren Streifen
 * unter „Ausschnitt“ durch Ziehen (Maus, Touch) oder per Schieberegler (Tastatur). Reine Darstellung – Events:
 * `sx-cover-change` { kind, id, file }, `sx-cover-remove` { kind, id }, `sx-cover-focus` { kind, id, focusY, previous }.
 */
export class SxCover extends LitElement {
  static properties = {
    src: { attribute: false },
    focusY: { attribute: false },
    kind: { type: String },
    targetId: { type: String, attribute: 'target-id' },
    canEdit: { type: Boolean, attribute: 'can-edit' },
    busy: { type: Boolean, reflect: true },
    label: { type: String },
    editing: { state: true },
    draft: { state: true },
    movable: { state: true },
  };
  declare src: string | null;
  /** sichtbarer Ausschnitt: vertikale Fokus-Position in Prozent */
  declare focusY: number;
  declare kind: CoverKind;
  declare targetId: string;
  declare canEdit: boolean;
  /** Upload läuft (setzt die Verdrahtung) */
  declare busy: boolean;
  declare label: string;
  declare editing: boolean;
  private declare draft: number;
  /** Bild ragt über das Banner hinaus – erst dann gibt es etwas zu verschieben */
  private declare movable: boolean;
  /** nach dem Laden des Bilds in den Ausschnitt-Modus (direkt nach einem Upload) */
  private adjustOnLoad = false;
  private drag: { pointer: number; y: number; start: number; slack: number } | null = null;

  constructor() {
    super();
    this.src = null;
    this.focusY = COVER_FOCUS_DEFAULT;
    this.kind = 'u';
    this.targetId = '';
    this.canEdit = false;
    this.busy = false;
    this.label = 'Titelbild';
    this.editing = false;
    this.draft = COVER_FOCUS_DEFAULT;
    this.movable = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      :host([hidden]) {
        display: none;
      }
      .frame {
        position: relative;
        /* COVER_BANNER_RATIO (src/domain/cover.ts) */
        aspect-ratio: 3 / 1;
        border-radius: var(--radius-l);
        overflow: hidden;
        background: var(--surface-2, var(--surface));
        border: 1px solid var(--border-soft);
      }
      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .editing {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      .editing img {
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      .editing img:active {
        cursor: grabbing;
      }
      .empty {
        display: grid;
        place-items: center;
        border: 1px dashed var(--border);
        background: transparent;
        aspect-ratio: 6 / 1;
        min-height: 72px;
      }
      .tools {
        position: absolute;
        right: var(--s-2);
        bottom: var(--s-2);
        display: flex;
        gap: var(--s-2);
      }
      .tools .btn {
        background: color-mix(in srgb, var(--surface) 88%, transparent);
        backdrop-filter: blur(6px);
      }
      .adjust {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--s-2);
        margin-top: var(--s-2);
      }
      .adjust label {
        flex: 1 1 220px;
        display: grid;
        gap: var(--s-1);
      }
      input[type='range'] {
        width: 100%;
        min-height: 40px;
        margin: 0;
        accent-color: var(--accent);
      }
      input[type='file'] {
        display: none;
      }
      :host([busy]) .frame {
        opacity: 0.6;
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keydown', this.key);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.key);
  }

  /** Anderes Bild oder anderes Objekt (Lit verwendet das Element beim Navigieren weiter): Bearbeitung verwerfen. */
  willUpdate(changed: PropertyValues<this>) {
    if (!changed.has('src') && !changed.has('targetId') && !changed.has('kind')) return;
    if (changed.has('targetId') || changed.has('kind')) this.adjustOnLoad = false;
    this.editing = false;
    this.drag = null;
    this.movable = false;
  }

  /** Nach einem Upload: in den Ausschnitt-Modus, sobald das neue Bild geladen ist – sofern es Spielraum hat. */
  adjust() {
    this.adjustOnLoad = true;
  }

  private pick() {
    this.renderRoot.querySelector<HTMLInputElement>('input[type=file]')?.click();
  }

  private picked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) emit(this, 'sx-cover-change', { kind: this.kind, id: this.targetId, file });
  }

  private get img() {
    return this.renderRoot.querySelector('img');
  }

  /** Bild geladen: Spielraum am Seitenverhältnis bestimmen (unabhängig von der Bannerbreite). */
  private loaded() {
    const img = this.img;
    if (!img?.naturalWidth) return;
    this.movable = focusSlack(COVER_BANNER_RATIO, 1, img.naturalWidth, img.naturalHeight) > 0.01;
    if (this.adjustOnLoad) {
      this.adjustOnLoad = false;
      if (this.movable) this.start();
    }
  }

  private start() {
    this.draft = this.focusY;
    this.editing = true;
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('input[type=range]')?.focus());
  }

  /** Modus verlassen; Fokus zurück auf „Ausschnitt“, sofern er im Modus war (sonst ginge er verloren). */
  private close() {
    const hadFocus = !!this.shadowRoot?.activeElement;
    this.editing = false;
    this.drag = null;
    if (hadFocus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.tools button')?.focus());
  }

  private save() {
    const previous = this.focusY;
    this.close();
    if (this.draft === previous) return;
    this.focusY = this.draft;
    emit(this, 'sx-cover-focus', { kind: this.kind, id: this.targetId, focusY: this.draft, previous });
  }

  private down(e: PointerEvent) {
    const img = this.img;
    if (!this.editing || !img) return;
    e.preventDefault();
    img.setPointerCapture?.(e.pointerId);
    this.drag = { pointer: e.pointerId, y: e.clientY, start: this.draft, slack: focusSlack(img.clientWidth, img.clientHeight, img.naturalWidth, img.naturalHeight) };
  }

  private move(e: PointerEvent) {
    if (!this.drag || e.pointerId !== this.drag.pointer) return;
    this.draft = focusAfterDrag(this.drag.start, e.clientY - this.drag.y, this.drag.slack);
  }

  private up(e: PointerEvent) {
    if (this.drag?.pointer === e.pointerId) this.drag = null;
  }

  private key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.editing) return;
    e.stopPropagation();
    this.close();
  };

  render() {
    if (!this.src && !this.canEdit) return '';
    const file = html`<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" @change=${this.picked} />`;
    if (!this.src) {
      return html`<div class="frame empty">
        ${file}
        <button class="btn" ?disabled=${this.busy} @click=${this.pick}>${icon('image')} ${this.busy ? 'Lädt hoch …' : 'Titelbild hinzufügen'}</button>
      </div>`;
    }
    const y = this.editing ? this.draft : this.focusY;
    return html`<div class="frame ${this.editing ? 'editing' : ''}">
        <img
          src=${this.src}
          alt=${this.label}
          draggable="false"
          style=${coverPosition(y)}
          @load=${this.loaded}
          @error=${() => (this.adjustOnLoad = false)}
          @pointerdown=${this.down}
          @pointermove=${this.move}
          @pointerup=${this.up}
          @pointercancel=${this.up}
        />
        ${this.canEdit && !this.editing
          ? html`${file}<div class="tools">
              ${this.movable ? html`<button class="btn small" ?disabled=${this.busy} @click=${this.start}>${icon('scale')} Ausschnitt</button>` : ''}
              <button class="btn small" ?disabled=${this.busy} @click=${this.pick}>${icon('image')} ${this.busy ? 'Lädt hoch …' : 'Ändern'}</button>
              <button class="btn small" ?disabled=${this.busy} aria-label="Titelbild entfernen"
                @click=${() => confirm('Titelbild entfernen?') && emit(this, 'sx-cover-remove', { kind: this.kind, id: this.targetId })}>${icon('trash')}</button>
            </div>`
          : ''}
      </div>
      ${this.editing
        ? html`<div class="adjust">
            <label class="hint"
              >Bild hoch- oder runterziehen oder hier einstellen
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                aria-label="Ausschnitt (0 = oben, 100 = unten)"
                aria-valuetext=${y <= 10 ? 'oben' : y >= 90 ? 'unten' : `${y} % von oben`}
                .value=${String(y)}
                @input=${(e: Event) => (this.draft = Number((e.target as HTMLInputElement).value))}
            /></label>
            <button class="btn small" @click=${this.close}>Abbrechen</button>
            <button class="btn small primary" @click=${this.save}>${icon('check')} Speichern</button>
          </div>`
        : ''}`;
  }
}
customElements.define('sx-cover', SxCover);

/**
 * Galerie an Person, Boot und Verein/Team (Konzept 13.1): die neuesten öffentlichen Fotos ihrer Törns. Ein Klick
 * öffnet den Törn mit dem Foto in der Lightbox (`?foto=`). Leer: unsichtbar.
 */
export class SxGallery extends LitElement {
  static properties = {
    photos: { attribute: false },
    heading: { type: String },
  };
  declare photos: GalleryPhoto[];
  declare heading: string;

  constructor() {
    super();
    this.photos = [];
    this.heading = 'Fotos';
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      section {
        display: grid;
        gap: var(--s-3);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: var(--s-2);
      }
      a {
        position: relative;
        display: block;
        aspect-ratio: 1;
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--surface);
        border: 1px solid var(--border-soft);
      }
      a:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        transition: transform 0.2s var(--ease);
      }
      a:hover img {
        transform: scale(1.04);
      }
      .cap {
        position: absolute;
        inset: auto 0 0 0;
        padding: var(--s-4) var(--s-2) var(--s-1);
        font-size: var(--fs-xs, 12px);
        color: #fff;
        background: linear-gradient(transparent, rgb(0 0 0 / 0.65));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ];

  render() {
    if (!this.photos.length) return '';
    return html`<section aria-label=${this.heading}>
      <h2 class="eyebrow">${this.heading}</h2>
      <ul>
        ${this.photos.map((p) => {
          const alt = p.caption || (p.takenAt !== null ? `Foto vom ${fmtShort(p.takenAt)}` : 'Foto');
          return html`<li>
            <a href="/s/${p.shareId}?foto=${p.id}" title="${alt} – ${p.shareTitle}">
              <img src="/api/photos/${p.id}?s=t" alt=${alt} loading="lazy" width="200" height="200" />
              <span class="cap">${p.shareTitle}</span>
            </a>
          </li>`;
        })}
      </ul>
    </section>`;
  }
}
customElements.define('sx-gallery', SxGallery);
