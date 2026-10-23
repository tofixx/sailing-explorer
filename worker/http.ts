export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

/** Header für API-Antworten: nie als Dokument interpretierbar, nie einbettbar. */
const API_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(API_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function withApiHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_HEADERS)) out.headers.set(k, v);
  return out;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.code, message: err.message }, { status: err.status });
  console.error('unhandled', err);
  return json({ error: 'internal', message: 'Interner Fehler' }, { status: 500 });
}

/**
 * Liest den Body mit laufendem Byte-Zähler und bricht oberhalb des Limits ab –
 * ohne erst alles in den Speicher zu laden (auch bei chunked Uploads ohne Content-Length).
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'too_large', 'Anfrage ist zu groß.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'too_large', 'Anfrage ist zu groß.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function readJson<T>(request: Request, maxBytes = 16 * 1024): Promise<T> {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type');
  }
  const text = new TextDecoder().decode(await readBodyCapped(request, maxBytes));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

export async function rateLimit(limiter: RateLimit | undefined, key: string): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, 'rate_limited', 'Zu viele Anfragen – bitte kurz warten.');
}
