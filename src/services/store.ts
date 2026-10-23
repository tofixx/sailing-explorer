import type { MetricKey, Track, TrackPoint } from '../domain/types';
import type { WeatherData } from '../domain/weather';
import type { ShareMeta, User } from './api';
import type { Status } from './weather-api';

export interface Layers {
  seamarks: boolean;
  depth: boolean;
  windArrows: boolean;
  waveArrows: boolean;
}

export type HoverSource = 'map' | 'chart' | 'kpi';

/**
 * local: eigener Arbeitsbereich (wird im Browser gespeichert)
 * share: geöffnete Freigabe vom Server
 * link:  Daten aus einem Link (?track=…, #g=…), nicht gespeichert
 */
export type Mode = { kind: 'local' } | { kind: 'share'; share: ShareMeta } | { kind: 'link'; title: string };

export interface State {
  tracks: Track[];
  weather: WeatherData | null;
  status: Status;
  metric: MetricKey;
  layers: Layers;
  hover: { point: TrackPoint; source: HoverSource } | null;
  loading: string | null;
  mode: Mode;
  user: User | null;
  /** Backend fürs Teilen erreichbar */
  backend: boolean;
}

export const initialState: State = {
  tracks: [],
  weather: null,
  status: { level: 'idle', text: 'Noch kein Track geladen.' },
  metric: 'speed',
  layers: { seamarks: true, depth: false, windArrows: true, waveArrows: true },
  hover: null,
  loading: null,
  mode: { kind: 'local' },
  user: null,
  backend: false,
};

type Listener = (state: State, prev: State) => void;

/** Minimaler, unveränderlicher Store: set() erzeugt einen neuen Zustand und benachrichtigt. */
export class Store {
  private state: State;
  private listeners = new Set<Listener>();

  constructor(initial: State) {
    this.state = initial;
  }

  get(): State {
    return this.state;
  }

  set(patch: Partial<State>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const visibleTracks = (s: State) => s.tracks.filter((t) => !t.hidden);
