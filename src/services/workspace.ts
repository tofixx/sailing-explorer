// Entwurf (Konzept 23): die Tracks eines neuen Törns bleiben im Browser (IndexedDB, ein Platz) und sind beim
// nächsten Besuch wieder da. Nichts davon verlässt das Gerät. `owner` hält fest, wem er gehört – ein Konto-Entwurf
// erscheint nie bei einem anderen Konto oder nach dem Ende der Sitzung (Konzept 23.1).

const DB_NAME = 'sail-explorer';
const STORE = 'workspace';
const KEY = 'current';

export interface WorkspaceTrack {
  id: string;
  name: string;
  gpx: string;
  hidden: boolean;
}

export interface Workspace {
  tracks: WorkspaceTrack[];
  /** beim Laden der Tracks einmal abgerufen – beim nächsten Besuch kein neuer Abruf */
  weather?: unknown;
  /** Konto-ID bzw. 'guest' (ältere Einträge ohne Angabe gelten als Gast-Entwurf) */
  owner?: string;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const workspace = {
  async load(): Promise<Workspace | null> {
    try {
      return ((await tx('readonly', (s) => s.get(KEY))) as Workspace | undefined) ?? null;
    } catch {
      return null; // privater Modus o. ä. – App funktioniert ohne Persistenz
    }
  },
  async save(tracks: WorkspaceTrack[], weather: unknown = null, owner = 'guest'): Promise<void> {
    try {
      if (!tracks.length) await tx('readwrite', (s) => s.delete(KEY));
      else await tx('readwrite', (s) => s.put({ tracks, weather, owner, savedAt: Date.now() } satisfies Workspace, KEY));
    } catch {
      // Speicher voll / gesperrt: still ignorieren, die Sitzung bleibt im Speicher
    }
  },
};
