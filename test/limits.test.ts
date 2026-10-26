// Unit-Tests: Kontingente pro Stufe und Notbremse (src/domain/limits.ts) – Konzept 5, F-120 … F-123.
import { describe, expect, it } from 'vitest';
import {
  SHARE_IMAGE_BYTES,
  SHARE_UPLOAD_BYTES,
  STORAGE_HARD_BYTES,
  STORAGE_SOFT_BYTES,
  boatLimitText,
  brakeBlocks,
  brakeLevel,
  limitsFor,
  quotaVerdict,
  storageHint,
  tierOf,
  usageText,
} from '../src/domain/limits';
import { LIMITS, parseByteSize, parseFreeShares, storageThresholds } from '../worker/validate';

const MB = 1024 * 1024;

describe('limitsFor', () => {
  it('Unterstützer: 100 Törns, 200 MB, 20 Boote, 100 Fotos pro Törn', () => {
    expect(limitsFor('supporter')).toEqual({ shares: 100, bytes: 200 * MB, boats: 20, photosPerShare: 100 });
  });

  it('kostenlos: 3 Törns, Speicher implizit (3 × Upload + Bild), 3 Boote, keine Fotos', () => {
    expect(limitsFor('free')).toEqual({ shares: 3, bytes: 3 * (12 * MB + 1.5 * MB), boats: 3, photosPerShare: 0 });
  });

  it('kostenlose Törns folgen FREE_SHARES, nie über der Unterstützer-Grenze', () => {
    expect(limitsFor('free', 5)).toMatchObject({ shares: 5, bytes: 5 * (SHARE_UPLOAD_BYTES + SHARE_IMAGE_BYTES) });
    expect(limitsFor('free', 1000).shares).toBe(100);
    expect(limitsFor('free', -1).shares).toBe(0);
  });

  it('liefert Kopien (Aufrufer können nichts verstellen)', () => {
    limitsFor('supporter').shares = 1;
    expect(limitsFor('supporter').shares).toBe(100);
  });

  it('technische Grenzen bleiben in LIMITS, Kontingente nicht', () => {
    expect(LIMITS.uploadBytes).toBe(SHARE_UPLOAD_BYTES);
    expect(LIMITS.imageBytes).toBe(SHARE_IMAGE_BYTES);
    expect(LIMITS).not.toHaveProperty('sharesPerUser');
    expect(LIMITS).not.toHaveProperty('bytesPerUser');
    expect(LIMITS).not.toHaveProperty('boatsPerUser');
    expect(parseFreeShares('500')).toBe(100);
  });

  it('tierOf', () => {
    expect(tierOf(true)).toBe('supporter');
    expect(tierOf(false)).toBe('free');
  });
});

describe('quotaVerdict', () => {
  const boats = (l: { boats: number }) => l.boats;
  it('kostenlos: bis 3 ok, darüber würde Unterstützung helfen, über 20 nicht', () => {
    expect(quotaVerdict(false, 2, 1, boats)).toBe('ok');
    expect(quotaVerdict(false, 3, 1, boats)).toBe('supporter_required');
    expect(quotaVerdict(false, 20, 1, boats)).toBe('quota');
  });
  it('Unterstützer: bis 20 ok, dann quota', () => {
    expect(quotaVerdict(true, 19, 1, boats)).toBe('ok');
    expect(quotaVerdict(true, 20, 1, boats)).toBe('quota');
  });
  it('Speicher: Bytes, die dazukommen, zählen mit; FREE_SHARES verschiebt die kostenlose Grenze', () => {
    const bytes = (l: { bytes: number }) => l.bytes;
    expect(quotaVerdict(true, 200 * MB - 10, 10, bytes)).toBe('ok');
    expect(quotaVerdict(true, 200 * MB - 10, 11, bytes)).toBe('quota');
    expect(quotaVerdict(false, limitsFor('free').bytes, 1, bytes)).toBe('supporter_required');
    expect(quotaVerdict(false, limitsFor('free').bytes, 1, bytes, 4)).toBe('ok');
  });
});

describe('Notbremse', () => {
  it('Standard: 8 GB / 9,5 GB (dezimal, vorsichtig unter 10 GB Free Tier)', () => {
    expect(STORAGE_SOFT_BYTES).toBe(8e9);
    expect(STORAGE_HARD_BYTES).toBe(9.5e9);
  });
  it('Stufen und fail closed', () => {
    expect(brakeLevel(0)).toBe('ok');
    expect(brakeLevel(8e9 - 1)).toBe('ok');
    expect(brakeLevel(8e9)).toBe('soft');
    expect(brakeLevel(9.5e9)).toBe('hard');
    expect(brakeLevel(null)).toBe('hard');
    expect(brakeLevel(NaN)).toBe('hard');
    expect(brakeLevel(150, 100, 200)).toBe('soft');
  });
  it('soft pausiert nur kostenlose Konten, hard alle', () => {
    expect(brakeBlocks('ok', false)).toBe(false);
    expect(brakeBlocks('soft', false)).toBe(true);
    expect(brakeBlocks('soft', true)).toBe(false);
    expect(brakeBlocks('hard', true)).toBe(true);
  });
  it('Schwellen aus Worker-Variablen: nur Ziffern, soft nie über hard', () => {
    expect(storageThresholds({})).toEqual({ soft: 8e9, hard: 9.5e9 });
    expect(storageThresholds({ STORAGE_SOFT_BYTES: '100', STORAGE_HARD_BYTES: '200' })).toEqual({ soft: 100, hard: 200 });
    expect(storageThresholds({ STORAGE_SOFT_BYTES: '300', STORAGE_HARD_BYTES: '200' })).toEqual({ soft: 200, hard: 200 });
    expect(parseByteSize('8 GB', 1)).toBe(1);
    expect(parseByteSize('-5', 1)).toBe(1);
    expect(parseByteSize(undefined, 7)).toBe(7);
  });
});

describe('Anzeige', () => {
  const st = { supporter: false, sharesUsed: 2, sharesMax: 3, bytesUsed: 1.2 * MB, bytesMax: limitsFor('free').bytes, boatsUsed: 1, boatsMax: 3 };
  it('usageText: „x von y Törns · a MB von b MB · c von d Booten“', () => {
    expect(usageText(st)).toBe('2 von 3 Törns · 1,2 MB von 41 MB · 1 von 3 Booten');
    expect(usageText({ ...st, supporter: true, sharesUsed: 12, sharesMax: 100, bytesMax: 200 * MB, boatsMax: 20 })).toBe('12 von 100 Törns · 1,2 MB von 200 MB · 1 von 20 Booten');
    // ältere Server ohne Boote
    expect(usageText({ ...st, boatsUsed: undefined, boatsMax: undefined })).toBe('2 von 3 Törns · 1,2 MB von 41 MB');
  });
  it('storageHint erst ab 80 %, „voll“ ab 100 %', () => {
    const s = (used: number) => ({ supporter: true, bytesUsed: used * MB, bytesMax: 200 * MB });
    expect(storageHint(null)).toBe('');
    expect(storageHint(s(150))).toBe('');
    expect(storageHint(s(160))).toBe('Fast voll: 160 MB von 200 MB Speicher belegt. Große Törns passen eventuell nicht mehr.');
    expect(storageHint(s(200))).toMatch(/^Speicher voll \(200 MB von 200 MB Speicher belegt\) – lösche ältere Törns/);
  });
  it('boatLimitText: leer unter der Grenze, sonst die Meldung des Servers', () => {
    expect(boatLimitText(null)).toBe('');
    expect(boatLimitText({ supporter: false, boatsUsed: 2 })).toBe('');
    expect(boatLimitText({ supporter: false, boatsUsed: 3 })).toBe('Kostenlos kannst du 3 Boote anlegen. Als Unterstützer sind es bis zu 20.');
    expect(boatLimitText({ supporter: false, boatsUsed: 3 }, false)).toBe('Kostenlos kannst du 3 Boote anlegen. Lösche ein Boot, um ein neues anzulegen.');
    expect(boatLimitText({ supporter: true, boatsUsed: 20 })).toBe('Maximal 20 Boote pro Konto – lösche ein Boot, um ein neues anzulegen.');
    expect(boatLimitText({ supporter: false, boatsUsed: undefined })).toBe('');
  });
});
