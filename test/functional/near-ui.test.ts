// @vitest-environment happy-dom
// Startseite: Modus-Wahl „Umgebung | Alles | Mitgliedschaften“, Umkreis und Standort (F-340, F-342, F-343).
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/sx-home-feed';
import '../../src/components/sx-discover';
import '../../src/components/sx-profile-page';
import { readNearPrefs, writeNearPrefs } from '../../src/services/near-prefs';
import { boundingBox, distanceKm, parseCenter, roundCoord, withinRadius } from '../../src/domain/near';

type LitEl = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<string, unknown>;

async function mount(props: Record<string, unknown>, tag = 'sx-home-feed'): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const text = (el: LitEl) => (el.shadowRoot.textContent ?? '').replace(/\s+/g, ' ');
const button = (el: LitEl, label: RegExp) => [...el.shadowRoot.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

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
  localStorage.clear();
});

describe('F-340 Umkreis-Regeln', () => {
  it('[F-340] Entfernung, Rechteck und Auswahl im Umkreis (nächste zuerst)', () => {
    expect(distanceKm({ lat: 52.4, lon: 13.0 }, { lat: 52.4, lon: 13.0 })).toBe(0);
    expect(distanceKm({ lat: 52.39, lon: 13.06 }, { lat: 52.52, lon: 13.4 })).toBeGreaterThan(25);
    expect(distanceKm({ lat: 52.39, lon: 13.06 }, { lat: 52.52, lon: 13.4 })).toBeLessThan(30);
    const b = boundingBox({ lat: 52.4, lon: 13 }, 25);
    expect(b.minLat).toBeLessThan(52.2);
    expect(b.maxLon).toBeGreaterThan(13.3);
    const places = [
      { id: 'fern', lat: 53.5, lon: 10 },
      { id: 'nah', lat: 52.41, lon: 13.01 },
      { id: 'mittel', lat: 52.5, lon: 13.2 },
    ];
    expect(withinRadius({ lat: 52.4, lon: 13 }, 25, places).map((p) => p.id)).toEqual(['nah', 'mittel']);
  });

  it('[F-342] Standort nur grob: auf 0,1° gerundet, ungültige Angaben verworfen', () => {
    expect(roundCoord(52.41987)).toBe(52.4);
    expect(parseCenter('52.456', '13.049')).toEqual({ lat: 52.5, lon: 13 });
    expect(parseCenter('95', '13')).toBeNull();
    expect(parseCenter('', '13')).toBeNull();
  });
});

describe('F-343 Startseite: Modus, Umkreis, Standort', () => {
  it('[F-343] Gäste: Umgebung und Alles, Angemeldete zusätzlich Mitgliedschaften; Wechsel meldet sx-stream-mode', async () => {
    const modes = listen('sx-stream-mode');
    const guest = await mount({ signedIn: false, mode: 'near', shown: 'near', near: { state: 'ok', source: 'geo', places: 3, center: null } });
    expect(button(guest, /Mitgliedschaften/)).toBeUndefined();
    expect(button(guest, /Umgebung/)!.getAttribute('aria-pressed')).toBe('true');
    button(guest, /^Alles$/)!.click();
    expect(modes).toEqual([{ mode: 'all' }]);
    const member = await mount({ signedIn: true, mode: 'mine', shown: 'mine' });
    expect(button(member, /Mitgliedschaften/)!.getAttribute('aria-pressed')).toBe('true');
    expect(text(member)).toContain('Neuigkeiten aus deinem Verein, Hafen und Team');
  });

  it('[F-343] Umgebung: Umkreis-Chips, Mittelpunkt, Standort vergessen bzw. verwenden', async () => {
    const radius = listen('sx-near-radius');
    const forget = listen('sx-near-forget');
    const locate = listen('sx-near-locate');
    const el = await mount({ signedIn: true, mode: 'near', shown: 'near', radius: 25, near: { state: 'ok', source: 'geo', places: 12, center: null } });
    expect(text(el)).toContain('Neues aus deiner Umgebung');
    expect(text(el)).toContain('um deinen Standort · 12 Orte');
    button(el, /^50 km$/)!.click();
    expect(radius).toEqual([{ radius: 50 }]);
    button(el, /Standort vergessen/)!.click();
    expect(forget).toHaveLength(1);
    const harbor = await mount({ signedIn: true, mode: 'near', shown: 'near', radius: 25, near: { state: 'ok', source: 'harbor', places: 2, center: 'Potsdam' } });
    expect(text(harbor)).toContain('um Potsdam');
    button(harbor, /meinen Standort verwenden/)!.click();
    expect(locate).toHaveLength(1);
  });

  it('[F-343] ohne Mittelpunkt: Hinweis und „Alles“ als Ersatz – Gäste ohne Heimathafen-Knopf', async () => {
    const guest = await mount({ signedIn: false, mode: 'near', shown: 'all', near: { state: 'missing', source: null, places: 0, center: null } });
    expect(text(guest)).toContain('Für deine Umgebung brauchen wir einen Ort');
    expect(text(guest)).toContain('bis dahin siehst du alles');
    expect(button(guest, /Heimathafen wählen/)).toBeUndefined();
    expect(text(guest)).toContain('Neues aus der Community');
    const member = await mount({ signedIn: true, mode: 'near', shown: 'all', near: { state: 'no_position', source: 'harbor', places: 0, center: 'Werder' } });
    expect(text(member)).toContain('Für deinen Heimathafen Werder ist noch keine Position eingetragen');
    expect(button(member, /Heimathafen wählen/)).toBeDefined();
  });

  it('[F-342] Wahl nur auf diesem Gerät: Modus, Umkreis und grober Standort in localStorage, Standard Umgebung 25 km', () => {
    expect(readNearPrefs()).toEqual({ mode: 'near', radius: 25, geo: null });
    writeNearPrefs({ mode: 'all', radius: 50, geo: { lat: 52.4, lon: 13 } });
    expect(readNearPrefs()).toEqual({ mode: 'all', radius: 50, geo: { lat: 52.4, lon: 13 } });
    localStorage.setItem('sx-near', JSON.stringify({ mode: 'x', radius: 7, geo: { lat: 52.4567, lon: 13.0123 } }));
    expect(readNearPrefs()).toEqual({ mode: 'near', radius: 25, geo: { lat: 52.5, lon: 13 } });
  });
});

describe('F-344/F-345 Entdecken in der Nähe, Hafen-Position', () => {
  const data = { voyages: [], boats: [], people: [], groups: [], harbors: [{ slug: 'werder', name: 'Werder', boats: 2, groups: 1, km: 7 }], query: '', near: true };

  it('[F-344] Umschalter „In der Nähe | Überall“, Umkreis-Chips, Häfen mit Entfernung; ohne Mittelpunkt Standort-Knopf', async () => {
    const near = listen('sx-discover-near');
    const radius = listen('sx-discover-radius');
    const locate = listen('sx-discover-locate');
    const el = await mount({ variant: 'page', data, near: { on: true, radius: 25, center: 'Potsdam' } }, 'sx-discover');
    expect(button(el, /In der Nähe/)!.getAttribute('aria-pressed')).toBe('true');
    expect(text(el)).toContain('um Potsdam');
    expect(text(el)).toContain('Werder · 7 km');
    button(el, /^100 km$/)!.click();
    expect(radius).toEqual([{ radius: 100 }]);
    button(el, /Überall/)!.click();
    expect(near).toEqual([{ on: false }]);
    const none = await mount({ variant: 'page', data: { ...data, near: false }, near: { on: true, radius: 25, center: null } }, 'sx-discover');
    button(none, /Meinen Standort verwenden/)!.click();
    expect(locate).toHaveLength(1);
  });

  it('[F-345] Hafen bearbeiten: „Position von hier übernehmen“ füllt Breite und Länge (5 Stellen), gespeichert wird erst mit Speichern', async () => {
    const geo = { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: 52.3912345, longitude: 13.0654321 } }) };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    const harbor = { id: 'H1', slug: 'potsdam', name: 'Potsdam', lat: null, lon: null, canEdit: true };
    const el = await mount({ data: { kind: 'harbor', harbor: { ...harbor, createdAt: 0 }, club: null, clubChoices: [], canClearClub: false, boats: [], voyages: [], groups: [], stats: { boats: 0, voyages: 0, distNm: 0, seasonNm: 0 }, social: { followers: 0, isFollowing: false } }, editing: true }, 'sx-profile-page');
    const btn = button(el, /Position von hier übernehmen/);
    expect(btn).toBeDefined();
    btn!.click();
    await vi.waitFor(() => expect((el.shadowRoot.querySelector('input[name="lat"]') as HTMLInputElement).value).toBe('52,39123'));
    expect((el.shadowRoot.querySelector('input[name="lon"]') as HTMLInputElement).value).toBe('13,06543');
    expect(text(el)).toContain('Position übernommen');
  });
});
