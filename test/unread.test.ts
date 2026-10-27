// Reine Regeln des Community-Badges (Konzept 12.10, F-221/F-222).
import { describe, expect, it } from 'vitest';
import { UNREAD_MAX, seenUntil, unreadLabel } from '../src/domain/unread';

describe('Community-Badge', () => {
  it('[F-221] Text: leer ohne Neues, sonst die Zahl, über 99 „99+“', () => {
    expect(unreadLabel(0)).toBe('');
    expect(unreadLabel(-1)).toBe('');
    expect(unreadLabel(Number.NaN)).toBe('');
    expect(unreadLabel(1)).toBe('1');
    expect(unreadLabel(UNREAD_MAX)).toBe('99');
    expect(unreadLabel(UNREAD_MAX + 1)).toBe('99+');
  });

  it('[F-222] gelesen bis: Stand der Seite, nie in der Zukunft; ohne gültige Angabe jetzt', () => {
    const now = 1_700_000_000_000;
    expect(seenUntil(now - 5000, now)).toBe(now - 5000);
    expect(seenUntil(now + 60_000, now)).toBe(now);
    for (const bad of [undefined, null, 'x', Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) expect(seenUntil(bad, now)).toBe(now);
  });
});
