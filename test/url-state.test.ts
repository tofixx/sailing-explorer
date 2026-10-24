import { describe, expect, it } from 'vitest';
import { parseRoute, parseView, sampleTrackUrl, serializeView } from '../src/services/url-state';
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
