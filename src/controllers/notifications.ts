import { notificationApi, type NotificationItem, type NotificationRead } from '../services/api';
import type { Store } from '../services/store';
import { INFORMATIONAL, NOTIFICATION_LIMITS, badgeLabel } from '../domain/notifications';
import type { SxNotifications } from '../components/sx-notifications';
import { errorText } from './session';

export interface NotificationsUi {
  panel: SxNotifications;
  /** Badge-Text an der Glocke (leer = keins) */
  badge: (label: string) => void;
  /** Ziel eines Eintrags öffnen (Pfad der eigenen Origin) */
  navigate: (href: string) => void;
}

/**
 * Benachrichtigungs-Glocke (Konzept 17, F-252/F-253): Zähler beim Start bzw. nach der Anmeldung und beim Zurückkehren
 * in den Tab (frühestens alle 2 min) – kein Polling. Die Liste lädt erst beim Öffnen. Gelesen wird ein Eintrag beim
 * Anklicken, beim Öffnen seines Gegenstands (Törn, Gruppe, Einladung – auch über den Link aus einer Mail) und – nur
 * zur Kenntnis (Reaktionen, Follower) – sobald die Liste ihn gezeigt hat. Gäste und ohne Backend: nichts.
 */
export class NotificationsController {
  private count = 0;
  private last = 0;
  private running: Promise<void> | null = null;
  /** gerade angezeigter Gegenstand (Törn, Gruppe) – seine Einträge gelten als gelesen, auch wenn der Zähler später kommt */
  private viewed: NotificationRead | null = null;

  constructor(
    private store: Store,
    private ui: NotificationsUi,
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh();
    });
  }

  private get active(): boolean {
    const { user, backend } = this.store.get();
    return !!user && backend;
  }

  /** Zähler neu laden; ohne `force` höchstens alle NOTIFICATION_LIMITS.refreshMs. */
  refresh(force = false): Promise<void> {
    if (!this.active) {
      this.set(0);
      this.ui.panel.open = false;
      return Promise.resolve();
    }
    if (this.running) return this.running;
    if (!force && Date.now() - this.last < NOTIFICATION_LIMITS.refreshMs) return Promise.resolve();
    this.last = Date.now();
    this.running = notificationApi
      .unread()
      .then((r) => {
        this.set(r.unread);
        if (r.unread && this.viewed) return this.read(this.viewed);
      })
      .catch(() => undefined) // Badge ist Beiwerk – Fehler zeigen nichts an
      .finally(() => (this.running = null));
    return this.running;
  }

  /** Glocke: Liste auf- bzw. zuklappen. */
  async toggle(): Promise<void> {
    const panel = this.ui.panel;
    if (panel.open) return this.close();
    Object.assign(panel, { open: true, loading: true, error: '' });
    try {
      const { items, unread } = await notificationApi.list();
      panel.items = items;
      this.set(unread);
      // Nur zur Kenntnis: gesehen = gelesen. Die Liste zeigt sie in diesem Moment noch als neu.
      const seen = items.filter((n) => !n.read && INFORMATIONAL.has(n.kind)).map((n) => n.id);
      if (seen.length) await this.read({ ids: seen });
    } catch (e) {
      panel.error = errorText(e);
    } finally {
      panel.loading = false;
    }
  }

  close(): void {
    this.ui.panel.open = false;
  }

  /** Eintrag angeklickt: gelesen markieren, Liste schließen, Ziel öffnen. */
  async open(n: NotificationItem): Promise<void> {
    this.close();
    if (!n.read) await this.read({ ids: [n.id] });
    this.ui.navigate(n.href);
  }

  async readAll(): Promise<void> {
    await this.read({ all: true });
    this.ui.panel.items = this.ui.panel.items.map((n) => ({ ...n, read: true }));
  }

  /**
   * Gegenstand geöffnet (Törn, Gruppe) bzw. Einladungen im Konto angezeigt: zugehörige Einträge gelesen. Nur wenn es
   * überhaupt Ungelesenes gibt – sonst keine Anfrage. Kommt der Zähler erst danach, holt `refresh` das nach.
   */
  seen(what: NotificationRead): void {
    if (this.active && this.count > 0) void this.read(what);
  }

  /** Angezeigter Gegenstand (null = keiner): wie `seen`, und auch nach jedem späteren Neuladen des Zählers. */
  viewing(what: NotificationRead | null): void {
    this.viewed = what;
    if (what) this.seen(what);
  }

  private async read(what: NotificationRead): Promise<void> {
    try {
      this.set((await notificationApi.read(what)).unread);
    } catch {
      // Lesestatus ist Beiwerk – beim nächsten Öffnen erneut
    }
  }

  private set(n: number) {
    this.count = n;
    this.ui.badge(badgeLabel(n));
  }
}
