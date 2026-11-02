// Reine Regeln: Beitrag oder automatischer Eintrag, Benachrichtigungs-Stufen und Standard beim Schreiben
// (Konzept 24, F-445, F-447 … F-449).
import { describe, expect, it } from 'vitest';
import { ACTIVITY_KINDS, AUTOMATIC_KINDS, STREAM_KIND_CLASS, canSeeMembers, canSeeMembership, isAutomaticKind } from '../src/domain/groups';
import {
  DEFAULT_NOTIFY_LEVEL, FOLLOW_DEFAULT_LEVEL, NOTIFY_EVENTS, NOTIFY_LEVELS, levelsNotifying, notifyEventOf, parseDefaultLevel, shouldNotify,
} from '../src/domain/notifications';
import { defaultPostVisibility } from '../src/domain/posts';
import { memberAlias, funnyName } from '../src/domain/names';
import { effectiveLevelSql, followLevelSql, notifyLevelSql } from '../worker/notify-sql';

describe('F-441 F-443 Regeln für Mitgliederliste und Mitgliedschaft', () => {
  it('[F-441] Liste: Mitglieder immer, sonst nur bei öffentlicher Liste; Unbekanntes wie „nur Mitglieder“', () => {
    expect(canSeeMembers('members', null)).toBe(false);
    expect(canSeeMembers('public', null)).toBe(true);
    expect(canSeeMembers('members', 'member')).toBe(true);
    expect(canSeeMembers('irgendwas', null)).toBe(false);
    expect(canSeeMembers(undefined, 'owner')).toBe(true);
  });

  it('[F-443] Mitgliedschaft einer Person: nur Mitglieder derselben Gruppe – unabhängig von der Liste', () => {
    expect(canSeeMembership(null)).toBe(false);
    for (const r of ['owner', 'admin', 'member'] as const) expect(canSeeMembership(r)).toBe(true);
  });

  it('[F-441] Spaßname je Gruppe: verschieden je Gruppe, nie gleich dem allgemeinen Spaßnamen', () => {
    const u = 'User00000000000001';
    expect(memberAlias(u, 'GrpA00000000000001')).toBe(memberAlias(u, 'GrpA00000000000001'));
    expect(memberAlias(u, 'GrpA00000000000001')).not.toBe(memberAlias(u, 'GrpB00000000000001'));
    expect(memberAlias(u, 'GrpA00000000000001')).not.toBe(funnyName(u));
  });
});

describe('F-445 Standard beim Schreiben', () => {
  it('[F-445] Gruppe „Nur Mitglieder“, sonst „Öffentlich“', () => {
    expect(defaultPostVisibility('group')).toBe('members');
    expect(defaultPostVisibility('user')).toBe('public');
    expect(defaultPostVisibility('harbor')).toBe('public');
    expect(defaultPostVisibility('boat')).toBe('public');
  });
});

describe('F-447 Beitrag oder automatischer Eintrag', () => {
  it('[F-447] jede Stream-Art ist eingeordnet; automatisch: Beitritt, Boot, Hafen, Meilenstein; Unbekanntes automatisch', () => {
    expect(Object.keys(STREAM_KIND_CLASS).sort()).toEqual([...ACTIVITY_KINDS].sort());
    expect([...AUTOMATIC_KINDS].sort()).toEqual(['boat', 'harbor', 'member', 'milestone']);
    for (const k of ['voyage', 'photos', 'post', 'logbook']) expect(isAutomaticKind(k), k).toBe(false);
    expect(isAutomaticKind('leave')).toBe(true);
  });
});

describe('F-448 F-449 shouldNotify – jede Kombination aus Stufe × Ereignis', () => {
  // Erwartung je Stufe: [Beitrag, wichtig, automatisch, direkt]
  const table: Record<string, [boolean, boolean, boolean, boolean]> = {
    all: [true, true, false, true],
    important: [false, true, false, true],
    direct: [false, false, false, true],
    muted: [false, false, false, false],
  };

  it('[F-449] Matrix Stufe × Ereignis (direkt/nicht direkt)', () => {
    for (const level of NOTIFY_LEVELS) {
      const [post, important, automatic, direct] = table[level];
      expect(shouldNotify(level, 'post'), `${level}/post`).toBe(post);
      expect(shouldNotify(level, 'important'), `${level}/important`).toBe(important);
      expect(shouldNotify(level, 'automatic'), `${level}/automatic`).toBe(automatic);
      expect(shouldNotify(level, 'post', true), `${level}/direct`).toBe(direct);
      expect(shouldNotify(level, 'important', true), `${level}/direct-important`).toBe(direct);
    }
    // unbekannte Stufe = Standard „Wichtiges“
    expect(shouldNotify('laut', 'post')).toBe(false);
    expect(shouldNotify('laut', 'important')).toBe(true);
    expect(DEFAULT_NOTIFY_LEVEL).toBe('important');
    expect(FOLLOW_DEFAULT_LEVEL).toBe('direct');
  });

  it('[F-448] automatische Einträge benachrichtigen in keiner Stufe – auch nicht als „direkt“', () => {
    for (const level of NOTIFY_LEVELS) {
      expect(shouldNotify(level, 'automatic')).toBe(false);
      expect(shouldNotify(level, 'automatic', true)).toBe(false);
    }
    expect(notifyEventOf('text')).toBe('post');
    expect(notifyEventOf('poll')).toBe('important');
    expect(notifyEventOf('event')).toBe('important');
    expect(notifyEventOf('text', true)).toBe('important');
  });

  it('[F-449] SQL-Baustein listet genau die Stufen der Domain-Regel (eine Regel)', () => {
    for (const event of NOTIFY_EVENTS) {
      for (const direct of [false, true]) {
        const sql = notifyLevelSql(event, direct, 'm.notify_level');
        const allowed = levelsNotifying(event, direct);
        if (!allowed.length) {
          expect(sql).toBe('0');
          continue;
        }
        const list = /\) IN \(([^)]*)\)$/.exec(sql)![1];
        const listed = [...list.matchAll(/'(all|important|direct|muted)'/g)].map((m) => m[1]);
        for (const l of NOTIFY_LEVELS) expect(listed.includes(l), `${event}/${direct}/${l}`).toBe(shouldNotify(l, event, direct));
      }
    }
    expect(effectiveLevelSql('m.notify_level')).toContain(`'${DEFAULT_NOTIFY_LEVEL}'`);
    expect(followLevelSql('f')).toContain(`'${FOLLOW_DEFAULT_LEVEL}'`);
  });

  it('[F-449] Voreinstellung aus notify_prefs: nur all/important/direct, sonst Standard', () => {
    expect(parseDefaultLevel('{"level":"all"}')).toBe('all');
    expect(parseDefaultLevel('{"level":"muted"}')).toBe('important');
    expect(parseDefaultLevel('kaputt')).toBe('important');
    expect(parseDefaultLevel(null)).toBe('important');
  });
});
