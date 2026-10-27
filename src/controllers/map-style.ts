import { isMapStyleId, resolveMapStyle, type MapStyleId } from '../domain/map-style';
import { communityApi } from '../services/api';
import type { Store } from '../services/store';
import type { MapStyleScope, SxMapStyle } from '../components/sx-map-style';
import { errorText } from './session';

/** Schlüssel im sessionStorage („Nur jetzt“, bis der Tab geschlossen wird) und im localStorage (Gast, dieses Gerät) */
const KEY = 'sx-map-style';

export interface MapStyleUi {
  picker: SxMapStyle;
  toast: (msg: string, ms?: number) => void;
}

function read(storage: () => Storage): string | null {
  try {
    return storage().getItem(KEY);
  } catch {
    return null; // privater Modus oder Speicher gesperrt
  }
}

/** false: Speicher fehlt (privater Modus) – dann gilt die Wahl nur bis zum Neuladen */
function write(storage: () => Storage, id: MapStyleId | null): boolean {
  try {
    if (id) storage().setItem(KEY, id);
    else storage().removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

const session = () => sessionStorage;
const device = () => localStorage;

/**
 * Kartenstil (Farbverlauf und Wind-/Wellen-Symbole): Vorrang hat die Wahl „Nur jetzt“ dieses Tabs, dann der
 * Profil-Standard (gilt auf allen Geräten), dann die Wahl auf diesem Gerät ohne Anmeldung, sonst „Klassisch“.
 * Schreibt den geltenden Stil in den Store (`mapStyle`); die Karte liest ihn von dort.
 */
export class MapStyleController {
  private profile: MapStyleId | null = null;
  /** Wahl „Nur jetzt“ bzw. des Gasts, falls der Speicher fehlt (privater Modus) */
  private now: MapStyleId | null = null;
  private seq = 0;

  constructor(
    private store: Store,
    private ui: MapStyleUi,
  ) {
    this.store.subscribe((s, prev) => {
      if (s.user?.id !== prev.user?.id) void this.loadProfile();
      if (s.user !== prev.user) this.ui.picker.signedIn = !!s.user;
      // Popover offen, aber die Törn-Ansicht wechselt (Startseite, andere Tracks): Vorschau verwerfen.
      if (this.ui.picker.open && (s.home !== prev.home || s.tracks !== prev.tracks)) {
        this.ui.picker.open = false;
        this.apply();
      }
    });
    this.apply();
  }

  /** Geltenden Stil aus den drei Quellen bestimmen und im Store setzen – nicht, solange eine Vorschau läuft. */
  private apply(): void {
    const sessionChoice = read(session) ?? this.now;
    const id = resolveMapStyle(sessionChoice, this.store.get().user ? this.profile : null, read(device));
    this.ui.picker.current = id;
    this.ui.picker.profileStyle = this.profile;
    if (!this.ui.picker.open && this.store.get().mapStyle !== id) this.store.set({ mapStyle: id });
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

  /** Vorschau im offenen Popover: die Karte zeigt die Auswahl, ohne sie zu speichern. */
  preview(id: MapStyleId): void {
    if (isMapStyleId(id)) this.store.set({ mapStyle: id });
  }

  cancel(): void {
    this.ui.picker.open = false;
    this.apply();
  }

  async choose(id: MapStyleId, scope: MapStyleScope): Promise<void> {
    if (!isMapStyleId(id)) return;
    const picker = this.ui.picker;
    if (scope === 'profile' && this.store.get().user) {
      Object.assign(picker, { busy: true, error: '' });
      try {
        const st = await communityApi.saveSettings({ mapStyle: id });
        this.seq++; // ein noch laufendes Laden darf den neuen Standard nicht überschreiben
        this.profile = isMapStyleId(st.mapStyle) ? st.mapStyle : id;
      } catch (e) {
        picker.error = errorText(e);
        if (!picker.open) this.ui.toast(picker.error);
        return;
      } finally {
        picker.busy = false;
      }
      // Der Profil-Standard gilt jetzt auch in diesem Tab.
      this.now = null;
      write(session, null);
      this.ui.toast('Als Standard in deinem Profil gespeichert – gilt auf allen Geräten.');
    } else if (this.store.get().user) {
      this.now = write(session, id) ? null : id;
    } else {
      // Ohne Anmeldung merkt sich das Gerät die Wahl (es gibt kein Profil dafür). Nicht im Tab: Nach einer Anmeldung
      // soll hier der Profil-Standard gelten.
      this.now = write(device, id) ? null : id;
    }
    picker.open = false;
    this.apply();
  }
}
