// @vitest-environment happy-dom
// Geteilter Törn: „von <Profil> auf <Boot> in <Verein/Team>“ mit Links (F-228, F-533); Icons je Objektart (F-532).
import { describe, expect, it } from 'vitest';
import '../../src/components/sx-voyage-byline';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENTITY_ICON, groupIcon } from '../../src/components/icons';

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
    el.share = null;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('sx-title-edit')).toBeNull();
  });

  it('[F-533] nennt das Boot mit Link, wenn der Server es freigibt; sonst nicht', async () => {
    const el = document.createElement('sx-voyage-byline') as El;
    el.share = { sailor: null, groups: [], boatPage: { id: 'BoatId123456', name: 'Möwe' } };
    document.body.append(el);
    await el.updateComplete;
    const a = el.shadowRoot.querySelector<HTMLAnchorElement>('p a')!;
    expect([a.getAttribute('href'), a.textContent!.trim(), a.title]).toEqual(['/b/BoatId123456', 'Möwe', 'Boot Möwe']);
    expect(el.shadowRoot.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('auf Möwe');
    // nur `boat` (Listen-Feld, nennt der Eigentümer:in auch nicht öffentliche Boote) reicht nicht
    el.share = { sailor: null, groups: [], boat: { id: 'BoatId123456', name: 'Möwe' }, boatPage: null };
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('p')).toBeNull();
    el.remove();
  });
});

describe('ENTITY_ICON (F-532)', () => {
  it('[F-532] ein Icon je Objektart, alle verschieden; Team ≠ Boot, Verein ≠ Hafen', () => {
    const values = Object.values(ENTITY_ICON);
    expect(new Set(values).size).toBe(values.length);
    expect(ENTITY_ICON.team).not.toBe(ENTITY_ICON.boat);
    expect(ENTITY_ICON.club).not.toBe(ENTITY_ICON.harbor);
    expect([groupIcon('club'), groupIcon('team')]).toEqual([ENTITY_ICON.club, ENTITY_ICON.team]);
  });

  it('[F-532] Gruppen-Nennungen wählen das Icon über groupIcon statt eigener Regeln', () => {
    const dir = resolve('src/components');
    const adHoc = readdirSync(dir).filter((f) => f.endsWith('.ts') && /icon\(g\.kind === /.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(adHoc).toEqual([]);
    const byline = readFileSync(resolve(dir, 'sx-voyage-byline.ts'), 'utf8');
    expect(byline).toContain('groupIcon(g.kind)');
    expect(byline).not.toContain("icon('sail')");
  });
});
