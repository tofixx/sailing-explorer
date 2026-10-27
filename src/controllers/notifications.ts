import { notificationApi, type NotificationItem, type NotificationRead } from '../services/api';
import type { Store } from '../services/store';
import { INFORMATIONAL, NOTIFICATION_LIMITS, badgeLabel } from '../domain/notifications';
import type { SxNotifications } from '../components/sx-notifications';
import { errorText } from './session';

export interface NotificationsUi {
  panel: SxNotifications;
  /** Liste auf/zu – Glocke bekommt aria-expanded; `focus`: Fokus zurück auf die Glocke (Esc, ×) */
  expanded: (open: boolean, focus?: boolean) => void;
  /** Badge-Text an der Glocke (leer = keins) */
  badge: (label: string) => void;
  /** Ziel eines Eintrags öffnen (Pfad der eigenen Origin) */
  navigate: (href: string) => void;
}

/**
 * Benachrichtigungs-Glocke (Konzept 17, F-252/F-253/F-258): Zähler beim Start bzw. nach der Anmeldung und beim
 * Zurückkehren in den Tab (frühestens alle 2 min) – kein Polling. Neues kommt live über einen WebSocket: der Server
 * meldet nur „geändert“, dann lädt der Zähler (und eine offene Liste) neu. Bricht die Verbindung ab, wird mit wachsendem
 * Abstand neu verbunden; im Hintergrund-Tab ist sie zu. Die Liste lädt erst beim Öffnen. Gelesen wird ein Eintrag beim
 * Anklicken, beim Öffnen seines Gegenstands (Törn, Gruppe, Einladung – auch über den Link aus einer Mail) und – nur
 * zur Kenntnis (Reaktionen, Follower) – sobald die Liste ihn gezeigt hat. Gäste und ohne Backend: nichts.
 */
export class NotificationsController {
  private count = 0;
  private last = 0;
  private running: Promise<void> | null = null;
  /** gerade angezeigter Gegenstand (Törn, Gruppe) – seine Einträge gelten als gelesen, auch wenn der Zähler später kommt */
  private viewed: NotificationRead | null = null;
  /** zählt jedes Öffnen und Schließen hoch – eine Antwort für eine überholte Liste wird verworfen */
  private gen = 0;
  /** während eines Neuladens kam „geändert“ – danach noch einmal laden */
  private again = false;
  private socket: WebSocket | null = null;
  private retryMs: number = NOTIFICATION_LIMITS.retryMs;
  private retryTimer = 0;
  private pingTimer = 0;

  constructor(
    private store: Store,
    private ui: NotificationsUi,
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh();
      else this.disconnect(); // Hintergrund-Tab: keine offene Verbindung
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
      this.disconnect();
      return Promise.resolve();
    }
    if (this.running) {
      if (force) this.again = true;
      return this.running;
    }
    if (!force && Date.now() - this.last < NOTIFICATION_LIMITS.refreshMs) return Promise.resolve();
    this.last = Date.now();
    this.running = notificationApi
      .unread()
      .then((r) => {
        this.set(r.unread);
        this.connect();
        // Nachholen, wenn der Zähler erst nach dem Öffnen des Gegenstands kam – einmal je Gegenstand.
        const pending = this.viewed;
        this.viewed = null;
        if (r.unread && pending) return this.read(pending);
      })
      .catch(() => undefined) // Badge ist Beiwerk – Fehler zeigen nichts an
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          void this.refresh(true);
        }
      });
    return this.running;
  }

  // ---------------------------------------------------------------- Live (WebSocket)

  /** Verbindung öffnen, wenn angemeldet, sichtbar und noch keine besteht. */
  private connect(): void {
    if (this.socket || this.retryTimer || !this.active || document.visibilityState !== 'visible' || typeof WebSocket === 'undefined') return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/notifications/live`);
    } catch {
      return;
    }
    this.socket = ws;
    ws.addEventListener('open', () => {
      this.retryMs = NOTIFICATION_LIMITS.retryMs;
      // hält die Verbindung über Proxys hinweg offen; das Durable Object antwortet ohne aufzuwachen
      this.pingTimer = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 60_000);
    });
    ws.addEventListener('message', (e) => {
      if (e.data !== 'changed') return;
      void this.refresh(true);
      if (this.ui.panel.open) void this.loadList(this.gen);
    });
    ws.addEventListener('close', () => {
      if (this.socket !== ws) return;
      this.socket = null;
      clearInterval(this.pingTimer);
      if (!this.active || document.visibilityState !== 'visible') return;
      // neu verbinden mit wachsendem Abstand; verpasste Änderungen holt das Neuladen danach
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = 0;
        void this.refresh(true);
      }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, NOTIFICATION_LIMITS.maxRetryMs);
    });
  }

  private disconnect(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    clearInterval(this.pingTimer);
    const ws = this.socket;
    this.socket = null;
    ws?.close(1000);
  }

  /** Glocke: Liste auf- bzw. zuklappen. */
  async toggle(): Promise<void> {
    const panel = this.ui.panel;
    if (panel.open) return this.close();
    const gen = ++this.gen;
    Object.assign(panel, { open: true, loading: true, error: '' });
    this.ui.expanded(true);
    await this.loadList(gen);
  }

  /** Liste laden (beim Öffnen und live bei offener Liste). */
  private async loadList(gen: number): Promise<void> {
    const panel = this.ui.panel;
    try {
      const { items, unread } = await notificationApi.list();
      if (gen !== this.gen) return; // inzwischen geschlossen – nichts als gesehen werten
      panel.items = items;
      this.set(unread);
      // Nur zur Kenntnis: gesehen = gelesen. Die Liste zeigt sie in diesem Moment noch als neu.
      const seen = items.filter((n) => !n.read && INFORMATIONAL.has(n.kind)).map((n) => n.id);
      if (seen.length) await this.read({ ids: seen });
    } catch (e) {
      if (gen === this.gen) panel.error = errorText(e);
    } finally {
      if (gen === this.gen) panel.loading = false;
    }
  }

  close(focus = false): void {
    if (!this.ui.panel.open) return;
    this.gen++;
    this.ui.panel.open = false;
    this.ui.expanded(false, focus);
  }

  /** Eintrag angeklickt: gelesen markieren; ohne neuen Tab Liste schließen und Ziel öffnen. */
  async open(n: NotificationItem, newTab = false): Promise<void> {
    if (!newTab) this.close();
    if (!n.read) await this.read({ ids: [n.id] });
    if (newTab) this.ui.panel.items = this.ui.panel.items.map((i) => (i.id === n.id ? { ...i, read: true } : i));
    else this.ui.navigate(n.href);
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

  /** Angezeigter Gegenstand (null = keiner): wie `seen`; kennt der Controller den Zähler noch nicht, holt `refresh` es nach. */
  viewing(what: NotificationRead | null): void {
    this.viewed = what && this.count > 0 ? null : what;
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
