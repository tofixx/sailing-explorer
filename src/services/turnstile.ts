// Cloudflare Turnstile (Bot-Schutz für das Anmeldeformular) – wird erst bei Bedarf geladen.

interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void; language?: string }): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile nicht verfügbar')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile konnte nicht geladen werden'));
    };
    document.head.append(s);
  });
  return loading;
}

/** Erzeugt eine Mount-Funktion für den Login-Dialog. */
export function turnstileMount(siteKey: string) {
  return async (el: HTMLElement, onToken: (t: string | null) => void): Promise<() => void> => {
    const ts = await load();
    const id = ts.render(el, { sitekey: siteKey, language: 'de', callback: onToken, 'expired-callback': () => onToken(null) });
    return () => ts.remove(id);
  };
}
