// Beiträge als Grundtyp (Konzept 21): „Mein Verlauf“ auf der eigenen Seite laden und blättern (F-401) – die alte Adresse
// des Fahrtenbuch-Reiters (`?bereich=fahrtenbuch`) führt auf `/konto/fahrtenbuch` (F-459) –, Sichtbarkeit und „Sichtbar bis“ ändern (F-409), eigene Beiträge und Törns löschen (F-404), „Ins Fahrtenbuch“
// schalten (F-422) und „Ansehen als …“ (F-423). Die Komponenten melden nur Absichten.
import { api, postApi } from '../services/api';
import type { SxProfilePage } from '../components/sx-profile-page';
import type { MyPostArea, PostKind, PostVisibility, ProfilePreview, Reach } from '../domain/posts';
import type { LogState } from '../domain/logbook';
import { errorText } from './session';

export class PostsController {
  constructor(private ui: { page: SxProfilePage; toast: (msg: string, ms?: number) => void }) {}

  private get page() {
    return this.ui.page;
  }


  private ownHandle(): string | null {
    const d = this.page.data;
    return d?.kind === 'profile' && (d.profile.isSelf || d.preview) ? d.profile.handle : null;
  }

  /**
   * Eigene Seite geöffnet: Unterstützer-Status (für „Nur ich“), Verläufe mit Stufen und eigene Törns (Schreiben,
   * „Sichtbar bis“ ändern) und die erste Seite „Mein Verlauf“.
   */
  async openOwn(): Promise<void> {
    this.page.myArea = 'all';
    const [support, compose] = await Promise.all([api.support().catch(() => null), postApi.compose().catch(() => null), this.load()]);
    this.page.supporter = !!support?.supporter;
    this.page.myTargets = compose?.targets ?? [];
  }

  /** Erste Seite des gewählten Bereichs (bzw. weitere mit `more`). */
  async load(more = false): Promise<void> {
    const page = this.page;
    const cursor = more ? (page.myPosts?.cursor ?? null) : null;
    if (more && !cursor) return;
    page.myLoading = true;
    try {
      const next = await postApi.mine(page.myArea, cursor);
      page.myPosts = more && page.myPosts ? { items: [...page.myPosts.items, ...next.items], cursor: next.cursor } : next;
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    } finally {
      page.myLoading = false;
    }
  }

  /** Reiter wechseln („Alles“ bzw. „Nur ich“). */
  setArea(area: MyPostArea): Promise<void> {
    this.page.myArea = area;
    this.page.myPosts = null;
    return this.load();
  }

  /** Sichtbarkeit bzw. „Sichtbar bis“ eines Text-Beitrags ändern (F-409). */
  async update(id: string, patch: { visibility: PostVisibility; reach: Reach }): Promise<void> {
    if (await this.run(() => postApi.update(id, patch), 'Gespeichert')) await this.load();
  }

  async remove(id: string, kind: PostKind): Promise<void> {
    const voyage = kind === 'voyage' || kind === 'logbook';
    if (!confirm(voyage ? 'Diesen Törn samt Fotos und Kommentaren löschen?' : 'Diesen Beitrag löschen?')) return;
    if (await this.run(() => postApi.remove(id), voyage ? 'Törn gelöscht' : 'Beitrag gelöscht')) await this.refresh();
  }

  /** „Ins Fahrtenbuch“ an/aus bzw. bestätigen – danach Liste und Kennzahlen neu. */
  async setLogState(id: string, logState: LogState): Promise<void> {
    const msg = logState === 'excluded' ? 'Nicht mehr im Fahrtenbuch' : logState === 'confirmed' ? 'Im Fahrtenbuch bestätigt' : 'Wieder im Fahrtenbuch';
    if (await this.run(() => api.updateShare(id, { logState }), msg)) await this.refresh();
  }

  /** Törn umbenennen (F-424) – auch „Nur mit Link“, der Schlüssel bleibt. */
  async rename(id: string, title: string): Promise<void> {
    if (await this.run(() => api.updateShare(id, { title }), 'Umbenannt')) await this.load();
  }

  /** „Ansehen als …“ (F-423): eigene Seite mit simuliertem Betrachter laden; null beendet die Vorschau. */
  async preview(preview: ProfilePreview | null): Promise<void> {
    const handle = this.ownHandle();
    if (!handle) return;
    try {
      const d = await api.profile(handle, null, preview);
      this.page.data = { kind: 'profile', ...d };
      this.page.renderRoot.querySelector('.page')?.scrollIntoView({ block: 'start' });
      if (!preview) await this.openOwn();
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    }
  }

  /** Nach Löschen bzw. Umschalten: Profil (Kennzahlen, Törns) und „Mein Verlauf“ neu laden. */
  private async refresh(): Promise<void> {
    const handle = this.ownHandle();
    if (!handle) return;
    try {
      const d = await api.profile(handle);
      this.page.data = { kind: 'profile', ...d };
    } catch {
      // Kennzahlen bleiben dann alt – die Liste unten zählt
    }
    await this.load();
  }

  private async run(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    this.page.busy = true;
    try {
      await fn();
      this.ui.toast(ok);
      return true;
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
      return false;
    } finally {
      this.page.busy = false;
    }
  }
}
