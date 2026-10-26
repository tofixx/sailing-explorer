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

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Erinnerung: diese Törns werden bald gelöscht – mit Hinweis auf Unterstützen. */
export function expiryWarningMail(env: Env, to: string, origin: string, shares: Array<{ title: string; expiresAt: number }>): Mail {
  const app = env.APP_NAME;
  const date = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  const name = (t: string) => t.trim() || 'Ohne Titel';
  const lines = shares.map((s) => `• ${name(s.title)} – gelöscht am ${date(s.expiresAt)}`).join('\n');
  const link = `${origin}/?support=open`;
  const text = `Hallo,\n\nfolgende geteilte Törns bei ${app} werden bald automatisch gelöscht:\n\n${lines}\n\nKostenlose Törns bleiben 3 Monate gespeichert. Mit einer Unterstützung (ab einem Kaffee) bleiben sie für die Dauer der Unterstützung und 3 Monate darüber hinaus erhalten:\n${link}\n\nWenn du nichts tust, werden sie zum genannten Datum entfernt.\n`;
  // Titel stammen von Nutzern → escapen.
  const items = shares.map((s) => `<li><b>${escapeHtml(name(s.title))}</b> – gelöscht am ${date(s.expiresAt)}</li>`).join('');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>folgende geteilte Törns bei <b>${app}</b> werden bald automatisch gelöscht:</p><ul>${items}</ul>
<p>Kostenlose Törns bleiben 3 Monate gespeichert. Mit einer Unterstützung bleiben sie für die Dauer der Unterstützung und 3 Monate darüber hinaus erhalten.</p>
<p><a href="${link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Unterstützen</a></p>
<p style="color:#5b6b7b;font-size:13px">Wenn du nichts tust, werden sie zum genannten Datum entfernt.</p>
</body></html>`;
  const subject = shares.length === 1 ? `${app}: Ein Törn wird bald gelöscht` : `${app}: ${shares.length} Törns werden bald gelöscht`;
  return { to, subject, text, html };
}

export interface InviteMailInput {
  kind: 'boat_admin' | 'crew';
  /** Anzeigename aus dem Profil des Einladenden; null = ohne Profil */
  inviter: string | null;
  /** Boots- bzw. Törnname (Nutzertext) */
  target: string;
  link: string;
  days: number;
}

/** Einladung als Boots-Admin bzw. in die Crew eines Törns (Konzept 10.4). Namen sind Nutzertext → gekürzt und escaped. */
export function inviteMail(env: Env, to: string, m: InviteMailInput): Mail {
  const app = env.APP_NAME;
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const who = short(m.inviter?.trim() || 'Ein Segler oder eine Seglerin', 60);
  const target = short(m.target.trim() || (m.kind === 'crew' ? 'Törn' : 'Boot'), 80);
  const what = m.kind === 'boat_admin' ? `das Boot „${target}“ bei ${app} mitzuverwalten` : `in die Crew des Törns „${target}“ bei ${app}`;
  const whatHtml = m.kind === 'boat_admin' ? `das Boot <b>„${escapeHtml(target)}“</b> bei <b>${app}</b> mitzuverwalten` : `in die Crew des Törns <b>„${escapeHtml(target)}“</b> bei <b>${app}</b>`;
  const verb = m.kind === 'boat_admin' ? 'lädt dich ein,' : 'lädt dich ein';
  const after = m.kind === 'boat_admin' ? 'Als Admin kannst du die Bootsseite bearbeiten und deine Törns dem Boot zuordnen.' : 'Mit deinem Profil erscheinst du dann auf dem Törn, sobald er öffentlich ist.';
  const foot = `Die Einladung ist ${m.days} Tage gültig. Zum Annehmen meldest du dich mit dieser E-Mail-Adresse an. Wenn du niemanden kennst, ignoriere diese Mail einfach.`;
  const text = `Hallo,\n\n${who} ${verb} ${what}.\n${after}\n\nEinladung ansehen:\n${m.link}\n\n${foot}\n`;
  // Link stammt aus unserer eigenen Origin + base64url-Token, enthält also keine HTML-Sonderzeichen.
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p><b>${escapeHtml(who)}</b> ${verb} ${whatHtml}.<br>${after}</p>
<p><a href="${m.link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Einladung ansehen</a></p>
<p style="color:#5b6b7b;font-size:13px">${foot}</p>
</body></html>`;
  const subject = m.kind === 'boat_admin' ? `${app}: Einladung als Admin für „${target}“` : `${app}: Einladung in die Crew von „${target}“`;
  return { to, subject, text, html };
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
