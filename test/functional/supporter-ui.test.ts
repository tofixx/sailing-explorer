// @vitest-environment happy-dom
// Funktionale Tests der Unterstützen-Oberfläche (F-63): Kontingent-Anzeige, Slider statt Payment-Links,
// Karte statt Formular, Abzeichen, Unterstützer-Zeitraum und Löschtermine.
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/sx-share-dialog';
import '../../src/components/sx-account-dialog';
import '../../src/components/sx-support';
import { SUPPORT_TIERS, WARN_MS, formatEuro, needsSupport, quotaText } from '../../src/domain/support';
import { fmtDate } from '../../src/domain/format';
import { limitsFor } from '../../src/domain/limits';
import { T0 } from './helpers';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

// showModal gibt es in happy-dom nicht überall – für die Darstellung nicht nötig
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const DAY = 86_400_000;
const USER = { id: 'U1234567890abcdefg', email: 'skipper@example.org' };
const TIERS = SUPPORT_TIERS;
const status = (sharesUsed: number, supporter = false, supporterUntil: number | null = supporter ? Date.now() + 200 * DAY : null) => ({
  supporter,
  supporterUntil,
  sharesUsed,
  sharesFree: 3,
  // Grenzen der aktuellen Stufe (Phase B, src/domain/limits.ts)
  sharesMax: supporter ? 100 : 3,
  bytesUsed: Math.round(12.4 * 1024 * 1024),
  bytesMax: supporter ? 200 * 1024 * 1024 : limitsFor('free').bytes,
  boatsUsed: 1,
  boatsMax: supporter ? 20 : 3,
  limits: { free: limitsFor('free'), supporter: limitsFor('supporter') },
  storagePaused: false,
});

async function mount(tag: string, props: Record<string, unknown>): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Text inkl. verschachtelter Komponenten (sx-support im Shadow DOM des Dialogs). */
function deepText(root: ShadowRoot | Element): string {
  let out = '';
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent;
    else if (n instanceof Element) out += (n.shadowRoot ? deepText(n.shadowRoot) : '') + deepText(n);
  });
  return out.replace(/\s+/g, ' ');
}

async function supportEl(el: LitEl) {
  const s = el.shadowRoot.querySelector('sx-support') as LitEl | null;
  if (s) await s.updateComplete;
  return s;
}

const slider = (s: LitEl) => s.shadowRoot.querySelector<HTMLInputElement>('input[type="range"]');
const payButton = (s: LitEl) => [...s.shadowRoot.querySelectorAll('button')].find((b) => /Jetzt unterstützen|Bezahlseite/.test(b.textContent!));

/** Slider wie per Tastatur/Maus bewegen: Wert setzen und input-Event auslösen. */
async function slide(s: LitEl, index: number) {
  const r = slider(s)!;
  r.value = String(index);
  r.dispatchEvent(new Event('input', { bubbles: true }));
  await s.updateComplete;
}

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

describe('F-63 Unterstützen – Regeln', () => {
  it('[F-63] Kontingent-Text und Sperre ab dem 4. Törn, nicht für Unterstützer', () => {
    expect(quotaText(status(2))).toBe('2 von 3 kostenlosen Freigaben genutzt');
    expect(quotaText(status(7))).toBe('3 von 3 kostenlosen Freigaben genutzt');
    expect(quotaText(status(7, true))).toBe('');
    expect(needsSupport(status(2))).toBe(false);
    expect(needsSupport(status(3))).toBe(true);
    expect(needsSupport(status(3, true))).toBe(false);
    expect(needsSupport(null)).toBe(false);
  });
});

describe('F-63 sx-support Slider', () => {
  it('[F-63] Slider ist beschriftet, über alle Stufen und zeigt Icon, Bezeichnung und Betrag', async () => {
    const s = await mount('sx-support', { variant: 'required', tiers: TIERS, status: status(3) });
    const r = slider(s)!;
    expect(r).not.toBeNull();
    expect(r.min).toBe('0');
    expect(r.max).toBe(String(TIERS.length - 1));
    expect(r.step).toBe('1');
    // per <label for> beschriftet, Wert für Screenreader als Text
    const label = s.shadowRoot.querySelector(`label[for="${r.id}"]`);
    expect(label?.textContent).toMatch(/Wie viel/);
    expect(r.getAttribute('aria-valuetext')).toBe(`Bier, ${formatEuro(500)}`);
    expect(s.shadowRoot.querySelector('.current')?.textContent).toMatch(new RegExp(`Bier\\s*${formatEuro(500)}`));
    expect(s.shadowRoot.querySelector('.current svg')).not.toBeNull();
    expect(payButton(s)!.textContent).toContain(`Jetzt unterstützen (${formatEuro(500)})`);
  });

  it('[F-63] Stufe wählen und „Jetzt unterstützen“ meldet den Betrag in Cent', async () => {
    const got = listen('sx-support-checkout');
    const s = await mount('sx-support', { variant: 'required', tiers: TIERS, status: status(3) });
    await slide(s, 0);
    expect(payButton(s)!.textContent).toContain(`Jetzt unterstützen (${formatEuro(300)})`);
    payButton(s)!.click();
    await slide(s, 3);
    expect(slider(s)!.getAttribute('aria-valuetext')).toBe(`Kiste, ${formatEuro(2000)}`);
    payButton(s)!.click();
    await slide(s, TIERS.length - 1);
    expect(s.shadowRoot.querySelector('.current')?.textContent).toContain('Skipper-Dank');
    payButton(s)!.click();
    expect(got).toEqual([{ amount: 300 }, { amount: 2000 }, { amount: 5000 }]);
  });

  it('[F-63] Klick auf ein Stufen-Icon wählt die Stufe', async () => {
    const got = listen('sx-support-checkout');
    const s = await mount('sx-support', { variant: 'offer', tiers: TIERS, status: status(1) });
    (s.shadowRoot.querySelectorAll('.ticks span')[2] as HTMLElement).click();
    await s.updateComplete;
    expect(slider(s)!.value).toBe('2');
    payButton(s)!.click();
    expect(got).toEqual([{ amount: 1000 }]);
  });

  it('[F-63] während der Checkout angelegt wird, ist der Knopf gesperrt', async () => {
    const got = listen('sx-support-checkout');
    const s = await mount('sx-support', { variant: 'required', tiers: TIERS, status: status(3), busy: true });
    const b = payButton(s)!;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toContain('Bezahlseite wird geöffnet');
    b.click();
    expect(got).toEqual([]);
  });

  it('[F-63] erklärt Laufzeit, Aufbewahrung und Grenzen für Unterstützer', async () => {
    const s = await mount('sx-support', { variant: 'required', tiers: TIERS, status: status(3) });
    const t = deepText(s.shadowRoot);
    expect(t).toMatch(/gilt für die Saison \d{4} \(bis 31\.12\.\)/);
    expect(t).toContain('jede weitere Zahlung hängt eine Saison an');
    expect(t).toContain('Törns bleiben für ihre Saison gespeichert und werden Ende Januar danach gelöscht');
    expect(t).toContain('bis zu 100 Törns, 200 MB Speicher und 20 Boote');
  });

  it('[F-63] Unterstützer sehen im Angebot nur den Dank – Slider erst nach „Verlängern“', async () => {
    const s = await mount('sx-support', { variant: 'offer', tiers: TIERS, status: status(5, true) });
    expect(deepText(s.shadowRoot)).toContain('Danke, dass du Sail Explorer unterstützt!');
    expect(slider(s)).toBeNull();
    const toggle = [...s.shadowRoot.querySelectorAll('button')].find((b) => /Verlängern/.test(b.textContent!))!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await s.updateComplete;
    expect(slider(s)).not.toBeNull();
  });

  it('[F-62] ohne Stufen (nicht eingerichtet) kein Angebot', async () => {
    const s = await mount('sx-support', { variant: 'offer', tiers: null, status: status(1) });
    expect(s.shadowRoot.textContent!.trim()).toBe('');
  });
});

describe('F-63 sx-share-dialog', () => {
  const base = { open: true, defaultTitle: 'Törn', summary: '12 sm', boats: [], result: null, busy: false, error: '' };

  it('[F-63] Formular zeigt „2 von 3 kostenlos“', async () => {
    const el = await mount('sx-share-dialog', { ...base, supportTiers: TIERS, supportStatus: status(2) });
    expect(el.shadowRoot.querySelector('form')).not.toBeNull();
    expect(deepText(el.shadowRoot)).toContain('2 von 3 kostenlosen Freigaben genutzt');
  });

  it('[F-63] beim 4. Törn: Karte mit Slider und „Status prüfen“ statt Formular', async () => {
    const checks = listen('sx-support-check');
    const checkouts = listen('sx-support-checkout');
    const el = await mount('sx-share-dialog', { ...base, supportTiers: TIERS, supportStatus: status(3) });
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    const card = (await supportEl(el))!;
    expect(deepText(el.shadowRoot)).toContain('Für weitere Törns: einmal unterstützen');
    expect(card.shadowRoot.querySelectorAll('a')).toHaveLength(0); // keine Payment-Links mehr
    await slide(card, 2);
    payButton(card)!.click();
    expect(checkouts).toEqual([{ amount: 1000 }]);
    [...card.shadowRoot.querySelectorAll('button')].find((b) => /Status prüfen/.test(b.textContent!))!.click();
    expect(checks).toHaveLength(1);
  });

  it('[F-63] Checkout läuft: Knopf in der Karte gesperrt', async () => {
    const el = await mount('sx-share-dialog', { ...base, supportTiers: TIERS, supportStatus: status(3), checkoutBusy: true });
    const card = (await supportEl(el))!;
    expect(payButton(card)!.disabled).toBe(true);
  });

  it('[F-62] ohne eingerichtetes Unterstützen: verständlicher Hinweis, kein Slider', async () => {
    const accounts = listen('sx-account');
    const el = await mount('sx-share-dialog', { ...base, supportTiers: null, supportStatus: status(3) });
    const card = (await supportEl(el))!;
    expect(el.shadowRoot.querySelector('form')).toBeNull();
    expect(slider(card)).toBeNull();
    expect(deepText(el.shadowRoot)).toMatch(/Lösche einen älteren Törn/);
    card.shadowRoot.querySelector('button')!.click();
    expect(accounts).toEqual(['shares']);
  });

  it('[F-63] Unterstützer sehen das Formular ohne Kontingent-Hinweis', async () => {
    const el = await mount('sx-share-dialog', { ...base, supportTiers: TIERS, supportStatus: status(9, true) });
    expect(el.shadowRoot.querySelector('form')).not.toBeNull();
    expect(deepText(el.shadowRoot)).not.toContain('kostenlosen Freigaben');
  });

  it('[F-63] Teilen-Ergebnis bietet dezent das Unterstützen an', async () => {
    const share = { id: 'S1', title: 'Törn', summary: '', visibility: 'unlisted', isOwner: true };
    const el = await mount('sx-share-dialog', { ...base, supportTiers: TIERS, supportStatus: status(1), result: { share, url: 'http://localhost/s/S1' } });
    const s = (await supportEl(el))!;
    expect(deepText(el.shadowRoot)).toContain('Gefällt dir Sail Explorer?');
    expect(slider(s)).not.toBeNull();
  });
});

describe('F-63 sx-account-dialog', () => {
  const props = { open: true, tab: 'shares', user: USER, shares: [], boats: [], loading: false, error: '', supportTiers: TIERS };
  const share = (id: string, expiresAt: number | null) => ({ id, title: `Törn ${id}`, summary: '', visibility: 'unlisted', trackCount: 1, createdAt: T0, listed: false, boat: null, isOwner: true, expiresAt });

  it('[F-63] zeigt das genutzte Kontingent und das Angebot zu unterstützen', async () => {
    const el = await mount('sx-account-dialog', { ...props, supportStatus: status(2), shares: [share('S1', null)] });
    await supportEl(el);
    const t = deepText(el.shadowRoot);
    expect(t).toContain('Kostenlos: 2 von 3 Törns · 12 MB von 41 MB · 1 von 3 Booten');
    expect(t).toContain('Jetzt unterstützen');
    expect(t).not.toContain('Unterstützer bis');
    expect(el.shadowRoot.querySelector('.badge')).toBeNull();
  });

  it('[F-63] Unterstützer: Abzeichen, „Unterstützer bis …“ und Kontingent in Törns und MB', async () => {
    const until = Date.now() + 200 * DAY;
    const el = await mount('sx-account-dialog', { ...props, supportStatus: status(5, true, until) });
    await supportEl(el);
    const t = deepText(el.shadowRoot);
    expect(el.shadowRoot.querySelector('.badge')?.textContent).toContain('Unterstützer');
    expect(t).toContain(`Unterstützer bis ${fmtDate(until)}`);
    expect(t).toContain('5 von 100 Törns · 12 MB von 200 MB · 1 von 20 Booten');
    expect(t).toContain('Danke, dass du Sail Explorer unterstützt!');
    expect(t).not.toContain('kostenlosen Freigaben');
  });

  it('[F-63] abgelaufene Unterstützung: Hinweis mit Datum, Kontingent und Angebot', async () => {
    const until = Date.now() - 10 * DAY;
    const el = await mount('sx-account-dialog', { ...props, supportStatus: status(4, false, until) });
    const s = (await supportEl(el))!;
    const t = deepText(el.shadowRoot);
    expect(t).toContain(`Unterstützung abgelaufen am ${fmtDate(until)}`);
    // über der kostenlosen Grenze: ehrlich „4 von 3“ – Bestehendes bleibt (F-120)
    expect(t).toContain('Kostenlos: 4 von 3 Törns');
    expect(el.shadowRoot.querySelector('.badge')).toBeNull();
    expect(slider(s)).not.toBeNull();
  });

  it('[F-63] eigene Törns zeigen den Löschtermin, in den letzten 14 Tagen hervorgehoben', async () => {
    const later = Date.now() + 60 * DAY;
    const soon = Date.now() + 5 * DAY;
    const el = await mount('sx-account-dialog', {
      ...props,
      supportStatus: status(3),
      shares: [share('S1', later), share('S2', soon), share('S3', null)],
    });
    const rows = [...el.shadowRoot.querySelectorAll('li')];
    expect(rows).toHaveLength(3);
    const exp = (li: Element) => li.querySelector('.expiry');
    expect(exp(rows[0])?.textContent).toContain(`wird gelöscht am ${fmtDate(later)}`);
    expect(exp(rows[0])?.classList.contains('soon')).toBe(false);
    expect(exp(rows[1])?.textContent).toContain(`wird gelöscht am ${fmtDate(soon)}`);
    expect(exp(rows[1])?.classList.contains('soon')).toBe(true);
    expect(exp(rows[2])).toBeNull();
    // Grenze: genau 14 Tage gilt als „bald“
    const edge = await mount('sx-account-dialog', { ...props, supportStatus: status(1), shares: [share('S4', Date.now() + WARN_MS - 60_000)] });
    expect(edge.shadowRoot.querySelector('.expiry')?.classList.contains('soon')).toBe(true);
  });
});
