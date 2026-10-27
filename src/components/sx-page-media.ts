import { LitElement, css, html } from 'lit';
import type { CoverKind, GalleryPhoto } from '../services/api';
import { fmtShort } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/**
 * Titelbild über Profil-, Boots- und Gruppenseite (Konzept 13.2). Ohne Bild sehen nur Verwalter einen Platzhalter
 * zum Hinzufügen. Reine Darstellung – Events: `sx-cover-change` { kind, id, file }, `sx-cover-remove` { kind, id }.
 */
export class SxCover extends LitElement {
  static properties = {
    src: { attribute: false },
    kind: { type: String },
    targetId: { type: String, attribute: 'target-id' },
    canEdit: { type: Boolean, attribute: 'can-edit' },
    busy: { type: Boolean, reflect: true },
    label: { type: String },
  };
  declare src: string | null;
  declare kind: CoverKind;
  declare targetId: string;
  declare canEdit: boolean;
  /** Upload läuft (setzt die Verdrahtung) */
  declare busy: boolean;
  declare label: string;

  constructor() {
    super();
    this.src = null;
    this.kind = 'u';
    this.targetId = '';
    this.canEdit = false;
    this.busy = false;
    this.label = 'Titelbild';
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
      input[type='file'] {
        display: none;
      }
      :host([busy]) .frame {
        opacity: 0.6;
      }
    `,
  ];

  private pick() {
    this.renderRoot.querySelector<HTMLInputElement>('input[type=file]')?.click();
  }

  private picked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) emit(this, 'sx-cover-change', { kind: this.kind, id: this.targetId, file });
  }

  render() {
    if (!this.src && !this.canEdit) return '';
    const file = html`<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" @change=${this.picked} />`;
    if (!this.src) {
      return html`<div class="frame empty">
        ${file}
        <button class="btn" ?disabled=${this.busy} @click=${this.pick}>${icon('image')} ${this.busy ? 'Lädt hoch …' : 'Titelbild hinzufügen'}</button>
      </div>`;
    }
    return html`<div class="frame">
      <img src=${this.src} alt=${this.label} />
      ${this.canEdit
        ? html`${file}<div class="tools">
            <button class="btn small" ?disabled=${this.busy} @click=${this.pick}>${icon('image')} ${this.busy ? 'Lädt hoch …' : 'Ändern'}</button>
            <button class="btn small" ?disabled=${this.busy} aria-label="Titelbild entfernen"
              @click=${() => confirm('Titelbild entfernen?') && emit(this, 'sx-cover-remove', { kind: this.kind, id: this.targetId })}>${icon('trash')}</button>
          </div>`
        : ''}
    </div>`;
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
