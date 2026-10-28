import { LitElement, html, css, type PropertyValues } from 'lit';
import { OFFSET_MAX, OFFSET_MIN, OFFSET_STEP, fmtOffset, type OffsetSource, type Placement } from '../domain/photo-place';
import { PHOTO_CAPTION_LENGTH } from '../domain/limits';
import { PHOTO_VISIBILITY_LABEL, type PhotoVisibility } from '../domain/visibility';
import { fmtShort } from '../util/html';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

export type UploadItemStatus = 'reading' | 'ready' | 'uploading' | 'done' | 'error';

/** Ein Foto im Upload-Stapel – fertig aufbereitet vom Controller. */
export interface UploadItem {
  key: string;
  name: string;
  /** Vorschau (blob:-URL des neu kodierten Vorschaubilds) */
  previewUrl: string | null;
  status: UploadItemStatus;
  error: string;
  placement: Placement;
  gpsRejected: boolean;
  takenAt: number | null;
  /** hängt vom Zeitversatz ab (Aufnahmezeit ohne eigene Zeitzone) */
  usesOffset: boolean;
  caption: string;
}

export interface UploadProgress {
  done: number;
  total: number;
  /** Anteil des laufenden Fotos (0–1) */
  current: number;
}

const SOURCE_TEXT: Record<OffsetSource, string> = {
  photo: 'aus den Fotos',
  gps: 'aus Fotos mit GPS ermittelt',
  time: 'so geschätzt, dass die meisten Fotos in die Trackzeit fallen',
  default: 'Zeitzone dieses Geräts',
};

/** Platzierungs-Status je Foto (Konzept 3.2). */
export function placementText(it: Pick<UploadItem, 'placement' | 'gpsRejected' | 'takenAt'>): string {
  const rejected = it.gpsRejected ? 'Ort verworfen – zu weit vom Track. ' : '';
  if (it.placement === 'gps') return 'Ort aus dem GPS des Fotos';
  if (it.placement === 'time') return `${rejected}Ort aus der Aufnahmezeit${it.takenAt !== null ? ` (${fmtShort(it.takenAt)})` : ''}`;
  if (it.takenAt !== null) return `${rejected}Aufnahmezeit liegt außerhalb des Törns – ohne Ort, nur in der Galerie (später von Hand setzen)`;
  return `${rejected}Ohne Ort – nur in der Galerie (später von Hand setzen)`;
}

/**
 * Fotos hinzufügen (Konzept 3.1/3.2): Auswahl, Platzierungs-Status je Foto, Zeitversatz-Regler mit Live-Vorschau
 * auf der Karte, Fortschritt. Reine Darstellung. Events: `sx-photo-files` { files }, `sx-photo-offset` { min },
 * `sx-photo-item-caption` { key, caption }, `sx-photo-item-remove` { key }, `sx-photo-upload-visibility` { visibility },
 * `sx-photo-upload-submit`, `sx-photo-upload-close`.
 */
export class SxPhotoUpload extends LitElement {
  static properties = {
    open: { type: Boolean },
    items: { attribute: false },
    offsetMin: { type: Number },
    offsetSource: { type: String },
    visibility: { type: String },
    progress: { attribute: false },
    busy: { type: Boolean },
    error: { type: String },
    remaining: { type: Number },
  };
  declare open: boolean;
  declare items: UploadItem[];
  declare offsetMin: number;
  declare offsetSource: OffsetSource;
  declare visibility: PhotoVisibility;
  declare progress: UploadProgress | null;
  declare busy: boolean;
  declare error: string;
  /** so viele Fotos passen noch in diesen Törn */
  declare remaining: number;

  constructor() {
    super();
    this.open = false;
    this.items = [];
    this.offsetMin = 0;
    this.offsetSource = 'default';
    this.visibility = 'public';
    this.progress = null;
    this.busy = false;
    this.error = '';
    this.remaining = 100;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(640px, calc(100vw - 24px));
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
        max-height: 40dvh;
        overflow-y: auto;
      }
      /* Handy: der Dialog ist Vollbild und scrollt selbst – keine Scrollbox in der Scrollbox (F-291) */
      @media (max-width: 760px) {
        ul {
          max-height: none;
          overflow: visible;
        }
      }
      li {
        display: grid;
        grid-template-columns: 72px 1fr auto;
        gap: var(--s-2) var(--s-3);
        align-items: center;
        padding: var(--s-2);
        border: 1px solid var(--border-soft);
        border-radius: var(--radius);
      }
      .pv {
        width: 72px;
        height: 54px;
        border-radius: var(--radius-s);
        background: var(--surface-2);
        object-fit: cover;
        display: grid;
        place-items: center;
        color: var(--text-3);
      }
      .info {
        min-width: 0;
        display: grid;
        gap: 4px;
      }
      .name {
        font-size: var(--fs-s);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status {
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .status.err {
        color: var(--err);
      }
      .status.place-gps,
      .status.place-time {
        color: var(--ok);
      }
      .offset {
        display: grid;
        gap: var(--s-2);
      }
      .offset .row {
        display: flex;
        gap: var(--s-2);
        align-items: center;
      }
      input[type='range'] {
        flex: 1;
        accent-color: var(--c-photo);
        min-height: 40px;
      }
      .pick {
        justify-self: start;
      }
      progress {
        width: 100%;
        accent-color: var(--c-photo);
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) dlg.showModal();
      else if (!this.open && dlg.open) dlg.close();
    }
  }

  private close = () => emit(this, 'sx-photo-upload-close');

  private pick() {
    const input = this.renderRoot.querySelector('input[type=file]') as HTMLInputElement;
    input.value = '';
    input.click();
  }

  private onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (files.length) emit(this, 'sx-photo-files', { files });
  }

  private setOffset(min: number) {
    emit(this, 'sx-photo-offset', { min: Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, min)) });
  }

  private item(it: UploadItem) {
    const status =
      it.status === 'reading'
        ? 'Wird gelesen …'
        : it.status === 'error'
          ? it.error
          : it.status === 'uploading'
            ? 'Wird hochgeladen …'
            : it.status === 'done'
              ? 'Hochgeladen'
              : placementText(it);
    const cls = it.status === 'error' ? 'err' : it.status === 'ready' ? `place-${it.placement}` : '';
    const editable = it.status === 'ready' && !this.busy;
    return html`<li>
      ${it.previewUrl ? html`<img class="pv" src=${it.previewUrl} alt="" />` : html`<span class="pv">${icon('camera')}</span>`}
      <div class="info">
        <span class="name" title=${it.name}>${it.name}</span>
        <span class="status ${cls}" role=${it.status === 'error' ? 'alert' : 'status'}>${status}</span>
        ${it.status === 'ready' || it.status === 'uploading'
          ? html`<input
              type="text"
              aria-label=${`Bildunterschrift für ${it.name}`}
              placeholder="Bildunterschrift (optional)"
              maxlength=${PHOTO_CAPTION_LENGTH}
              .value=${it.caption}
              ?disabled=${!editable}
              @change=${(e: Event) => emit(this, 'sx-photo-item-caption', { key: it.key, caption: (e.target as HTMLInputElement).value })}
            />`
          : ''}
      </div>
      ${it.status !== 'done' && it.status !== 'uploading'
        ? html`<button class="btn ghost icon small" type="button" aria-label=${`${it.name} entfernen`} ?disabled=${this.busy} @click=${() => emit(this, 'sx-photo-item-remove', { key: it.key })}>
            ${icon('x')}
          </button>`
        : html`<span></span>`}
    </li>`;
  }

  render() {
    const ready = this.items.filter((i) => i.status === 'ready').length;
    const reading = this.items.some((i) => i.status === 'reading');
    const usesOffset = this.items.some((i) => i.usesOffset && i.status !== 'error');
    const p = this.progress;
    return html`<dialog aria-labelledby="pu-h" @close=${this.close}>
      <header>
        <h2 id="pu-h">Fotos hinzufügen</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      <div class="body">
        <div class="note" role="note">
          ${icon('info')}
          <span>
            Frag die Abgebildeten, bevor du Fotos von Personen zeigst. Kameradaten und GPS werden aus der Datei entfernt;
            Ort und Aufnahmezeit sind so sichtbar wie das Foto. GPS weiter als 2 km vom Track wird nicht übernommen.
          </span>
        </div>
        <input type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" @change=${this.onFiles} />
        <button class="btn pick" type="button" ?disabled=${this.busy} @click=${() => this.pick()}>${icon('camera')} Fotos auswählen</button>
        <p class="hint">JPEG, PNG oder WebP; HEIC, wenn dein Browser es öffnen kann. Noch ${this.remaining} Fotos in diesem Törn möglich.</p>
        ${this.items.length ? html`<ul aria-label="Ausgewählte Fotos">${this.items.map((it) => this.item(it))}</ul>` : ''}
        ${usesOffset
          ? html`<div class="offset">
              <label class="label" for="pu-off">Zeitversatz der Kamera: <span class="num">${fmtOffset(this.offsetMin)}</span></label>
              <div class="row">
                <button class="btn small" type="button" aria-label="Eine Stunde früher" ?disabled=${this.busy} @click=${() => this.setOffset(this.offsetMin - 60)}>−1 h</button>
                <input
                  id="pu-off"
                  type="range"
                  min=${OFFSET_MIN}
                  max=${OFFSET_MAX}
                  step=${OFFSET_STEP}
                  .value=${String(this.offsetMin)}
                  aria-valuetext=${fmtOffset(this.offsetMin)}
                  ?disabled=${this.busy}
                  @input=${(e: Event) => this.setOffset(Number((e.target as HTMLInputElement).value))}
                />
                <button class="btn small" type="button" aria-label="Eine Stunde später" ?disabled=${this.busy} @click=${() => this.setOffset(this.offsetMin + 60)}>+1 h</button>
              </div>
              <p class="hint">${SOURCE_TEXT[this.offsetSource]}. Verschiebt alle Fotos ohne eigene Zeitzone gemeinsam (15-min-Schritte) – die Karte zeigt die Wirkung sofort.</p>
            </div>`
          : ''}
        ${this.items.length
          ? html`<div>
              <label class="label" for="pu-vis">Sichtbarkeit der Fotos</label>
              <select id="pu-vis" .value=${this.visibility} ?disabled=${this.busy} @change=${(e: Event) => emit(this, 'sx-photo-upload-visibility', { visibility: (e.target as HTMLSelectElement).value })}>
                ${(['public', 'private'] as const).map((v) => html`<option value=${v} ?selected=${this.visibility === v}>${PHOTO_VISIBILITY_LABEL[v]}</option>`)}
              </select>
            </div>`
          : ''}
        ${p
          ? html`<div role="status">
              <progress max=${p.total} .value=${p.done + p.current} aria-label="Fortschritt"></progress>
              <p class="hint num">${p.done} von ${p.total} hochgeladen</p>
            </div>`
          : ''}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
        <div class="actions">
          <button class="btn" type="button" @click=${this.close}>${this.busy ? 'Abbrechen' : 'Schließen'}</button>
          <button class="btn primary" type="button" ?disabled=${this.busy || reading || !ready} @click=${() => emit(this, 'sx-photo-upload-submit')}>
            ${icon('upload')} ${ready === 1 ? '1 Foto hochladen' : `${ready} Fotos hochladen`}
          </button>
        </div>
      </div>
    </dialog>`;
  }
}
customElements.define('sx-photo-upload', SxPhotoUpload);
