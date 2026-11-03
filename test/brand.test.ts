// Markenname „Luv & Leute“ (vormals Sail Explorer): überall gleich, richtig escaped, Kennungen unverändert.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../src/domain/brand';
import { inviteAcceptedText, inviteWhat } from '../src/domain/invite-text';
import { atomFeed } from '../worker/feed-xml';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const htmlName = APP_NAME.replace(/&/g, '&amp;');

describe('[F-515] Markenname überall gleich', () => {
  it('[F-515] Name ist „Luv & Leute“', () => {
    expect(APP_NAME).toBe('Luv & Leute');
  });

  it('[F-515] index.html: Titel, og:title und iOS-Titel nennen den Namen, „&“ als &amp;', () => {
    const html = read('index.html');
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(htmlName);
    expect(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1]).toBe(htmlName);
    expect(/<meta name="apple-mobile-web-app-title" content="([^"]*)"/.exec(html)?.[1]).toBe(htmlName);
  });

  it('[F-515] Manifest: name beginnt mit dem Namen, short_name ist der Name (≤ 12 Zeichen, passt unter das Icon)', () => {
    const m = JSON.parse(read('public/manifest.webmanifest')) as { name: string; short_name: string };
    expect(m.name.startsWith(`${APP_NAME} – `)).toBe(true);
    expect(m.short_name).toBe(APP_NAME);
    expect(m.short_name.length).toBeLessThanOrEqual(12);
  });

  it('[F-515] Worker-Variablen und Service Worker: APP_NAME, Absendername und Push-Titel', () => {
    const wrangler = read('wrangler.jsonc');
    expect(/"APP_NAME": "([^"]*)"/.exec(wrangler)?.[1]).toBe(APP_NAME);
    expect(/"MAIL_FROM": "([^"<]*) </.exec(wrangler)?.[1]).toBe(APP_NAME);
    expect(read('public/sw.js')).toContain(`let title = '${APP_NAME}';`);
    expect(read('scripts/deploy-preview.mjs')).toContain(`APP_NAME: \`${APP_NAME} (Vorschau`);
  });

  it('[F-515] Einladungstexte und Feed-Titel nennen den Namen (im Feed escaped)', () => {
    expect(inviteWhat({ kind: 'friend', target: null })).toBe(`zu ${APP_NAME} ein`);
    expect(inviteAcceptedText({ kind: 'friend', target: null })).toBe(`Ihr folgt euch jetzt: ${APP_NAME}`);
    const xml = atomFeed('https://x.test', { slug: 'sc', name: 'SC', description: '', updated: 0 }, []);
    expect(xml).toContain(`<title>SC · ${htmlName}</title>`);
  });

  it('[F-515] der alte Name steht in keiner sichtbaren Quelle mehr (nur als Hinweis in brand.ts)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(resolve(root, dir))) {
        const p = join(dir, name);
        if (statSync(resolve(root, p)).isDirectory()) walk(p);
        else if (/\.(ts|js|html|json|webmanifest|css)$/.test(name) && read(p).includes('Sail Explorer')) hits.push(p);
      }
    };
    for (const dir of ['src', 'worker', 'public']) walk(dir);
    for (const f of ['index.html', 'wrangler.jsonc']) if (read(f).includes('Sail Explorer')) hits.push(f);
    expect(hits.map((p) => p.replace(/\\/g, '/'))).toEqual(['src/domain/brand.ts']);
  });
});

// Betreff und Text der Anmelde-Mail prüft test/functional/login-code.test.ts (F-516) am echten Worker. worker/mail.ts
// lässt sich hier nicht importieren (Worker-Typen gehören nicht in das Frontend-tsconfig), daher die Quelltext-Regel.
describe('[F-516] Mails: Name im HTML escaped', () => {
  it('[F-516] in worker/mail.ts steht der Name in HTML-Zeilen nur als escapeHtml(app)', () => {
    const lines = read('worker/mail.ts').split('\n');
    const raw = lines.filter((l) => l.includes('<') && l.includes('${app}'));
    expect(raw).toEqual([]);
    expect(lines.filter((l) => l.includes('escapeHtml(app)')).length).toBeGreaterThanOrEqual(12);
  });
});

describe('[F-517] Kennungen behalten den alten Namen', () => {
  it('[F-517] IndexedDB-Name und Stripe-Metadaten bleiben „sail-explorer“ (Gast-Daten, Zuordnung von Zahlungen)', () => {
    expect(read('src/services/workspace.ts')).toContain("const DB_NAME = 'sail-explorer';");
    expect(read('worker/supporter.ts')).toContain("const METADATA_APP = 'sail-explorer';");
  });

  it('[F-517] Cloudflare-Ressourcen und Domain unverändert', () => {
    const wrangler = read('wrangler.jsonc');
    expect(wrangler).toMatch(/"name": "sailing-explorer"/);
    expect(wrangler).toContain('segeln-potsdam.de');
  });
});
