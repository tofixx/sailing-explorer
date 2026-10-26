import { LitElement, html, css } from 'lit';
import type { Photo, PhotoUploadState } from '../services/api';
import { photoLimitMessage } from '../domain/limits';
import { fmtShort } from '../util/html';
import { icon } from './icons';
import { base, emit } from './shared';

/** Foto mit fertigen Bild-URLs (der Controller hängt bei „Nur mit Link“ den Schlüssel an). */
export type PhotoView = Photo & { thumbUrl: string; fullUrl: string };

/** Text für die Bildbeschreibung (alt) und Schaltflächen. */
export const photoLabel = (p: Pick<Photo, 'caption' | 'takenAt'>) =>
  p.caption || (p.takenAt !== null ? `Foto vom ${fmtShort(p.takenAt)}` : 'Foto ohne Beschreibung');

/** Hinweis, warum gerade kein Foto hinzukommen kann (leer = geht). */
export function uploadBlockText(u: PhotoUploadState | null): string {
  if (!u || u.allowed || !u.reason) return '';
  if (u.reason === 'supporter_required' || u.reason === 'quota') return photoLimitMessage(u.reason, !!u.supportOffered);
  if (u.reason === 'storage_full') return 'Dein Speicher ist voll – lösche ältere Törns oder Fotos, um neue hochzuladen.';
  return 'Der Speicher von Sail Explorer ist gerade knapp – neue Fotos sind vorübergehend pausiert.';
}

/**
 * Galerie-Leiste im Panel „Fotos“ (Konzept 3.3): chronologisch, unplatzierte am Ende (Reihenfolge vom Server).
 * Reine Darstellung. Events: `sx-photo-open` { id }, `sx-photo-hover` { id | null }, `sx-photo-add`,
 * `sx-photo-support` (gesperrter Hinweis für Nicht-Unterstützer öffnet das Unterstützen-Angebot).
 */
export class SxPhotoStrip extends LitElement {
  static properties = {
    photos: { attribute: false },
    isOwner: { type: Boolean },
    upload: { attribute: false },
    activeId: { attribute: false },
  };
  declare photos: PhotoView[];
  declare isOwner: boolean;
  declare upload: PhotoUploadState | null;
  /** hervorgehobenes Foto (Hover in Karte, Diagramm oder Galerie) */
  declare activeId: string | null;

  constructor() {
    super();
    this.photos = [];
    this.isOwner = false;
    this.upload = null;
    this.activeId = null;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-3);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 2px 2px var(--s-1);
        display: flex;
        gap: var(--s-2);
        overflow-x: auto;
        scroll-snap-type: x proximity;
      }
      li {
        flex: none;
        scroll-snap-align: start;
      }
      .thumb {
        position: relative;
        display: block;
        width: 88px;
        height: 66px;
        padding: 0;
        border: 2px solid transparent;
        border-radius: var(--radius-s);
        background: var(--surface-2);
        overflow: hidden;
        cursor: pointer;
      }
      .thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .thumb.active,
      .thumb:hover {
        border-color: var(--c-photo);
      }
      .thumb:focus-visible {
        outline: none;
        box-shadow: var(--focus);
      }
      .badges {
        position: absolute;
        right: 3px;
        bottom: 3px;
        display: flex;
        gap: 2px;
      }
      .badge {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--overlay);
        color: var(--text);
      }
      .badge svg.i {
        width: 13px;
        height: 13px;
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
      .head .count {
        flex: 1;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .locked {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface-2);
        border: 1px solid var(--border-soft);
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .locked b {
        color: var(--text);
      }
      .locked .btn {
        margin-top: var(--s-2);
      }
      p {
        margin: 0;
      }
    `,
  ];

  private hover(id: string | null) {
    emit(this, 'sx-photo-hover', { id });
  }

  private ownerHead() {
    const u = this.upload;
    if (!this.isOwner || !u) return '';
    if (u.reason === 'supporter_required') {
      return html`<div class="locked" role="note">
        ${icon('lock')}
        <div>
          <p><b>Fotos für Unterstützer</b></p>
          <p>${uploadBlockText(u)}</p>
          ${u.supportOffered
            ? html`<button class="btn small primary" type="button" @click=${() => emit(this, 'sx-photo-support')}>${icon('coffee')} Unterstützen</button>`
            : ''}
        </div>
      </div>`;
    }
    const block = uploadBlockText(u);
    return html`<div class="head">
        <span class="count num">${u.used} von ${u.max} Fotos</span>
        <button class="btn small" type="button" ?disabled=${!u.allowed} @click=${() => emit(this, 'sx-photo-add')}>${icon('camera')} Fotos hinzufügen</button>
      </div>
      ${block ? html`<p class="hint" role="note">${block}</p>` : ''}`;
  }

  render() {
    return html`
      ${this.ownerHead()}
      ${this.photos.length
        ? html`<ul aria-label="Fotos">
            ${this.photos.map(
              (p) => html`<li>
                <button
                  class="thumb ${p.id === this.activeId ? 'active' : ''}"
                  type="button"
                  aria-label=${`${photoLabel(p)} öffnen`}
                  @click=${() => emit(this, 'sx-photo-open', { id: p.id })}
                  @mouseenter=${() => this.hover(p.id)}
                  @mouseleave=${() => this.hover(null)}
                  @focus=${() => this.hover(p.id)}
                  @blur=${() => this.hover(null)}
                >
                  <img src=${p.thumbUrl} alt="" loading="lazy" width="88" height="66" />
                  <span class="badges">
                    ${p.lat === null ? html`<span class="badge" title="Ohne Ort – nur in der Galerie">${icon('map')}</span>` : ''}
                    ${p.visibility === 'private' ? html`<span class="badge" title="Nur ich">${icon('lock')}</span>` : ''}
                    ${p.hidden ? html`<span class="badge" title="Ausgeblendet nach Meldung">${icon('eyeOff')}</span>` : ''}
                  </span>
                </button>
              </li>`,
            )}
          </ul>`
        : this.isOwner && this.upload?.allowed
          ? html`<p class="hint">Noch keine Fotos. Fotos mit GPS oder Aufnahmezeit landen automatisch auf dem Track.</p>`
          : ''}
    `;
  }
}
customElements.define('sx-photo-strip', SxPhotoStrip);
