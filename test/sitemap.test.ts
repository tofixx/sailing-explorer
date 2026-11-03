// Auffindbarkeit (F-545): Die Produktions-Konfiguration ist indexierbar – CANONICAL_HOST gesetzt und gleich dem Host
// von APP_ORIGIN; die Vorschau leert CANONICAL_HOST und ist damit nie indexierbar.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexableHost } from '../worker/canonical';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const wranglerVar = (name: string) => new RegExp(`"${name}": *"([^"]*)"`).exec(read('wrangler.jsonc'))?.[1];

describe('F-545 Produktion indexierbar, Vorschau nicht', () => {
  it('[F-545] wrangler.jsonc: CANONICAL_HOST nicht leer und gleich dem Host von APP_ORIGIN', () => {
    const canonical = wranglerVar('CANONICAL_HOST');
    const origin = wranglerVar('APP_ORIGIN');
    expect(canonical).toBeTruthy();
    expect(origin).toBeTruthy();
    expect(new URL(origin!).hostname).toBe(canonical);
    expect(indexableHost(new URL(`${origin}/g/verein`), { CANONICAL_HOST: canonical })).toBe(true);
  });

  it('[F-545] Vorschau (CANONICAL_HOST leer), fremde Hosts und Subdomains sind nicht indexierbar', () => {
    expect(read('scripts/deploy-preview.mjs')).toMatch(/CANONICAL_HOST: ''/);
    const canonical = wranglerVar('CANONICAL_HOST')!;
    for (const [u, c] of [
      [`https://dev-x.${canonical}/`, ''],
      [`https://dev-x.${canonical}/`, canonical],
      ['http://localhost:5173/', canonical],
      [`https://${canonical}/`, undefined],
    ] as const) {
      expect(indexableHost(new URL(u), { CANONICAL_HOST: c }), `${u} ${c}`).toBe(false);
    }
  });
});
