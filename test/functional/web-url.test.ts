// Funktionale Tests: Web-URL für Vereine, Teams und Häfen (F-540 … F-543) und Auffindbarkeit ohne App-Store –
// /sitemap.xml, /robots.txt, noindex auf Vorschauen, kanonische Adresse (F-544 … F-546).
// Der Haupt-Worker läuft als „Hauptdomain“ (CANONICAL_HOST = localhost), ein zweiter wie eine Vorschau (ohne).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, login, migrationFiles, startWorker, type Harness } from './worker-harness';
import { social, type Person } from './social-helpers';
import { parseWebUrl, webUrlLabel } from '../../src/domain/groups';

const DAY = 86_400_000;
const ADMIN_ID = 'WebUrlAdmin000001';
const ADMIN_MAIL = 'web-url-admin@example.org';

let h: Harness;
let s: ReturnType<typeof social>;
let admin: Person;

beforeAll(async () => {
  h = await startWorker({ ADMIN_USER_IDS: ADMIN_ID, CANONICAL_HOST: 'localhost' });
  s = social(h);
  await (await h.db()).prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(ADMIN_ID, ADMIN_MAIL, Date.now() - 10 * DAY).run();
  admin = { ...(await login(h, ADMIN_MAIL)), email: ADMIN_MAIL };
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});

const one = async <T>(sql: string, ...args: unknown[]) => (await h.db()).prepare(sql).bind(...args).first<T>();
const groupPage = async (id: string, p?: Person) => (await (await s.send('GET', `/api/groups/${id}`, p?.cookie)).json()) as { group: { webUrl: string | null } };
const harborPage = async (slug: string, p?: Person) => (await (await s.send('GET', `/api/harbors/slug/${slug}`, p?.cookie)).json()) as { harbor: { id: string; webUrl: string | null } };
const newHarbor = async (p: Person, name = s.uniq('Webhafen')) =>
  ((await (await s.send('POST', '/api/harbors', p.cookie, { name, lat: -44, lon: -171 })).json()) as { harbor: { id: string; slug: string } }).harbor;

describe('F-540 … F-543 Web-URL', () => {
  it('[F-540] Prüfung wie der Link eines Beitrags: nur http(s) mit Host, höchstens 500 Zeichen; Anzeige ohne www.', () => {
    expect(parseWebUrl('https://www.svp-potsdam.de/verein')).toBe('https://www.svp-potsdam.de/verein');
    expect(parseWebUrl('')).toBe('');
    for (const bad of ['javascript:alert(1)', 'ftp://x.de', 'mailto:a@b.de', 'https://localhost', 'svp.de', `https://x.de/${'a'.repeat(500)}`, 42]) expect(parseWebUrl(bad), String(bad)).toBeNull();
    expect(webUrlLabel('https://www.svp-potsdam.de/verein')).toBe('svp-potsdam.de');
    expect(webUrlLabel('javascript:alert(1)')).toBe('');
  });

  it('[F-540] Eigner und Admins setzen die Webseite der Gruppe, Mitglieder nicht; Gäste sehen sie; leer entfernt', async () => {
    const owner = await s.person({ profile: 'public' });
    const groupAdmin = await s.person({ profile: 'public' });
    const member = await s.person({ profile: 'public' });
    const g = await s.group(owner, { webUrl: 'https://svp.example.org/' });
    expect(await one('SELECT web_url FROM groups WHERE id = ?', g.id)).toEqual({ web_url: 'https://svp.example.org/' });
    await s.join(owner, g, groupAdmin);
    await s.join(owner, g, member);
    expect((await s.send('PATCH', `/api/groups/${g.id}/members/${groupAdmin.user.id}`, owner.cookie, { role: 'admin' })).status).toBe(200);

    const byAdmin = await s.send('PATCH', `/api/groups/${g.id}`, groupAdmin.cookie, { webUrl: 'http://www.svp.example.org/start' });
    expect(byAdmin.status, await byAdmin.clone().text()).toBe(200);
    expect(((await byAdmin.json()) as { group: { webUrl: string } }).group.webUrl).toBe('http://www.svp.example.org/start');
    expect((await groupPage(g.id)).group.webUrl).toBe('http://www.svp.example.org/start');

    const byMember = await s.send('PATCH', `/api/groups/${g.id}`, member.cookie, { webUrl: 'https://spam.example.org' });
    expect(byMember.status).toBe(403);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'svp.de', `https://x.de/${'a'.repeat(500)}`]) {
      const res = await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { webUrl: bad });
      expect(res.status, bad).toBe(400);
      expect(await s.errorOf(res)).toBe('invalid_web_url');
    }
    expect((await groupPage(g.id)).group.webUrl).toBe('http://www.svp.example.org/start');
    expect((await s.send('PATCH', `/api/groups/${g.id}`, owner.cookie, { webUrl: '' })).status).toBe(200);
    expect(await one('SELECT web_url FROM groups WHERE id = ?', g.id)).toEqual({ web_url: null });
    expect((await groupPage(g.id)).group.webUrl).toBeNull();
  });

  it('[F-540] geschlossene Gruppe: Gäste sehen weder Gruppe noch Webseite', async () => {
    const owner = await s.person({ supporter: true, profile: 'public' });
    const g = await s.group(owner, { visibility: 'private', webUrl: 'https://geheim.example.org' });
    expect((await s.send('GET', `/api/groups/${g.id}`, undefined)).status).toBe(404);
    expect((await groupPage(g.id, owner)).group.webUrl).toBe('https://geheim.example.org/');
  });

  it('[F-541] Hafen: Anleger:in und Moderation setzen die Webseite, andere nicht; Erst-Position übernimmt sie nicht', async () => {
    const creator = await s.person({ profile: 'public' });
    const other = await s.person({ profile: 'public' });
    const hb = await newHarbor(creator);
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, creator.cookie, { webUrl: 'https://hafen.example.org' })).status).toBe(200);
    expect((await harborPage(hb.slug)).harbor.webUrl).toBe('https://hafen.example.org/');
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, other.cookie, { webUrl: 'https://spam.example.org' })).status).toBe(403);
    const bad = await s.send('PATCH', `/api/harbors/${hb.id}`, creator.cookie, { webUrl: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    expect(await s.errorOf(bad)).toBe('invalid_web_url');
    // Moderation: geändert, mit Protokoll
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, admin.cookie, { webUrl: '' })).status).toBe(200);
    expect((await harborPage(hb.slug)).harbor.webUrl).toBeNull();
    expect(await one(`SELECT 1 AS x FROM admin_log WHERE action = 'harbor_edit' AND target_id = ? AND detail LIKE 'Webseite%'`, hb.id)).not.toBeNull();

    // Altbestand ohne Anleger:in und Position: Position setzen geht (F-307), die Webseite dabei nicht
    const db = await h.db();
    await db.prepare('UPDATE harbors SET created_by = NULL, lat = NULL, lon = NULL WHERE id = ?').bind(hb.id).run();
    expect((await s.send('PATCH', `/api/harbors/${hb.id}`, other.cookie, { lat: 52.4, lon: 13.05, webUrl: 'https://spam.example.org' })).status).toBe(403);
    expect(await one('SELECT web_url, created_by FROM harbors WHERE id = ?', hb.id)).toEqual({ web_url: null, created_by: null });
  });

  it('[F-542] Häfen zusammenführen: Ziel ohne Webseite übernimmt die der Dublette, eigene bleibt; Löschen nimmt sie mit', async () => {
    const p = await s.person({ profile: 'public' });
    const [dup1, main1, dup2, main2] = [await newHarbor(p), await newHarbor(p), await newHarbor(p), await newHarbor(p)];
    await s.send('PATCH', `/api/harbors/${dup1.id}`, p.cookie, { webUrl: 'https://dublette.example.org' });
    await s.send('PATCH', `/api/harbors/${dup2.id}`, p.cookie, { webUrl: 'https://dublette.example.org' });
    await s.send('PATCH', `/api/harbors/${main2.id}`, p.cookie, { webUrl: 'https://haupt.example.org' });
    expect((await s.send('POST', `/api/admin/harbors/${dup1.id}/merge`, admin.cookie, { into: main1.id })).status).toBe(200);
    expect((await s.send('POST', `/api/admin/harbors/${dup2.id}/merge`, admin.cookie, { into: main2.id })).status).toBe(200);
    expect(await one('SELECT web_url FROM harbors WHERE id = ?', main1.id)).toEqual({ web_url: 'https://dublette.example.org/' });
    expect(await one('SELECT web_url FROM harbors WHERE id = ?', main2.id)).toEqual({ web_url: 'https://haupt.example.org/' });
    // Löschen (Moderation): die Spalte fällt mit ihrer Zeile
    expect((await s.send('DELETE', `/api/admin/harbors/${main1.id}`, admin.cookie, { confirm: main1.id })).status).toBeLessThan(300);
    expect(await one('SELECT id FROM harbors WHERE id = ?', main1.id)).toBeNull();
    const g = await s.group(p, { webUrl: 'https://weg.example.org' });
    expect((await s.send('DELETE', `/api/groups/${g.id}`, p.cookie)).status).toBeLessThan(300);
    expect(await one('SELECT id FROM groups WHERE id = ?', g.id)).toBeNull();
  });

  it('[F-543] Moderation ändert oder entfernt die Webseite von Gruppe und Hafen im Admin-Bereich, mit Protokoll', async () => {
    const p = await s.person({ profile: 'public' });
    const g = await s.group(p, { webUrl: 'https://spam.example.org' });
    const hb = await newHarbor(p);
    await s.send('PATCH', `/api/harbors/${hb.id}`, p.cookie, { webUrl: 'https://spam.example.org' });
    const detail = (await (await s.send('GET', `/api/admin/groups/${g.id}`, admin.cookie)).json()) as { extra: { webUrl: string } };
    expect(detail.extra.webUrl).toBe('https://spam.example.org/');
    expect((await s.send('PATCH', `/api/admin/groups/${g.id}`, admin.cookie, { webUrl: 'javascript:x' })).status).toBe(400);
    expect((await s.send('PATCH', `/api/admin/groups/${g.id}`, admin.cookie, { webUrl: '' })).status).toBe(200);
    expect((await s.send('PATCH', `/api/admin/harbors/${hb.id}`, admin.cookie, { webUrl: 'https://richtig.example.org' })).status).toBe(200);
    expect(await one('SELECT web_url FROM groups WHERE id = ?', g.id)).toEqual({ web_url: null });
    expect(await one('SELECT web_url FROM harbors WHERE id = ?', hb.id)).toEqual({ web_url: 'https://richtig.example.org/' });
    for (const id of [g.id, hb.id]) expect(await one(`SELECT 1 AS x FROM admin_log WHERE action = 'rename' AND target_id = ? AND detail LIKE 'Webseite%'`, id)).not.toBeNull();
    // Nur Admins
    expect((await s.send('PATCH', `/api/admin/groups/${g.id}`, p.cookie, { webUrl: '' })).status).toBe(404);
  });
});

describe('F-544 Sitemap öffentlicher Seiten', () => {
  it('[F-544] nur öffentliche und gelistete Seiten; Betrachter egal (Mitglied vorher), öffentlich cachebar', async () => {
    const pub = await s.person({ supporter: true, profile: 'public' });
    const priv = await s.person({ supporter: true, profile: 'private' });
    const club = await s.group(pub);
    const closed = await s.group(priv, { visibility: 'private' });
    const linkOnly = await s.group(priv, { visibility: 'unlisted' });
    const hidden = await s.group(pub, { kind: 'team' });
    const db = await h.db();
    await db.prepare('UPDATE groups SET hidden_at = ? WHERE id = ?').bind(Date.now(), hidden.id).run();
    const hb = await newHarbor(pub);
    const empty = await newHarbor(pub);
    const boat = await s.boat(pub, { harborId: hb.id });
    const privBoat = await s.boat(priv, { visibility: 'public' });
    const listed = await s.share(pub, { boatId: boat.id });
    const narrow = await s.share(pub);
    await db.prepare(`UPDATE posts SET reach = 'harbor' WHERE id = ?`).bind(narrow.id).run();
    const unlisted = await s.share(priv, { visibility: 'unlisted' });
    const handle = (await one<{ handle: string }>('SELECT handle FROM profiles WHERE user_id = ?', pub.user.id))!.handle;
    const privHandle = (await one<{ handle: string }>('SELECT handle FROM profiles WHERE user_id = ?', priv.user.id))!.handle;
    // Gesperrtes Konto (Konzept 4.4): öffentliches Profil, Boot, Törn und Verein verschwinden
    const banned = await s.person({ profile: 'public' });
    const bannedClub = await s.group(banned);
    const bannedBoat = await s.boat(banned);
    const bannedShare = await s.share(banned);
    await db.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(Date.now(), banned.user.id).run();

    // Erst ein Mitglied der geschlossenen Gruppe (Cookie wird ignoriert), danach ein Gast: dieselbe Antwort
    const asMember = await h.fetch('/sitemap.xml', { cookie: priv.cookie });
    expect(asMember.status).toBe(200);
    const guest = await h.fetch('/sitemap.xml');
    expect(guest.headers.get('Content-Type')).toContain('application/xml');
    expect(guest.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const xml = await guest.text();
    expect(xml).toBe(await asMember.text());
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    for (const p of ['/', '/entdecken', `/g/${club.slug}`, `/h/${hb.slug}`, `/b/${boat.id}`, `/s/${listed.id}`, `/u/${handle.toLowerCase()}`]) expect(locs, p).toContain(p);
    for (const p of [`/g/${closed.slug}`, `/g/${linkOnly.slug}`, `/g/${hidden.slug}`, `/h/${empty.slug}`, `/b/${privBoat.id}`, `/s/${narrow.id}`, `/s/${unlisted.id}`, `/u/${privHandle.toLowerCase()}`, `/u/${banned.handle!.toLowerCase()}`, `/g/${bannedClub.slug}`, `/b/${bannedBoat.id}`, `/s/${bannedShare.id}`]) {
      expect(locs, p).not.toContain(p);
    }
    expect(xml).not.toMatch(/\/[a-zA-Z0-9]+\?k=|share_key/);
  });
});

describe('F-545 robots.txt und noindex', () => {
  it('[F-545] Hauptdomain: robots.txt erlaubt alles und nennt die Sitemap; Seiten ohne X-Robots-Tag', async () => {
    const res = await h.fetch('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(await res.text()).toBe('User-agent: *\nAllow: /\n\nSitemap: http://localhost/sitemap.xml\n');
    expect((await h.fetch('/entdecken')).headers.get('X-Robots-Tag')).toBeNull();
  });

  it('[F-545] Vorschau bzw. fremder Host: robots.txt sperrt alles, Sitemap 404, jede Seite X-Robots-Tag: noindex', async () => {
    const preview = await startWorker({ CANONICAL_HOST: '' });
    try {
      const robots = await preview.fetch('/robots.txt');
      expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
      expect(robots.headers.get('X-Robots-Tag')).toBe('noindex');
      expect((await preview.fetch('/sitemap.xml')).status).toBe(404);
      for (const path of ['/', '/entdecken', '/impressum']) expect((await preview.fetch(path)).headers.get('X-Robots-Tag'), path).toBe('noindex');
    } finally {
      await preview.dispose();
    }
  }, 60_000);
});

describe('F-546 Kanonische Adresse', () => {
  it('[F-546] indexierbare Seiten tragen canonical und og:url ohne Schlüssel und Query; noindex-Seiten nicht', async () => {
    const owner = await s.person({ supporter: true, profile: 'public' });
    const g = await s.group(owner);
    const page = await (await h.fetch(`/g/${g.slug.toUpperCase()}?utm=x`)).text();
    expect(page).toContain(`<link rel="canonical" href="http://localhost/g/${g.slug}">`);
    expect(page).toContain(`<meta property="og:url" content="http://localhost/g/${g.slug}">`);
    expect(await (await h.fetch('/entdecken')).text()).toContain('<link rel="canonical" href="http://localhost/entdecken">');
    const closed = await s.group(owner, { visibility: 'unlisted' });
    const withKey = await (await h.fetch(`/g/${closed.slug}/${closed.shareKey}`)).text();
    expect(withKey).toContain('noindex');
    expect(withKey).not.toContain('rel="canonical"');
  });
});

describe('F-540 Migration 0043 mit Altbestand', () => {
  it('[F-540] bestehende Gruppen und Häfen bekommen keine Webseite (NULL), die API liefert null', async () => {
    const old = await startWorker({}, { migrateBefore: '0043' });
    try {
      const db = await old.db();
      const T = 1_700_000_000_000;
      await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind('MigWebUserAAAAAA1', 'mig-web@example.org', T).run();
      await db.prepare(`INSERT INTO harbors (id, slug, name, name_key, created_at, updated_at) VALUES ('MigWebHarborAAAA1', 'mig-web-hafen', 'Mig Hafen', 'mig hafen', ?, ?)`).bind(T, T).run();
      await db.prepare(
        `INSERT INTO groups (id, kind, slug, name, description, home_port, visibility, join_mode, approve_by, owner_id, created_at, updated_at)
         VALUES ('MigWebGroupAAAAA1', 'club', 'mig-web-verein', 'Mig Verein', '', '', 'public', 'request', 'admins', 'MigWebUserAAAAAA1', ?, ?)`,
      ).bind(T, T).run();
      expect(migrationFiles({ from: '0043' })[0]).toBe('0043_web_url.sql');
      await applyMigrations(db, migrationFiles({ from: '0043' }));
      expect(await db.prepare(`SELECT web_url FROM groups WHERE id = 'MigWebGroupAAAAA1'`).first()).toEqual({ web_url: null });
      const api = (await (await old.fetch('/api/harbors/slug/mig-web-hafen')).json()) as { harbor: { webUrl: unknown } };
      expect(api.harbor.webUrl).toBeNull();
      const g = (await (await old.fetch('/api/groups/slug/mig-web-verein')).json()) as { group: { webUrl: unknown; name: string } };
      expect(g.group).toMatchObject({ name: 'Mig Verein', webUrl: null });
    } finally {
      await old.dispose();
    }
  }, 60_000);
});
