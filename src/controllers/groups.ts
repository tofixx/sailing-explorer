import { ApiError, api, groupApi, type DiscoverGroup, type FollowKind, type GroupInput, type StreamPage } from '../services/api';
import type { Store } from '../services/store';
import type { SxGroupPage } from '../components/sx-group-page';
import type { SxHomeFeed } from '../components/sx-home-feed';
import type { SxProfilePage } from '../components/sx-profile-page';
import { errorText } from './session';

export interface GroupsUi {
  page: SxGroupPage;
  home: SxHomeFeed;
  profile: SxProfilePage;
  toast: (msg: string, ms?: number) => void;
  openLogin: (reason: string) => void;
}

/**
 * Vereine, Teams, Folgen und Neuigkeiten (Konzept 11): lädt Gruppenseite, Startseiten-Stream und Vorschläge und
 * übersetzt Absichten der Komponenten in API-Aufrufe. Kennt weder Karte noch Tracks.
 */
export class GroupsController {
  /** geöffnete Gruppe (Slug und Schlüssel aus der Adresse) */
  private current: { slug: string; key?: string } | null = null;
  private homeLoaded = false;

  constructor(
    private store: Store,
    private ui: GroupsUi,
  ) {}

  private signedIn = () => !!this.store.get().user;

  // ---------------------------------------------------------------- Gruppenseite

  async openGroup(slug: string, key?: string): Promise<void> {
    this.current = { slug, key };
    const page = this.ui.page;
    page.hidden = false;
    Object.assign(page, { mode: 'view', loading: true, error: '', data: null, stream: null, signedIn: this.signedIn(), inviteLink: null });
    try {
      await this.reload();
    } catch (e) {
      page.error = e instanceof ApiError && e.status === 404 ? 'Diese Gruppe gibt es nicht oder sie ist geschlossen.' : errorText(e);
    } finally {
      page.loading = false;
    }
  }

  /** Lädt Seite und Neuigkeiten der aktuellen Gruppe neu (nach jeder Änderung). */
  private async reload(): Promise<void> {
    if (!this.current) return;
    const page = this.ui.page;
    const data = await groupApi.bySlug(this.current.slug, this.current.key);
    page.data = data;
    page.signedIn = this.signedIn();
    document.title = `${data.group.name} · Sail Explorer`;
    const [stream, boats] = await Promise.all([
      groupApi.stream(data.group.id, null, this.current.key).catch(() => ({ items: [], cursor: null }) as StreamPage),
      data.group.role ? api.myBoats().then((r) => r.boats).catch(() => []) : Promise.resolve([]),
    ]);
    Object.assign(page, { stream, myBoats: boats });
  }

  async openCreate(): Promise<void> {
    this.current = null;
    const page = this.ui.page;
    page.hidden = false;
    document.title = 'Verein gründen · Sail Explorer';
    Object.assign(page, { mode: 'create', loading: false, error: '', signedIn: this.signedIn() });
    if (!this.signedIn()) return;
    const [mine, support] = await Promise.all([groupApi.mine().catch(() => null), api.support().catch(() => null)]);
    page.clubs = (mine?.groups ?? []).filter((g) => g.kind === 'club' && (g.role === 'owner' || g.role === 'admin'));
    page.supporter = !!support?.supporter;
  }

  /** Nach der Anmeldung (auch aus einem anderen Tab) Seite mit Rolle neu laden. */
  async userChanged(): Promise<void> {
    if (this.current && !this.ui.page.hidden) await this.reload().catch(() => undefined);
    else if (this.ui.page.mode === 'create' && !this.ui.page.hidden) await this.openCreate();
  }

  private async act(fn: () => Promise<unknown>, done?: string, reload = true): Promise<boolean> {
    const page = this.ui.page;
    Object.assign(page, { busy: true, formError: '' });
    try {
      await fn();
      if (done) this.ui.toast(done);
      if (reload) await this.reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.ui.openLogin('Bitte zuerst anmelden.');
      else if (page.mode === 'create' || page.editing) page.formError = errorText(e);
      else this.ui.toast(errorText(e), 6000);
      return false;
    } finally {
      page.busy = false;
    }
  }

  create(input: GroupInput) {
    return this.act(async () => {
      const { group } = await groupApi.create(input);
      location.assign(`/g/${group.slug}`);
    }, undefined, false);
  }

  save(id: string, patch: GroupInput) {
    return this.act(async () => {
      const { group } = await groupApi.update(id, patch);
      this.ui.page.editing = false;
      if (this.current && group.slug !== this.current.slug) {
        // neue Adresse (ohne Weiterleitung) – Schlüssel nur, wenn die Gruppe ihn braucht
        this.current = { slug: group.slug, key: group.visibility === 'unlisted' ? (group.shareKey ?? undefined) : undefined };
        history.replaceState(null, '', `/g/${group.slug}`);
      }
    }, patch.rotateKey ? 'Neuer Link erzeugt – alte Links funktionieren nicht mehr.' : 'Gespeichert');
  }

  remove(id: string) {
    return this.act(async () => {
      await groupApi.remove(id);
      location.assign('/');
    }, undefined, false);
  }

  join(id: string) {
    if (!this.signedIn()) return this.ui.openLogin('Zum Beitreten bitte anmelden.');
    return this.act(() => groupApi.request(id, '', this.current?.key), 'Anfrage gestellt – ein Admin entscheidet.');
  }

  withdraw(id: string) {
    return this.act(() => groupApi.withdraw(id), 'Anfrage zurückgezogen');
  }

  leave(id: string) {
    return this.act(() => groupApi.removeMember(id, 'me'), 'Du bist ausgetreten.');
  }

  decide(d: { id: string; userId: string; approve: boolean }) {
    return this.act(() => groupApi.decide(d.id, d.userId, d.approve), d.approve ? 'Aufgenommen' : 'Abgelehnt');
  }

  setRole(d: { id: string; userId: string; role: 'admin' | 'member' }) {
    return this.act(() => groupApi.setRole(d.id, d.userId, d.role), d.role === 'admin' ? 'Zum Admin ernannt' : 'Admin abgesetzt');
  }

  removeMember(d: { id: string; userId: string }) {
    return this.act(() => groupApi.removeMember(d.id, d.userId), 'Entfernt');
  }

  invite(d: { id: string; email: string | null }) {
    return this.act(async () => {
      const res = await groupApi.invite(d.id, d.email);
      // Der Einladungslink steht nur in dieser Antwort – einmal zeigen.
      this.ui.page.inviteLink = res.link ?? res.devLink ?? null;
    }, d.email ? 'Einladung verschickt' : 'Einladungslink erzeugt');
  }

  revokeInvite(id: string) {
    return this.act(() => api.revokeInvite(id), 'Einladung zurückgezogen');
  }

  addBoat(d: { id: string; boatId: string }) {
    return this.act(() => groupApi.addBoat(d.id, d.boatId), 'Boot zugeordnet');
  }

  removeBoat(d: { id: string; boatId: string }) {
    return this.act(() => groupApi.removeBoat(d.id, d.boatId), 'Boot entfernt');
  }

  async createPost(d: { groupId: string; body: string; link: string }) {
    if (await this.act(() => groupApi.post(d.groupId, d.body, d.link), 'Veröffentlicht')) this.ui.page.clearComposer?.();
  }

  async deletePost(id: string) {
    if (!confirm('Diesen Beitrag löschen?')) return;
    try {
      await groupApi.deletePost(id);
      this.ui.toast('Beitrag gelöscht');
      if (!this.ui.page.hidden && this.current) await this.reload();
      else await this.loadHome(true);
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    }
  }

  // ---------------------------------------------------------------- Neuigkeiten: mehr laden

  async more(scope: 'home' | 'group'): Promise<void> {
    if (scope === 'group') {
      const page = this.ui.page;
      const id = page.data?.group.id;
      if (!id || !page.stream?.cursor) return;
      page.streamLoading = true;
      try {
        const next = await groupApi.stream(id, page.stream.cursor, this.current?.key);
        page.stream = { ...next, items: [...page.stream.items, ...next.items] };
      } catch (e) {
        this.ui.toast(errorText(e));
      } finally {
        page.streamLoading = false;
      }
      return;
    }
    const home = this.ui.home;
    if (!home.stream?.cursor) return;
    home.loading = true;
    try {
      const next = await groupApi.myStream(home.stream.cursor);
      home.stream = { ...next, items: [...home.stream.items, ...next.items] };
    } catch (e) {
      this.ui.toast(errorText(e));
    } finally {
      home.loading = false;
    }
  }

  // ---------------------------------------------------------------- Startseite

  /** Neuigkeiten, eigene Gruppen und Vorschläge für Angemeldete; sonst bleibt die Leiste unsichtbar. */
  async loadHome(force = false): Promise<void> {
    const home = this.ui.home;
    if (!this.signedIn() || !this.store.get().backend) {
      home.hidden = true;
      this.homeLoaded = false;
      return;
    }
    if (this.homeLoaded && !force) return;
    this.homeLoaded = true;
    home.loading = true;
    try {
      const [stream, mine, sugg] = await Promise.all([groupApi.myStream(), groupApi.mine(), groupApi.suggestions().catch(() => ({ people: [] }))]);
      Object.assign(home, { stream, groups: mine.groups, suggestions: sugg.people });
      home.hidden = false;
    } catch {
      home.hidden = true;
      this.homeLoaded = false;
    } finally {
      home.loading = false;
    }
  }

  /** Öffentliche Vereine aus /api/discover für „Tritt deinem Verein bei“. */
  setPublicGroups(groups: DiscoverGroup[] | undefined): void {
    this.ui.home.publicGroups = (groups ?? []).filter((g) => g.kind === 'club');
  }

  // ---------------------------------------------------------------- Folgen

  async follow(d: { kind: FollowKind; id: string; follow: boolean }): Promise<void> {
    if (!this.signedIn()) return this.ui.openLogin('Zum Folgen bitte anmelden.');
    const home = this.ui.home;
    if (d.kind === 'user') home.followBusy = [...(home.followBusy ?? []), d.id];
    try {
      const stats = await groupApi.follow(d.kind, d.id, d.follow);
      // Seite aktualisieren, die den Knopf zeigt
      const g = this.ui.page.data;
      if (d.kind === 'group' && g && g.group.id === d.id) this.ui.page.data = { ...g, social: stats };
      const p = this.ui.profile.data;
      if (p?.kind === 'profile' && d.kind === 'user' && p.profile.handle === d.id) this.ui.profile.data = { ...p, social: stats };
      if (p?.kind === 'boat' && d.kind === 'boat' && p.boat.id === d.id) this.ui.profile.data = { ...p, social: stats };
      if (d.kind === 'user' && d.follow) {
        home.suggestions = (home.suggestions ?? []).filter((s) => s.handle !== d.id);
        this.ui.toast('Du folgst jetzt – neue Törns erscheinen in deinen Neuigkeiten.');
      }
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    } finally {
      home.followBusy = (home.followBusy ?? []).filter((h) => h !== d.id);
    }
  }
}
