// Reine Regeln der Moderation (Konzept 36): neues Konto, Sichtbarkeit zurückgehaltener Titelbilder, Gründe je Ziel.
import { describe, expect, it } from 'vitest';
import { NEW_ACCOUNT_DAYS, isNewAccount, newAccountEnd } from '../src/domain/moderation';
import { NEW_REPORTER_HOLD_MS, REPORT_HOLD, coverHoldText, coverShown, reportHoldUntil } from '../src/domain/cover';
import { REPORT_REASONS, reportReasonsFor } from '../src/domain/comment-text';

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 3, 12);

describe('isNewAccount', () => {
  it('[F-560] jünger als 7 Tage und kein Unterstützer; Admins nie', () => {
    expect(NEW_ACCOUNT_DAYS).toBe(7);
    expect(isNewAccount({ createdAt: now - DAY, supporter: false }, now)).toBe(true);
    expect(isNewAccount({ createdAt: now - 7 * DAY + 1, supporter: false }, now)).toBe(true);
    expect(isNewAccount({ createdAt: now - 7 * DAY, supporter: false }, now)).toBe(false);
    expect(isNewAccount({ createdAt: now - DAY, supporter: true }, now)).toBe(false);
    expect(isNewAccount({ createdAt: now - DAY, supporter: false, admin: true }, now)).toBe(false);
    expect(newAccountEnd(now)).toBe(now + 7 * DAY);
  });
});

describe('coverShown / coverHoldText', () => {
  it('[F-562] öffentlich ohne Frist oder nach Ablauf; Hinweis nennt das Datum bzw. die Meldung', () => {
    expect(coverShown(null, now)).toBe(true);
    expect(coverShown(now, now)).toBe(true);
    expect(coverShown(now + 1, now)).toBe(false);
    expect(coverShown(REPORT_HOLD, now)).toBe(false);
    expect(coverHoldText(null, now)).toBe('');
    expect(coverHoldText(Date.UTC(2026, 10, 10, 11), now)).toContain('ab 10.11.');
    expect(coverHoldText(REPORT_HOLD, now)).toContain('gemeldet');
  });
});

describe('reportReasonsFor', () => {
  it('[F-566] Bild-Gründe nur für Fotos und für Profil, Boot, Gruppe mit Titelbild', () => {
    expect(REPORT_REASONS).toContain('minors');
    expect(reportReasonsFor('photo')).toEqual(['spam', 'abuse', 'illegal', 'depicted', 'minors', 'other']);
    for (const k of ['profile', 'boat', 'group'] as const) {
      expect(reportReasonsFor(k, true)).toContain('depicted');
      expect(reportReasonsFor(k, false)).not.toContain('depicted');
    }
    for (const k of ['share', 'comment', 'post', 'harbor'] as const) expect(reportReasonsFor(k, true)).toEqual(['spam', 'abuse', 'illegal', 'other']);
  });
});

describe('reportHoldUntil', () => {
  it('[F-569] Bild-Meldung: unbefristet, von neuen Konten (Gewicht 0) 72 h', () => {
    expect(reportHoldUntil(1, now)).toBe(REPORT_HOLD);
    expect(reportHoldUntil(0, now)).toBe(now + NEW_REPORTER_HOLD_MS);
    expect(NEW_REPORTER_HOLD_MS).toBe(72 * 3_600_000);
  });
});
