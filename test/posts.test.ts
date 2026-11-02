// Reine Regeln der Beiträge (Konzept 21, src/domain/posts.ts) und „Ins Fahrtenbuch“ (src/domain/logbook.ts).
import { describe, expect, it } from 'vitest';
import {
  canChoosePostVisibility, canSeePost, canWriteInGroup, defaultPostBy, effectivePostBy, effectivePostVisibility, parseProfilePreview,
  postVisibilityChoices, previewLabel, previewParam, reachFor, shareKindOf, whereLabel, whoSeesLabel, type PostAccess,
} from '../src/domain/posts';
import { countsInLogbook, initialLogState, isLogState, logStateOn } from '../src/domain/logbook';
import {
  REACHES, canWriteInHarbor, canWriteOnBoat, channelKey, channelName, channelPath, firstLine, reachChainText, reachChoices, reachCovers,
  reachOptions, reachTargets, widensAudience, type ReachChain,
} from '../src/domain/posts';
import { isAppPath } from '../src/domain/visibility';
import { reachAtLeastSql } from '../worker/reach-sql';
import { parseRoute } from '../src/services/url-state';
import { anchorPost } from '../src/controllers/post-link';

const text = (o: Partial<PostAccess> = {}): PostAccess => ({ visibility: 'public', channel: 'group', hidden: false, authorSuspended: false, authorPublic: true, ...o });

describe('F-400 Arten und Heimatverlauf', () => {
  it('[F-400] Törn-Arten aus der Quelle; Reichweite nicht öffentlicher Beiträge bleibt „nur hier“', () => {
    expect(shareKindOf('manual')).toBe('logbook');
    expect(shareKindOf('gpx')).toBe('voyage');
    expect(shareKindOf(undefined)).toBe('voyage');
    expect(reachFor('members', 'all')).toBe('here');
    expect(reachFor('private', 'all')).toBe('here');
    expect(reachFor('public')).toBe('here');
    expect(reachFor('public', 'all')).toBe('all');
  });
});

describe('F-402 Sichtbarkeit beim Lesen (fail closed)', () => {
  it('[F-402] effektiv = min(Beitrag, Verlauf); geschlossene Gruppe = nur Mitglieder', () => {
    expect(effectivePostVisibility('public', 'public')).toBe('public');
    expect(effectivePostVisibility('public', 'unlisted')).toBe('unlisted');
    expect(effectivePostVisibility('public', 'private')).toBe('members');
    expect(effectivePostVisibility('members', 'unlisted')).toBe('members');
    expect(effectivePostVisibility('private', null)).toBe('private');
  });

  it('[F-402] Stufen je Verlauf: Gruppe öffentlich/Mitglieder/Link, Profil öffentlich/Link/Nur ich; „Nur Mitglieder“ kostenlos, „Nur ich“ für Unterstützer', () => {
    expect(postVisibilityChoices('group')).toEqual(['public', 'members', 'unlisted']);
    expect(postVisibilityChoices('user')).toEqual(['public', 'unlisted', 'private']);
    expect(canChoosePostVisibility('members', false)).toBe(true);
    expect(canChoosePostVisibility('private', false)).toBe(false);
    expect(canChoosePostVisibility('private', true)).toBe(true);
  });

  it('[F-402] Gruppe: sichtbar nur mit sichtbarer Gruppe, „Nur Mitglieder“ nur für Mitglieder; Autor:in sieht immer', () => {
    expect(canSeePost(text(), { isAuthor: false, channelVisible: true })).toBe(true);
    expect(canSeePost(text(), { isAuthor: false, channelVisible: false })).toBe(false);
    expect(canSeePost(text({ visibility: 'members' }), { isAuthor: false, channelVisible: true, isMember: false })).toBe(false);
    expect(canSeePost(text({ visibility: 'members' }), { isAuthor: false, channelVisible: true, isMember: true })).toBe(true);
    expect(canSeePost(text({ visibility: 'private' }), { isAuthor: true })).toBe(true);
  });

  it('[F-402] ausgeblendet, gesperrt, „Nur mit Link“ und „Nur ich“ für andere unsichtbar; Profil nur bei öffentlichem Profil', () => {
    expect(canSeePost(text({ hidden: true }), { isAuthor: false, channelVisible: true })).toBe(false);
    expect(canSeePost(text({ hidden: true }), { isAuthor: false, channelVisible: true, canModerate: true })).toBe(true);
    expect(canSeePost(text({ authorSuspended: true }), { isAuthor: false, channelVisible: true })).toBe(false);
    expect(canSeePost(text({ visibility: 'unlisted' }), { isAuthor: false, channelVisible: true, isMember: true })).toBe(false);
    expect(canSeePost(text({ channel: 'user' }), { isAuthor: false })).toBe(true);
    expect(canSeePost(text({ channel: 'user', authorPublic: false }), { isAuthor: false })).toBe(false);
    expect(canSeePost(text({ channel: 'user', visibility: 'private' }), { isAuthor: false })).toBe(false);
  });
});

describe('F-421 Schreibrecht je Gruppe', () => {
  it('[F-421] Standard Verein nur Admins, Team alle Mitglieder; Unbekanntes zählt als Standard', () => {
    expect(defaultPostBy('club')).toBe('admins');
    expect(defaultPostBy('team')).toBe('members');
    expect(effectivePostBy('club', null)).toBe('admins');
    expect(effectivePostBy('club', 'members')).toBe('members');
    expect(effectivePostBy('team', 'kaputt')).toBe('members');
  });

  it('[F-421] Eigner/Admins immer, Mitglieder nur bei „alle Mitglieder“, Nicht-Mitglieder nie', () => {
    expect(canWriteInGroup('admin', 'admins')).toBe(true);
    expect(canWriteInGroup('owner', 'admins')).toBe(true);
    expect(canWriteInGroup('member', 'admins')).toBe(false);
    expect(canWriteInGroup('member', 'members')).toBe(true);
    expect(canWriteInGroup(null, 'members')).toBe(false);
  });
});

describe('F-401 „Wer sieht es“ und „Wo steht es“', () => {
  it('[F-401] getrennte Texte für Sichtbarkeit und Verlauf', () => {
    expect(whoSeesLabel('public')).toBe('Öffentlich');
    expect(whoSeesLabel('members', 'PYC')).toBe('Nur Mitglieder von PYC');
    expect(whoSeesLabel('unlisted')).toBe('Nur mit Link');
    expect(whoSeesLabel('private')).toBe('Nur ich');
    expect(whereLabel({ kind: 'user' })).toBe('in deinem Profil');
    expect(whereLabel({ kind: 'user' }, [{ name: 'Mittwochsregatta' }, { name: 'PYC' }])).toBe('in deinem Profil und in Mittwochsregatta, PYC');
    expect(whereLabel({ kind: 'group', slug: 'x', name: 'Regatta', groupKind: 'team' })).toBe('in Team Regatta');
  });
});

describe('F-422 Ins Fahrtenbuch', () => {
  it('[F-422] eigene Einträge bestätigt, GPX Vorschlag, ausgeschlossene zählen nie; an schaltet passend zurück', () => {
    expect(initialLogState('manual')).toBe('confirmed');
    expect(initialLogState('gpx')).toBe('suggested');
    expect(initialLogState('gpx', true)).toBe('excluded');
    expect(countsInLogbook('suggested')).toBe(true);
    expect(countsInLogbook('confirmed')).toBe(true);
    expect(countsInLogbook('excluded')).toBe(false);
    expect(logStateOn('gpx')).toBe('suggested');
    expect(logStateOn('manual')).toBe('confirmed');
    expect(isLogState('maybe')).toBe(false);
  });
});

describe('F-423 Ansehen als …', () => {
  it('[F-423] Parameter hin und zurück; Unbekanntes ist keine Vorschau', () => {
    expect(parseProfilePreview('public')).toEqual({ as: 'public' });
    expect(parseProfilePreview('harbor')).toEqual({ as: 'harbor' });
    expect(parseProfilePreview('group:Grp000000000001')).toEqual({ as: 'group', groupId: 'Grp000000000001' });
    expect(parseProfilePreview('group:x')).toBeNull();
    expect(parseProfilePreview('admin')).toBeNull();
    expect(previewParam({ as: 'group', groupId: 'Grp000000000001' })).toBe('group:Grp000000000001');
    expect(previewLabel({ as: 'group', groupId: 'G1' }, { harbor: null, groups: [{ id: 'G1', name: 'PYC', kind: 'club' }] })).toBe('Mitglied von PYC');
    expect(previewLabel({ as: 'harbor' }, { harbor: { name: 'Potsdam' }, groups: [] })).toBe('Jemand aus deinem Hafen Potsdam');
  });
});

const team: ReachChain = { home: 'Mittwochsregatta', club: { id: 'C1', name: 'PYC' }, harbor: { id: 'H1', name: 'Potsdam' }, open: true };

describe('F-409 Ausbreitung nach oben, begrenzt durch „Sichtbar bis“', () => {
  it('[F-409] nur Stufen, die es für den Verlauf gibt; nicht öffentliche Verläufe nur „nur hier“', () => {
    expect(reachChoices(team)).toEqual(['here', 'club', 'harbor', 'all']);
    expect(reachChoices({ ...team, club: null })).toEqual(['here', 'harbor', 'all']);
    expect(reachChoices({ home: 'Hafen Potsdam', club: null, harbor: null, open: true })).toEqual(['here', 'all']);
    expect(reachChoices({ ...team, open: false })).toEqual(['here']);
  });

  it('[F-409] Kette als Text und Ziele je Stufe (Verein als Gruppe, Hafen; Community ohne Ziel)', () => {
    expect(reachChainText(team, 'all')).toBe('Mittwochsregatta → PYC → Hafen Potsdam → überall');
    expect(reachChainText(team, 'club')).toBe('Mittwochsregatta → PYC');
    expect(reachChainText(team, 'here')).toBe('nur Mittwochsregatta');
    expect(reachOptions(team).map((o) => o.label)).toEqual(['Nur hier', 'Bis Verein', 'Bis Hafen', 'Überall']);
    expect(reachTargets(team, 'here')).toEqual([]);
    expect(reachTargets(team, 'club')).toEqual([{ kind: 'group', id: 'C1' }]);
    expect(reachTargets(team, 'all')).toEqual([{ kind: 'group', id: 'C1' }, { kind: 'harbor', id: 'H1' }]);
    expect(reachTargets({ ...team, open: false }, 'all')).toEqual([]);
  });

  it('[F-409] SQL-Fragment und reachCovers stimmen für alle 4×4 Kombinationen überein (eine Regel)', () => {
    for (const level of REACHES) {
      const sql = reachAtLeastSql('?1', level);
      const listed = [...sql.matchAll(/'(here|club|harbor|all)'/g)].map((m) => m[1]);
      for (const reach of REACHES) expect(listed.includes(reach), `${reach} ≥ ${level}`).toBe(reachCovers(reach, level));
    }
    // ohne Post-Zeile (Altbestand) gilt „überall“
    expect(reachAtLeastSql('s.id', 'harbor')).toContain(`COALESCE((SELECT reach FROM posts WHERE id = s.id), 'all')`);
  });
});

describe('F-425 Schreiben im Hafen und am Boot', () => {
  it('[F-425] Hafen: Boot dort, Anleger:in bzw. Vertretung, Moderation; Boot: Eigner und Admins', () => {
    expect(canWriteInHarbor({ hasBoat: true, isCreator: false, isAdmin: false })).toBe(true);
    expect(canWriteInHarbor({ hasBoat: false, isCreator: true, isAdmin: false })).toBe(true);
    expect(canWriteInHarbor({ hasBoat: false, isCreator: false, isAdmin: true })).toBe(true);
    expect(canWriteInHarbor({ hasBoat: false, isCreator: false, isAdmin: false })).toBe(false);
    expect(canWriteOnBoat('owner')).toBe(true);
    expect(canWriteOnBoat('admin')).toBe(true);
    expect(canWriteOnBoat(null)).toBe(false);
  });

  it('[F-425] Sichtbarkeit: Hafen/Boot nur mit sichtbarem Verlauf, „Nur Mitglieder“ gibt es dort nicht', () => {
    expect(postVisibilityChoices('harbor')).toEqual(['public', 'unlisted']);
    expect(postVisibilityChoices('boat')).toEqual(['public', 'unlisted']);
    expect(canSeePost(text({ channel: 'harbor' }), { isAuthor: false, channelVisible: true })).toBe(true);
    expect(canSeePost(text({ channel: 'boat' }), { isAuthor: false, channelVisible: false })).toBe(false);
    expect(canSeePost(text({ channel: 'harbor', visibility: 'members' }), { isAuthor: false, channelVisible: true, isMember: true })).toBe(false);
  });

  it('[F-425] Verläufe: Pfad, Schlüssel und Name', () => {
    const h = { kind: 'harbor' as const, slug: 'potsdam', name: 'Potsdam' };
    const b = { kind: 'boat' as const, id: 'B1', name: 'Möwe' };
    expect(channelPath(h)).toBe('/h/potsdam');
    expect(channelPath(b)).toBe('/b/B1');
    expect(channelPath({ kind: 'user' }, 'anna')).toBe('/u/anna');
    expect(channelPath({ kind: 'user' })).toBeNull();
    expect(channelKey(b)).toBe('boat:B1');
    expect(channelKey(h)).toBe('harbor:potsdam');
    expect(channelName(h)).toBe('Hafen Potsdam');
    expect(channelName({ kind: 'group', slug: 'x', name: 'Regatta', groupKind: 'team' })).toBe('Team Regatta');
    expect(whereLabel(b)).toBe('in Boot Möwe');
  });
});

describe('F-406 Beiträge ohne eigene Seite: /p/<id>', () => {
  it('[F-406] „Nur mit Link“ nur mit Schlüssel; im Profil ohne öffentliches Profil sichtbar, in Gruppen nur mit sichtbarer Gruppe', () => {
    expect(canSeePost(text({ visibility: 'unlisted' }), { isAuthor: false, channelVisible: true, keyOk: true })).toBe(true);
    expect(canSeePost(text({ visibility: 'unlisted' }), { isAuthor: false, channelVisible: false, keyOk: true })).toBe(false);
    expect(canSeePost(text({ channel: 'user', visibility: 'unlisted', authorPublic: false }), { isAuthor: false, keyOk: true })).toBe(true);
    expect(canSeePost(text({ channel: 'user', visibility: 'unlisted' }), { isAuthor: false, keyOk: false })).toBe(false);
  });

  it('[F-406] Adresse, Anker und erste Zeile der Link-Vorschau', () => {
    expect(parseRoute({ pathname: '/p/AbcdefGhijkl12', search: '', hash: '' })).toEqual({ kind: 'post', id: 'AbcdefGhijkl12' });
    expect(parseRoute({ pathname: '/p/AbcdefGhijkl12/abcdefghijklmnopqrstuv', search: '', hash: '' })).toEqual({ kind: 'post', id: 'AbcdefGhijkl12', key: 'abcdefghijklmnopqrstuv' });
    expect(anchorPost('#p-AbcdefGhijkl12')).toBe('AbcdefGhijkl12');
    expect(anchorPost('#fotos')).toBeNull();
    expect(firstLine('\n  Absegeln am Samstag  \nTreffpunkt 10 Uhr')).toBe('Absegeln am Samstag');
    expect(firstLine('x'.repeat(200))).toHaveLength(140);
  });

  it('[F-406] Teilen und Kopieren nur für Pfade der App – auch Hafen (/h/) und Beitrag (/p/)', () => {
    expect(isAppPath('/h/potsdam')).toBe(true);
    expect(isAppPath('/p/AbcdefGhijkl12/abcdefghijklmnopqrstuv')).toBe(true);
    expect(isAppPath('/s/AbcdefGhijkl12')).toBe(true);
    expect(isAppPath('https://evil.example/x')).toBe(false);
    expect(isAppPath('/x/abc')).toBe(false);
    expect(isAppPath('//evil.example')).toBe(false);
  });
});

describe('F-409 Erweitern braucht Schreibrecht', () => {
  it('[F-409] höhere Sichtbarkeit oder höheres „Sichtbar bis“ erweitert; herabsetzen nicht', () => {
    expect(widensAudience({ visibility: 'members', reach: 'here' }, { visibility: 'public', reach: 'here' })).toBe(true);
    expect(widensAudience({ visibility: 'public', reach: 'club' }, { visibility: 'public', reach: 'all' })).toBe(true);
    expect(widensAudience({ visibility: 'public', reach: 'all' }, { visibility: 'public', reach: 'here' })).toBe(false);
    expect(widensAudience({ visibility: 'public', reach: 'all' }, { visibility: 'members', reach: 'here' })).toBe(false);
    expect(widensAudience({ visibility: 'unlisted', reach: 'here' }, { visibility: 'public', reach: 'here' })).toBe(true);
  });
});
