export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TRACKS: R2Bucket;
  UPLOAD_LIMITER?: RateLimit;
  AUTH_LIMITER?: RateLimit;
  /** Cloudflare Email Sending (nur mit Workers Paid für beliebige Empfänger) */
  EMAIL?: SendEmail;

  APP_NAME: string;
  MAIL_PROVIDER: 'resend' | 'cloudflare' | 'log';
  MAIL_FROM: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET?: string;
  /** Öffentliche Adresse für Links in Mails aus dem Cron (ohne Request). */
  APP_ORIGIN?: string;

  /** Kostenlose gespeicherte Freigaben pro Konto (Standard 3); darüber braucht es den Unterstützer-Status. */
  FREE_SHARES?: string;
  /** Stripe-Secret-Key (Worker-Secret, sk_…) für Checkout-Sessions – ohne ihn kein Unterstützen. */
  STRIPE_SECRET_KEY?: string;
  /** Nur Tests: lokale Stripe-Stub-Adresse (andere Hosts werden abgelehnt). */
  STRIPE_API_BASE?: string;
  /** Signatur-Geheimnis des Stripe-Webhooks (Worker-Secret, whsec_…). */
  STRIPE_WEBHOOK_SECRET?: string;
}
