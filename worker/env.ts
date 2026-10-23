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
}
