// @vitest-environment happy-dom
// „Zum Home-Bildschirm hinzufügen“ (F-206): Hinweis nur auf Touch-Geräten außerhalb der installierten App; Android mit
// Installieren-Knopf (beforeinstallprompt), iOS-Safari mit Anleitung; „Nicht jetzt“ bleibt gemerkt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { isIosSafari } from '../../src/components/sx-install-hint';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot; mode: string | null } & Record<string, unknown>;

let coarse = true;
let standalone = false;
beforeEach(() => {
  coarse = true;
  standalone = false;
  localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: q.includes('coarse') ? coarse : q.includes('standalone') ? standalone : false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  document.body.innerHTML = '';
});

async function mount(): Promise<LitEl> {
  await import('../../src/components/sx-install-hint');
  const el = document.createElement('sx-install-hint') as LitEl;
  el.setAttribute('delay-ms', '0');
  document.body.append(el);
  await new Promise((r) => setTimeout(r, 5));
  await el.updateComplete;
  return el;
}

function fakePrompt(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('sx-install-hint', () => {
  it('[F-206] erkennt iOS-Safari (auch iPad als „Macintosh“ mit Touch), nicht Chrome/Firefox auf iOS', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(isIosSafari(iphone, 5)).toBe(true);
    expect(isIosSafari(iphone.replace('Version/18.0', 'CriOS/130.0'), 5)).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5)).toBe(true);
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 0)).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 5)).toBe(false);
  });

  it('[F-206] Android: nach beforeinstallprompt Installieren-Knopf, der den Browser-Dialog öffnet', async () => {
    const e = fakePrompt('accepted');
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const el = await mount();
    expect(el.mode).toBe('android');
    const btn = [...el.shadowRoot.querySelectorAll('button')].find((b) => /Installieren/.test(b.textContent ?? ''))!;
    btn.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(e.prompt).toHaveBeenCalled();
    expect(el.mode).toBeNull();
  });

  it('[F-206] nicht auf Geräten mit Maus, nicht in der installierten App, nicht nach „Nicht jetzt“', async () => {
    window.dispatchEvent(fakePrompt('dismissed'));
    coarse = false;
    expect((await mount()).mode).toBeNull();
    coarse = true;
    standalone = true;
    expect((await mount()).mode).toBeNull();
    standalone = false;
    const el = await mount();
    expect(el.mode).toBe('android');
    el.shadowRoot.querySelector<HTMLButtonElement>('button[aria-label="Nicht jetzt"]')!.click();
    await el.updateComplete;
    expect(el.mode).toBeNull();
    expect(localStorage.getItem('sx-install-dismissed')).toBe('1');
    expect((await mount()).mode).toBeNull();
  });

  it('[F-206] iOS-Safari: Anleitung mit Teilen-Symbol, kein Installieren-Knopf; nicht in Einbettungen', async () => {
    window.dispatchEvent(new Event('appinstalled')); // Installations-Ereignis aus früheren Tests verwerfen
    const ua = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    try {
      const el = await mount();
      expect(el.mode).toBe('ios');
      const t = el.shadowRoot.textContent ?? '';
      expect(t).toContain('„Zum Home-Bildschirm“');
      expect([...el.shadowRoot.querySelectorAll('button')].some((b) => /Installieren/.test(b.textContent ?? ''))).toBe(false);
      history.replaceState(null, '', '/?embed=1');
      expect((await mount()).mode).toBeNull();
      history.replaceState(null, '', '/');
    } finally {
      if (ua) Object.defineProperty(navigator, 'userAgent', ua);
      else delete (navigator as unknown as Record<string, unknown>).userAgent;
    }
  });

  it('[F-206] Manifest: feste Identität, Start /, Icons vorhanden, Manifest und Icons kommen direkt aus den Assets', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { id: string; start_url: string; scope: string; display: string; icons: Array<{ src: string; sizes: string; purpose: string }> };
    expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    for (const size of ['192x192', '512x512']) {
      expect(m.icons.some((i) => i.sizes === size && i.purpose === 'any')).toBe(true);
      expect(m.icons.some((i) => i.sizes === size && i.purpose === 'maskable')).toBe(true);
    }
    for (const i of m.icons) expect(existsSync(`public${i.src}`), i.src).toBe(true);
    expect(existsSync('public/icons/icon-180.png')).toBe(true);
    const wrangler = readFileSync('wrangler.jsonc', 'utf8');
    expect(wrangler).toContain('"!/icons/*"');
    expect(wrangler).toContain('"!/manifest.webmanifest"');
    const index = readFileSync('index.html', 'utf8');
    expect(index).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(index).toContain('rel="apple-touch-icon" href="/icons/icon-180.png"');
  });
});
