import { groupApi } from '../services/api';
import { readNearPrefs } from '../services/near-prefs';
import type { Store } from '../services/store';
import { UNREAD_MAX, UNREAD_POLL_MS, UNREAD_REFRESH_MS, unreadLabel } from '../domain/unread';

export interface UnreadUi {
  /** Badge-Text an „Community“ (leer = keins) */
  show: (label: string) => void;
  /** Tab wieder sichtbar (z. B. für „gelesen“, das im Hintergrund nicht gesetzt wurde) */
  visible?: () => void;
}

/**
 * Community-Badge (Konzept 12.10, F-221/F-222): zählt neue Einträge im persönlichen Stream – beim Start bzw. nach der
 * Anmeldung, beim Zurückkehren in den Tab (frühestens alle 2 min) und alle 10 min, solange der Tab sichtbar ist.
 * Gäste und Installationen ohne Backend: kein Badge, keine Abfrage.
 */
export class UnreadController {
  private count = 0;
  private last = 0;
  private running: Promise<void> | null = null;
  /** zählt „gelesen“ hoch – eine Zählung, die davor begann, ist dann überholt */
  private gen = 0;
  /** laufendes Gelesen-Setzen – eine Zählung wartet darauf, sonst käme das alte Badge zurück */
  private saving: Promise<unknown> = Promise.resolve();
  /** zuletzt gesendeter Gelesen-Stand – derselbe Stand wird nicht noch einmal geschrieben */
  private lastSeen = 0;

  constructor(
    private store: Store,
    private ui: UnreadUi,
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      this.ui.visible?.();
      void this.refresh();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh(true);
    }, UNREAD_POLL_MS);
  }

  /** Gibt es Ungelesenes? (Dann lädt „Community“ den Stream neu.) */
  get pending(): boolean {
    return this.count > 0;
  }

  /** Neu zählen; ohne `force` höchstens alle UNREAD_REFRESH_MS. */
  refresh(force = false): Promise<void> {
    const { user, backend } = this.store.get();
    if (!user || !backend) return Promise.resolve(this.set(0));
    if (this.running) return this.running;
    if (!force && Date.now() - this.last < UNREAD_REFRESH_MS) return Promise.resolve();
    this.last = Date.now();
    const gen = this.gen;
    this.running = this.saving
      .then(() => groupApi.unread(readNearPrefs().joins))
      .then((r) => {
        if (gen === this.gen) this.set(r.more ? UNREAD_MAX + 1 : r.count);
      })
      .catch(() => undefined) // Badge ist Beiwerk – Fehler zeigen nichts an
      .finally(() => (this.running = null));
    return this.running;
  }

  /** Community wurde mit dem Stream-Stand `at` angezeigt: Badge weg, Zeitpunkt für alle Geräte speichern. */
  seen(at: number | undefined): void {
    this.gen++;
    this.set(0);
    if (at != null && at <= this.lastSeen) return;
    if (at != null) this.lastSeen = at;
    this.saving = groupApi.seen(at).catch(() => undefined);
  }

  private set(n: number) {
    this.count = n;
    this.ui.show(unreadLabel(n));
  }
}
