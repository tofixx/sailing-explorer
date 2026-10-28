// @vitest-environment happy-dom
// Fahrtenbuch in der Oberfläche (Konzept 19): Panel mit Angaben und Abzeichen, Formular mit Prüfung vorab.
import { describe, expect, it } from 'vitest';
import '../../src/components/sx-logbook-panel';
import '../../src/components/sx-logbook-form';

type El = HTMLElement & Record<string, unknown> & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };

const share = (o: Record<string, unknown> = {}) => ({
  id: 'LogShareId23456789', title: 'Potsdam → Werder', visibility: 'public', isOwner: true, distNm: 14, startedAt: Date.UTC(2026, 5, 13, 10), endedAt: null,
  source: 'manual', distSource: 'stated', boat: null,
  from: { id: 'H1', slug: 'potsdam', name: 'Potsdam', lat: 52.39, lon: 13.06 },
  to: { id: 'H2', slug: 'werder', name: 'Werder', lat: 52.38, lon: 12.94 },
  log: { wind: { bft: 4, dir: 'W' }, berth: 'Steg B', notes: 'Zeile 1\nZeile 2' },
  ...o,
});

async function mount(tag: string, props: Record<string, unknown>): Promise<El> {
  const el = document.createElement(tag) as El;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('Fahrtenbuch-Panel', () => {
  it('[F-302] Eintrag ohne GPX: Abzeichen, Häfen verlinkt, Strecke mit Herkunft, Angaben; „Bearbeiten“ nur für den Eigentümer', async () => {
    const el = await mount('sx-logbook-panel', { share: share() });
    const text = el.shadowRoot.textContent!.replace(/\s+/g, ' ');
    expect(el.shadowRoot.querySelector('.logtag')?.textContent).toContain('Fahrtenbuch');
    expect([...el.shadowRoot.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/h/potsdam', '/h/werder']);
    expect(text).toContain('14,0 sm (Angabe)');
    expect(text).toContain('4 Bft W (Fahrtenbuch)');
    expect(text).toContain('Steg B');
    let edited: unknown = null;
    el.addEventListener('sx-logbook-edit', (e) => (edited = (e as CustomEvent).detail));
    el.shadowRoot.querySelector('button')!.click();
    expect(edited).toMatchObject({ id: 'LogShareId23456789' });
    el.share = share({ isOwner: false });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('button')).toBeNull();
  });

  it('[F-301] GPX-Törn: nur befüllte Angaben, kein Abzeichen; ohne Angaben und Häfen leer', async () => {
    const el = await mount('sx-logbook-panel', { share: share({ source: 'gpx', distSource: 'track', from: null, to: null, log: { engineH: 2 } }) });
    expect(el.shadowRoot.querySelector('.logtag')).toBeNull();
    expect(el.shadowRoot.textContent).toContain('2,0 h');
    el.share = share({ source: 'gpx', from: null, to: null, log: {} });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('dl')).toBeNull();
  });
});

describe('Fahrtenbuch-Formular', () => {
  it('[F-304] prüft vorab wie der Server und meldet erst gültige Eingaben (Bearbeiten → PATCH)', async () => {
    const el = await mount('sx-logbook-form', { share: share({ log: {} }), open: true });
    await el.updateComplete;
    const saves: unknown[] = [];
    el.addEventListener('sx-logbook-save', (e) => saves.push((e as CustomEvent).detail));
    const dist = el.shadowRoot.querySelector<HTMLInputElement>('[name="dist"]')!;
    const submit = () => el.shadowRoot.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    dist.value = '1';
    submit();
    await el.updateComplete;
    expect(saves).toHaveLength(0);
    expect(el.shadowRoot.querySelector('.error')?.textContent).toMatch(/kürzer als die direkte Linie/);
    dist.value = '9,5';
    submit();
    expect(saves).toEqual([{ id: 'LogShareId23456789', patch: expect.objectContaining({ distNm: 9.5, fromHarbor: { harborId: 'H1' }, toHarbor: { harborId: 'H2' } }) }]);
  });
});
