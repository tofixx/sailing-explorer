// @vitest-environment happy-dom
// Funktionale Tests der Einladungs-Oberfläche (Konzept 10.7): Einladungsdialog, Crew-Panel, Admins im Konto und
// „Mitgesegelt“ auf der Profilseite. Die Komponenten zeigen nur an und melden Absichten als Events.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-invite-dialog';
import '../../src/components/sx-crew';
import '../../src/components/sx-account-dialog';
import '../../src/components/sx-profile-page';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const DAY = 86_400_000;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const button = (el: LitEl, label: RegExp) =>
  [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;

let cleanups: Array<() => void> = [];
function listen(name: string) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  document.addEventListener(name, fn);
  cleanups.push(() => document.removeEventListener(name, fn));
  return got;
}
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------- Einladungsdialog

describe('sx-invite-dialog', () => {
  const peek = (over: Record<string, unknown> = {}) => ({
    kind: 'boat_admin', target: 'Albatros', inviter: 'Anna', bound: true, expiresAt: Date.now() + 7 * DAY,
    emailMatches: true, isOwner: false, alreadyMember: false, ...over,
  });

  it('[F-138] zeigt Einladenden, Ziel, Rechte und Gültigkeit; „Annehmen“ meldet sx-invite-accept', async () => {
    const accepted = listen('sx-invite-accept');
    const el = await mount('sx-invite-dialog', { open: true, state: 'ready', peek: peek(), signedIn: true, userEmail: 'anna@example.org' });
    const t = text(el);
    expect(t).toContain('Anna lädt dich ein, das Boot „Albatros“ mitzuverwalten.');
    expect(t).toContain('Löschen und weitere Admins einladen kann nur der Eigner');
    expect(t).toContain('gilt nur für die eingeladene E-Mail-Adresse');
    button(el, /Annehmen/)!.click();
    expect(accepted).toHaveLength(1);
  });

  it('[F-138] nicht angemeldet: statt „Annehmen“ nur „Anmelden“ (sx-invite-login)', async () => {
    const logins = listen('sx-invite-login');
    const el = await mount('sx-invite-dialog', { open: true, state: 'ready', peek: peek({ kind: 'crew', target: 'Rügen rund', emailMatches: null }), signedIn: false });
    expect(text(el)).toContain('in die Crew des Törns „Rügen rund“');
    expect(text(el)).toContain('Solange der Törn öffentlich ist');
    expect(button(el, /Annehmen/)).toBeUndefined();
    button(el, /Anmelden/)!.click();
    expect(logins).toHaveLength(1);
  });

  it('[F-138] falsches Konto: Hinweis ohne die eingeladene Adresse, kein „Annehmen“', async () => {
    const el = await mount('sx-invite-dialog', { open: true, state: 'ready', peek: peek({ emailMatches: false }), signedIn: true, userEmail: 'bob@example.org' });
    expect(text(el)).toContain('Diese Einladung gilt für eine andere E-Mail-Adresse. Du bist als bob@example.org angemeldet.');
    expect(button(el, /Annehmen/)).toBeUndefined();
    expect(button(el, /Mit dieser Adresse anmelden/)).toBeDefined();
  });

  it('[F-138] eigene Einladung und schon Mitglied: nur Hinweis', async () => {
    const own = await mount('sx-invite-dialog', { open: true, state: 'ready', peek: peek({ isOwner: true }), signedIn: true });
    expect(text(own)).toContain('Du bist der Eigner dieses Boots.');
    expect(button(own, /Annehmen/)).toBeUndefined();
    const member = await mount('sx-invite-dialog', { open: true, state: 'ready', peek: peek({ alreadyMember: true }), signedIn: true });
    expect(text(member)).toContain('Du bist schon dabei.');
  });

  it('[F-138] Fehler beim Annehmen erscheint im Dialog, „Annehmen“ bleibt möglich', async () => {
    const el = await mount('sx-invite-dialog', {
      open: true, state: 'ready', peek: peek({ kind: 'crew', bound: false, emailMatches: null }), signedIn: true,
      error: 'Die Crew dieses Törns ist voll.', errorCode: 'quota',
    });
    expect(el.shadowRoot.querySelector('[role="alert"]')!.textContent).toContain('voll');
    expect(button(el, /Annehmen/)).toBeDefined();
  });

  it('[F-138] angenommen: Crew auf nicht öffentlichem Törn ohne Link, mit Hinweis; Boot mit Link zur Bootsseite', async () => {
    const crew = await mount('sx-invite-dialog', { open: true, state: 'done', peek: peek({ kind: 'crew' }), result: { kind: 'crew', path: null, target: 'Rügen', already: false } });
    expect(text(crew)).toMatch(/Du bist jetzt in der Crew von\s*„Rügen“/);
    expect(text(crew)).toContain('gerade nicht öffentlich');
    expect(crew.shadowRoot.querySelector('a[href]')).toBeNull();
    const boat = await mount('sx-invite-dialog', { open: true, state: 'done', peek: peek(), result: { kind: 'boat_admin', path: '/b/B1', target: 'Albatros', already: false } });
    expect(boat.shadowRoot.querySelector('a')!.getAttribute('href')).toBe('/b/B1');
  });

  it('[F-203] Freundes-Einladung: eigener Text vor und nach dem Annehmen, Link zum Profil', async () => {
    const el = await mount('sx-invite-dialog', { open: true, state: 'ready', peek: peek({ kind: 'friend', target: null, bound: false, emailMatches: null }), signedIn: true, userEmail: 'b@example.org' });
    expect(text(el)).toContain('Anna lädt dich zu Sail Explorer ein.');
    expect(text(el)).toContain('folgt ihr einander');
    expect(text(el)).not.toContain('Boot');
    const done = await mount('sx-invite-dialog', { open: true, state: 'done', peek: peek({ kind: 'friend' }), result: { kind: 'friend', path: '/u/anna', target: 'Anna', already: false } });
    expect(text(done)).toContain('Ihr folgt euch jetzt: Anna');
    expect(done.shadowRoot.querySelector('a[href="/u/anna"]')!.textContent).toContain('Profil ansehen');
  });

  it('[F-201] Gruppeneinladung, die zur Anfrage wurde: „Beitrittsanfrage gestellt“ statt „Mitglied“', async () => {
    const el = await mount('sx-invite-dialog', { open: true, state: 'done', peek: peek({ kind: 'group', groupKind: 'team' }), result: { kind: 'group', path: '/g/crew', target: 'Crew', already: false, requested: true } });
    expect(text(el)).toContain('Deine Beitrittsanfrage an „Crew“ ist gestellt');
    expect(text(el)).not.toContain('Mitglied von');
  });

  it('[F-138] Fremdtext (Namen) wird escaped dargestellt', async () => {
    const el = await mount('sx-invite-dialog', { open: true, state: 'ready', peek: peek({ inviter: '<img src=x onerror=alert(1)>', target: '<b>X</b>' }), signedIn: true });
    expect(el.shadowRoot.querySelector('img')).toBeNull();
    expect(text(el)).toContain('<img src=x onerror=alert(1)>');
  });
});

// ---------------------------------------------------------------- Crew-Panel

describe('sx-crew', () => {
  const crew = (over: Record<string, unknown> = {}) => ({ members: [], others: 0, isOwner: false, isCrew: false, invites: [], ...over });

  it('[F-139] Besucher: Namen mit Profil-Link, „+ n weitere“, keine Verwaltung', async () => {
    const el = await mount('sx-crew', { crew: crew({ members: [{ id: null, handle: 'mats', displayName: 'Mats' }], others: 2 }) });
    expect(el.shadowRoot.querySelector('a')!.getAttribute('href')).toBe('/u/mats');
    expect(text(el)).toContain('+ 2 weitere Personen ohne öffentliches Profil');
    expect(button(el, /Einladungslink|Entfernen|Mich aus/)).toBeUndefined();
    expect(el.shadowRoot.querySelector('form')).toBeNull();
  });

  it('[F-134] Besucher: Name ohne öffentliches Profil ist anklickbar und zeigt den Hinweis „nicht öffentlich“ statt eines Links', async () => {
    const el = await mount('sx-crew', { crew: crew({ members: [{ id: null, handle: null, displayName: 'Mutige Krabbe' }] }) });
    expect(el.shadowRoot.querySelector('a')).toBeNull();
    button(el, /Mutige Krabbe/)!.click();
    await el.updateComplete;
    expect(text(el)).toContain('Profil ist nicht öffentlich');
    button(el, /Mutige Krabbe/)!.click();
    await el.updateComplete;
    expect(text(el)).not.toContain('Profil ist nicht öffentlich');
  });

  it('[F-135] Crew-Mitglied: „Mich aus der Crew entfernen“ mit Bestätigung → sx-crew-leave', async () => {
    const leave = listen('sx-crew-leave');
    const el = await mount('sx-crew', { crew: crew({ isCrew: true, others: 1 }) });
    button(el, /Mich aus der Crew entfernen/)!.click();
    await el.updateComplete;
    expect(leave).toEqual([]);
    expect(text(el)).toContain('Dich aus der Crew dieses Törns entfernen?');
    button(el, /Ja, entfernen/)!.click();
    expect(leave).toHaveLength(1);
  });

  it('[F-133] Eigentümer: Einladungslink erzeugen, per E-Mail einladen, offene Einladungen zurückziehen', async () => {
    const invites = listen('sx-crew-invite');
    const revokes = listen('sx-invite-revoke');
    const el = await mount('sx-crew', {
      isOwner: true, visibility: 'unlisted',
      crew: crew({ isOwner: true, invites: [
        { id: 'I1', email: 'mate@example.org', invitee: null, usesLeft: 1, createdAt: 0, expiresAt: Date.now() + DAY },
        { id: 'I2', email: null, invitee: null, usesLeft: 28, createdAt: 0, expiresAt: Date.now() + DAY },
        { id: 'I3', email: null, invitee: { handle: 'mats', displayName: 'Mats' }, usesLeft: 1, createdAt: 0, expiresAt: Date.now() + DAY },
      ] }),
    });
    expect(text(el)).toContain('Die Crew sehen andere erst, wenn der Törn öffentlich ist.');
    expect(text(el)).toContain('Einladungslink · noch 28×');
    expect(text(el)).toContain('Mats (@mats)'); // per Profilname eingeladen: Name statt Adresse
    button(el, /Einladungslink erzeugen/)!.click();
    const input = el.shadowRoot.querySelector('form input') as HTMLInputElement;
    const submit = (v: string) => {
      input.value = v;
      el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    submit(' mate2@example.org ');
    submit('@mats');
    submit('anna-k');
    expect(invites).toEqual([{ to: null, role: 'crew' }, { to: { email: 'mate2@example.org' }, role: 'crew' }, { to: { handle: 'mats' }, role: 'crew' }, { to: { handle: 'anna-k' }, role: 'crew' }]);
    expect(text(el)).toContain('Per E-Mail erreichst du neue und bestehende Konten');
    button(el, /Einladung zurückziehen: mate@example.org/)!.click();
    expect(revokes).toEqual([{ id: 'I1', scope: 'crew' }]);
  });

  it('[F-133] neuer Einladungslink wird einmal angezeigt und lässt sich kopieren', async () => {
    const copies = listen('sx-invite-copy');
    const link = 'http://localhost/einladung#token=' + 'b'.repeat(43);
    const el = await mount('sx-crew', { isOwner: true, crew: crew({ isOwner: true }), newLink: link });
    expect((el.shadowRoot.querySelector('input[readonly]') as HTMLInputElement).value).toBe(link);
    expect(text(el)).toContain('wird nur jetzt angezeigt');
    expect(button(el, /Einladungslink erzeugen/)).toBeUndefined();
    button(el, /Kopieren/)!.click();
    expect(copies).toEqual([link]);
  });

  it('[F-135] Eigentümer entfernt Mitglieder nach Bestätigung (sx-crew-remove)', async () => {
    const removes = listen('sx-crew-remove');
    const el = await mount('sx-crew', { isOwner: true, crew: crew({ isOwner: true, members: [{ id: 'U1', handle: null, displayName: 'Privat' }] }) });
    expect(el.shadowRoot.querySelector('a')).toBeNull(); // privates Profil: kein Link
    button(el, /Aus der Crew entfernen: Privat/)!.click();
    await el.updateComplete;
    button(el, /Ja, entfernen/)!.click();
    expect(removes).toEqual([{ userId: 'U1' }]);
  });
});

describe('sx-crew: Rollen und Bestätigung (Konzept 15)', () => {
  const crew = (over: Record<string, unknown> = {}) => ({ members: [], others: 0, isOwner: false, isCrew: false, isSkipper: false, ownerRole: null, ownerConfirmed: null, me: null, invites: [], ...over });
  const select = (el: LitEl, label: RegExp) => [...el.shadowRoot.querySelectorAll('select')].find((s) => label.test(s.getAttribute('aria-label') ?? '')) as HTMLSelectElement;
  const pick = (s: HTMLSelectElement, v: string) => {
    s.value = v;
    s.dispatchEvent(new Event('change'));
  };

  it('[F-275] Eigentümer: eigene Rolle, Rollen der Crew und Rolle für Einladungen wählen', async () => {
    const roles = listen('sx-crew-role');
    const own = listen('sx-crew-own-role');
    const invites = listen('sx-crew-invite');
    const el = await mount('sx-crew', { isOwner: true, crew: crew({ isOwner: true, members: [{ id: 'U1', handle: null, displayName: 'Tom', role: 'crew', confirmed: null }] }) });
    pick(select(el, /Deine Rolle/), 'skipper');
    await el.updateComplete;
    expect(own).toEqual([]); // Skipper erst nach Rückfrage – Bestätigungen fallen weg
    button(el, /Ja, eintragen/)!.click();
    pick(select(el, /Rolle von Tom/), 'co');
    const forInvites = select(el, /Rolle für Einladungen/);
    expect([...forInvites.options].map((o) => o.value)).toEqual(['co', 'crew', 'guest']); // nie Skipper
    pick(forInvites, 'guest');
    button(el, /Einladungslink erzeugen/)!.click();
    expect(own).toEqual([{ role: 'skipper' }]);
    expect(roles).toEqual([{ userId: 'U1', role: 'co' }]);
    expect(invites).toEqual([{ to: null, role: 'guest' }]);
  });

  it('[F-276] Skipper bestätigt einzeln und alle; Bestätigte zeigen „bestätigt von …“, Hinweis auf Unterschrift', async () => {
    const confirms = listen('sx-crew-confirm');
    const unconfirms = listen('sx-crew-unconfirm');
    const el = await mount('sx-crew', {
      crew: crew({ isCrew: true, isSkipper: true, ownerRole: 'co', me: { role: 'skipper', confirmed: null }, members: [
        { id: 'U1', handle: null, displayName: 'Tom', role: 'co', confirmed: { at: Date.now(), by: 'Lisa' } },
        { id: 'U2', handle: null, displayName: 'Mara', role: 'guest', confirmed: null },
      ] }),
    });
    expect(text(el)).toContain('bestätigt von Lisa');
    expect(text(el)).toContain('ersetzt keine Unterschrift');
    button(el, /bestätigen: Mara/)!.click();
    button(el, /zurückziehen: Tom/)!.click();
    button(el, /bestätigen: Eigentümer/)!.click();
    button(el, /Alle bestätigen/)!.click();
    expect(confirms).toEqual([{ userIds: ['U2'], owner: false }, { userIds: [], owner: true }, { userIds: 'all', owner: true }]);
    expect(unconfirms).toEqual([{ userId: 'U1' }]);
  });

  it('[F-275] Crew-Mitglied wählt die eigene Rolle ohne Skipper; Besucher sehen Rollen nur als Text', async () => {
    const roles = listen('sx-crew-role');
    const el = await mount('sx-crew', { crew: crew({ isCrew: true, me: { role: 'crew', confirmed: null } }) });
    const mine = select(el, /Deine Rolle/);
    expect([...mine.options].map((o) => o.value)).toEqual(['co', 'crew', 'guest']);
    pick(mine, 'guest');
    expect(roles).toEqual([{ userId: 'me', role: 'guest' }]);
    const visitor = await mount('sx-crew', { crew: crew({ members: [{ id: null, handle: 'mats', displayName: 'Mats', role: 'co', confirmed: null }] }) });
    expect(visitor.shadowRoot.querySelector('select')).toBeNull();
    expect(text(visitor)).toContain('Co-Skipper:in');
    expect(button(visitor, /Bestätigen/)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- Konto: Boots-Admins

describe('sx-account-dialog: Admins', () => {
  const USER = { id: 'U1234567890abcdefg', email: 'skipper@example.org' };
  const boat = (role: 'owner' | 'admin') => ({
    id: 'B1234567890abcdefg', name: 'Albatros', boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '',
    visibility: 'public', shareKey: null, link: '/b/B1234567890abcdefg', createdAt: 0, updatedAt: 0, owner: null, role,
  });

  async function openAdmins(role: 'owner' | 'admin') {
    const loads = listen('sx-boat-admins');
    const el = await mount('sx-account-dialog', { open: true, tab: 'boats', user: USER, boats: [boat(role)], profile: null });
    button(el, /^Admins: Albatros/)!.click();
    await el.updateComplete;
    expect(loads).toEqual(['B1234567890abcdefg']);
    expect(text(el)).toContain('Lade Admins');
    return el;
  }

  it('[F-130] Eigner: Admins mit Namen (nie Adresse), offene Einladungen, Einladen per E-Mail', async () => {
    const invites = listen('sx-boat-admin-invite');
    const revokes = listen('sx-invite-revoke');
    const el = await openAdmins('owner');
    el.admins = {
      boatId: 'B1234567890abcdefg',
      data: {
        role: 'owner',
        admins: [{ id: 'A1', displayName: 'Mats', handle: 'mats', isSelf: false, createdAt: 0 }, { id: 'A2', displayName: 'Munteres Seepferdchen', handle: null, isSelf: false, createdAt: 0 }],
        invites: [{ id: 'I1', email: 'neu@example.org', invitee: null, usesLeft: 1, createdAt: 0, expiresAt: Date.now() + DAY }],
      },
    };
    await el.updateComplete;
    const t = text(el);
    expect(t).toContain('Mats');
    expect(t).toContain('Munteres Seepferdchen');
    expect(t).toContain('neu@example.org');
    const form = el.shadowRoot.querySelector(`#admins-B1234567890abcdefg form`) as HTMLFormElement;
    (form.querySelector('input') as HTMLInputElement).value = 'crew@example.org';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(invites).toEqual([{ boatId: 'B1234567890abcdefg', to: { email: 'crew@example.org' } }]);
    button(el, /Einladung zurückziehen: neu@example.org/)!.click();
    expect(revokes).toEqual([{ id: 'I1', scope: 'boat', boatId: 'B1234567890abcdefg' }]);
  });

  it('[F-132] Eigner entfernt einen Admin nach Bestätigung (sx-boat-admin-remove)', async () => {
    const removes = listen('sx-boat-admin-remove');
    const el = await openAdmins('owner');
    el.admins = { boatId: 'B1234567890abcdefg', data: { role: 'owner', admins: [{ id: 'A1', displayName: 'Mats', handle: null, isSelf: false, createdAt: 0 }], invites: [] } };
    await el.updateComplete;
    button(el, /Admin entfernen: Mats/)!.click();
    await el.updateComplete;
    button(el, /^ *Entfernen/)!.click();
    expect(removes).toEqual([{ boatId: 'B1234567890abcdefg', userId: 'A1' }]);
  });

  it('[F-132] Admin: keine Adressen, kein Einladen, „Boot verlassen“ mit Bestätigung (sx-boat-leave)', async () => {
    const leaves = listen('sx-boat-leave');
    const el = await openAdmins('admin');
    el.admins = { boatId: 'B1234567890abcdefg', data: { role: 'admin', admins: [{ id: 'U1', displayName: 'Ich', handle: null, isSelf: true, createdAt: 0 }], invites: [] } };
    await el.updateComplete;
    expect(text(el)).toContain('Ich (du)');
    expect(el.shadowRoot.querySelector('#admins-B1234567890abcdefg form')).toBeNull();
    button(el, /Boot verlassen/)!.click();
    await el.updateComplete;
    expect(leaves).toEqual([]);
    button(el, /Ja, verlassen/)!.click();
    expect(leaves).toEqual(['B1234567890abcdefg']);
  });
});

describe('sx-account-dialog: Einladungen an dich', () => {
  it('[F-141] Posteingang zeigt Einladungen mit Namen des Einladenden; Annehmen/Ablehnen melden die ID', async () => {
    const accepts = listen('sx-my-invite-accept');
    const declines = listen('sx-my-invite-decline');
    const el = await mount('sx-account-dialog', {
      open: true, tab: 'shares', user: { id: 'U1', email: 'me@example.org' }, profile: null,
      myInvites: [
        { id: 'M1', kind: 'boat_admin', target: 'Albatros', inviter: 'Anna', expiresAt: Date.now() + DAY },
        { id: 'M2', kind: 'crew', target: 'Rügen rund', inviter: 'Verwegener Klabautermann', expiresAt: Date.now() + DAY },
      ],
    });
    const t = text(el);
    expect(t).toContain('Einladungen an dich');
    expect(t).toContain('Anna lädt dich ein, das Boot „Albatros“ mitzuverwalten');
    expect(t).toContain('Verwegener Klabautermann lädt dich ein, in die Crew des Törns „Rügen rund“');
    button(el, /Annehmen: Albatros/)!.click();
    button(el, /Ablehnen: Rügen rund/)!.click();
    expect(accepts).toEqual(['M1']);
    expect(declines).toEqual(['M2']);
  });

  it('[F-141] ohne offene Einladungen kein Posteingang', async () => {
    const el = await mount('sx-account-dialog', { open: true, tab: 'shares', user: { id: 'U1', email: 'me@example.org' }, profile: null });
    expect(text(el)).not.toContain('Einladungen an dich');
  });
});

// ---------------------------------------------------------------- Profilseite

describe('sx-profile-page: Mitgesegelt', () => {
  const voyage = (id: string, title: string) => ({ id, title, summary: '', distNm: 12, startedAt: Date.now(), createdAt: Date.now(), boat: null });
  const profile = { handle: 'mats', displayName: 'Mats', bio: '', visibility: 'public', isSelf: false };

  it('[F-134] Abschnitt „Mitgesegelt“ listet Crew-Törns, nur wenn es welche gibt', async () => {
    const el = await mount('sx-profile-page', {
      data: { kind: 'profile', profile, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [], crewVoyages: [voyage('S1', 'Rügen rund')] },
    });
    expect(text(el)).toContain('Mitgesegelt');
    expect([...el.shadowRoot.querySelectorAll('a.card')].map((a) => a.getAttribute('href'))).toEqual(['/s/S1']);
    const none = await mount('sx-profile-page', { data: { kind: 'profile', profile, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(text(none)).not.toContain('Mitgesegelt');
  });
});
