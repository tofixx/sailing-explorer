// Veranstaltungen (Konzept 30, F-481 … F-487): Zusage (Gäste melden sich erst an), „Wer kommt?“, Kalender-Datei,
// „Ins Fahrtenbuch übernehmen“, Ändern und Absagen. Die Karte (`sx-event`) meldet nur Absichten und bekommt die
// Antwort des Servers zurück; der Ändern-Dialog ist einmal da (`sx-event-dialog`).
import { eventApi, type EventFields } from '../services/api';
import type { SxEvent } from '../components/sx-event';
import type { SxEventDialog } from '../components/sx-event-dialog';
import type { ConfirmRequest } from '../components/sx-confirm';
import { emptyCounts, eventIcs, icsFileName, type EventView, type LogbookPreset, type RsvpStatus } from '../domain/events';
import { errorText } from './session';

interface EventsUi {
  dialog: SxEventDialog;
  toast: (msg: string, ms?: number) => void;
  requireLogin: (reason: string, then: () => void) => void;
  signedIn: () => boolean;
  ask: (req: ConfirmRequest) => Promise<boolean>;
  /** Fahrtenbuch-Formular mit Vorbelegung öffnen (F-487) */
  startLogbook: (preset: LogbookPreset) => void;
}

export class EventsController {
  /** Karte, deren Veranstaltung gerade im Ändern-Dialog ist */
  private editing: SxEvent | null = null;
  private busy = false;

  constructor(private ui: EventsUi) {}

  /** Zusage (F-481): ohne Anmeldung erst anmelden, danach geht es weiter; abgelehnt (voll, vorbei) → Hinweis an der Karte. */
  rsvp(d: { id: string; status: RsvpStatus; key: string | null; el: SxEvent }): void {
    // Gäste: erst anmelden – bis dahin keine sofortige Anzeige
    if (!this.ui.signedIn()) d.el.local = null;
    this.ui.requireLogin('Melde dich an, um zuzusagen. Danach geht es direkt weiter.', () => void this.sendRsvp(d));
  }

  private async sendRsvp(d: { id: string; status: RsvpStatus; key: string | null; el: SxEvent }): Promise<void> {
    try {
      const { event } = await eventApi.rsvp(d.id, d.status, d.key);
      d.el.event = event;
      if (d.el.whoOpen) await this.who(d);
    } catch (e) {
      d.el.local = null;
      d.el.error = errorText(e);
    }
  }

  /** „Wer kommt?“ (F-483) nachladen. */
  async who(d: { id: string; key: string | null; el: SxEvent }): Promise<void> {
    d.el.who = null;
    try {
      d.el.who = await eventApi.who(d.id, d.key);
    } catch (e) {
      d.el.who = { people: { yes: [], maybe: [], no: [] }, others: emptyCounts(), all: false };
      this.ui.toast(errorText(e));
    }
  }

  /** Kalender-Datei (F-486) – im Browser erzeugt, kein Server-Weg. */
  ics(d: { id: string; title: string; description: string; event: EventView; path: string }): void {
    const url = `${location.origin}${d.path || `/p/${d.id}`}`;
    const text = eventIcs({ id: d.id, title: d.title, description: d.description, url, host: location.hostname, ...d.event }, Date.now());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    a.download = icsFileName(d.title);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** „Ins Fahrtenbuch übernehmen“ (F-487): das Fahrtenbuch-Formular, vorbelegt mit Datum und Titel. */
  logbook(d: { preset: LogbookPreset }): void {
    this.ui.startLogbook(d.preset);
  }

  /** „Ändern oder absagen“ (F-484) – nur die Autor:in sieht den Knopf, der Server prüft es. */
  edit(d: { id: string; event: EventView; el: SxEvent }): void {
    this.editing = d.el;
    Object.assign(this.ui.dialog, { postId: d.id, event: d.event, error: '', busy: false, open: true });
  }

  close(): void {
    this.ui.dialog.open = false;
    this.editing = null;
  }

  async save(d: { id: string; patch: EventFields }): Promise<void> {
    const { description: _d, ...patch } = d.patch;
    await this.update(d.id, patch, 'Gespeichert');
  }

  async cancel(d: { id: string }): Promise<void> {
    const ok = await this.ui.ask({
      heading: 'Veranstaltung absagen?',
      text: 'Alle mit Zusage bekommen eine Nachricht. Die Karte bleibt als „Abgesagt“ stehen; zurücknehmen geht nicht.',
      confirmLabel: 'Absagen',
    });
    if (ok) await this.update(d.id, { cancel: true }, 'Abgesagt');
  }

  private async update(id: string, patch: Parameters<typeof eventApi.update>[1], done: string): Promise<void> {
    const dlg = this.ui.dialog;
    if (this.busy) return;
    this.busy = dlg.busy = true;
    dlg.error = '';
    try {
      const { event } = await eventApi.update(id, patch);
      if (this.editing) this.editing.event = event;
      this.close();
      this.ui.toast(done);
    } catch (e) {
      dlg.error = errorText(e);
    } finally {
      this.busy = dlg.busy = false;
    }
  }
}
