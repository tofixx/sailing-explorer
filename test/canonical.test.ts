import { describe, expect, it } from 'vitest';
import { canonicalRedirect } from '../worker/canonical';

const env = { CANONICAL_HOST: 'segeln-potsdam.de', ALIAS_HOSTS: 'www.segeln-potsdam.de,sailing.wollow.ski' };
const go = (u: string, e: Parameters<typeof canonicalRedirect>[1] = env) => canonicalRedirect(new URL(u), e);

describe('F-180 Hauptdomain und Weiterleitungen', () => {
  it('[F-180] Hauptdomain bleibt, wie sie ist', () => {
    expect(go('https://segeln-potsdam.de/s/AbCdEfGhJkLmNpQr23')).toBeNull();
  });

  it('[F-180] www., Subdomains und alte Domain leiten mit Pfad und Query dauerhaft weiter', () => {
    for (const u of ['https://www.segeln-potsdam.de/u/anna?m=wind', 'https://sailing.wollow.ski/u/anna?m=wind', 'https://irgendwas.segeln-potsdam.de/u/anna?m=wind']) {
      const r = go(u)!;
      expect(r.status).toBe(301);
      expect(r.headers.get('Location')).toBe('https://segeln-potsdam.de/u/anna?m=wind');
    }
  });

  it('[F-180] Stripe-Webhook antwortet unter jeder Adresse direkt (Stripe folgt keiner Weiterleitung)', () => {
    expect(go('https://sailing.wollow.ski/api/webhooks/stripe')).toBeNull();
  });

  it('[F-180] fremde Hosts (Vorschauen, lokal) und leere Konfiguration: keine Weiterleitung', () => {
    expect(go('https://sailing-social.wollow.ski/')).toBeNull();
    expect(go('http://localhost:5173/')).toBeNull();
    expect(go('https://sailing.wollow.ski/', { CANONICAL_HOST: '', ALIAS_HOSTS: '' })).toBeNull();
    expect(go('https://evilsegeln-potsdam.de/')).toBeNull();
  });
});
