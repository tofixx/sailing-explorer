import type { Env } from './env';
import { HttpError } from './http';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function magicLinkMail(env: Env, to: string, link: string): Mail {
  const app = env.APP_NAME;
  const text = `Hallo,\n\nmit diesem Link meldest du dich bei ${app} an:\n\n${link}\n\nDer Link ist 15 Minuten gültig und funktioniert nur einmal. Wenn du das nicht angefordert hast, ignoriere diese Mail einfach.\n`;
  // Link stammt aus unserer eigenen Origin + base64url-Token, enthält also keine HTML-Sonderzeichen.
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>mit diesem Link meldest du dich bei <b>${app}</b> an:</p>
<p><a href="${link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Anmelden</a></p>
<p style="color:#5b6b7b;font-size:13px">Der Link ist 15 Minuten gültig und funktioniert nur einmal. Wenn du das nicht angefordert hast, ignoriere diese Mail einfach.</p>
</body></html>`;
  return { to, subject: `Dein Anmeldelink für ${app}`, text, html };
}

export async function sendMail(env: Env, mail: Mail): Promise<void> {
  switch (env.MAIL_PROVIDER) {
    case 'resend': {
      if (!env.RESEND_API_KEY) throw new HttpError(503, 'mail_unconfigured', 'Mailversand ist nicht eingerichtet.');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) {
        console.error('resend failed', res.status, await res.text());
        throw new HttpError(502, 'mail_failed', 'Die Mail konnte nicht versendet werden.');
      }
      return;
    }
    case 'cloudflare': {
      if (!env.EMAIL) throw new HttpError(503, 'mail_unconfigured', 'Mailversand ist nicht eingerichtet.');
      await env.EMAIL.send({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return;
    }
    default:
      // Lokale Entwicklung: Link landet im Worker-Log.
      console.log(`[mail:log] an ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}
