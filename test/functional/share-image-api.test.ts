// Funktionale Tests: Übersichtsbild einer Freigabe (F-47) – echter Worker mit lokalem D1/R2.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShare, login, startWorker, type Harness } from './worker-harness';

let h: Harness;
let n = 0;
const email = () => `img${++n}-${Date.now()}@example.org`;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

/** Kleinstes gültiges JPEG-Präfix reicht – der Worker prüft nur die Signatur. */
const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(1), 0xff, 0xd9]);

async function newShare(cookie: string, visibility: 'unlisted' | 'private' = 'unlisted') {
  const res = await createShare(h, cookie, { visibility });
  expect(res.status).toBe(201);
  return ((await res.json()) as { share: { id: string; hasImage: boolean } }).share;
}

const putImage = (id: string, cookie: string | undefined, body: Uint8Array<ArrayBuffer> = JPEG, type = 'image/jpeg') =>
  h.fetch(`/api/shares/${id}/image`, { method: 'PUT', cookie, headers: { 'Content-Type': type }, body });

describe('F-47 Übersichtsbild', () => {
  it('[F-47] Besitzer lädt ein JPEG hoch, es ist danach öffentlich abrufbar', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    expect(s.hasImage).toBe(false);
    expect((await putImage(s.id, cookie)).status).toBe(204);
    const res = await h.fetch(`/api/shares/${s.id}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toContain('public');
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 3)).toEqual(JPEG.slice(0, 3));
    const meta = (await (await h.fetch(`/api/shares/${s.id}`)).json()) as { share: { hasImage: boolean } };
    expect(meta.share.hasImage).toBe(true);
  });

  it('[F-47] nur der Besitzer darf hochladen; fremd → 404, anonym → 401', async () => {
    const owner = await login(h, email());
    const other = await login(h, email());
    const s = await newShare(owner.cookie);
    expect((await putImage(s.id, other.cookie)).status).toBe(404);
    expect((await putImage(s.id, undefined)).status).toBe(401);
  });

  it('[F-47] nur JPEG: falscher Typ oder falsche Signatur werden abgelehnt', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    expect((await putImage(s.id, cookie, JPEG, 'image/png')).status).toBe(415);
    expect((await putImage(s.id, cookie, new TextEncoder().encode('<svg onload=alert(1)>'))).status).toBe(400);
  });

  it('[F-47] zu große Bilder werden abgelehnt', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    const big = new Uint8Array(1.6 * 1024 * 1024);
    big.set(JPEG.slice(0, 4));
    // Der Worker bricht früh ab; unter Last kann der Client dabei ECONNRESET sehen → bis zu 3 Versuche.
    let status = 0;
    for (let i = 0; i < 3 && !status; i++) status = await putImage(s.id, cookie, big).then((r) => r.status, () => 0);
    expect(status).toBe(413);
  });

  it('[F-47] private Freigabe: Bild nur für den Besitzer', async () => {
    const owner = await login(h, email());
    const s = await newShare(owner.cookie, 'private');
    await putImage(s.id, owner.cookie);
    expect((await h.fetch(`/api/shares/${s.id}/image`)).status).toBe(404);
    const mine = await h.fetch(`/api/shares/${s.id}/image`, { cookie: owner.cookie });
    expect(mine.status).toBe(200);
    expect(mine.headers.get('Cache-Control')).toContain('private');
  });

  it('[F-47] Link-Vorschau enthält og:image nur mit Bild und nur öffentlich', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    const before = await (await h.fetch(`/s/${s.id}`)).text();
    expect(before).not.toContain('og:image');
    await putImage(s.id, cookie);
    const after = await (await h.fetch(`/s/${s.id}`)).text();
    expect(after).toContain(`<meta property="og:image" content="http://localhost/api/shares/${s.id}/image">`);
    expect(after).toContain('summary_large_image');

    const p = await newShare(cookie, 'private');
    await putImage(p.id, cookie);
    expect(await (await h.fetch(`/s/${p.id}`)).text()).not.toContain('og:image');
  });

  it('[F-47] Löschen der Freigabe entfernt auch das Bild', async () => {
    const { cookie } = await login(h, email());
    const s = await newShare(cookie);
    await putImage(s.id, cookie);
    expect((await h.fetch(`/api/shares/${s.id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await h.fetch(`/api/shares/${s.id}/image`)).status).toBe(404);
    expect(await (await h.r2()).head(`previews/${s.id}.jpg`)).toBeNull();
  });
});
