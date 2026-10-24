// Startet den echten Worker (worker/index.ts) in workerd über Miniflare –
// mit echten (lokalen, nur im Speicher gehaltenen) D1- und R2-Bindings.
// Die Dev-Daten unter .wrangler/ werden dabei nicht angefasst.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

export const ORIGIN = 'http://localhost';

/** Minimales index.html, wie es der Vite-Build liefern würde (für /s/:id). */
export const INDEX_HTML = `<!doctype html><html lang="de"><head>
<meta charset="utf-8">
<title>Sail Explorer</title>
<meta name="description" content="Standard">
<meta property="og:title" content="Sail Explorer">
<meta property="og:description" content="Standard">
</head><body><div class="app"></div></body></html>`;

export interface Harness {
  mf: Miniflare;
  /** ip: CF-Connecting-IP (Standard: pro Aufruf zufällig, damit die IP-Limits nur gezielt greifen) */
  fetch: (path: string, init?: RequestInit & { cookie?: string; origin?: string | null; ip?: string }) => Promise<Response>;
  db: () => Promise<D1Like>;
  r2: () => Promise<R2Like>;
  /** Löst den Cron-Handler (scheduled) des Workers aus und wartet, bis er samt waitUntil fertig ist. */
  scheduled: (cron?: string) => Promise<{ outcome: string }>;
  /** Alle Worker-Logs (console.log/error) seit dem Start – z. B. „[mail:log] …“ */
  logs: string[];
  dispose: () => Promise<void>;
}

// Bewusst schmale Typen (Miniflare liefert die echten Workers-Typen zurück).
export interface D1Like {
  prepare(q: string): { bind(...a: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> }; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
  exec(q: string): Promise<unknown>;
}
export interface R2Like {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<unknown | null>;
  list(opts?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>;
}

/** bindings: zusätzliche/abweichende vars und Secrets (z. B. Stripe-Konfiguration für die Unterstützen-Tests). */
export async function startWorker(bindings: Record<string, string> = {}): Promise<Harness> {
  // Worker-Quelltext (TypeScript) wie wrangler zu einem ES-Modul bündeln – nur im Speicher.
  const out = await build({
    entryPoints: [resolve('worker/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const script = out.outputFiles[0].text;
  const logs: string[] = [];

  // Miniflare 5 (Beta) hat eine neue Options-Struktur; die bekannte v4-Form wird konvertiert.
  const mf = new Miniflare(convertV4MiniflareOptions({
    // Worker-Logs (z. B. „[mail:log] …“) nicht in die Testausgabe, Fehler schon
    handleStructuredLogs: (log: { level: string; message: string }) => {
      logs.push(log.message);
      if (log.level === 'error') console.error(log.message);
    },
    workers: [
      {
        name: 'sx',
        modules: true,
        script,
        // virtueller Pfad im Projekt (workerd scheitert an Modulpfaden außerhalb des cwd)
        scriptPath: resolve('worker-under-test.mjs'),
        compatibilityDate: '2026-10-01',
        // ohne Persistenz-Pfad: alles nur im Speicher
        d1Databases: { DB: 'sx-test-db' },
        r2Buckets: ['TRACKS'],
        // wie in wrangler.jsonc
        ratelimits: {
          UPLOAD_LIMITER: { namespace_id: '1001', simple: { limit: 10, period: 60 } },
          AUTH_LIMITER: { namespace_id: '1002', simple: { limit: 5, period: 60 } },
        },
        bindings: {
          APP_NAME: 'Sail Explorer',
          MAIL_PROVIDER: 'log',
          MAIL_FROM: 'Sail Explorer <login@example.test>',
          TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
          // kein TURNSTILE_SECRET → Captcha wird lokal übersprungen
          FREE_SHARES: '3',
          // ohne Payment-Links und Webhook-Secret (wie wrangler.jsonc ohne Secrets) → Unterstützen ist aus
          ...bindings,
        },
        serviceBindings: {
          ASSETS: async () => new Response(INDEX_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) as never,
        },
      },
    ],
  }));
  await mf.ready;

  // Alle Migrationen in Reihenfolge selbst anwenden (wie `wrangler d1 migrations apply`).
  const db = (await mf.getD1Database('DB')) as unknown as D1Like;
  const files = readdirSync(resolve('migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(resolve('migrations', file), 'utf8').replace(/--[^\n]*/g, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(stmt).all();
    }
  }

  return {
    mf,
    async fetch(path, init = {}) {
      const { cookie, origin, ip, ...rest } = init;
      const headers = new Headers(rest.headers);
      headers.set('CF-Connecting-IP', ip ?? randomIp());
      if (cookie) headers.set('Cookie', cookie);
      const method = (rest.method || 'GET').toUpperCase();
      // Browser schicken bei Mutationen Origin mit; null = bewusst weglassen (CSRF-Test)
      if (origin !== null && method !== 'GET' && method !== 'HEAD' && !headers.has('Origin')) headers.set('Origin', origin ?? ORIGIN);
      const res = await mf.dispatchFetch(`${ORIGIN}${path}`, { ...rest, headers } as never);
      return res as unknown as Response;
    },
    db: async () => db,
    r2: async () => (await mf.getR2Bucket('TRACKS')) as unknown as R2Like,
    async scheduled(cron = '0 3 * * *') {
      const worker = (await mf.getWorker()) as unknown as { scheduled(o: { cron?: string; scheduledTime?: Date }): Promise<{ outcome: string }> };
      return worker.scheduled({ cron, scheduledTime: new Date() });
    },
    logs,
    async dispose() {
      await mf.dispose();
    },
  };
}

// ---------------------------------------------------------------- Helfer

export function randomIp(): string {
  const b = () => Math.floor(Math.random() * 254) + 1;
  return `10.${b()}.${b()}.${b()}`;
}

const enc = new TextEncoder();

export async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([enc.encode(text)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipToText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Body einer Daten-Antwort als Text – egal, ob der HTTP-Client gzip schon entpackt hat. */
export async function bodyText(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipToText(bytes) : new TextDecoder().decode(bytes);
}

/** Meldet eine Adresse per Magic Link an (devLink im Log-Modus) und liefert das Session-Cookie. */
export async function login(h: Harness, email: string): Promise<{ cookie: string; user: { id: string; email: string } }> {
  const req = await h.fetch('/api/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (req.status !== 200) throw new Error(`request ${req.status}: ${await req.text()}`);
  const { devLink } = (await req.json()) as { devLink: string };
  const token = /#token=([A-Za-z0-9_-]+)/.exec(devLink)![1];
  const ver = await h.fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (ver.status !== 200) throw new Error(`verify ${ver.status}: ${await ver.text()}`);
  const setCookie = ver.headers.get('Set-Cookie')!;
  const cookie = setCookie.split(';')[0];
  const { user } = (await ver.json()) as { user: { id: string; email: string } };
  return { cookie, user };
}

export interface ShareOpts {
  title?: string;
  summary?: string;
  view?: string;
  visibility?: string;
  tracks?: Array<{ name: string; gpx: string }>;
  body?: Uint8Array<ArrayBuffer>;
  /** zusätzliche Header, z. B. X-Share-Listed, X-Share-Boat, X-Share-Distance, X-Share-Started */
  headers?: Record<string, string>;
}

export const SAMPLE_GPX = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Mini</name><trkseg><trkpt lat="54" lon="13"><time>2026-06-13T10:00:00Z</time></trkpt><trkpt lat="54.01" lon="13"><time>2026-06-13T10:10:00Z</time></trkpt></trkseg></trk></gpx>`;

export function payloadJson(tracks = [{ name: 'Mini', gpx: SAMPLE_GPX }]): string {
  return JSON.stringify({ v: 1, tracks });
}

export async function createShare(h: Harness, cookie: string | undefined, o: ShareOpts = {}): Promise<Response> {
  const body = o.body ?? (await gzip(payloadJson(o.tracks)));
  return h.fetch('/api/shares', {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'application/gzip',
      'X-Share-Title': encodeURIComponent(o.title ?? 'Testtörn'),
      'X-Share-Summary': encodeURIComponent(o.summary ?? '1,2 sm · 13.06.2026'),
      'X-Share-View': encodeURIComponent(o.view ?? ''),
      'X-Share-Tracks': String(o.tracks?.length ?? 1),
      'X-Share-Visibility': o.visibility ?? 'unlisted',
      ...(o.headers ?? {}),
    },
    body,
  });
}

// ---------------------------------------------------------------- Unterstützen

/** Schaltet ein Konto direkt in der Datenbank als Unterstützer frei (für Tests, die viele Freigaben brauchen). */
export async function grantSupport(h: Harness, userId: string, validUntil = Date.now() + 365 * 86_400_000): Promise<void> {
  const ref = `test_${userId}_${Math.random().toString(36).slice(2)}`;
  await (await h.db())
    .prepare("INSERT INTO supports (id, user_id, provider, provider_ref, amount, currency, created_at, valid_until) VALUES (?, ?, 'test', ?, 0, 'eur', ?, ?)")
    .bind(ref, userId, ref, Date.now(), validUntil)
    .run();
}

/** Stripe-Signature-Header wie Stripe ihn bildet: t=<sek>,v1=HMAC-SHA256(secret, "t.body") als Hex. */
export async function stripeSignature(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`)));
  return `t=${timestamp},v1=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
