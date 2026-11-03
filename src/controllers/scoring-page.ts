// Verwaltungsbereich „Wertung“ (`/konto/wertung`, Konzept 32): Vorlagen und Vereine laden (Gäste melden sich erst an),
// Teilnahme an der Vereinsliste umschalten, Vereinsliste je Saison laden, Vorlagen übernehmen, anlegen, ändern und
// löschen (mit Rückfrage). Wird mit der Seite erst auf `/konto/wertung` nachgeladen; die Seite meldet nur Absichten.
import '../components/sx-scoring-page';
import type { SxScoringPage } from '../components/sx-scoring-page';
import type { ScoringSave } from '../components/sx-scoring-editor';
import type { ConfirmRequest } from '../components/sx-confirm';
import { ApiError } from '../services/api';
import { scoringApi } from '../services/scoring-api';
import { clubListSeason, type ScoringTemplate } from '../domain/scoring';
import { seasonOf } from '../domain/support';
import { errorText } from './session';

interface ScoringPageUi {
  page: SxScoringPage;
  toast(msg: string, ms?: number): void;
  ready(): Promise<void>;
  signedIn(): boolean;
  requireLogin(reason: string, then: () => void): void;
  ask(req: ConfirmRequest): Promise<boolean>;
}

export class ScoringPageController {
  constructor(private ui: ScoringPageUi) {
    const on = <T>(name: string, fn: (d: T) => void) => ui.page.addEventListener(name, (e) => fn((e as CustomEvent<T>).detail));
    on<{ groupId: string; optIn: boolean }>('sx-scoring-optin', (d) => void this.optIn(d.groupId, d.optIn));
    on<{ groupId: string; season: number }>('sx-scoring-list', (d) => void this.list(d.groupId, d.season));
    on<{ template: ScoringTemplate | null; groupId: string | null }>('sx-scoring-edit', (d) => this.edit(d.template, d.groupId));
    on<{ groupId: string; sourceId: string }>('sx-scoring-adopt', (d) => void this.adopt(d.groupId, d.sourceId));
    on<{ template: ScoringTemplate }>('sx-scoring-delete', (d) => void this.remove(d.template));
    on<ScoringSave>('sx-scoring-save', (d) => void this.save(d));
    on('sx-scoring-close', () => {
      const ed = this.page.editor;
      if (ed) ed.open = false;
    });
  }

  private get page() {
    return this.ui.page;
  }

  async open(): Promise<void> {
    // laufende Saison und die zwei davor; vorgewählt im November und Dezember die abgelaufene
    const now = Date.now();
    const current = seasonOf(now);
    this.page.seasons = [current, current - 1, current - 2];
    this.page.season = clubListSeason(now);
    this.page.hidden = false;
    await this.ui.ready();
    if (!this.ui.signedIn()) {
      this.page.signedIn = false;
      return this.ui.requireLogin('Melde dich an, um Wertung und Vereinslisten zu sehen.', () => void this.reload());
    }
    await this.reload();
  }

  async reload(): Promise<void> {
    const page = this.page;
    page.signedIn = true;
    page.error = '';
    try {
      page.data = await scoringApi.mine();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) page.signedIn = false;
      else page.error = errorText(e);
    }
  }

  /** Busy setzen, ausführen, Fehler als Hinweis. */
  private async run(fn: () => Promise<void>): Promise<void> {
    this.page.busy = true;
    try {
      await fn();
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    } finally {
      this.page.busy = false;
    }
  }

  optIn(groupId: string, optIn: boolean): Promise<void> {
    return this.run(async () => {
      await scoringApi.optIn(groupId, optIn);
      this.ui.toast(optIn ? 'Du nimmst an der Vereinsliste teil' : 'Du nimmst nicht mehr an der Vereinsliste teil');
      const { [groupId]: _drop, ...rest } = this.page.lists;
      this.page.lists = rest;
      await this.reload();
    });
  }

  list(groupId: string, season: number): Promise<void> {
    return this.run(async () => {
      const l = await scoringApi.clubList(groupId, season);
      this.page.lists = { ...this.page.lists, [groupId]: l };
    });
  }

  edit(template: ScoringTemplate | null, groupId: string | null): void {
    const ed = this.page.editor;
    if (!ed) return;
    Object.assign(ed, { template, groupId, error: '', busy: false, open: true });
  }

  adopt(groupId: string, sourceId: string): Promise<void> {
    return this.run(async () => {
      const { template } = await scoringApi.create({ groupId, sourceId });
      this.ui.toast(`„${template.name}“ übernommen – du kannst sie jetzt anpassen`);
      await this.reload();
    });
  }

  async save(d: ScoringSave): Promise<void> {
    const ed = this.page.editor;
    if (!ed) return;
    ed.busy = true;
    ed.error = '';
    try {
      const body = { name: d.name, rules: d.rules, ...(d.groupId ? { listWeight: d.listWeight } : {}) };
      if (d.id) await scoringApi.update(d.id, body);
      else await scoringApi.create({ ...body, groupId: d.groupId });
      ed.open = false;
      this.ui.toast('Vorlage gespeichert');
      this.page.lists = {};
      await this.reload();
    } catch (e) {
      ed.error = errorText(e);
    } finally {
      ed.busy = false;
    }
  }

  async remove(t: ScoringTemplate): Promise<void> {
    const ok = await this.ui.ask({
      heading: 'Vorlage löschen?',
      text: `„${t.name}“ wird gelöscht. Einträge, die sie nutzen, rechnen danach mit „Nur Meilen“.${t.groupId === null ? ' Kopien in Vereinen bleiben.' : ''}`,
      confirmLabel: 'Löschen',
    });
    if (!ok) return;
    await this.run(async () => {
      await scoringApi.remove(t.id);
      this.ui.toast('Vorlage gelöscht');
      this.page.lists = {};
      await this.reload();
    });
  }
}
