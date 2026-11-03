// Plus-Knopf (Konzept 21.4, F-405): Beitrag (Text, Umfrage – Konzept 29) in einen Verlauf schreiben – Gäste melden sich zuerst an (danach geht
// es weiter, wie F-312), die offene Gruppen-, Hafen- bzw. Bootsseite ist vorausgewählt. Nach dem Veröffentlichen geht
// es in den Heimatverlauf, die neue Karte wird hervorgehoben (F-406). Die Komponenten melden nur Absichten.
import { postApi, type ChannelPostInput, type CreatedPost } from '../services/api';
import { PhotoError, processPhoto } from '../services/photo-process';
import { composeCtx, type SxComposeDialog } from '../components/sx-compose-dialog';
import { channelKey } from '../domain/posts';
import type { ComposeKind } from '../components/sx-compose';
import { pickGpx } from '../components/shared';
import { errorText } from './session';
import type { ComposePostKind } from '../domain/posts';

/** Verlauf der offenen Seite (vorausgewählt), z. B. `group:<id>`. */
export type ComposeContext = { kind: 'group' | 'harbor' | 'boat'; id: string } | null;

export class ComposeController {
  private ctx: ComposeContext = null;

  constructor(
    private ui: {
      dialog: SxComposeDialog;
      toast: (msg: string, ms?: number) => void;
      requireLogin: (reason: string, then: () => void) => void;
      /** Fahrtenbuch-Formular (meldet selbst die Anmeldung, F-312) */
      startLogbook: () => void;
      /** nach dem Veröffentlichen: in den Heimatverlauf, Karte hervorheben */
      posted: (post: CreatedPost) => void;
      /** „Entwurf fortsetzen“ (F-436): den Entwurf aus dem Browser wieder öffnen */
      resumeDraft: () => void;
    },
  ) {}

  /** Seite gewechselt: deren Verlauf beim nächsten „+ Neu → Text“ vorauswählen. */
  setContext(ctx: ComposeContext): void {
    this.ctx = ctx;
  }

  /**
   * „+ Neu“ (F-405): eine Art gewählt. „Törn (GPX)“ öffnet die Dateiauswahl sofort – noch in der Klick-Geste, ohne
   * Anmeldung (lokal ausgewertet, Prinzip Security 1); die Dateien kommen als `sx-files` und beginnen einen neuen Törn
   * (F-434 – liegt ein Entwurf vor, fragt der WorkspaceController nach der Wahl nach). „Entwurf fortsetzen“ öffnet den
   * Entwurf aus dem Browser wieder (F-436).
   */
  open(kind: ComposeKind): void {
    if (kind === 'gpx') pickGpx(document.body);
    else if (kind === 'draft') this.ui.resumeDraft();
    else if (kind === 'logbook') this.ui.startLogbook();
    else this.openPost(kind);
  }

  /** Text, Umfrage bzw. Fotos (Galerie): ein Dialog, das Formular je Art (`KIND_FORMS` in sx-compose-dialog). */
  private openPost(kind: ComposePostKind): void {
    this.ui.requireLogin('Melde dich an, um einen Beitrag zu schreiben. Danach geht es direkt weiter.', () => void this.show(kind));
  }

  private async show(kind: ComposePostKind): Promise<void> {
    const d = this.ui.dialog;
    // payload: null – keine Nutzlast einer anderen Art (z. B. abgebrochene Umfrage) in dieses Formular mitnehmen
    Object.assign(d, { open: true, loading: true, error: '', targets: [], shares: [], kind, payload: null });
    try {
      const data = await postApi.compose(this.ctx ? `${this.ctx.kind}:${this.ctx.id}` : null);
      const selected = data.preselect ?? 'user';
      Object.assign(d, { targets: data.targets, shares: data.shares, selected, audience: null, gallery: data.gallery ?? null });
      const t = data.targets.find((x) => channelKey(x.ref) === selected) ?? data.targets[0];
      if (t) void this.loadAudience(composeCtx(t));
    } catch (e) {
      d.error = errorText(e);
    } finally {
      d.loading = false;
    }
  }

  /**
   * Publikum des gewählten Verlaufs für den Hinweis (F-465). Fehler sind still – ohne Zahl gibt es nur keinen Hinweis;
   * eine verspätete Antwort für einen inzwischen anderen Verlauf wird verworfen.
   */
  async loadAudience(ctx: string): Promise<void> {
    const d = this.ui.dialog;
    try {
      const { audience } = await postApi.audience(ctx);
      const t = d.targets.find((x) => channelKey(x.ref) === d.selected);
      if (t && composeCtx(t) === ctx) d.audience = audience;
    } catch {
      /* kein Hinweis */
    }
  }

  close(): void {
    this.ui.dialog.open = false;
  }

  async submit(input: ChannelPostInput): Promise<void> {
    const d = this.ui.dialog;
    d.busy = true;
    d.error = '';
    const { gallery, ...post } = input;
    const files = Array.isArray(gallery) ? gallery.filter((f) => f instanceof File) : [];
    try {
      if (post.kind === 'gallery' && !files.length) throw new Error('Bitte mindestens ein Foto wählen.');
      const created = (await postApi.createIn(post)).post;
      let note = 'Veröffentlicht';
      if (post.kind === 'gallery') {
        const up = await this.uploadAll(created.id, files).catch((e: unknown) => ({ done: 0, count: files.length, first: errorText(e) }));
        if (up.done === 0) {
          // ohne ein einziges Foto bliebe eine leere Karte – wieder löschen (die Nacht täte es sonst nach 24 h)
          await postApi.remove(created.id).catch(() => undefined);
          throw new Error(up.first || 'Kein Foto konnte hochgeladen werden.');
        }
        if (up.count) note = `Veröffentlicht – ${up.count === 1 ? '1 Foto' : `${up.count} Fotos`} nicht hochgeladen: ${up.first}`;
      }
      d.clear();
      d.open = false;
      this.ui.toast(note, note === 'Veröffentlicht' ? undefined : 6000);
      this.ui.posted(created);
    } catch (e) {
      d.error = errorText(e);
    } finally {
      d.busy = false;
      d.progress = '';
    }
  }

  /**
   * Galerie (Konzept 31, F-491): Fotos nacheinander verarbeiten (EXIF weg, verkleinert, Speicher mobiler Browser) und
   * hochladen; eine Grenze (Kontingent, Speicher, Notbremse) beendet den Rest. Liefert, wie viele gingen, und den ersten
   * Fehler.
   */
  private async uploadAll(postId: string, files: File[]): Promise<{ done: number; count: number; first: string }> {
    const d = this.ui.dialog;
    let done = 0;
    let first = '';
    for (const [i, file] of files.entries()) {
      d.progress = `Foto ${i + 1} von ${files.length} …`;
      try {
        const p = await processPhoto(file);
        await postApi.uploadPhoto(postId, p.thumb, p.full);
        done++;
      } catch (e) {
        first ||= e instanceof PhotoError ? e.message : errorText(e);
        const status = (e as { status?: number }).status;
        if (status === 402 || status === 409 || status === 503) break;
      }
    }
    return { done, count: files.length - done, first };
  }
}
