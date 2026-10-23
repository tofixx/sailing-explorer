// Funktionale Tests: Links, Ansichtszustand, Komprimierung, API-Client (F-06, F-33, F-34, F-36, F-40)
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, validatePayload } from '../../src/services/api';
import { MAX_INFLATED_BYTES, deflateToBase64Url, gzipString, inflateFromBase64Url, readCapped } from '../../src/services/compress';
import { initialState } from '../../src/services/store';
import { parseRoute, parseView, sampleTrackUrl, serializeView } from '../../src/services/url-state';
import { PAYLOAD_PREFIX, cleanView, isGzip } from '../../worker/validate';

const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const gunzip = async (bytes: Uint8Array<ArrayBuffer>) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();

afterEach(() => vi.unstubAllGlobals());

describe('F-06 Beispiel-Tracks und ?track=', () => {
  it('[F-06] ?track=<name> lädt Dateien nur aus /tracks/', () => {
    const r = parseRoute(loc('/', '?track=20260613_Stralsund_Prerow'));
    expect(r).toEqual({ kind: 'files', names: ['20260613_Stralsund_Prerow'] });
    expect(sampleTrackUrl('20260613_Stralsund_Prerow')).toBe('/tracks/20260613_Stralsund_Prerow.gpx');
  });

  it('[F-06] mehrere Tracks per ?track=a&track=b, ?tracks=a,b oder ?t=', () => {
    expect(parseRoute(loc('/', '?track=a&track=b'))).toEqual({ kind: 'files', names: ['a', 'b'] });
    expect(parseRoute(loc('/', '?tracks=a, b ,'))).toEqual({ kind: 'files', names: ['a', 'b'] });
    expect(parseRoute(loc('/', '?t=x.gpx'))).toEqual({ kind: 'files', names: ['x.gpx'] });
  });

  it('[F-06] Pfade, fremde Hosts und Protokolle werden verworfen', () => {
    for (const bad of ['../secret', '..', 'a/b', 'https://evil.example/x.gpx', '//evil.example/x', 'C:\\win', '%2e%2e/x', 'a b', 'x'.repeat(101), '']) {
      expect(sampleTrackUrl(bad), bad).toBeNull();
    }
  });

  it('[F-06] die Beispiel-Tracks des Startbildschirms sind gültige /tracks/-Namen', () => {
    for (const f of ['20260613_Stralsund_Prerow', '20260614_Prerow_Rostock']) expect(sampleTrackUrl(f)).toBe(`/tracks/${f}.gpx`);
  });
});

describe('F-33 Freigabe-Payload (Client ↔ Worker-Vertrag)', () => {
  it('[F-33] der Client erzeugt gzip-Daten, die der Worker akzeptiert ({"v":1,…})', async () => {
    const payload = validatePayload({ v: 1, tracks: [{ name: 'A', gpx: '<gpx/>' }] });
    const gz = await gzipString(JSON.stringify(payload));
    expect(isGzip(gz)).toBe(true);
    const text = await gunzip(gz);
    expect(text.startsWith(PAYLOAD_PREFIX)).toBe(true);
    expect(JSON.parse(text)).toEqual(payload);
  });

  it('[F-33] die mitgegebene Ansicht besteht die Server-Validierung', () => {
    const view = serializeView('wave', { seamarks: true, depth: true, windArrows: false, waveArrows: true });
    expect(cleanView(view)).toBe(view);
    expect(cleanView(serializeView(initialState.metric, initialState.layers))).toBe('m=speed&l=s,w,v');
  });

  it('[F-33] validatePayload weist fremde/kaputte Daten zurück', () => {
    const bad = [null, {}, { v: 2, tracks: [{ name: 'a', gpx: 'b' }] }, { v: 1, tracks: [] }, { v: 1, tracks: [{ name: 1, gpx: 'x' }] }, { v: 1, tracks: Array(21).fill({ name: 'a', gpx: 'b' }) }];
    for (const b of bad) expect(() => validatePayload(b)).toThrow('Ungültiges Freigabe-Format');
  });

  it('[F-33] createShare sendet Titel/Kurzinfo/Ansicht URL-kodiert in Headern, Daten als gzip', async () => {
    const fetchMock = vi.fn(async () => json({ share: { id: 'AbCdEfGhJkLmNpQr23' } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const gz = await gzipString('{"v":1,"tracks":[]}');
    const meta = { title: 'Stralsund → Prerow', summary: '28,4 sm · 13.06.2026', view: 'm=wind&l=s', trackCount: 2, visibility: 'private' };
    // weitere (neuere) Metadatenfelder neutral belegen
    const res = await api.createShare(gz, { listed: false, boatId: null, distNm: 28.4, startedAt: null, ...meta } as Parameters<typeof api.createShare>[1]);
    expect(res.share.id).toBe('AbCdEfGhJkLmNpQr23');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/shares');
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/gzip');
    expect(decodeURIComponent(h['X-Share-Title'])).toBe('Stralsund → Prerow');
    expect(decodeURIComponent(h['X-Share-Summary'])).toBe('28,4 sm · 13.06.2026');
    expect(decodeURIComponent(h['X-Share-View'])).toBe('m=wind&l=s');
    expect(h['X-Share-Tracks']).toBe('2');
    expect(h['X-Share-Visibility']).toBe('private');
    expect(init.body).toBe(gz);
  });
});

describe('F-34 Ansichtszustand in der URL', () => {
  it('[F-34] /s/<id> wird als Freigabe erkannt, ?m=…&l=… als Ansicht', () => {
    expect(parseRoute(loc('/s/AbCdEfGhJkLmNpQr23', '?m=wind&l=s,w'))).toEqual({ kind: 'share', id: 'AbCdEfGhJkLmNpQr23' });
    expect(parseView('m=wind&l=s,w')).toEqual({ metric: 'wind', layers: { seamarks: true, depth: false, windArrows: true, waveArrows: false } });
  });

  it('[F-34] Ansicht aus der URL überschreibt die beim Teilen gespeicherte', () => {
    // so kombiniert App.openShare: { ...parseView(share.view), ...parseView(location.search) }
    const merged = { ...parseView('m=gust&l=d'), ...parseView('m=wave') };
    expect(merged).toEqual({ metric: 'wave', layers: { seamarks: false, depth: true, windArrows: false, waveArrows: false } });
  });

  it('[F-34] alle Kombinationen überstehen den Roundtrip', () => {
    const metrics = ['speed', 'wind', 'gust', 'wave'] as const;
    for (const m of metrics)
      for (let bits = 0; bits < 16; bits++) {
        const layers = { seamarks: !!(bits & 1), depth: !!(bits & 2), windArrows: !!(bits & 4), waveArrows: !!(bits & 8) };
        expect(parseView(serializeView(m, layers))).toEqual({ metric: m, layers });
      }
  });

  it('[F-34] leerer Ebenen-Parameter schaltet alle Ebenen aus, fehlender lässt sie unverändert', () => {
    expect(parseView('m=speed&l=').layers).toEqual({ seamarks: false, depth: false, windArrows: false, waveArrows: false });
    expect(parseView('m=speed').layers).toBeUndefined();
  });
});

describe('F-36 API-Client für „Meine Tracks“', () => {
  it('[F-36] Umbenennen/Sichtbarkeit (PATCH) und Löschen (DELETE) auf /api/shares/<id>', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ share: { id: 'x', title: 'Neu' } })));
    vi.stubGlobal('fetch', fetchMock);
    await api.updateShare('AbCdEfGhJkLmNpQr23', { title: 'Neu', visibility: 'private' });
    expect(await api.deleteShare('AbCdEfGhJkLmNpQr23')).toBeUndefined();
    const [u1, i1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([u1, i1.method, JSON.parse(String(i1.body))]).toEqual(['/api/shares/AbCdEfGhJkLmNpQr23', 'PATCH', { title: 'Neu', visibility: 'private' }]);
    const [u2, i2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect([u2, i2.method]).toEqual(['/api/shares/AbCdEfGhJkLmNpQr23', 'DELETE']);
  });

  it('[F-36] IDs werden URL-kodiert (kein Pfad-Ausbruch)', async () => {
    const fetchMock = vi.fn(async () => json({ share: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await api.shareMeta('../account');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/shares/..%2Faccount');
  });

  it('[F-36] Serverfehler werden als ApiError mit Status, Code und Meldung gemeldet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'not_found', message: 'Diese Freigabe gibt es nicht (mehr).' }, 404)));
    const err = await api.shareMeta('AbCdEfGhJkLmNpQr23').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'Diese Freigabe gibt es nicht (mehr).' });
  });
});

describe('F-40 Ohne Backend / Links mit eingebetteten Daten', () => {
  it('[F-40] statisches Hosting (index.html statt JSON) wird als „kein Backend“ erkannt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } })));
    const err = await api.config().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('no_backend');
  });

  it('[F-40] Netzwerkfehler → ApiError „offline“', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await api.me().catch((e) => e.code)).toBe('offline');
  });

  it('[F-40] eingebettete Daten: Roundtrip über #g=… (base64url, URL-sicher)', async () => {
    const raws = ['<gpx>eins</gpx>', '<gpx>zwei – äöü</gpx>'];
    const data = await deflateToBase64Url(JSON.stringify(raws));
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseRoute(loc('/', '', `#g=${data}`))).toEqual({ kind: 'inline', data });
    expect(JSON.parse(await inflateFromBase64Url(data))).toEqual(raws);
  });

  it('[F-40] alte #g=-Links (pako/zlib deflate) funktionieren weiter', async () => {
    const raws = ['<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="54" lon="13"/></trkseg></trk></gpx>'];
    const legacy = deflateSync(Buffer.from(JSON.stringify(raws))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(parseRoute(loc('/', '', `#g=${legacy}`)).kind).toBe('inline');
    expect(JSON.parse(await inflateFromBase64Url(legacy))).toEqual(raws);
  });

  it('[F-40] #g= wird auch hinter anderen Hash-Parametern erkannt', () => {
    expect(parseRoute(loc('/', '', '#x=1&g=abc_-'))).toEqual({ kind: 'inline', data: 'abc_-' });
  });
});

describe('Dekomprimierung fremder Daten (F-34, F-40)', () => {
  it('[F-34] gzip-Roundtrip über readCapped (wie beim Laden einer Freigabe)', async () => {
    const text = JSON.stringify({ v: 1, tracks: [{ name: 'Ä', gpx: 'x'.repeat(100_000) }] });
    const gz = await gzipString(text);
    expect(gz.length).toBeLessThan(text.length / 10);
    const out = await readCapped(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')));
    expect(out).toBe(text);
  });

  it('[F-34] Zip-Bombe: Entpacken bricht oberhalb des Limits ab', async () => {
    const gz = await gzipString('\0'.repeat(2_000_000));
    expect(gz.length).toBeLessThan(10_000);
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
    await expect(readCapped(stream, 500_000)).rejects.toThrow('Daten sind zu groß');
  });

  it('[F-40] auch #g=-Links unterliegen dem Limit (Standard 80 MB)', async () => {
    expect(MAX_INFLATED_BYTES).toBe(80 * 1024 * 1024);
    // 81 MB Nullen komprimieren auf ~80 kB
    const bomb = deflateSync(Buffer.alloc(81 * 1024 * 1024)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await expect(inflateFromBase64Url(bomb)).rejects.toThrow('Daten sind zu groß');
  }, 30_000);

  it('[F-40] Multibyte-Zeichen über Chunk-Grenzen bleiben intakt', async () => {
    const text = 'ö'.repeat(300_000);
    const out = await readCapped(new Blob([new TextEncoder().encode(text)]).stream());
    expect(out).toBe(text);
  });
});
