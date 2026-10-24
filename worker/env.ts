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

  /** Kostenlose gespeicherte Freigaben pro Konto (Standard 3); darüber braucht es den Unterstützer-Status. */
  FREE_SHARES?: string;
  /** Öffentliche Stripe-Payment-Links („Kaffee“, „Bier“) – ohne sie gibt es keine Unterstützen-Knöpfe. */
  SUPPORT_LINK_COFFEE?: string;
  SUPPORT_LINK_BEER?: string;
  /** Signatur-Geheimnis des Stripe-Webhooks (Worker-Secret, whsec_…). */
  STRIPE_WEBHOOK_SECRET?: string;
}
