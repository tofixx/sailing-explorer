// Eine Adresse für alles: Alias-Hosts (www., Subdomains der Hauptdomain, alte Domain) leiten dauerhaft auf die
// Hauptdomain weiter – mit Pfad und Query, damit alte geteilte Links und Magic Links weiter funktionieren.

/** Ausschnitt aus Env – bewusst ohne Worker-Typen, damit die Funktion auch im Unit-Test läuft. */
export interface CanonicalConfig {
  CANONICAL_HOST?: string;
  ALIAS_HOSTS?: string;
}

/** Stripe folgt bei Webhooks keinen Weiterleitungen – die Route muss unter jeder Adresse direkt antworten. */
const NO_REDIRECT_PATHS = new Set(['/api/webhooks/stripe']);

export function canonicalRedirect(url: URL, env: CanonicalConfig): Response | null {
  const canonical = env.CANONICAL_HOST?.trim().toLowerCase();
  if (!canonical) return null;
  const host = url.hostname.toLowerCase();
  if (host === canonical || NO_REDIRECT_PATHS.has(url.pathname)) return null;
  const aliases = (env.ALIAS_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!aliases.includes(host) && !host.endsWith(`.${canonical}`)) return null;
  return new Response(null, {
    status: 301,
    headers: { Location: `https://${canonical}${url.pathname}${url.search}`, 'Cache-Control': 'public, max-age=3600' },
  });
}
