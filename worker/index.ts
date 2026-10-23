import type { Env } from './env';
import { deleteAccount, logout, me, peekLink, requestLink, verifyLink } from './auth';
import { HttpError, errorResponse, json } from './http';
import { createShare, deleteShare, getShareData, getShareMeta, getShareRow, listShares, updateShare } from './shares';
import { createBoat, deleteBoat, getBoat, listMyBoats, updateBoat } from './boats';
import { getMyProfile, getProfile, putMyProfile } from './profiles';
import { withPageHeaders } from './security';
import { isSameOrigin } from './validate';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

const routes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ['GET', /^\/api\/config$/, async (_r, env) => json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, sharing: true }, { headers: { 'Cache-Control': 'public, max-age=300' } })],
  ['GET', /^\/api\/auth\/me$/, (r, env) => me(r, env)],
  ['POST', /^\/api\/auth\/request$/, (r, env) => requestLink(r, env)],
  ['POST', /^\/api\/auth\/peek$/, (r, env) => peekLink(r, env)],
  ['POST', /^\/api\/auth\/verify$/, (r, env) => verifyLink(r, env)],
  ['POST', /^\/api\/auth\/logout$/, (r, env) => logout(r, env)],
  ['DELETE', /^\/api\/account$/, (r, env) => deleteAccount(r, env)],
  ['GET', /^\/api\/me\/profile$/, (r, env) => getMyProfile(r, env)],
  ['PUT', /^\/api\/me\/profile$/, (r, env) => putMyProfile(r, env)],
  ['GET', /^\/api\/profiles\/([A-Za-z0-9-]+)$/, (r, env, [h]) => getProfile(r, env, h)],
  ['GET', /^\/api\/boats$/, (r, env) => listMyBoats(r, env)],
  ['POST', /^\/api\/boats$/, (r, env) => createBoat(r, env)],
  ['GET', /^\/api\/boats\/([A-Za-z0-9]+)$/, (r, env, [id]) => getBoat(r, env, id)],
  ['PATCH', /^\/api\/boats\/([A-Za-z0-9]+)$/, (r, env, [id]) => updateBoat(r, env, id)],
  ['DELETE', /^\/api\/boats\/([A-Za-z0-9]+)$/, (r, env, [id]) => deleteBoat(r, env, id)],
  ['GET', /^\/api\/shares$/, (r, env) => listShares(r, env)],
  ['POST', /^\/api\/shares$/, (r, env) => createShare(r, env)],
  ['GET', /^\/api\/shares\/([A-Za-z0-9]+)$/, (r, env, [id]) => getShareMeta(r, env, id)],
  ['GET', /^\/api\/shares\/([A-Za-z0-9]+)\/data$/, (r, env, [id]) => getShareData(r, env, id)],
  ['PATCH', /^\/api\/shares\/([A-Za-z0-9]+)$/, (r, env, [id]) => updateShare(r, env, id)],
  ['DELETE', /^\/api\/shares\/([A-Za-z0-9]+)$/, (r, env, [id]) => deleteShare(r, env, id)],
];

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOrigin(request)) {
    throw new HttpError(403, 'forbidden_origin');
  }
  let pathMatched = false;
  for (const [method, pattern, handler] of routes) {
    const m = pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (method === request.method || (method === 'GET' && request.method === 'HEAD')) return handler(request, env, m.slice(1));
  }
  throw pathMatched ? new HttpError(405, 'method_not_allowed') : new HttpError(404, 'not_found');
}

interface PageMeta {
  title: string;
  description: string;
  /** Profile/Boote dürfen gefunden werden, geteilte Törns nicht. */
  index: boolean;
}

const DEFAULT_DESCRIPTION = 'Segeltörns auf der Seekarte mit Wind- und Wellendaten';

/** Vorschau-Metadaten (Messenger, Social) – nur aus öffentlichen Daten. */
async function pageMeta(env: Env, kind: string, id: string): Promise<PageMeta> {
  const fallback = { title: env.APP_NAME, description: DEFAULT_DESCRIPTION, index: false };
  if (kind === 's') {
    const row = await getShareRow(env, id);
    if (!row || row.visibility !== 'unlisted') return fallback;
    return { title: `${row.title} · ${env.APP_NAME}`, description: row.summary || 'Segeltörn mit Wind- und Wellendaten', index: false };
  }
  if (kind === 'u') {
    const p = await env.DB.prepare("SELECT display_name, bio FROM profiles WHERE handle = ? AND visibility = 'public'").bind(id).first<{ display_name: string; bio: string }>();
    return p ? { title: `${p.display_name} · ${env.APP_NAME}`, description: p.bio || 'Segelprofil mit Törns und Booten', index: true } : fallback;
  }
  const b = await env.DB.prepare("SELECT name, boat_type, home_port FROM boats WHERE id = ? AND visibility = 'public'").bind(id).first<{ name: string; boat_type: string; home_port: string }>();
  if (!b) return fallback;
  const desc = [b.boat_type, b.home_port && `Heimathafen ${b.home_port}`].filter(Boolean).join(' · ');
  return { title: `${b.name} · ${env.APP_NAME}`, description: desc || 'Boot mit seinen Törns', index: true };
}

/** /s/:id, /u/:handle, /b/:id – liefert die App mit passenden Vorschau-Metadaten. */
async function metaPage(request: Request, env: Env, kind: string, id: string): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/', request.url), { headers: request.headers }));
  const meta = await pageMeta(env, kind, id).catch(() => ({ title: env.APP_NAME, description: DEFAULT_DESCRIPTION, index: false }));
  const rewritten = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(meta.title) })
    .on('meta[property="og:title"]', { element: (el) => void el.setAttribute('content', meta.title) })
    .on('meta[property="og:description"], meta[name="description"]', { element: (el) => void el.setAttribute('content', meta.description) })
    .on('head', {
      element: (el) => {
        if (!meta.index) el.append('<meta name="robots" content="noindex">', { html: true });
      },
    })
    .transform(page);
  const res = withPageHeaders(new Response(rewritten.body, rewritten));
  res.headers.set('Cache-Control', 'no-cache');
  return res;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url.pathname);
      const page = /^\/(s|b)\/([A-Za-z0-9]{12,32})\/?$/.exec(url.pathname) ?? /^\/(u)\/([a-z0-9-]{3,30})\/?$/i.exec(url.pathname);
      if (page && (request.method === 'GET' || request.method === 'HEAD')) return await metaPage(request, env, page[1], page[1] === 'u' ? page[2].toLowerCase() : page[2]);
      return env.ASSETS.fetch(request);
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
