// Miniflare legt pro Worker-Instanz einen Ordner miniflare-* im Temp-Verzeichnis an. Unter Windows bleibt er
// nach dispose() oft liegen (Dateisperren) – über viele Testläufe füllt das die Platte. Darum räumen wir selbst auf:
// alte Reste beim Start, die eigenen nach dem Lauf.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = 'miniflare-';

function sweep(olderThan: number): void {
  let names: string[];
  try {
    names = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = join(tmpdir(), name);
    try {
      if (statSync(dir).mtimeMs > olderThan) continue;
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // noch gesperrt (z. B. paralleler Lauf) – beim nächsten Mal
    }
  }
}

export function setup(): () => void {
  const started = Date.now();
  // Reste früherer Läufe (älter als eine Stunde – ein paralleler Lauf bleibt unberührt)
  sweep(started - 3_600_000);
  // nach dem Lauf: alles, was dieser Lauf angelegt hat
  return () => sweep(Date.now());
}
