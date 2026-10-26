export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TRACKS: R2Bucket;
  UPLOAD_LIMITER?: RateLimit;
  AUTH_LIMITER?: RateLimit;
  /** Fehlversuche mit Teilen-Schlüssel (30 pro 60 s und IP), nur auf dem Fehlerpfad */
  LINK_LIMITER?: RateLimit;
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
  /** Notbremse (Konzept 5.2): ab so vielen Bytes Gesamtspeicher pausieren neue Uploads kostenloser Konten (Standard 8 GB). */
  STORAGE_SOFT_BYTES?: string;
  /** … und ab so vielen Bytes alle neuen Uploads (Standard 9,5 GB). */
  STORAGE_HARD_BYTES?: string;
  /** Stripe-Secret-Key (Worker-Secret, sk_…) für Checkout-Sessions – ohne ihn kein Unterstützen. */
  STRIPE_SECRET_KEY?: string;
  /** Nur Tests: lokale Stripe-Stub-Adresse (andere Hosts werden abgelehnt). */
  STRIPE_API_BASE?: string;
  /** Signatur-Geheimnis des Stripe-Webhooks (Worker-Secret, whsec_…). */
  STRIPE_WEBHOOK_SECRET?: string;

  // ---- Kommentare & Melden (Phase D) ----
  /** Konto-IDs der Moderation, kommagetrennt (Variable oder Secret). Leer = keine Admin-Oberfläche, Meldungen werden trotzdem gespeichert. */
  ADMIN_USER_IDS?: string;
  /** Kontaktadresse für Meldungen ohne Konto (Impressum, Art. 16 DSA) – erscheint im Melden-Dialog. */
  REPORT_CONTACT?: string;
}
