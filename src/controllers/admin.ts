// Admin-Bereich (Konzept 18): lädt Übersicht, Protokoll und Details und führt Aktionen aus. Wird mit der Admin-Seite
// erst auf /admin nachgeladen; die Seite meldet nur Absichten (Events), die Server-Routen prüfen jede Aktion.
import '../components/sx-admin-page';
import type { AdminQuery, SxAdminPage } from '../components/sx-admin-page';
import { adminApi, runAdminOp, type AdminOp } from '../services/admin-api';
import type { AdminKind } from '../domain/admin';
import { ApiError } from '../services/api';
import { errorText } from './session';

export class AdminController {
  /** zuletzt angeforderte Übersicht – nach Aktionen neu laden */
  private last: AdminQuery = { tab: 'users', q: '', filter: 'all', page: 1 };

  constructor(private page: SxAdminPage) {
    const on = <T>(name: string, fn: (d: T) => void) => page.addEventListener(name, (e) => fn((e as CustomEvent<T>).detail));
    on<AdminQuery>('sx-admin-query', (q) => void this.query(q));
    on<{ kind: AdminKind; id: string }>('sx-admin-open', (d) => void this.open(d.kind, d.id));
    on<{ op: AdminOp; done: string }>('sx-admin-act', (d) => void this.act(d.op, d.done));
    on<{ id: string; into: string }>('sx-admin-preview', (d) => void this.preview(d.id, d.into));
  }

  /** Erste Liste laden (der Reiter steht in der Seite). */
  start(): void {
    this.page.reload();
  }

  async query(q: AdminQuery): Promise<void> {
    this.last = q;
    const p = this.page;
    Object.assign(p, { loading: true, error: '' });
    try {
      if (q.tab === 'log') {
        const r = await adminApi.log(q.q, q.page);
        Object.assign(p, { log: r.entries, more: r.more });
      } else {
        const r = await adminApi.list(q.tab, { q: q.q, filter: q.filter, page: q.page });
        Object.assign(p, { items: r.items, more: r.more });
      }
    } catch (e) {
      p.error = e instanceof ApiError && e.status === 404 ? 'Diese Seite gibt es nicht.' : errorText(e);
    } finally {
      p.loading = false;
    }
  }

  async open(kind: AdminKind, id: string): Promise<void> {
    try {
      this.page.detail = await adminApi.detail(kind, id);
    } catch (e) {
      this.page.note = errorText(e);
    }
  }

  /** Aktion ausführen, dann Liste und – wenn es das Objekt noch gibt – Details neu laden. */
  async act(op: AdminOp, done: string): Promise<void> {
    const p = this.page;
    Object.assign(p, { busy: true, note: '' });
    try {
      await runAdminOp(op);
      p.form = null;
      await this.query(this.last);
      if (p.items.some((i) => i.id === op.id)) await this.open(op.kind, op.id);
      else p.detail = null;
      p.note = done;
    } catch (e) {
      p.note = errorText(e);
    } finally {
      p.busy = false;
    }
  }

  async preview(id: string, into: string): Promise<void> {
    try {
      this.page.preview = await adminApi.mergePreview(id, into);
    } catch (e) {
      this.page.note = errorText(e);
    }
  }
}
