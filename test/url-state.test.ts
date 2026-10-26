import { describe, expect, it } from 'vitest';
import { absoluteLink, parseRoute, parseView, routePath, sampleTrackUrl, serializeView } from '../src/services/url-state';
import { shareImageUrl } from '../src/services/api';
import { initialState } from '../src/services/store';

const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('parseRoute', () => {
  it('erkennt Freigaben, Login, Dateien und Inline-Links', () => {
    expect(parseRoute(loc('/s/AbCdEf234567xyz'))).toEqual({ kind: 'share', id: 'AbCdEf234567xyz' });
    expect(parseRoute(loc('/login', '', '#token=abc_-123'))).toEqual({ kind: 'login', token: 'abc_-123' });
    expect(parseRoute(loc('/', '?track=a.gpx,b'))).toEqual({ kind: 'files', names: ['a.gpx', 'b'] });
    expect(parseRoute(loc('/', '', '#g=eJxL'))).toEqual({ kind: 'inline', data: 'eJxL' });
    expect(parseRoute(loc('/'))).toEqual({ kind: 'home' });
  });

  it('[F-70] /entdecken ist die Entdecken-Seite', () => {
    expect(parseRoute(loc('/entdecken'))).toEqual({ kind: 'discover' });
    expect(parseRoute(loc('/entdecken/'))).toEqual({ kind: 'discover' });
    expect(parseRoute(loc('/entdeckenx')).kind).toBe('home');
  });

  it('akzeptiert keine kaputten Share-IDs', () => {
    expect(parseRoute(loc('/s/../../etc')).kind).toBe('home');
    expect(parseRoute(loc('/s/short')).kind).toBe('home');
  });

  it('[Phase A] liest den Schlüssel aus /s/:id/:key, /b/:id/:key und /u/:handle/:key', () => {
    const key = 'Kq7mPz2xWv9tRb4nHs6dJf';
    expect(parseRoute(loc(`/s/AbCdEfGhJkLmNpQr23/${key}`, '?m=wind&l=s'))).toEqual({ kind: 'share', id: 'AbCdEfGhJkLmNpQr23', key });
    expect(parseRoute(loc(`/b/BoatId1234567890/${key}/`))).toEqual({ kind: 'boat', id: 'BoatId1234567890', key });
    expect(parseRoute(loc(`/u/Anna-Segelt/${key}`))).toEqual({ kind: 'profile', handle: 'anna-segelt', key });
  });

  it('[Phase A] ohne Schlüssel bleibt die Route wie bisher (kein key-Feld)', () => {
    expect(parseRoute(loc('/s/AbCdEfGhJkLmNpQr23'))).not.toHaveProperty('key');
    expect(parseRoute(loc('/u/anna'))).not.toHaveProperty('key');
  });

  it('[Phase A] kaputte Schlüssel oder zusätzliche Segmente werden nicht als Freigabe erkannt', () => {
    expect(parseRoute(loc('/s/AbCdEfGhJkLmNpQr23/kurz')).kind).toBe('home');
    expect(parseRoute(loc('/s/AbCdEfGhJkLmNpQr23/Kq7mPz2xWv9tRb4nHs6dJf/x')).kind).toBe('home');
    expect(parseRoute(loc('/s/AbCdEfGhJkLmNpQr23/Kq7mPz2x-Wv9tRb4nHs6dJf')).kind).toBe('home');
    expect(parseRoute(loc('/b/BoatId1234567890/../../etc')).kind).toBe('home');
  });
});

describe('Links mit Schlüssel', () => {
  it('[Phase A] routePath hängt den Schlüssel nur an, wenn es einen gibt', () => {
    expect(routePath('s', 'AbCdEfGhJkLmNpQr23', 'Key1234567890abcdefgh')).toBe('/s/AbCdEfGhJkLmNpQr23/Key1234567890abcdefgh');
    expect(routePath('s', 'AbCdEfGhJkLmNpQr23', null)).toBe('/s/AbCdEfGhJkLmNpQr23');
    expect(routePath('u', 'anna')).toBe('/u/anna');
  });

  it('[Phase A] absoluteLink: link vom Server hat Vorrang, sonst aus Stufe und Schlüssel', () => {
    const o = 'https://sailing.example';
    expect(absoluteLink('s', 'X', { visibility: 'unlisted', shareKey: 'K', link: '/s/X/K' }, o)).toBe(`${o}/s/X/K`);
    expect(absoluteLink('s', 'X', { visibility: 'unlisted', shareKey: 'K' }, o)).toBe(`${o}/s/X/K`);
    expect(absoluteLink('s', 'X', { visibility: 'public', shareKey: 'K' }, o)).toBe(`${o}/s/X`);
    // Altbestand ohne Schlüssel
    expect(absoluteLink('b', 'B', { visibility: 'unlisted', shareKey: null }, o)).toBe(`${o}/b/B`);
  });

  it('[Phase A] Übersichtsbild mit Schlüssel als ?k= (Bilder können keine Header setzen)', () => {
    expect(shareImageUrl('AbCdEfGhJkLmNpQr23')).toBe('/api/shares/AbCdEfGhJkLmNpQr23/image');
    expect(shareImageUrl('AbCdEfGhJkLmNpQr23', 'Key1234567890abcdefgh')).toBe('/api/shares/AbCdEfGhJkLmNpQr23/image?k=Key1234567890abcdefgh');
  });
});

describe('sampleTrackUrl', () => {
  it('erlaubt nur einfache Dateinamen', () => {
    expect(sampleTrackUrl('20260613_Stralsund_Prerow')).toBe('/tracks/20260613_Stralsund_Prerow.gpx');
    expect(sampleTrackUrl('a.gpx')).toBe('/tracks/a.gpx');
    expect(sampleTrackUrl('../secret')).toBeNull();
    expect(sampleTrackUrl('https://evil.example/x')).toBeNull();
    expect(sampleTrackUrl('dir/file')).toBeNull();
  });
});

describe('Ansichtszustand', () => {
  it('Roundtrip', () => {
    const layers = { seamarks: false, depth: true, windArrows: true, waveArrows: false };
    const q = serializeView('wave', layers);
    expect(q).toBe('m=wave&l=d,w');
    expect(parseView(q)).toEqual({ metric: 'wave', layers });
  });
  it('ignoriert unbekannte Werte', () => {
    expect(parseView('m=evil&x=1')).toEqual({});
  });
  it('Standard-Ansicht ist serialisierbar', () => {
    expect(serializeView(initialState.metric, initialState.layers)).toBe('m=speed&l=s,w,v');
  });
});
