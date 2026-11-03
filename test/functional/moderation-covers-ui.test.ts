// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche zur Moderation von Titelbildern (Konzept 36): Hinweis am zurückgehaltenen
// Titelbild (F-563), Gründe im Melden-Dialog je Ziel (F-566), „Nur Titelbild entfernen“ in der Admin-Liste (F-564).
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-page-media';
import '../../src/components/sx-report-dialog';
import '../../src/components/sx-admin-reports';
import { REPORT_HOLD } from '../../src/domain/cover';

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
const radios = (el: LitEl) => [...el.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.value);
const button = (el: LitEl, label: RegExp) => [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

let cleanups: Array<() => void> = [];
afterEach(() => {
  document.body.innerHTML = '';
  for (const c of cleanups) c();
  cleanups = [];
});
function listen(name: string) {
  const got: unknown[] = [];
  const fn = (e: Event) => got.push((e as CustomEvent).detail);
  document.addEventListener(name, fn);
  cleanups.push(() => document.removeEventListener(name, fn));
  return got;
}

describe('sx-cover – zurückgehaltenes Titelbild', () => {
  it('[F-563] Hinweis mit Datum bei neuen Konten, „gemeldet“ bei Melde-Sperre, nichts bei öffentlichen Bildern', async () => {
    const cover = { kind: 'u', targetId: 'anna', src: '/api/covers/u/anna/abc123', canEdit: true };
    const until = new Date('2026-11-10T12:00:00+01:00').getTime();
    const fresh = await mount('sx-cover', { ...cover, heldUntil: until });
    expect(text(fresh)).toContain('Noch nicht öffentlich');
    expect(text(fresh)).toContain('ab 10.11.');
    const reported = await mount('sx-cover', { ...cover, heldUntil: REPORT_HOLD });
    expect(text(reported)).toContain('gemeldet');
    const shown = await mount('sx-cover', { ...cover, heldUntil: null });
    expect(shown.shadowRoot.querySelector('.held')).toBeNull();
  });
});

describe('sx-report-dialog – Gründe je Ziel', () => {
  it('[F-566] Fotos und Titelbilder mit „Ich bin abgebildet“ und „Kinder abgebildet“, Texte und Seiten ohne Bild nicht', async () => {
    const open = (target: Record<string, unknown>) => mount('sx-report-dialog', { open: true, signedIn: true, target });
    expect(radios(await open({ kind: 'photo', id: 'F1', label: 'dieses Foto' }))).toEqual(['spam', 'abuse', 'illegal', 'depicted', 'minors', 'other']);
    expect(radios(await open({ kind: 'profile', id: 'anna', label: 'das Profil', image: true }))).toContain('minors');
    expect(radios(await open({ kind: 'profile', id: 'anna', label: 'das Profil', image: false }))).toEqual(['spam', 'abuse', 'illegal', 'other']);
    expect(radios(await open({ kind: 'post', id: 'P1', label: 'diesen Beitrag', image: true }))).not.toContain('depicted');
    const done = await mount('sx-report-dialog', { open: true, signedIn: true, done: true, target: { kind: 'boat', id: 'B1', label: 'das Boot', image: true } });
    done.reason = 'minors';
    await done.updateComplete;
    expect(text(done)).toContain('Bis zur Prüfung ist das Titelbild ausgeblendet.');
  });
});

describe('sx-admin-reports – nur das Titelbild entfernen', () => {
  const base = { id: 'R1', targetId: 'B1', count: 1, reporters: 1, firstAt: Date.now(), lastAt: Date.now(), reasons: { minors: 1 }, notes: [], newReporters: 1 };
  const target = { title: 'Boot Möwe', text: '', path: '/b/B1', visibility: 'public', hiddenAt: null, owner: { id: 'U1', displayName: 'Anna', suspended: false } };

  it('[F-564][F-569] Profil, Boot, Gruppe mit Titelbild: Vorschau, Hinweise, Knopf mit Bestätigung; ohne Bild bzw. bei anderen Arten keiner', async () => {
    const decided = listen('sx-admin-decide');
    const el = await mount('sx-admin-reports', { reports: [{ ...base, kind: 'boat', target: { ...target, imagePath: '/api/covers/b/B1/abc123', coverHeld: true } }] });
    expect(el.shadowRoot.querySelector('img.thumb')?.getAttribute('alt')).toBe('Titelbild');
    expect(text(el)).toContain('Kinder abgebildet');
    expect(text(el)).toContain('Titelbild zurückgehalten');
    expect(text(el)).toContain('Meldende:r ist neues Konto');
    button(el, /Nur Titelbild entfernen/)!.click();
    await el.updateComplete;
    expect(decided).toEqual([]); // erst bestätigen
    button(el, /Ja, Titelbild löschen/)!.click();
    expect(decided).toEqual([{ id: 'R1', action: 'cover' }]);

    const noImage = await mount('sx-admin-reports', { reports: [{ ...base, kind: 'boat', target }] });
    expect(button(noImage, /Nur Titelbild/)).toBeUndefined();
    const photo = await mount('sx-admin-reports', { reports: [{ ...base, kind: 'photo', target: { ...target, imagePath: '/api/photos/F1?s=t' } }] });
    expect(button(photo, /Nur Titelbild/)).toBeUndefined();
  });
});
