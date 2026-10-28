// @vitest-environment happy-dom
// Geteilter Törn: „von <Profil> · in <Verein/Team>“ mit Links (F-228).
import { describe, expect, it } from 'vitest';
import '../../src/components/sx-voyage-byline';

type El = HTMLElement & { share: unknown; updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };

describe('Törn-Zeile „von … in …“', () => {
  it('[F-228] verlinkt Profil und Gruppen; ohne beides leer', async () => {
    const el = document.createElement('sx-voyage-byline') as El;
    el.share = { sailor: { handle: 'anna', displayName: 'Anna' }, groups: [{ slug: 'moewe', name: 'Möwe', kind: 'club' }, { slug: 'jolle', name: 'Jolle', kind: 'team' }] };
    document.body.append(el);
    await el.updateComplete;
    const links = [...el.shadowRoot.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent!.trim()]);
    expect(links).toEqual([['/u/anna', 'Anna'], ['/g/moewe', 'Verein Möwe'], ['/g/jolle', 'Team Jolle']]);
    el.share = { sailor: null, groups: [] };
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('p')).toBeNull();
  });
});
