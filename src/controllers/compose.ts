// Plus-Knopf (Konzept 21.4, F-405): Text-Beitrag in einen Verlauf schreiben – Gäste melden sich zuerst an (danach geht
// es weiter, wie F-312), die offene Gruppen-, Hafen- bzw. Bootsseite ist vorausgewählt. Nach dem Veröffentlichen geht
// es in den Heimatverlauf, die neue Karte wird hervorgehoben (F-406). Die Komponenten melden nur Absichten.
import { postApi, type ChannelPostInput, type CreatedPost } from '../services/api';
import type { SxComposeDialog } from '../components/sx-compose-dialog';
import type { ComposeKind } from '../components/sx-compose';
import { pickGpx } from '../components/shared';
import { errorText } from './session';

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
    },
  ) {}

  /** Seite gewechselt: deren Verlauf beim nächsten „+ Neu → Text“ vorauswählen. */
  setContext(ctx: ComposeContext): void {
    this.ctx = ctx;
  }

  /**
   * „+ Neu“ (F-405): eine Art gewählt. „Törn (GPX)“ öffnet die Dateiauswahl sofort – noch in der Klick-Geste, ohne
   * Anmeldung (lokal ausgewertet, Prinzip Security 1); die Dateien kommen wie beim Ziehen & Ablegen als `sx-files`.
   */
  open(kind: ComposeKind): void {
    if (kind === 'gpx') pickGpx(document.body);
    else if (kind === 'logbook') this.ui.startLogbook();
    else this.openText();
  }

  private openText(): void {
    this.ui.requireLogin('Melde dich an, um einen Beitrag zu schreiben. Danach geht es direkt weiter.', () => void this.show());
  }

  private async show(): Promise<void> {
    const d = this.ui.dialog;
    Object.assign(d, { open: true, loading: true, error: '', targets: [], shares: [] });
    try {
      const data = await postApi.compose(this.ctx ? `${this.ctx.kind}:${this.ctx.id}` : null);
      Object.assign(d, { targets: data.targets, shares: data.shares, selected: data.preselect ?? 'user' });
    } catch (e) {
      d.error = errorText(e);
    } finally {
      d.loading = false;
    }
  }

  close(): void {
    this.ui.dialog.open = false;
  }

  async submit(input: ChannelPostInput): Promise<void> {
    const d = this.ui.dialog;
    d.busy = true;
    d.error = '';
    try {
      const { post } = await postApi.createIn(input);
      d.clear();
      d.open = false;
      this.ui.toast('Veröffentlicht');
      this.ui.posted(post);
    } catch (e) {
      d.error = errorText(e);
    } finally {
      d.busy = false;
    }
  }
}
