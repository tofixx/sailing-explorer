// Törn-Arbeitsbereich (Konzept 23): Karte und Seitenleiste zeigen immer genau einen Törn – einen lokalen Entwurf, den
// eigenen gespeicherten Törn oder eine fremde bzw. geteilte Ansicht. Neue GPX beginnen einen neuen Törn (nach
// Nachfrage, wenn ein Entwurf vorliegt); mehrere GPX gibt es nur über „GPX hinzufügen“ am offenen Entwurf. Der Entwurf
// liegt auf einem einzigen Platz im Browser (IndexedDB), gehört einem Konto bzw. dem Gast und wird beim Abmelden, beim
// Kontowechsel und nach dem Speichern geleert. Andere Tabs erfahren Änderungen über einen BroadcastChannel.
import { computeTrackStats } from '../domain/stats';
import { routeTrack } from '../domain/logbook';
import { GpxError, parseGpx } from '../domain/gpx';
import type { Track } from '../domain/types';
import { VISIBILITY_LABEL } from '../domain/visibility';
import { attachConditions, parseWeatherData, type WeatherData } from '../domain/weather';
import { ApiError, api, type ShareMeta } from '../services/api';
import { inflateFromBase64Url } from '../services/compress';
import { fetchTrackFile } from '../services/samples';
import { initialState, visibleTracks, type State, type Store } from '../services/store';
import { parseView } from '../services/url-state';
import { loadWeather, storedWeatherStatus } from '../services/weather-api';
import { workspace } from '../services/workspace';
import type { ConfirmRequest } from '../components/sx-confirm';
import type { ToernLabel } from '../components/sx-topbar';
import { errorText } from './session';
import { sendHeat } from './heat';
import { APP_NAME } from '../domain/brand';

/** Identitätsfarben der Tracks als Token-Namen (aufgelöst in Karte und Liste). */
const TRACK_COLORS = ['--c-track-1', '--c-track-2', '--c-track-3', '--c-track-4', '--c-track-5', '--c-track-6'];

/** Eigentümer eines Gast-Entwurfs (ohne Anmeldung) */
const GUEST = 'guest';

interface RawItem {
  name: string;
  text: string;
}

type Draft = { tracks: Track[]; weather: WeatherData | null };

export interface WorkspaceUi {
  /** Rückfrage (sx-confirm): true = bestätigt */
  ask: (req: ConfirmRequest) => Promise<boolean>;
  /** offene Rückfrage schließen (als „Abbrechen“) */
  dismiss: () => void;
  toast: (msg: string, ms?: number) => void;
  /** Kartenausschnitt auf diese Tracks setzen */
  fit: (tracks: Track[]) => void;
  /** Profil-, Gruppen-, Entdecken-Seite verlassen – zurück zur Karte */
  leavePage: () => void;
  /** statt der Karte ist eine Seite offen */
  onPage: () => boolean;
  /** Startseite zeigen (nach „Törn schließen“) */
  showHome: () => void;
  /** erfüllt, sobald die Anmeldung bekannt ist (Eigentümer des Entwurfs prüfen) */
  ready: () => Promise<void>;
}

/** Kopfzeile (F-433): welcher Törn offen ist und in welchem Zustand. */
export function toernLabel(s: Pick<State, 'mode' | 'tracks'>): ToernLabel | null {
  const m = s.mode;
  if (m.kind === 'share') {
    const vis = VISIBILITY_LABEL[m.share.visibility];
    const icon = m.share.visibility === 'private' ? 'lock' : m.share.visibility === 'public' ? 'globe' : 'link';
    return m.share.isOwner
      ? { title: m.share.title, status: `Gespeichert · ${vis}`, short: vis, tone: 'saved', icon }
      : { title: m.share.title, status: 'Ansicht', short: 'Ansicht', tone: 'view', icon: 'eye' };
  }
  if (m.kind === 'link') return { title: m.title, status: 'Ansicht', short: 'Ansicht', tone: 'view', icon: 'link' };
  if (!s.tracks.length) return null;
  return { title: s.tracks[0].name || 'Neuer Törn', status: 'Entwurf · nur dieses Gerät', short: 'Entwurf', tone: 'draft', icon: 'pencil' };
}

/** „+ Neu → Entwurf fortsetzen“ (F-436): nur, wenn ein Entwurf vorliegt und gerade nicht offen ist. */
export function resumableDraft(s: Pick<State, 'mode' | 'tracks' | 'draft'>): string | null {
  if (!s.draft || (s.mode.kind === 'local' && s.tracks.length)) return null;
  return s.draft.title;
}

/** Darf dieses Konto (bzw. der Gast, `null`) den Entwurf von `owner` sehen? Gast-Entwürfe gehen ans Konto über. */
export function draftVisibleTo(owner: string | undefined, userId: string | null): boolean {
  return !owner || owner === GUEST || owner === userId;
}

const plural = (n: number) => `${n} Track${n > 1 ? 's' : ''}`;

export class WorkspaceController {
  /** Entwurf beim Start gelesen (K3: Ablegen und Startseite warten darauf) */
  private loaded: Promise<Draft | null> | null = null;
  /** Eigentümer des Entwurfs im Browser (Konto-ID bzw. 'guest'), null = keiner */
  private owner: string | null = null;
  /** Nachrichten an andere Tabs desselben Browsers: Entwurf geändert (F-439) */
  private channel = 'BroadcastChannel' in window ? new BroadcastChannel('sx-draft') : null;

  constructor(
    private store: Store,
    private ui: WorkspaceUi,
  ) {
    this.channel?.addEventListener('message', () => void this.otherTab());
  }

  // ---------------------------------------------------------------- Entwurf

  /** Entwurf lesen, sobald die Anmeldung bekannt ist – einmal beim Start, auf jeder Route (K3). */
  init(): Promise<Draft | null> {
    this.loaded ??= this.ui.ready().then(() => this.read());
    return this.loaded;
  }

  /**
   * Entwurfsplatz lesen und `draft` setzen. Ein Entwurf eines anderen Kontos – bzw. eines Kontos, dessen Sitzung ohne
   * Abmelden endete – wird verworfen (F-438); ein Gast-Entwurf gehört ab jetzt dem angemeldeten Konto.
   */
  private async read(): Promise<Draft | null> {
    const ws = await workspace.load();
    const me = this.store.get().user?.id ?? null;
    if (ws?.tracks.length && !draftVisibleTo(ws.owner, me)) {
      await workspace.save([]);
      this.setDraft([], null);
      return null;
    }
    const tracks = ws?.tracks.length ? this.build(ws.tracks.map((t) => ({ name: t.name, text: t.gpx }))) : [];
    ws?.tracks.forEach((w, i) => tracks[i] && (tracks[i].hidden = w.hidden));
    const owner = tracks.length ? (me ?? GUEST) : null;
    if (tracks.length && ws!.owner !== owner) await workspace.save(ws!.tracks, ws!.weather, owner!);
    this.setDraft(tracks, owner);
    return tracks.length ? { tracks, weather: parseWeatherData(ws?.weather) } : null;
  }

  /** Startseite `/`: den Entwurf vom letzten Besuch wieder öffnen (F-30). */
  async restore(): Promise<void> {
    const d = await this.init();
    if (!d || this.store.get().tracks.length) return;
    await this.setTracks(d.tracks, { mode: { kind: 'local' }, fit: true, weather: d.weather });
    this.ui.toast(`Entwurf wiederhergestellt: ${plural(d.tracks.length)}`);
  }

  /** „+ Neu → Entwurf fortsetzen“ (F-436): ersetzt den offenen Törn. */
  async resume(): Promise<void> {
    await this.init();
    const d = await this.read();
    if (!d) return this.ui.toast('Der Entwurf ist nicht mehr da.');
    this.toWorkspace();
    await this.setTracks(d.tracks, { mode: { kind: 'local' }, fit: true, weather: d.weather });
  }

  /** „Entwurf verwerfen“ in der Track-Liste (F-436): nach Rückfrage Entwurf löschen, Startseite zeigen. */
  async discard(): Promise<void> {
    const d = this.store.get().draft;
    if (!d) return;
    const ok = await this.ui.ask({ heading: 'Entwurf verwerfen?', text: `Entwurf „${d.title}“ (${plural(d.count)}) verwerfen? Das lässt sich nicht rückgängig machen.`, confirmLabel: 'Verwerfen' });
    if (!ok) return;
    const open = this.draftOpen();
    this.clearDraft();
    if (open) this.close();
  }

  /**
   * Anmeldung geändert, ohne dass hier abgemeldet wurde (Ablauf, 401, anderes Konto, Anmeldung): ein Gast-Entwurf geht
   * an das Konto über, ein Entwurf eines anderen Kontos verschwindet (F-438).
   */
  async userChanged(): Promise<void> {
    if (!this.loaded) return; // vor dem ersten Lesen – init() prüft selbst
    await this.loaded;
    const me = this.store.get().user?.id ?? null;
    if (!this.owner || this.owner === me) return;
    if (this.owner === GUEST) {
      if (!me) return;
      if (this.draftOpen()) return this.persist();
      await this.read();
      return;
    }
    {
      if (this.draftOpen()) this.reset();
      this.clearDraft();
    }
  }

  /** Ein anderer Tab hat den Entwurf geändert (F-439): neu lesen; ist er hier offen, den neuen Stand zeigen. */
  private async otherTab(): Promise<void> {
    const open = this.draftOpen();
    const d = await this.read();
    if (!open || !this.draftOpen()) return;
    if (!d) {
      this.reset();
      return this.ui.toast('Der Entwurf wurde in einem anderen Tab verworfen.', 6000);
    }
    await this.setTracks(d.tracks, { mode: { kind: 'local' }, fit: false, weather: d.weather }, false);
    this.ui.toast('Der Entwurf wurde in einem anderen Tab geändert – hier ist der neue Stand.', 6000);
  }

  private setDraft(tracks: Array<{ name: string }>, owner: string | null) {
    this.owner = tracks.length ? owner : null;
    this.store.set({ draft: tracks.length ? { title: tracks[0].name || 'Neuer Törn', count: tracks.length } : null });
  }

  /** Entwurfsplatz leeren und andere Tabs informieren. */
  private clearDraft() {
    this.setDraft([], null);
    void workspace.save([]).then(() => this.channel?.postMessage('changed'));
  }

  // ---------------------------------------------------------------- Dateien

  /** „+ Neu → Törn (GPX)“ und die Startkarte: immer ein neuer Törn (F-434). */
  async files(list: FileList | File[]): Promise<void> {
    const items = await this.readFiles(list);
    if (items) await this.start(items);
  }

  /** „GPX hinzufügen“ (F-435): an den offenen Entwurf hängen; ist keiner offen, ein neuer Törn. */
  async add(list: FileList | File[]): Promise<void> {
    const items = await this.readFiles(list);
    if (!items) return;
    if (this.draftOpen()) return this.append(items);
    await this.start(items);
  }

  /** Ziehen & Ablegen (F-435): auf dem sichtbaren Entwurf hinzufügen, sonst (Startseite, Seite, Ansicht) neuer Törn. */
  async drop(list: FileList | File[]): Promise<void> {
    await this.init();
    const visible = this.draftOpen() && !this.store.get().home && !this.ui.onPage();
    return visible ? this.add(list) : this.files(list);
  }

  private draftOpen(): boolean {
    const s = this.store.get();
    return s.mode.kind === 'local' && s.tracks.length > 0;
  }

  private async readFiles(list: FileList | File[]): Promise<RawItem[] | null> {
    const files = [...list].filter((f) => /\.gpx$/i.test(f.name) || /xml/.test(f.type));
    if (!files.length) {
      this.ui.toast('Keine GPX-Dateien gefunden');
      return null;
    }
    this.setLoading('Lese Dateien …');
    try {
      return await Promise.all(files.map(async (f) => ({ name: f.name.replace(/\.gpx$/i, ''), text: await f.text() })));
    } catch (e) {
      this.setLoading(null);
      this.ui.toast(`Datei konnte nicht gelesen werden: ${errorText(e)}`);
      return null;
    }
  }

  /** Neuer Törn: liegt ein Entwurf mit Tracks vor, erst nachfragen (F-434). */
  private async start(items: RawItem[]) {
    await this.init();
    const draft = this.store.get().draft;
    if (draft) {
      this.setLoading(null);
      const ok = await this.ui.ask({ heading: 'Neuen Törn beginnen?', text: `Entwurf „${draft.title}“ verwerfen und neuen Törn beginnen?`, confirmLabel: 'Verwerfen' });
      if (!ok) return;
    }
    await this.begin(items);
  }

  private async begin(items: RawItem[]) {
    const fresh = this.build(items);
    if (!fresh.length) return this.setLoading(null);
    this.toWorkspace();
    await this.setTracks(fresh, { mode: { kind: 'local' }, fit: true });
    this.ui.toast(`${plural(fresh.length)} geladen`);
  }

  private async append(items: RawItem[]) {
    const s = this.store.get();
    const fresh = this.build(items, s.tracks.length);
    if (!fresh.length) return this.setLoading(null);
    this.toWorkspace();
    await this.setTracks([...s.tracks, ...fresh], { mode: { kind: 'local' }, fit: true });
    this.ui.toast(`${plural(fresh.length)} hinzugefügt`);
  }

  /** Arbeitsbereich zeigen: Adresse `/` (aus einer Ansicht oder Seite heraus), Seite schließen. */
  private toWorkspace() {
    if (this.store.get().mode.kind !== 'local' || this.ui.onPage() || location.pathname !== '/') history.pushState(null, '', '/');
    this.ui.leavePage();
    document.title = APP_NAME;
  }

  // ---------------------------------------------------------------- Tracks im offenen Törn

  toggle(id: string): void {
    this.update(this.store.get().tracks.map((t) => (t.id === id ? { ...t, hidden: !t.hidden } : t)));
  }

  /** Track aus dem Entwurf entfernen; der letzte verwirft den Entwurf (F-15). */
  remove(id: string): void {
    if (this.store.get().mode.kind !== 'local') return;
    const tracks = this.store.get().tracks.filter((t) => t.id !== id);
    if (tracks.length) return this.update(tracks);
    this.reset();
    this.persist();
  }

  private update(tracks: Track[]) {
    const removed = tracks.length < this.store.get().tracks.length;
    this.store.set({ tracks, hover: null });
    if (removed) this.ui.fit(visibleTracks(this.store.get()));
    this.persist();
  }

  /** × „Törn schließen“ (F-433): Arbeitsbereich leeren, Startseite zeigen. Ein Entwurf bleibt im Entwurfsplatz. */
  close(): void {
    const s = this.store.get();
    this.reset();
    if (s.mode.kind !== 'local' || location.pathname !== '/' || location.search) history.pushState(null, '', '/');
    document.title = APP_NAME;
    this.ui.showHome();
  }

  /**
   * Abgemeldet (F-438, auch Konto gelöscht oder Abmelden in einem anderen Tab): Arbeitsbereich und Entwurfsplatz leeren –
   * auch einen Gast-Entwurf von vor der Anmeldung (geteilter Rechner).
   */
  signedOut(): void {
    const s = this.store.get();
    this.ui.dismiss();
    this.reset();
    this.clearDraft();
    if (s.mode.kind !== 'local' && !this.ui.onPage()) {
      history.replaceState(null, '', '/');
      document.title = APP_NAME;
    }
  }

  /**
   * Gespeichert (F-437): Entwurf bzw. Ansicht (Beispiel, `?track=`, `#g=`) ist jetzt der eigene Törn. Nur ein
   * gespeicherter Entwurf leert den Entwurfsplatz – eine Ansicht lässt einen anderen Entwurf stehen.
   */
  saved(share: ShareMeta): void {
    const mode = this.store.get().mode;
    if (mode.kind === 'share') return;
    this.store.set({ mode: { kind: 'share', share }, saved: true });
    if (mode.kind === 'local') this.clearDraft();
    history.replaceState(null, '', share.link || `/s/${share.id}`);
    document.title = `${share.title} · ${APP_NAME}`;
  }

  private reset() {
    this.store.set({ tracks: [], weather: null, hover: null, saved: false, status: initialState.status, mode: { kind: 'local' }, loading: null });
  }

  // ---------------------------------------------------------------- Törns vom Server und aus Links

  async openShare(id: string, key?: string): Promise<void> {
    this.setLoading('Lade geteilten Törn …');
    try {
      const [{ share }, payload] = await Promise.all([api.shareMeta(id, key), api.shareData(id, key)]);
      // Fahrtenbuch-Eintrag ohne GPX: schematische Linie aus der Route (Konzept 19)
      const tracks = payload.route && !payload.tracks.length
        ? [routeTrack(payload.route, { id: localId(), name: share.title, color: TRACK_COLORS[0], distNm: share.distNm, startedAt: share.startedAt, endedAt: share.endedAt ?? null, timed: !!share.log?.timed })]
        : this.build(payload.tracks.map((t) => ({ name: t.name, text: t.gpx })));
      const view = { ...parseView(share.view), ...parseView(location.search.slice(1)) };
      this.store.set({ metric: view.metric ?? this.store.get().metric, layers: view.layers ?? this.store.get().layers });
      document.title = `${share.title} · ${APP_NAME}`;
      await this.setTracks(tracks, { mode: key ? { kind: 'share', share, key } : { kind: 'share', share }, fit: true, weather: payload.weather });
      // Altbestand der Revier-Wärmekarte (Konzept 37): eigene öffentliche GPX-Törns bekommen ihr Raster nachgereicht
      if (share.isOwner && share.source !== 'manual' && share.visibility === 'public') sendHeat(share.id, tracks);
    } catch (e) {
      this.setLoading(null);
      this.ui.toast(e instanceof ApiError && e.status === 404 ? 'Diese Freigabe gibt es nicht (mehr) – oder sie ist privat.' : errorText(e), 6000);
      history.replaceState(null, '', '/');
      await this.restore();
    }
  }

  /** `?track=<name>` aus /tracks/ (F-06): eine Ansicht, kein Entwurf. */
  async openFiles(names: string[]): Promise<void> {
    this.setLoading('Lade Track-Dateien …');
    const items: RawItem[] = [];
    for (const n of names) {
      try {
        items.push(await fetchTrackFile(n));
      } catch (e) {
        this.ui.toast(`„${n}“ konnte nicht geladen werden: ${errorText(e)}`, 6000);
      }
    }
    const tracks = this.build(items);
    if (!tracks.length) return this.setLoading(null);
    await this.setTracks(tracks, { mode: { kind: 'link', title: tracks.map((t) => t.name).join(', ') }, fit: true });
  }

  /** Beispiel von der Startseite (F-06): als Ansicht wie `?track=`, überschreibt keinen Entwurf. */
  async sample(file: string): Promise<void> {
    history.pushState(null, '', `/?track=${encodeURIComponent(file)}`);
    this.ui.leavePage();
    await this.openFiles([file]);
  }

  /** Alte Links (#g=…) mit eingebetteten GPX-Daten. */
  async openInline(data: string): Promise<void> {
    this.setLoading('Lade geteilten Track …');
    const raws = JSON.parse(await inflateFromBase64Url(data)) as unknown;
    if (!Array.isArray(raws) || raws.length > 20 || !raws.every((r) => typeof r === 'string')) throw new Error('Link ist beschädigt');
    const tracks = this.build(raws.map((text, i) => ({ name: `Geteilter Track ${i + 1}`, text })));
    if (!tracks.length) return this.setLoading(null);
    await this.setTracks(tracks, { mode: { kind: 'link', title: 'Geteilter Track' }, fit: true });
  }

  // ---------------------------------------------------------------- Helfer

  private build(items: RawItem[], offset = 0): Track[] {
    const out: Track[] = [];
    for (const it of items) {
      try {
        const g = parseGpx(it.text, it.name);
        out.push({
          id: localId(),
          name: g.name,
          raw: it.text,
          points: g.points,
          stats: computeTrackStats(g.points),
          color: TRACK_COLORS[(offset + out.length) % TRACK_COLORS.length],
          hidden: false,
        });
      } catch (e) {
        this.ui.toast(`${it.name}: ${e instanceof GpxError ? e.message : 'konnte nicht gelesen werden'}`);
      }
    }
    return out;
  }

  /**
   * Setzt Tracks, speichert einen Entwurf und lädt Wetter – aber nur, wenn keine gespeicherten Daten mitkommen
   * (Freigabe, Entwurf). Abgerufen wird also einmal beim Einstellen, nicht bei jedem Aufruf.
   */
  private async setTracks(tracks: Track[], opts: { mode: State['mode']; fit: boolean; weather?: WeatherData | null }, persist = true) {
    this.store.set({ tracks, mode: opts.mode, home: false, saved: opts.mode.kind === 'share' && !!opts.mode.share.isOwner, hover: null, weather: null, status: { level: 'loading', text: 'Lade Wind- und Wellendaten …' }, loading: null });
    if (opts.fit) this.ui.fit(tracks);
    if (persist) this.persist();
    if (!tracks.length) return this.store.set({ status: initialState.status });
    if (opts.weather) {
      attachConditions(tracks, opts.weather);
      return this.store.set({ weather: opts.weather, status: storedWeatherStatus(tracks, opts.weather), tracks: [...tracks] });
    }
    this.setLoading('Lade Wetterdaten …');
    const { data, status } = await loadWeather(tracks);
    // Inzwischen geänderte Trackliste? Dann gilt das Ergebnis nicht mehr – die Ladeanzeige aber auch nicht.
    if (this.store.get().tracks !== tracks) {
      if (this.store.get().loading === 'Lade Wetterdaten …') this.setLoading(null);
      return;
    }
    attachConditions(tracks, data);
    this.store.set({ weather: data, status, loading: null, tracks: [...tracks] });
    this.persist(); // jetzt mit Wetter
  }

  /** Nur ein Entwurf wird gespeichert – ein Platz im Browser (Konzept 23), mit Eigentümer; andere Tabs erfahren es. */
  private persist() {
    const s = this.store.get();
    if (s.mode.kind !== 'local') return;
    const owner = s.user?.id ?? GUEST;
    this.setDraft(s.tracks, owner);
    void workspace
      .save(s.tracks.map((t) => ({ id: t.id, name: t.name, gpx: t.raw, hidden: t.hidden })), s.weather, owner)
      .then(() => this.channel?.postMessage('changed'));
  }

  private setLoading(text: string | null) {
    this.store.set({ loading: text });
  }
}

/** crypto.randomUUID gibt es nur in sicheren Kontexten – im LAN-Test (http://192.168…) nicht. */
function localId(): string {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
