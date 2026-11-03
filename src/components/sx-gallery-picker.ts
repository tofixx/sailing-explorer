import { LitElement, css, html } from 'lit';
import type { GalleryQuota } from '../domain/posts';
import { icon } from './icons';
import { base, emit } from './shared';

/**
 * Fotoauswahl im Formular „Neue Fotos“ (Konzept 31, F-491, F-493) – das Formularteil der Art `gallery` in
 * `sx-compose-dialog` (`KIND_FORMS`). Begrenzt die Auswahl auf den Rest des Monatskontingents (höchstens je Beitrag),
 * zeigt Vorschaubilder und meldet `sx-payload` { value: File[] | null } (null = noch kein Foto). Verkleinern und
 * Hochladen macht der ComposeController; `clear()` nach dem Veröffentlichen.
 */
export class SxGalleryPicker extends LitElement {
  static properties = {
    quota: { attribute: false },
    busy: { type: Boolean },
    files: { state: true },
  };
  /** Kontingent dieses Monats (GET /api/me/compose) – fehlt bei älteren Servern */
  declare quota: GalleryQuota | null;
  declare busy: boolean;
  declare files: File[];
  private previews: string[] = [];

  constructor() {
    super();
    this.quota = null;
    this.busy = false;
    this.files = [];
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-2);
      }
      .pick {
        position: relative;
        min-height: 44px;
        justify-self: start;
      }
      .pick input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      .previews {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
        gap: var(--s-1);
      }
      .previews img {
        display: block;
        width: 100%;
        height: auto;
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: var(--radius-s, 6px);
        background: var(--surface-2);
      }
    `,
  ];

  disconnectedCallback() {
    super.disconnectedCallback();
    this.set([]);
  }

  /** Nach dem Veröffentlichen (vom Dialog aufgerufen). */
  clear() {
    this.set([]);
  }

  /** Wie viele Fotos diese Auswahl höchstens haben darf: Rest des Monats, höchstens je Beitrag. */
  private room(): number {
    const q = this.quota;
    return q ? Math.max(0, Math.min(q.perPost, q.max - q.used)) : 30;
  }

  private set(files: File[]) {
    for (const u of this.previews) URL.revokeObjectURL(u);
    this.files = files;
    this.previews = files.map((f) => URL.createObjectURL(f));
    emit(this, 'sx-payload', { value: files.length ? files : null });
  }

  private pick(e: Event) {
    const input = e.target as HTMLInputElement;
    this.set([...(input.files ?? [])].slice(0, this.room()));
    input.value = '';
  }

  render() {
    const q = this.quota;
    const room = this.room();
    const n = this.files.length;
    return html`<span class="label">Fotos</span>
      <label class="btn pick">${icon('camera')} ${n ? 'Andere Fotos wählen' : 'Fotos wählen'}
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" ?disabled=${!room || this.busy} @change=${(e: Event) => this.pick(e)} /></label>
      ${n ? html`<div class="previews">${this.previews.map((u) => html`<img src=${u} alt="" />`)}</div><span class="hint">${n === 1 ? '1 Foto' : `${n} Fotos`} gewählt.</span>` : ''}
      <span class="hint">${q
        ? room
          ? `Noch ${room === 1 ? '1 Foto' : `${room} Fotos`} möglich (${q.used} von ${q.max} in diesem Monat, höchstens ${q.perPost} je Beitrag).`
          : `Diesen Monat sind alle ${q.max} Fotos genutzt – im nächsten Monat geht es weiter.`
        : ''} Ort und Kameradaten werden vor dem Hochladen entfernt.</span>`;
  }
}
customElements.define('sx-gallery-picker', SxGalleryPicker);
