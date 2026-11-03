// GPX nachreichen (Konzept 38): reine Regeln, gleich im Browser und im Worker.
import { fmtDate } from './format';
import { WARN_MS } from './support';

const DAY = 86_400_000;

/** Spielraum um den Tag des Eintrags (Kalendertage, UTC): Zeitzonen und Nachtfahrten (F-602). */
export const TRACK_DATE_TOLERANCE_DAYS = 1;

/** Darf die Eigentümer:in an diesen Törn ein GPX nachreichen? Nur Einträge ohne GPX (F-600). */
export const canAttachTrack = (s: { isOwner: boolean; source?: string | null }): boolean => s.isOwner && s.source === 'manual';

/**
 * Menüeintrag „GPX nachreichen“ zeigen (F-605)? Nur wenn nachgereicht werden darf und – soweit der Server den
 * Löschtermin nach Törn-Regel mitliefert (`trackExpiresAt`) – das nicht an der Warnfrist scheitert (F-604).
 */
export const offerAttachTrack = (s: { isOwner: boolean; source?: string | null; trackExpiresAt?: number | null }, now = Date.now()): boolean =>
  canAttachTrack(s) && (s.trackExpiresAt == null || attachExpiryError(s.trackExpiresAt, now) === null);

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
 * Mit Track gilt die Aufbewahrung der Törns (eine Saison kürzer als ohne GPX, L2). `expires` ist der Löschtermin nach
 * Törn-Regel (`shareExpiry` im Worker, `trackExpiresAt` der Einzelansicht im Browser). Läge er innerhalb der Warnfrist
 * (14 Tage) oder schon vorbei, wird nicht nachgereicht (F-604) – sonst verschwände der Eintrag ohne Warnung.
 */
export function attachExpiryError(expires: number, now: number): string | null {
  if (expires > now + WARN_MS) return null;
  return `Mit Track gilt die Aufbewahrung eines Törns – dieser Eintrag würde dann am ${fmtDate(expires)} gelöscht. Ohne GPX bleibt er länger.`;
}
