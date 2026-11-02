// Reine Regeln der Beiträge (Konzept 21, src/domain/posts.ts) und „Ins Fahrtenbuch“ (src/domain/logbook.ts).
import { describe, expect, it } from 'vitest';
import {
  canChoosePostVisibility, canSeePost, canWriteInGroup, defaultPostBy, effectivePostBy, effectivePostVisibility, parseProfilePreview,
  postVisibilityChoices, previewLabel, previewParam, reachFor, shareKindOf, whereLabel, whoSeesLabel, type PostAccess,
} from '../src/domain/posts';
import { countsInLogbook, initialLogState, isLogState, logStateOn } from '../src/domain/logbook';

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

  it('[F-402] Stufen je Verlauf: Gruppe öffentlich/Mitglieder, Profil öffentlich/Nur ich; „Nur Mitglieder“ kostenlos, „Nur ich“ für Unterstützer', () => {
    expect(postVisibilityChoices('group')).toEqual(['public', 'members']);
    expect(postVisibilityChoices('user')).toEqual(['public', 'private']);
    expect(canChoosePostVisibility('members', false)).toBe(true);
    expect(canChoosePostVisibility('private', false)).toBe(false);
    expect(canChoosePostVisibility('private', true)).toBe(true);
  });

  it('[F-402] Gruppe: sichtbar nur mit sichtbarer Gruppe, „Nur Mitglieder“ nur für Mitglieder; Autor:in sieht immer', () => {
    expect(canSeePost(text(), { isAuthor: false, groupVisible: true })).toBe(true);
    expect(canSeePost(text(), { isAuthor: false, groupVisible: false })).toBe(false);
    expect(canSeePost(text({ visibility: 'members' }), { isAuthor: false, groupVisible: true, isMember: false })).toBe(false);
    expect(canSeePost(text({ visibility: 'members' }), { isAuthor: false, groupVisible: true, isMember: true })).toBe(true);
    expect(canSeePost(text({ visibility: 'private' }), { isAuthor: true })).toBe(true);
  });

  it('[F-402] ausgeblendet, gesperrt, „Nur mit Link“ und „Nur ich“ für andere unsichtbar; Profil nur bei öffentlichem Profil', () => {
    expect(canSeePost(text({ hidden: true }), { isAuthor: false, groupVisible: true })).toBe(false);
    expect(canSeePost(text({ hidden: true }), { isAuthor: false, groupVisible: true, canModerate: true })).toBe(true);
    expect(canSeePost(text({ authorSuspended: true }), { isAuthor: false, groupVisible: true })).toBe(false);
    expect(canSeePost(text({ visibility: 'unlisted' }), { isAuthor: false, groupVisible: true, isMember: true })).toBe(false);
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
