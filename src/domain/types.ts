export interface Conditions {
  wind: number | null; // kn
  dir: number | null; // ° (woher)
  gust: number | null; // kn
  wave: number | null; // m
  wdir: number | null; // ° (Laufrichtung-Konvention von Open-Meteo: woher)
  wper: number | null; // s
}

export interface TrackPoint {
  lat: number;
  lon: number;
  /** Epoch-Millisekunden */
  time: number | null;
  ele: number | null;
  /** Rohgeschwindigkeit zum Vorgänger in kn */
  speed: number | null;
  /** geglättet, null bei Ausreißern */
  speedSmooth: number | null;
  glitch: boolean;
  wx: Conditions | null;
}

export interface TrackStats {
  distNm: number;
  maxSpeed: number;
  avgSpeed: number;
  start: number | null;
  end: number | null;
  movingH: number;
  nPts: number;
  hasTime: boolean;
  nGlitch: number;
}

export interface Track {
  id: string;
  name: string;
  /** Original-GPX, wird beim Teilen unverändert übertragen */
  raw: string;
  points: TrackPoint[];
  stats: TrackStats;
  color: string;
  hidden: boolean;
}

export type MetricKey = 'speed' | 'wind' | 'gust' | 'wave';

export interface Bounds {
  south: number;
  north: number;
  west: number;
  east: number;
  tMin: number | null;
  tMax: number | null;
}
