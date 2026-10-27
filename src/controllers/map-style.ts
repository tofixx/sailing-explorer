import { isMapStyleId, resolveMapStyle, type MapStyleId } from '../domain/map-style';
import { communityApi } from '../services/api';
import type { Store } from '../services/store';
import type { MapStyleScope, SxMapStyle } from '../components/sx-map-style';
import { errorText } from './session';

export interface MapStyleUi {
  picker: SxMapStyle;
  toast: (msg: string, ms?: number) => void;
}

/**
 * Kartenstil (Farbverlauf und Wind-/Wellen-Symbole): Vorrang hat die Wahl im Menü – sie gilt sofort, liegt nur im
 * Speicher und ist nach dem Neuladen weg –, dann der Profil-Standard (gilt auf allen Geräten), sonst „Klassisch“.
 * Schreibt den geltenden Stil in den Store (`mapStyle`); die Karte liest ihn von dort.
 */
export class MapStyleController {
  private profile: MapStyleId | null = null;
  /** Wahl im Menü für die aktuelle Ansicht */
  private now: MapStyleId | null = null;
  private seq = 0;

  constructor(
    private store: Store,
    private ui: MapStyleUi,
  ) {
    this.store.subscribe((s, prev) => {
      if (s.user?.id !== prev.user?.id) void this.loadProfile();
      if (s.user !== prev.user) this.ui.picker.signedIn = !!s.user;
      // Menü offen, aber die Törn-Ansicht wechselt (Startseite, andere Tracks): Menü schließen.
      if (this.ui.picker.open && (s.home !== prev.home || s.tracks !== prev.tracks)) this.ui.picker.open = false;
    });
    this.ui.picker.signedIn = !!this.store.get().user;
    if (this.store.get().user) void this.loadProfile();
    this.apply();
  }

  /** Geltenden Stil bestimmen und im Store setzen. */
  private apply(): void {
    const id = resolveMapStyle(this.now, this.store.get().user ? this.profile : null);
    this.ui.picker.current = id;
    this.ui.picker.profileStyle = this.profile;
    if (this.store.get().mapStyle !== id) this.store.set({ mapStyle: id });
  }

  /** Nach An- oder Abmeldung: Profil-Standard holen bzw. vergessen. */
  private async loadProfile(): Promise<void> {
    const seq = ++this.seq;
    this.profile = null;
    if (this.store.get().user) {
      try {
        const st = await communityApi.settings();
        if (seq !== this.seq) return;
        this.profile = isMapStyleId(st.mapStyle) ? st.mapStyle : null;
      } catch {
        /* offline oder abgemeldet – dann gilt der Rest */
      }
    }
    this.apply();
  }

  /**
   * `now`: sofort, nur diese Ansicht; `profile`: als Standard im Profil (hebt die Wahl für diese Ansicht auf);
   * `reset`: Profil-Standard entfernen – die Ansicht bleibt, beim nächsten Öffnen gilt wieder „Klassisch“.
   */
  async choose(id: MapStyleId, scope: MapStyleScope): Promise<void> {
    if (!isMapStyleId(id)) return;
    const picker = this.ui.picker;
    if (scope === 'now' || !this.store.get().user) {
      this.now = id;
    } else {
      const mapStyle = scope === 'profile' ? id : null;
      const before = this.now;
      Object.assign(picker, { busy: true, error: '' });
      try {
        const st = await communityApi.saveSettings({ mapStyle });
        this.seq++; // ein noch laufendes Laden darf den neuen Standard nicht überschreiben
        this.profile = isMapStyleId(st.mapStyle) ? st.mapStyle : null;
      } catch (e) {
        picker.error = errorText(e);
        if (!picker.open) this.ui.toast(picker.error);
        return;
      } finally {
        picker.busy = false;
      }
      // Hat jemand währenddessen einen anderen Stil gewählt, gilt der weiter.
      if (this.now === before) this.now = mapStyle ? null : id;
      this.ui.toast(mapStyle ? 'Als Standard gespeichert – gilt auf allen Geräten.' : 'Standard entfernt – beim nächsten Öffnen gilt wieder „Klassisch“.');
    }
    picker.open = false;
    this.apply();
  }
}
