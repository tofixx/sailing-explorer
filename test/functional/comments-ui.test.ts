// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche für Kommentare & Melden (Konzept 4.3/4.4, F-110 … F-114): Kommentarliste und
// -formular, Eigentümer-Schalter, Melden-Dialog, Einstellungen und Admin-Liste im Konto, Melden auf Profil-/Bootsseite.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-comments';
import '../../src/components/sx-report-dialog';
import '../../src/components/sx-account-dialog';
import '../../src/components/sx-profile-page';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const button = (el: LitEl | ShadowRoot, label: RegExp) => {
  const root = 'shadowRoot' in el ? el.shadowRoot : el;
  return [...root.querySelectorAll('button')].find((b) => label.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLButtonElement | undefined;
};

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

const comment = (over: Record<string, unknown> = {}) => ({
  id: 'C1', body: 'Toller Törn!', createdAt: Date.parse('2026-06-13T10:00:00Z'),
  author: { displayName: 'Anna', handle: 'anna' }, isMine: false, canDelete: false, hidden: false, ...over,
});
const list = (over: Record<string, unknown> = {}) => ({
  mode: 'on', comments: [comment()], canComment: true, block: null, isOwner: false, limits: { maxLength: 1000, maxLinks: 2 }, ...over,
});

// ---------------------------------------------------------------- sx-comments

describe('sx-comments', () => {
  it('[F-110] zeigt Name (Profil-Link nur mit Handle), Zeit und Text; Links klickbar mit rel nofollow ugc noopener noreferrer, nie HTML', async () => {
    const el = await mount('sx-comments', {
      shareId: 'S1',
      data: list({
        comments: [
          comment({ body: 'Fotos: https://example.org/bilder. <img src=x onerror=alert(1)>' }),
          comment({ id: 'C2', author: { displayName: 'Ohne Profil-Link', handle: null } }),
        ],
      }),
    });
    const items = el.shadowRoot.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.who a')!.getAttribute('href')).toBe('/u/anna');
    expect(items[1].querySelector('.who a')).toBeNull();
    const link = items[0].querySelector('.body a')!;
    expect(link.getAttribute('href')).toBe('https://example.org/bilder');
    expect(link.getAttribute('rel')).toBe('nofollow ugc noopener noreferrer');
    expect(el.shadowRoot.querySelector('img')).toBeNull();
    expect(text(el)).toContain('<img src=x onerror=alert(1)>');
  });

  it('[F-110] Formular: Zeichenzähler, zu lang oder zu viele Links sperren das Absenden; Absenden meldet den bereinigten Text', async () => {
    const posted = listen('sx-comment-post');
    const el = await mount('sx-comments', { shareId: 'S1', data: list() });
    const ta = el.shadowRoot.querySelector('textarea')!;
    ta.value = '  Ahoi!  ';
    ta.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('#c-count')!.textContent).toContain('5 / 1000');
    const submit = button(el, /Kommentieren/)!;
    expect(submit.disabled).toBe(false);
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(posted).toEqual([{ body: 'Ahoi!' }]);

    ta.value = 'https://a.de https://b.de https://c.de';
    ta.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(button(el, /Kommentieren/)!.disabled).toBe(true);
    expect(text(el)).toContain('Höchstens 2 Links');
    ta.value = 'x'.repeat(1001);
    ta.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(button(el, /Kommentieren/)!.disabled).toBe(true);
    expect(ta.getAttribute('aria-invalid')).toBe('true');
  });

  it('[F-110] Gründe statt Formular: anmelden, Profil anlegen, gesperrt, abgeschaltet', async () => {
    const login = listen('sx-login');
    const account = listen('sx-account');
    const anon = await mount('sx-comments', { data: list({ canComment: false, block: 'login' }) });
    expect(anon.shadowRoot.querySelector('textarea')).toBeNull();
    button(anon, /Anmelden/)!.click();
    expect(login).toHaveLength(1);
    const noProfile = await mount('sx-comments', { data: list({ canComment: false, block: 'profile' }) });
    button(noProfile, /Profil anlegen/)!.click();
    expect(account).toEqual(['profile']);
    expect(text(await mount('sx-comments', { data: list({ canComment: false, block: 'suspended' }) }))).toContain('gesperrt');
    expect(text(await mount('sx-comments', { data: list({ mode: 'off', canComment: false, block: 'off' }) }))).toContain('abgeschaltet');
  });

  it('[F-111] Löschen mit Bestätigung; Eigentümer stellt Kommentare um; „Törn melden“ nur für andere', async () => {
    const deleted = listen('sx-comment-delete');
    const modes = listen('sx-comments-mode');
    const reports = listen('sx-report');
    const el = await mount('sx-comments', { shareId: 'S1', data: list({ isOwner: true, comments: [comment({ canDelete: true })] }) });
    button(el, /löschen/i)!.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[role="alert"]')!.textContent).toContain('Diesen Kommentar löschen?');
    button(el, /Ja, löschen/)!.click();
    expect(deleted).toEqual([{ id: 'C1' }]);

    const select = el.shadowRoot.querySelector('select')!;
    select.value = 'hidden';
    select.dispatchEvent(new Event('change'));
    expect(modes).toEqual([{ mode: 'hidden' }]);
    expect(button(el, /Törn melden/)).toBeUndefined();

    const visitor = await mount('sx-comments', { shareId: 'S1', data: list() });
    expect(visitor.shadowRoot.querySelector('select')).toBeNull();
    button(visitor, /Kommentar von Anna melden/)!.click();
    button(visitor, /Törn melden/)!.click();
    expect(reports).toEqual([
      { kind: 'comment', id: 'C1', label: 'Kommentar von Anna' },
      { kind: 'share', id: 'S1', label: 'diesen Törn' },
    ]);
  });

  it('[F-114] eigene ausgeblendete Kommentare sind markiert; ausgeblendeter Thread für Besucher mit Hinweis', async () => {
    const own = await mount('sx-comments', { data: list({ comments: [comment({ isMine: true, canDelete: true, hidden: true })] }) });
    expect(text(own)).toContain('ausgeblendet bis zur Prüfung');
    expect(button(own, /melden/i)).toBeUndefined();
    const hidden = await mount('sx-comments', { data: list({ mode: 'hidden', comments: [], canComment: false, block: 'off' }) });
    expect(text(hidden)).toContain('Die Kommentare zu diesem Törn sind ausgeblendet.');
  });
});

// ---------------------------------------------------------------- sx-report-dialog

describe('sx-report-dialog', () => {
  const target = { kind: 'comment', id: 'C1', label: 'Kommentar von Anna' };

  it('[F-114] Grund wählen, optional Anmerkung, Melden meldet beides', async () => {
    const submitted = listen('sx-report-submit');
    const el = await mount('sx-report-dialog', { open: true, target, signedIn: true });
    expect(text(el)).toContain('Kommentar melden');
    expect(text(el)).toContain('Du meldest Kommentar von Anna.');
    expect(button(el, /^\s*Melden/)!.disabled).toBe(true);
    const radios = [...el.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['spam', 'abuse', 'illegal', 'depicted', 'other']);
    radios[3].dispatchEvent(new Event('change'));
    await el.updateComplete;
    el.shadowRoot.querySelector('textarea')!.value = ' Das bin ich ';
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(submitted).toEqual([{ reason: 'depicted', note: 'Das bin ich' }]);
    expect(el.shadowRoot.querySelector('textarea')!.getAttribute('maxlength')).toBe('500');
  });

  it('[F-114] ohne Anmeldung: Anmelden und Kontaktadresse statt Formular; danach Dank', async () => {
    const logins = listen('sx-report-login');
    const el = await mount('sx-report-dialog', { open: true, target, signedIn: false, contact: 'meldung@example.org' });
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    expect(el.shadowRoot.querySelector('a[href="mailto:meldung@example.org"]')).not.toBeNull();
    button(el, /Anmelden/)!.click();
    expect(logins).toHaveLength(1);
    const done = await mount('sx-report-dialog', { open: true, target, signedIn: true, done: true });
    expect(text(done)).toContain('Danke für deine Meldung');
  });
});

// ---------------------------------------------------------------- Konto: Einstellungen und Meldungen

describe('sx-account-dialog – Einstellungen und Meldungen', () => {
  const settings = (over: Record<string, unknown> = {}) => ({ notifyComments: 'off', suspended: false, hasProfile: true, isAdmin: false, ...over });
  const user = { id: 'U1', email: 'anna@example.org' };

  it('[F-113] Einstellungen: tägliche Sammelmail an-/abschalten', async () => {
    const saved = listen('sx-settings-save');
    const el = await mount('sx-account-dialog', { open: true, user, tab: 'settings', settings: settings() });
    const box = el.shadowRoot.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(saved).toEqual([{ notifyComments: 'daily' }]);
    const susp = await mount('sx-account-dialog', { open: true, user, tab: 'settings', settings: settings({ suspended: true }) });
    expect(text(susp)).toContain('Dein Konto ist gesperrt');
  });

  it('[F-114] Reiter „Meldungen“ nur für Admins; Liste mit Behalten, Ausblenden, Löschen (bestätigt) und Sperren', async () => {
    const plain = await mount('sx-account-dialog', { open: true, user, settings: settings() });
    expect(button(plain, /Meldungen/)).toBeUndefined();

    const decided = listen('sx-admin-decide');
    const suspended = listen('sx-admin-suspend');
    const report = {
      id: 'R1', kind: 'comment', targetId: 'C1', count: 3, reporters: 3, firstAt: Date.now(), lastAt: Date.now(),
      reasons: { spam: 2, depicted: 1 }, notes: [{ reason: 'spam', note: '<b>Werbung</b>', createdAt: Date.now() }],
      target: { title: 'Kommentar zu „Rügen“', text: 'Kauft Segel!', path: '/s/S1', visibility: 'public', hiddenAt: Date.now(), owner: { id: 'U9', displayName: 'Spammer', suspended: false } },
    };
    const el = await mount('sx-account-dialog', { open: true, user, tab: 'reports', settings: settings({ isAdmin: true }), reports: [report] });
    expect(button(el, /Meldungen/)).toBeDefined();
    const admin = el.shadowRoot.querySelector('sx-admin-reports') as LitEl;
    await admin.updateComplete;
    const t = text(admin);
    expect(t).toContain('3 Meldungen von 3 Konten');
    expect(t).toContain('Ich bin abgebildet');
    expect(t).toContain('<b>Werbung</b>');
    expect(admin.shadowRoot.querySelector('b')).toBeNull();
    button(admin, /Behalten & einblenden/)!.click();
    button(admin, /Ausblenden/)!.click();
    button(admin, /^\s*Löschen/)!.click();
    await admin.updateComplete;
    button(admin, /Endgültig löschen/)!.click();
    expect(decided).toEqual([{ id: 'R1', action: 'keep' }, { id: 'R1', action: 'hide' }, { id: 'R1', action: 'delete' }]);
    button(admin, /Konto sperren/)!.click();
    await admin.updateComplete;
    button(admin, /Ja, Konto sperren/)!.click();
    expect(suspended).toEqual([{ userId: 'U9', suspended: true }]);
  });

  it('[F-114] eigene gemeldete Freigabe zeigt den Hinweis', async () => {
    const share = { id: 'S1', title: 'Rügen', summary: '', visibility: 'public', view: '', sizeBytes: 1, trackCount: 1, distNm: 1, startedAt: null, hasImage: false, createdAt: Date.now(), updatedAt: Date.now(), boat: null, isOwner: true, hiddenAt: Date.now() };
    const el = await mount('sx-account-dialog', { open: true, user, tab: 'shares', shares: [share] });
    expect(text(el)).toContain('ausgeblendet bis zur Prüfung');
  });
});

// ---------------------------------------------------------------- Profil- und Bootsseite

describe('sx-profile-page – Melden', () => {
  it('[F-114] Besucher melden Profil und Boot, Eigentümer nicht', async () => {
    const reports = listen('sx-report');
    const profile = { handle: 'mats', displayName: 'Mats', bio: '', visibility: 'public', isSelf: false };
    const el = await mount('sx-profile-page', { data: { kind: 'profile', profile, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    button(el, /Melden/)!.click();
    expect(reports).toEqual([{ kind: 'profile', id: 'mats', label: 'das Profil von Mats' }]);
    const self = await mount('sx-profile-page', { data: { kind: 'profile', profile: { ...profile, isSelf: true }, boats: [], stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    expect(button(self, /Melden/)).toBeUndefined();
    const boat = { id: 'B1', name: 'Möwe', boatType: '', lengthM: null, sailNumber: '', homePort: '', description: '', visibility: 'public', createdAt: 0, updatedAt: 0, owner: null, role: null };
    const b = await mount('sx-profile-page', { data: { kind: 'boat', boat, stats: { voyages: 0, distNm: 0 }, voyages: [] } });
    button(b, /Melden/)!.click();
    expect(reports[1]).toEqual({ kind: 'boat', id: 'B1', label: 'das Boot Möwe' });
  });
});
