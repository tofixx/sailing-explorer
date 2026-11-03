// GPX nachreichen (Konzept 38): reine Regeln, gleich im Browser und im Worker.
import { fmtDate } from './format';
import { WARN_MS, shareExpiry } from './support';

const DAY = 86_400_000;

/** Spielraum um den Tag des Eintrags (Kalendertage, UTC): Zeitzonen und Nachtfahrten (F-602). */
export const TRACK_DATE_TOLERANCE_DAYS = 1;

/** Darf die Eigentümer:in an diesen Törn ein GPX nachreichen? Nur Einträge ohne GPX (F-600). */
export const canAttachTrack = (s: { isOwner: boolean; source?: string | null }): boolean => s.isOwner && s.source === 'manual';

/**
 * Passt der Track zeitlich zum Eintrag (F-602)? Er muss die Kalendertage von Abfahrt bis Ankunft (UTC) ± 1 Tag
 * berühren. Ohne Zeitstempel im Track (`trackStart` null) gibt es nichts zu prüfen. null = in Ordnung, sonst die Meldung.
 */
export function trackDateError(
  entry: { startedAt: number | null; endedAt: number | null },
  trackStart: number | null,
  trackEnd: number | null,
): string | null {
  if (trackStart === null || entry.startedAt === null) return null;
  const end = trackEnd ?? trackStart;
  const from = (Math.floor(entry.startedAt / DAY) - TRACK_DATE_TOLERANCE_DAYS) * DAY;
  const to = (Math.floor(Math.max(entry.endedAt ?? entry.startedAt, entry.startedAt) / DAY) + 1 + TRACK_DATE_TOLERANCE_DAYS) * DAY;
  if (end >= from && trackStart < to) return null;
  return `Der Track ist vom ${fmtDate(trackStart)}, der Eintrag vom ${fmtDate(entry.startedAt)}. Passt der Track, ändere zuerst das Datum des Eintrags.`;
}

/**
 * Mit Track gilt die Aufbewahrung der Törns (eine Saison kürzer als ohne GPX, L2). Läge der Löschtermin innerhalb der
 * Warnfrist oder schon vorbei, wird nicht nachgereicht (F-604) – sonst verschwände der Eintrag ohne Warnung.
 */
export function attachExpiryError(createdAt: number, supporterUntil: number | null, now: number): string | null {
  const expires = shareExpiry(createdAt, supporterUntil);
  if (expires > now + WARN_MS) return null;
  return `Mit Track gilt die Aufbewahrung eines Törns – dieser Eintrag würde dann am ${fmtDate(expires)} gelöscht. Ohne GPX bleibt er länger.`;
}
