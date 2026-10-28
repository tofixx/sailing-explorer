// Web Push im Browser (Konzept 17.7): Service Worker registrieren, Erlaubnis einholen, beim Server abonnieren.
// Die Weckrufe sind leer – den Text holt der Service Worker (public/sw.js) selbst mit der Sitzung.
import { notificationApi } from './api';

/** Kann dieser Browser Push überhaupt (iOS nur als installierte App vom Home-Bildschirm)? */
export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Öffentlicher Schlüssel des Servers – einmal je Seite geladen; null = Push nicht eingerichtet oder nicht möglich. */
let key: Promise<string | null> | null = null;
export function pushKey(): Promise<string | null> {
  if (!pushSupported()) return Promise.resolve(null);
  key ??= notificationApi.pushKey().then((r) => r.publicKey, () => null);
  return key;
}

export type PushResult = 'ok' | 'unsupported' | 'denied';

/** Dieses Gerät für Push anmelden (fragt nach der Erlaubnis). */
export async function enablePush(): Promise<PushResult> {
  const publicKey = await pushKey();
  if (!publicKey) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await notificationApi.subscribePush(sub.endpoint);
  return 'ok';
}

/** Dieses Gerät abmelden (keine Art steht mehr auf Push). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await notificationApi.unsubscribePush(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
