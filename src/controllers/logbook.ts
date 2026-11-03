// Fahrtenbuch (Konzept 19): Formular öffnen (Gäste melden sich erst an, L5), speichern und danach die Törn-Ansicht
// öffnen; Panel mit den Angaben des geöffneten Törns.
import { ApiError, api, type ShareMeta } from '../services/api';
import type { SxLogbookForm, LogbookSave } from '../components/sx-logbook-form';
import { SxLogbookPanel } from '../components/sx-logbook-panel';
import type { LogSuggestion } from '../domain/logbook-suggest';
import { errorText } from './session';
import type { LogbookPreset } from '../domain/events';
import { scoringApi } from '../services/scoring-api';

/** Wie das Formular aufgeht: mit Vorschlägen aus dem Track (GPX-Törn) und was nach dem Speichern passiert. */
export interface LogbookStart {
  suggestion?: LogSuggestion | null;
  /** neuer Eintrag aus einer Veranstaltung: Datum, Titel, Zusatzangaben (F-487) */
  preset?: LogbookPreset | null;
  /** statt der Törn-Ansicht (z. B. Fahrtenbuch-Seite neu laden) */
  after?: (id: string) => void;
}

interface LogbookUi {
  form: SxLogbookForm;
  panel: SxLogbookPanel;
  /** sx-panel um das Panel */
  box: HTMLElement;
  requireLogin(reason: string, then: () => void): void;
  /** Törn-Ansicht öffnen */
  open(path: string): void;
}

export class LogbookController {
  constructor(private ui: LogbookUi) {}

  private after: LogbookStart['after'] = undefined;

  /** „Ohne GPX eintragen“ bzw. „Bearbeiten“ (F-300, F-312, F-461); `preset`: aus einer Veranstaltung übernommen (F-487). */
  start(share: ShareMeta | null = null, o: LogbookStart = {}): void {
    this.after = o.after;
    this.ui.requireLogin('Melde dich an, um ins Fahrtenbuch einzutragen. Danach geht es direkt weiter.', () => void this.openForm(share, o.suggestion ?? null, o.preset ?? null));
  }

  private async openForm(share: ShareMeta | null, suggestion: LogSuggestion | null, preset: LogbookPreset | null) {
    const f = this.ui.form;
    Object.assign(f, { share, suggestion, preset, error: '', busy: false, used: -1 });
    // Boote und Kontingent nebenbei – das Formular geht sofort auf
    f.open = true;
    const [boats, support, scoring] = await Promise.all([
      api.myBoats().catch(() => ({ boats: [] })),
      api.support().catch(() => null),
      // Wertungsvorlagen (F-501): ohne Antwort bleibt „Nur Meilen“
      scoringApi.mine().catch(() => null),
    ]);
    Object.assign(f, {
      boats: boats.boats,
      templates: scoring?.templates ?? [],
      lastTemplateId: scoring?.lastTemplateId ?? null,
      supporter: !!support?.supporter,
      used: support?.logEntriesUsed ?? -1,
      max: support?.logEntriesMax ?? f.max,
    });
  }

  close(): void {
    this.ui.form.open = false;
  }

  async save(d: LogbookSave): Promise<void> {
    const f = this.ui.form;
    f.busy = true;
    f.error = '';
    try {
      const { share } = 'input' in d ? await api.createManualShare(d.input) : await api.updateShare(d.id, d.patch);
      f.open = false;
      if (this.after) this.after(share.id);
      else this.ui.open(`/s/${share.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        f.open = false;
        return this.start(f.share, { suggestion: f.suggestion, after: this.after });
      }
      f.error = errorText(e);
    } finally {
      f.busy = false;
    }
  }

  /** Panel für den geöffneten Törn (null = keiner). */
  show(share: ShareMeta | null): void {
    this.ui.panel.share = share;
    this.ui.box.hidden = !SxLogbookPanel.shows(share);
  }
}
