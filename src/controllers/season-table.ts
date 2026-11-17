// Jahresansicht im Profil (Konzept 43, F-665 … F-669): laden und den Schalter „anderen zeigen“ setzen. Die Seite
// (sx-profile-page) zeigt nur an; Daten liegen in `page.data.seasons`.
import type { SxProfilePage } from '../components/sx-profile-page';
import { seasonTableApi } from '../services/season-table-api';
import type { SeasonTableMode } from '../domain/season-table';
import { errorText } from './session';

interface SeasonTableUi {
  page: SxProfilePage;
  toast: (msg: string) => void;
}

export class SeasonTableController {
  constructor(private ui: SeasonTableUi) {}

  /** Für die eigene Seite immer, für andere nur, wenn freigegeben – sonst kein Abschnitt. Auch nach Vorschau und Neuladen. */
  async load(handle: string, key: string | null = null): Promise<void> {
    const d = this.ui.page.data;
    if (d?.kind !== 'profile' || (!d.profile.isSelf && d.profile.seasonTable !== 'public')) return;
    // Vorschau „Ansehen als …“: so, wie andere die Ansicht sehen (nur öffentliche Fahrten, ohne Schalter)
    const seasons = await seasonTableApi.get(handle, key, !!d.preview).catch(() => null);
    const now = this.ui.page.data;
    if (now?.kind === 'profile' && now.profile.handle === handle) this.ui.page.data = { ...now, seasons };
  }

  async setMode(mode: SeasonTableMode): Promise<void> {
    const d = this.ui.page.data;
    if (d?.kind !== 'profile' || !d.seasons) return;
    this.ui.page.seasonBusy = true;
    try {
      await seasonTableApi.setMode(mode);
      const now = this.ui.page.data;
      if (now?.kind === 'profile' && now.seasons) this.ui.page.data = { ...now, profile: { ...now.profile, seasonTable: mode }, seasons: { ...now.seasons, mode } };
      this.ui.toast(mode === 'public' ? 'Jahresansicht wird auf deinem Profil gezeigt' : 'Jahresansicht nur noch für dich');
    } catch (e) {
      this.ui.toast(errorText(e));
    } finally {
      this.ui.page.seasonBusy = false;
    }
  }
}
