import type { Env } from './env';
import { deleteAccount, logout, me, peekLink, requestLink, verifyLink } from './auth';
import { HttpError, errorResponse, json } from './http';
import { canViewShare, createShare, deleteShare, getShareData, getShareImage, getShareMeta, getShareRow, listShares, putShareImage, updateShare } from './shares';
import { createBoat, deleteBoat, getBoat, listMyBoats, updateBoat } from './boats';
import { getMyProfile, getProfile, putMyProfile } from './profiles';
import { getDiscover } from './discover';
import { acceptInvite, acceptMyInvite, declineMyInvite, getCrew, inviteBoatAdmin, inviteCrew, listBoatAdmins, listMyInvites, peekInvite, removeBoatAdmin, removeCrew, revokeInvite } from './invites';
import { withPageHeaders } from './security';
import { createCheckout, freeShares, getSupport, stripeWebhook, supportConfig } from './supporter';
import { runRetention } from './retention';
import { isSameOrigin } from './validate';
import { canView } from './access';
import { isShareKey, type Visibility } from '../src/domain/visibility';

const WEBHOOK_PATH = '/api/webhooks/stripe';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

const routes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  [
    'GET',
    /^\/api\/config$/,
    // Nur öffentliche Werte: Slider-Stufen (null = Unterstützen nicht eingerichtet) und das kostenlose Kontingent.
    async (_r, env) =>
      json(
        { turnstileSiteKey: env.TURNSTILE_SITE_KEY, sharing: true, support: supportConfig(env), freeShares: freeShares(env) },
        { headers: { 'Cache-Control': 'public, max-age=300' } },
      ),
  ],
  ['GET', /^\/api\/auth\/me$/, (r, env) => me(r, env)],
  ['POST', /^\/api\/auth\/request$/, (r, env) => requestLink(r, env)],
  ['POST', /^\/api\/auth\/peek$/, (r, env) => peekLink(r, env)],
  ['POST', /^\/api\/auth\/verify$/, (r, env) => verifyLink(r, env)],
  ['POST', /^\/api\/auth\/logout$/, (r, env) => logout(r, env)],
  ['DELETE', /^\/api\/account$/, (r, env) => deleteAccount(r, env)],
  ['GET', /^\/api\/me\/profile$/, (r, env) => getMyProfile(r, env)],
  ['PUT', /^\/api\/me\/profile$/, (r, env) => putMyProfile(r, env)],
  ['GET', /^\/api\/me\/support$/, (r, env) => getSupport(r, env)],
  ['GET', /^\/api\/me\/invites$/, (r, env) => listMyInvites(r, env)],
  ['POST', /^\/api\/me\/invites\/([A-Za-z0-9]+)\/accept$/, (r, env, [id]) => acceptMyInvite(r, env, id)],
  ['DELETE', /^\/api\/me\/invites\/([A-Za-z0-9]+)$/, (r, env, [id]) => declineMyInvite(r, env, id)],
  ['POST', /^\/api\/support\/checkout$/, (r, env) => createCheckout(r, env)],
  ['POST', /^\/api\/webhooks\/stripe$/, (r, env) => stripeWebhook(r, env)],
  ['GET', /^\/api\/profiles\/([A-Za-z0-9-]+)$/, (r, env, [h]) => getProfile(r, env, h)],
  ['GET', /^\/api\/boats$/, (r, env) => listMyBoats(r, env)],
  ['POST', /^\/api\/boats$/, (r, env) => createBoat(r, env)],
  ['GET', /^\/api\/boats\/([A-Za-z0-9]+)$/, (r, env, [id]) => getBoat(r, env, id)],
  ['PATCH', /^\/api\/boats\/([A-Za-z0-9]+)$/, (r, env, [id]) => updateBoat(r, env, id)],
  ['DELETE', /^\/api\/boats\/([A-Za-z0-9]+)$/, (r, env, [id]) => deleteBoat(r, env, id)],
  ['GET', /^\/api\/boats\/([A-Za-z0-9]+)\/admins$/, (r, env, [id]) => listBoatAdmins(r, env, id)],
  ['POST', /^\/api\/boats\/([A-Za-z0-9]+)\/invites$/, (r, env, [id]) => inviteBoatAdmin(r, env, id)],
  ['DELETE', /^\/api\/boats\/([A-Za-z0-9]+)\/admins\/([A-Za-z0-9]+)$/, (r, env, [id, who]) => removeBoatAdmin(r, env, id, who)],
  ['POST', /^\/api\/invites\/peek$/, (r, env) => peekInvite(r, env)],
  ['POST', /^\/api\/invites\/accept$/, (r, env) => acceptInvite(r, env)],
  ['DELETE', /^\/api\/invites\/([A-Za-z0-9]+)$/, (r, env, [id]) => revokeInvite(r, env, id)],
  ['GET', /^\/api\/discover$/, (r, env) => getDiscover(r, env)],
  ['GET', /^\/api\/shares$/, (r, env) => listShares(r, env)],
  ['POST', /^\/api\/shares$/, (r, env) => createShare(r, env)],
  ['GET', /^\/api\/shares\/([A-Za-z0-9]+)$/, (r, env, [id]) => getShareMeta(r, env, id)],
  ['GET', /^\/api\/shares\/([A-Za-z0-9]+)\/data$/, (r, env, [id]) => getShareData(r, env, id)],
  ['GET', /^\/api\/shares\/([A-Za-z0-9]+)\/image$/, (r, env, [id]) => getShareImage(r, env, id)],
  ['PUT', /^\/api\/shares\/([A-Za-z0-9]+)\/image$/, (r, env, [id]) => putShareImage(r, env, id)],
  ['PATCH', /^\/api\/shares\/([A-Za-z0-9]+)$/, (r, env, [id]) => updateShare(r, env, id)],
  ['DELETE', /^\/api\/shares\/([A-Za-z0-9]+)$/, (r, env, [id]) => deleteShare(r, env, id)],
  ['GET', /^\/api\/shares\/([A-Za-z0-9]+)\/crew$/, (r, env, [id]) => getCrew(r, env, id)],
  ['POST', /^\/api\/shares\/([A-Za-z0-9]+)\/invites$/, (r, env, [id]) => inviteCrew(r, env, id)],
  ['DELETE', /^\/api\/shares\/([A-Za-z0-9]+)\/crew\/([A-Za-z0-9]+)$/, (r, env, [id, who]) => removeCrew(r, env, id, who)],
];

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  // Einzige Ausnahme von der Origin-Prüfung: der Stripe-Webhook (ohne Origin, ohne Cookie, per Signatur geschützt).
  const isWebhook = request.method === 'POST' && path === WEBHOOK_PATH;
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isWebhook && !isSameOrigin(request)) {
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
  /** Nur öffentliche Törns, Boote, Profile und /entdecken ohne Schlüssel im Pfad dürfen gefunden werden (F-84). */
  index: boolean;
  /** absolute URL des Vorschaubilds */
  image?: string;
}

const DEFAULT_DESCRIPTION = 'Segeltörns auf der Seekarte mit Wind- und Wellendaten';

/**
 * Vorschau-Metadaten (Messenger, Social, Konzept 1.4) – nur für Besucher ohne Anmeldung Sichtbares:
 * öffentlich mit vollen Angaben, „Nur mit Link“ nur mit gültigem Schlüssel im Pfad (`key`), sonst neutral.
 * Ein Schlüssel im Pfad macht die Seite nie indexierbar; öffentliche Objekte ignorieren ihn sonst.
 * `key`: undefined = kein Schlüssel-Segment, null = Segment mit ungültiger Form (zählt als falscher Schlüssel).
 */
async function pageMeta(env: Env, kind: string, id: string, origin: string, key: string | null | undefined): Promise<PageMeta> {
  const fallback = { title: env.APP_NAME, description: DEFAULT_DESCRIPTION, index: false };
  const viewer = { manager: false, key: key === undefined ? null : (key ?? '!') };
  const index = (visibility: Visibility) => visibility === 'public' && key === undefined;
  if (kind === 'entdecken') {
    return { title: `Entdecken · ${env.APP_NAME}`, description: 'Zuletzt gesegelte Törns, Boote und Segler – alles, was die Crew öffentlich teilt.', index: true };
  }
  if (kind === 's') {
    const row = await getShareRow(env, id);
    if (!row || !canViewShare(row, false, viewer.key)) return fallback;
    // Das Bild eines „Nur mit Link“-Törns braucht den Schlüssel als ?k= (Bilder können keine Header setzen).
    const k = row.visibility === 'unlisted' && row.share_key && key ? `?k=${key}` : '';
    return {
      title: `${row.title} · ${env.APP_NAME}`,
      description: row.summary || 'Segeltörn mit Wind- und Wellendaten',
      index: index(row.visibility),
      image: row.has_image ? `${origin}/api/shares/${row.id}/image${k}` : undefined,
    };
  }
  if (kind === 'u') {
    const p = await env.DB.prepare('SELECT display_name, bio, visibility, share_key FROM profiles WHERE handle = ?')
      .bind(id)
      .first<{ display_name: string; bio: string; visibility: Visibility; share_key: string | null }>();
    if (!p || !canView({ visibility: p.visibility, shareKey: p.share_key }, viewer)) return fallback;
    return { title: `${p.display_name} · ${env.APP_NAME}`, description: p.bio || 'Segelprofil mit Törns und Booten', index: index(p.visibility) };
  }
  const b = await env.DB.prepare('SELECT name, boat_type, home_port, visibility, share_key FROM boats WHERE id = ?')
    .bind(id)
    .first<{ name: string; boat_type: string; home_port: string; visibility: Visibility; share_key: string | null }>();
  if (!b || !canView({ visibility: b.visibility, shareKey: b.share_key }, viewer)) return fallback;
  const desc = [b.boat_type, b.home_port && `Heimathafen ${b.home_port}`].filter(Boolean).join(' · ');
  return { title: `${b.name} · ${env.APP_NAME}`, description: desc || 'Boot mit seinen Törns', index: index(b.visibility) };
}

/** /s/:id(/:key), /u/:handle(/:key), /b/:id(/:key), /entdecken – liefert die App mit passenden Vorschau-Metadaten. */
async function metaPage(request: Request, env: Env, kind: string, id: string, key: string | null | undefined): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/', request.url), { headers: request.headers }));
  const meta: PageMeta = await pageMeta(env, kind, id, new URL(request.url).origin, key).catch(() => ({ title: env.APP_NAME, description: DEFAULT_DESCRIPTION, index: false }));
  const rewritten = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(meta.title) })
    .on('meta[property="og:title"]', { element: (el) => void el.setAttribute('content', meta.title) })
    .on('meta[property="og:description"], meta[name="description"]', { element: (el) => void el.setAttribute('content', meta.description) })
    .on('head', {
      element: (el) => {
        if (!meta.index) el.append('<meta name="robots" content="noindex">', { html: true });
        if (meta.image) {
          // URL aus eigener Origin, validierter ID und validiertem Schlüssel gebaut – kein Fremdtext im HTML.
          el.append(
            `<meta property="og:image" content="${meta.image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`,
            { html: true },
          );
        }
      },
    })
    .transform(page);
  const res = withPageHeaders(new Response(rewritten.body, rewritten));
  res.headers.set('Cache-Control', 'no-cache');
  return res;
}

/** Alle /api/*-Antworten (auch 204 ohne Body) tragen X-Robots-Tag: noindex (F-84). */
function noindex(res: Response): Response {
  if (res.headers.get('X-Robots-Tag') === 'noindex') return res;
  try {
    res.headers.set('X-Robots-Tag', 'noindex');
    return res;
  } catch {
    // unveränderliche Header (z. B. weitergereichte Antworten)
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return noindex(await handleApi(request, env, url.pathname));
      // Optionales letztes Segment = Teilen-Schlüssel („Nur mit Link“, Konzept 2.1).
      const page =
        /^\/(s|b)\/([A-Za-z0-9]{12,32})(?:\/([^/]+))?\/?$/.exec(url.pathname) ??
        /^\/(u)\/([a-z0-9-]{3,30})(?:\/([^/]+))?\/?$/i.exec(url.pathname) ??
        /^\/(entdecken)()\/?$/.exec(url.pathname);
      if (page && (request.method === 'GET' || request.method === 'HEAD')) {
        const key = page[3] === undefined ? undefined : isShareKey(page[3]) ? page[3] : null;
        return await metaPage(request, env, page[1], page[1] === 'u' ? page[2].toLowerCase() : page[2], key);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      return url.pathname.startsWith('/api/') ? noindex(errorResponse(err)) : errorResponse(err);
    }
  },

  // Nächtliches Aufräumen (Cron-Trigger in wrangler.jsonc).
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runRetention(env, env.APP_ORIGIN || 'https://sailing.wollow.ski').then((r) => console.log('retention', JSON.stringify(r))));
  },
} satisfies ExportedHandler<Env>;
