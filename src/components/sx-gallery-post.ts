import { LitElement, css, html } from 'lit';
import { photoImageUrl, type Photo } from '../services/api';
import type { PostPhoto } from '../domain/posts';
import { base, emit } from './shared';
import { photoLabel, type PhotoView } from './sx-photo-strip';
import './sx-photo-lightbox';

/** So viele Vorschaubilder zeigt die Karte, der Rest steckt hinter „+ n“. */
const SHOWN = 4;

/**
 * Fotos eines Galerie-Beitrags in der Stream-Karte (Konzept 31, F-491): Raster mit bis zu vier Vorschaubildern (eins
 * groß, sonst zwei Spalten), Tippen öffnet die Großansicht `sx-photo-lightbox` im Modus `post` (ohne Ort und ohne
 * Bearbeiten). Blättern und Schließen bleiben hier – die Foto-Ereignisse der Törn-Ansicht werden nicht weitergereicht,
 * nur `sx-report` (Melden) und – für die Autor:in (`own`) – `sx-gallery-photo-delete` { id } gehen nach oben; der
 * PostsController löscht und ruft danach `removePhoto(id)`. `postKey`: Schlüssel „Nur mit Link“ für die Bild-Adressen.
 */
export class SxGalleryPost extends LitElement {
  static properties = {
    photos: { attribute: false },
    postKey: { attribute: false },
    own: { type: Boolean },
    index: { state: true },
    open: { state: true },
  };
  declare photos: PostPhoto[];
  declare postKey: string | null;
  /** eigener Beitrag (Autor:in) – „Foto löschen“ statt „Melden“ in der Großansicht */
  declare own: boolean;
  declare index: number;
  declare open: boolean;

  constructor() {
    super();
    this.photos = [];
    this.postKey = null;
    this.own = false;
    this.index = 0;
    this.open = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        margin-top: var(--s-2);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--s-1);
      }
      .grid.single {
        grid-template-columns: minmax(0, 1fr);
      }
      button {
        position: relative;
        display: block;
        padding: 0;
        border: 0;
        min-height: 44px;
        border-radius: var(--radius-s, 6px);
        overflow: hidden;
        background: var(--surface-2);
        cursor: zoom-in;
      }
      img {
        display: block;
        width: 100%;
        /* width/height-Attribute halten nur den Platz frei – die Höhe kommt aus dem Seitenverhältnis */
        height: auto;
        aspect-ratio: 4 / 3;
        object-fit: cover;
      }
      .single img {
        aspect-ratio: auto;
        max-height: 420px;
        object-fit: contain;
      }
      .more {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.45);
        color: #fff;
        font-size: var(--fs-l, 1.25rem);
        font-weight: 600;
      }
    `,
  ];

  /** Für die Großansicht: dieselbe Form wie Törn-Fotos, ohne Ort. */
  private views(): PhotoView[] {
    return this.photos.map((p) => {
      const photo: Photo = {
        id: p.id, caption: p.caption, takenAt: p.takenAt, lat: null, lon: null, placement: 'none', width: p.width, height: p.height,
        createdAt: 0, effectiveVisibility: 'public', visibility: null, bytes: null, hidden: false,
      };
      return { ...photo, thumbUrl: photoImageUrl(p.id, 't', this.postKey), fullUrl: photoImageUrl(p.id, 'f', this.postKey) };
    });
  }

  /** Nach dem Löschen (Controller): Foto aus Raster und Großansicht nehmen. */
  removePhoto(id: string) {
    this.photos = this.photos.filter((p) => p.id !== id);
    this.index = Math.min(this.index, Math.max(0, this.photos.length - 1));
    if (!this.photos.length) this.open = false;
  }

  private show(i: number) {
    this.index = i;
    this.open = true;
  }

  /** Foto-Ereignisse der Großansicht gehören dieser Karte (nicht der Törn-Ansicht). */
  private mine(e: Event) {
    e.stopPropagation();
  }

  render() {
    const views = this.views();
    const shown = views.slice(0, SHOWN);
    const rest = views.length - shown.length;
    return html`<div class="grid ${views.length === 1 ? 'single' : ''}">
        ${shown.map(
          (p, i) => html`<button type="button" aria-label=${`${photoLabel(p)} – groß ansehen`} @click=${() => this.show(i)}>
            <img src=${p.thumbUrl} alt=${photoLabel(p)} width=${p.width} height=${p.height} loading="lazy" decoding="async" />
            ${rest > 0 && i === shown.length - 1 ? html`<span class="more" aria-hidden="true">+${rest}</span>` : ''}
          </button>`,
        )}
      </div>
      <sx-photo-lightbox mode="post" .photos=${views} .index=${this.index} ?open=${this.open} ?isOwner=${this.own}
        @sx-photo-close=${(e: Event) => {
          this.mine(e);
          this.open = false;
        }}
        @sx-photo-nav=${(e: CustomEvent<{ index: number }>) => {
          this.mine(e);
          this.index = e.detail.index;
        }}
        @sx-photo-hover=${this.mine}
        @sx-photo-delete=${(e: CustomEvent<{ id: string }>) => {
          this.mine(e);
          emit(this, 'sx-gallery-photo-delete', { id: e.detail.id });
        }}></sx-photo-lightbox>`;
  }
}
customElements.define('sx-gallery-post', SxGalleryPost);
