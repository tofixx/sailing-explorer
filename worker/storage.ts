// Speicher-Buchhaltung (Konzept 5, Phase B): belegter Speicher pro Konto und der globale Zähler für die Notbremse.
// Regeln (Grenzen, Schwellen) stehen rein in src/domain/limits.ts; hier nur SQL und Worker-Variablen.
import type { Env } from './env';
import { HttpError } from './http';
import { storageThresholds } from './validate';
import { brakeBlocks, brakeLevel, type BrakeLevel } from '../src/domain/limits';

export const STORAGE_COUNTER = 'storage_bytes';

/** Speicher eines Törns: Track-Payload + Übersichtsbild (Spalten von `shares`, Alias s). */
export const SHARE_BYTES_SQL = 's.size_bytes + s.image_bytes';

/**
 * Fotos (Phase C): Speicher pro Konto (Bind-Parameter ?1 = user_id) bzw. gesamt. Fotos, die mit ihrem Törn bzw.
 * Konto gelöscht werden, zählen subtractShareStmt/subtractUserStmt mit.
 */
export const PHOTO_BYTES_USER_SQL = '(SELECT COALESCE(SUM(bytes), 0) FROM photos WHERE user_id = ?1)';
export const PHOTO_BYTES_TOTAL_SQL = '(SELECT COALESCE(SUM(bytes), 0) FROM photos)';

/** Belegter Speicher eines Kontos (Bind-Parameter ?1 = user_id). */
export const USER_BYTES_SQL = `(SELECT COALESCE(SUM(${SHARE_BYTES_SQL}), 0) FROM shares s WHERE s.user_id = ?1) + ${PHOTO_BYTES_USER_SQL}`;

/** Zähler um delta Bytes verschieben (nie unter 0). Fehlt die Zeile, bleibt sie fehlend (fail closed bis zum Cron). */
export const addStorageStmt = (env: Env, delta: number) =>
  env.DB.prepare('UPDATE counters SET value = MAX(0, value + ?) WHERE name = ?').bind(Math.round(delta), STORAGE_COUNTER);

/** Vor dem Löschen eines Törns im selben Batch: seinen Speicher (inkl. Fotos) vom Zähler abziehen. */
export const subtractShareStmt = (env: Env, shareId: string) =>
  env.DB.prepare(
    `UPDATE counters SET value = MAX(0, value - (SELECT COALESCE(SUM(${SHARE_BYTES_SQL}), 0) FROM shares s WHERE s.id = ?1)
       - (SELECT COALESCE(SUM(bytes), 0) FROM photos WHERE share_id = ?1)) WHERE name = ?2`,
  ).bind(shareId, STORAGE_COUNTER);

/** Nach dem Einfügen eines Fotos im selben Batch: seine Bytes zum Zähler addieren (0, wenn die Zeile nicht entstand). */
export const addPhotoStmt = (env: Env, photoId: string) =>
  env.DB.prepare('UPDATE counters SET value = MAX(0, value + COALESCE((SELECT bytes FROM photos WHERE id = ?1), 0)) WHERE name = ?2').bind(
    photoId, STORAGE_COUNTER,
  );

/** Vor dem Löschen eines Fotos im selben Batch: seine Bytes vom Zähler abziehen. */
export const subtractPhotoStmt = (env: Env, photoId: string) =>
  env.DB.prepare('UPDATE counters SET value = MAX(0, value - COALESCE((SELECT bytes FROM photos WHERE id = ?1), 0)) WHERE name = ?2').bind(
    photoId, STORAGE_COUNTER,
  );

/**
 * Vor dem Setzen von image_bytes im selben Batch: Zähler um die Differenz zum bisherigen Übersichtsbild verschieben –
 * aus der Zeile gelesen, damit ein ersetztes Bild nicht doppelt zählt.
 */
export const replaceImageStmt = (env: Env, shareId: string, newBytes: number) =>
  env.DB.prepare('UPDATE counters SET value = MAX(0, value + ?1 - COALESCE((SELECT image_bytes FROM shares WHERE id = ?2), ?1)) WHERE name = ?3').bind(
    newBytes, shareId, STORAGE_COUNTER,
  );

/** Vor dem Löschen aller Törns (und Fotos) eines Kontos im selben Batch. */
export const subtractUserStmt = (env: Env, userId: string) =>
  env.DB.prepare(
    `UPDATE counters SET value = MAX(0, value - (SELECT COALESCE(SUM(${SHARE_BYTES_SQL}), 0) FROM shares s WHERE s.user_id = ?1) - ${PHOTO_BYTES_USER_SQL}) WHERE name = ?2`,
  ).bind(userId, STORAGE_COUNTER);

/** Nächtlich: Zähler aus D1 neu berechnen (legt die Zeile auch wieder an). Liefert den neuen Wert. */
export async function recomputeStorage(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO counters (name, value)
       SELECT ?1, (SELECT COALESCE(SUM(${SHARE_BYTES_SQL}), 0) FROM shares s) + ${PHOTO_BYTES_TOTAL_SQL} WHERE true
     ON CONFLICT(name) DO UPDATE SET value = excluded.value
     RETURNING value`,
  )
    .bind(STORAGE_COUNTER)
    .first<{ value: number }>();
  return row?.value ?? 0;
}

export async function storageTotal(env: Env): Promise<number | null> {
  const row = await env.DB.prepare('SELECT value FROM counters WHERE name = ?').bind(STORAGE_COUNTER).first<{ value: number }>();
  return row ? row.value : null;
}

/** Aktuelle Stufe der Notbremse (fehlender Zähler = „hard“). */
export async function currentBrake(env: Env): Promise<BrakeLevel> {
  const { soft, hard } = storageThresholds(env);
  return brakeLevel(await storageTotal(env), soft, hard);
}

/** 503, wenn neue Uploads für diese Stufe gerade pausiert sind (Konzept 5.2). `what`: „Törns“ bzw. „Fotos“. */
export function checkBrake(level: BrakeLevel, supporter: boolean, what = 'Törns'): void {
  if (!brakeBlocks(level, supporter)) return;
  throw new HttpError(
    503,
    'storage_paused',
    level === 'hard'
      ? `Der Speicher von Sail Explorer ist gerade voll – neue ${what} sind vorübergehend pausiert. Bitte später erneut versuchen.`
      : `Der Speicher von Sail Explorer ist gerade knapp – neue ${what} sind für kostenlose Konten vorübergehend pausiert. Unterstützer können weiter speichern.`,
  );
}
