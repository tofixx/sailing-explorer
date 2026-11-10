import { ApiError, communityApi, groupApi, type AdminAction, type CommentThread, type SettingsPatch, type ShareMeta } from '../services/api';
import type { Store } from '../services/store';
import type { AdminKind } from '../domain/admin';
import type { CommentsMode, ReportReason } from '../domain/comment-text';
import { CHANNEL_LABEL, CHOOSABLE_LABEL, NOTIFY_LEVEL_LABEL, type Channel, type ChoosableKind, type NotifyLevel } from '../domain/notifications';
import type { SxAccountDialog } from '../components/sx-account-dialog';
import type { SxComments } from '../components/sx-comments';
import type { ReportTarget, SxReportDialog } from '../components/sx-report-dialog';
import { errorText } from './session';

export interface CommunityUi {
  comments: SxComments;
  /** Panel „Kommentare“ in der Törn-Ansicht */
  commentsPanel: HTMLElement;
  report: SxReportDialog;
  account: SxAccountDialog;
  toast: (msg: string, ms?: number) => void;
  /** Anmeldedialog mit Begründung öffnen (SessionController) */
  openLogin: (reason: string) => void;
}

/**
 * Kommentare, Melden, Einstellungen und Admin-Liste (Konzept 4, Phase D). Kennt Store und Komponenten, aber weder
 * Karte noch Track-Darstellung; Komponenten melden nur Absichten (Events).
 */
export class CommunityController {
  /** Törn, dessen Kommentare gerade gezeigt werden (Schlüssel bei „Nur mit Link“) */
  private current: { share: ShareMeta; key?: string } | null = null;
  /** Schlüssel der gerade geöffneten Profil-/Bootsseite (für Meldungen zu „Nur mit Link“-Seiten) */
  private pageKey: string | undefined;
  /** Meldung, die nach der Anmeldung weitergeht */
  private pendingReport: ReportTarget | null = null;
  private contact: string | null | undefined;

  constructor(
    private store: Store,
    private ui: CommunityUi,
  ) {
    // Nach der Anmeldung (auch aus einem anderen Tab) geht eine begonnene Meldung weiter.
    this.store.subscribe((s, prev) => {
      if (s.user && !prev?.user && this.pendingReport) {
        const t = this.pendingReport;
        this.pendingReport = null;
        void this.openReport(t);
      }
    });
  }

  // ---------------------------------------------------------------- Kommentare

  /**
   * Kommentare des geöffneten Törns laden (Panel der Törn-Ansicht); ohne Backend oder ohne Zugriff bleibt das Panel
   * weg. Beitragskarten haben je eine eigene `sx-comments` (Konzept 40) – sie laden über `loadThread`.
   */
  async loadComments(share: ShareMeta, key?: string): Promise<void> {
    const same = this.current?.share.id === share.id;
    this.current = { share, key };
    const el = this.ui.comments;
    const thread: CommentThread = { kind: 'share', id: share.id, key };
    Object.assign(el, { thread, error: '', busy: false, ...(same ? {} : { data: null, draft: '' }) });
    const ok = await this.loadThread(el);
    // nur das Laden des aktuellen Verlaufs entscheidet über das Panel – ein überholtes ändert nichts
    if (el.thread === thread) this.ui.commentsPanel.hidden = !ok;
  }

  hideComments(): void {
    this.current = null;
    this.ui.commentsPanel.hidden = true;
    Object.assign(this.ui.comments, { data: null, draft: '', error: '' });
  }

  /** Kommentare einer Instanz (Törn-Panel oder Beitragskarte) für ihren Verlauf laden; false ohne Zugriff. */
  async loadThread(el: SxComments): Promise<boolean> {
    const t = el.thread;
    if (!t) return false;
    try {
      const data = await communityApi.comments(t);
      if (el.thread !== t) return false; // inzwischen ein anderer Verlauf – dessen eigenes Laden entscheidet
      el.data = data;
      return true;
    } catch (e) {
      el.error = errorText(e);
      return false;
    }
  }

  private async act(el: SxComments, fn: (t: CommentThread) => Promise<void>, done?: string) {
    const t = el.thread;
    if (!t || el.busy) return;
    Object.assign(el, { busy: true, error: '' });
    try {
      await fn(t);
      if (done) this.ui.toast(done);
      await this.loadThread(el);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        this.ui.openLogin('Deine Anmeldung ist abgelaufen – bitte erneut anmelden.');
      }
      el.error = errorText(e);
    } finally {
      el.busy = false;
    }
  }

  postComment(body: string, el: SxComments = this.ui.comments) {
    return this.act(el, async (t) => {
      await communityApi.postComment(t, body);
      // abgesendet: Text leeren und Formular zuklappen (F-514); bei einem Fehler bleibt beides
      Object.assign(el, { draft: '', writing: false });
    });
  }

  deleteComment(id: string, el: SxComments = this.ui.comments) {
    return this.act(el, () => communityApi.deleteComment(id), 'Kommentar gelöscht');
  }

  /** Glocke des Verlaufs an bzw. stumm (F-639). */
  subscribe(on: boolean, el: SxComments) {
    return this.act(el, async (t) => {
      await communityApi.subscribe(t, on);
      this.ui.toast(on ? 'Du wirst über neue Kommentare benachrichtigt' : 'Benachrichtigungen zu diesen Kommentaren stumm');
    });
  }

  /** Eigentümer:in: Kommentare an / keine neuen / ausblenden – Törn (Zahnrad-Menü) bzw. Beitrag (Kopf der Kommentare). */
  setMode(mode: CommentsMode, el: SxComments = this.ui.comments) {
    return this.act(el, async (t) => {
      if (t.kind === 'post') {
        await communityApi.setPostCommentsMode(t.id, mode);
        return;
      }
      const cur = this.current;
      if (!cur) return;
      const { share } = await communityApi.setCommentsMode(t.id, mode);
      cur.share = { ...cur.share, commentsMode: share.commentsMode };
      const m = this.store.get().mode;
      if (m.kind === 'share' && m.share.id === share.id) this.store.set({ mode: { ...m, share: { ...m.share, commentsMode: share.commentsMode } } });
    });
  }

  login(): void {
    this.ui.openLogin('Zum Kommentieren meldest du dich einmal mit deiner E-Mail-Adresse an.');
  }

  // ---------------------------------------------------------------- Melden

  setPageKey(key: string | undefined): void {
    this.pageKey = key;
  }

  async openReport(target: ReportTarget): Promise<void> {
    const signedIn = !!this.store.get().user;
    Object.assign(this.ui.report, { open: true, target, signedIn, busy: false, error: '', done: false });
    if (!signedIn && this.contact === undefined) {
      try {
        this.contact = (await communityApi.reportInfo()).contact;
      } catch {
        this.contact = null;
      }
    }
    this.ui.report.contact = this.contact ?? '';
  }

  closeReport(): void {
    this.ui.report.open = false;
  }

  /** Erst anmelden – danach öffnet sich die Meldung wieder. */
  reportLogin(): void {
    this.pendingReport = this.ui.report.target;
    this.ui.report.open = false;
    this.ui.openLogin('Zum Melden meldest du dich einmal mit deiner E-Mail-Adresse an. Danach geht es direkt weiter.');
  }

  async submitReport(d: { reason: ReportReason; note: string }): Promise<void> {
    const t = this.ui.report.target;
    if (!t) return;
    // Schlüssel: Törn, Kommentare und Fotos aus der Törn-Ansicht, Profil/Boot von der geöffneten Seite.
    // Kommentare an Beiträgen bringen den Schlüssel ihres Verlaufs mit (Konzept 40)
    const key = t.key !== undefined ? t.key : t.kind === 'share' || t.kind === 'comment' || t.kind === 'photo' ? this.current?.key : this.pageKey;
    Object.assign(this.ui.report, { busy: true, error: '' });
    try {
      await communityApi.report({ kind: t.kind, id: t.id, reason: d.reason, note: d.note }, key);
      this.ui.report.done = true;
      // „Ich bin abgebildet“ blendet sofort aus – Liste neu laden.
      if (this.current && (t.kind === 'comment' || t.kind === 'share')) void this.loadComments(this.current.share, this.current.key);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        return this.reportLogin();
      }
      this.ui.report.error = errorText(e);
    } finally {
      this.ui.report.busy = false;
    }
  }

  // ---------------------------------------------------------------- Konto: Einstellungen und Meldungen (Admins)

  /** Beim Öffnen des Kontos: Einstellungen laden (zeigt auch, ob der Reiter „Meldungen“ erscheint). */
  async loadSettings(): Promise<void> {
    if (!this.store.get().user) return;
    try {
      this.ui.account.settings = await communityApi.settings();
      if (this.ui.account.tab === 'reports') await this.loadReports();
      this.ui.account.notifyChannels = await groupApi.channels();
    } catch {
      /* abgemeldet oder offline – der Dialog zeigt den Rest trotzdem */
    }
  }

  private async accountAct(fn: () => Promise<void>, done?: string) {
    Object.assign(this.ui.account, { busy: true, error: '' });
    try {
      await fn();
      if (done) this.ui.toast(done);
    } catch (e) {
      this.ui.account.error = errorText(e);
    } finally {
      this.ui.account.busy = false;
    }
  }

  /** Voreinstellung der Stufe für Verläufe ohne eigene Wahl (F-449). */
  saveDefaultLevel(level: NotifyLevel) {
    return this.accountAct(async () => {
      const r = await groupApi.defaultLevel(level);
      this.ui.account.notifyChannels = this.ui.account.notifyChannels ? { ...this.ui.account.notifyChannels, defaultLevel: r.defaultLevel } : await groupApi.channels();
    }, `Voreinstellung: ${NOTIFY_LEVEL_LABEL[level]}`);
  }

  saveSettings(s: SettingsPatch) {
    const notify = s.notify && Object.entries(s.notify)[0];
    const done = notify
      ? `${CHOOSABLE_LABEL[notify[0] as ChoosableKind]}: ${CHANNEL_LABEL[notify[1] as Channel]}${notify[1] === 'mail' && notify[0] !== 'invite' ? ' (Sammelmail einmal am Tag)' : ''}.`
      : s.notifyGroups !== undefined
        ? s.notifyGroups === 'weekly'
          ? 'Du bekommst ab Sonntag eine wöchentliche Sammelmail aus deinen Vereinen und Teams.'
          : 'Keine Sammelmail mehr aus Vereinen und Teams.'
        : s.notifyComments === 'daily'
          ? 'Du bekommst ab jetzt eine tägliche Sammelmail bei neuen Kommentaren.'
          : 'Keine Mails mehr über neue Kommentare.';
    return this.accountAct(async () => {
      this.ui.account.settings = await communityApi.saveSettings(s);
    }, done);
  }

  async loadReports(): Promise<void> {
    if (!this.ui.account.settings?.isAdmin) return;
    this.ui.account.reports = null;
    try {
      const { reports, total } = await communityApi.adminReports();
      this.ui.account.reports = reports;
      this.setOpenReports(total);
    } catch (e) {
      this.ui.account.reports = [];
      this.ui.account.error = errorText(e);
    }
  }

  /** Zähler am Konto-Knopf (F-571) nach dem Laden der Liste nachführen – die Liste ist der aktuellere Stand. */
  private setOpenReports(n: number) {
    const u = this.store.get().user;
    if (u?.admin && u.openReports !== n) this.store.set({ user: { ...u, openReports: n } });
  }

  decide(id: string, action: AdminAction) {
    const done = action === 'keep' ? 'Behalten – wieder sichtbar' : action === 'hide' ? 'Ausgeblendet' : action === 'cover' ? 'Titelbild entfernt' : 'Gelöscht';
    return this.accountAct(async () => {
      const { notified, withheld } = await communityApi.decideReport(id, action);
      await this.loadReports();
      // Begründung an Betroffene (F-572) – sagen, ob sie rausging oder an einer Grenze hängen blieb (F-573)
      this.ui.toast(`${done}${notified ? ' – Begründung per Mail an Betroffene' : withheld === 'limit' ? ' – Begründung nicht gesendet (Tageslimit)' : ''}`);
    });
  }

  /**
   * „Sperren“ aus der Meldungsansicht (F-574): dieselbe Sperre wie im Admin-Bereich (Konzept 18.2, Begründung per Mail
   * F-296). Die Admin-API wird erst hier nachgeladen, damit sie nicht im Haupt-Bundle landet.
   */
  lockFromReport(kind: AdminKind, id: string, reason: string) {
    return this.accountAct(async () => {
      const { adminApi } = await import('../services/admin-api');
      const r = await adminApi.lock(kind, id, reason);
      await this.loadReports();
      this.ui.toast(r.action === 'extend' ? 'Sperre verlängert' : 'Gesperrt – der Beleg bleibt erhalten');
    });
  }

  suspend(userId: string, suspended: boolean) {
    return this.accountAct(async () => {
      await communityApi.suspendUser(userId, suspended);
      await this.loadReports();
    }, suspended ? 'Konto gesperrt' : 'Konto entsperrt');
  }
}
