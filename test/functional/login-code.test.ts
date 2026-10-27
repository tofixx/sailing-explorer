// Funktionale Tests: Anmeldung per Code aus der Mail (Konzept 14.6, F-207) – zusätzlich zum Link, gleiche Gültigkeit,
// Fehlversuch-Grenze pro Adresse, Link und Code verbrauchen sich gegenseitig. Echter Worker in workerd (Miniflare).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type Harness } from './worker-harness';
import { randomCode } from '../../worker/crypto';

let h: Harness;
let n = 0;
const email = () => `code${++n}-${Date.now()}@example.org`;

beforeAll(async () => {
  h = await startWorker();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const post = (path: string, body: unknown) => h.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function request(mail: string): Promise<{ code: string; token: string }> {
  const res = await post('/api/auth/request', { email: mail });
  expect(res.status, await res.clone().text()).toBe(200);
  const { devLink, devCode } = (await res.json()) as { devLink: string; devCode: string };
  return { code: devCode, token: /#token=([A-Za-z0-9_-]+)/.exec(devLink)![1] };
}

describe('Anmeldung per Code (Konzept 14.6)', () => {
  it('[F-207] Code hat immer 6 Ziffern', () => {
    for (let i = 0; i < 200; i++) expect(randomCode()).toMatch(/^\d{6}$/);
  });

  it('[F-207] richtiger Code meldet an (auch mit Leerzeichen und anderer Groß-/Kleinschreibung der Adresse); danach ist der Link verbraucht', async () => {
    const mail = email();
    const { code, token } = await request(mail);
    const log = h.logs.filter((l) => l.includes(`[mail:log] an ${mail}:`)).join('\n');
    expect(log).toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(log.split('\n')[0]).not.toContain(`${code.slice(0, 3)} ${code.slice(3)}`); // nicht im Betreff
    const res = await post('/api/auth/code', { email: mail.toUpperCase(), code: `${code.slice(0, 3)} ${code.slice(3)}` });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/sx_session/);
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe(mail);
    expect((await post('/api/auth/verify', { token })).status).toBe(400);
    expect((await post('/api/auth/code', { email: mail, code })).status).toBe(400);
  });

  it('[F-207] eingelöster Link macht den Code ungültig; falsche Adresse oder Form → gleiche Antwort', async () => {
    const mail = email();
    const { code, token } = await request(mail);
    const other = await post('/api/auth/code', { email: email(), code });
    expect(other.status).toBe(400);
    expect(((await other.json()) as { error: string }).error).toBe('invalid_code');
    expect((await post('/api/auth/code', { email: mail, code: '12ab56' })).status).toBe(400);
    expect((await post('/api/auth/verify', { token })).status).toBe(200);
    expect((await post('/api/auth/code', { email: mail, code })).status).toBe(400);
  });

  it('[F-207] nach 10 falschen Codes pro Adresse und Tag hilft auch der richtige nicht mehr – der Link schon', async () => {
    const mail = email();
    const { code, token } = await request(mail);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 10; i++) expect((await post('/api/auth/code', { email: mail, code: wrong })).status).toBe(400);
    const locked = await post('/api/auth/code', { email: mail, code });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { error: string }).error).toBe('code_locked');
    expect((await post('/api/auth/verify', { token })).status).toBe(200);
  });

  it('[F-207] abgelaufener Code gilt nicht', async () => {
    const mail = email();
    const { code } = await request(mail);
    await (await h.db()).prepare('UPDATE login_tokens SET expires_at = ? WHERE email = ?').bind(Date.now() - 1, mail).run();
    expect((await post('/api/auth/code', { email: mail, code })).status).toBe(400);
  });

  it('[F-207] parallele Fehlversuche überholen die Grenze nicht; danach sind die offenen Codes verworfen', async () => {
    const mail = email();
    const { code, token } = await request(mail);
    const wrong = code === '000000' ? '000001' : '000000';
    const res = await Promise.all(Array.from({ length: 25 }, () => post('/api/auth/code', { email: mail, code: wrong })));
    const statuses = res.map((r) => r.status);
    // nie angemeldet; mindestens eine Anfrage stößt an die Grenze (danach sind die Codes weg → nur noch „ungültig“)
    expect(statuses).not.toContain(200);
    expect(statuses).toContain(429);
    const row = await (await h.db()).prepare('SELECT SUM(code_attempts) AS n, MAX(code_hash IS NULL) AS dropped FROM login_tokens WHERE email = ?').bind(mail).first<{ n: number; dropped: number }>();
    expect(row?.n).toBeLessThanOrEqual(10);
    expect(row?.dropped).toBe(1);
    expect((await post('/api/auth/code', { email: mail, code })).status).not.toBe(200);
    expect((await post('/api/auth/verify', { token })).status).toBe(200);
  });

  it('[F-207] Fehlversuche überdauern den nächtlichen Cron bis 24 h nach Ablauf', async () => {
    const mail = email();
    await request(mail);
    await (await h.db()).prepare('UPDATE login_tokens SET code_attempts = 3, expires_at = ? WHERE email = ?').bind(Date.now() - 60_000, mail).run();
    await h.scheduled();
    const kept = await (await h.db()).prepare('SELECT SUM(code_attempts) AS n FROM login_tokens WHERE email = ?').bind(mail).first<{ n: number }>();
    expect(kept?.n).toBe(3);
  });
});
