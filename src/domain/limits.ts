// Kontingente pro Stufe (Konzept 5.1, E3) und globale Notbremse (Konzept 5.2): reine Regeln ohne DOM und Netz –
// genutzt von Worker (Prüfung) und Oberfläche (Anzeige „x von y“). Technische Obergrenzen einzelner Anfragen
// (Titel-Länge, Upload pro Törn, …) bleiben in worker/validate.ts (LIMITS).
import { fmtMB } from './format';

export type Tier = 'free' | 'supporter';

const MB = 1024 * 1024;

/** Upload pro Törn (Track-Payload, gzip) – technische Grenze, gleich für alle Stufen. */
export const SHARE_UPLOAD_BYTES = 12 * MB;
/** Übersichtsbild einer Freigabe (JPEG) – technische Grenze. */
export const SHARE_IMAGE_BYTES = 1.5 * MB;
/** Standard für kostenlose Törns (Worker-Variable FREE_SHARES kann das ändern). */
export const DEFAULT_FREE_SHARES = 3;

export interface TierLimits {
  /** gespeicherte Törns pro Konto */
  shares: number;
  /** Speicher gesamt in Bytes: Track-Payloads + Übersichtsbilder + Fotos */
  bytes: number;
  /** Boote als Eigner */
  boats: number;
  /** Fotos pro Törn (kostenlos: keine, E3) */
  photosPerShare: number;
}

const SUPPORTER: TierLimits = { shares: 100, bytes: 200 * MB, boats: 20, photosPerShare: 100 };

/**
 * Grenzen einer Stufe. Kostenlos ist der Speicher nur implizit begrenzt: so viele Törns, wie kostenlos erlaubt sind,
 * je mit maximalem Upload und Übersichtsbild – die Zahl dient vor allem der Anzeige.
 */
export function limitsFor(tier: Tier, freeShares = DEFAULT_FREE_SHARES): TierLimits {
  if (tier === 'supporter') return { ...SUPPORTER };
  const shares = Math.max(0, Math.min(freeShares, SUPPORTER.shares));
  return { shares, bytes: shares * (SHARE_UPLOAD_BYTES + SHARE_IMAGE_BYTES), boats: 3, photosPerShare: 0 };
}

export const tierOf = (supporter: boolean): Tier => (supporter ? 'supporter' : 'free');

/**
 * Ergebnis einer Kontingentprüfung für „ein weiteres …“: ok, oder die Unterstützung würde helfen (402),
 * oder auch Unterstützer dürften nicht mehr (409). Bestehendes über der Grenze bleibt immer erhalten.
 */
export type QuotaVerdict = 'ok' | 'supporter_required' | 'quota';

/** Darf zu `used` noch `adding` hinzukommen? `pick` wählt die Grenze (z. B. l => l.boats). */
export function quotaVerdict(supporter: boolean, used: number, adding: number, pick: (l: TierLimits) => number, freeShares?: number): QuotaVerdict {
  if (used + adding <= pick(limitsFor(tierOf(supporter), freeShares))) return 'ok';
  if (!supporter && used + adding <= pick(limitsFor('supporter'))) return 'supporter_required';
  return 'quota';
}

// ---------------------------------------------------------------- Fotos (Phase C, Konzept 3 und 5.1)

/** Vollbild: lange Kante und Dateigröße (nach dem Neukodieren im Browser). */
export const PHOTO_FULL_PX = 2048;
export const PHOTO_FULL_BYTES = 1 * MB;
/** Vorschaubild: lange Kante und Dateigröße. */
export const PHOTO_THUMB_PX = 400;
export const PHOTO_THUMB_BYTES = 80 * 1024;
/** Bildunterschrift (Zeichen) */
export const PHOTO_CAPTION_LENGTH = 200;

/** Darf zu einem Törn mit `inShare` Fotos ein weiteres dazukommen? Kostenlos nie (E3), Unterstützer bis 100. */
export const photoVerdict = (supporter: boolean, inShare: number): QuotaVerdict => quotaVerdict(supporter, inShare, 1, (l) => l.photosPerShare);

/** Meldung, wenn kein weiteres Foto hochgeladen werden kann – gleicher Wortlaut wie der Server. */
export function photoLimitMessage(v: Exclude<QuotaVerdict, 'ok'>, supportOffered: boolean): string {
  if (v === 'quota') return `Maximal ${limitsFor('supporter').photosPerShare} Fotos pro Törn.`;
  return 'Fotos gibt es nur für Unterstützer.' + (supportOffered ? ' Unterstütze Sail Explorer mit einem Kaffee oder Bier, um Fotos zu deinen Törns hochzuladen.' : '');
}

// ---------------------------------------------------------------- Titelbilder (Konzept 13.2)

/** Titelbild: im Browser auf 3:1 zugeschnitten, so groß und höchstens so viele Bytes. Für alle Konten (E6). */
export const COVER_WIDTH = 1500;
export const COVER_HEIGHT = 500;
export const COVER_BYTES = 300 * 1024;

/** Galerie an Person, Boot, Verein/Team: so viele der neuesten öffentlichen Törn-Fotos. */
export const GALLERY_PHOTOS = 12;

// ---------------------------------------------------------------- Globale Notbremse (Konzept 5.2)

const GB = 1000 ** 3;
/** Ab hier pausieren neue Uploads kostenloser Konten (Worker-Variable STORAGE_SOFT_BYTES). */
export const STORAGE_SOFT_BYTES = 8 * GB;
/** Ab hier pausieren alle neuen Uploads (Worker-Variable STORAGE_HARD_BYTES). */
export const STORAGE_HARD_BYTES = 9.5 * GB;

export type BrakeLevel = 'ok' | 'soft' | 'hard';

/** Füllstand → Stufe. Fail closed: unbekannter Gesamtspeicher (null) gilt als „hart“. */
export function brakeLevel(totalBytes: number | null, soft = STORAGE_SOFT_BYTES, hard = STORAGE_HARD_BYTES): BrakeLevel {
  if (totalBytes === null || !Number.isFinite(totalBytes)) return 'hard';
  if (totalBytes >= hard) return 'hard';
  if (totalBytes >= soft) return 'soft';
  return 'ok';
}

/** Sind neue Uploads für diese Stufe pausiert? Ab „soft“ kostenlose, ab „hard“ alle. */
export const brakeBlocks = (level: BrakeLevel, supporter: boolean) => level === 'hard' || (level === 'soft' && !supporter);

// ---------------------------------------------------------------- Anzeige

export interface UsageStatus {
  supporter: boolean;
  sharesUsed: number;
  sharesMax: number;
  bytesUsed: number;
  bytesMax: number;
  /** fehlen bei älteren Servern – dann ohne Boote */
  boatsUsed?: number;
  boatsMax?: number;
  /** Fotos im Konto (Phase C) – fehlt bei älteren Servern */
  photosUsed?: number;
}

const n = (v: number) => v.toLocaleString('de-DE');

/** „2 von 3 Törns · 1,2 MB von 41 MB · 1 von 3 Booten“ – für die aktuelle Stufe. */
export function usageText(s: UsageStatus): string {
  const parts = [`${n(s.sharesUsed)} von ${n(s.sharesMax)} Törns`, `${fmtMB(s.bytesUsed)} von ${fmtMB(s.bytesMax)}`];
  if (s.boatsUsed !== undefined && s.boatsMax !== undefined) parts.push(`${n(s.boatsUsed)} von ${n(s.boatsMax)} ${s.boatsMax === 1 ? 'Boot' : 'Booten'}`);
  if (s.photosUsed) parts.push(`${n(s.photosUsed)} ${s.photosUsed === 1 ? 'Foto' : 'Fotos'}`);
  return parts.join(' · ');
}

/** Ab diesem Anteil am Speicher weist der Teilen-Dialog auf das Kontingent hin. */
export const STORAGE_HINT_RATIO = 0.8;

/** Hinweis im Teilen-Dialog, wenn der Speicher fast voll ist (sonst leer). */
export function storageHint(s: Pick<UsageStatus, 'supporter' | 'bytesUsed' | 'bytesMax'> | null): string {
  if (!s || s.bytesMax <= 0 || s.bytesUsed < s.bytesMax * STORAGE_HINT_RATIO) return '';
  const used = `${fmtMB(s.bytesUsed)} von ${fmtMB(s.bytesMax)} Speicher belegt`;
  if (s.bytesUsed >= s.bytesMax) return `Speicher voll (${used}) – lösche ältere Törns, um neue zu speichern.`;
  return `Fast voll: ${used}. Große Törns passen eventuell nicht mehr.`;
}

/** Meldung, wenn kein weiteres Boot angelegt werden kann (sonst leer) – gleicher Wortlaut wie der Server. */
export function boatLimitText(s: Pick<UsageStatus, 'supporter' | 'boatsUsed'> | null, supportOffered = true): string {
  if (!s || s.boatsUsed === undefined) return '';
  const v = quotaVerdict(s.supporter, s.boatsUsed, 1, (l) => l.boats);
  return v === 'ok' ? '' : boatLimitMessage(v, supportOffered);
}

export function boatLimitMessage(v: Exclude<QuotaVerdict, 'ok'>, supportOffered: boolean): string {
  const free = limitsFor('free').boats;
  const max = limitsFor('supporter').boats;
  if (v === 'quota') return `Maximal ${max} Boote pro Konto – lösche ein Boot, um ein neues anzulegen.`;
  return `Kostenlos kannst du ${free} Boote anlegen.` + (supportOffered ? ` Als Unterstützer sind es bis zu ${max}.` : ' Lösche ein Boot, um ein neues anzulegen.');
}

// ---------------------------------------------------------------- Vereine, Teams, Folgen (Konzept 11.8)

/** Grenzen für Gruppen, Beiträge und Folgen – Beitreten ist unbegrenzt. */
export const GROUP_LIMITS = {
  /** Gruppen als Eigner (Vereine und Teams zusammen): kostenlos 1 (nur öffentlich), Unterstützer 10 */
  owned: { free: 1, supporter: 10 },
  /** Mitglieder je Gruppe */
  members: 500,
  /** Boote je Gruppe */
  boats: 200,
  /** Beiträge je Gruppe und Tag (zählt auch gelöschte) */
  postsPerDay: 5,
  /** Folgen je Konto */
  follows: 1000,
  /** Beitrittsanfragen je Konto und Tag bzw. offen je Gruppe */
  requestsPerDay: 20,
  openRequests: 100,
  /** Einladungslink: so oft nutzbar, so viele Tage gültig */
  linkUses: 100,
  inviteDays: 14,
  /** Wöchentliche Sammelmails pro Cron-Lauf (Resend Free: 100/Tag für alles) */
  digestsPerRun: 20,
} as const;

/** Darf das Konto noch eine Gruppe anlegen? Kostenlos 1, Unterstützer 10 (402 bzw. 409 wie bei Booten). */
export function groupVerdict(supporter: boolean, owned: number): QuotaVerdict {
  if (owned + 1 <= GROUP_LIMITS.owned[supporter ? 'supporter' : 'free']) return 'ok';
  if (!supporter && owned + 1 <= GROUP_LIMITS.owned.supporter) return 'supporter_required';
  return 'quota';
}

export function groupLimitMessage(v: Exclude<QuotaVerdict, 'ok'>, supportOffered: boolean): string {
  const { free, supporter } = GROUP_LIMITS.owned;
  if (v === 'quota') return `Du kannst höchstens ${supporter} Vereine und Teams anlegen – lösche eine Gruppe, um eine neue zu gründen.`;
  return `Kostenlos kannst du ${free === 1 ? 'eine Gruppe' : `${free} Gruppen`} anlegen.` + (supportOffered ? ` Als Unterstützer sind es bis zu ${supporter}, auch geschlossene.` : '');
}
