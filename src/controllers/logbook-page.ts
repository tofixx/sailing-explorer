// Verwaltungsbereich „Mein Fahrtenbuch“ (`/konto/fahrtenbuch`, Konzept 27): Fahrtenbuch laden (Gäste melden sich erst
// an), Saison und Filter in der Adresse merken (`?saison=2026&stand=confirmed`), Stand ändern (F-422) und Einträge über
// das vorhandene Fahrtenbuch-Formular bearbeiten. Wird mit der Seite erst auf `/konto/fahrtenbuch` nachgeladen; die Seite
// meldet nur Absichten (Events an ihr selbst).
import '../components/sx-logbook-page';
import { ApiError, api, type ShareMeta } from '../services/api';
import type { SxLogbookPage } from '../components/sx-logbook-page';
import { DEFAULT_LOG_FILTER, logbookSeasons, parseLogFilter } from '../domain/logbook-year';
import type { LogState } from '../domain/logbook';
import { seasonOf } from '../domain/support';
import { errorText } from './session';

interface LogbookPageUi {
  page: SxLogbookPage;
  toast(msg: string, ms?: number): void;
  /** Anmeldung abwarten (Konto bekannt) */
  ready(): Promise<void>;
  signedIn(): boolean;
  requireLogin(reason: string, then: () => void): void;
  /** Fahrtenbuch-Formular für einen eigenen Törn öffnen; nach dem Speichern `reload` statt Törn-Ansicht */
  edit(share: ShareMeta): void;
}

export class LogbookPageController {
  constructor(private ui: LogbookPageUi) {
    const on = <T>(name: string, fn: (d: T) => void) => ui.page.addEventListener(name, (e) => fn((e as CustomEvent<T>).detail));
    on<{ season: number }>('sx-logbook-season', (d) => this.setSeason(d.season));
    on<{ states: LogState[] }>('sx-logbook-filter', (d) => this.setFilter(d.states));
    on<{ id: string; logState: LogState }>('sx-logbook-state', (d) => void this.setLogState(d.id, d.logState));
    on<{ id: string }>('sx-logbook-edit-entry', (d) => void this.edit(d.id));
    // Druckdialog des Browsers (F-458) – der Druckstil zeigt nur die Fahrtenbuch-Seite
    on('sx-logbook-print', () => window.print());
  }

  private get page() {
    return this.ui.page;
  }

  async open(): Promise<void> {
    const q = new URLSearchParams(location.search);
    const season = Number(q.get('saison'));
    this.page.season = Number.isInteger(season) && season > 2000 ? season : seasonOf(Date.now());
    this.page.states = parseLogFilter(q.get('stand'));
    this.page.hidden = false;
    await this.ui.ready();
    if (!this.ui.signedIn()) {
      this.page.signedIn = false;
      return this.ui.requireLogin('Melde dich an, um dein Fahrtenbuch zu sehen.', () => void this.reload());
    }
    await this.reload();
  }

  /** Alles neu laden – nach Anmeldung, Speichern im Formular oder Ändern des Stands. */
  async reload(): Promise<void> {
    const page = this.page;
    page.signedIn = true;
    page.error = '';
    page.loading = true;
    try {
      page.entries = (await api.myLogbook()).entries;
      // gewählte Saison ohne Einträge (z. B. im November schon die nächste): die neueste mit Einträgen
      const seasons = logbookSeasons(page.entries, Date.now());
      if (!seasons.includes(page.season)) {
        page.season = seasons[0];
        this.syncUrl();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) page.signedIn = false;
      else page.error = errorText(e);
    } finally {
      page.loading = false;
    }
  }

  setSeason(season: number): void {
    this.page.season = season;
    this.syncUrl();
  }

  setFilter(states: LogState[]): void {
    this.page.states = states;
    this.syncUrl();
  }

  /** Bestätigen, ausschließen oder wieder aufnehmen (F-422). */
  async setLogState(id: string, logState: LogState): Promise<void> {
    const msg = logState === 'excluded' ? 'Nicht mehr im Fahrtenbuch' : logState === 'confirmed' ? 'Im Fahrtenbuch bestätigt' : 'Wieder im Fahrtenbuch';
    this.page.busy = true;
    try {
      await api.updateShare(id, { logState });
      this.ui.toast(msg);
      await this.reload();
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    } finally {
      this.page.busy = false;
    }
  }

  /** Eintrag im Fahrtenbuch-Formular bearbeiten (eigener Törn, mit allen Angaben). */
  async edit(id: string): Promise<void> {
    this.page.busy = true;
    try {
      const { share } = await api.shareMeta(id);
      this.ui.edit(share);
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    } finally {
      this.page.busy = false;
    }
  }

  /** Saison und Filter in der Adresse (Neuladen, Lesezeichen); der Standard-Filter steht nicht darin. */
  private syncUrl(): void {
    const url = new URL(location.href);
    url.searchParams.set('saison', String(this.page.season));
    const states = this.page.states;
    if (states.length === DEFAULT_LOG_FILTER.length && DEFAULT_LOG_FILTER.every((s) => states.includes(s))) url.searchParams.delete('stand');
    else url.searchParams.set('stand', states.join(','));
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
}
