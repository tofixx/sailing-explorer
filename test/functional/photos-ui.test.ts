// @vitest-environment happy-dom
// Funktionale Tests der Oberfläche für Fotos (Konzept 3.3, F-100 … F-103): Galerie-Leiste mit gesperrtem Hinweis für
// Nicht-Unterstützer, Lightbox (Tastatur, Fokus, Eigentümer-Werkzeuge, Melden), Upload-Dialog (Platzierungs-Status,
// Zeitversatz, Fortschritt).
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-photo-strip';
import '../../src/components/sx-photo-lightbox';
import '../../src/components/sx-photo-upload';
import { placementText, type UploadItem } from '../../src/components/sx-photo-upload';
import { uploadBlockText } from '../../src/components/sx-photo-strip';

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

const T = Date.parse('2026-06-13T10:05:00Z');
const photo = (over: Record<string, unknown> = {}) => ({
  id: 'P1', caption: 'Ankerbucht', takenAt: T, lat: 54, lon: 13, placement: 'gps', width: 2048, height: 1536, createdAt: T,
  effectiveVisibility: 'public', visibility: null, bytes: null, hidden: false,
  thumbUrl: '/api/photos/P1?s=t', fullUrl: '/api/photos/P1?s=f', ...over,
});
const upload = (over: Record<string, unknown> = {}) => ({ allowed: true, reason: null, supporter: true, used: 2, max: 100, bytesLeft: 1e8, supportOffered: true, ...over });

// ---------------------------------------------------------------- sx-photo-strip

describe('sx-photo-strip', () => {
  it('[F-103] Vorschaubilder lazy, zugängliche Namen, Klick öffnet, Hover und Fokus melden das Foto', async () => {
    const opened = listen('sx-photo-open');
    const hovered = listen('sx-photo-hover');
    const el = await mount('sx-photo-strip', {
      photos: [photo(), photo({ id: 'P2', caption: '', takenAt: null, lat: null, lon: null, placement: 'none', thumbUrl: '/api/photos/P2?s=t&k=KEY' })],
    });
    const imgs = el.shadowRoot.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
    expect(imgs[1].getAttribute('src')).toBe('/api/photos/P2?s=t&k=KEY');
    const btns = el.shadowRoot.querySelectorAll('button.thumb');
    expect(btns[0].getAttribute('aria-label')).toBe('Ankerbucht öffnen');
    expect(btns[1].getAttribute('aria-label')).toBe('Foto ohne Beschreibung öffnen');
    expect(btns[1].querySelector('[title^="Ohne Ort"]')).not.toBeNull();
    (btns[0] as HTMLButtonElement).click();
    btns[0].dispatchEvent(new Event('mouseenter'));
    btns[0].dispatchEvent(new Event('mouseleave'));
    btns[1].dispatchEvent(new Event('focus'));
    expect(opened).toEqual([{ id: 'P1' }]);
    expect(hovered).toEqual([{ id: 'P1' }, { id: null }, { id: 'P2' }]);
    // ohne Eigentümer-Status kein Hinzufügen
    expect(button(el, /Fotos hinzufügen/)).toBeUndefined();
  });

  it('[E3] Nicht-Unterstützer: gesperrter Hinweis „Fotos für Unterstützer“, Button öffnet das Angebot', async () => {
    const support = listen('sx-photo-support');
    const el = await mount('sx-photo-strip', { isOwner: true, upload: upload({ allowed: false, reason: 'supporter_required', supporter: false, used: 0 }) });
    expect(text(el)).toContain('Fotos für Unterstützer');
    expect(text(el)).toContain('Fotos gibt es nur für Unterstützer.');
    expect(button(el, /Fotos hinzufügen/)).toBeUndefined();
    button(el, /Unterstützen/)!.click();
    expect(support).toHaveLength(1);
    // ohne eingerichtetes Unterstützen kein Button
    el.upload = upload({ allowed: false, reason: 'supporter_required', supportOffered: false });
    await el.updateComplete;
    expect(button(el, /Unterstützen/)).toBeUndefined();
  });

  it('[F-100] Unterstützer: Zähler, Hinzufügen; bei voller Grenze gesperrt mit Grund; Badges für „Nur ich“ und ausgeblendet', async () => {
    const add = listen('sx-photo-add');
    const el = await mount('sx-photo-strip', { isOwner: true, upload: upload(), photos: [photo({ visibility: 'private', hidden: true })] });
    expect(text(el)).toContain('2 von 100 Fotos');
    button(el, /Fotos hinzufügen/)!.click();
    expect(add).toHaveLength(1);
    expect(el.shadowRoot.querySelector('[title="Nur ich"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('[title="Ausgeblendet nach Meldung"]')).not.toBeNull();
    el.upload = upload({ allowed: false, reason: 'quota', used: 100 });
    await el.updateComplete;
    expect(button(el, /Fotos hinzufügen/)!.disabled).toBe(true);
    expect(text(el)).toContain('Maximal 100 Fotos pro Törn.');
    expect(uploadBlockText(upload({ allowed: false, reason: 'storage_paused' }) as never)).toMatch(/pausiert/);
  });
});

// ---------------------------------------------------------------- sx-photo-lightbox

describe('sx-photo-lightbox', () => {
  const photos = [photo(), photo({ id: 'P2', caption: 'Hafen', fullUrl: '/api/photos/P2?s=f' }), photo({ id: 'P3', caption: '', takenAt: null, lat: null, lon: null, placement: 'none' })];

  it('[F-103] Vollbild mit Alternativtext, Zeit und Platzierung; ←/→ blättern (zyklisch), Fokus startet auf „Schließen“', async () => {
    const nav = listen('sx-photo-nav');
    const el = await mount('sx-photo-lightbox', { photos, index: 0, open: true });
    const img = el.shadowRoot.querySelector('.stage img')!;
    expect(img.getAttribute('src')).toBe('/api/photos/P1?s=f');
    expect(img.getAttribute('alt')).toBe('Ankerbucht');
    expect(text(el)).toContain('1 / 3');
    expect(text(el)).toContain('Ort aus dem GPS des Fotos');
    expect(el.shadowRoot.activeElement?.classList.contains('close')).toBe(true);
    const dlg = el.shadowRoot.querySelector('dialog')!;
    dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
    dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, composed: true }));
    expect(nav).toEqual([{ index: 1 }, { index: 2 }]);
    button(el, /Nächstes Foto/)!.click();
    expect(nav[2]).toEqual({ index: 1 });
  });

  it('[F-103] Esc/Schließen meldet sx-photo-close; „Auf Karte zeigen“ nur mit Ort', async () => {
    const closed = listen('sx-photo-close');
    const shown = listen('sx-photo-show');
    const el = await mount('sx-photo-lightbox', { photos, index: 0, open: true });
    button(el, /Auf Karte zeigen/)!.click();
    expect(shown).toEqual([{ id: 'P1' }]);
    el.shadowRoot.querySelector('dialog')!.dispatchEvent(new Event('close'));
    button(el, /^Schließen/)!.click();
    expect(closed).toHaveLength(2);
    el.index = 2;
    await el.updateComplete;
    expect(button(el, /Auf Karte zeigen/)).toBeUndefined();
    expect(text(el)).toContain('Aufnahmezeit unbekannt');
    expect(el.shadowRoot.querySelector('.stage img')!.getAttribute('alt')).toBe('Foto ohne Beschreibung');
  });

  it('[F-81] Eigentümer: Bildunterschrift und „Wie der Törn“/„Nur ich“ speichern, Ort setzen, Löschen mit Bestätigung; kein Melden', async () => {
    const saved = listen('sx-photo-save');
    const placed = listen('sx-photo-place');
    const deleted = listen('sx-photo-delete');
    const el = await mount('sx-photo-lightbox', { photos: [photo({ visibility: 'public' })], index: 0, open: true, isOwner: true });
    expect(button(el, /Melden/)).toBeUndefined();
    const opts = [...el.shadowRoot.querySelectorAll('#pl-vis option')].map((o) => o.textContent);
    expect(opts).toEqual(['Wie der Törn', 'Nur ich']);
    (el.shadowRoot.querySelector('#pl-caption') as HTMLInputElement).value = '  Neue Unterschrift ';
    (el.shadowRoot.querySelector('#pl-vis') as HTMLSelectElement).value = 'private';
    el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saved).toEqual([{ id: 'P1', caption: 'Neue Unterschrift', visibility: 'private' }]);
    button(el, /Ort ändern/)!.click();
    expect(placed).toEqual([{ id: 'P1' }]);
    button(el, /^ *Löschen/)!.click();
    await el.updateComplete;
    expect(deleted).toHaveLength(0);
    button(el, /Endgültig löschen/)!.click();
    expect(deleted).toEqual([{ id: 'P1' }]);
  });

  it('[F-114] andere: Melden mit Art „photo“; ausgeblendet-Hinweis nur für Eigentümer', async () => {
    const reported = listen('sx-report');
    const el = await mount('sx-photo-lightbox', { photos: [photo()], index: 0, open: true });
    button(el, /Melden/)!.click();
    expect(reported).toEqual([{ kind: 'photo', id: 'P1', label: 'dieses Foto' }]);
    const owner = await mount('sx-photo-lightbox', { photos: [photo({ hidden: true, visibility: 'public' })], index: 0, open: true, isOwner: true });
    expect(text(owner)).toContain('gemeldet und ist bis zur Prüfung');
  });
});

// ---------------------------------------------------------------- sx-photo-upload

const item = (over: Partial<UploadItem> = {}): UploadItem => ({
  key: 'b1', name: 'IMG_0001.jpg', previewUrl: 'blob:x', status: 'ready', error: '', placement: 'gps', gpsRejected: false, takenAt: T, usesOffset: false, caption: '', ...over,
});

describe('sx-photo-upload', () => {
  it('[F-102] Platzierungs-Status je Foto: GPS, Zeit, verworfen, ohne Ort, Fehler (HEIC)', async () => {
    expect(placementText(item())).toBe('Ort aus dem GPS des Fotos');
    expect(placementText(item({ placement: 'time', gpsRejected: true }))).toMatch(/^Ort verworfen – zu weit vom Track\. Ort aus der Aufnahmezeit/);
    expect(placementText(item({ placement: 'none', takenAt: null }))).toMatch(/^Ohne Ort – nur in der Galerie/);
    expect(placementText(item({ placement: 'none' }))).toMatch(/außerhalb des Törns/);
    const el = await mount('sx-photo-upload', {
      open: true,
      items: [item(), item({ key: 'b2', name: 'x.heic', status: 'error', error: 'HEIC kann dieser Browser nicht öffnen', previewUrl: null }), item({ key: 'b3', status: 'reading', previewUrl: null })],
    });
    expect(text(el)).toContain('Frag die Abgebildeten');
    expect(text(el)).toContain('Ort aus dem GPS des Fotos');
    expect(el.shadowRoot.querySelector('[role="alert"]')!.textContent).toContain('HEIC');
    expect(text(el)).toContain('Wird gelesen');
    // Solange gelesen wird, kein Hochladen
    expect(button(el, /hochladen/)!.disabled).toBe(true);
    el.items = [item(), item({ key: 'b2' })];
    await el.updateComplete;
    expect(button(el, /2 Fotos hochladen/)!.disabled).toBe(false);
  });

  it('[F-102] Zeitversatz-Regler nur bei Fotos ohne Zeitzone; Regler und ±1 h melden den Versatz (begrenzt)', async () => {
    const offs = listen('sx-photo-offset');
    const el = await mount('sx-photo-upload', { open: true, items: [item()] });
    expect(el.shadowRoot.querySelector('input[type=range]')).toBeNull();
    el.items = [item({ usesOffset: true, placement: 'time' })];
    el.offsetMin = 120;
    el.offsetSource = 'gps';
    await el.updateComplete;
    const range = el.shadowRoot.querySelector('input[type=range]') as HTMLInputElement;
    expect(range.getAttribute('aria-valuetext')).toBe('+2 h');
    expect(text(el)).toContain('aus Fotos mit GPS ermittelt');
    range.value = '135';
    range.dispatchEvent(new Event('input'));
    button(el, /Eine Stunde später/)!.click();
    expect(offs).toEqual([{ min: 135 }, { min: 180 }]);
    el.offsetMin = 840;
    await el.updateComplete;
    button(el, /Eine Stunde später/)!.click();
    expect(offs[2]).toEqual({ min: 840 });
  });

  it('[F-100] Bildunterschrift, Entfernen, Sichtbarkeit, Fortschritt und Absenden als Events', async () => {
    const caps = listen('sx-photo-item-caption');
    const removed = listen('sx-photo-item-remove');
    const vis = listen('sx-photo-upload-visibility');
    const submit = listen('sx-photo-upload-submit');
    const el = await mount('sx-photo-upload', { open: true, items: [item()] });
    const cap = el.shadowRoot.querySelector('input[type=text]') as HTMLInputElement;
    cap.value = 'Sonnenuntergang';
    cap.dispatchEvent(new Event('change'));
    button(el, /IMG_0001.jpg entfernen/)!.click();
    const sel = el.shadowRoot.querySelector('#pu-vis') as HTMLSelectElement;
    sel.value = 'private';
    sel.dispatchEvent(new Event('change'));
    button(el, /1 Foto hochladen/)!.click();
    expect(caps).toEqual([{ key: 'b1', caption: 'Sonnenuntergang' }]);
    expect(removed).toEqual([{ key: 'b1' }]);
    expect(vis).toEqual([{ visibility: 'private' }]);
    expect(submit).toHaveLength(1);
    el.progress = { done: 1, total: 3, current: 0.5 };
    el.busy = true;
    await el.updateComplete;
    expect(text(el)).toContain('1 von 3 hochgeladen');
    expect((el.shadowRoot.querySelector('progress') as HTMLProgressElement).value).toBe(1.5);
    expect(button(el, /hochladen/)!.disabled).toBe(true);
  });
});
