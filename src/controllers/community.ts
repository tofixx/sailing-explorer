import { ApiError, communityApi, type AdminAction, type SettingsPatch, type ShareMeta } from '../services/api';
import type { Store } from '../services/store';
import type { CommentsMode, ReportReason } from '../domain/comment-text';
import { CHANNEL_LABEL, CHOOSABLE_LABEL, type Channel, type ChoosableKind } from '../domain/notifications';
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

  /** Kommentare des geöffneten Törns laden; ohne Backend oder ohne Zugriff bleibt das Panel weg. */
  async loadComments(share: ShareMeta, key?: string): Promise<void> {
    const same = this.current?.share.id === share.id;
    this.current = { share, key };
    const el = this.ui.comments;
    Object.assign(el, { shareId: share.id, error: '', busy: false, ...(same ? {} : { data: null, draft: '' }) });
    try {
      const data = await communityApi.comments(share.id, key);
      if (this.current?.share.id !== share.id) return;
      el.data = data;
      this.ui.commentsPanel.hidden = false;
    } catch {
      this.ui.commentsPanel.hidden = true;
    }
  }

  hideComments(): void {
    this.current = null;
    this.ui.commentsPanel.hidden = true;
    Object.assign(this.ui.comments, { data: null, draft: '', error: '' });
  }

  private async act(fn: (cur: { share: ShareMeta; key?: string }) => Promise<void>, done?: string) {
    const cur = this.current;
    if (!cur) return;
    Object.assign(this.ui.comments, { busy: true, error: '' });
    try {
      await fn(cur);
      if (done) this.ui.toast(done);
      await this.loadComments(cur.share, cur.key);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.store.set({ user: null });
        this.ui.openLogin('Deine Anmeldung ist abgelaufen – bitte erneut anmelden.');
      }
      this.ui.comments.error = errorText(e);
    } finally {
      this.ui.comments.busy = false;
    }
  }

  postComment(body: string) {
    return this.act(async (cur) => {
      await communityApi.postComment(cur.share.id, body, cur.key);
      this.ui.comments.draft = '';
    });
  }

  deleteComment(id: string) {
    return this.act(() => communityApi.deleteComment(id), 'Kommentar gelöscht');
  }

  /** Eigentümer: Kommentare an / keine neuen / ausblenden. */
  setMode(mode: CommentsMode) {
    return this.act(async (cur) => {
      const { share } = await communityApi.setCommentsMode(cur.share.id, mode);
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
    const key = t.kind === 'share' || t.kind === 'comment' || t.kind === 'photo' ? this.current?.key : this.pageKey;
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
      this.ui.account.reports = (await communityApi.adminReports()).reports;
    } catch (e) {
      this.ui.account.reports = [];
      this.ui.account.error = errorText(e);
    }
  }

  decide(id: string, action: AdminAction) {
    const done = action === 'keep' ? 'Behalten – wieder sichtbar' : action === 'hide' ? 'Ausgeblendet' : 'Gelöscht';
    return this.accountAct(async () => {
      await communityApi.decideReport(id, action);
      await this.loadReports();
    }, done);
  }

  suspend(userId: string, suspended: boolean) {
    return this.accountAct(async () => {
      await communityApi.suspendUser(userId, suspended);
      await this.loadReports();
    }, suspended ? 'Konto gesperrt' : 'Konto entsperrt');
  }
}
