// Funktionale Tests: Kartenstil als Profil-Standard (F-217, Konzept 16) über PATCH /api/me/settings.
// Echter Worker in workerd (Miniflare) mit lokaler D1 – siehe worker-harness.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, startWorker, type Harness } from './worker-harness';

let h: Harness;
let n = 0;
const email = () => `ms${++n}-${Date.now()}@example.org`;

beforeAll(async () => {
  h = await startWorker({ APP_ORIGIN: 'https://sail.example' });
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const send = (method: string, path: string, cookie: string | undefined, body?: unknown, origin?: string | null) =>
  h.fetch(path, {
    method,
    cookie,
    origin,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const settings = async (cookie: string) => (await (await send('GET', '/api/me/settings', cookie)).json()) as { mapStyle: string | null; notifyComments: string };

describe('F-217 Kartenstil im Profil', () => {
  it('[F-217] Standard: kein Stil (null); speichern, ändern und zurücksetzen per PATCH, gilt für jede Sitzung des Kontos', async () => {
    const mail = email();
    const a = await login(h, mail);
    expect((await settings(a.cookie)).mapStyle).toBeNull();

    const res = await send('PATCH', '/api/me/settings', a.cookie, { mapStyle: 'colorblind' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { mapStyle: string }).mapStyle).toBe('colorblind');

    // zweites Gerät = zweite Sitzung desselben Kontos
    const b = await login(h, mail);
    expect((await settings(b.cookie)).mapStyle).toBe('colorblind');

    await send('PATCH', '/api/me/settings', b.cookie, { mapStyle: 'contrast' });
    expect((await settings(a.cookie)).mapStyle).toBe('contrast');

    await send('PATCH', '/api/me/settings', a.cookie, { mapStyle: null });
    expect((await settings(a.cookie)).mapStyle).toBeNull();
  });

  it('[F-217] andere Einstellungen bleiben unberührt; Unbekanntes → 400 ohne Änderung', async () => {
    const a = await login(h, email());
    await send('PATCH', '/api/me/settings', a.cookie, { mapStyle: 'subtle' });
    expect((await settings(a.cookie)).notifyComments).toBe('off');
    for (const bad of ['neon', 'toString', '', 3, { id: 'classic' }]) {
      expect((await send('PATCH', '/api/me/settings', a.cookie, { mapStyle: bad })).status, String(bad)).toBe(400);
    }
    expect((await settings(a.cookie)).mapStyle).toBe('subtle');
    // mehrere Felder: ein ungültiges verhindert jede Änderung
    expect((await send('PATCH', '/api/me/settings', a.cookie, { mapStyle: 'contrast', notifyComments: 'hourly' })).status).toBe(400);
    expect((await settings(a.cookie)).mapStyle).toBe('subtle');
  });

  it('[F-217] ohne Anmeldung 401, fremde Origin 403; ein ungültiger Wert in der Datenbank zählt als „kein Stil“', async () => {
    expect((await send('PATCH', '/api/me/settings', undefined, { mapStyle: 'contrast' })).status).toBe(401);
    const a = await login(h, email());
    expect((await send('PATCH', '/api/me/settings', a.cookie, { mapStyle: 'contrast' }, 'https://evil.example')).status).toBe(403);
    expect((await settings(a.cookie)).mapStyle).toBeNull();
    await (await h.db()).prepare('UPDATE users SET map_style = ? WHERE id = ?').bind('alt', a.user.id).run();
    expect((await settings(a.cookie)).mapStyle).toBeNull();
  });

  it('[F-217] Konto löschen entfernt die Einstellung mit der Konto-Zeile', async () => {
    const a = await login(h, email());
    await send('PATCH', '/api/me/settings', a.cookie, { mapStyle: 'contrast' });
    expect((await send('DELETE', '/api/account', a.cookie)).status).toBe(200);
    const row = await (await h.db()).prepare('SELECT map_style FROM users WHERE id = ?').bind(a.user.id).first();
    expect(row).toBeNull();
  });
});
