// Bestätigungen des Skippers aufheben (Konzept 15) – nur Anweisungen, ohne weitere Worker-Module, damit Törns,
// Boote, Crew und Kontolöschung sie ohne Import-Zyklen nutzen (wie reaction-cleanup.ts).
import type { Env } from './env';

/** Alle Bestätigungen des Skippers an einem Törn aufheben (Skipper wechselt, Boot geändert – Konzept 15). */
export const clearConfirmations = (env: Env, shareId: string) => [
  env.DB.prepare('UPDATE share_crew SET confirmed_at = NULL, confirmed_by = NULL WHERE share_id = ?').bind(shareId),
  env.DB.prepare('UPDATE shares SET role_confirmed_at = NULL, role_confirmed_by = NULL WHERE id = ?').bind(shareId),
];

/** Dasselbe für alle Törns, deren Boot gleich wegfällt – `boatWhere` mit Platzhaltern für `bind` (Boot löschen, Konto des Eigners löschen). */
export const clearBoatConfirmations = (env: Env, boatWhere: string, ...args: unknown[]) => [
  env.DB.prepare(`UPDATE share_crew SET confirmed_at = NULL, confirmed_by = NULL WHERE share_id IN (SELECT id FROM shares WHERE boat_id ${boatWhere})`).bind(...args),
  env.DB.prepare(`UPDATE shares SET role_confirmed_at = NULL, role_confirmed_by = NULL WHERE boat_id ${boatWhere}`).bind(...args),
];

