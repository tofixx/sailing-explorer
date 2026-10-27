import { ApiError, photoApi, photoImageUrl, type Photo, type PhotoList, type ShareMeta } from '../services/api';
import { visibleTracks, type Store } from '../services/store';
import { MAX_BATCH, PhotoError, processPhoto, type ProcessedPhoto } from '../services/photo-process';
import { clampOffset, estimateOffset, nearestPhotoByTime, placePhotos, snapToTrack, type OffsetSource, type PlacePoint } from '../domain/photo-place';
import type { PhotoVisibility } from '../domain/visibility';
import type { MapPhoto } from '../map/photo-layer';
import type { PhotoView, SxPhotoStrip } from '../components/sx-photo-strip';
import type { SxPhotoLightbox } from '../components/sx-photo-lightbox';
import type { SxPhotoUpload, UploadItem } from '../components/sx-photo-upload';
import { errorText } from './session';

/** Was der Controller von der Foto-Ebene der Karte braucht (src/map/photo-layer.ts) – ohne Leaflet zu kennen. */
export interface PhotoMapLayer {
  set(photos: MapPhoto[]): void;
  highlight(id: string | null): void;
  focus(id: string): void;
  startPlacing(onPick: (lat: number, lon: number) => void, onCancel: () => void): void;
  stopPlacing(): void;
}

export interface PhotosUi {
  strip: SxPhotoStrip;
  /** Panel „Fotos“ in der Törn-Ansicht */
  panel: HTMLElement;
  lightbox: SxPhotoLightbox;
  upload: SxPhotoUpload;
  layer: PhotoMapLayer;
  toast: (msg: string, ms?: number) => void;
  openLogin: (reason: string) => void;
  /** Unterstützen-Angebot zeigen (Konto › Freigaben) */
  openSupport: () => void;
  /** neue Fotoliste (für Diagramm-Ticks und Hover-Verknüpfung) */
  onPhotos: (photos: Photo[]) => void;
}

interface BatchItem {
  key: string;
  file: File;
  processed: ProcessedPhoto | null;
  previewUrl: string | null;
  status: UploadItem['status'];
  error: string;
  caption: string;
}

let seq = 0;

/**
 * Fotos eines geteilten Törns (Konzept 3, Phase C): Laden, Galerie, Lightbox, Hochladen mit Platzierung und
 * Zeitversatz, manuelles Platzieren, Bearbeiten, Löschen. Kennt Store und Komponenten; die Karte nur über PhotoMapLayer.
 */
export class PhotosController {
  private current: { share: ShareMeta; key?: string } | null = null;
  private data: PhotoList = { photos: [], upload: null };
  private views: PhotoView[] = [];
  private batch: BatchItem[] = [];
  private offset = { min: 0, source: 'default' as OffsetSource, touched: false };
  private visibility: PhotoVisibility = 'public';
  private uploading = false;
  private cancelUpload = false;
  private active: string | null = null;

  constructor(
    private store: Store,
    private ui: PhotosUi,
  ) {}

  /** Fotos aller sichtbaren Fotos mit Zeit – für Diagramm und Hover. */
  get photos(): Photo[] {
    return this.data.photos;
  }

  // ---------------------------------------------------------------- Laden

  async load(share: ShareMeta, key?: string): Promise<void> {
    if (this.current?.share.id !== share.id) this.reset();
    this.current = { share, key };
    try {
      const data = await photoApi.list(share.id, key);
      if (this.current?.share.id !== share.id) return;
      this.setData(data);
      this.openFromUrl();
    } catch {
      if (this.current?.share.id === share.id) this.setData({ photos: [], upload: null });
    }
  }

  /** `?foto=<id>` (aus Galerien von Person, Boot, Verein – Konzept 13.1): Foto in der Lightbox öffnen, Parameter entfernen. */
  private openFromUrl() {
    const url = new URL(location.href);
    const id = url.searchParams.get('foto');
    if (!id) return;
    url.searchParams.delete('foto');
    history.replaceState(history.state, '', url);
    this.open(id);
  }

  hide(): void {
    this.current = null;
    this.reset();
    this.setData({ photos: [], upload: null });
  }

  private reset() {
    this.clearBatch();
    this.ui.upload.open = false;
    this.ui.lightbox.open = false;
    this.ui.layer.stopPlacing();
    this.active = null;
  }

  private setData(data: PhotoList) {
    this.data = data;
    const key = this.current?.key;
    this.views = data.photos.map((p) => ({ ...p, thumbUrl: photoImageUrl(p.id, 't', key), fullUrl: photoImageUrl(p.id, 'f', key) }));
    const isOwner = !!data.upload;
    Object.assign(this.ui.strip, { photos: this.views, isOwner, upload: data.upload, activeId: this.active });
    // Panel: Eigentümer immer (Hinzufügen bzw. Hinweis), andere nur mit Fotos.
    this.ui.panel.hidden = !this.current || (!isOwner && !this.views.length);
    Object.assign(this.ui.lightbox, { photos: this.views, isOwner });
    if (this.ui.lightbox.open && this.ui.lightbox.index >= this.views.length) {
      if (this.views.length) this.ui.lightbox.index = this.views.length - 1;
      else this.ui.lightbox.open = false;
    }
    this.renderMap();
    this.ui.onPhotos(data.photos);
  }

  private reload(): Promise<void> {
    return this.current ? this.load(this.current.share, this.current.key) : Promise.resolve();
  }

  private renderMap() {
    const placed: MapPhoto[] = this.views
      .filter((p) => p.lat !== null && p.lon !== null)
      .map((p) => ({ id: p.id, lat: p.lat!, lon: p.lon!, thumbUrl: p.thumbUrl, caption: p.caption }));
    // Live-Vorschau des Upload-Stapels (Konzept 3.2: Regler mit Vorschau auf der Karte)
    const pending: MapPhoto[] = this.ui.upload.open
      ? this.ui.upload.items
          .filter((i) => i.status === 'ready' && i.placement !== 'none' && i.previewUrl)
          .flatMap((i) => {
            const pos = this.placedOf(i.key);
            return pos ? [{ id: `pending:${i.key}`, lat: pos.lat, lon: pos.lon, thumbUrl: i.previewUrl!, caption: i.caption || i.name, pending: true }] : [];
          })
      : [];
    this.ui.layer.set([...placed, ...pending]);
  }

  // ---------------------------------------------------------------- Hover und Lightbox

  /** Hebt ein Foto in Galerie, Karte und Lightbox hervor (Diagramm macht die App). */
  highlight(id: string | null): void {
    if (id?.startsWith('pending:')) id = null;
    if (id === this.active) return;
    this.active = id;
    this.ui.strip.activeId = id;
    this.ui.layer.highlight(id);
  }

  /** Foto, das zeitlich am nächsten an t liegt (Hover auf dem Track) – oder null. */
  nearestTo(t: number | null): Photo | null {
    return t === null ? null : nearestPhotoByTime(this.data.photos, t);
  }

  find(id: string): Photo | undefined {
    return this.data.photos.find((p) => p.id === id);
  }

  open(id: string): void {
    const index = this.views.findIndex((p) => p.id === id);
    if (index < 0) return;
    Object.assign(this.ui.lightbox, { index, open: true, error: '', busy: false });
    this.highlight(id);
  }

  nav(index: number): void {
    this.ui.lightbox.index = index;
    this.ui.lightbox.error = '';
    const p = this.views[index];
    if (p) this.highlight(p.id);
  }

  close(): void {
    this.ui.lightbox.open = false;
  }

  showOnMap(id: string): void {
    this.ui.lightbox.open = false;
    this.ui.layer.focus(id);
  }

  // ---------------------------------------------------------------- Bearbeiten (Eigentümer)

  private async ownerAct(fn: () => Promise<void>, done?: string): Promise<boolean> {
    Object.assign(this.ui.lightbox, { busy: true, error: '' });
    try {
      await fn();
      if (done) this.ui.toast(done);
      await this.reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        this.ui.lightbox.open = false;
        this.ui.openLogin('Deine Anmeldung ist abgelaufen – bitte erneut anmelden.');
      }
      this.ui.lightbox.error = errorText(e);
      return false;
    } finally {
      this.ui.lightbox.busy = false;
    }
  }

  save(d: { id: string; caption: string; visibility: PhotoVisibility }) {
    return this.ownerAct(async () => {
      await photoApi.update(d.id, { caption: d.caption, visibility: d.visibility });
    }, 'Foto gespeichert');
  }

  async remove(id: string): Promise<void> {
    const ok = await this.ownerAct(() => photoApi.remove(id), 'Foto gelöscht');
    if (ok && !this.views.length) this.ui.lightbox.open = false;
  }

  /** Manuell platzieren: nächster Klick auf die Karte, rastet auf den nächsten Trackpunkt ein (Konzept 3.2). */
  place(id: string): void {
    const photo = this.find(id);
    if (!photo) return;
    this.ui.lightbox.open = false;
    this.ui.toast('Tippe auf den Track, um das Foto dort zu setzen – Esc bricht ab.', 6000);
    this.ui.layer.startPlacing(
      (lat, lon) => {
        const snap = snapToTrack(this.trackPoints(), lat, lon);
        if (!snap) return;
        void this.ownerAct(async () => {
          // Ohne Aufnahmezeit übernimmt das Foto die Zeit des Trackpunkts – so erscheint es auch im Diagramm.
          await photoApi.update(id, { lat: snap.lat, lon: snap.lon, placement: 'manual', ...(photo.takenAt === null && snap.time !== null ? { takenAt: snap.time } : {}) });
        }, 'Foto gesetzt').then((ok) => !ok && this.ui.toast(this.ui.lightbox.error || 'Foto konnte nicht gesetzt werden.'));
      },
      () => this.ui.toast('Platzieren abgebrochen'),
    );
  }

  support(): void {
    this.ui.openSupport();
  }

  // ---------------------------------------------------------------- Hochladen

  private trackPoints(): PlacePoint[] {
    return visibleTracks(this.store.get()).flatMap((t) => t.points);
  }

  openUpload(): void {
    const u = this.data.upload;
    if (!this.current || !u) return;
    if (!u.allowed) return this.ui.toast(u.reason === 'supporter_required' ? 'Fotos gibt es nur für Unterstützer.' : 'Gerade können keine Fotos hinzukommen.');
    Object.assign(this.ui.upload, { open: true, error: '', progress: null, busy: false, remaining: Math.max(0, u.max - u.used) });
    this.renderBatch();
  }

  closeUpload(): void {
    if (this.uploading) {
      // Laufender Upload: nach dem aktuellen Foto aufhören, Hochgeladenes bleibt.
      this.cancelUpload = true;
      return;
    }
    this.ui.upload.open = false;
    this.clearBatch();
    this.renderMap();
  }

  private clearBatch() {
    for (const b of this.batch) if (b.previewUrl) URL.revokeObjectURL(b.previewUrl);
    this.batch = [];
    this.offset = { min: 0, source: 'default', touched: false };
    this.visibility = 'public';
    this.ui.upload.items = [];
  }

  async addFiles(files: File[]): Promise<void> {
    const u = this.data.upload;
    const room = Math.max(0, (u ? u.max - u.used : 0) - this.batch.length);
    const take = files.slice(0, Math.min(room, MAX_BATCH - this.batch.length));
    if (take.length < files.length) this.ui.upload.error = `Es passen nur noch ${room} Fotos in diesen Törn (höchstens ${MAX_BATCH} auf einmal) – die übrigen wurden nicht übernommen.`;
    const fresh: BatchItem[] = take.map((file) => ({ key: `b${++seq}`, file, processed: null, previewUrl: null, status: 'reading', error: '', caption: '' }));
    this.batch.push(...fresh);
    this.renderBatch();
    // Nacheinander: große Fotos parallel zu dekodieren sprengt den Speicher mobiler Browser.
    for (const it of fresh) {
      try {
        it.processed = await processPhoto(it.file);
        it.previewUrl = URL.createObjectURL(it.processed.thumb);
        it.status = 'ready';
      } catch (e) {
        it.status = 'error';
        it.error = e instanceof PhotoError ? e.message : 'Bild konnte nicht gelesen werden.';
      }
      if (!this.batch.includes(it)) {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
        continue;
      }
      if (!this.offset.touched) this.estimate();
      this.renderBatch();
    }
  }

  private estimate() {
    const clues = this.batch.filter((b) => b.processed).map((b) => b.processed!.exif);
    const est = estimateOffset(clues, this.trackPoints(), -new Date(this.trackPoints().find((p) => p.time !== null)?.time ?? Date.now()).getTimezoneOffset());
    this.offset = { ...this.offset, min: est.offsetMin, source: est.source };
  }

  setOffset(min: number): void {
    this.offset = { ...this.offset, min: clampOffset(min), touched: true };
    this.renderBatch();
  }

  setCaption(key: string, caption: string): void {
    const it = this.batch.find((b) => b.key === key);
    if (it) it.caption = caption.trim();
    this.renderBatch();
  }

  removeItem(key: string): void {
    const it = this.batch.find((b) => b.key === key);
    if (!it) return;
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    this.batch = this.batch.filter((b) => b !== it);
    this.renderBatch();
  }

  setVisibility(v: PhotoVisibility): void {
    this.visibility = v === 'private' ? 'private' : 'public';
    this.ui.upload.visibility = this.visibility;
  }

  /** Platzierung aller fertigen Fotos mit dem aktuellen Versatz. */
  private placements() {
    const ready = this.batch.filter((b) => b.processed);
    const placed = placePhotos(
      ready.map((b) => b.processed!.exif),
      this.trackPoints(),
      this.offset.min,
    );
    return new Map(ready.map((b, i) => [b.key, placed[i]]));
  }

  private placedOf(key: string) {
    const p = this.placements().get(key);
    return p && p.lat !== null && p.lon !== null ? { lat: p.lat, lon: p.lon } : null;
  }

  private renderBatch() {
    const placed = this.placements();
    this.ui.upload.items = this.batch.map((b): UploadItem => {
      const p = placed.get(b.key);
      return {
        key: b.key,
        name: b.file.name,
        previewUrl: b.previewUrl,
        status: b.status,
        error: b.error,
        placement: p?.placement ?? 'none',
        gpsRejected: p?.gpsRejected ?? false,
        takenAt: p?.takenAt ?? null,
        usesOffset: !!b.processed && b.processed.exif.localTime !== null && b.processed.exif.offsetMin === null,
        caption: b.caption,
      };
    });
    Object.assign(this.ui.upload, { offsetMin: this.offset.min, offsetSource: this.offset.source, visibility: this.visibility });
    this.renderMap();
  }

  async submitUpload(): Promise<void> {
    const cur = this.current;
    if (!cur || this.uploading) return;
    const placed = this.placements();
    const todo = this.batch.filter((b) => b.status === 'ready' && b.processed);
    if (!todo.length) return;
    this.uploading = true;
    this.cancelUpload = false;
    Object.assign(this.ui.upload, { busy: true, error: '', progress: { done: 0, total: todo.length, current: 0 } });
    let done = 0;
    let stop: string | null = null;
    for (const it of todo) {
      if (this.cancelUpload) break;
      const p = placed.get(it.key)!;
      it.status = 'uploading';
      this.renderBatch();
      try {
        const proc = it.processed!;
        await photoApi.upload(
          cur.share.id,
          proc.thumb,
          proc.full,
          { caption: it.caption, takenAt: p.takenAt, lat: p.lat, lon: p.lon, placement: p.placement, visibility: this.visibility },
          (f) => (this.ui.upload.progress = { done, total: todo.length, current: f }),
        );
        it.status = 'done';
        done++;
      } catch (e) {
        it.status = 'error';
        it.error = errorText(e);
        // Grenzen, Notbremse, Unterstützung, Anmeldung: weitere Versuche sind sinnlos.
        if (e instanceof ApiError && [401, 402, 403, 409, 503].includes(e.status)) {
          stop = errorText(e);
          if (e.status === 401) {
            this.store.set({ user: null });
            this.ui.openLogin('Deine Anmeldung ist abgelaufen – bitte erneut anmelden.');
          }
          break;
        }
      }
      this.ui.upload.progress = { done, total: todo.length, current: 0 };
      this.renderBatch();
    }
    this.uploading = false;
    Object.assign(this.ui.upload, { busy: false, progress: null, error: stop ?? '' });
    if (done) this.ui.toast(done === 1 ? '1 Foto hochgeladen' : `${done} Fotos hochgeladen`);
    // Hochgeladene aus dem Stapel nehmen; ist nichts mehr offen, Dialog schließen.
    for (const b of this.batch.filter((x) => x.status === 'done')) if (b.previewUrl) URL.revokeObjectURL(b.previewUrl);
    this.batch = this.batch.filter((b) => b.status !== 'done');
    const cancelled = this.cancelUpload;
    this.cancelUpload = false;
    await this.reload();
    if (cancelled || (!this.batch.length && !stop)) {
      this.ui.upload.open = false;
      this.clearBatch();
    } else {
      const u = this.data.upload;
      if (u) this.ui.upload.remaining = Math.max(0, u.max - u.used);
    }
    this.renderBatch();
  }
}
