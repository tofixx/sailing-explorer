// @vitest-environment happy-dom
// Oberfläche Galerie-Beiträge (Konzept 31): „+ Neu → Fotos“, Dialog mit Fotoauswahl und optionalem Text, Ablauf im
// ComposeController (Beitrag, dann Fotos; ohne Foto wieder gelöscht) und die Stream-Karte mit Raster und Großansicht
// (F-491, F-492). Komponenten zeigen nur an und melden Absichten.
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createIn: vi.fn(),
  uploadPhoto: vi.fn(),
  remove: vi.fn(),
  compose: vi.fn(),
  audience: vi.fn(async () => ({ audience: null })),
}));
vi.mock('../../src/services/api', async (orig) => {
  const real = await orig<typeof import('../../src/services/api')>();
  return { ...real, postApi: { ...real.postApi, ...api } };
});
vi.mock('../../src/services/photo-process', async (orig) => {
  const real = await orig<typeof import('../../src/services/photo-process')>();
  return {
    ...real,
    processPhoto: vi.fn(async (f: File) => {
      if (f.name.startsWith('kaputt')) throw new real.PhotoError('Bild konnte nicht gelesen werden.');
      return { exif: {}, full: new Blob(['f']), thumb: new Blob(['t']), width: 800, height: 600, format: 'webp' };
    }),
  };
});

import '../../src/components/sx-compose';
import '../../src/components/sx-compose-dialog';
import '../../src/components/sx-gallery-post';
import '../../src/components/sx-stream';
import { ComposeController } from '../../src/controllers/compose';
import type { SxComposeDialog } from '../../src/components/sx-compose-dialog';
import type { ComposeTarget } from '../../src/domain/posts';
import type { StreamItem } from '../../src/domain/groups';
import { ApiError } from '../../src/services/api';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const settle = async (el: LitEl) => {
  await el.updateComplete;
  for (const child of el.shadowRoot.querySelectorAll('*')) if ('updateComplete' in child) await (child as LitEl).updateComplete;
};
const text = (root: ShadowRoot | Element) => (root.textContent ?? '').replace(/\s+/g, ' ');
const inner = (el: LitEl, tag: string) => el.shadowRoot.querySelector(tag) as LitEl;

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
  vi.clearAllMocks();
  api.audience.mockImplementation(async () => ({ audience: null }));
});

const targets: ComposeTarget[] = [{ ref: { kind: 'user' }, id: '', choices: ['public'], reaches: [{ reach: 'all', label: 'Überall', chain: 'dein Profil → überall' }] }];
const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

/** Fotos in den Dialog legen, wie es die Dateiauswahl täte. */
const pickerOf = (el: LitEl) => inner(el, 'sx-post-composer').querySelector('sx-gallery-picker') as LitEl;
async function pick(el: LitEl, files: File[]) {
  const input = pickerOf(el).shadowRoot.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
  await settle(el);
}

describe('sx-compose: Fotos', () => {
  it('[F-491] „+ Neu“ bietet „Fotos“ und meldet { kind: gallery }', async () => {
    const opens = listen('sx-compose-open');
    const el = await mount('sx-compose', { open: true });
    expect(text(el.shadowRoot)).toContain('Fotos');
    [...el.shadowRoot.querySelectorAll('.item')].find((b) => /Fotos/.test(b.textContent ?? ''))!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opens).toEqual([{ kind: 'gallery' }]);
  });
});

describe('sx-compose-dialog: Galerie', () => {
  it('[F-491] [F-493] Fotoauswahl im Formular, Text optional, Veröffentlichen erst mit Foto; Auswahl auf den Rest des Monats begrenzt', async () => {
    const submits = listen('sx-compose-submit');
    const el = await mount('sx-compose-dialog', { open: true, kind: 'gallery', targets, gallery: { used: 8, max: 10, perPost: 30 } });
    await settle(el);
    expect(text(el.shadowRoot)).toContain('Neue Fotos');
    const comp = inner(el, 'sx-post-composer');
    await pickerOf(el).updateComplete;
    expect(text(pickerOf(el).shadowRoot)).toMatch(/Noch 2 Fotos möglich \(8 von 10 in diesem Monat/);
    const send = () => [...comp.shadowRoot.querySelectorAll('button')].find((b) => /Veröffentlichen/.test(b.textContent ?? ''))!;
    expect(send().disabled).toBe(true);
    await pick(el, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    await settle(comp);
    await pickerOf(el).updateComplete;
    expect(pickerOf(el).shadowRoot.querySelectorAll('.previews img')).toHaveLength(2);
    expect(send().disabled).toBe(false);
    send().click();
    await settle(el);
    expect(submits).toHaveLength(1);
    const d = submits[0] as { kind: string; body: string; gallery: File[]; channel: { kind: string } };
    expect(d.kind).toBe('gallery');
    expect(d.body).toBe('');
    expect(d.gallery.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('[F-491] keine Nutzlast einer anderen Art: Umfrage ausgefüllt, abgebrochen, dann „Fotos“ – Veröffentlichen erst mit Foto (B1)', async () => {
    const el = await mount('sx-compose-dialog', { open: true, kind: 'poll', targets });
    await settle(el);
    (el as unknown as { payload: unknown }).payload = { options: ['Ja', 'Nein'], multi: false };
    // derselbe Dialog wird für „Fotos“ wiederverwendet
    Object.assign(el, { kind: 'gallery', gallery: { used: 0, max: 10, perPost: 30 } });
    await settle(el);
    const comp = inner(el, 'sx-post-composer');
    await pickerOf(el).updateComplete;
    await settle(el);
    expect((el as unknown as { payload: unknown }).payload).toBeNull();
    const send = [...comp.shadowRoot.querySelectorAll('button')].find((b) => /Veröffentlichen/.test(b.textContent ?? ''))!;
    expect(send.disabled).toBe(true);
  });

  it('[F-493] Monat ausgeschöpft: Auswahl gesperrt, Hinweis auf den nächsten Monat', async () => {
    const el = await mount('sx-compose-dialog', { open: true, kind: 'gallery', targets, gallery: { used: 10, max: 10, perPost: 30 } });
    await settle(el);
    const picker = pickerOf(el);
    await picker.updateComplete;
    expect(text(picker.shadowRoot)).toContain('alle 10 Fotos genutzt');
    expect((picker.shadowRoot.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('ComposeController: Galerie-Ablauf', () => {
  async function controller() {
    const dialog = (await mount('sx-compose-dialog', {})) as unknown as SxComposeDialog;
    const posted: unknown[] = [];
    const toasts: string[] = [];
    const c = new ComposeController({
      dialog, toast: (m) => toasts.push(m), requireLogin: (_r, then) => then(), startLogbook: () => undefined, posted: (p) => posted.push(p), resumeDraft: () => undefined,
    });
    return { c, dialog, posted, toasts };
  }
  const input = (files: File[]) => ({ channel: { kind: 'user' as const, id: '' }, kind: 'gallery' as const, body: '', link: '', visibility: 'public' as const, gallery: files });

  it('[F-491] Beitrag anlegen, Fotos nacheinander hochladen, dann in den Verlauf; ein kaputtes Foto wird gemeldet', async () => {
    api.createIn.mockResolvedValue({ post: { id: 'P1', path: '/p/P1', home: '/u/x' } });
    api.uploadPhoto.mockResolvedValue({ photo: { id: 'F' } });
    const { c, dialog, posted, toasts } = await controller();
    dialog.open = true;
    await c.submit(input([file('a.jpg'), file('kaputt.jpg'), file('c.jpg')]));
    expect(api.createIn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gallery', body: '' }));
    expect(api.createIn.mock.calls[0][0]).not.toHaveProperty('gallery');
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(api.uploadPhoto.mock.calls[0][0]).toBe('P1');
    expect(posted).toEqual([{ id: 'P1', path: '/p/P1', home: '/u/x' }]);
    expect(toasts[0]).toMatch(/1 Foto nicht hochgeladen: Bild konnte nicht gelesen werden/);
    expect(dialog.open).toBe(false);
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('[F-491] Galerie ohne Fotos (keine Liste): kein Beitrag, Fehler im Dialog; der Controller setzt die Nutzlast beim Öffnen zurück (B1)', async () => {
    api.compose.mockResolvedValue({ targets, preselect: null, shares: [], supporter: false });
    const { c, dialog } = await controller();
    (dialog as unknown as { payload: unknown }).payload = { options: ['a', 'b'] };
    c.open('gallery');
    await vi.waitFor(() => expect(dialog.loading).toBe(false));
    expect((dialog as unknown as { payload: unknown }).payload).toBeNull();
    await c.submit({ ...input([]), gallery: { options: ['a'] } as unknown as File[] });
    expect(api.createIn).not.toHaveBeenCalled();
    expect(dialog.error).toMatch(/mindestens ein Foto/);
  });

  it('[F-491] [F-493] kein Foto ging (Kontingent): Beitrag wieder gelöscht, Fehler im Dialog, Rest nicht mehr versucht', async () => {
    api.createIn.mockResolvedValue({ post: { id: 'P2', path: '/p/P2', home: null } });
    api.uploadPhoto.mockRejectedValue(new ApiError(402, 'supporter_required', 'Kostenlos kannst du 10 Fotos je Monat zeigen.'));
    api.remove.mockResolvedValue(undefined);
    const { c, dialog, posted } = await controller();
    dialog.open = true;
    await c.submit(input([file('a.jpg'), file('b.jpg')]));
    expect(api.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledWith('P2');
    expect(posted).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(dialog.error).toMatch(/10 Fotos je Monat/);
  });
});

describe('sx-gallery-post und Stream-Karte', () => {
  const photos = Array.from({ length: 6 }, (_, i) => ({ id: `F${i}`, width: 800, height: 600, caption: i === 0 ? 'Grillen' : '', takenAt: null }));

  it('[F-491] Karte: Raster mit vier Vorschaubildern und „+2“; Bilder mit Schlüssel bei „Nur mit Link“ (aus dem Pfad)', async () => {
    const item: StreamItem = {
      id: 'A1', kind: 'post', createdAt: Date.UTC(2026, 10, 3), actor: { handle: 'anna', displayName: 'Anna' }, group: null,
      post: { id: 'P9', body: '', link: null, canDelete: false, visibility: 'unlisted', path: '/p/P9/KEY', gallery: { photos } },
    };
    const el = await mount('sx-stream', { items: [item] });
    await settle(el);
    const g = inner(el, 'sx-gallery-post');
    await g.updateComplete;
    const imgs = [...g.shadowRoot.querySelectorAll('.grid img')] as HTMLImageElement[];
    expect(imgs).toHaveLength(4);
    expect(imgs[0].getAttribute('src')).toBe('/api/photos/F0?s=t&k=KEY');
    expect(imgs[0].getAttribute('alt')).toBe('Grillen');
    expect(text(g.shadowRoot)).toContain('+2');
  });

  it('[F-492] Großansicht im Modus post: ohne Ort und Bearbeiten, Blättern bleibt in der Karte, Melden geht nach oben', async () => {
    const navs = listen('sx-photo-nav');
    const reports = listen('sx-report');
    const g = await mount('sx-gallery-post', { photos });
    (g.shadowRoot.querySelectorAll('.grid button')[1] as HTMLButtonElement).click();
    await g.updateComplete;
    const lb = inner(g, 'sx-photo-lightbox');
    await lb.updateComplete;
    expect(lb.open).toBe(true);
    expect(lb.index).toBe(1);
    const t = text(lb.shadowRoot);
    expect(t).not.toMatch(/Ohne Ort|Aufnahmezeit unbekannt|Sichtbarkeit|Auf der Karte setzen/);
    ([...lb.shadowRoot.querySelectorAll('button')].find((b) => /Nächstes Foto/.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement).click();
    await g.updateComplete;
    expect(g.index).toBe(2);
    expect(navs).toEqual([]);
    ([...lb.shadowRoot.querySelectorAll('button')].find((b) => /Melden/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    expect(reports).toEqual([{ kind: 'photo', id: 'F2', label: 'dieses Foto' }]);
  });

  it('[F-494] Autor:in löscht ein einzelnes Foto aus der Großansicht: Rückfrage, ein Event für den Controller, Foto fällt heraus', async () => {
    const lightboxDeletes = listen('sx-photo-delete');
    const deletes = listen('sx-gallery-photo-delete');
    const g = await mount('sx-gallery-post', { photos: photos.slice(0, 3), own: true });
    (g.shadowRoot.querySelectorAll('.grid button')[1] as HTMLButtonElement).click();
    await g.updateComplete;
    const lb = inner(g, 'sx-photo-lightbox');
    await lb.updateComplete;
    expect(text(lb.shadowRoot)).not.toMatch(/Melden|Bildunterschrift|Sichtbarkeit/);
    const btn = (re: RegExp) => [...lb.shadowRoot.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement;
    btn(/Foto löschen/).click();
    await lb.updateComplete;
    btn(/Endgültig löschen/).click();
    expect(deletes).toEqual([{ id: 'F1' }]);
    expect(lightboxDeletes).toEqual([]);
    (g as unknown as { removePhoto(id: string): void }).removePhoto('F1');
    await g.updateComplete;
    expect((g.photos as Array<{ id: string }>).map((p) => p.id)).toEqual(['F0', 'F2']);
    expect(g.index).toBe(1);
  });

  it('[F-492] Stream: „eigen“ nach Autor:in, nicht nach Löschrecht (Gruppen-Admins melden)', async () => {
    const base = { kind: 'post' as const, createdAt: 1, actor: null, group: null };
    const mk = (id: string, canDelete: boolean, own?: boolean): StreamItem => ({ ...base, id, post: { id, body: 'x', link: null, canDelete, gallery: { photos, ...(own ? { own } : {}) } } });
    const el = await mount('sx-stream', { items: [mk('A', true), mk('B', false, true)] });
    await settle(el);
    const gs = [...el.shadowRoot.querySelectorAll('sx-gallery-post')] as LitEl[];
    expect(gs.map((g) => g.own)).toEqual([false, true]);
  });

  it('[F-492] eigener Beitrag: kein „Melden“ in der Großansicht', async () => {
    const g = await mount('sx-gallery-post', { photos: photos.slice(0, 1), own: true });
    (g.shadowRoot.querySelector('.grid button') as HTMLButtonElement).click();
    await g.updateComplete;
    const lb = inner(g, 'sx-photo-lightbox');
    await lb.updateComplete;
    expect(text(lb.shadowRoot)).not.toMatch(/Melden|Bildunterschrift/);
    // das letzte Foto geht nur mit dem Beitrag
    expect(text(lb.shadowRoot)).toContain('Das letzte Foto löschst du zusammen mit dem Beitrag');
  });
});
