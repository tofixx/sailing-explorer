// Live-Benachrichtigungen per WebSocket (Konzept 17.8, F-258): ein Durable Object je Konto hält die offenen Seiten.
// Bei einer neuen oder gelesenen Benachrichtigung schickt der Worker ihm einen Anstoß, das Objekt meldet allen Seiten
// nur „es hat sich etwas geändert“ – den Zähler holt jede Seite selbst (gleiche Prüfung wie immer, nichts im Socket).
// Hibernation: zwischen den Nachrichten schläft das Objekt und kostet keine Dauer (Free Tier).
// Ohne Binding (Tests ohne Durable Objects, andere Installationen) ist Live aus – die Seite lädt dann wie vorher.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { HttpError } from './http';
import { requireUser } from './auth';
import { isSameOrigin } from './validate';
import { NOTIFICATION_LIMITS } from '../src/domain/notifications';

export class NotificationHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // „ping“ der Seite beantwortet die Laufzeit selbst – das Objekt wacht dafür nicht auf
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      // höchstens so viele offene Seiten je Konto – die älteste fliegt
      const open = this.ctx.getWebSockets();
      for (const ws of open.slice(0, Math.max(0, open.length - NOTIFICATION_LIMITS.liveSockets + 1))) ws.close(4000, 'zu viele Verbindungen');
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    // Anstoß aus dem Worker
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send('changed');
      } catch {
        // Verbindung schon zu
      }
    }
    return new Response(null, { status: 204 });
  }

  /** Andere Nachrichten der Seite gibt es nicht – ignorieren. */
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // schon geschlossen
    }
  }
}

/**
 * GET /api/notifications/live – WebSocket für angemeldete Konten. Nur von der eigenen Seite (Origin = Host): Browser
 * schicken das Sitzungs-Cookie auch bei fremden Seiten mit (Cross-Site WebSocket Hijacking).
 */
export async function liveSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'upgrade_required', 'Nur per WebSocket.');
  if (!request.headers.get('Origin') || !isSameOrigin(request)) throw new HttpError(403, 'forbidden_origin');
  const user = await requireUser(request, env);
  if (!env.NOTIFY_HUB) throw new HttpError(503, 'live_unavailable', 'Live-Benachrichtigungen sind hier nicht eingerichtet.');
  return env.NOTIFY_HUB.get(env.NOTIFY_HUB.idFromName(user.id)).fetch(request);
}

/** Anstoß an die offenen Seiten dieser Konten (eine Anfrage je Konto; ohne Binding nichts). */
export async function pingLive(env: Env, userIds: string[]): Promise<void> {
  if (!env.NOTIFY_HUB) return;
  await Promise.all(
    userIds.map((id) =>
      env.NOTIFY_HUB!.get(env.NOTIFY_HUB!.idFromName(id))
        .fetch('https://hub/changed', { method: 'POST' })
        .catch((err) => console.error('live ping failed', err)),
    ),
  );
}
