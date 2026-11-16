// Stammcrew auf der Bootsseite (Konzept 41, F-270 … F-274): laden, einladen, Titel, entfernen, Schalter, Zuordnung
// lösen. Die Seite (sx-profile-page) zeigt nur an; Daten liegen in `page.data.crew`.
import { api, type InviteTo } from '../services/api';
import { boatCrewApi } from '../services/boat-crew-api';
import type { AssignMode } from '../domain/boat-crew';
import type { SxProfilePage } from '../components/sx-profile-page';
import { errorText } from './session';

interface BoatCrewUi {
  page: SxProfilePage;
  toast: (msg: string) => void;
  /** Neuigkeiten und Törns der Bootsseite neu laden (nach dem Lösen einer Zuordnung) */
  reloadBoat: () => void;
}

export class BoatCrewController {
  constructor(private ui: BoatCrewUi) {}

  private boatId(): string | null {
    const d = this.ui.page.data;
    return d?.kind === 'boat' ? d.boat.id : null;
  }

  /** Stammcrew der offenen Bootsseite laden; ohne Antwort bleibt der Abschnitt weg. */
  async load(key: string | null = null): Promise<void> {
    const id = this.boatId();
    if (!id) return;
    const crew = await boatCrewApi.crew(id, key).catch(() => null);
    const now = this.ui.page.data;
    if (now?.kind === 'boat' && now.boat.id === id) this.ui.page.data = { ...now, crew };
  }

  private async act(fn: (boatId: string) => Promise<unknown>, done?: string): Promise<boolean> {
    const id = this.boatId();
    if (!id) return false;
    this.ui.page.crewBusy = true;
    try {
      await fn(id);
      if (done) this.ui.toast(done);
      await this.load();
      return true;
    } catch (e) {
      this.ui.toast(errorText(e));
      return false;
    } finally {
      this.ui.page.crewBusy = false;
    }
  }

  /** Einladen per E-Mail oder Profilname bzw. (to = null) als Einladungslink, der nur jetzt sichtbar ist. */
  invite(to: InviteTo | null, done?: () => void) {
    return this.act(async (id) => {
      const r = await boatCrewApi.invite(id, to);
      if (r.link) this.ui.page.crewLink = r.link;
      done?.();
    }, to ? 'Einladung verschickt' : undefined);
  }

  title(userId: string, title: string) {
    return this.act((id) => boatCrewApi.title(id, userId, title), 'Titel gespeichert');
  }

  remove(userId: string) {
    return this.act((id) => boatCrewApi.remove(id, userId), userId === 'me' ? 'Du bist nicht mehr in der Stammcrew' : 'Aus der Stammcrew entfernt');
  }

  /** Offene Einladung zurückziehen (Verwalter bzw. wer eingeladen hat). */
  revoke(inviteId: string) {
    return this.act(() => api.revokeInvite(inviteId), 'Einladung zurückgezogen');
  }

  rights(patch: Partial<{ post: boolean; invite: boolean; assign: AssignMode }>) {
    return this.act((id) => boatCrewApi.rights(id, patch), 'Gespeichert');
  }

  /** Zuordnung eines fremden Törns lösen (F-274) – danach Törns und Neuigkeiten neu. */
  async unassign(shareId: string) {
    if (await this.act((id) => boatCrewApi.unassign(id, shareId), 'Zuordnung gelöst')) this.ui.reloadBoat();
  }
}
