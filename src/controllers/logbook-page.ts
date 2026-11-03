// Verwaltungsbereich „Mein Fahrtenbuch“ (`/konto/fahrtenbuch`, Konzept 27): Fahrtenbuch laden (Gäste melden sich erst
// an), Saison und Filter in der Adresse merken (`?saison=2026&stand=confirmed`), Stand ändern (F-422) und Einträge über
// das vorhandene Fahrtenbuch-Formular bearbeiten; Saisonrückblick „Meine Saison“ als Bild (Konzept 33: zeichnen, teilen,
// herunterladen – alles im Browser, nichts geht an den Server). Wird mit der Seite erst auf `/konto/fahrtenbuch` nachgeladen; die Seite
// meldet nur Absichten (Events an ihr selbst).
import '../components/sx-logbook-page';
import { ApiError, api, type ShareMeta } from '../services/api';
import type { SxLogbookPage } from '../components/sx-logbook-page';
import { DEFAULT_LOG_FILTER, logbookSeasons, parseLogFilter, pickSeason } from '../domain/logbook-year';
import type { LogState } from '../domain/logbook';
import { shownSeason } from '../domain/support';
import { errorText } from './session';
import { scoringApi } from '../services/scoring-api';
import { APP_NAME } from '../domain/brand';
import { seasonImageFileName } from '../domain/season-review';
import { renderSeasonImage } from '../services/season-image';
import { downloadFile, shareOrDownload, type ImageFormat } from '../services/share-image';

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
    on<{ season: number | 'alle' }>('sx-logbook-season', (d) => this.setSeason(d.season));
    on<{ states: LogState[] }>('sx-logbook-filter', (d) => this.setFilter(d.states));
    on<{ id: string; logState: LogState }>('sx-logbook-state', (d) => void this.setLogState(d.id, d.logState));
    on<{ id: string }>('sx-logbook-edit-entry', (d) => void this.edit(d.id));
    // Druckdialog des Browsers (F-458) – der Druckstil zeigt nur die Fahrtenbuch-Seite
    on('sx-logbook-print', () => window.print());
    // Saisonrückblick (F-522, F-523)
    on('sx-season-open', () => void this.renderSeason('square'));
    on<{ format: ImageFormat }>('sx-season-format', (d) => void this.renderSeason(d.format));
    on('sx-season-share', () => void this.shareSeason());
    on('sx-season-download', () => {
      const f = this.seasonFile();
      if (f) downloadFile(f);
    });
    on('sx-season-close', () => this.closeSeason());
  }

  /** zuletzt gezeichnetes Saison-Bild (nur im Speicher) und Zähler gegen überholte Läufe */
  private seasonBlob: Blob | null = null;
  private seasonSeq = 0;

  private get page() {
    return this.ui.page;
  }

  async open(): Promise<void> {
    const q = new URLSearchParams(location.search);
    this.page.all = q.get('saison') === 'alle';
    const season = Number(q.get('saison'));
    this.page.season = Number.isInteger(season) && season > 2000 ? season : shownSeason(Date.now());
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
      // Wertungsvorlagen für die Punkte (F-505) nebenbei – ohne Antwort rechnet alles mit „Nur Meilen“
      const [logbook, scoring] = await Promise.all([api.myLogbook(), scoringApi.mine().catch(() => null)]);
      page.entries = logbook.entries;
      page.templates = scoring?.templates ?? [];
      // Einstieg „Wertung“ nur für Vereinsmitglieder und Admins der Vorschläge (F-507)
      page.scoringLink = (scoring?.clubs?.length ?? 0) > 0 || !!scoring?.admin;
      // gewählte Saison ohne Einträge: die nächstältere mit Einträgen, sonst die älteste (F-555)
      const season = pickSeason(logbookSeasons(page.entries, Date.now()), page.season);
      if (!page.all && season !== page.season) {
        page.season = season;
        this.syncUrl();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) page.signedIn = false;
      else page.error = errorText(e);
    } finally {
      page.loading = false;
    }
  }

  /** Saison wählen bzw. `'alle'` (Segellebenslauf, F-610); die zuletzt gewählte Saison bleibt dahinter erhalten. */
  setSeason(season: number | 'alle'): void {
    this.page.all = season === 'alle';
    if (season !== 'alle') this.page.season = season;
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

  /** Saison-Bild (neu) zeichnen und als Vorschau zeigen – öffnet den Dialog „Meine Saison“. */
  async renderSeason(format: ImageFormat): Promise<void> {
    const seq = ++this.seasonSeq;
    const prev = this.page.seasonImage;
    this.page.seasonImage = { url: prev?.url ?? '', busy: true, format };
    try {
      const blob = await renderSeasonImage(this.page.review(), format);
      if (seq !== this.seasonSeq || !this.page.seasonImage) return;
      if (prev?.url) URL.revokeObjectURL(prev.url);
      this.seasonBlob = blob;
      this.page.seasonImage = { url: URL.createObjectURL(blob), busy: false, format };
    } catch (e) {
      if (seq !== this.seasonSeq) return;
      this.page.seasonImage = prev ? { ...prev, busy: false } : null;
      this.ui.toast(`Bild: ${errorText(e)}`);
    }
  }

  private seasonFile(): File | null {
    return this.seasonBlob ? new File([this.seasonBlob], seasonImageFileName(this.page.review().season), { type: 'image/jpeg' }) : null;
  }

  private async shareSeason(): Promise<void> {
    const f = this.seasonFile();
    if (f) await shareOrDownload(f, `Meine Saison ${this.page.review().season} · ${APP_NAME}`);
  }

  /** Dialog schließen: Vorschau verwerfen, nichts bleibt zurück. */
  closeSeason(): void {
    this.seasonSeq++;
    if (this.page.seasonImage?.url) URL.revokeObjectURL(this.page.seasonImage.url);
    this.page.seasonImage = null;
    this.seasonBlob = null;
  }

  /** Saison und Filter in der Adresse (Neuladen, Lesezeichen); der Standard-Filter steht nicht darin. */
  private syncUrl(): void {
    const url = new URL(location.href);
    url.searchParams.set('saison', this.page.all ? 'alle' : String(this.page.season));
    const states = this.page.states;
    if (states.length === DEFAULT_LOG_FILTER.length && DEFAULT_LOG_FILTER.every((s) => states.includes(s))) url.searchParams.delete('stand');
    else url.searchParams.set('stand', states.join(','));
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
}
